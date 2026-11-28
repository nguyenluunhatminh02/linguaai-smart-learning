"""Tests for the AI-service error contract (REL-09).

Covers two layers:

* ``app.core.exceptions`` — the REL-01 code registry and the typed exception
  hierarchy. Only bounded, documented codes are exposed to clients.
* The FastAPI error envelope — the structured ``{"error": {...}}`` body that
  ``app.main`` emits for unhandled errors, HTTPExceptions, typed exceptions,
  validation failures, and provider failures mapped by routers.

All providers are mocked/faked. No live provider calls, real keys or ``.env``
values are used.
"""

import asyncio
import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import HTTPException, Request
from fastapi.testclient import TestClient

from app.config import settings
from app.core.exceptions import (
    AiErrorCode,
    AIServiceException,
    BudgetExceededException,
    ConcurrencyLimitExceededException,
    ERROR_SPECS,
    InternalErrorException,
    InvalidAIOutputException,
    LLMUnavailableException,
    OperationUnknownException,
    ProviderTimeoutException,
    ProviderUnavailableException,
    RateLimitExceededException,
    UnauthorizedException,
    ValidationException,
    build_error_payload,
)
from app.main import app, global_exception_handler
from app.utils import ai_json_request

client = TestClient(app, raise_server_exceptions=False)

CHAT_HEADERS = {
    "X-API-Key": "error-contract-test-key",
    "X-User-ID": "user-123",
    "X-User-Roles": "user",
}
CHAT_PAYLOAD = {
    "language": "english",
    "messages": [{"role": "user", "content": "Hello"}],
}


@pytest.fixture(autouse=True)
def setup_api_key(monkeypatch):
    monkeypatch.setattr(settings, "api_keys", "error-contract-test-key")


@pytest.fixture(autouse=True)
def disable_rate_limit():
    """Avoid cross-test 429s from the permissive per-minute limiter."""
    app.state.limiter.enabled = False
    yield
    app.state.limiter.enabled = True


def _request(headers: list[tuple[bytes, bytes]] | None = None) -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/v1/ai/chat",
            "headers": headers or [],
        }
    )


# ---------------------------------------------------------------------------
# REL-01 error-code registry and typed exceptions
# ---------------------------------------------------------------------------


