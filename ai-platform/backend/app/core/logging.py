"""Structured logging via structlog, with optional JSON rendering for prod.

Also exposes a ``bind_context`` helper so request/tenant ids flow into every
log line, and a ``RequestContext`` contextvar used by the API middleware.
"""
from __future__ import annotations

import contextvars
import logging
import sys
from typing import Any

import structlog

from app.core.config import settings

# Correlation context propagated across async tasks.
_request_ctx: contextvars.ContextVar[dict[str, Any]] = contextvars.ContextVar(
    "request_ctx", default={}
)


def bind_request_context(**kwargs: Any) -> None:
    current = dict(_request_ctx.get())
    current.update({k: v for k, v in kwargs.items() if v is not None})
    _request_ctx.set(current)


def clear_request_context() -> None:
    _request_ctx.set({})


def _inject_context(_: Any, __: str, event_dict: dict[str, Any]) -> dict[str, Any]:
    event_dict.update(_request_ctx.get())
    return event_dict


def configure_logging() -> None:
    level = getattr(logging, settings.log_level.upper(), logging.INFO)

    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=level)

    processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        _inject_context,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]
    if settings.log_json or settings.is_production:
        processors.append(structlog.processors.JSONRenderer())
    else:
        processors.append(structlog.dev.ConsoleRenderer())

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(level),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name)
