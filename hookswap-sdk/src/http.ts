/**
 * Minimal typed `fetch` helper shared by the `data` (indexer) and `swap` (trading adapter)
 * modules. Mirrors the terminal clients' behavior exactly:
 *   - a network-level failure (offline / DNS / CORS / timeout) throws HttpApiError{unreachable:true}
 *   - a non-2xx response throws HttpApiError{status}
 *   - never fabricates a body.
 */
import { HttpApiError } from './errors.js'

const DEFAULT_TIMEOUT_MS = 10_000

export type QueryParams = Record<string, string | number | boolean | undefined>

function buildUrl(base: string, path: string, params?: QueryParams): string {
  const url = new URL(base.replace(/\/+$/, '') + path)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') {
        url.searchParams.set(k, String(v))
      }
    }
  }
  return url.toString()
}

export interface FetchOptions {
  params?: QueryParams
  signal?: AbortSignal
  timeoutMs?: number
  /** POST body (JSON). When set, the request method is POST. */
  body?: unknown
}

export async function httpJson<T>(base: string, path: string, opts: FetchOptions = {}): Promise<T> {
  const { params, signal, timeoutMs = DEFAULT_TIMEOUT_MS, body } = opts
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  const init: RequestInit = { signal: controller.signal }
  if (body !== undefined) {
    init.method = 'POST'
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }

  let res: Response
  try {
    res = await fetch(buildUrl(base, path, params), init)
  } catch (e) {
    clearTimeout(timer)
    throw new HttpApiError(e instanceof Error ? e.message : 'HookSwap API unreachable', { unreachable: true })
  }
  clearTimeout(timer)

  if (!res.ok) {
    let detail = ''
    let errorCode: string | undefined
    try {
      const text = await res.text()
      detail = text
      // Trading-API-shaped error bodies are `{ errorCode, detail }`.
      try {
        const parsed = JSON.parse(text) as { errorCode?: string; detail?: string }
        if (parsed && typeof parsed === 'object') {
          errorCode = parsed.errorCode
          if (parsed.detail) {
            detail = parsed.detail
          }
        }
      } catch {
        /* body isn't JSON — keep the raw text */
      }
    } catch {
      /* ignore body read errors */
    }
    throw new HttpApiError(detail || `HookSwap API responded ${res.status}`, { status: res.status, errorCode })
  }

  return (await res.json()) as T
}
