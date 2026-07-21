/**
 * Document + chunk types that flow through the ingestion pipeline.
 *
 * Lifecycle: RawDocument (bytes) → ExtractedDocument (text + structure) →
 * NormalizedDocument (clean text + metadata) → Chunk[] → EmbeddedChunk[] → vector upsert.
 */

import type { DocumentMetadata } from './metadata'

/** Raw bytes as pulled by a connector, before any extraction. */
export interface RawDocument {
  /** stable id: `${tenantId}:${source}:${sha256(sourceUri)}` or connector-native id. */
  id: string
  /** original file/asset bytes. For remote-only sources this may be fetched lazily. */
  content: Buffer | Uint8Array
  /** MIME type as reported by the connector. */
  mimeType: string
  /** filename or last URI segment (for extension-based routing). */
  filename?: string
  sizeBytes: number
  /** partial metadata known at fetch time; the pipeline fills the rest. */
  metadata: Partial<DocumentMetadata> & Pick<DocumentMetadata, 'tenantId' | 'source' | 'sourceUri'>
}

/** A logical section produced by an extractor (page, heading block, sheet, transcript segment). */
export interface DocumentSection {
  /** heading path, e.g. ['Guides', 'Swapping', 'Slippage']. */
  headingPath: string[]
  text: string
  /** page number (PDF), sheet name (XLSX), start seconds (audio/video), etc. */
  locator?: string
  /** language-tagged code fences keep their language for code-aware chunking. */
  lang?: string
  kind: 'text' | 'code' | 'table' | 'transcript' | 'ocr' | 'heading'
}

/** Output of the extraction stage: text + structure, still source-shaped. */
export interface ExtractedDocument {
  id: string
  /** full concatenated plaintext (fallback for chunkers that ignore sections). */
  text: string
  sections: DocumentSection[]
  metadata: Partial<DocumentMetadata> & Pick<DocumentMetadata, 'tenantId' | 'source' | 'sourceUri'>
  /** extractor-detected MIME/format, may refine RawDocument.mimeType. */
  detectedMime: string
}

/** Output of normalization + metadata stages: clean text with the full metadata set resolved. */
export interface NormalizedDocument {
  id: string
  text: string
  sections: DocumentSection[]
  metadata: DocumentMetadata
  /** sha256 of the normalized text — the deduplication key. */
  contentHash: string
}

/** A retrievable chunk. */
export interface Chunk {
  /** `${documentId}:${chunkIndex}` (stable across re-chunk of the same version). */
  id: string
  documentId: string
  chunkIndex: number
  text: string
  /** token count estimate (for context-budgeting at retrieval time). */
  tokenCount: number
  /** heading path/locator this chunk came from (for citations). */
  headingPath: string[]
  locator?: string
  metadata: DocumentMetadata
  /** sha256 of the chunk text — chunk-level dedup + change detection. */
  contentHash: string
}

/** A chunk with its embedding vector, ready for vector upsert. */
export interface EmbeddedChunk extends Chunk {
  embedding: number[]
  embeddingModel: string
  embeddingDim: number
}

/** A stored version of a document (versioning stage). */
export interface DocumentVersion {
  documentId: string
  /** monotonically increasing version number, starting at 1. */
  version: number
  contentHash: string
  metadata: DocumentMetadata
  /** ISO-8601. */
  createdAt: string
  /** number of chunks in this version. */
  chunkCount: number
  /** S3 key of the raw payload for this version. */
  rawStorageKey: string
  /** true once superseded by a newer version. */
  superseded: boolean
}
