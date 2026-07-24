"""Per-caller rate limiting — in-process token bucket.

Dependency-light by design: an internal single-process tool does not need Redis
in the request path (Redis is still wired for other uses). Buckets are keyed by
the authenticated principal (API-key fingerprint) or, when auth is disabled, the
client IP. Exceeding the budget raises :class:`RateLimitError` (429) carrying a
``retry_after`` — the exception handler emits the ``Retry-After`` header.

Apply :func:`chat_rate_limit` / :func:`marketing_rate_limit` as router-level
dependencies. Budgets are configurable (``rate_limit_*`` settings). Capacity
(burst) equals the per-minute value, refilled continuously.

Thread-safe: FastAPI runs sync dependencies in a threadpool, so bucket mutation
is guarded by a lock. Memory is bounded by opportunistic pruning of idle buckets.
"""
from __future__ import annotations

import math
import threading
import time
from dataclasses import dataclass
from typing import Callable

from fastapi import Request

from app.core.config import Settings
from app.core.config import settings as global_settings
from app.core.exceptions import RateLimitError
from app.core.logging import get_logger

log = get_logger("security.rate_limit")

_MAX_BUCKETS = 50_000  # hard cap; prune before we ever approach this
_PRUNE_EVERY = 2_000  # attempt a prune every N checks


@dataclass
class _Bucket:
    tokens: float
    updated: float


class TokenBucketLimiter:
    """A classic token bucket keyed by an arbitrary string (caller id)."""

    def __init__(
        self,
        rate_per_min: int,
        *,
        burst: int | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.rate_per_min = max(int(rate_per_min), 1)
        self.refill_per_sec = self.rate_per_min / 60.0
        self.capacity = float(burst if burst is not None else self.rate_per_min)
        self._clock = clock
        self._buckets: dict[str, _Bucket] = {}
        self._lock = threading.Lock()
        self._checks = 0

    def _prune_locked(self, now: float) -> None:
        # Drop buckets that have fully refilled (idle >= capacity/rate seconds).
        if len(self._buckets) < _PRUNE_EVERY:
            return
        idle_after = self.capacity / self.refill_per_sec
        stale = [k for k, b in self._buckets.items() if now - b.updated > idle_after]
        for k in stale:
            del self._buckets[k]
        # Absolute safety valve: if still enormous, clear (fresh full buckets).
        if len(self._buckets) > _MAX_BUCKETS:
            self._buckets.clear()

    def check(self, key: str) -> tuple[bool, float]:
        """Consume one token for ``key``. Returns (allowed, retry_after_seconds)."""
        now = self._clock()
        with self._lock:
            self._checks += 1
            if self._checks % _PRUNE_EVERY == 0:
                self._prune_locked(now)

            b = self._buckets.get(key)
            if b is None:
                b = _Bucket(tokens=self.capacity, updated=now)
                self._buckets[key] = b
            else:
                elapsed = now - b.updated
                b.tokens = min(self.capacity, b.tokens + elapsed * self.refill_per_sec)
                b.updated = now

            if b.tokens >= 1.0:
                b.tokens -= 1.0
                return True, 0.0
            retry_after = (1.0 - b.tokens) / self.refill_per_sec
            return False, retry_after


def caller_key(request: Request) -> str:
    """Identify the caller: authenticated principal, else client IP."""
    principal = getattr(request.state, "principal", None)
    if principal:
        return f"principal:{principal}"
    client = request.client
    ip = client.host if client else "unknown"
    # Honour a single proxy hop if present (nginx sets X-Forwarded-For).
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        ip = fwd.split(",")[0].strip() or ip
    return f"ip:{ip}"


# Registry of named limiters so buckets persist across requests and rebuild only
# when the configured per-minute budget changes.
_LIMITERS: dict[str, TokenBucketLimiter] = {}
_REGISTRY_LOCK = threading.Lock()


def _get_limiter(name: str, per_min: int) -> TokenBucketLimiter:
    with _REGISTRY_LOCK:
        existing = _LIMITERS.get(name)
        if existing is None or existing.rate_per_min != max(int(per_min), 1):
            existing = TokenBucketLimiter(per_min)
            _LIMITERS[name] = existing
        return existing


def _current_settings(request: Request) -> Settings:
    return getattr(request.app.state, "settings", global_settings)


def rate_limit_dependency(
    name: str, per_min_of: Callable[[Settings], int]
) -> Callable[[Request], None]:
    """Build a FastAPI dependency enforcing a named per-caller budget."""

    def _dependency(request: Request) -> None:
        settings = _current_settings(request)
        if not settings.rate_limit_enabled:
            return
        per_min = per_min_of(settings)
        limiter = _get_limiter(name, per_min)
        key = caller_key(request)
        allowed, retry_after = limiter.check(key)
        if not allowed:
            secs = max(1, math.ceil(retry_after))
            log.warning("rate_limited", limiter=name, caller=key, retry_after=secs)
            raise RateLimitError(
                f"Rate limit exceeded ({per_min}/min). Retry in ~{secs}s.",
                details={"retry_after": secs, "limit_per_min": per_min},
            )

    return _dependency


# Concrete per-endpoint dependencies (import these into main.py).
chat_rate_limit = rate_limit_dependency("chat", lambda s: s.rate_limit_chat_per_min)
marketing_rate_limit = rate_limit_dependency(
    "marketing", lambda s: s.rate_limit_marketing_per_min
)


__all__ = [
    "TokenBucketLimiter",
    "caller_key",
    "chat_rate_limit",
    "marketing_rate_limit",
    "rate_limit_dependency",
]
