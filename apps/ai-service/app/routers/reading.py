import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Request

from app.config import settings
from app.core.deps import verify_key
from app.core.security import wrap_user_input
from app.models.schemas import ReadingGenerateRequest, ReadingGenerateResponse
from app.prompts.registry import PromptSpec, get_prompt, render as render_prompt, resolve_model
from app.rate_limit import limiter
from app.services.model_router import Feature, get_model_router
from app.utils import ai_json_request

router = APIRouter(prefix="/ai/reading", tags=["Reading"])
logger = logging.getLogger(__name__)

PROMPT_ID = "reading.generate"

# The model targets an approximate length; allow generous slack for tokenisation
# differences and count-only drift before rejecting a passage as grossly wrong.
_WORD_COUNT_TOLERANCE = 0.5


def _count_words(passage: str) -> int:
    return len(re.findall(r"\b\w+\b", passage))


def resolve_reading_model(spec: PromptSpec) -> str:
    """Resolve this feature's model, preferring a routed policy candidate.

    A routed candidate wins only when it is one of the configured provider
    models. With no usable decision the registry alias (resolved from settings)
    is used, preserving the existing response contract and cache identity.
    """
    fallback = resolve_model(spec.model_config)
    decision = get_model_router().select(Feature.READING, needs_structured=True)
    primary = decision.primary
    if primary is None:
        return fallback
    candidate_id = str(primary.model_id or "").strip()
    if candidate_id not in (settings.groq_model_light, settings.groq_model_heavy):
        return fallback
    return candidate_id


@router.post(
    "/generate",
    response_model=ReadingGenerateResponse,
    dependencies=[Depends(verify_key)],
)
@limiter.limit("20/minute")
async def generate_reading(request: Request, req: ReadingGenerateRequest):
    spec = get_prompt(PROMPT_ID)
    rendered = render_prompt(
        PROMPT_ID,
        system_values={
            "language": req.language,
            "level": req.level,
            "word_count": req.word_count,
        },
        user_values={
            "topic": wrap_user_input(req.topic),
            "level": req.level,
            "language": req.language,
            "word_count": req.word_count,
        },
        version=spec.version,
    )
    model_id = resolve_reading_model(spec)

    logger.info(
        "Reading generation metadata: prompt_id=%s prompt_version=%s model=%s",
        rendered.metadata.prompt_id,
        rendered.metadata.prompt_version,
        model_id,
    )
    result = await ai_json_request(
        system=rendered.system,
        prompt=rendered.user,
        response_model=ReadingGenerateResponse,
        temperature=spec.model_config.temperature,
        context="Reading generation",
        model=model_id,
    )

    # ai_json_request caches raw model output; a cached response generated for
    # an earlier request still has to satisfy this request's word_count.
    actual = _count_words(result["passage"])
    lower = req.word_count * (1 - _WORD_COUNT_TOLERANCE)
    upper = req.word_count * (1 + _WORD_COUNT_TOLERANCE)
    if not lower <= actual <= upper:
        logger.warning(
            "Reading passage length %d outside [%s, %s] for word_count=%d",
            actual, lower, upper, req.word_count,
        )
        raise HTTPException(
            status_code=502,
            detail="AI returned a passage with an unexpected word count",
        )

    # Keep the response contract in sync with the request without breaking
    # existing clients (the field is additive and optional for callers).
    if "word_count" not in result:
        result = {**result, "word_count": actual}
    return result
