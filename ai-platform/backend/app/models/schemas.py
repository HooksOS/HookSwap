"""Pydantic v2 API schemas (request/response DTOs).

Kept separate from ORM models. These are the public contract used by REST,
GraphQL, and WS layers.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --------------------------------------------------------------------------- #
# Retrieval filters (chain / wallet / time-aware)                             #
# --------------------------------------------------------------------------- #
class RetrievalFilters(BaseModel):
    """Metadata filters applied to every query (README §4)."""

    chain_id: int | None = None
    chain_ids: list[int] | None = None
    protocol: str | None = None
    contract_address: str | None = None
    wallet_address: str | None = None
    doc_types: list[str] | None = None
    document_ids: list[uuid.UUID] | None = None
    # time-aware: only chunks valid within [as_of window]
    as_of: datetime | None = None
    updated_after: datetime | None = None
    tags: dict[str, Any] | None = None


# --------------------------------------------------------------------------- #
# Search                                                                       #
# --------------------------------------------------------------------------- #
class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=4000)
    top_k: int = Field(default=8, ge=1, le=50)
    filters: RetrievalFilters = Field(default_factory=RetrievalFilters)
    mode: Literal["hybrid", "dense", "sparse"] = "hybrid"
    rerank: bool = True


class SearchHit(BaseModel):
    chunk_id: uuid.UUID | None = None
    document_id: uuid.UUID | None = None
    title: str | None = None
    snippet: str
    score: float
    source_uri: str | None = None
    chain_id: int | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class SearchResponse(BaseModel):
    query: str
    hits: list[SearchHit]
    took_ms: int


# --------------------------------------------------------------------------- #
# Chat / RAG                                                                   #
# --------------------------------------------------------------------------- #
class CitationOut(BaseModel):
    marker: int
    kind: Literal["chunk", "live_tool"] = "chunk"
    title: str | None = None
    source_uri: str | None = None
    snippet: str | None = None
    score: float | None = None
    document_id: uuid.UUID | None = None
    chunk_id: uuid.UUID | None = None
    tool_name: str | None = None


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    conversation_id: uuid.UUID | None = None
    assistant: str = "docs"  # docs | trading | dev | support | governance | ...
    filters: RetrievalFilters = Field(default_factory=RetrievalFilters)
    stream: bool = False
    model: str | None = None            # override LLM model
    provider: str | None = None         # override LLM provider
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    use_live_tools: bool = True


class ChatResponse(BaseModel):
    conversation_id: uuid.UUID
    message_id: uuid.UUID
    answer: str
    citations: list[CitationOut] = Field(default_factory=list)
    confidence: float
    is_grounded: bool
    provider: str | None = None
    model: str | None = None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    warnings: list[str] = Field(default_factory=list)
    took_ms: int = 0


class StreamDelta(BaseModel):
    """One WS/SSE frame during streaming generation."""

    type: Literal["token", "citation", "confidence", "done", "error", "tool"]
    data: Any = None


# --------------------------------------------------------------------------- #
# Documents                                                                    #
# --------------------------------------------------------------------------- #
class DocumentCreate(BaseModel):
    title: str
    doc_type: str = "doc"
    source_uri: str | None = None
    content: str | None = None  # inline content -> triggers ingestion job
    chain_id: int | None = None
    protocol: str | None = None
    contract_address: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class DocumentOut(ORMModel):
    id: uuid.UUID
    title: str
    doc_type: str
    status: str
    source_uri: str | None = None
    chain_id: int | None = None
    latest_version: int
    created_at: datetime
    updated_at: datetime


# --------------------------------------------------------------------------- #
# Tenancy                                                                      #
# --------------------------------------------------------------------------- #
class OrganizationCreate(BaseModel):
    name: str
    slug: str
    plan: str = "free"


class OrganizationOut(ORMModel):
    id: uuid.UUID
    name: str
    slug: str
    plan: str
    is_active: bool
    created_at: datetime


class ProjectCreate(BaseModel):
    name: str
    slug: str
    description: str | None = None
    default_chain_id: int | None = None


class ProjectOut(ORMModel):
    id: uuid.UUID
    name: str
    slug: str
    description: str | None = None
    default_chain_id: int | None = None
    created_at: datetime


class ApiKeyCreate(BaseModel):
    name: str
    project_id: uuid.UUID | None = None
    scopes: list[str] = Field(default_factory=list)
    rate_limit_per_min: int | None = None
    expires_at: datetime | None = None


class ApiKeyCreated(BaseModel):
    id: uuid.UUID
    name: str
    api_key: str  # plaintext — shown once
    key_prefix: str
    scopes: list[str]


class UsageSummary(BaseModel):
    organization_id: uuid.UUID
    window_start: datetime
    window_end: datetime
    prompt_tokens: int
    completion_tokens: int
    embedding_tokens: int
    cost_usd: float
    request_count: int


# --------------------------------------------------------------------------- #
# Agents                                                                       #
# --------------------------------------------------------------------------- #
class AgentRunRequest(BaseModel):
    agent: str  # trading | liquidity | dev | support | governance | ...
    input: str
    conversation_id: uuid.UUID | None = None
    filters: RetrievalFilters = Field(default_factory=RetrievalFilters)
    stream: bool = False
    max_steps: int = Field(default=6, ge=1, le=20)


class AgentStep(BaseModel):
    step: int
    thought: str | None = None
    tool: str | None = None
    tool_input: dict[str, Any] | None = None
    observation: str | None = None


class AgentRunResponse(BaseModel):
    agent: str
    output: str
    steps: list[AgentStep] = Field(default_factory=list)
    citations: list[CitationOut] = Field(default_factory=list)
    confidence: float
    took_ms: int = 0


class HealthResponse(BaseModel):
    status: str
    version: str
    env: str
    checks: dict[str, bool] = Field(default_factory=dict)
