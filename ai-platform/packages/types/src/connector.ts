/**
 * The common Connector interface. Every source (files, web, SaaS) implements this so the
 * pipeline and workers treat all sources uniformly, and auto-sync scheduling is generic.
 */

import type { RawDocument } from './document'
import type { DocumentMetadata, SourceType } from './metadata'

/** A cursor for incremental sync (connector-defined opaque token: timestamp, page token, git sha). */
export type SyncCursor = string | null

/** Config every connector instance carries (persisted per tenant). */
export interface ConnectorConfig {
  /** unique id for this configured source instance. */
  id: string
  tenantId: string
  projectId?: string
  type: SourceType
  /** display label. */
  name: string
  /** connector-specific settings (repo url, drive folder id, channel id, credentials ref…). */
  settings: Record<string, unknown>
  /** secret reference (vault path / env key) — NEVER the raw secret in config. */
  secretRef?: string
  /** default metadata applied to everything this connector produces. */
  defaultMetadata?: Partial<DocumentMetadata>
  /** auto-sync schedule (cron expression) or null for manual-only. */
  schedule?: string | null
  enabled: boolean
}

/** One item discovered by a connector, before its bytes are fetched. */
export interface SourceRecord {
  /** connector-native id (git path, file id, message id…). */
  externalId: string
  sourceUri: string
  /** last-modified (ISO-8601) if the connector exposes it — drives incremental skip. */
  updatedAt?: string
  /** content hash/etag if cheaply available — lets us skip unchanged items pre-fetch. */
  etag?: string
  title?: string
  mimeType?: string
  sizeBytes?: number
  /** connector-specific metadata hints merged into the document metadata. */
  metadataHints?: Partial<DocumentMetadata>
}

/** Result of a connector sync pass. */
export interface SyncResult {
  connectorId: string
  discovered: number
  fetched: number
  skipped: number
  errors: number
  /** cursor to persist for the next incremental pass. */
  nextCursor: SyncCursor
  startedAt: string
  finishedAt: string
}

/**
 * The Connector contract. Implementations live in `ingestion/connectors/`.
 * `list` enumerates (cheap, cursor-based); `fetch` pulls the bytes for one record.
 */
export interface Connector {
  readonly type: SourceType
  readonly config: ConnectorConfig

  /** Verify credentials/reachability. Throws or returns a structured failure. */
  validate(): Promise<{ ok: boolean; detail?: string }>

  /**
   * Enumerate source records changed since `cursor` (or all when cursor is null).
   * Yields batches so large sources stream rather than buffer.
   */
  list(cursor: SyncCursor): AsyncIterable<SourceRecord[]>

  /** Fetch the raw bytes + resolved metadata for a single discovered record. */
  fetch(record: SourceRecord): Promise<RawDocument>

  /** Compute the next cursor after a completed pass (e.g. max updatedAt seen). */
  advanceCursor(previous: SyncCursor, seen: SourceRecord[]): SyncCursor
}
