from fastapi import APIRouter, Depends, Request

from app.config import settings
from app.core.deps import verify_key
from app.core.security import wrap_user_input
from app.models.schemas import WritingAssessRequest, WritingAssessResponse
from app.prompts.writing_prompts import WRITING_PROMPT, WRITING_SYSTEM
from app.rate_limit import limiter
from app.utils import ai_json_request

router = APIRouter(prefix="/ai/writing", tags=["Writing"])


@router.post(
    "/assess", response_model=WritingAssessResponse, dependencies=[Depends(verify_key)]
)
@limiter.limit("20/minute")
async def assess_writing(request: Request, req: WritingAssessRequest):
    system = WRITING_SYSTEM.format(language=req.language, level=req.target_level)
    prompt = WRITING_PROMPT.format(
        language=req.language,
        level=req.target_level,
        user_text=wrap_user_input(req.user_text),
    )
    return await ai_json_request(
        system=system,
        prompt=prompt,
        response_model=WritingAssessResponse,
        temperature=0.3,
        context="Writing assessment",
        model=settings.groq_model_heavy,
    )
