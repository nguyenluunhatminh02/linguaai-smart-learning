"""Structured JSON logging for the AI service.

The formatter is defensive: it never emits prompt text, user transcripts,
audio payloads, JWTs, bearer tokens, API keys, or other secret-bearing
values, even when a call site accidentally passes them via ``extra`` or
interpolates them into the message. Metadata keys are allow-listed;
unrecognized keys are dropped. Exception records are reduced to the
exception class name so tracebacks (which can contain request bodies or
upstream error messages with secrets) never reach the log sink.

Timestamps are UTC ISO-8601 derived from ``record.created``. The reserved
keys ``timestamp``, ``level`` and ``request_id`` cannot be overridden by
``extra``. ``json.dumps`` is called with ``allow_nan=False`` so a buggy
metric never silently produces non-standard JSON.
"""

from __future__ import annotations

import json
import logging
import math
import os
import re
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from typing import Any, Iterable, Mapping, Optional

from app.core.context import get_request_id


# ---------------------------------------------------------------------------
# Allow-list / deny-list for structured metadata
# ---------------------------------------------------------------------------

# Keys that call sites are allowed to emit. Anything else is dropped.
# Grouped by purpose so future additions are easy to review.
_ALLOWED_EXTRA_KEYS: frozenset[str] = frozenset(
    {
        # HTTP / middleware
        "method",
        "path",
        "status_code",
        "duration_ms",
        "route",
        # Provider attempt telemetry (llm_client + model_router)
        "provider_attempt",
        "provider_attempts",
        "attempt",
        "feature",
        "provider",
        "model",
        "model_id",
        "mode",
        "operation_id",
        "request_id",
        "request_ref",
        "policy_version",
        "config_version",
        "price_ref",
        "pricing_version",
        "input_schema_version",
        "output_schema_version",
        "started_at",
        "started_at_ms",
        "latency_ms",
        "ttft_ms",
        "outcome",
        "error_type",
        "error_code",
        "status_code",
        "retryable",
        "is_estimated",
        "is_fallback",
        "attempt_index",
        "partial_tokens",
        "prompt_tokens",
        "completion_tokens",
        "total_tokens",
        "input_tokens",
        "output_tokens",
        "usage_known",
        "cost_estimate",
        # Prompt metadata (speaking/registry) — identifiers only, never bodies
        "prompt_id",
        "prompt_version",
        "locales",
        "model_role",
        "temperature",
        "max_tokens",
        "rubric",
        "changelog",
        # Cache / rate-limit / utils
        "context",
        "cache_hit",
        "feature",
        "word_count",
        "input_length",
        "output_length",
        "reason",
        "limit",
        "remaining",
        "reset_at",
    }
)

# Substring patterns that, if present in a key name, cause the key to be
# dropped even when the allow-list would otherwise admit it. Covers the
# common secret-bearing names without needing an exhaustive enumeration.
_DENIED_KEY_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"(?i)prompt(?!_(tokens|token_count|id|version))"),
    re.compile(r"(?i)(user_text|messages|content|audio|transcript)"),
    re.compile(r"(?i)(jwt|authorization|api_?key|secret|password|cookie)"),
    re.compile(r"(?i)(bearer|token(?!s))"),
    re.compile(r"(?i)(dsn|credentials?)"),
)

# Maximum length for any string value emitted in a log record. Longer
# values are truncated with a marker; this keeps a runaway body from
# blowing up log storage or leaking a large prompt via a helper that
# stringified it.
_MAX_STRING_LEN = 512
_TRUNCATION_MARKER = "…[truncated]"


# ---------------------------------------------------------------------------
# Message sanitization
# ---------------------------------------------------------------------------

# ``Bearer <token>`` — redact the token portion.
_BEARER_RE = re.compile(r"(?i)Bearer\s+[A-Za-z0-9\-._~+/]+=*")
# JWT-shaped blobs: three base64url segments separated by dots.
_JWT_RE = re.compile(r"eyJ[A-Za-z0-9\-._~+/]*\.eyJ[A-Za-z0-9\-._~+/]*\.[A-Za-z0-9\-._~+/]*")
# ``name=<secret>`` query parameters commonly used to leak keys in URLs.
_SECRET_QUERY_RE = re.compile(
    r"(?i)([?&](?:api_?key|token|secret|authorization|password|access_?key)\s*=\s*)([^&\s]+)"
)


