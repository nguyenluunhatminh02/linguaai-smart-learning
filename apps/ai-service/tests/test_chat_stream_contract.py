"""Contract tests for /v1/ai/chat/stream SSE wire format.

These tests pin the roadmap SSE contract currently implemented by the service:
    event: accepted  data: {...}
    event: delta     data: {"seq": N, "text": "..."}
    event: completed data: {...}
    event: failed    data: {"error": {"code": ..., "message": ..., "retryable": ...}}

No [DONE] marker is used. Terminal events are 'completed' and 'failed'.
"""

import json
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app

client = TestClient(app)

PAYLOAD = {
    "language": "english",
    "messages": [{"role": "user", "content": "Hello"}],
}
# Paid chat routes require both the service API key and gateway-asserted
# client identity headers; an API key alone never bypasses the role gate.
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
    """Avoid 429s across many tests in the same minute."""
    app.state.limiter.enabled = False
    yield
    app.state.limiter.enabled = True


def _parse_sse(text: str) -> list[tuple[str, dict]]:
    """Parse SSE text into ordered (event_name, data_dict) pairs."""
    events = []
    for block in text.strip().split("\n\n"):
        if not block.strip():
            continue
        lines = block.split("\n")
        event_name = None
        data = None
        for line in lines:
            if line.startswith("event: "):
                event_name = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
        assert event_name is not None, f"Missing event name in: {block!r}"
        assert data is not None, f"Missing data in: {block!r}"
        events.append((event_name, data))
    return events


def _make_token_stream(tokens, closed=None):
    """Return a tracked chat_stream replacement returning a proper async generator."""
    calls = []

    def tracked(*args, **kwargs):
        calls.append((args, kwargs))

        async def generator():
            try:
                for token in tokens:
                    yield token
            finally:
                if closed is not None:
                    closed.append(True)

        return generator()

    return tracked, calls


@pytest.mark.asyncio
async def test_stream_response_headers():
    stream, _ = _make_token_stream(["Hi"])
    with patch("app.routers.chat.llm_client") as mock_client:
        mock_client.chat_stream = stream
        response = client.post("/v1/ai/chat/stream", json=PAYLOAD, headers=HEADERS)

    assert response.status_code == 200
    assert response.headers["content-type"] == "text/event-stream; charset=utf-8"
    assert response.headers["cache-control"] == "no-cache"
    assert response.headers["connection"] == "keep-alive"


@pytest.mark.asyncio
async def test_stream_normal_completion_event_sequence():
    stream, calls = _make_token_stream(["Hello", " world"])
    with patch("app.routers.chat.llm_client") as mock_client:
        mock_client.chat_stream = stream
        response = client.post("/v1/ai/chat/stream", json=PAYLOAD, headers=HEADERS)

    events = _parse_sse(response.text)
    assert [event for event, _ in events] == ["accepted", "delta", "delta", "completed"]
    assert events[0][1] == {}
    assert events[1][1] == {"seq": 1, "text": "Hello"}
    assert events[2][1] == {"seq": 2, "text": " world"}
    assert events[3][1] == {}
    assert "[DONE]" not in response.text

    assert len(calls) == 1
    kwargs = calls[0][1]
    assert kwargs["model"] == settings.groq_model_heavy
    assert kwargs["temperature"] == 0.7
    assert [m["role"] for m in kwargs["messages"]] == ["system", "user"]
    assert kwargs["messages"][1]["content"] == "<user_input>Hello</user_input>"


@pytest.mark.asyncio
async def test_stream_completed_includes_usage_when_provider_reports_it():
    stream, _ = _make_token_stream(["Hi"])

    def set_usage(*args, **kwargs):
        mock_client.last_stream_usage = {
            "prompt_tokens": 10,
            "completion_tokens": 3,
            "total_tokens": 13,
        }
        return stream(*args, **kwargs)

    with patch("app.routers.chat.llm_client") as mock_client:
        mock_client.chat_stream = set_usage
        response = client.post("/v1/ai/chat/stream", json=PAYLOAD, headers=HEADERS)

    events = _parse_sse(response.text)
    assert events[-1][0] == "completed"
    assert events[-1][1]["usage"] == {
        "prompt_tokens": 10,
        "completion_tokens": 3,
        "total_tokens": 13,
    }


