"""Request-level middleware for the AI service.

Two responsibilities:

1. Assign a server-sanitized request id before any downstream code runs, and
   reset the contextvar in ``finally`` so a pooled worker never leaks the
   previous request's id into the next one.
2. Reject oversized ``Content-Length`` headers with a safe 413 before the
   body is read or validated. Chunked bodies are not covered here — schema
   caps remain mandatory — but this stops trivial amplification attempts.
"""

from __future__ import annotations

import re
import time
import uuid
import logging

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.context import reset_request_id, set_request_id
from app.core.limits import MAX_CONTEXT_CHARS

logger = logging.getLogger("api_request")

# Strict pattern: UUID-like or short alphanumeric, max 64 chars, ASCII printable only.
_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9\-_.]{1,64}$")

# Body-size ceiling applied to the declared Content-Length. The per-field schema
# caps are the authoritative bound; this is a fast early-reject for obvious
# abuse. Chunked bodies bypass this check and are bounded by schema validation.
MAX_CONTENT_LENGTH = MAX_CONTEXT_CHARS * 4  # generous: ~48 KB


def _sanitize_request_id(raw: str | None) -> str:
    """Return a safe request ID. Always generate server-side when the client
    value is missing or does not match the strict allow-list, preventing log
    forging, header injection, and storage amplification."""
    if raw and _REQUEST_ID_RE.match(raw):
        return raw
    return str(uuid.uuid4())


class RequestIDMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Reject oversized declared bodies before any expensive work.
        content_length = request.headers.get("content-length")
        if content_length is not None:
            try:
                if int(content_length) > MAX_CONTENT_LENGTH:
                    return JSONResponse(
                        status_code=413,
                        content={
                            "detail": "Request body too large",
                            "error_code": "REQUEST_TOO_LARGE",
                        },
                    )
            except ValueError:
                return JSONResponse(
                    status_code=400,
                    content={
                        "detail": "Invalid Content-Length",
                        "error_code": "INVALID_CONTENT_LENGTH",
                    },
                )

        # Lấy hoặc tạo mới request ID (luôn validate phía server)
        request_id = _sanitize_request_id(request.headers.get("x-request-id"))
        token = set_request_id(request_id)
        request.state.request_id = request_id

        start_time = time.time()
        try:
            # Tiếp tục request chain
            response = await call_next(request)
        finally:
            # Reset the contextvar so a pooled worker never reuses this id.
            reset_request_id(token)

        # Tính toán duration
        duration_ms = (time.time() - start_time) * 1000

        # Thêm request ID vào response header
        response.headers["X-Request-ID"] = request_id

        # Ghi log request hoàn tất dưới dạng JSON structured
        logger.info(
            f"HTTP {request.method} {request.url.path} finished with status {response.status_code}",
            extra={
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "duration_ms": round(duration_ms, 2),
            },
        )

        return response
