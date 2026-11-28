"""Exception types and the REL-01 error-code registry for the AI service.

Roadmap-aligned codes are the only values exposed to clients. Old class names
are kept as aliases so existing callers and tests keep working. Raw provider
errors are never forwarded: only the bounded, documented codes and fixed
messages below reach the wire.

``error_codes.py`` is the designated shared registry for this slice. It is not
in this task's edit scope, so the canonical table lives here for now and is
re-exported under the registry-friendly names (``AiErrorCode``, ``ERROR_SPECS``,
``build_error_payload``). Handlers elsewhere can import those names from this
module without changing existing imports.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from fastapi import HTTPException


class AiErrorCode(str, Enum):
    """The nine stable codes from REL-01 of the engineering roadmap."""

    VALIDATION_ERROR = "VALIDATION_ERROR"
    INSUFFICIENT_CREDITS = "INSUFFICIENT_CREDITS"
    OPERATION_CONFLICT = "OPERATION_CONFLICT"
    RATE_LIMITED = "RATE_LIMITED"
    PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE"
    PROVIDER_TIMEOUT = "PROVIDER_TIMEOUT"
    INVALID_AI_OUTPUT = "INVALID_AI_OUTPUT"
    OPERATION_UNKNOWN = "OPERATION_UNKNOWN"
    INTERNAL_ERROR = "INTERNAL_ERROR"


class ErrorSpec:
    """Fixed, non-interpolated wire data for one error code."""

    __slots__ = ("status_code", "message", "retryable")

    def __init__(self, status_code: int, message: str, retryable: bool):
        self.status_code = status_code
        self.message = message
        self.retryable = retryable


# Relationship to the legacy local 429 variants (CONCURRENCY_LIMITED,
# BUDGET_EXCEEDED): those are canonicalized to RATE_LIMITED on the wire. They
# are intentionally NOT codes in AiErrorCode, because the gateway's error-code
# allowlist only accepts these nine values. Their specific cause is logged by
# the raising guard, never serialized as an extra client-visible subcode.
ERROR_SPECS: dict[AiErrorCode, ErrorSpec] = {
    AiErrorCode.VALIDATION_ERROR: ErrorSpec(400, "Invalid request", False),
    AiErrorCode.INSUFFICIENT_CREDITS: ErrorSpec(403, "Not enough credits", False),
    AiErrorCode.OPERATION_CONFLICT: ErrorSpec(409, "Operation conflict", False),
    AiErrorCode.RATE_LIMITED: ErrorSpec(429, "Rate limit exceeded", True),
    AiErrorCode.PROVIDER_UNAVAILABLE: ErrorSpec(
        503, "AI service temporarily unavailable", True
    ),
    AiErrorCode.PROVIDER_TIMEOUT: ErrorSpec(
        504, "AI service did not respond in time", True
    ),
    AiErrorCode.INVALID_AI_OUTPUT: ErrorSpec(
        502, "AI returned an invalid response", False
    ),
    AiErrorCode.OPERATION_UNKNOWN: ErrorSpec(
        503, "Operation state is unknown; retry deliberately", False
    ),
    AiErrorCode.INTERNAL_ERROR: ErrorSpec(500, "Internal server error", False),
}

# Alias for callers that use the enum's unqualified name.
ErrorCode = AiErrorCode


def build_error_payload(
    code: AiErrorCode | str,
    *,
    detail: str | None = None,
    request_id: Optional[str] = None,
    retry_after: Optional[int] = None,
) -> dict[str, Any]:
    """Build a complete, safe error body for a registered code.

    ``detail`` is retained for backwards compatibility with existing contract
    tests. It is only used when it matches the code's fixed message; all other
    caller text is discarded. ``error_code`` and ``error`` carry the canonical
    code, fixed message and retryability for new clients. No value in this
    payload is derived from a provider exception string.
    """
    spec = ERROR_SPECS[AiErrorCode(code)]
    message = spec.message
    if detail is not None and detail == message:
        # Preserve the exact legacy detail strings used by existing tests.
        message = detail

    error: dict[str, Any] = {
        "code": spec.name if isinstance(spec, Enum) else code,
        "message": message,
        "retryable": spec.retryable,
    }
    if request_id:
        error["requestId"] = request_id

    payload: dict[str, Any] = {
        "detail": message,
        "error_code": code.value if isinstance(code, AiErrorCode) else str(code),
        "error": error,
    }
    if retry_after is not None:
        payload["retry_after"] = retry_after
    return payload


class AIServiceException(HTTPException):
    """Base class for every AI-service error returned to a client.

    ``code`` is the canonical REL-01 code; ``error_code`` stays as the legacy
    attribute name used by existing callers and tests.
    """

    def __init__(
        self,
        status_code: int,
        detail: str,
        code: Optional[AiErrorCode | str] = None,
        retry_after: Optional[int] = None,
        error_code: Optional[str] = None,
    ):
        super().__init__(status_code=status_code, detail=detail)
        # Prefer the explicit registry code; fall back to the legacy keyword so
        # subclasses and direct callers keep working unchanged.
        resolved = code if code is not None else error_code
        self.code = AiErrorCode(resolved) if resolved is not None else None
        self.error_code = self.code.value if self.code is not None else None
        self.retry_after = retry_after

    def payload(self, request_id: Optional[str] = None) -> dict[str, Any]:
        """Return the safe wire body; never includes exception arguments."""
        if self.code is None:
            return build_error_payload(AiErrorCode.INTERNAL_ERROR)
        return build_error_payload(
            self.code,
            detail=str(self.detail),
            request_id=request_id,
            retry_after=self.retry_after,
        )


def _registry_exception(
    code: AiErrorCode, detail: Optional[str] = None, **kwargs: Any
) -> AIServiceException:
    """Construct from the registry so status and message cannot drift."""
    spec = ERROR_SPECS[code]
    return AIServiceException(
        status_code=spec.status_code,
        detail=detail if detail is not None else spec.message,
        code=code,
        **kwargs,
    )


# --- Validation ---------------------------------------------------------------

class ValidationException(AIServiceException):
    """Request payload failed schema validation."""

    def __init__(self, detail: Optional[str] = None):
        super().__init__(
            status_code=ERROR_SPECS[AiErrorCode.VALIDATION_ERROR].status_code,
            detail=detail or ERROR_SPECS[AiErrorCode.VALIDATION_ERROR].message,
            code=AiErrorCode.VALIDATION_ERROR,
        )


# --- Auth ---------------------------------------------------------------------
# The nine-code registry has no AUTH code. Invalid credentials are a validation
# failure at this service boundary; the gateway owns user-facing auth errors.

class UnauthorizedException(AIServiceException):
    def __init__(self, detail: Optional[str] = None):
        super().__init__(
            status_code=401,
            detail=detail or "Invalid API key",
            code=AiErrorCode.VALIDATION_ERROR,
        )


# --- Rate, concurrency, budget -----------------------------------------------

class RateLimitExceededException(AIServiceException):
    """Per-feature rate limit hit."""

    def __init__(
        self,
        detail: Optional[str] = None,
        retry_after: Optional[int] = None,
    ):
        super().__init__(
            status_code=ERROR_SPECS[AiErrorCode.RATE_LIMITED].status_code,
            detail=detail or ERROR_SPECS[AiErrorCode.RATE_LIMITED].message,
            code=AiErrorCode.RATE_LIMITED,
            retry_after=retry_after,
        )


class ConcurrencyLimitExceededException(AIServiceException):
    """Too many concurrent billable requests; canonicalized to RATE_LIMITED."""

    def __init__(self, detail: Optional[str] = None):
        super().__init__(
            status_code=ERROR_SPECS[AiErrorCode.RATE_LIMITED].status_code,
            detail=detail or ERROR_SPECS[AiErrorCode.RATE_LIMITED].message,
            code=AiErrorCode.RATE_LIMITED,
        )


class BudgetExceededException(AIServiceException):
    """Daily token budget exhausted; canonicalized to RATE_LIMITED."""

    def __init__(self, detail: Optional[str] = None):
        super().__init__(
            status_code=ERROR_SPECS[AiErrorCode.RATE_LIMITED].status_code,
            detail=detail or ERROR_SPECS[AiErrorCode.RATE_LIMITED].message,
            code=AiErrorCode.RATE_LIMITED,
        )


# --- Provider -----------------------------------------------------------------

class ProviderUnavailableException(AIServiceException):
    """Upstream LLM provider is unreachable or returned an unrecoverable error."""

    def __init__(self, detail: Optional[str] = None):
        super().__init__(
            status_code=ERROR_SPECS[AiErrorCode.PROVIDER_UNAVAILABLE].status_code,
            detail=detail
            or ERROR_SPECS[AiErrorCode.PROVIDER_UNAVAILABLE].message,
            code=AiErrorCode.PROVIDER_UNAVAILABLE,
        )


class ProviderTimeoutException(AIServiceException):
    """Upstream LLM provider exceeded its deadline."""

    def __init__(self, detail: Optional[str] = None):
        super().__init__(
            status_code=ERROR_SPECS[AiErrorCode.PROVIDER_TIMEOUT].status_code,
            detail=detail or ERROR_SPECS[AiErrorCode.PROVIDER_TIMEOUT].message,
            code=AiErrorCode.PROVIDER_TIMEOUT,
        )


class OperationUnknownException(AIServiceException):
    """A partially streamed operation ended without a definitive result."""

    def __init__(self, detail: Optional[str] = None):
        super().__init__(
            status_code=ERROR_SPECS[AiErrorCode.OPERATION_UNKNOWN].status_code,
            detail=detail or ERROR_SPECS[AiErrorCode.OPERATION_UNKNOWN].message,
            code=AiErrorCode.OPERATION_UNKNOWN,
        )


class InternalErrorException(AIServiceException):
    """Unexpected server error; callers must never see its original cause."""

    def __init__(self, detail: Optional[str] = None):
        super().__init__(
            status_code=ERROR_SPECS[AiErrorCode.INTERNAL_ERROR].status_code,
            detail=detail or ERROR_SPECS[AiErrorCode.INTERNAL_ERROR].message,
            code=AiErrorCode.INTERNAL_ERROR,
        )


class InvalidAIOutputException(AIServiceException):
    """Provider output did not match the expected schema."""

    def __init__(self, detail: Optional[str] = None):
        super().__init__(
            status_code=ERROR_SPECS[AiErrorCode.INVALID_AI_OUTPUT].status_code,
            detail=detail or ERROR_SPECS[AiErrorCode.INVALID_AI_OUTPUT].message,
            code=AiErrorCode.INVALID_AI_OUTPUT,
        )


# --- Backwards-compatible aliases --------------------------------------------
# Existing code and tests import these names; keep them pointing at the new
# roadmap-aligned types so behaviour is preserved without duplicating classes.

LLMUnavailableException = ProviderUnavailableException
RateLimitExceededException = RateLimitExceededException  # noqa: F811 — intentional alias

__all__ = [
    "AiErrorCode",
    "ErrorCode",
    "ERROR_SPECS",
    "build_error_payload",
    "AIServiceException",
    "ValidationException",
    "UnauthorizedException",
    "RateLimitExceededException",
    "ConcurrencyLimitExceededException",
    "BudgetExceededException",
    "ProviderUnavailableException",
    "ProviderTimeoutException",
    "OperationUnknownException",
    "InternalErrorException",
    "InvalidAIOutputException",
    "LLMUnavailableException",
]
