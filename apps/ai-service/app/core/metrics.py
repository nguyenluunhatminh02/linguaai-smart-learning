"""Prometheus metric definitions for AI requests (roadmap OPS-03, AI-03).

This module owns the instruments and the label policy only. It never calls a
provider, reads settings or the environment, and never records prompt text,
user identifiers, request identifiers, raw URLs, raw errors or response bodies.

Every label is passed through a fixed allow-list before it reaches an
instrument: an unexpected value becomes ``"unknown"`` rather than creating a
new time series. Token counts are recorded only when the provider reports
them: unknown usage is never fabricated as zero (AI-03).

The instruments are registered in the default Prometheus registry so a scrape
endpoint can expose them, and are also available through :func:`build_registry`
for isolated tests. Instrument creation is safe on interpreters without
``prometheus_client``: recording becomes a no-op with the same public API.
"""

from __future__ import annotations

import math
import re
import time
from contextlib import AbstractContextManager
from types import TracebackType
from typing import Any, Final, Optional

try:  # pragma: no cover - exercised only when the optional dependency is absent
    from prometheus_client import Counter, Gauge, Histogram
    from prometheus_client.registry import CollectorRegistry
except ImportError:  # pragma: no cover - keep metric-less deployments working
    CollectorRegistry = Any  # type: ignore[assignment,misc]

    class _NoopInstrument:
        """No-op stand-in preserving the call/labels API of prometheus-client."""

        def labels(self, *args: Any, **kwargs: Any) -> "_NoopInstrument":
            return self

        def inc(self, value: float = 1) -> None:
            return None

        def dec(self, value: float = 1) -> None:
            return None

        def set(self, value: float) -> None:
            return None

        def observe(self, value: float) -> None:
            return None

    Counter = Histogram = Gauge = _NoopInstrument  # type: ignore[assignment,misc]

_UNKNOWN: Final = "unknown"


# --- Bounded label vocabularies ---------------------------------------------

# Feature names already used by llm_client policies, model_router and the
# provider-attempt schema. Human-readable contexts (e.g. "Quiz generation")
# must be mapped to one of these before crossing the metrics boundary.
FEATURES: Final[frozenset[str]] = frozenset(
    {
        "default",
        "chat",
        "chat_stream",
        "content_generation",
        "grammar",
        "writing_feedback",
        "writing",
        "nlp",
        "error_analysis",
        "errors",
        "card_generation",
        "quiz_generation",
        "reading_generation",
        "speaking_feedback",
        "health",
        _UNKNOWN,
    }
)

# Provider labels are host names only (no scheme, path, port or credentials),
# matching LLMClient.provider_host and the provider-attempt schema. Raw host
# names are mapped to one of these known families; any other host is "unknown"
# so a changing provider URL cannot grow the time-series count.
PROVIDERS: Final[frozenset[str]] = frozenset(
    {
        "openai",
        "azure",
        "anthropic",
        "gemini",
        "google",
        "mistral",
        "cohere",
        "ollama",
        "vllm",
        "local",
        "fake",
        _UNKNOWN,
    }
)

# Suffix/keyword rules for mapping a provider hostname to a known family.
# Static table: no caller text is ever used as a label directly.
_PROVIDER_FAMILIES: Final[tuple[tuple[str, str], ...]] = (
    ("openai", "openai"),
    ("azure", "azure"),
    ("anthropic", "anthropic"),
    ("claude", "anthropic"),
    ("gemini", "gemini"),
    ("googleapis", "google"),
    ("google", "google"),
    ("mistral", "mistral"),
    ("cohere", "cohere"),
    ("ollama", "ollama"),
    ("vllm", "vllm"),
    ("localhost", "local"),
    ("127.0.0.1", "local"),
    ("fake", "fake"),
    ("mock", "fake"),
)

# Stable outcome vocabulary shared with ProviderAttemptOutcome (AI-03).
OUTCOMES: Final[frozenset[str]] = frozenset(
    {"success", "failure", "error", "timeout", "partial", "cancelled", _UNKNOWN}
)

DIRECTIONS: Final[frozenset[str]] = frozenset({"input", "output", _UNKNOWN})

STATES: Final[frozenset[str]] = frozenset({"active", "queued", _UNKNOWN})

