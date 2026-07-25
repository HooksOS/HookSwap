"""Logger that degrades to stdlib when the app's structlog stack isn't importable.

``app.core.logging`` imports ``app.core.config``, which instantiates pydantic
``Settings`` at import time. ``ingestion/ingest_docs.py`` deliberately runs without
pydantic — it shims settings with a ``SimpleNamespace`` — and has always relied on
the retrieval/embedding layer importing with the standard library alone. Importing
``app.core.logging`` here unconditionally would break that, so it is attempted and
falls back rather than assumed.
"""
from __future__ import annotations

import logging
from typing import Any


class _StdlibShim:
    """Minimal structlog-compatible facade: ``log.info("event", key=value)``."""

    def __init__(self, name: str) -> None:
        self._log = logging.getLogger(name)

    @staticmethod
    def _fmt(event: str, kw: dict[str, Any]) -> str:
        if not kw:
            return event
        return event + " " + " ".join(f"{k}={v}" for k, v in kw.items())

    def debug(self, event: str, **kw: Any) -> None:
        self._log.debug(self._fmt(event, kw))

    def info(self, event: str, **kw: Any) -> None:
        self._log.info(self._fmt(event, kw))

    def warning(self, event: str, **kw: Any) -> None:
        self._log.warning(self._fmt(event, kw))

    def error(self, event: str, **kw: Any) -> None:
        self._log.error(self._fmt(event, kw))


def get_logger(name: str) -> Any:
    try:
        from app.core.logging import get_logger as _app_get_logger

        return _app_get_logger(name)
    except Exception:  # config/structlog unavailable (e.g. the ingestion script)
        return _StdlibShim(name)


__all__ = ["get_logger"]
