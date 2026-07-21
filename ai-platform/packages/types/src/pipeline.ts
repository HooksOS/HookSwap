/**
 * Pipeline stage contracts. The ingestion pipeline is a linear, resumable sequence of stages,
 * each a pure-ish transform over a shared `PipelineContext`.
 */

import type { Chunk, EmbeddedChunk, ExtractedDocument, NormalizedDocument, RawDocument } from './document'
import type { DocumentVersion } from './document'

export type PipelineStageName =
  | 'upload'
  | 'extraction'
  | 'normalization'
  | 'metadata'
  | 'chunking'
  | 'embedding'
  | 'versioning'
  | 'deduplication'
  | 'vector-upsert'
  | 'raw-storage'
  | 'incremental-update'

/** Accumulating state threaded through the pipeline. Later stages read earlier stages' output. */
export interface PipelineContext {
  tenantId: string
  /** correlation id for tracing one document through all stages. */
  runId: string
  raw?: RawDocument
  extracted?: ExtractedDocument
  normalized?: NormalizedDocument
  chunks?: Chunk[]
  embedded?: EmbeddedChunk[]
  version?: DocumentVersion
  /** true when dedup determined the content is unchanged and downstream stages should skip. */
  isDuplicate?: boolean
  /** true for incremental re-ingest of a previously seen document. */
  isIncremental?: boolean
  /** stage timings + notes for observability. */
  trace: Array<{ stage: PipelineStageName; ms: number; note?: string }>
}

/** A single stage. `run` mutates/returns the context; the orchestrator sequences them. */
export interface PipelineStage {
  readonly name: PipelineStageName
  run(ctx: PipelineContext): Promise<PipelineContext>
  /** whether this stage should execute given the current context (e.g. skip on duplicate). */
  shouldRun?(ctx: PipelineContext): boolean
}

export interface PipelineResult {
  runId: string
  documentId?: string
  status: 'ingested' | 'duplicate' | 'skipped' | 'failed'
  version?: number
  chunkCount?: number
  error?: string
  trace: PipelineContext['trace']
}
