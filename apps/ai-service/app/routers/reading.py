import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Request

from app.config import settings
from app.core.deps import verify_key
from app.core.security import wrap_user_input
from app.models.schemas import ReadingGenerateRequest, ReadingGenerateResponse
from app.prompts.reading_prompts import READING_PROMPT, READING_SYSTEM
from app.rate_limit import limiter
from app.utils import ai_json_request

router = APIRouter(prefix="/ai/reading", tags=["Reading"])
logger = logging.getLogger(__name__)

# The model targets an approximate length; allow generous slack for tokenisation
# differences and count-only drift before rejecting a passage as grossly wrong.
_WORD_COUNT_TOLERANCE = 0.5


def _count_words(passage: str) -> int:
    return len(re.findall(r"\b\w+\b", passage))


@router.post(
    "/generate",
    response_model=ReadingGenerateResponse,
    dependencies=[Depends(verify_key)],
)
@limiter.limit("20/minute")
async def generate_reading(request: Request, req: ReadingGenerateRequest):
    system = READING_SYSTEM.format(
        language=req.language, level=req.level, word_count=req.word_count
    )
    prompt = READING_PROMPT.format(
        topic=wrap_user_input(req.topic),
        level=req.level,
        language=req.language,
        word_count=req.word_count,
    )
    result = await ai_json_request(
        system=system,
        prompt=prompt,
        response_model=ReadingGenerateResponse,
        temperature=0.7,
        context="Reading generation",
        model=settings.groq_model_heavy,
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
