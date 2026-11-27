"""
Unit tests for LLMClient — retry logic, timeout handling, streaming,
and error propagation.

Uses pytest-asyncio + httpx mocks (via respx or hand-rolled stub).
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
import httpx

from app.services.llm_client import LLMClient
from app.config import settings


@pytest.fixture
def llm_client():
    """Return a fresh LLMClient instance (won't create real connections)."""
    return LLMClient()


# ──────────────────────────────────────────────────────────────────────────────
# _chat_completion — retry logic
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_chat_completion_success_first_attempt(llm_client: LLMClient):
    """Happy path: first request succeeds."""
    mock_response = MagicMock(spec=httpx.Response)
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "choices": [{"message": {"content": "Hello!"}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
    }
    mock_response.raise_for_status.return_value = None

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.post.return_value = mock_response
    mock_client.is_closed = False

    with patch.object(llm_client, "_get_client", return_value=mock_client):
        result = await llm_client._chat_completion(
            messages=[{"role": "user", "content": "hi"}],
            model="test-model",
            temperature=0.5,
        )

    assert result == "Hello!"
    assert mock_client.post.call_count == 1


@pytest.mark.asyncio
async def test_chat_completion_retry_on_429(llm_client: LLMClient):
    """Transient 429 → retry → success on 2nd attempt."""
    fail_response = MagicMock(spec=httpx.Response)
    fail_response.status_code = 429
    fail_response.raise_for_status.side_effect = httpx.HTTPStatusError(
        "Too Many Requests", request=MagicMock(), response=fail_response
    )

    ok_response = MagicMock(spec=httpx.Response)
    ok_response.status_code = 200
    ok_response.json.return_value = {
        "choices": [{"message": {"content": "OK after retry"}}],
    }
    ok_response.raise_for_status.return_value = None

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.post.side_effect = [fail_response, ok_response]
    mock_client.is_closed = False

    with patch.object(llm_client, "_get_client", return_value=mock_client):
        with patch("asyncio.sleep", new_callable=AsyncMock) as sleep_mock:  # skip backoff
            result = await llm_client._chat_completion(
                messages=[{"role": "user", "content": "hi"}],
                model="test-model",
                temperature=0.5,
            )

    assert result == "OK after retry"
    assert mock_client.post.call_count == 2
    assert [call.args[0] for call in sleep_mock.call_args_list] == [1.0]


@pytest.mark.asyncio
async def test_chat_completion_retry_on_connection_error(llm_client: LLMClient):
    """Connection error → retry → success."""
    ok_response = MagicMock(spec=httpx.Response)
    ok_response.status_code = 200
    ok_response.json.return_value = {
        "choices": [{"message": {"content": "recovered"}}],
    }
    ok_response.raise_for_status.return_value = None

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.post.side_effect = [
        httpx.ConnectError("connection refused"),
        ok_response,
    ]
    mock_client.is_closed = False

    with patch.object(llm_client, "_get_client", return_value=mock_client):
        with patch("asyncio.sleep", new_callable=AsyncMock) as sleep_mock:
            result = await llm_client._chat_completion(
                messages=[{"role": "user", "content": "hi"}],
                model="test-model",
                temperature=0.5,
            )

    assert result == "recovered"
    assert mock_client.post.call_count == 2
    assert [call.args[0] for call in sleep_mock.call_args_list] == [1.0]


@pytest.mark.asyncio
async def test_chat_completion_no_retry_on_400(llm_client: LLMClient):
    """Non-transient error (400) should NOT be retried."""
    fail_response = MagicMock(spec=httpx.Response)
    fail_response.status_code = 400
    fail_response.raise_for_status.side_effect = httpx.HTTPStatusError(
        "Bad Request", request=MagicMock(), response=fail_response
    )

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.post.return_value = fail_response
    mock_client.is_closed = False

    with patch.object(llm_client, "_get_client", return_value=mock_client):
        with pytest.raises(httpx.HTTPStatusError):
            await llm_client._chat_completion(
                messages=[{"role": "user", "content": "hi"}],
                model="test-model",
                temperature=0.5,
            )

    # Only 1 attempt, no retry
    assert mock_client.post.call_count == 1


@pytest.mark.asyncio
async def test_chat_completion_exhausts_retries(llm_client: LLMClient):
    """After 3 retries, raise the last error."""
    fail_response = MagicMock(spec=httpx.Response)
    fail_response.status_code = 502
    fail_response.raise_for_status.side_effect = httpx.HTTPStatusError(
        "Bad Gateway", request=MagicMock(), response=fail_response
    )

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.post.return_value = fail_response
    mock_client.is_closed = False

    with patch.object(llm_client, "_get_client", return_value=mock_client):
        with patch("asyncio.sleep", new_callable=AsyncMock) as sleep_mock:
            with pytest.raises(httpx.HTTPStatusError):
                await llm_client._chat_completion(
                    messages=[{"role": "user", "content": "hi"}],
                    model="test-model",
                    temperature=0.5,
                )

    assert mock_client.post.call_count == 3
    # Exponential backoff: 1s before attempt 2, 2s before attempt 3.
    assert [call.args[0] for call in sleep_mock.call_args_list] == [1.0, 2.0]


# ──────────────────────────────────────────────────────────────────────────────
# generate — wraps _chat_completion
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_generate_with_system_prompt(llm_client: LLMClient):
    """generate() should prepend system message and call _chat_completion."""
    with patch.object(
        llm_client,
        "_chat_completion",
        new_callable=AsyncMock,
        return_value="generated text",
    ) as mock_completion:
        result = await llm_client.generate(
            prompt="Hello",
            system="You are helpful",
            temperature=0.3,
            max_tokens=100,
        )

    assert result == "generated text"
    call_args = mock_completion.call_args
    messages = call_args[1]["messages"]
    assert messages[0] == {"role": "system", "content": "You are helpful"}
    assert messages[1] == {"role": "user", "content": "Hello"}
    assert call_args[1]["temperature"] == 0.3
    assert call_args[1]["max_tokens"] == 100


# ──────────────────────────────────────────────────────────────────────────────
# chat_stream — async generator
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_chat_stream_yields_tokens(llm_client: LLMClient):
    """Stream should yield tokens from SSE lines."""

    class FakeResponse:
        status_code = 200
        async def aiter_lines(self):
            yield 'data: {"choices":[{"delta":{"content":"Hello"}}]}'
            yield 'data: {"choices":[{"delta":{"content":" world"}}]}'
            yield "data: [DONE]"

    class FakeStream:
        async def __aenter__(self):
            return FakeResponse()
        async def __aexit__(self, *args):
            pass

    def fake_stream(*args, **kwargs):
        return FakeStream()

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.stream = fake_stream
    mock_client.is_closed = False

    with patch.object(llm_client, "_get_client", return_value=mock_client):
        tokens = []
        async for token in llm_client.chat_stream(
            messages=[{"role": "user", "content": "hi"}],
        ):
            tokens.append(token)

    assert tokens == ["Hello", " world"]


@pytest.mark.asyncio
async def test_chat_stream_skips_malformed_lines(llm_client: LLMClient):
    """Malformed JSON lines should be silently skipped."""

    class FakeResponse:
        status_code = 200
        async def aiter_lines(self):
            yield "data: broken json {{{"
            yield 'data: {"choices":[{"delta":{"content":"valid"}}]}'
            yield "data: [DONE]"

    class FakeStream:
        async def __aenter__(self):
            return FakeResponse()
        async def __aexit__(self, *args):
            pass

    def fake_stream(*args, **kwargs):
        return FakeStream()

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.stream = fake_stream
    mock_client.is_closed = False

    with patch.object(llm_client, "_get_client", return_value=mock_client):
        tokens = []
        async for token in llm_client.chat_stream(
            messages=[{"role": "user", "content": "hi"}],
        ):
            tokens.append(token)

    assert tokens == ["valid"]


@pytest.mark.asyncio
async def test_chat_stream_raises_on_transient_429(llm_client: LLMClient):
    """A rate-limited stream must surface HTTPStatusError, not an empty 200-like stream."""

    class FakeResponse:
        status_code = 429

        def raise_for_status(self):
            raise httpx.HTTPStatusError(
                "Too Many Requests",
                request=httpx.Request("POST", "http://test/v1/chat/completions"),
                response=httpx.Response(429),
            )

        async def aiter_lines(self):
            yield 'data: {"error":{"message":"rate limited"}}'

    class FakeStream:
        async def __aenter__(self):
            return FakeResponse()

        async def __aexit__(self, *args):
            pass

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.stream = lambda *args, **kwargs: FakeStream()
    mock_client.is_closed = False

    with patch.object(llm_client, "_get_client", return_value=mock_client):
        with pytest.raises(httpx.HTTPStatusError):
            async for _ in llm_client.chat_stream(
                messages=[{"role": "user", "content": "hi"}],
            ):
                pass


@pytest.mark.asyncio
async def test_chat_stream_non_transient_error_yields_no_tokens(
    llm_client: LLMClient,
):
    """Error payloads in a non-transient (400) response must never be streamed as content."""

    class FakeResponse:
        status_code = 400

        def raise_for_status(self):
            return None

        async def aiter_lines(self):
            yield 'data: {"error":{"message":"bad request"}}'

    class FakeStream:
        async def __aenter__(self):
            return FakeResponse()

        async def __aexit__(self, *args):
            pass

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.stream = lambda *args, **kwargs: FakeStream()
    mock_client.is_closed = False

    with patch.object(llm_client, "_get_client", return_value=mock_client):
        tokens = [
            token
            async for token in llm_client.chat_stream(
                messages=[{"role": "user", "content": "hi"}],
            )
        ]

    assert tokens == []


@pytest.mark.asyncio
async def test_generate_stream_forwards_tokens(llm_client: LLMClient):
    """generate_stream() should forward every token from chat_stream()."""

    async def fake_chat_stream(**kwargs):
        assert kwargs["messages"][0] == {"role": "system", "content": "Be brief"}
        assert kwargs["messages"][1] == {"role": "user", "content": "hi"}
        for token in ("Hello", " world"):
            yield token

    with patch.object(llm_client, "chat_stream", side_effect=fake_chat_stream):
        tokens = [
            token
            async for token in llm_client.generate_stream(
                prompt="hi", system="Be brief"
            )
        ]

    assert tokens == ["Hello", " world"]


# ──────────────────────────────────────────────────────────────────────────────
# health_check
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_health_check_returns_true_on_200(llm_client: LLMClient):
    mock_response = MagicMock(spec=httpx.Response)
    mock_response.status_code = 200

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.post.return_value = mock_response
    mock_client.is_closed = False

    with patch.object(llm_client, "_get_client", return_value=mock_client):
        result = await llm_client.health_check()

    assert result is True


@pytest.mark.asyncio
async def test_health_check_returns_false_on_exception(llm_client: LLMClient):
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.post.side_effect = httpx.ConnectError("down")
    mock_client.is_closed = False

    with patch.object(llm_client, "_get_client", return_value=mock_client):
        result = await llm_client.health_check()

    assert result is False


@pytest.mark.asyncio
async def test_health_check_returns_false_on_503(llm_client: LLMClient):
    """A non-200 health response means the LLM backend is unavailable."""
    mock_response = MagicMock(spec=httpx.Response)
    mock_response.status_code = 503

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.post.return_value = mock_response
    mock_client.is_closed = False

    with patch.object(llm_client, "_get_client", return_value=mock_client):
        result = await llm_client.health_check()

    assert result is False