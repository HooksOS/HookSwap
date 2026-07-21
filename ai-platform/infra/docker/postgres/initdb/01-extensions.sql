-- HookSwap AI Platform — DB bootstrap (runs once on first postgres init).
-- pgvector is the embeddings fallback store (Qdrant is primary).
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- trigram search for hybrid/keyword fallback
CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- API-key hashing / gen_random_uuid
