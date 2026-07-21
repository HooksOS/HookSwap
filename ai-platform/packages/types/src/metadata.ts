/**
 * The full document/chunk metadata set for the HookSwap Knowledge Platform.
 *
 * Every ingested chunk carries this metadata so retrieval can filter on
 * chain / protocol / dex / pool / token / contract / version / language / category /
 * tags / author / date / source / risk / status / visibility (README core principle #4).
 */

export type ProtocolVersion = 'v2' | 'v3' | 'v4' | 'universal-router' | 'permit2' | 'unknown'

/** Coarse content category — drives assistant routing and retrieval boosting. */
export type ContentCategory =
  | 'documentation'
  | 'whitepaper'
  | 'guide'
  | 'tutorial'
  | 'api-reference'
  | 'smart-contract'
  | 'abi'
  | 'audit'
  | 'governance'
  | 'blog'
  | 'faq'
  | 'support'
  | 'changelog'
  | 'marketing'
  | 'research'
  | 'chain-data'
  | 'other'

/** Risk classification — surfaced to the risk/trading assistants and used for guardrails. */
export type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical'

/** Lifecycle status of the underlying source document. */
export type DocumentStatus = 'draft' | 'active' | 'deprecated' | 'archived' | 'superseded'

/** Multi-tenant visibility scope for a document/chunk. */
export type Visibility = 'public' | 'internal' | 'tenant' | 'restricted' | 'private'

/** Which connector class produced the source. */
export type SourceType =
  | 'pdf'
  | 'markdown'
  | 'html'
  | 'docx'
  | 'xlsx'
  | 'csv'
  | 'image'
  | 'audio'
  | 'video'
  | 'website'
  | 'github'
  | 'notion'
  | 'gdrive'
  | 'dropbox'
  | 'slack'
  | 'discord'
  | 'telegram'
  | 'rss'
  | 'chain-indexer'
  | 'manual-upload'

/**
 * Canonical metadata attached to every document and propagated to each chunk.
 * Optional fields are left UNSET rather than fabricated (facts-only rule).
 */
export interface DocumentMetadata {
  // --- multi-tenancy ---
  tenantId: string
  projectId?: string

  // --- provenance ---
  source: SourceType
  /** original URI/URL/path/connector ref the document came from. */
  sourceUri: string
  /** connector instance id that produced this (for incremental re-sync). */
  connectorId?: string
  author?: string
  /** ISO-8601 creation date of the underlying content, when known. */
  createdAt?: string
  /** ISO-8601 last-modified date of the underlying content, when known. */
  updatedAt?: string
  /** ISO-8601 time this platform ingested it. */
  ingestedAt: string

  // --- classification ---
  category: ContentCategory
  language: string // ISO-639-1 (e.g. `en`)
  tags: string[]
  title?: string

  // --- web3 / DEX scoping (all optional; only set when the content is chain-scoped) ---
  /** chain ids this document is about (a doc can span multiple chains). */
  chainIds?: number[]
  /** protocol names (e.g. `hookswap`, `uniswap`, `permit2`). */
  protocols?: string[]
  /** DEX name(s) (e.g. `hookswap`). */
  dex?: string[]
  /** protocol version the content pertains to. */
  version?: ProtocolVersion
  /** pool addresses referenced. */
  pools?: string[]
  /** token addresses/symbols referenced. */
  tokens?: string[]
  /** contract addresses referenced. */
  contracts?: string[]

  // --- governance / safety ---
  risk: RiskLevel
  status: DocumentStatus
  visibility: Visibility

  /** free-form extra fields; never used for guardrails, only convenience. */
  extra?: Record<string, string | number | boolean | null>
}

/** Convenience defaults for the always-required metadata fields. */
export const DEFAULT_METADATA: Pick<
  DocumentMetadata,
  'category' | 'language' | 'tags' | 'risk' | 'status' | 'visibility'
> = {
  category: 'other',
  language: 'en',
  tags: [],
  risk: 'none',
  status: 'active',
  visibility: 'tenant',
}