def _redact_message(value: str) -> str:
    """Strip bearer tokens, JWTs and secret-looking query params."""
    if not value:
        return value
    value = _BEARER_RE.sub("Bearer [REDACTED]", value)
    value = _JWT_RE.sub("[REDACTED_JWT]", value)
    value = _SECRET_QUERY_RE.sub(r"\1[REDACTED]", value)
    return value


# ---------------------------------------------------------------------------
# Value sanitization
# ---------------------------------------------------------------------------

def _key_allowed(name: str) -> bool:
    if name not in _ALLOWED_EXTRA_KEYS:
        return False
    for pattern in _DENIED_KEY_PATTERNS:
        if pattern.search(name):
            return False
    return True


def _safe_value(value: Any) -> Any:
    """Return a JSON-serializable, non-leaky representation of ``value``.

    - ``None``, bool, int, float pass through (floats are checked for NaN
      by ``json.dumps(allow_nan=False)`` at the end).
    - Strings are redacted and truncated.
    - Mappings and iterables are recursed into; unknown types are replaced
      by their class name so we never call ``str()`` on a dict/list that
      might contain a prompt body.
    """
    if value is None or isinstance(value, (bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, str):
        redacted = _redact_message(value)
        if len(redacted) > _MAX_STRING_LEN:
            return redacted[:_MAX_STRING_LEN] + _TRUNCATION_MARKER
        return redacted
    if isinstance(value, Mapping):
        return {str(k): _safe_value(v) for k, v in value.items() if _key_allowed(str(k))}
    if isinstance(value, Iterable) and not isinstance(value, (bytes, bytearray)):
        return [_safe_value(v) for v in value]
    # Unsupported type — never ``str(value)`` because that can serialize a
    # request body or exception with secrets in its repr.
    return f"<{type(value).__name__}>"


def _safe_exception(exc_info: Any) -> Optional[str]:
    """Return only the exception class name.

    Traceback text and ``str(exc)`` are intentionally omitted: upstream
    error messages can contain request bodies, headers or credentials.
    """
    if not exc_info:
        return None
    exc_type = exc_info[0]
    if exc_type is None:
        return None
    return f"{exc_type.__module__}.{exc_type.__name__}"


# ---------------------------------------------------------------------------
# Formatter
# ---------------------------------------------------------------------------

# Standard LogRecord attribute names that must not be treated as extras.
_RECORD_ATTRS: frozenset[str] = frozenset(
    {
        "args",
        "asctime",
        "created",
        "exc_info",
        "exc_text",
        "filename",
        "funcName",
        "levelname",
        "levelno",
        "lineno",
        "message",
        "module",
        "msecs",
        "msg",
        "name",
        "pathname",
        "process",
        "processName",
        "relativeCreated",
        "stack_info",
        "thread",
        "threadName",
        "taskName",
    }
)

# Keys the formatter owns; call sites may not override them via ``extra``.
_RESERVED_KEYS: frozenset[str] = frozenset({"timestamp", "level", "request_id", "logger"})


class JSONFormatter(logging.Formatter):
    """Emit one JSON object per log record with secrets redacted."""

    def format(self, record: logging.LogRecord) -> str:
        # UTC ISO-8601 with millisecond precision, derived from record.created
        # so it is monotonic with the event, not with format time.
        ts = datetime.fromtimestamp(record.created, tz=timezone.utc)
        timestamp = ts.strftime("%Y-%m-%dT%H:%M:%S.") + f"{int(record.msecs):03d}Z"

        log_data: dict[str, Any] = {
            "timestamp": timestamp,
            "level": record.levelname,
            "logger": record.name,
            "message": _redact_message(record.getMessage()),
        }

        req_id = get_request_id()
        if req_id:
            log_data["request_id"] = req_id

        exc_type_name = _safe_exception(record.exc_info)
        if exc_type_name:
            log_data["exception"] = exc_type_name

        # Merge allow-listed extras, never overriding reserved keys.
        for key, raw_value in record.__dict__.items():
            if key in _RECORD_ATTRS:
                continue
            if key in _RESERVED_KEYS:
                continue
            if not _key_allowed(key):
                continue
            log_data[key] = _safe_value(raw_value)

        return json.dumps(log_data, ensure_ascii=False, allow_nan=False)


def setup_logging(log_dir: str) -> None:
    """Configure the root logger with a console + rotating file handler."""
    os.makedirs(log_dir, exist_ok=True)

    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)

    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)

    formatter = JSONFormatter()

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)

    file_handler = RotatingFileHandler(
        os.path.join(log_dir, "ai-service.log"),
        maxBytes=10 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    root_logger.addHandler(file_handler)
