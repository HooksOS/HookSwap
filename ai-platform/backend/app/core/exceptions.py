"""Domain exception hierarchy + FastAPI exception handlers.

All app errors derive from ``HookSwapAIError`` and carry an HTTP status +
machine-readable ``code`` so the API returns a consistent error envelope.
"""
from __future__ import annotations

from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse


class HookSwapAIError(Exception):
    status_code: int = 500
    code: str = "internal_error"

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


class ConfigurationError(HookSwapAIError):
    status_code = 500
    code = "configuration_error"


class NotFoundError(HookSwapAIError):
    status_code = 404
    code = "not_found"


class ValidationError(HookSwapAIError):
    status_code = 422
    code = "validation_error"


class AuthenticationError(HookSwapAIError):
    status_code = 401
    code = "authentication_error"


class AuthorizationError(HookSwapAIError):
    status_code = 403
    code = "authorization_error"


class RateLimitError(HookSwapAIError):
    status_code = 429
    code = "rate_limited"


class TenantQuotaError(HookSwapAIError):
    status_code = 402
    code = "quota_exceeded"


class ProviderError(HookSwapAIError):
    """Upstream LLM / embedding / vector-store failure."""

    status_code = 502
    code = "provider_error"


class PromptInjectionError(HookSwapAIError):
    status_code = 400
    code = "prompt_injection_blocked"


class GroundingError(HookSwapAIError):
    """Raised when an answer cannot be grounded in retrieved context."""

    status_code = 422
    code = "insufficient_grounding"


def _error_body(exc: HookSwapAIError) -> dict[str, Any]:
    return {
        "error": {
            "code": exc.code,
            "message": exc.message,
            "details": exc.details,
        }
    }


async def hookswap_error_handler(_: Request, exc: HookSwapAIError) -> JSONResponse:
    headers: dict[str, str] | None = None
    # Rate-limit responses advertise a Retry-After (seconds) per HTTP semantics.
    if isinstance(exc, RateLimitError):
        retry_after = exc.details.get("retry_after")
        if retry_after is not None:
            headers = {"Retry-After": str(int(retry_after))}
    return JSONResponse(status_code=exc.status_code, content=_error_body(exc), headers=headers)


async def unhandled_error_handler(_: Request, exc: Exception) -> JSONResponse:
    err = HookSwapAIError(str(exc) or "Unexpected error")
    return JSONResponse(status_code=500, content=_error_body(err))


def install_exception_handlers(app: Any) -> None:
    app.add_exception_handler(HookSwapAIError, hookswap_error_handler)
    app.add_exception_handler(Exception, unhandled_error_handler)
