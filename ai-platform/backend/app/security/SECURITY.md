# Security layer — HookSwap AI Knowledge Platform (backend)

**Posture: internal-tools.** This platform is a HookSwap **team** tool, not a
public product (per the project mandate). The controls here are real —
authentication, per-caller rate limiting, and prompt-injection / RAG-poisoning
defense — but scoped to an internal threat model, not public-scale SOC2. All of
it is env-driven via `app/core/config.py` (`Settings`, prefix `HOOKSWAP_AI_`) and
fails **closed** in production.

## Threat model (what this defends against)

- Unauthenticated access to the RAG/chat + marketing endpoints from anyone who
  can reach the host (the app should also sit behind internal network / VPN).
- A single caller (buggy script, runaway loop, or one compromised key) hammering
  the expensive LLM/RAG endpoints.
- Prompt injection in user input and **RAG poisoning** — instructions embedded in
  ingested documents trying to hijack the model, exfiltrate the system prompt, or
  override the facts-only rules.

Out of scope (accepted for an internal tool): per-user identity/audit at SOC2
depth, defeating a determined adversary's novel jailbreak, secrets management
beyond env vars, WAF/DDoS.

## 1. Endpoint authentication — `app/security/auth.py`

- Static **API-key set**, presented as `Authorization: Bearer <key>` **or**
  `X-API-Key: <key>`. Compared in **constant time** (`hmac.compare_digest`) across
  all configured keys (no early-return timing leak).
- Applied as a **router-level dependency** (`require_api_key`) on the chat + marketing
  routers in `app/main.py`. `/health` and `/` stay open (not on those routers).
  Any future WS/GraphQL router mounts the same dependency — none exist today.
- On success sets `request.state.principal` = a non-reversible key fingerprint
  (`key_<sha256[:12]>`); the secret is never logged.
- **Fail-closed:**
  - Production **always** enforces auth — `AUTH_DISABLED` is ignored there.
  - Enforcing with **no keys configured** ⇒ deny. Production raises
    `ConfigurationError` (500, loud, refuses to serve); dev returns 401 naming the
    escape hatch.
  - Local-dev bypass: `HOOKSWAP_AI_AUTH_DISABLED=true` (defaults `false`).
- Config: `HOOKSWAP_AI_API_KEYS` (CSV), `HOOKSWAP_AI_AUTH_DISABLED`.

## 2. Rate limiting — `app/security/rate_limit.py`

- **In-process token bucket**, per caller. Caller = authenticated principal
  (API-key fingerprint), or client IP (respecting one `X-Forwarded-For` hop) when
  auth is disabled. Dependency-light on purpose — no Redis in the request path.
- Capacity (burst) = the per-minute budget, refilled continuously; thread-safe
  (sync deps run in FastAPI's threadpool). Idle buckets are pruned; a hard cap
  bounds memory.
- Exceeding the budget raises `RateLimitError` → **429** with a **`Retry-After`**
  header (wired in `app/core/exceptions.py`).
- Applied as router dependencies: `chat_rate_limit`, `marketing_rate_limit`.
- Config: `RATE_LIMIT_ENABLED`, `RATE_LIMIT_CHAT_PER_MIN` (30),
  `RATE_LIMIT_MARKETING_PER_MIN` (15), `RATE_LIMIT_DEFAULT_PER_MIN` (60).

## 3. Prompt-injection / RAG-poisoning defense — `app/security/injection.py`

Three deterministic, auditable layers (no ML classifier — pragmatic by design):

1. **Input guard** (`enforce_input`) on the chat path (`app/api/rest/chat.py`,
   both `/v1/chat` and `/v1/chat/stream`) and the marketing brief
   (`marketing_assistant.draft`, non-raising there): length cap, NFKC-fold +
   control-char strip (defeats fullwidth/homoglyph evasion — verified), and a
   pattern scan for instruction-override, system-prompt exfiltration, role
   override / jailbreak, rule-nullification, and chat-template injection
   (`<|im_start|>`, `[INST]`, `### system`, …). High-severity match ⇒ **400**
   `PromptInjectionError` (or sanitize+warn when `INJECTION_BLOCK_ON_MATCH=false`).
2. **Prompt isolation** — when the LLM prompt is assembled, retrieved SOURCES and
   the user QUESTION are fenced in `<<UNTRUSTED>> … <</UNTRUSTED>>` markers
   (`wrap_untrusted`, which also neutralizes forged markers inside a poisoned
   doc so it can't "break out"). The system prompt carries `SYSTEM_HARDENING`
   telling the model that fenced content is **data, never instructions**, and to
   refuse rule-override / prompt-exfil attempts. Wired into `rag/engine.py`
   (`SYSTEM_PROMPT`, `_build_user_prompt`) and `marketing_assistant.py`
   (`BRAND_SYSTEM`, `_build_user_prompt`).
3. **Defense in depth** — reinforces (does not replace) the existing facts-only
   system prompt and the marketing `guardrails.py` compliance scan.
- Config: `INJECTION_GUARD_ENABLED`, `INJECTION_MAX_INPUT_CHARS` (8000),
  `INJECTION_BLOCK_ON_MATCH` (true).

## Residual gaps (honest)

- **Static shared keys**, not per-user identity. No rotation automation, no
  per-key scopes/quotas, no request audit log. Rotate `HOOKSWAP_AI_API_KEYS` out
  of band. Fine for a small internal team; revisit if usage grows.
- **Rate limiter is per-process, in-memory.** Correct for the current single
  replica. If the backend is scaled horizontally, buckets are per-replica (limits
  effectively multiply) and reset on restart — move to Redis (already wired) then.
- **Injection defense is regex + prompt isolation**, not a classifier. It stops
  casual/known-pattern injection and frames poisoned docs as data, but cannot
  guarantee defeat of a novel/obfuscated adversarial jailbreak. Keep ingestion
  sources trusted; the isolation layer is the backstop, not a guarantee.
- **CORS** currently allows `*` methods/headers for the configured origins with
  credentials — tighten origins for production.
- No secrets manager / KMS — keys live in env. No output-side PII/secret scanning
  on model responses (grounding is trusted internal docs).
- WS / GraphQL routers are referenced in the mandate but **not present** in the
  code today; when added, mount `require_api_key` + a rate-limit dependency the
  same way `main.py` does for REST.
