from fastapi import APIRouter, Depends, Request
from pydantic import Field

from app.config import settings
from app.core.deps import verify_key
from app.core.security import wrap_user_input
from app.models.schemas import NlpAnalyzeRequest, NlpAnalyzeResponse
from app.prompts.nlp_prompts import NLP_PROMPT, NLP_SYSTEM
from app.rate_limit import limiter
from app.utils import ai_json_request

router = APIRouter(prefix="/ai/nlp", tags=["NLP Analysis"])


class _NlpAnalyzeResponseLax(NlpAnalyzeResponse):
    """Accept LLM output that omits word_count / sentence_count so the router
    can fill them from the original text instead of failing validation."""
    word_count: int = Field(default=0, ge=0)
    sentence_count: int = Field(default=0, ge=0)


@router.post("/analyze", response_model=NlpAnalyzeResponse, dependencies=[Depends(verify_key)])
@limiter.limit("20/minute")
async def analyze_text(request: Request, req: NlpAnalyzeRequest):
    system = NLP_SYSTEM.format(language=req.language)
    prompt = NLP_PROMPT.format(
        language=req.language,
        text=wrap_user_input(req.text[:6000]),
    )
    result = await ai_json_request(
        system=system,
        prompt=prompt,
        response_model=_NlpAnalyzeResponseLax,
        temperature=0.2,
        context="NLP analysis",
        model=settings.groq_model_light,
    )
    # Fill counts from the source text when the LLM omitted or zeroed them.
    if not result.get("word_count"):
        result["word_count"] = len(req.text.split())
    if not result.get("sentence_count"):
        result["sentence_count"] = max(
            1,
            req.text.count(".") + req.text.count("!") + req.text.count("?"),
        )
    result.setdefault("estimated_level", "B1")
    result.setdefault("top_keywords", [])
    return result
