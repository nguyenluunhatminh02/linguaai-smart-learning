"""Chat endpoints.

The streaming endpoint speaks the SSE contract from the engineering roadmap:

    event: accepted       data: {"operationId": ..., "conversationId": ...}
    event: delta          data: {"seq": 1, "text": "..."}
    event: completed      data: {"operationId": ..., "usage": {...}}
    event: failed         data: {"error": {"code": ..., "message": ..., "retryable": ...}}

IDs, credit balances and persistence belong to the gateway's durable-operation
slice. This service only echoes caller-supplied operation/conversation IDs and
reports provider token usage when the provider actually returned it.
"""

import json
import logging
import re

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.config import settings
from app.core.deps import verify_key
from app.core.security import wrap_user_input
from app.models.schemas import ChatRequest, ChatResponse, validate_language
from app.prompts.tutor_prompts import TUTOR_SYSTEM
from app.rate_limit import limiter
from app.services.llm_client import llm_client

router = APIRouter(prefix="/ai/chat", tags=["Chat"])
logger = logging.getLogger(__name__)

# Caller-supplied identifiers are only echoed back; they must never be allowed
# to inject extra SSE fields or break event framing.
_OPAQUE_ID = re.compile(r"^[A-Za-z0-9._:~-]{1,128}$")
# Roles are asserted by the gateway (which authenticates the user), never by a
# browser. Both identity headers are mandatory on every chat route: a missing
# header is rejected, never treated as a legacy service caller. Only chat
# participants are allowed to consume these paid endpoints.
_ALLOWED_CLIENT_ROLES = frozenset({"user", "admin", "service"})
_ROLE_HEADER = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _build_messages(req: ChatRequest) -> list[dict]:
    # validate_language normalizes against a fixed supported-language set, so
    # untrusted input can never inject newlines/rules into the system prompt.
    language = validate_language(req.language)
    messages = [{"role": "system", "content": TUTOR_SYSTEM.format(language=language)}]
    for msg in req.messages:
        messages.append({"role": msg.role, "content": wrap_user_input(msg.content)})
    return messages


def _validated_id(value: str | None) -> str | None:
    return value if value and _OPAQUE_ID.fullmatch(value) else None


def _sse(event: str, payload: dict) -> str:
    # separators + ensure_ascii keep each event on one physical line; SSE
    # parsers may split chunks at arbitrary byte boundaries.
    return (
        f"event: {event}\n"
        f"data: {json.dumps(payload, ensure_ascii=True, separators=(',', ':'))}\n\n"
    )


def _error_payload(code: str, message: str, retryable: bool = False) -> dict:
    return {"error": {"code": code, "message": message, "retryable": retryable}}


def _validate_client_roles(
    user_id: str | None = Header(default=None, alias="X-User-ID"),
    roles: str | None = Header(default=None, alias="X-User-Roles"),
) -> None:
    """Validate gateway-asserted client identity/roles at the service boundary.

    Headers are trusted only because each endpoint additionally requires a
    server-held service API key (verify_key); browsers cannot set it. Missing,
    unrecognized, malformed, or privileged-but-unauthenticated identities are
    rejected with a safe 403 — an API key alone never bypasses this gate.
    """
    if user_id is None or not _OPAQUE_ID.fullmatch(user_id):
        raise HTTPException(status_code=403, detail="Forbidden")
    if roles is None or not roles.strip():
        raise HTTPException(status_code=403, detail="Forbidden")
    if any(not _ROLE_HEADER.fullmatch(r.strip()) for r in roles.split(",")):
        raise HTTPException(status_code=403, detail="Forbidden")
    asserted = {r.strip().lower() for r in roles.split(",")}
    if not asserted or not asserted.issubset(_ALLOWED_CLIENT_ROLES):
        raise HTTPException(status_code=403, detail="Forbidden")


@router.post(
    "",
    response_model=ChatResponse,
    dependencies=[Depends(verify_key), Depends(_validate_client_roles)],
)
@limiter.limit("20/minute")
async def chat(request: Request, req: ChatRequest):
    try:
        messages = _build_messages(req)
    except ValueError:
        # Schema validation normally rejects this first; normalize the same
        # failure to a documented client error rather than a 500.
        raise HTTPException(status_code=400, detail="VALIDATION_ERROR")

    try:
        response = await llm_client.chat(messages=messages, temperature=0.7, model=settings.groq_model_heavy)
        return ChatResponse(response=response)
    except Exception:
        logger.exception("Chat failed")
        raise HTTPException(
            status_code=503, detail="AI service temporarily unavailable"
        )


@router.post("/stream", dependencies=[Depends(verify_key), Depends(_validate_client_roles)])
@limiter.limit("20/minute")
async def chat_stream(
    request: Request,
    req: ChatRequest,
    operation_id: str | None = Header(default=None, alias="X-Operation-ID"),
    conversation_id: str | None = Header(default=None, alias="X-Conversation-ID"),
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
):
    try:
        messages = _build_messages(req)
    except ValueError:
        # Fail before SSE headers are flushed, per the roadmap's HTTP-400 rule.
        raise HTTPException(status_code=400, detail="VALIDATION_ERROR")

    op_id = _validated_id(operation_id)
    conv_id = _validated_id(conversation_id)
    # A request ID is diagnostic metadata only; never echo it to clients.
    if request_id and not _OPAQUE_ID.fullmatch(request_id):
        request_id = None

    async def event_generator():
        upstream = None
        seq = 0
        try:
            accepted = {}
            if op_id:
                accepted["operationId"] = op_id
            if conv_id:
                accepted["conversationId"] = conv_id
            yield _sse("accepted", accepted)

            upstream = llm_client.chat_stream(
                messages=messages, temperature=0.7, model=settings.groq_model_heavy
            )
            async for token in upstream:
                if await request.is_disconnected():
                    # A disconnect is not a completion: close the upstream
                    # stream in finally and emit no terminal success event.
                    logger.info("Chat client disconnected — closing upstream stream")
                    return
                seq += 1
                yield _sse("delta", {"seq": seq, "text": token})

            if await request.is_disconnected():
                return

            # `usage` is only reported when the provider returned it. Do not
            # fabricate token counts. llm_client records the last usage block
            # it saw while streaming; reading the attribute here avoids
            # changing that shared client in this slice.
            completed = {}
            if op_id:
                completed["operationId"] = op_id
            usage = getattr(llm_client, "last_stream_usage", None)
            if isinstance(usage, dict) and usage:
                completed["usage"] = {
                    key: usage[key]
                    for key in ("prompt_tokens", "completion_tokens", "total_tokens")
                    if key in usage
                }
            yield _sse("completed", completed)
        except Exception:
            logger.exception("Stream failed (request_id=%s)", request_id)
            # Safe code only: raw provider errors are logged, never sent.
            yield _sse(
                "failed",
                _error_payload("PROVIDER_UNAVAILABLE", "AI service temporarily unavailable", True),
            )
        finally:
            # Explicitly close the upstream async generator: its httpx
            # `client.stream` context is only exited when the generator is
            # closed, and abandoned streams otherwise hold pooled connections.
            if upstream is not None:
                await upstream.aclose()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
