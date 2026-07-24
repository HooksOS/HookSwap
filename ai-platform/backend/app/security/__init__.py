"""Security layer for the HookSwap AI Knowledge Platform (internal-tools posture).

Three cohesive pieces, each configurable via ``app.core.config.Settings`` env vars:

- :mod:`app.security.auth` — static API-key / bearer endpoint authentication
  (``require_api_key`` dependency; fail-closed; local-dev bypass).
- :mod:`app.security.rate_limit` — per-caller in-process token-bucket limiting
  (``chat_rate_limit`` / ``marketing_rate_limit`` dependencies; 429 + Retry-After).
- :mod:`app.security.injection` — prompt-injection / RAG-poisoning input guard
  (``enforce_input``) + LLM prompt isolation (``wrap_untrusted``,
  ``SYSTEM_HARDENING``).

See ``app/security/SECURITY.md`` for the threat model + residual gaps.
"""
from __future__ import annotations

from app.security.auth import auth_enforced, key_fingerprint, require_api_key
from app.security.injection import (
    SYSTEM_HARDENING,
    InjectionScan,
    enforce_input,
    scan_input,
    wrap_untrusted,
)
from app.security.rate_limit import (
    TokenBucketLimiter,
    caller_key,
    chat_rate_limit,
    marketing_rate_limit,
    rate_limit_dependency,
)

__all__ = [
    "InjectionScan",
    "SYSTEM_HARDENING",
    "TokenBucketLimiter",
    "auth_enforced",
    "caller_key",
    "chat_rate_limit",
    "enforce_input",
    "key_fingerprint",
    "marketing_rate_limit",
    "rate_limit_dependency",
    "require_api_key",
    "scan_input",
    "wrap_untrusted",
]
