"""ORM models + Pydantic schemas. Importing this package registers all tables
on ``Base.metadata`` (needed for ``create_all`` / Alembic autogenerate)."""
from app.models.base import Base
from app.models.conversations import (
    Citation,
    CitationKind,
    Conversation,
    Message,
    MessageRole,
)
from app.models.documents import (
    Chunk,
    Document,
    DocumentStatus,
    DocumentType,
    DocumentVersion,
    EmbeddingRef,
)
from app.models.jobs import Job, JobStatus, JobType
from app.models.tenancy import (
    ApiKey,
    Organization,
    PlanTier,
    Project,
    Role,
    RoleName,
    Team,
    UsageRecord,
    User,
)

__all__ = [
    "Base",
    # tenancy
    "Organization",
    "Project",
    "Team",
    "User",
    "Role",
    "RoleName",
    "ApiKey",
    "UsageRecord",
    "PlanTier",
    # documents
    "Document",
    "DocumentVersion",
    "Chunk",
    "EmbeddingRef",
    "DocumentType",
    "DocumentStatus",
    # conversations
    "Conversation",
    "Message",
    "Citation",
    "MessageRole",
    "CitationKind",
    # jobs
    "Job",
    "JobType",
    "JobStatus",
]
