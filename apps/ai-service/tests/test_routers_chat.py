import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch, MagicMock

from app.main import app
from app.config import settings

client = TestClient(app)

# Every chat route requires gateway-asserted client identity in addition to
# the service API key. The API-key-only cases below still test the 401 gate.
AUTH_HEADERS = {
    "X-API-Key": "test-api-key-123",
    "X-User-ID": "user-123",
    "X-User-Roles": "user",
}


@pytest.fixture(autouse=True)
def setup_api_keys(monkeypatch):
    """Set up test API keys for verify_key dependency."""
    monkeypatch.setattr(settings, "api_keys", "test-api-key-123")


# ──────────────────────────────────────────────────────────────────────────────
# Chat Endpoint Tests
# ──────────────────────────────────────────────────────────────────────────────


def test_chat_requires_api_key():
    """Request without X-API-Key should return 401."""
    response = client.post(
        "/v1/ai/chat",
        json={"language": "English", "messages": [{"role": "user", "content": "Hello"}]},
    )
    assert response.status_code == 401


def test_chat_rejects_invalid_api_key():
    """Request with wrong X-API-Key should return 401."""
    response = client.post(
        "/v1/ai/chat",
        headers={"X-API-Key": "wrong-key"},
        json={"language": "English", "messages": [{"role": "user", "content": "Hello"}]},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_chat_success_with_valid_key():
    """Happy path: chat succeeds with valid key and mocked LLM client."""
    mock_chat_response = "Hello! I am your AI language tutor."

    with patch("app.routers.chat.llm_client") as mock_client:
        mock_client.chat = AsyncMock(return_value=mock_chat_response)

        response = client.post(
            "/v1/ai/chat",
            headers=AUTH_HEADERS,
            json={
                "language": "English",
                "messages": [{"role": "user", "content": "Hello"}],
            },
        )

        assert response.status_code == 200
        assert response.json() == {"response": mock_chat_response}
        mock_client.chat.assert_called_once()

        # Prompt-injection defense: every user message must be wrapped before it
        # reaches the LLM, and the heavy model must be selected explicitly.
        call_kwargs = mock_client.chat.call_args.kwargs
        assert [m["role"] for m in call_kwargs["messages"]] == ["system", "user"]
        assert call_kwargs["messages"][1]["content"] == "<user_input>Hello</user_input>"
        assert call_kwargs["model"] == settings.groq_model_heavy


@pytest.mark.asyncio
async def test_chat_maps_llm_failure_to_503():
    """An upstream LLM error must surface as the documented JSON 503 contract."""
    with patch("app.routers.chat.llm_client") as mock_client:
        mock_client.chat = AsyncMock(side_effect=RuntimeError("upstream down"))

        response = client.post(
            "/v1/ai/chat",
            headers=AUTH_HEADERS,
            json={
                "language": "English",
                "messages": [{"role": "user", "content": "Hello"}],
            },
        )

        assert response.status_code == 503
        error = response.json()["error"]
        assert error["code"] == "PROVIDER_UNAVAILABLE"
        assert error["message"] == "AI service temporarily unavailable"
        assert error["retryable"] is True


# ──────────────────────────────────────────────────────────────────────────────
# Chat Stream Endpoint Tests
# ──────────────────────────────────────────────────────────────────────────────


def test_chat_stream_requires_api_key():
    """Stream request without X-API-Key should return 401."""
    response = client.post(
        "/v1/ai/chat/stream",
        json={"language": "English", "messages": [{"role": "user", "content": "Hello"}]},
    )
    assert response.status_code == 401


def test_chat_stream_rejects_invalid_api_key():
    """Stream request with wrong X-API-Key should return 401."""
    response = client.post(
        "/v1/ai/chat/stream",
        headers={"X-API-Key": "wrong-key"},
        json={"language": "English", "messages": [{"role": "user", "content": "Hello"}]},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_chat_stream_success_with_valid_key():
    """Happy path: chat stream succeeds and returns SSE chunks in roadmap contract."""
    calls = []

    def tracked_chat_stream(*args, **kwargs):
        calls.append((args, kwargs))
        async def generator():
            yield "Hello"
            yield " world"
            yield "!"
        return generator()

    with patch("app.routers.chat.llm_client") as mock_client:
        mock_client.chat_stream = tracked_chat_stream
        # Clear any cached usage from previous tests
        if hasattr(mock_client, "last_stream_usage"):
            delattr(mock_client, "last_stream_usage")

        response = client.post(
            "/v1/ai/chat/stream",
            headers=AUTH_HEADERS,
            json={
                "language": "English",
                "messages": [{"role": "user", "content": "Hello"}],
            },
        )

        assert response.status_code == 200
        assert response.headers["content-type"] == "text/event-stream; charset=utf-8"
        assert response.headers["cache-control"] == "no-cache"

        # Verify the roadmap SSE contract: accepted → delta (seq 1,2,3) → completed
        lines = response.text.strip().split("\n\n")
        assert len(lines) == 5  # accepted + 3 deltas + completed

        # Event 1: accepted
        assert lines[0] == 'event: accepted\ndata: {}'

        # Events 2-4: delta with seq
        assert lines[1] == 'event: delta\ndata: {"seq":1,"text":"Hello"}'
        assert lines[2] == 'event: delta\ndata: {"seq":2,"text":" world"}'
        assert lines[3] == 'event: delta\ndata: {"seq":3,"text":"!"}'

        # Event 5: completed (no usage since mock doesn't set last_stream_usage)
        assert lines[4] == 'event: completed\ndata: {}'

        # Verify the LLM client was called with correct parameters
        assert len(calls) == 1
        call_kwargs = calls[0][1]
        assert call_kwargs["model"] == settings.groq_model_heavy
        assert call_kwargs["temperature"] == 0.7
        # Messages must be wrapped with <user_input> tags
        assert call_kwargs["messages"][1]["content"] == "<user_input>Hello</user_input>"


@pytest.mark.asyncio
async def test_chat_stream_emits_failed_on_llm_failure():
    """A mid-stream upstream failure must emit a 'failed' event with structured error."""
    async def failing_async_generator(*args, **kwargs):
        yield "partial"
        raise RuntimeError("upstream dropped")

    with patch("app.routers.chat.llm_client") as mock_client:
        mock_client.chat_stream = failing_async_generator

        response = client.post(
            "/v1/ai/chat/stream",
            headers=AUTH_HEADERS,
            json={
                "language": "English",
                "messages": [{"role": "user", "content": "Hello"}],
            },
        )

        assert response.status_code == 200
        # Verify the roadmap SSE contract for failures
        lines = response.text.strip().split("\n\n")
        assert len(lines) == 3  # accepted + 1 delta + failed

        # Event 1: accepted
        assert lines[0] == 'event: accepted\ndata: {}'

        # Event 2: delta with partial token
        assert lines[1] == 'event: delta\ndata: {"seq":1,"text":"partial"}'

        # Event 3: failed with structured error payload
        assert lines[2].startswith('event: failed\ndata: ')
        import json
        error_data = json.loads(lines[2].split('data: ')[1])
        assert error_data["error"]["code"] == "PROVIDER_UNAVAILABLE"
        assert error_data["error"]["retryable"] is True
        assert "message" in error_data["error"]


# ──────────────────────────────────────────────────────────────────────────────
# Writing assessment / ai_json_request error-contract tests
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_writing_invalid_json_twice_returns_502():
    """Two malformed completions must map to 502 rather than an unhandled 500."""
    writing_payload = {
        # Unique text keeps this test independent of cached results from the
        # writing-router happy-path test (cache keys include the full prompt).
        "user_text": "I has a dog. invalid-json-contract-check.",
        "language": "english",
        "target_level": "B1",
    }
    with patch(
        "app.services.llm_client.LLMClient.generate",
        new_callable=AsyncMock,
        return_value="not json at all",
    ) as mock_generate:
        response = client.post(
            "/v1/ai/writing/assess",
            headers={"X-API-Key": "test-api-key-123"},
            json=writing_payload,
        )

    assert response.status_code == 502
    error = response.json()["error"]
    assert error["code"] == "INVALID_AI_OUTPUT"
    assert error["retryable"] is False
    # The retry uses temperature 0.1 and must not hit the cache between attempts.
    assert mock_generate.await_count == 2
    assert [c.kwargs.get("temperature") for c in mock_generate.await_args_list] == [0.3, 0.1]

