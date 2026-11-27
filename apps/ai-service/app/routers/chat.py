import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
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


def _build_messages(req: ChatRequest) -> list[dict]:
    # validate_language normalizes against a fixed supported-language set, so
    # untrusted input can never inject newlines/rules into the system prompt.
    language = validate_language(req.language)
    messages = [{"role": "system", "content": TUTOR_SYSTEM.format(language=language)}]
    for msg in req.messages:
        messages.append({"role": msg.role, "content": wrap_user_input(msg.content)})
    return messages


@router.post("", response_model=ChatResponse, dependencies=[Depends(verify_key)])
@limiter.limit("20/minute")
async def chat(request: Request, req: ChatRequest):
    messages = _build_messages(req)

    try:
        response = await llm_client.chat(messages=messages, temperature=0.7, model=settings.groq_model_heavy)
        return ChatResponse(response=response)
    except Exception:
        logger.exception("Chat failed")
        raise HTTPException(
            status_code=503, detail="AI service temporarily unavailable"
        )


@router.post("/stream", dependencies=[Depends(verify_key)])
@limiter.limit("20/minute")
async def chat_stream(request: Request, req: ChatRequest):
    messages = _build_messages(req)

    async def event_generator():
        upstream = None
        try:
            upstream = llm_client.chat_stream(
                messages=messages, temperature=0.7, model=settings.groq_model_heavy
            )
            async for token in upstream:
                if await request.is_disconnected():
                    logger.info("Chat client disconnected — closing upstream stream")
                    break
                yield f"data: {json.dumps({'token': token})}\n\n"
            else:
                yield "data: [DONE]\n\n"
        except Exception:
            logger.exception("Stream failed")
            yield f"data: {json.dumps({'error': 'stream_interrupted'})}\n\n"
            # A defined terminal marker lets clients waiting on [DONE] stop
            # instead of hanging on a partial response.
            yield "data: [DONE]\n\n"
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
