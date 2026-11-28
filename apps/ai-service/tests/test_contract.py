"""REL-33 contract parity tests for the NestJS ↔ FastAPI AI boundary.

The Nest adapter lives in ``apps/api/src/common/services/ai-client.service.ts``
(metadata, error codes) and ``apps/api/src/common/services/groq.service.ts``
(chat SSE parsing and gateway identity headers). The FastAPI emitter lives in
``apps/ai-service/app/routers/chat.py``. These tests pin the shared wire
contract: ordered ``accepted`` / ``delta`` / ``completed`` / ``failed`` events,
safe error codes, bounded identifiers, and the Nest parser's view of SSE chunks.

No real credentials or ``.env`` values are read or asserted here.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app

client = TestClient(app)

REPO_ROOT = Path(__file__).resolve().parents[3]
NEST_ADAPTER = REPO_ROOT / "apps/api/src/common/services/ai-client.service.ts"
NEST_CHAT_ADAPTER = REPO_ROOT / "apps/api/src/common/services/groq.service.ts"
FASTAPI_MAIN = REPO_ROOT / "apps/ai-service/app/main.py"
FASTAPI_CHAT = REPO_ROOT / "apps/ai-service/app/routers/chat.py"

# The nine codes from the roadmap REL-01 registry. Extra legacy aliases may
# exist in either runtime, but these must be present on both sides.
SHARED_ERROR_CODES = frozenset(
    {
        "VALIDATION_ERROR",
        "INSUFFICIENT_CREDITS",
        "OPERATION_CONFLICT",
        "RATE_LIMITED",
        "PROVIDER_UNAVAILABLE",
        "PROVIDER_TIMEOUT",
        "INVALID_AI_OUTPUT",
        "OPERATION_UNKNOWN",
        "INTERNAL_ERROR",
    }
)

PAYLOAD = {
    "language": "english",
    "messages": [{"role": "user", "content": "Hello"}],
}
# Paid chat routes need both the service key and gateway-asserted identity.
HEADERS = {
    "X-API-Key": "contract-test-key",
    "X-User-ID": "user-123",
    "X-User-Roles": "user",
}


@pytest.fixture(autouse=True)
def setup_api_key(monkeypatch):
    monkeypatch.setattr(settings, "api_keys", "contract-test-key")


@pytest.fixture(autouse=True)
def disable_rate_limit():
    """Keep contract assertions deterministic across many requests."""
    previous = getattr(app.state.limiter, "enabled", None)
    app.state.limiter.enabled = False
    yield
    app.state.limiter.enabled = True if previous is None else previous


def _source(path: Path) -> str:
    assert path.is_file(), f"Missing contract source: {path}"
    return path.read_text(encoding="utf-8")


def _quoted_codes(source: str, marker: str, terminator: str) -> set[str]:
    start = source.index(marker)
    end = source.index(terminator, start)
    return set(re.findall(r"['\"]([A-Z_]+)['\"]", source[start:end]))


def _parse_sse(text: str) -> list[tuple[str, dict]]:
    """Parse SSE text into ordered ``(event, data)`` pairs."""
    events: list[tuple[str, dict]] = []
    for block in text.strip().split("\n\n"):
        if not block.strip():
            continue
        event_name = None
        payload = None
        for line in block.split("\n"):
            if line.startswith("event: "):
                event_name = line[7:]
            elif line.startswith("data: "):
                payload = json.loads(line[6:])
        assert event_name is not None, f"Missing event name in {block!r}"
        assert payload is not None, f"Missing data in {block!r}"
        events.append((event_name, payload))
    return events


def _nest_adapter_deltas(chunks):
    """Mirror groq.service.ts ``_sseDeltas`` over arbitrary chunk boundaries.

    Returns the yielded text deltas and the codes of any ``failed`` events.
    Only ``delta`` text crosses into chat orchestration; ``accepted`` and
    ``completed`` are framing metadata, and ``failed`` becomes a safe code.
    """
    deltas: list[str] = []
    failures: list[str] = []
    buffered = ""
    event_name = ""
    data_lines: list[str] = []

    def dispatch(event: str, raw_data: str) -> None:
        if event not in {"delta", "failed"}:
            return
        try:
            parsed = json.loads(raw_data)
        except json.JSONDecodeError:
            return
        if not isinstance(parsed, dict):
            return
        if event == "delta":
            text = parsed.get("text")
            if isinstance(text, str) and text:
                deltas.append(text)
            return
        error = parsed.get("error")
        error = error if isinstance(error, dict) else parsed
        code = error.get("code")
        failures.append(
            "PROVIDER_TIMEOUT"
            if code == "PROVIDER_TIMEOUT"
            else "PROVIDER_UNAVAILABLE"
        )

    for chunk in chunks:
        buffered += chunk
        while "\n" in buffered:
            raw_line, buffered = buffered.split("\n", 1)
            raw_line = raw_line.rstrip("\r")
            if not raw_line:
                if data_lines:
                    dispatch(event_name, "\n".join(data_lines))
                event_name = ""
                data_lines = []
            elif raw_line.startswith("event:"):
                event_name = raw_line[6:].strip()
            elif raw_line.startswith("data:"):
                data_lines.append(raw_line[5:].lstrip())
        if len(buffered) > 64 * 1024:
            buffered = ""
    if data_lines:
        dispatch(event_name, "\n".join(data_lines))
    return deltas, failures


def _chunked(text: str, size: int = 7):
    """Split an SSE body at arbitrary byte-like boundaries, including JSON."""
    return [text[i : i + size] for i in range(0, len(text), size)]


def _token_stream(tokens, closed=None):
    def tracked(*args, **kwargs):
        async def generator():
            try:
                for token in tokens:
                    yield token
            finally:
                if closed is not None:
                    closed.append(True)

        return generator()

    return tracked


# --- Static parity: both runtimes must agree on the documented contract ---


def test_rel01_error_registry_is_shared_by_both_runtimes():
    adapter = _source(NEST_ADAPTER)
    service = _source(FASTAPI_MAIN)
    nest_codes = _quoted_codes(
        adapter, "export const AI_ERROR_CODES", "\n];"
    )
    fastapi_codes = _quoted_codes(
        service, "_ERROR_CODES = frozenset({", "})"
    )
    assert SHARED_ERROR_CODES <= nest_codes
    assert SHARED_ERROR_CODES <= fastapi_codes


def test_metadata_headers_and_schema_version_are_pinned():
    adapter = _source(NEST_ADAPTER)
    chat_adapter = _source(NEST_CHAT_ADAPTER)
    chat_router = _source(FASTAPI_CHAT)

    for header in (
        "X-Request-ID",
        "X-AI-Feature",
        "X-AI-Schema-Version",
        "X-AI-Deadline",
        "X-AI-Operation-ID",
        "X-AI-Envelope",
    ):
        assert f"'{header}'" in adapter, header
    assert re.search(r"AI_SCHEMA_VERSION = '\d+\.\d+\.\d+'", adapter)

    # Chat stream identity is asserted by the gateway, never by the browser.
    for header in ("X-User-ID", "X-User-Roles"):
        assert header in chat_adapter
        assert header in chat_router
    # The chat router's operation alias is set explicitly by the chat adapter;
    # the generic adapter's X-AI-Operation-ID alone is not enough for chat.
    assert "'X-Operation-ID': meta.operationId ?? meta.requestId" in chat_adapter
    assert 'alias="X-Operation-ID"' in chat_router
    assert 'alias="X-Conversation-ID"' in chat_router
    assert 'alias="X-Request-ID"' in chat_router


def test_sse_field_names_match_the_nest_parser():
    chat_router = _source(FASTAPI_CHAT)
    chat_adapter = _source(NEST_CHAT_ADAPTER)
    assert "event: {event}" in chat_router
    assert "data: {json.dumps" in chat_router
    emitted = set(re.findall(r'_sse\(\s*"([a-z]+)"', chat_router))
    assert {"accepted", "delta", "completed", "failed"} <= emitted
    assert "'delta'" in chat_adapter and "'failed'" in chat_adapter
    assert "responseType: 'stream'" in chat_adapter
    assert "signal: controller.signal" in chat_adapter


# --- Runtime parity: FastAPI emits exactly what the Nest adapter consumes ---


def test_response_headers_and_request_id_propagation():
    stream = _token_stream(["Hi"])
    request_headers = {**HEADERS, "X-Request-ID": "req-parity-1"}
    with patch("app.routers.chat.llm_client") as mock_client:
        mock_client.chat_stream = stream
        response = client.post(
            "/v1/ai/chat/stream", json=PAYLOAD, headers=request_headers
        )

    assert response.status_code == 200
    assert response.headers["content-type"] == "text/event-stream; charset=utf-8"
    assert response.headers["cache-control"] == "no-cache"
    assert response.headers["connection"] == "keep-alive"
    assert response.headers["X-Request-ID"] == "req-parity-1"


def test_unicode_deltas_survive_arbitrary_chunk_boundaries():
    tokens = ["Xin chào", " — 日本語 😀"]
    stream = _token_stream(tokens)
    with patch("app.routers.chat.llm_client") as mock_client:
        mock_client.chat_stream = stream
        response = client.post("/v1/ai/chat/stream", json=PAYLOAD, headers=HEADERS)

    events = _parse_sse(response.text)
    assert [event for event, _ in events] == [
        "accepted",
        "delta",
        "delta",
        "completed",
    ]
    assert [data["seq"] for event, data in events if event == "delta"] == [1, 2]
    assert [data["text"] for event, data in events if event == "delta"] == tokens
    assert "\\u" in response.text  # ensure_ascii keeps one physical line per event
    assert "[DONE]" not in response.text

    # Feed the exact body through a parser matching the Nest chat adapter.
    assert _nest_adapter_deltas(_chunked(response.text)) == (tokens, [])
    crlf = response.text.replace("\n", "\r\n")
    assert _nest_adapter_deltas(_chunked(crlf, 5)) == (tokens, [])


def test_operation_and_conversation_ids_are_echoed_without_sse_injection():
    stream = _token_stream(["Hi"])
    headers = {
        **HEADERS,
        "X-Operation-ID": "op-123.abc",
        "X-Conversation-ID": "conv_456",
    }
    with patch("app.routers.chat.llm_client") as mock_client:
        mock_client.chat_stream = stream
        response = client.post(
            "/v1/ai/chat/stream", json=PAYLOAD, headers=headers
        )

    events = _parse_sse(response.text)
    assert events[0] == (
        "accepted",
        {"operationId": "op-123.abc", "conversationId": "conv_456"},
    )
    assert events[-1] == ("completed", {"operationId": "op-123.abc"})
    assert _nest_adapter_deltas(_chunked(response.text)) == (["Hi"], [])


def test_invalid_identifier_headers_are_dropped():
    stream = _token_stream(["Hi"])
    headers = {
        **HEADERS,
        "X-Operation-ID": "op-1\ninjected: evil",
        "X-Conversation-ID": "conv with spaces",
    }
    with patch("app.routers.chat.llm_client") as mock_client:
        mock_client.chat_stream = stream
        response = client.post(
            "/v1/ai/chat/stream", json=PAYLOAD, headers=headers
        )

    events = _parse_sse(response.text)
    assert events[0][1] == {}
    assert events[-1][1] == {}
    assert "injected: evil" not in response.text
    assert _nest_adapter_deltas(_chunked(response.text)) == (["Hi"], [])


def test_partial_failure_is_a_safe_terminal_event_and_closes_upstream():
    closed: list[bool] = []

    def failing(*args, **kwargs):
        async def generator():
            try:
                yield "partial"
                raise RuntimeError("upstream secret: keys=do-not-leak")
            finally:
                closed.append(True)

        return generator()

    with patch("app.routers.chat.llm_client") as mock_client:
        mock_client.chat_stream = failing
        response = client.post("/v1/ai/chat/stream", json=PAYLOAD, headers=HEADERS)

    events = _parse_sse(response.text)
    assert [event for event, _ in events] == ["accepted", "delta", "failed"]
    assert events[1][1] == {"seq": 1, "text": "partial"}
    assert events[2][1] == {
        "error": {
            "code": "PROVIDER_UNAVAILABLE",
            "message": "AI service temporarily unavailable",
            "retryable": True,
        }
    }
    assert "do-not-leak" not in response.text
    assert "completed" not in [event for event, _ in events]
    assert closed == [True]
    assert _nest_adapter_deltas(_chunked(response.text)) == (
        ["partial"],
        ["PROVIDER_UNAVAILABLE"],
    )


def test_usage_is_optional_completed_metadata():
    stream = _token_stream(["Hi"])
    usage = {
        "prompt_tokens": 10,
        "completion_tokens": 3,
        "total_tokens": 13,
    }

    def with_usage(*args, **kwargs):
        mock_client.last_stream_usage = usage
        return stream(*args, **kwargs)

    with patch("app.routers.chat.llm_client") as mock_client:
        mock_client.chat_stream = with_usage
        response = client.post("/v1/ai/chat/stream", json=PAYLOAD, headers=HEADERS)

    events = _parse_sse(response.text)
    assert events[-1][0] == "completed"
    assert events[-1][1]["usage"] == usage
    assert _nest_adapter_deltas(_chunked(response.text))[1] == []


def test_identity_and_validation_failures_never_open_an_sse_stream():
    with patch("app.routers.chat.llm_client") as mock_client:
        mock_client.chat_stream = _token_stream(["Hi"])
        forbidden = client.post(
            "/v1/ai/chat/stream",
            json=PAYLOAD,
            headers={"X-API-Key": "contract-test-key"},
        )
        unsupported = client.post(
            "/v1/ai/chat/stream",
            json={
                "language": "klingon",
                "messages": [{"role": "user", "content": "Hi"}],
            },
            headers=HEADERS,
        )

    assert forbidden.status_code == 403
    assert unsupported.status_code in (400, 422)
    for response in (forbidden, unsupported):
        assert "text/event-stream" not in response.headers.get("content-type", "")
        assert "event: delta" not in response.text
