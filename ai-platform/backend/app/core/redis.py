"""Async Redis client (rate limiting, caching, pub/sub for WS fan-out).

A single lazily-created connection pool is shared process-wide. All callers go
through ``get_redis()`` so the pool is created once and reused.
"""
from __future__ import annotations

import redis.asyncio as aioredis

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_client: aioredis.Redis | None = None


def get_redis() -> aioredis.Redis:
    global _client
    if _client is None:
        _client = aioredis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
            health_check_interval=30,
        )
        logger.info("redis.client.created", url=settings.redis_url)
    return _client


async def ping_redis() -> bool:
    try:
        return bool(await get_redis().ping())
    except Exception as exc:  # noqa: BLE001 - health probe must not raise
        logger.warning("redis.ping.failed", error=str(exc))
        return False


async def close_redis() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
