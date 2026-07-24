"""Endpoint authentication — internal static API-key / bearer-token guard.

Internal-tools posture: a *set* of shared static keys (rotated by ops), presented
as either ``Authorization: Bearer <key>`` or ``X-API-Key: <key>``. Keys are
compared in constant time. This is deliberately NOT a public-scale identity
system (no per-user JWT/OAuth) — it gates the platform to the HookSwap team.

Wiring: apply :func:`require_api_key` as a router-level dependency on every
non-public router (REST chat, marketing, and any future WS/GraphQL router).
``/health`` + ``/`` stay open by NOT carrying the dependency.

Fail-closed contract:
- Production always enforces auth (``auth_disabled`` is ignored there).
- Enforcing with **no keys configured** => deny. In production that is a
  :class:`ConfigurationError` (500, loud) because serving would be wide open;
  elsewhere a 401 that documents the local-dev escape hatch.
- Local dev may bypass entirely with ``HOOKSWAP_AI_AUTH_DISABLED=true``.
"""
from __future__ import annotations

import hashlib
import hmac
from typing import Optional

from fastapi import Request

from app.core.config import Settings
from app.core.config import settings as global_settings
from app.core.exceptions import AuthenticationError, ConfigurationError
from app.core.logging import get_logger

log = get_logger("security.auth")

_BEARER_PREFIX = "bearer "


def _current_settings(request: Request) -> Settings:
    """Prefer settings stashed on app.state (test override), else the singleton."""
    return getattr(request.app.state, "settings", global_settings)


def auth_enforced(settings: Settings) -> bool:
    """Whether endpoint auth is actively enforced for this environment."""
    if settings.is_production:
        return True  # never allow auth to be disabled in production
    return not settings.auth_disabled


def _extract_key(request: Request) -> Optional[str]:
    auth = request.headers.get("authorization")
    if auth and auth.lower().startswith(_BEARER_PREFIX):
        token = auth[len(_BEARER_PREFIX):].strip()
        return token or None
    xkey = request.headers.get("x-api-key")
    if xkey:
        return xkey.strip() or None
    return None


def key_fingerprint(key: str) -> str:
    """Short, non-reversible id for logging / rate-limit keying (never the secret)."""
    return "key_" + hashlib.sha256(key.encode("utf-8")).hexdigest()[:12]


def _match_key(candidate: str, keys: list[str]) -> Optional[str]:
    """Constant-time compare against every configured key. Returns the matched key.

    Iterates over ALL keys (no early return) so the comparison time does not leak
    which/whether a key matched.
    """
    matched: Optional[str] = None
    for k in keys:
        if hmac.compare_digest(candidate, k):
            matched = k
    return matched


def require_api_key(request: Request) -> str:
    """FastAPI dependency: authenticate the caller, returning a principal id.

    Sets ``request.state.principal`` (used by the rate limiter to key buckets).
    Raises :class:`AuthenticationError` (401) / :class:`ConfigurationError` (500).
    """
    settings = _current_settings(request)

    if not auth_enforced(settings):
        request.state.principal = "dev-anon"
        return "dev-anon"

    keys = list(settings.api_keys or [])
    if not keys:
        # Enforcing but nothing to check against => fail closed.
        log.error("auth_no_keys_configured", env=settings.env)
        if settings.is_production:
            raise ConfigurationError(
                "Endpoint auth is enabled but no API keys are configured "
                "(set HOOKSWAP_AI_API_KEYS). Refusing to serve."
            )
        raise AuthenticationError(
            "No API keys configured. Set HOOKSWAP_AI_API_KEYS, or "
            "HOOKSWAP_AI_AUTH_DISABLED=true for local development."
        )

    candidate = _extract_key(request)
    if not candidate:
        raise AuthenticationError(
            "Missing API key. Send 'Authorization: Bearer <key>' or 'X-API-Key: <key>'."
        )

    matched = _match_key(candidate, keys)
    if matched is None:
        log.warning("auth_invalid_key", fingerprint=key_fingerprint(candidate))
        raise AuthenticationError("Invalid API key.")

    principal = key_fingerprint(matched)
    request.state.principal = principal
    return principal


__all__ = ["auth_enforced", "key_fingerprint", "require_api_key"]
