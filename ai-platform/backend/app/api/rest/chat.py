"""Chat REST endpoints: grounded RAG answers + SSE streaming.

Routes (mounted under ``/v1`` by ``app.main``):
    POST /v1/chat         -> one-shot grounded answer with citations
    POST /v1/chat/stream  -> Server-Sent Events stream of the same

Honest degradation: a *grounded* query that needs the LLM returns **503** when no
Anthropic credential is configured; an *ungrounded* query returns 200 with the
"not in the knowledge base" answer (no model needed).
"""
from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.rag.engine import LLMNotConfiguredError, RagEngine
from app.security.injection import enforce_input

router = APIRouter(tags=["chat"])


class ChatQuery(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    top_k: Optional[int] = Field(default=None, ge=1, le=50)


class CitationDTO(BaseModel):
    source_id: str
    snippet: str
    score: float = 0.0


class ChatAnswer(BaseModel):
    answer: str
    citations: list[CitationDTO] = Field(default_factory=list)
    grounded: bool
    model: Optional[str] = None


def _engine(request: Request) -> RagEngine:
    engine = getattr(request.app.state, "rag_engine", None)
    if engine is None:  # should never happen; lifespan builds it
        raise HTTPException(status_code=503, detail="RAG engine not initialized")
    return engine


@router.post("/chat", response_model=ChatAnswer)
async def chat(payload: ChatQuery, request: Request) -> ChatAnswer:
    engine = _engine(request)
    # Prompt-injection input guard: raises 400 on a jailbreak/override attempt,
    # else returns the sanitized message to send downstream.
    message = enforce_input(payload.message, source="chat")
    try:
        result = await run_in_threadpool(engine.answer, message, top_k=payload.top_k)
    except LLMNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return ChatAnswer(**result.to_dict())


@router.post("/chat/stream")
async def chat_stream(payload: ChatQuery, request: Request) -> StreamingResponse:
    engine = _engine(request)

    # Prompt-injection input guard (raises 400 before we open the SSE stream).
    message = enforce_input(payload.message, source="chat_stream")

    # Fail fast with 503 (before opening the stream) when a grounded answer needs the LLM.
    hits = await run_in_threadpool(
        lambda: engine._relevant(engine.retrieve(message, top_k=payload.top_k))
    )
    if hits and not engine.llm_configured:
        raise HTTPException(
            status_code=503,
            detail="LLM not configured: set ANTHROPIC_API_KEY to enable grounded generation.",
        )

    def _sse() -> Any:
        try:
            for event in engine.stream_answer(message, top_k=payload.top_k):
                yield f"event: {event['type']}\ndata: {json.dumps(event['data'])}\n\n"
        except LLMNotConfiguredError as exc:  # defensive; pre-checked above
            yield f"event: error\ndata: {json.dumps({'detail': str(exc)})}\n\n"

    return StreamingResponse(
        _sse(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


__all__ = ["router"]
