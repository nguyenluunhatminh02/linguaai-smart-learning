"""Exception types for the AI service.

Roadmap-aligned error codes are exposed to clients; old names are kept as
aliases so existing callers and tests keep working. Raw provider errors are
never forwarded: only the bounded, documented codes below reach the wire.
"""

from __future__ import annotations

from typing import Optional

from fastapi import HTTPException


class AIServiceException(HTTPException):
    """Base class for every AI-service error returned to a client."""

    def __init__(
        self,
        status_code: int,
        detail: str,
        error_code: Optional[str] = None,
    ):
        super().__init__(status_code=status_code, detail=detail)
        self.error_code = error_code


# --- Validation ---------------------------------------------------------------

class ValidationException(AIServiceException):
    """Request payload failed schema validation."""

    def __init__(self, detail: str = "Invalid request"):
        super().__init__(status_code=400, detail=detail, error_code="VALIDATION_ERROR")


# --- Auth ---------------------------------------------------------------------

class UnauthorizedException(AIServiceException):
    def __init__(self, detail: str = "Invalid or missing API key"):
        super().__init__(status_code=401, detail=detail, error_code="UNAUTHORIZED")


# --- Rate, concurrency, budget -----------------------------------------------

class RateLimitExceededException(AIServiceException):
    """Per-feature rate limit hit."""

    def __init__(self, detail: str = "Rate limit exceeded", retry_after: Optional[int] = None):
        super().__init__(status_code=429, detail=detail, error_code="RATE_LIMITED")
        self.retry_after = retry_after


class ConcurrencyLimitExceededException(AIServiceException):
    """Too many concurrent billable requests for this user or globally."""

    def __init__(self, detail: str = "Too many concurrent requests"):
        super().__init__(status_code=429, detail=detail, error_code="CONCURRENCY_LIMITED")


class BudgetExceededException(AIServiceException):
    """Daily token budget exhausted."""

    def __init__(self, detail: str = "Daily AI budget exceeded"):
        super().__init__(status_code=429, detail=detail, error_code="BUDGET_EXCEEDED")


# --- Provider -----------------------------------------------------------------

class ProviderUnavailableException(AIServiceException):
    """Upstream LLM provider is unreachable or returned an unrecoverable error."""

    def __init__(self, detail: str = "AI service temporarily unavailable"):
        super().__init__(status_code=503, detail=detail, error_code="PROVIDER_UNAVAILABLE")


class InvalidAIOutputException(AIServiceException):
    """Provider output did not match the expected schema."""

    def __init__(self, detail: str = "Invalid AI output"):
        super().__init__(status_code=502, detail=detail, error_code="INVALID_AI_OUTPUT")


# --- Backwards-compatible aliases --------------------------------------------
# Existing code and tests import these names; keep them pointing at the new
# roadmap-aligned types so behaviour is preserved without duplicating classes.

LLMUnavailableException = ProviderUnavailableException
RateLimitExceededException = RateLimitExceededException  # noqa: F811 — intentional alias
