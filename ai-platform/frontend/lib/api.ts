/**
 * Typed client for the HookSwap AI Platform backend (FastAPI).
 *
 * Transports:
 *   • REST  — CRUD + admin resources (fetch JSON)
 *   • SSE   — streaming chat (POST /v1/chat/stream → text/event-stream)
 *   • WS    — streaming chat + live job/queue events (NEXT_PUBLIC_WS_BASE_URL)
 *   • GraphQL — knowledge graph / analytics aggregates (/graphql)
 *
 * Every method is real: it hits the backend when reachable. Where the backend
 * is not yet up, callers fall back to lib/mock-data via the hooks so the UI is
 * exercisable. This module never fabricates — it only transports.
 */
import type {
  AdminUser, Agent, AnalyticsOverview, ApiKeyRecord, ChatMessage, Conversation,
  DocumentRecord, JobRecord, LogEntry, Notification, Organization, Project,
  QueueRecord, SearchFilters, SearchResult, StreamEvent, VectorCollection,
} from './types';
import { parseSSE, mockStream } from './streaming';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
const WS_BASE = process.env.NEXT_PUBLIC_WS_BASE_URL || 'ws://localhost:8000';
const GQL_URL = process.env.NEXT_PUBLIC_GRAPHQL_URL || `${API_BASE}/graphql`;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

let authToken: string | null = null;
export function setAuthToken(token: string | null) {
  authToken = token;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (authToken) headers.set('Authorization', `Bearer ${authToken}`);
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, text || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(GQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new ApiError(res.status, `GraphQL ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new ApiError(200, json.errors[0].message);
  return json.data as T;
}

// ── Chat (streaming) ─────────────────────────────────────────────────────────
export interface ChatRequest {
  message: string;
  conversationId?: string;
  assistant?: string;
  chainScope?: number[];
  history?: Pick<ChatMessage, 'role' | 'content'>[];
}

/**
 * Stream a chat completion over SSE. Yields typed StreamEvents. If the backend
 * is unreachable and `opts.mockOnFailure` is set, falls back to a local mock
 * stream so the UI stays functional in isolated dev.
 */
export async function* streamChat(
  req: ChatRequest,
  opts: { signal?: AbortSignal; mockOnFailure?: boolean } = {},
): AsyncGenerator<StreamEvent> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/v1/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify(req),
      signal: opts.signal,
    });
    if (!response.ok || !response.body) throw new ApiError(response.status, 'stream failed');
  } catch (err) {
    if (opts.mockOnFailure) {
      yield* mockStream(req.message);
      return;
    }
    throw err;
  }
  yield* parseSSE(response);
}

/** Open a WebSocket for a chat session (alternative transport to SSE). */
export function openChatSocket(conversationId: string): WebSocket {
  return new WebSocket(`${WS_BASE}/v1/chat/ws?conversation=${encodeURIComponent(conversationId)}`);
}

// ── Conversations / history / bookmarks ─────────────────────────────────────
export const conversations = {
  list: () => request<Conversation[]>('/v1/conversations'),
  get: (id: string) => request<Conversation>(`/v1/conversations/${id}`),
  create: (body: { title?: string; assistant?: string }) =>
    request<Conversation>('/v1/conversations', { method: 'POST', body: JSON.stringify(body) }),
  rename: (id: string, title: string) =>
    request<Conversation>(`/v1/conversations/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
  remove: (id: string) => request<void>(`/v1/conversations/${id}`, { method: 'DELETE' }),
  pin: (id: string, pinned: boolean) =>
    request<Conversation>(`/v1/conversations/${id}`, { method: 'PATCH', body: JSON.stringify({ pinned }) }),
};

export interface Bookmark {
  id: string;
  title: string;
  snippet: string;
  source: string;
  url?: string;
  citationId?: string;
  createdAt: string;
}
export const bookmarks = {
  list: () => request<Bookmark[]>('/v1/bookmarks'),
  add: (b: Omit<Bookmark, 'id' | 'createdAt'>) =>
    request<Bookmark>('/v1/bookmarks', { method: 'POST', body: JSON.stringify(b) }),
  remove: (id: string) => request<void>(`/v1/bookmarks/${id}`, { method: 'DELETE' }),
};

// ── Search ───────────────────────────────────────────────────────────────────
export const search = {
  query: (q: string, filters: SearchFilters = {}) =>
    request<{ results: SearchResult[]; tookMs: number; total: number }>('/v1/search', {
      method: 'POST',
      body: JSON.stringify({ q, ...filters }),
    }),
  suggest: (q: string) => request<string[]>(`/v1/search/suggest?q=${encodeURIComponent(q)}`),
};

// ── Agents ────────────────────────────────────────────────────────────────────
export const agents = {
  list: () => request<Agent[]>('/v1/agents'),
  get: (id: string) => request<Agent>(`/v1/agents/${id}`),
  invoke: (id: string, input: Record<string, unknown>) =>
    request<{ output: unknown }>(`/v1/agents/${id}/invoke`, { method: 'POST', body: JSON.stringify(input) }),
};

// ── Notifications ─────────────────────────────────────────────────────────────
export const notifications = {
  list: () => request<Notification[]>('/v1/notifications'),
  markRead: (id: string) => request<void>(`/v1/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () => request<void>('/v1/notifications/read-all', { method: 'POST' }),
};

// ── Portfolio ─────────────────────────────────────────────────────────────────
export const portfolio = {
  summary: (address: string, chains?: number[]) =>
    request<unknown>(`/v1/portfolio/${address}${chains ? `?chains=${chains.join(',')}` : ''}`),
};

// ── Admin ─────────────────────────────────────────────────────────────────────
export const admin = {
  organizations: () => request<Organization[]>('/v1/admin/organizations'),
  projects: () => request<Project[]>('/v1/admin/projects'),
  users: () => request<AdminUser[]>('/v1/admin/users'),
  documents: () => request<DocumentRecord[]>('/v1/admin/documents'),
  vectors: () => request<VectorCollection[]>('/v1/admin/vectors'),
  jobs: () => request<JobRecord[]>('/v1/admin/jobs'),
  queues: () => request<QueueRecord[]>('/v1/admin/queues'),
  logs: (params?: { level?: string; service?: string }) =>
    request<LogEntry[]>(`/v1/admin/logs${params ? `?${new URLSearchParams(params as Record<string, string>)}` : ''}`),
  apiKeys: () => request<ApiKeyRecord[]>('/v1/admin/api-keys'),
  analytics: () => request<AnalyticsOverview>('/v1/admin/analytics/overview'),
};

export const api = {
  streamChat, openChatSocket, graphql, conversations, bookmarks, search,
  agents, notifications, portfolio, admin, setAuthToken,
};
export default api;
