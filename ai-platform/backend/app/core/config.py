"""Application configuration via pydantic-settings.

Every setting is env-driven (prefix ``HOOKSWAP_AI_``). Import the singleton
``settings`` everywhere; it is created once and cached.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "staging", "production"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="HOOKSWAP_AI_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- app ---
    env: Environment = "development"
    debug: bool = True
    log_level: str = "INFO"
    log_json: bool = False
    api_prefix: str = "/api/v1"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])

    # --- security ---
    jwt_secret: str = "change-me-in-prod-please-32b-min"
    jwt_algorithm: str = "HS256"
    jwt_ttl_seconds: int = 3600
    api_key_prefix: str = "hsk_"

    # --- endpoint auth (internal static API keys) ---
    # Comma-separated set of accepted bearer / X-API-Key values. Empty = none
    # configured. Never hardcode a real key here — inject via
    # HOOKSWAP_AI_API_KEYS. When auth is enforced but this is empty the app
    # FAILS CLOSED (deny) — loudly in production.
    api_keys: list[str] = Field(default_factory=list)
    # Local-dev escape hatch ONLY. Defaults secure (False). Setting it True
    # skips endpoint auth — but it is IGNORED in production (auth always on).
    auth_disabled: bool = False

    # --- postgres ---
    database_url: str = "postgresql+asyncpg://hookswap:hookswap@localhost:5432/hookswap_ai"
    db_pool_size: int = 10
    db_max_overflow: int = 20
    db_echo: bool = False

    # --- redis ---
    redis_url: str = "redis://localhost:6379/0"

    # --- vector store ---
    vectorstore_provider: Literal["qdrant", "pinecone", "milvus", "weaviate"] = "qdrant"
    qdrant_url: str = "http://localhost:6333"
    qdrant_api_key: str | None = None
    qdrant_collection: str = "hookswap_knowledge"

    # --- opensearch ---
    opensearch_url: str = "http://localhost:9200"
    opensearch_index: str = "hookswap_chunks"
    opensearch_user: str | None = None
    opensearch_password: str | None = None

    # --- embeddings ---
    embedding_provider: Literal["openai", "voyage", "bge", "nomic"] = "openai"
    embedding_model: str = "text-embedding-3-large"
    embedding_dim: int = 3072
    openai_api_key: str | None = None
    voyage_api_key: str | None = None
    nomic_api_key: str | None = None

    # --- llm ---
    llm_default_provider: Literal["openai", "anthropic", "gemini", "openrouter", "ollama"] = (
        "anthropic"
    )
    anthropic_api_key: str | None = None
    gemini_api_key: str | None = None
    openrouter_api_key: str | None = None
    ollama_base_url: str = "http://localhost:11434"

    # --- rag ---
    rag_top_k: int = 8
    rag_fetch_k: int = 32
    rag_context_token_budget: int = 6000
    rag_min_confidence: float = 0.35
    rag_rerank_enabled: bool = True
    # Ingested-corpus location (shared by the ingestion script + the server).
    # When None, resolves to ``<ai-platform>/data/corpus.json`` (see retrieval.store).
    corpus_path: str | None = None
    # LLM generation
    llm_model: str = "claude-opus-4-8"
    llm_max_tokens: int = 4096

    # --- live data tools ---
    data_api_base_url: str = "https://data.hookswap.org"
    trading_api_base_url: str = "https://trading.hookswap.org"

    # --- marketing / X (Twitter) bot ---
    # Anthropic (Claude) creds/model for drafting are shared with the RAG core:
    # `anthropic_api_key` + `llm_model` above. `llm_model` defaults to a current
    # Claude model (claude-opus-4-8) and is what the marketing assistant drafts with.
    #
    # X (Twitter) OAuth 1.0a user-context credentials. All four are required to
    # publish; when ANY is empty the X client runs in DRY-RUN (never posts, never
    # fakes success). Read by app/marketing/x_client.py, which also falls back to
    # the bare X_API_KEY/... env names so either wiring style works.
    x_api_key: str | None = None
    x_api_secret: str | None = None
    x_access_token: str | None = None
    x_access_secret: str | None = None
    # Master publish kill-switch ("auto-post disable flag"). Even with an explicit
    # per-request confirm=true AND full X credentials, POST /v1/marketing/publish
    # will NOT post unless this is True. Default False => the bot can only
    # draft / dry-run. Set HOOKSWAP_AI_MARKETING_AUTO_POST_ENABLED=true to go live.
    marketing_auto_post_enabled: bool = False
    # Pull REAL live stats (TVL / 24h volume) from the data-api for grounding when
    # a brief references a market number, so any figure in a post traces to the
    # live-stats tool — never the model. When False (or the fetch returns nothing)
    # such numbers are omitted, never fabricated.
    marketing_live_stats_enabled: bool = True
    # Timeout (seconds) for the live-stats data-api fetch.
    marketing_live_stats_timeout_s: float = 6.0

    # --- rate limit ---
    rate_limit_enabled: bool = True
    rate_limit_default_per_min: int = 60
    # Per-endpoint budgets (requests / minute / caller). Caller = API-key id, or
    # client IP when auth is disabled. Bucket capacity (burst) == the per-min value.
    rate_limit_chat_per_min: int = 30
    rate_limit_marketing_per_min: int = 15

    # --- prompt-injection / RAG-poisoning input guard ---
    injection_guard_enabled: bool = True
    # Hard input length cap for the chat/RAG + marketing free-text paths.
    injection_max_input_chars: int = 8000
    # True => block (400) on a high-severity injection match; False => sanitize
    # + warn only (still logs). Internal-tools default is to block.
    injection_block_on_match: bool = True

    @field_validator("cors_origins", "api_keys", mode="before")
    @classmethod
    def _split_csv(cls, v: object) -> object:
        if isinstance(v, str):
            return [item.strip() for item in v.split(",") if item.strip()]
        return v

    @property
    def is_production(self) -> bool:
        return self.env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
