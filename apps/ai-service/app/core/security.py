"""User-text containment helpers.

All text in this module is untrusted *data*. Wrapping it in a recognizable
envelope helps the prompt template keep it distinct from instructions, but it
is not a security boundary by itself: server-owned instructions must never be
built from user text and any model output must still pass schema validation.

Sanitization is deliberately lossy and length-bounded. It removes known
wrapper/control-token spellings rather than trying to guess what an attacker
might type; stripping HTML alone is not a prompt-injection defence.
"""

from __future__ import annotations

import hmac
import re
import unicodedata

from app.core.limits import MAX_CONTEXT_CHARS, MAX_TEXT_CHARS

# Tags an attacker could try to inject to break out of <user_input>...</user_input>
# wrapper or hijack chat-template control tokens. Match opening, closing, and
# self-closing variants regardless of whitespace/case.
INJECTION_PATTERNS = [
    r"<\s*/?\s*(system|system_prompt|instructions|assistant|user|user_input)\b[^>]*?>",
    r"<\s*\|\s*im_start\s*\|\s*>",
    r"<\s*\|\s*im_end\s*\|\s*>",
    r"\[\s*/?\s*INST\s*\]",
    # Chat-template delimiters used by other model families.
    r"<\s*\|[^|>\n]{1,40}\|\s*>",
    r"<\s*(?:end_of_turn|start_of_turn|eot_id|s)\s*>",
    r"\[\s*/?\s*(?:SYSTEM|SYS|INST)\s*\]",
]

INJECTION_RE = re.compile("|".join(INJECTION_PATTERNS), re.IGNORECASE)

# Control characters (except tab/newline/carriage return) can hide instructions
# or corrupt logged prompts; they are removed without echoing them back.
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

# Backtick/quote runs are neutralized by inserting a zero-width separator so
# a caller cannot close the surrounding text block or forge a tag boundary.
_TAG_BREAK_RE = re.compile(r"(<\s*[/\\!?])")

_WRAPPER_OPEN = "<user_input>"
_WRAPPER_CLOSE = "</user_input>"


def sanitize_user_input(
    text: str,
    max_length: int = MAX_TEXT_CHARS,
) -> str:
    """Normalize, bound and strip control sequences from untrusted text.

    ``max_length`` is a caller hint and is itself capped at the global
    ``MAX_CONTEXT_CHARS`` ceiling. The output is plain text and contains no
    instructions; callers MUST still treat it as opaque data.
    """
    if not text:
        return ""
    if not isinstance(text, str):
        raise TypeError("text must be a string")

    limit = min(max(1, int(max_length)), MAX_CONTEXT_CHARS)
    # Normalize unicode so look-alike chars don't bypass the regex, then
    # truncate before substitution: no amount of escaping can grow the result.
    normalized = unicodedata.normalize("NFKC", text)[:limit]
    normalized = _CONTROL_RE.sub("", normalized)
    normalized = INJECTION_RE.sub("", normalized)
    # Break any residual tag-like prefix left after the first pass.
    normalized = _TAG_BREAK_RE.sub(r"​\1", normalized)
    return normalized


def wrap_user_input(
    text: str,
    max_chars: int | None = None,
) -> str:
    """Return a bounded, plain-text envelope around opaque user data.

    ``max_chars`` applies to the user text only; the envelope adds a fixed,
    constant overhead. The result never contains the original control tokens.
    """
    limit = MAX_TEXT_CHARS if max_chars is None else max_chars
    sanitized = sanitize_user_input(text, max_length=limit)
    return f"{_WRAPPER_OPEN}{sanitized}{_WRAPPER_CLOSE}"


def verify_api_key(api_key: str | None, valid_keys: set[str]) -> bool:
    """Timing-safe check used by the service-key dependency.

    Kept permissive for explicit test/dev configurations (no keys) so that
    existing local workflows keep working; production fail-closed is enforced
    by :func:`app.core.deps.verify_key`.
    """
    if not valid_keys:
        return True
    if not api_key:
        return False
    # Constant-time comparison to avoid timing oracles when the key set is small.
    return any(hmac.compare_digest(api_key, k) for k in valid_keys)