@pytest.mark.asyncio
async def test_stream_echoes_validated_operation_and_conversation_ids():
    stream, _ = _make_token_stream(["Hi"])
    headers = {
        **HEADERS,
        "X-Operation-ID": "op-123.abc",
        "X-Conversation-ID": "conv_456",
    }
    with patch("app.routers.chat.llm_client") as mock_client:
        mock_client.chat_stream = stream
        response = client.post("/v1/ai/chat/stream", json=PAYLOAD, headers=headers)

    events = _parse_sse(response.text)
    assert events[0] == (
        "accepted",
        {"operationId": "op-123.abc", "conversationId": "conv_456"},
    )
    assert events[-1] == (
        "completed",
        {"operationId": "op-123.abc"},
    )


@pytest.mark.asyncio
async def test_stream_drops_invalid_identifier_headers():
    stream, _ = _make_token_stream(["Hi"])
    # Newlines / spaces cannot be smuggled into SSE data via headers.
    headers = {
        **HEADERS,
        "X-Operation-ID": "op-1\ninjected: evil",
        "X-Conversation-ID": "conv with spaces",
    }
    with patch("app.routers.chat.llm_client") as mock_client:
        mock_client.chat_stream = stream
        response = client.post("/v1/ai/chat/stream", json=PAYLOAD, headers=headers)

    events = _parse_sse(response.text)
    assert events[0][1] == {}
    assert events[-1][1] == {}


@pytest.mark.asyncio
async def test_stream_provider_failure_emits_failed_after_partial_deltas():
    def failing(*args, **kwargs):
        async def generator():
            yield "partial"
            raise RuntimeError("upstream dropped")

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
    assert "completed" not in [event for event, _ in events]
    assert "[DONE]" not in response.text


@pytest.mark.asyncio
async def test_stream_provider_failure_before_any_delta():
    def failing(*args, **kwargs):
        async def generator():
            raise RuntimeError("provider down")
            yield  # pragma: no cover

        return generator()

    with patch("app.routers.chat.llm_client") as mock_client:
        mock_client.chat_stream = failing
        response = client.post("/v1/ai/chat/stream", json=PAYLOAD, headers=HEADERS)

    events = _parse_sse(response.text)
    assert [event for event, _ in events] == ["accepted", "failed"]
    assert events[-1][1]["error"]["code"] == "PROVIDER_UNAVAILABLE"


@pytest.mark.parametrize(
    "extra_headers,expected_status",
    [
        ({"X-User-ID": "user-123", "X-User-Roles": "user"}, 200),
        ({"X-User-ID": "user-123", "X-User-Roles": "admin,service"}, 200),
        ({"X-User-ID": "user-123", "X-User-Roles": "admin"}, 200),
        ({"X-User-ID": "user-123", "X-User-Roles": "root"}, 403),
        ({"X-User-ID": "bad id", "X-User-Roles": "user"}, 403),
        ({"X-User-ID": "user-123", "X-User-Roles": None}, 403),
        ({"X-User-ID": None, "X-User-Roles": "user"}, 403),
    ],
)
@pytest.mark.asyncio
async def test_stream_client_role_validation(extra_headers, expected_status):
    stream, _ = _make_token_stream(["Hi"])
    # A None value means the header must be absent entirely: a privileged
    # role or a missing identity can never be bypassed by the API key.
    headers = {**HEADERS}
    for key, value in extra_headers.items():
        if value is None:
            headers.pop(key, None)
        else:
            headers[key] = value
    with patch("app.routers.chat.llm_client") as mock_client:
        mock_client.chat_stream = stream
        response = client.post(
            "/v1/ai/chat/stream",
            json=PAYLOAD,
            headers=headers,
        )
    assert response.status_code == expected_status
    if expected_status == 403:
        # Invalid/missing gateway identity stays a 403; the wire body is the
        # shared structured error envelope, never a flat "detail" string.
        error = response.json()["error"]
        assert error["code"] == "UNAUTHORIZED"
        assert error["retryable"] is False
        assert error["message"] == "Invalid or missing API key"


@pytest.mark.asyncio
async def test_stream_rejects_unsupported_language_before_starting_sse():
    """Unsupported language is rejected before SSE begins (400 or schema 422)."""
    response = client.post(
        "/v1/ai/chat/stream",
        json={"language": "klingon", "messages": [{"role": "user", "content": "Hi"}]},
        headers=HEADERS,
    )
    assert response.status_code in (400, 422)
    assert "text/event-stream" not in response.headers.get("content-type", "")


@pytest.mark.asyncio
async def test_stream_rejects_empty_messages():
    response = client.post(
        "/v1/ai/chat/stream",
        json={"language": "english", "messages": []},
        headers=HEADERS,
    )
    assert response.status_code == 422