def test_registry_covers_nine_roadmap_codes():
    assert {code.value for code in AiErrorCode} == {
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
    assert set(ERROR_SPECS) == set(AiErrorCode)


@pytest.mark.parametrize(
    "code,status_code,retryable",
    [
        (AiErrorCode.VALIDATION_ERROR, 400, False),
        (AiErrorCode.INSUFFICIENT_CREDITS, 403, False),
        (AiErrorCode.OPERATION_CONFLICT, 409, False),
        (AiErrorCode.RATE_LIMITED, 429, True),
        (AiErrorCode.PROVIDER_UNAVAILABLE, 503, True),
        (AiErrorCode.PROVIDER_TIMEOUT, 504, True),
        (AiErrorCode.INVALID_AI_OUTPUT, 502, False),
        (AiErrorCode.OPERATION_UNKNOWN, 503, False),
        (AiErrorCode.INTERNAL_ERROR, 500, False),
    ],
)
def test_error_specs_have_documented_status_and_retryability(
    code, status_code, retryable
):
    spec = ERROR_SPECS[code]
    assert spec.status_code == status_code
    assert spec.retryable is retryable
    assert isinstance(spec.message, str) and spec.message


def test_build_error_payload_discards_arbitrary_detail():
    """Caller/provider text must never override a registered fixed message."""
    payload = build_error_payload(
        AiErrorCode.PROVIDER_UNAVAILABLE,
        detail="provider said sk-secret-token",
        request_id="req-123",
    )
    error = payload["error"]
    assert error["code"] == "PROVIDER_UNAVAILABLE"
    assert error["message"] == "AI service temporarily unavailable"
    assert error["retryable"] is True
    assert error["requestId"] == "req-123"
    assert payload["error_code"] == "PROVIDER_UNAVAILABLE"
    assert "sk-secret-token" not in json.dumps(payload)


def test_build_error_payload_includes_retry_after():
    payload = build_error_payload(AiErrorCode.RATE_LIMITED, retry_after=30)
    assert payload["retry_after"] == 30


@pytest.mark.parametrize(
    "exc_type,status_code,error_code",
    [
        (ValidationException, 400, "VALIDATION_ERROR"),
        (UnauthorizedException, 401, "VALIDATION_ERROR"),
        (RateLimitExceededException, 429, "RATE_LIMITED"),
        (ConcurrencyLimitExceededException, 429, "RATE_LIMITED"),
        (BudgetExceededException, 429, "RATE_LIMITED"),
        (InvalidAIOutputException, 502, "INVALID_AI_OUTPUT"),
        (ProviderUnavailableException, 503, "PROVIDER_UNAVAILABLE"),
        (ProviderTimeoutException, 504, "PROVIDER_TIMEOUT"),
        (OperationUnknownException, 503, "OPERATION_UNKNOWN"),
        (InternalErrorException, 500, "INTERNAL_ERROR"),
    ],
)
def test_typed_exceptions_map_to_documented_status_and_code(
    exc_type, status_code, error_code
):
    exc = exc_type()
    assert isinstance(exc, AIServiceException)
    assert isinstance(exc, HTTPException)
    assert exc.status_code == status_code
    assert exc.error_code == error_code
    assert isinstance(exc.detail, str)


def test_legacy_llm_unavailable_alias_is_provider_unavailable():
    assert LLMUnavailableException is ProviderUnavailableException
    exc = LLMUnavailableException("upstream failed")
    assert exc.error_code == "PROVIDER_UNAVAILABLE"
    assert exc.status_code == 503


def test_base_exception_without_code_falls_back_to_internal_error():
    exc = AIServiceException(status_code=500, detail="raw provider failure sk-secret")
    assert exc.code is None
    assert exc.error_code is None
    payload = exc.payload()
    assert payload["error"]["code"] == "INTERNAL_ERROR"
    assert "sk-secret" not in json.dumps(payload)


def test_rate_limit_exception_retains_retry_after():
    exc = RateLimitExceededException("Too many chat requests", retry_after=60)
    assert exc.retry_after == 60
    assert exc.error_code == "RATE_LIMITED"
    assert exc.payload()["retry_after"] == 60


# ---------------------------------------------------------------------------
# FastAPI error envelope
# ---------------------------------------------------------------------------


def test_global_handler_emits_bounded_500_envelope():
    result = asyncio.run(global_exception_handler(_request(), RuntimeError("sk-secret")))
    assert result.status_code == 500
    body = json.loads(result.body)
    assert body["error"]["code"] == "INTERNAL_ERROR"
    assert body["error"]["message"] == "AI service temporarily unavailable"
    assert body["error"]["retryable"] is False
    assert "sk-secret" not in result.body.decode()


def test_global_handler_preserves_http_exception_status_with_safe_code():
    result = asyncio.run(
        global_exception_handler(
            _request(), HTTPException(status_code=400, detail="VALIDATION_ERROR")
        )
    )
    assert result.status_code == 400
    body = json.loads(result.body)
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert body["error"]["message"] == "Invalid AI request"


def test_typed_exception_error_code_is_serialized_in_http_envelope():
    """The typed AIServiceException error_code reaches the client envelope."""
    from app.main import ai_service_exception_handler

    result = asyncio.run(
        ai_service_exception_handler(
            _request(), ProviderUnavailableException("upstream unavailable")
        )
    )
    body = json.loads(result.body)
    assert result.status_code == 503
    assert body["error"]["code"] == "PROVIDER_UNAVAILABLE"
    assert body["error"]["message"] == "AI service temporarily unavailable"
    assert body["error"]["retryable"] is True
    assert "upstream unavailable" not in result.body.decode()


def test_request_validation_error_uses_validation_envelope():
    response = client.post(
        "/v1/ai/chat",
        json={"language": "english", "messages": []},
        headers=CHAT_HEADERS,
    )
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert body["error"]["retryable"] is False
    # Raw pydantic field paths/input values must not be echoed.
    assert "messages" not in json.dumps(body)


def test_oversized_content_length_uses_bounded_envelope():
    response = client.post(
        "/v1/ai/chat",
        json=CHAT_PAYLOAD,
        headers={**CHAT_HEADERS, "Content-Length": "99999999"},
    )
    assert response.status_code == 413
    # The middleware short-circuits before exception handlers, so it keeps its
    # legacy two-field body with a bounded legacy code.
    assert response.json() == {
        "detail": "Request body too large",
        "error_code": "REQUEST_TOO_LARGE",
    }


def test_unknown_error_code_is_not_forwarded_to_client():
    """A fabricated client-supplied code is replaced by the status-derived code."""
    from app.main import _bounded_code

    assert _bounded_code("PROVIDER_UNAVAILABLE\nINJECTED", 400) == "VALIDATION_ERROR"
    assert _bounded_code("DANGEROUS_CODE", 503) == "PROVIDER_UNAVAILABLE"


def test_error_envelope_includes_validated_operation_id():
    headers = [(b"x-ai-operation-id", b"op-123.abc")]
    result = asyncio.run(global_exception_handler(_request(headers), RuntimeError("boom")))
    body = json.loads(result.body)
    assert body["error"]["operationId"] == "op-123.abc"


def test_error_envelope_drops_invalid_operation_id():
    headers = [(b"x-ai-operation-id", b"op-1\ninjected: evil")]
    result = asyncio.run(global_exception_handler(_request(headers), RuntimeError("boom")))
    body = json.loads(result.body)
    operation_id = body["error"]["operationId"]
    assert "\n" not in operation_id
    assert operation_id != "op-1\ninjected: evil"


# ---------------------------------------------------------------------------
# Provider error mapping at route boundaries
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "provider_error",
    [
        RuntimeError("provider connection failed"),
        httpx.ConnectError("connection refused"),
        httpx.HTTPStatusError(
            "Bad Gateway",
            request=httpx.Request("POST", "http://test/v1/chat/completions"),
            response=httpx.Response(502),
        ),
    ],
)
def test_chat_maps_provider_errors_to_safe_503_envelope(provider_error):
    """No provider exception text is echoed back to the caller."""
    with patch("app.routers.chat.llm_client") as mock_client:
        mock_client.chat = AsyncMock(side_effect=provider_error)
        response = client.post("/v1/ai/chat", json=CHAT_PAYLOAD, headers=CHAT_HEADERS)

    assert response.status_code == 503
    body = response.json()
    assert body["error"]["code"] == "PROVIDER_UNAVAILABLE"
    assert body["error"]["message"] == "AI service temporarily unavailable"
    assert body["error"]["retryable"] is True
    assert "connection refused" not in response.text
    assert "Bad Gateway" not in response.text


