"""FastAPI application entrypoint for the HookSwap AI Knowledge Platform (RAG core).

Boots ``uvicorn app.main:app``. The app never crashes on missing optional providers:
the RAG engine loads the persisted corpus if present (else starts empty), and the LLM /
OpenAI-embedding clients are resolved lazily and degrade honestly when unconfigured.
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.rest import chat_router
from app.core.config import settings
from app.core.exceptions import install_exception_handlers
from app.core.logging import configure_logging, get_logger
from app.rag.engine import RagEngine
from app.retrieval.store import resolve_corpus_path
from app.security.auth import require_api_key
from app.security.rate_limit import chat_rate_limit, marketing_rate_limit

# The marketing slice needs FastAPI (already a hard dep here) but its leaf modules
# pull optional providers lazily — importing the router is safe. Kept behind a
# guarded import so a future refactor of the slice can never break core boot.
try:
    from app.marketing.routes import router as marketing_router
except Exception as _exc:  # pragma: no cover - defensive; slice is optional
    marketing_router = None
    _marketing_import_error: str | None = str(_exc)
else:
    _marketing_import_error = None

configure_logging()
log = get_logger("app.main")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Build the RAG engine once at startup; loading the corpus must never crash boot.
    # from_settings() is defensive (corrupt/missing corpus -> empty store), but guard anyway.
    try:
        engine = RagEngine.from_settings(settings)
    except Exception as exc:  # pragma: no cover - defensive
        from app.retrieval.store import RetrievalStore, build_embedder

        log.error("rag_engine_init_failed", error=str(exc))
        engine = RagEngine(RetrievalStore(embedder=build_embedder(settings)), settings=settings)
    app.state.rag_engine = engine
    # Expose settings on app.state so security dependencies (auth / rate limit)
    # can be overridden per-app in tests; they fall back to the singleton.
    app.state.settings = settings
    log.info(
        "startup",
        version=__version__,
        env=settings.env,
        corpus_chunks=engine.store.size,
        llm_configured=engine.llm_configured,
        marketing_router=marketing_router is not None,
        auth_enforced=(settings.is_production or not settings.auth_disabled),
        api_keys_configured=len(settings.api_keys),
        rate_limit_enabled=settings.rate_limit_enabled,
        injection_guard_enabled=settings.injection_guard_enabled,
    )
    if _marketing_import_error:
        log.warning("marketing_router_unavailable", error=_marketing_import_error)
    yield
    log.info("shutdown")


app = FastAPI(
    title="HookSwap AI Knowledge Platform",
    version=__version__,
    description="Facts-only, citation-backed RAG over the HookSwap knowledge base.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Consistent error envelope for all domain + unhandled errors.
install_exception_handlers(app)

# Task-spec routes live under /v1 (POST /v1/chat, POST /v1/chat/stream).
# Every non-public router carries endpoint auth + per-caller rate limiting as
# router-level dependencies. /health and / stay open (not on these routers).
app.include_router(
    chat_router,
    prefix="/v1",
    dependencies=[Depends(require_api_key), Depends(chat_rate_limit)],
)

# Marketing slice (grounded X-post drafting/publishing). Its router already
# carries its own /v1/marketing prefix, so it is mounted at the app root.
if marketing_router is not None:
    app.include_router(
        marketing_router,
        dependencies=[Depends(require_api_key), Depends(marketing_rate_limit)],
    )


@app.get("/health")
async def health() -> dict[str, Any]:
    """Liveness + which providers are configured (nothing here can fail)."""
    engine: RagEngine | None = getattr(app.state, "rag_engine", None)
    embedder = getattr(engine.store, "embedder", None) if engine else None
    openai_key = bool(getattr(settings, "openai_api_key", None) or os.getenv("OPENAI_API_KEY"))
    return {
        "status": "ok",
        "version": __version__,
        "env": settings.env,
        "providers": {
            "llm": {
                "configured": bool(engine and engine.llm_configured),
                "model": settings.llm_model,
                "provider": "anthropic",
            },
            "embeddings": {
                "kind": getattr(embedder, "kind", None),
                "openai_key_present": openai_key,
                "using_openai": getattr(embedder, "kind", None) == "openai",
            },
            "corpus": {
                "path": str(resolve_corpus_path(settings)),
                "chunks": engine.store.size if engine else 0,
                "sources": len(engine.store.sources()) if engine else 0,
                "loaded": bool(engine and engine.store.size > 0),
            },
        },
        "routes": {
            "chat": True,
            "marketing": marketing_router is not None,
        },
    }


@app.get("/")
async def root() -> dict[str, str]:
    return {"service": "hookswap-ai-platform", "docs": "/docs", "health": "/health"}
