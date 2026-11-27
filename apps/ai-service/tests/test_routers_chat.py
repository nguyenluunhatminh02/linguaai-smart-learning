import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch, MagicMock

from app.main import app
from app.config import settings

client = TestClient(app)


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
            headers={"X-API-Key": "test-api-key-123"},
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
            headers={"X-API-Key": "test-api-key-123"},
            json={
                "language": "English",
                "messages": [{"role": "user", "content": "Hello"}],
            },
        )

        assert response.status_code == 503
        assert response.json() == {"detail": "AI service temporarily unavailable"}


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
    """Happy path: chat stream succeeds and returns SSE chunks."""
    async def mock_async_generator(*args, **kwargs):
        yield "Hello"
        yield " world"
        yield "!"

    with patch("app.routers.chat.llm_client") as mock_client:
        mock_client.chat_stream = mock_async_generator

        response = client.post(
            "/v1/ai/chat/stream",
            headers={"X-API-Key": "test-api-key-123"},
            json={
                "language": "English",
                "messages": [{"role": "user", "content": "Hello"}],
            },
        )

        assert response.status_code == 200
        assert response.headers["content-type"] == "text/event-stream; charset=utf-8"

        # Verify the chunks streamed back
        expected_content = (
            'data: {"token": "Hello"}\n\n'
            'data: {"token": " world"}\n\n'
            'data: {"token": "!"}\n\n'
            'data: [DONE]\n\n'
        )
        assert response.text == expected_content


@pytest.mark.asyncio
async def test_chat_stream_emits_stream_interrupted_on_llm_failure():
    """A mid-stream upstream failure must end the SSE stream with an error event."""
    async def failing_async_generator(*args, **kwargs):
        yield "partial"
        raise RuntimeError("upstream dropped")

    with patch("app.routers.chat.llm_client") as mock_client:
        mock_client.chat_stream = failing_async_generator

        response = client.post(
            "/v1/ai/chat/stream",
            headers={"X-API-Key": "test-api-key-123"},
            json={
                "language": "English",
                "messages": [{"role": "user", "content": "Hello"}],
            },
        )

        assert response.status_code == 200
        assert 'data: {"token": "partial"}\n\n' in response.text
        assert 'data: {"error": "stream_interrupted"}\n\n' in response.text
        assert "[DONE]" not in response.text


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
    assert response.json() == {"detail": "AI returned invalid JSON"}
    # The retry uses temperature 0.1 and must not hit the cache between attempts.
    assert mock_generate.await_count == 2
    assert [c.kwargs.get("temperature") for c in mock_generate.await_args_list] == [0.3, 0.1]