def test_chat_stream_maps_provider_error_to_failed_sse_event():
    """Mid-stream provider failures use the bounded SSE error contract."""

    def failing_stream(*args, **kwargs):
        async def generator():
            yield "partial"
            raise httpx.ConnectError("upstream host failed")

        return generator()

    with patch("app.routers.chat.llm_client") as mock_client:
        mock_client.chat_stream = failing_stream
        response = client.post(
            "/v1/ai/chat/stream", json=CHAT_PAYLOAD, headers=CHAT_HEADERS
        )

    assert response.status_code == 200
    blocks = [b for b in response.text.strip().split("\n\n") if b.strip()]
    assert blocks[0] == "event: accepted\ndata: {}"
    assert blocks[1] == 'event: delta\ndata: {"seq":1,"text":"partial"}'
    assert blocks[2].startswith("event: failed\ndata: ")
    error = json.loads(blocks[2].split("data: ", 1)[1])["error"]
    assert error["code"] == "PROVIDER_UNAVAILABLE"
    assert error["message"] == "AI service temporarily unavailable"
    assert error["retryable"] is True
    assert "upstream host failed" not in response.text


def test_chat_validation_error_is_client_error_not_provider_error():
    """An unsupported language is rejected before any provider call."""
    with patch("app.routers.chat.llm_client") as mock_client:
        mock_client.chat = AsyncMock(return_value="never called")
        response = client.post(
            "/v1/ai/chat",
            json={"language": "klingon", "messages": CHAT_PAYLOAD["messages"]},
            headers=CHAT_HEADERS,
        )
    assert response.status_code in (400, 422)
    mock_client.chat.assert_not_awaited()


@pytest.mark.parametrize(
    "generate_result,expected_code",
    [
        ("not json at all", "INVALID_AI_OUTPUT"),
        ('{"unexpected": "shape"}', "INVALID_AI_OUTPUT"),
    ],
)
def test_invalid_ai_output_maps_to_502_envelope(generate_result, expected_code):
    """Invalid provider JSON is a 502 with a bounded error code."""
    from app.services.llm_client import LLMClient

    payload = {
        "user_text": "error-contract-check " + generate_result[:5],
        "language": "english",
        "target_level": "B1",
    }
    with patch.object(
        LLMClient, "generate", new_callable=AsyncMock, return_value=generate_result
    ):
        response = client.post(
            "/v1/ai/writing/assess",
            json=payload,
            headers={"X-API-Key": "error-contract-test-key"},
        )

    assert response.status_code == 502
    body = response.json()
    assert body["error"]["code"] == expected_code
    assert body["error"]["retryable"] is False


@pytest.mark.asyncio
async def test_ai_json_request_maps_provider_exception_to_503():
    """ai_json_request wraps provider exceptions in the documented 503 shape."""
    with patch(
        "app.utils.llm_client.generate",
        new_callable=AsyncMock,
        side_effect=httpx.ConnectError("provider host down"),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await ai_json_request(
                system="system",
                prompt="error-contract prompt",
                context="Error contract",
                cache_ttl=0,
            )

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == "AI service temporarily unavailable"
    assert "provider host down" not in str(exc_info.value.detail)
