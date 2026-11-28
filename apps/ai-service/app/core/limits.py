"""Central, bounded limits for AI abuse controls.

These numbers are staging starting hypotheses, not measured capacity. They are
kept in one module so the routers, schemas and upstream guards cannot drift
apart, and so an operator can tune them in one place after measurement.

All limits are hard ceilings: callers may pass *smaller* values, never larger
ones. ``max_chars`` counts Python characters after unicode normalization;
upstream byte caps are enforced separately by the transport layer.
"""

from __future__ import annotations

import os

# --- Request and context ceilings -------------------------------------------------

# Individual untrusted strings.
MAX_TEXT_CHARS = 10_000
MAX_TOPIC_CHARS = 200
MAX_GRAMMAR_POINT_CHARS = 500
MAX_QUESTION_CHARS = 1_000
MAX_CHAT_MESSAGE_CHARS = 5_000
MAX_ERROR_ITEM_CHARS = 2_000

# Aggregate context sent to a single provider call. This is a hard bound even
# when many individually-valid fields are supplied in the same request.
MAX_CONTEXT_CHARS = 12_000
MAX_CHAT_HISTORY_MESSAGES = 20
MAX_CHAT_HISTORY_CHARS = 8_000
MAX_LIST_ITEMS = 100
MAX_EXAMPLES_PER_ITEM = 10
MAX_OPTIONS_PER_QUESTION = 6
MAX_STRING_CHARS = 2_000
MAX_LABEL_CHARS = 200

# --- Output ceilings ---------------------------------------------------------------

# Default and hard ceiling for provider ``max_tokens`` on every code path,
# including streaming. Callers cannot raise the ceiling by passing a larger
# value; retries share the same budget.
MAX_OUTPUT_TOKENS = 2_048
MAX_OUTPUT_TOKENS_CEILING = 8_192
MAX_OUTPUT_CHARS = 20_000
MAX_GENERATED_ITEMS = 20

# --- Rate, concurrency and budget ---------------------------------------------------

DEFAULT_REQUESTS_PER_MINUTE = 20


def _env_int(name: str, default: int, *, minimum: int = 1) -> int:
    """Read a positive int setting, ignoring malformed values.

    A bad value must never turn a guard off (zero) or make it unbounded.
    """
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default
    return value if value >= minimum else default


# Roadmap starting values for staging. Chat is interactive; content generation
# is expensive and bounded to a small number of simultaneous jobs.
FEATURE_LIMITS: dict[str, int] = {
    "chat": _env_int("AI_CHAT_RATE_LIMIT", 10),
    "content": _env_int("AI_CONTENT_RATE_LIMIT", 3),
    "errors": _env_int("AI_CONTENT_RATE_LIMIT", 3),
    "grammar": _env_int("AI_CONTENT_RATE_LIMIT", 3),
    "nlp": _env_int("AI_CONTENT_RATE_LIMIT", 3),
    "reading": _env_int("AI_CONTENT_RATE_LIMIT", 3),
    "writing": _env_int("AI_CONTENT_RATE_LIMIT", 3),
}

# Per verified service key and feature; keeps one tenant from exhausting all
# upstream slots. Global cap protects the provider relationship as a whole.
MAX_CONCURRENT_PER_USER = _env_int("AI_MAX_CONCURRENT_PER_USER", 2)
MAX_CONCURRENT_GLOBAL = _env_int("AI_MAX_CONCURRENT_GLOBAL", 8)

# Rolling daily budget, counted in estimated billable tokens. This is a local
# circuit breaker, not the billing system of record.
DAILY_TOKEN_BUDGET = _env_int("AI_DAILY_TOKEN_BUDGET", 2_000_000)
BUDGET_WINDOW_SECONDS = 86_400
RATE_WINDOW_SECONDS = 60

# Redis-backed guards fail closed for billable routes (no Redis, no spend).
FAIL_CLOSED_ON_STORE_ERROR = True

# Conservative estimate used before the provider reports actual usage.
ESTIMATED_TOKENS_PER_CHAR = 0.25

# Rate-limit bucket window for the existing permissive limiter (health and
# non-billable diagnostic routes only).
DEFAULT_LIMIT_RULE = f"{DEFAULT_REQUESTS_PER_MINUTE}/minute"

# Route-family → feature mapping used to derive guard keys. Unknown billable
# routes are denied by default in ``feature_guard`` rather than getting an
# unguarded bucket.
PATH_FEATURE_MAP: dict[str, str] = {
    "chat": "chat",
    "content": "content",
    "errors": "errors",
    "grammar": "grammar",
    "nlp": "nlp",
    "reading": "reading",
    "writing": "writing",
}


def clamp_max_tokens(value: int | None) -> int:
    """Clamp a caller-supplied token count to the hard output ceiling."""
    if value is None:
        return MAX_OUTPUT_TOKENS
    return max(1, min(int(value), MAX_OUTPUT_TOKENS_CEILING))
