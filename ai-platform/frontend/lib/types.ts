/**
 * Shared domain types for the HookSwap AI Knowledge Platform frontend.
 * These mirror the backend REST/GraphQL/WS contract (see lib/api.ts).
 */

export type Role = 'user' | 'assistant' | 'system' | 'tool';

export interface Citation {
  id: string;
  index: number; // 1-based marker rendered inline as [n]
  title: string;
  snippet: string;
  url?: string;
  source: string; // e.g. "HookSwap Docs", "Robinhood indexer", "audit.pdf"
  documentId?: string;
  chunkId?: string;
  score: number; // retrieval relevance 0..1
  chain?: number; // chainId if chain-scoped
  protocol?: string;
  type?: string;
  page?: number;
  updatedAt?: string;
}

export interface ToolCall {
  id: string;
  name: string; // e.g. "get_pool_tvl", "chain_indexer.query"
  args: Record<string, unknown>;
  status: 'pending' | 'running' | 'done' | 'error';
  result?: unknown;
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
  citations?: Citation[];
  toolCalls?: ToolCall[];
  confidence?: number; // 0..1 overall answer confidence
  model?: string;
  tokens?: { prompt: number; completion: number };
  latencyMs?: number;
  streaming?: boolean;
  error?: string;
}

export interface Conversation {
  id: string;
  title: string;
  assistant: AssistantKind;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  pinned?: boolean;
  chainScope?: number[];
}

export type AssistantKind =
  | 'general'
  | 'trading'
  | 'developer'
  | 'portfolio'
  | 'support'
  | 'governance';

export interface SearchFilters {
  chains?: number[];
  protocols?: string[];
  types?: string[];
  dateFrom?: string;
  dateTo?: string;
  mode?: 'hybrid' | 'semantic' | 'keyword';
}

export interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  source: string;
  url?: string;
  score: number;
  semanticScore?: number;
  keywordScore?: number;
  chain?: number;
  protocol?: string;
  type?: string;
  updatedAt?: string;
  highlights?: string[];
}

export interface Agent {
  id: string;
  name: string;
  kind: string;
  description: string;
  status: 'online' | 'degraded' | 'offline' | 'training';
  model: string;
  tools: string[];
  successRate: number; // 0..1
  avgLatencyMs: number;
  invocations24h: number;
  costUsd24h: number;
}

// ── Chat streaming wire protocol (SSE / WS events) ──────────────────────────
export type StreamEvent =
  | { type: 'start'; messageId: string; model: string }
  | { type: 'token'; delta: string }
  | { type: 'tool_call'; tool: ToolCall }
  | { type: 'tool_result'; toolCallId: string; result: unknown; status: ToolCall['status'] }
  | { type: 'citation'; citation: Citation }
  | { type: 'confidence'; score: number }
  | { type: 'usage'; tokens: { prompt: number; completion: number }; latencyMs: number }
  | { type: 'done'; messageId: string }
  | { type: 'error'; message: string };

// ── Admin domain ────────────────────────────────────────────────────────────
export interface Organization {
  id: string;
  name: string;
  plan: 'free' | 'team' | 'enterprise';
  seats: number;
  usedSeats: number;
  projects: number;
  monthlySpendUsd: number;
  status: 'active' | 'suspended' | 'trial';
  createdAt: string;
}

export interface Project {
  id: string;
  orgId: string;
  name: string;
  documents: number;
  vectors: number;
  environment: 'production' | 'staging' | 'sandbox';
  createdAt: string;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  org: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  lastActive: string;
  status: 'active' | 'invited' | 'disabled';
}

export interface DocumentRecord {
  id: string;
  title: string;
  source: string;
  type: string;
  chain?: number;
  chunks: number;
  status: 'indexed' | 'processing' | 'failed' | 'queued';
  sizeKb: number;
  updatedAt: string;
}

export interface JobRecord {
  id: string;
  kind: 'ingest' | 'embed' | 'index' | 'agent' | 'chain-sync';
  status: 'queued' | 'running' | 'success' | 'failed' | 'retrying';
  queue: string;
  progress: number;
  startedAt: string;
  durationMs?: number;
  attempts: number;
}

export interface QueueRecord {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  throughputPerMin: number;
  paused: boolean;
}

export interface VectorCollection {
  name: string;
  provider: 'qdrant' | 'pgvector' | 'pinecone';
  vectors: number;
  dims: number;
  indexType: string;
  sizeMb: number;
  chain?: number;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsed?: string;
  status: 'active' | 'revoked';
}

export interface LogEntry {
  id: string;
  ts: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  service: string;
  message: string;
  traceId?: string;
}

export interface TimeSeriesPoint {
  t: string;
  value: number;
}

export interface AnalyticsOverview {
  searches: TimeSeriesPoint[];
  llmCostUsd: TimeSeriesPoint[];
  latencyP95Ms: TimeSeriesPoint[];
  cacheHitRate: TimeSeriesPoint[];
  popularQuestions: { question: string; count: number }[];
  knowledgeGaps: { query: string; misses: number }[];
  chainUsage: { chain: number; queries: number }[];
}

export interface Notification {
  id: string;
  title: string;
  body: string;
  kind: 'system' | 'agent' | 'ingest' | 'billing' | 'security';
  read: boolean;
  createdAt: string;
}
