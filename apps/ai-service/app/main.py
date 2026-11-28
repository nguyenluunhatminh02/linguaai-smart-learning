import logging
import os
import re
import uuid
from contextlib import asynccontextmanager
from typing import Any, Optional

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from slowapi.errors import RateLimitExceeded
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1.router import v1_router
from app.config import settings
from app.health import router as health_router
from app.rate_limit import limiter
from app.routers import chat, content, errors, grammar, nlp, reading, writing
from app.services.llm_client import llm_client

from app.core.exceptions import AIServiceException
from app.core.logging_config import setup_logging
from app.core.middleware import RequestIDMiddleware

logger = logging.getLogger(__name__)

LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "logs")

# Bounded code set shared with the NestJS adapter (apps/api/src/common/services/
# ai-client.service.ts). Every error reaching a client uses one of these codes;
# no provider text or exception detail is forwarded verbatim.
_ERROR_CODES = frozenset({
    "VALIDATION_ERROR",
    "UNAUTHORIZED",
    "INSUFFICIENT_CREDITS",
    "OPERATION_CONFLICT",
    "OPERATION_UNKNOWN",
    "RATE_LIMITED",
    "CONCURRENCY_LIMITED",
    "BUDGET_EXCEEDED",
    "PROVIDER_UNAVAILABLE",
    "PROVIDER_TIMEOUT",
    "INVALID_AI_OUTPUT",
    "INTERNAL_ERROR",
})

_RETRYABLE_CODES = frozenset({
    "RATE_LIMITED",
    "CONCURRENCY_LIMITED",
    "PROVIDER_UNAVAILABLE",
    "PROVIDER_TIMEOUT",
})

_STATUS_CODES = {
    400: "VALIDATION_ERROR",
    401: "UNAUTHORIZED",
    402: "INSUFFICIENT_CREDITS",
    403: "UNAUTHORIZED",
    404: "OPERATION_UNKNOWN",
    409: "OPERATION_CONFLICT",
    413: "VALIDATION_ERROR",
    422: "VALIDATION_ERROR",
    429: "RATE_LIMITED",
    500: "INTERNAL_ERROR",
    502: "INVALID_AI_OUTPUT",
    503: "PROVIDER_UNAVAILABLE",
    504: "PROVIDER_TIMEOUT",
}

_SAFE_MESSAGES = {
    "VALIDATION_ERROR": "Invalid AI request",
    "UNAUTHORIZED": "Invalid or missing API key",
    "INSUFFICIENT_CREDITS": "Insufficient credits for this AI request",
    "OPERATION_CONFLICT": "The AI operation is already in progress",
    "OPERATION_UNKNOWN": "AI operation not found",
    "RATE_LIMITED": "AI request rate limit exceeded",
    "CONCURRENCY_LIMITED": "Too many concurrent AI requests",
    "BUDGET_EXCEEDED": "Daily AI budget exceeded",
    "PROVIDER_UNAVAILABLE": "AI service temporarily unavailable",
    "PROVIDER_TIMEOUT": "AI service request timed out",
    "INVALID_AI_OUTPUT": "AI service returned an invalid result",
    "INTERNAL_ERROR": "AI service temporarily unavailable",
}

# Client operation ids are correlation hints, never instructions. Keep the
# same shape accepted by the NestJS adapter and the chat SSE contract.
_OPERATION_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,64}$")


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging(LOG_DIR)
    if not settings.groq_api_key:
        logger.warning("GROQ_API_KEY is not set — AI features will not work")
    yield
    await llm_client.close()


app = FastAPI(
    title="LinguaAI - AI Service",
    description="AI microservice powered by Groq (llama-3.3-70b-versatile)",
    version="1.0.0",
    lifespan=lifespan,
)

app.state.limiter = limiter


def _bounded_code(raw: Any, status_code: int) -> str:
    """Return a documented code only; never echo an unbounded client/provider value."""
    if isinstance(raw, str):
        code = raw.strip().upper()
        if code in _ERROR_CODES:
            return code
    return _STATUS_CODES.get(status_code, "INTERNAL_ERROR")


def _safe_message(raw: Any, code: str) -> str:
    """Use fixed messages so provider or exception text cannot leak to clients."""
    if isinstance(raw, str):
        candidate = raw.strip()
        if candidate in _SAFE_MESSAGES.values():
            return candidate
    return _SAFE_MESSAGES[code]


def _operation_id(request: Request) -> str:
    raw = request.headers.get("x-ai-operation-id") or getattr(
        request.state, "operation_id", None
    )
    if isinstance(raw, str) and _OPERATION_ID_RE.match(raw):
        return raw
    return str(uuid.uuid4())


def _error_response(
    request: Request,
    status_code: int,
    code: Any = None,
    detail: Any = None,
    headers: Optional[dict[str, str]] = None,
) -> JSONResponse:
    resolved_code = _bounded_code(code, status_code)
    request_id = getattr(request.state, "request_id", None)
    if not isinstance(request_id, str) or not request_id:
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id

    payload = {
        "error": {
            "code": resolved_code,
            "message": _safe_message(detail, resolved_code),
            "retryable": resolved_code in _RETRYABLE_CODES,
            "requestId": request_id,
            "operationId": _operation_id(request),
        }
    }
    return JSONResponse(status_code=status_code, content=payload, headers=headers)


@app.exception_handler(AIServiceException)
async def ai_service_exception_handler(request: Request, exc: AIServiceException):
    headers = None
    retry_after = getattr(exc, "retry_after", None)
    if retry_after is not None:
        try:
            headers = {"Retry-After": str(max(0, int(retry_after)))}
        except (TypeError, ValueError):
            headers = None
    return _error_response(request, exc.status_code, exc.error_code, exc.detail, headers)


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    # FastAPI.HTTPException subclasses StarletteHTTPException, so both are
    # handled here with the roadmap envelope and original status codes.
    return _error_response(request, exc.status_code, exc.detail, exc.headers)


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(
    request: Request, exc: RequestValidationError
):
    # Return the bounded envelope rather than raw field values or input echoes.
    return _error_response(request, 422, "VALIDATION_ERROR")


@app.exception_handler(RateLimitExceeded)
async def rate_limit_exception_handler(request: Request, exc: RateLimitExceeded):
    retry_after = getattr(exc, "retry_after", None)
    headers = {"Retry-After": str(retry_after)} if retry_after else None
    return _error_response(request, 429, "RATE_LIMITED", headers=headers)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    # Re-dispatch known exceptions so their registered handlers win; the catch-
    # all response is always 500 and never includes exception text.
    if isinstance(exc, (AIServiceException, RateLimitExceeded, RequestValidationError)):
        return await app.handle_exception(request, exc)
    if isinstance(exc, StarletteHTTPException):
        return _error_response(request, exc.status_code, exc.detail, exc.headers)
    logger.exception("Unhandled exception", exc_info=exc)
    return _error_response(request, 500, "INTERNAL_ERROR")


app.add_middleware(RequestIDMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["POST", "GET"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(v1_router)
app.include_router(health_router)


@app.get("/test")
@limiter.limit("20/minute")
async def test_page(request: Request):
    if not settings.debug:
        return JSONResponse(
            status_code=404, content={"detail": "not_found"}
        )
    html_path = os.path.join(os.path.dirname(__file__), "..", "test.html")
    return FileResponse(html_path, media_type="text/html")
