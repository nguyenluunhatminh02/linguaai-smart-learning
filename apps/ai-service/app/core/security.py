import hmac
import re
import unicodedata

# Tags an attacker could try to inject to break out of <user_input>...</user_input>
# wrapper or hijack chat-template control tokens. Match opening, closing, and
# self-closing variants regardless of whitespace/case.
INJECTION_PATTERNS = [
    r"<\s*/?\s*(system|system_prompt|instructions|assistant|user|user_input)\b[^>]*?>",
    r"<\s*\|\s*im_start\s*\|\s*>",
    r"<\s*\|\s*im_end\s*\|\s*>",
    r"\[\s*INST\s*\]",
    r"\[\s*/\s*INST\s*\]",
]

INJECTION_RE = re.compile("|".join(INJECTION_PATTERNS), re.IGNORECASE)


def sanitize_user_input(text: str, max_length: int = 10000) -> str:
    """Strip prompt-injection control sequences from untrusted user input.

    Defense-in-depth only: callers MUST also wrap the result via
    :func:`wrap_user_input` and treat anything inside as opaque data.
    """
    if not text:
        return ""
    # Normalize unicode so look-alike chars don't bypass the regex
    text = unicodedata.normalize("NFKC", text)
    text = text[:max_length]
    text = INJECTION_RE.sub("", text)
    return text


def wrap_user_input(text: str) -> str:
    sanitized = sanitize_user_input(text)
    return f"<user_input>{sanitized}</user_input>"


def verify_api_key(api_key: str | None, valid_keys: set[str]) -> bool:
    if not valid_keys:
        return True
    if not api_key:
        return False
    # Constant-time comparison to avoid timing oracles when the key set is small.
    return any(hmac.compare_digest(api_key, k) for k in valid_keys)
