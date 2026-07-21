"""Document / knowledge ORM models.

A ``Document`` is a source artifact (whitepaper, doc page, ABI, governance post,
audit report). Ingestion produces immutable ``DocumentVersion`` snapshots; each
version is split into ``Chunk`` rows. Every chunk has an ``EmbeddingRef`` — the
vector itself lives in Qdrant (id = ``EmbeddingRef.vector_id``); Postgres keeps
the pointer + metadata so we can re-index and enforce tenant scoping.

Chunk metadata carries the chain/wallet/time-aware fields used by retrieval
filters (README §4).
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, TimestampMixin, UUIDMixin


class DocumentType(str, enum.Enum):
    DOC = "doc"
    WHITEPAPER = "whitepaper"
    ABI = "abi"
    CONTRACT = "contract"
    GOVERNANCE = "governance"
    AUDIT = "audit"
    FAQ = "faq"
    BLOG = "blog"
    CHANGELOG = "changelog"
    API_REF = "api_ref"
    OTHER = "other"


class DocumentStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    INDEXED = "indexed"
    FAILED = "failed"
    ARCHIVED = "archived"


class Document(UUIDMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "documents"
    __table_args__ = (
        Index("ix_document_tenant", "organization_id", "project_id"),
        Index("ix_document_chain", "chain_id"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    source_uri: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    source_type: Mapped[str | None] = mapped_column(String(80), nullable=True)  # connector name
    doc_type: Mapped[DocumentType] = mapped_column(
        Enum(DocumentType), default=DocumentType.DOC, nullable=False
    )
    status: Mapped[DocumentStatus] = mapped_column(
        Enum(DocumentStatus), default=DocumentStatus.PENDING, nullable=False
    )
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    language: Mapped[str] = mapped_column(String(12), default="en", nullable=False)

    # chain/wallet/time-aware metadata at doc level (denormalized onto chunks too)
    chain_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    protocol: Mapped[str | None] = mapped_column(String(120), nullable=True)
    contract_address: Mapped[str | None] = mapped_column(String(42), nullable=True, index=True)
    doc_metadata: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    latest_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    versions: Mapped[list[DocumentVersion]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )
    chunks: Mapped[list[Chunk]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )


class DocumentVersion(UUIDMixin, TimestampMixin, Base):
    """Immutable snapshot of a document's content at a point in time."""

    __tablename__ = "document_versions"
    __table_args__ = (
        UniqueConstraint("document_id", "version", name="uq_docversion"),
    )

    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True, nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    raw_uri: Mapped[str | None] = mapped_column(String(2000), nullable=True)  # S3 pointer
    byte_size: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    change_note: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    document: Mapped[Document] = relationship(back_populates="versions")


class Chunk(UUIDMixin, TimestampMixin, Base):
    """A retrievable unit of text. Parent-child aware via ``parent_chunk_id``."""

    __tablename__ = "chunks"
    __table_args__ = (
        Index("ix_chunk_tenant", "organization_id", "project_id"),
        Index("ix_chunk_doc_version", "document_id", "version"),
        Index("ix_chunk_chain", "chain_id"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True, nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    # parent-child retrieval: small child chunks point to a larger parent chunk
    parent_chunk_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("chunks.id", ondelete="SET NULL"), nullable=True
    )
    is_parent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    ordinal: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    token_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    heading_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    # chain/wallet/time-aware metadata (mirrors document + adds granularity)
    chain_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    protocol: Mapped[str | None] = mapped_column(String(120), nullable=True)
    contract_address: Mapped[str | None] = mapped_column(String(42), nullable=True)
    wallet_address: Mapped[str | None] = mapped_column(String(42), nullable=True)
    valid_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    valid_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    chunk_metadata: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    document: Mapped[Document] = relationship(back_populates="chunks")
    embedding_ref: Mapped[EmbeddingRef | None] = relationship(
        back_populates="chunk", uselist=False, cascade="all, delete-orphan"
    )


class EmbeddingRef(UUIDMixin, TimestampMixin, Base):
    """Pointer from a chunk to its vector in the external vector store."""

    __tablename__ = "embedding_refs"

    chunk_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chunks.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    vector_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    collection: Mapped[str] = mapped_column(String(200), nullable=False)
    provider: Mapped[str] = mapped_column(String(40), nullable=False)  # qdrant|pinecone|...
    model: Mapped[str] = mapped_column(String(120), nullable=False)
    dim: Mapped[int] = mapped_column(Integer, nullable=False)
    norm: Mapped[float | None] = mapped_column(Float, nullable=True)

    chunk: Mapped[Chunk] = relationship(back_populates="embedding_ref")
