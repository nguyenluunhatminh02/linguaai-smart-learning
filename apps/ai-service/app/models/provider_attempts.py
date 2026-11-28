"""Schema for provider attempt metadata (roadmap AI-03, AI-12).

This module defines strict, bounded Pydantic models for recording one provider
attempt: operation ID, provider/model, latency, token usage, cost estimate, and
outcome. It is a schema-only module — persistence, emission and pricing stay
out of this file.

Design constraints:
- All strings are bounded to prevent unbounded memory or metric cardinality.
- Token counts are optional (int | None) and never coerced from None to 0;
  unknown usage remains unknown, per roadmap AI-03: "không bịa số".
- Cost is in minor units (microdollars) to avoid float arithmetic on money.
- Outcome is a small, stable enum suitable as a metric label (OPS-03).
- No prompts, raw error text, response bodies, headers or keys are recorded.
- The schema is compatible with the existing ProviderAttemptMetadata dataclass
  in app/services/llm_client.py but adds stricter validation and cost tracking.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Annotated, Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.limits import MAX_STRING_CHARS

# --- Bounds -------------------------------------------------------------------
# These bounds are staging values. They should be consolidated into
# app/core/limits.py once the provider_attempts schema is stable.

MAX_OPERATION_ID_CHARS = 128  # Matches chat.py _OPAQUE_ID and prisma VarChar(128)
MAX_PROVIDER_NAME_CHARS = 64  # Hostname only, no credentials or paths
MAX_MODEL_NAME_CHARS = 100  # Provider model identifier
MAX_PRICING_VERSION_CHARS = 50  # Matches prisma ai_operations.pricing_version
MAX_LATENCY_MS = 600_000  # 10 minutes; derived from MAX_STREAM_SECONDS with headroom
MAX_ERROR_CODE_CHARS = 64  # Bounded allow-list code, never raw provider text
MAX_FEATURE_CHARS = 64  # Feature label for metric cardinality

# --- Enums --------------------------------------------------------------------


class ProviderAttemptOutcome(str, Enum):
    """Terminal outcome of one provider attempt.

    Keep vocabulary small and stable because it becomes a metric label (OPS-03).
    The existing llm_client.py uses more granular internal outcomes
    (success/terminal_failure/retryable_failure/partial_failure/timeout); those
    map to these schema values when constructing a formal record.
    """

    SUCCESS = "success"
    FAILURE = "failure"
    UNKNOWN = "unknown"  # Disconnect or ambiguous provider result
    CANCELLED = "cancelled"  # Client disconnect before completion
    TIMEOUT = "timeout"  # Provider did not respond within budget
    PARTIAL = "partial"  # Stream started but did not complete


# --- Models -------------------------------------------------------------------


class StrictAttemptModel(BaseModel):
    """Base model with strict, bounded validation for attempt metadata."""

    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
        str_max_length=MAX_STRING_CHARS,
        validate_assignment=True,
        protected_namespaces=(),
    )


class TokenUsage(StrictAttemptModel):
    """Token usage from a provider response.

    All counts are optional; unknown usage remains None, never coerced to 0.
    Negative values, booleans and non-int values are rejected.
    """

    prompt_tokens: Annotated[Optional[int], Field(ge=0)] = None
    completion_tokens: Annotated[Optional[int], Field(ge=0)] = None
    total_tokens: Annotated[Optional[int], Field(ge=0)] = None

    @field_validator("prompt_tokens", "completion_tokens", "total_tokens", mode="before")
    @classmethod
    def reject_bool_and_negative(cls, v: Any) -> Optional[int]:
        """Reject booleans and negative values; accept None, int, or numeric."""
        if v is None:
            return None
        if isinstance(v, bool):
            raise ValueError("token count must be an integer, not bool")
        if not isinstance(v, (int, float)):
            raise ValueError("token count must be an integer")
        if v < 0:
            raise ValueError("token count must be non-negative")
        return int(v)

    @model_validator(mode="after")
    def validate_total_consistency(self) -> "TokenUsage":
        """When both prompt and completion are known, total must match their sum."""
        if (
            self.prompt_tokens is not None
            and self.completion_tokens is not None
            and self.total_tokens is not None
        ):
            expected = self.prompt_tokens + self.completion_tokens
            if self.total_tokens != expected:
                raise ValueError(
                    f"total_tokens ({self.total_tokens}) must equal "
                    f"prompt_tokens + completion_tokens ({expected})"
                )
        return self


class CostEstimate(StrictAttemptModel):
    """Cost estimate for one provider attempt.

    Amount is in microdollars (1/1,000,000 of a USD) to avoid float arithmetic.
    Pricing version is bounded and matches the ai_operations.pricing_version
    column in the gateway database.
    """

    amount_micro_usd: Annotated[int, Field(ge=0)]
    pricing_version: Annotated[
        str, Field(min_length=1, max_length=MAX_PRICING_VERSION_CHARS)
    ]
    is_estimated: bool = True

    @field_validator("pricing_version")
    @classmethod
    def validate_pricing_version(cls, v: str) -> str:
        """Pricing version must be non-empty and bounded."""
        if not v or not v.strip():
            raise ValueError("pricing_version must be non-empty")
        return v.strip()


class ProviderAttempt(StrictAttemptModel):
    """Schema for one provider attempt record (roadmap AI-03).

    Fields:
    - operation_id: caller-supplied opaque ID, bounded and validated.
    - provider: hostname only (no credentials, paths or API keys).
    - model: provider model identifier, bounded.
    - latency_ms: wall-clock duration in milliseconds, bounded.
    - ttft_ms: time to first token for streaming, optional, must be <= latency_ms.
    - usage: token counts, optional, never fabricated.
    - cost: cost estimate, optional.
    - outcome: terminal outcome enum.
    - error_code: bounded allow-list code, never raw provider text.
    - created_at: timezone-aware UTC datetime.
    - feature: feature label for metric cardinality (OPS-03).

    No prompts, raw error text, response bodies, headers or keys are recorded.
    """

    operation_id: Annotated[
        Optional[str], Field(max_length=MAX_OPERATION_ID_CHARS)
    ] = None
    provider: Annotated[str, Field(min_length=1, max_length=MAX_PROVIDER_NAME_CHARS)]
    model: Annotated[str, Field(min_length=1, max_length=MAX_MODEL_NAME_CHARS)]
    latency_ms: Annotated[int, Field(ge=0, le=MAX_LATENCY_MS)]
    ttft_ms: Annotated[Optional[int], Field(ge=0, le=MAX_LATENCY_MS)] = None
    usage: Optional[TokenUsage] = None
    cost: Optional[CostEstimate] = None
    outcome: ProviderAttemptOutcome
    error_code: Annotated[
        Optional[str], Field(max_length=MAX_ERROR_CODE_CHARS)
    ] = None
    created_at: datetime
    feature: Annotated[Optional[str], Field(max_length=MAX_FEATURE_CHARS)] = None

    @field_validator("operation_id")
    @classmethod
    def validate_operation_id(cls, v: Optional[str]) -> Optional[str]:
        """Operation ID must match the chat.py allow-list semantics."""
        if v is None:
            return None
        import re

        if not re.match(r"^[A-Za-z0-9._:~-]{1,128}$", v):
            raise ValueError("operation_id must match allow-list pattern")
        return v

    @field_validator("provider")
    @classmethod
    def validate_provider(cls, v: str) -> str:
        """Provider must be a hostname only, no credentials or paths."""
        if not v or not v.strip():
            raise ValueError("provider must be non-empty")
        # Reject anything that looks like a URL with scheme or path
        if "://" in v or "/" in v:
            raise ValueError("provider must be a hostname only, no scheme or path")
        return v.strip().lower()

    @field_validator("model")
    @classmethod
    def validate_model(cls, v: str) -> str:
        """Model must be non-empty and bounded."""
        if not v or not v.strip():
            raise ValueError("model must be non-empty")
        return v.strip()

    @field_validator("error_code")
    @classmethod
    def validate_error_code(cls, v: Optional[str]) -> Optional[str]:
        """Error code must be a bounded allow-list code, never raw text."""
        if v is None:
            return None
        if not v.strip():
            return None
        # Reject anything with newlines or control characters
        if any(c in v for c in ("\n", "\r", "\t")):
            raise ValueError("error_code must not contain control characters")
        return v.strip()

    @field_validator("created_at")
    @classmethod
    def validate_created_at(cls, v: datetime) -> datetime:
        """Timestamp must be timezone-aware."""
        if v.tzinfo is None:
            raise ValueError("created_at must be timezone-aware")
        return v

    @model_validator(mode="after")
    def validate_ttft_vs_latency(self) -> "ProviderAttempt":
        """When both ttft_ms and latency_ms are present, ttft must be <= latency."""
        if self.ttft_ms is not None and self.ttft_ms > self.latency_ms:
            raise ValueError(
                f"ttft_ms ({self.ttft_ms}) must be <= latency_ms ({self.latency_ms})"
            )
        return self

    def to_log_fields(self) -> dict[str, Any]:
        """Return bounded, low-cardinality fields for structured logging.

        Never includes operation_id, user ID, prompt or raw error text.
        Operation ID belongs in structured request logs only when policy allows.
        """
        fields: dict[str, Any] = {
            "provider": self.provider,
            "model": self.model,
            "outcome": self.outcome.value,
            "latency_ms": self.latency_ms,
        }
        if self.feature:
            fields["feature"] = self.feature
        if self.ttft_ms is not None:
            fields["ttft_ms"] = self.ttft_ms
        if self.usage:
            if self.usage.prompt_tokens is not None:
                fields["prompt_tokens"] = self.usage.prompt_tokens
            if self.usage.completion_tokens is not None:
                fields["completion_tokens"] = self.usage.completion_tokens
            if self.usage.total_tokens is not None:
                fields["total_tokens"] = self.usage.total_tokens
        if self.cost:
            fields["cost_micro_usd"] = self.cost.amount_micro_usd
            fields["cost_estimated"] = self.cost.is_estimated
        if self.error_code:
            fields["error_code"] = self.error_code
        return fields

    def to_metric_labels(self) -> dict[str, str]:
        """Return only bounded, low-cardinality labels for metrics (OPS-03).

        Never includes operation_id, user ID, prompt or raw error.
        """
        labels: dict[str, str] = {
            "provider": self.provider,
            "model": self.model,
            "outcome": self.outcome.value,
        }
        if self.feature:
            labels["feature"] = self.feature
        return labels

    @classmethod
    def from_metadata(
        cls,
        metadata: Any,
        *,
        cost: Optional[CostEstimate] = None,
    ) -> "ProviderAttempt":
        """Construct a ProviderAttempt from the existing ProviderAttemptMetadata dataclass.

        This bridges the existing llm_client.py metadata to the stricter schema.
        The metadata dataclass uses string outcomes; this method maps them to the
        ProviderAttemptOutcome enum.
        """
        # Map existing string outcomes to the enum
        outcome_map = {
            "success": ProviderAttemptOutcome.SUCCESS,
            "terminal_failure": ProviderAttemptOutcome.FAILURE,
            "retryable_failure": ProviderAttemptOutcome.FAILURE,
            "partial_failure": ProviderAttemptOutcome.PARTIAL,
            "timeout": ProviderAttemptOutcome.TIMEOUT,
        }
        outcome_str = getattr(metadata, "outcome", "unknown")
        outcome = outcome_map.get(outcome_str, ProviderAttemptOutcome.UNKNOWN)

        # Build TokenUsage if any token counts are present
        usage = None
        prompt_tokens = getattr(metadata, "prompt_tokens", None)
        completion_tokens = getattr(metadata, "completion_tokens", None)
        total_tokens = getattr(metadata, "total_tokens", None)
        if any(v is not None for v in (prompt_tokens, completion_tokens, total_tokens)):
            usage = TokenUsage(
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens,
            )

        # Use created_at from metadata if present, otherwise now
        created_at = getattr(metadata, "created_at", None)
        if created_at is None:
            created_at = datetime.now(timezone.utc)
        elif created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)

        return cls(
            operation_id=getattr(metadata, "operation_id", None),
            provider=getattr(metadata, "provider", "unknown"),
            model=getattr(metadata, "model", "unknown"),
            latency_ms=getattr(metadata, "duration_ms", 0),
            ttft_ms=getattr(metadata, "ttft_ms", None),
            usage=usage,
            cost=cost,
            outcome=outcome,
            error_code=getattr(metadata, "error_type", None),
            created_at=created_at,
            feature=getattr(metadata, "feature", None),
        )