METHODS: Final[frozenset[str]] = frozenset(
    {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", _UNKNOWN}
)

# Route templates are server-defined. Only the templates actually served by
# the HTTP application are accepted; a raw client-supplied URL can never
# become a label.
ROUTES: Final[frozenset[str]] = frozenset(
    {
        "/",
        "/health",
        "/metrics",
        "/api/v1/health",
        "/api/v1/chat",
        "/api/v1/chat/stream",
        "/api/v1/content/cards",
        "/api/v1/content/quiz",
        "/api/v1/content/reading",
        "/api/v1/grammar/explain",
        "/api/v1/reading/generate",
        "/api/v1/writing/assess",
        _UNKNOWN,
    }
)

# Status classes rather than raw status codes keep the series bounded.
STATUSES: Final[frozenset[str]] = frozenset({"2xx", "3xx", "4xx", "5xx", _UNKNOWN})

# Human-readable context strings used by routers -> canonical feature label.
_CONTEXT_FEATURES: Final[dict[str, str]] = {
    "chat": "chat",
    "chat stream": "chat_stream",
    "card generation": "card_generation",
    "cards generation": "card_generation",
    "quiz generation": "quiz_generation",
    "reading generation": "reading_generation",
    "writing assessment": "writing_feedback",
    "writing feedback": "writing_feedback",
    "grammar explanation": "grammar",
    "error analysis": "error_analysis",
    "nlp analysis": "nlp",
    "ai request": "default",
    "special study request": "default",
    "content generation": "content_generation",
}

# Provider/model aliases seen in configuration. Anything else maps to
# "unknown" instead of inheriting an arbitrary string from a caller.
_MODEL_ALIASES: Final[dict[str, str]] = {
    "light": "light",
    "heavy": "heavy",
    "chat": "chat",
    "default": "default",
}
_MODEL_SLUG_RE: Final = re.compile(r"^[a-z0-9][a-z0-9._:-]{0,127}$")
_PROVIDER_SLUG_RE: Final = re.compile(r"^[a-z0-9][a-z0-9.-]{0,62}$")
_STATUS_RE: Final = re.compile(r"^[1-5]xx$")


# --- Label normalization -----------------------------------------------------


def bounded_label(
    value: Any,
    allowed: frozenset[str] | set[str] | tuple[str, ...],
    default: str = _UNKNOWN,
) -> str:
    """Return ``value`` only when it is an allow-listed label.

    Values are stripped and case-folded before comparison when a
    case-insensitive variant of an allowed label exists. Non-string inputs,
    empty strings, oversized values and values with control characters are
    rejected. The returned label is always one of ``allowed`` (or ``default``
    when it too is allow-listed); a hostile value can never create a new time
    series.
    """
    allowed_set = frozenset(allowed)
    if default not in allowed_set:
        default = _UNKNOWN if _UNKNOWN in allowed_set else next(iter(allowed_set), _UNKNOWN)
    if not isinstance(value, str) or not value:
        return default

    stripped = value.strip()
    if not stripped or len(stripped) > 128 or any(
        ord(char) < 0x20 or ord(char) == 0x7F for char in stripped
    ):
        return default
    if stripped in allowed_set:
        return stripped
    folded = stripped.lower()
    for candidate in allowed_set:
        if candidate.lower() == folded:
            return candidate
    return default


def normalize_feature(value: Any) -> str:
    """Map a feature name or human-readable context to a bounded feature label."""
    canonical = bounded_label(value, FEATURES, _UNKNOWN)
    if canonical != _UNKNOWN:
        return canonical
    if not isinstance(value, str):
        return _UNKNOWN
    key = value.strip().lower().replace("_", " ").replace("-", " ")
    if key in _CONTEXT_FEATURES:
        return _CONTEXT_FEATURES[key]
    for alias, feature in _CONTEXT_FEATURES.items():
        if alias != "ai request" and alias in key:
            return feature
    return _UNKNOWN


def normalize_model(value: Any) -> str:
    """Return an allow-listed model label, never a raw provider identifier."""
    canonical = bounded_label(value, frozenset(_MODEL_ALIASES.values()), _UNKNOWN)
    if canonical != _UNKNOWN:
        return canonical
    if not isinstance(value, str):
        return _UNKNOWN
    candidate = value.strip().lower()
    if _MODEL_SLUG_RE.fullmatch(candidate):
        return _MODEL_ALIASES.get(candidate, _UNKNOWN)
    return _UNKNOWN


def normalize_provider(value: Any) -> str:
    """Return an allow-listed provider family, never a URL or credential."""
    canonical = bounded_label(value, PROVIDERS, _UNKNOWN)
    if canonical != _UNKNOWN:
        return canonical
    if not isinstance(value, str):
        return _UNKNOWN
    candidate = value.strip().lower()
    if "://" in candidate or "/" in candidate or "@" in candidate or ":" in candidate:
        return _UNKNOWN
    if not _PROVIDER_SLUG_RE.fullmatch(candidate):
        return _UNKNOWN
    for marker, family in _PROVIDER_FAMILIES:
        if marker in candidate:
            return family
    return _UNKNOWN


def normalize_outcome(value: Any) -> str:
    """Map an internal or external outcome to the small OPS-03 vocabulary."""
    canonical = bounded_label(value, OUTCOMES, _UNKNOWN)
    if canonical != _UNKNOWN:
        return canonical
    aliases = {
        "ok": "success",
        "succeeded": "success",
        "terminal_failure": "failure",
        "retryable_failure": "failure",
        "failed": "failure",
        "exception": "failure",
        "error_code": "failure",
        "timeout_error": "timeout",
        "timed_out": "timeout",
        "partial_failure": "partial",
        "client_disconnect": "cancelled",
        "disconnected": "cancelled",
    }
    if not isinstance(value, str):
        return _UNKNOWN
    return aliases.get(value.strip().lower(), _UNKNOWN)


def normalize_direction(value: Any) -> str:
    """Normalize the token direction label (``input``/``output``)."""
    canonical = bounded_label(value, DIRECTIONS, _UNKNOWN)
    if canonical != _UNKNOWN:
        return canonical
    if isinstance(value, str):
        return {"prompt": "input", "completion": "output"}.get(
            value.strip().lower(), _UNKNOWN
        )
    return _UNKNOWN


def normalize_state(value: Any) -> str:
    """Normalize the inflight-operation state label."""
    return bounded_label(value, STATES, _UNKNOWN)


def normalize_method(value: Any) -> str:
    """Normalize an HTTP method to a bounded uppercase label."""
    return bounded_label(value, METHODS, _UNKNOWN)


def normalize_route(value: Any) -> str:
    """Accept only known server-defined route templates, never a raw URL."""
    canonical = bounded_label(value, ROUTES, _UNKNOWN)
    if canonical != _UNKNOWN:
        return canonical
    if not isinstance(value, str):
        return _UNKNOWN
    candidate = value.strip()
    if not candidate.startswith("/") or "?" in candidate or "//" in candidate:
        return _UNKNOWN
    # Parameterized templates like /api/v1/chat/{id} are allowed only when the
    # literal prefix is a served template and the remainder is a single segment.
    base, sep, tail = candidate.rpartition("/")
    if sep and tail.startswith("{") and tail.endswith("}"):
        return bounded_label(base, ROUTES, _UNKNOWN)
    return _UNKNOWN


def normalize_status(value: Any) -> str:
    """Collapse a status code to its class (e.g. 503 -> ``5xx``)."""
    canonical = bounded_label(value, STATUSES, _UNKNOWN)
    if canonical != _UNKNOWN:
        return canonical
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        return _UNKNOWN
    text = str(value).strip()
    if text in {"200", "201", "204"}:
        return "2xx"
    if len(text) == 3 and _STATUS_RE.fullmatch(text[0] + "xx"):
        return text[0] + "xx"
    return _UNKNOWN


def normalize_label(value: Any, kind: str) -> str:
    """Dispatch to the appropriate normalizer for ``kind``.

    An unrecognized ``kind`` is deliberately conservative: it returns
    ``"unknown"`` rather than passing an unvalidated value through.
    """
    normalizers = {
        "feature": normalize_feature,
        "model": normalize_model,
        "provider": normalize_provider,
        "outcome": normalize_outcome,
        "direction": normalize_direction,
        "state": normalize_state,
        "route": normalize_route,
        "method": normalize_method,
        "status": normalize_status,
    }
    normalizer = normalizers.get(kind)
    return normalizer(value) if normalizer is not None else _UNKNOWN


# --- Instruments -------------------------------------------------------------

# Histogram buckets are staging defaults (not measured SLOs). They keep the
# series count fixed while covering sub-second chat TTFT and minute-scale
# content generation.
_DURATION_BUCKETS: Final = (
    0.005,
    0.01,
    0.025,
    0.05,
    0.1,
    0.25,
    0.5,
    1.0,
    2.5,
    5.0,
    10.0,
    30.0,
    60.0,
    120.0,
    300.0,
    float("inf"),
)
_TTFT_BUCKETS: Final = (0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, float("inf"))


def build_registry() -> Any:
    """Create an empty registry for isolated tests or custom scrape endpoints."""
    return CollectorRegistry()


def _create_instruments(registry: Any) -> dict[str, Any]:
    """Create the six OPS-03 instruments in one place."""
    return {
        "ai_requests_total": Counter(
            "ai_requests_total",
            "AI operations completed, by feature, model and outcome.",
            ("feature", "model", "outcome"),
            registry=registry,
        ),
        "ai_time_to_first_token_seconds": Histogram(
            "ai_time_to_first_token_seconds",
            "Time from AI request start to the first streamed token.",
            ("feature", "model"),
            buckets=_TTFT_BUCKETS,
            registry=registry,
        ),
        "ai_provider_duration_seconds": Histogram(
            "ai_provider_duration_seconds",
            "Duration of one provider attempt.",
            ("provider", "model", "outcome"),
            buckets=_DURATION_BUCKETS,
            registry=registry,
        ),
        "ai_provider_tokens_total": Counter(
            "ai_provider_tokens_total",
            "Provider-reported input/output tokens; absent usage is not counted.",
            ("model", "direction"),
            registry=registry,
        ),
        "ai_operations_inflight": Gauge(
            "ai_operations_inflight",
            "AI operations currently active or queued.",
            ("feature", "state"),
            registry=registry,
        ),
        "http_request_duration_seconds": Histogram(
            "http_request_duration_seconds",
            "HTTP request duration by route template, method and status class.",
            ("route", "method", "status"),
            buckets=_DURATION_BUCKETS,
            registry=registry,
        ),
    }


try:
    _INSTRUMENTS = _create_instruments(None)
except Exception:  # pragma: no cover - duplicate registration in a hot reload
    from prometheus_client import REGISTRY as _DEFAULT_REGISTRY

    _INSTRUMENTS = _create_instruments(_DEFAULT_REGISTRY)

ai_requests_total = _INSTRUMENTS["ai_requests_total"]
ai_time_to_first_token_seconds = _INSTRUMENTS["ai_time_to_first_token_seconds"]
ai_provider_duration_seconds = _INSTRUMENTS["ai_provider_duration_seconds"]
ai_provider_tokens_total = _INSTRUMENTS["ai_provider_tokens_total"]
ai_operations_inflight = _INSTRUMENTS["ai_operations_inflight"]
http_request_duration_seconds = _INSTRUMENTS["http_request_duration_seconds"]


# --- Safe recording helpers --------------------------------------------------


def _label_values(kinds: tuple[str, ...], values: tuple[Any, ...]) -> tuple[str, ...]:
    return tuple(
        normalize_label(value, kind) for kind, value in zip(kinds, values, strict=True)
    )


def record_request(
    feature: Any,
    model: Any,
    outcome: Any,
    *,
    count: int = 1,
) -> None:
    """Increment ``ai_requests_total`` with normalized labels."""
    if count <= 0:
        return
    labels = _label_values(("feature", "model", "outcome"), (feature, model, outcome))
    ai_requests_total.labels(*labels).inc(count)


def observe_ttft(feature: Any, model: Any, seconds: float) -> None:
    """Observe a non-negative TTFT in seconds; invalid values are ignored."""
    if not _valid_duration(seconds):
        return
    labels = _label_values(("feature", "model"), (feature, model))
    ai_time_to_first_token_seconds.labels(*labels).observe(seconds)


def observe_provider_duration(
    provider: Any, model: Any, outcome: Any, seconds: float
) -> None:
    """Observe one provider attempt duration with bounded labels."""
    if not _valid_duration(seconds):
        return
    labels = _label_values(
        ("provider", "model", "outcome"), (provider, model, outcome)
    )
    ai_provider_duration_seconds.labels(*labels).observe(seconds)


def add_tokens(model: Any, direction: Any, count: Any) -> None:
    """Add provider-reported tokens; unknown or invalid values are ignored."""
    if isinstance(count, bool) or not isinstance(count, (int, float)):
        return
    if not math.isfinite(count) or count <= 0:
        return
    labels = _label_values(("model", "direction"), (model, direction))
    ai_provider_tokens_total.labels(*labels).inc(int(count))


def set_inflight(feature: Any, state: Any, value: float) -> None:
    """Set an inflight gauge with bounded labels."""
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return
    if not math.isfinite(value):
        return
    labels = _label_values(("feature", "state"), (feature, state))
    ai_operations_inflight.labels(*labels).set(value)


def observe_http_request(
    route: Any, method: Any, status: Any, seconds: float
) -> None:
    """Observe an HTTP request with a route template and status class."""
    if not _valid_duration(seconds):
        return
    labels = _label_values(("route", "method", "status"), (route, method, status))
    http_request_duration_seconds.labels(*labels).observe(seconds)


def _valid_duration(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and value >= 0.0
    )


class AIRequestTracker(AbstractContextManager["AIRequestTracker"]):
    """Context manager bundling all instruments for one AI operation.

    Entering increments the ``active`` inflight gauge; exiting always
    decrements it, records exactly one request outcome, and observes provider
    duration. TTFT and token counts are opt-in because non-streaming requests
    and providers without usage data must not fabricate numbers.

    The tracker never raises from a metric operation: telemetry must not change
    the behaviour of the request it observes.
    """

    def __init__(self, feature: Any, model: Any, provider: Any) -> None:
        self.feature = normalize_feature(feature)
        self.model = normalize_model(model)
        self.provider = normalize_provider(provider)
        self.outcome = _UNKNOWN
        self._started_ns: Optional[int] = None

    def __enter__(self) -> "AIRequestTracker":
        self._started_ns = time.monotonic_ns()
        try:
            ai_operations_inflight.labels(self.feature, "active").inc()
        except Exception:
            pass
        return self

    def __exit__(
        self,
        exc_type: Optional[type[BaseException]],
        exc: Optional[BaseException],
        traceback: Optional[TracebackType],
    ) -> None:
        if exc is not None and self.outcome == _UNKNOWN:
            self.outcome = normalize_outcome(type(exc).__name__) if exc_type else "failure"
            if self.outcome == _UNKNOWN:
                self.outcome = "failure"
        if self.outcome == _UNKNOWN:
            self.outcome = "success"
        elapsed = self._elapsed_seconds()
        try:
            record_request(self.feature, self.model, self.outcome)
            observe_provider_duration(
                self.provider, self.model, self.outcome, elapsed
            )
            ai_operations_inflight.labels(self.feature, "active").dec()
        except Exception:
            pass
        # Never suppress the operation's exception.
        return None

    def _elapsed_seconds(self) -> float:
        if self._started_ns is None:
            return 0.0
        return max(0.0, (time.monotonic_ns() - self._started_ns) / 1_000_000_000)

    def observe_ttft(self, seconds: Any) -> None:
        if _valid_duration(seconds):
            try:
                observe_ttft(self.feature, self.model, seconds)
            except Exception:
                pass

    def observe_tokens(self, prompt: Any, completion: Any) -> None:
        """Record input/output token counts when the provider reported them."""
        for direction, count in (("input", prompt), ("output", completion)):
            if not _valid_duration(count):
                continue
            try:
                add_tokens(self.model, direction, count)
            except Exception:
                pass

    def set_outcome(self, value: Any) -> None:
        """Override the inferred outcome with a bounded label."""
        self.outcome = normalize_outcome(value)


def track_ai_operation(feature: Any, model: Any, provider: Any) -> AIRequestTracker:
    """Return a tracker context manager for one AI/provider operation."""
    return AIRequestTracker(feature, model, provider)


__all__ = [
    "AIRequestTracker",
    "DIRECTIONS",
    "FEATURES",
    "METHODS",
    "OUTCOMES",
    "PROVIDERS",
    "ROUTES",
    "STATES",
    "STATUSES",
    "ai_operations_inflight",
    "ai_provider_duration_seconds",
    "ai_provider_tokens_total",
    "ai_requests_total",
    "add_tokens",
    "bounded_label",
    "build_registry",
    "http_request_duration_seconds",
    "normalize_direction",
    "normalize_feature",
    "normalize_label",
    "normalize_method",
    "normalize_model",
    "normalize_outcome",
    "normalize_provider",
    "normalize_route",
    "normalize_state",
    "normalize_status",
    "observe_http_request",
    "observe_provider_duration",
    "observe_ttft",
    "record_request",
    "set_inflight",
    "track_ai_operation",
]
