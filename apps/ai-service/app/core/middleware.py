import re
import time
import uuid
import logging
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from app.core.context import set_request_id, get_request_id

logger = logging.getLogger("api_request")

# Strict pattern: UUID-like or short alphanumeric, max 64 chars, ASCII printable only.
_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9\-_.]{1,64}$")

def _sanitize_request_id(raw: str | None) -> str:
    """Return a safe request ID. Always generate server-side when the client
    value is missing or does not match the strict allow-list, preventing log
    forging, header injection, and storage amplification."""
    if raw and _REQUEST_ID_RE.match(raw):
        return raw
    return str(uuid.uuid4())

class RequestIDMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Lấy hoặc tạo mới request ID (luôn validate phía server)
        request_id = _sanitize_request_id(request.headers.get("x-request-id"))
        set_request_id(request_id)
        
        start_time = time.time()
        
        # Tiếp tục request chain
        response = await call_next(request)
        
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
            }
        )
        
        return response
