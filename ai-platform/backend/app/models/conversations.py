"""Conversation / message / citation ORM models.

Conversation memory (README RAG flow). Each assistant ``Message`` carries a
``confidence`` and any number of ``Citation`` rows that ground the answer in
retrieved chunks (or live-tool results). Grounding is a hard requirement — an
assistant message with no citations and no grounding is flagged.
"""
from __future__ import annotations

import enum
import uuid

from sqlalchemy import (
    JSON,
    Boolean,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class MessageRole(str, enum.Enum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"


class CitationKind(str, enum.Enum):
    CHUNK = "chunk"       # grounded in a retrieved document chunk
    LIVE_TOOL = "live_tool"  # grounded in a live-data tool call (TVL, pool stats, ...)


class Conversation(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "conversations"
    __table_args__ = (Index("ix_conversation_tenant", "organization_id", "project_id"),)

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    assistant: Mapped[str] = mapped_column(String(80), default="docs", nullable=False)
    # active chain/wallet context for chain-aware retrieval
    chain_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    wallet_address: Mapped[str | None] = mapped_column(String(42), nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)  # rolling memory summary
    conv_metadata: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    messages: Mapped[list[Message]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.created_at",
    )


class Message(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "messages"
    __table_args__ = (Index("ix_message_conversation", "conversation_id", "created_at"),)

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[MessageRole] = mapped_column(Enum(MessageRole), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)

    # generation metadata (assistant messages)
    provider: Mapped[str | None] = mapped_column(String(40), nullable=True)
    model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_grounded: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    finish_reason: Mapped[str | None] = mapped_column(String(40), nullable=True)
    msg_metadata: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    conversation: Mapped[Conversation] = relationship(back_populates="messages")
    citations: Mapped[list[Citation]] = relationship(
        back_populates="message", cascade="all, delete-orphan"
    )


class Citation(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "citations"

    message_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), index=True, nullable=False
    )
    kind: Mapped[CitationKind] = mapped_column(
        Enum(CitationKind), default=CitationKind.CHUNK, nullable=False
    )
    marker: Mapped[int] = mapped_column(Integer, nullable=False)  # [1], [2], ...
    chunk_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("chunks.id", ondelete="SET NULL"), nullable=True
    )
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), nullable=True
    )
    source_uri: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    snippet: Mapped[str | None] = mapped_column(Text, nullable=True)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    tool_name: Mapped[str | None] = mapped_column(String(120), nullable=True)  # live-tool citations

    message: Mapped[Message] = relationship(back_populates="citations")
