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

    # --- live data tools ---
    data_api_base_url: str = "https://data.hookswap.org"
    trading_api_base_url: str = "https://trading.hookswap.org"

    # --- rate limit ---
    rate_limit_default_per_min: int = 60

    @field_validator("cors_origins", mode="before")
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
