/**
 * Embeddings abstraction contract.
 *
 * The ingestion pipeline does NOT own the embedding model — it calls the backend's embeddings
 * abstraction (README: "Embeddings: provider abstraction — OpenAI · Voyage · BGE · Nomic").
 * The pipeline talks to it through this interface, which the `embeddings/` client implements as
 * either a direct in-process provider or an HTTP call to the backend embeddings endpoint.
 */

export interface EmbedRequest {
  /** texts to embed (batched). */
  inputs: string[]
  /** `document` vs `query` — some providers (Nomic/BGE) use task-typed prefixes. */
  inputType?: 'document' | 'query'
  /** override the model; defaults to the client's configured model. */
  model?: string
  tenantId?: string
}

export interface EmbedResponse {
  model: string
  dim: number
  vectors: number[][]
  /** provider token usage, when reported. */
  usageTokens?: number
}

/** The abstraction the pipeline depends on. */
export interface EmbeddingsClient {
  readonly model: string
  readonly dim: number
  embed(req: EmbedRequest): Promise<EmbedResponse>
}
