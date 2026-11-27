from fastapi import APIRouter, Depends, Request

from app.config import settings
from app.core.deps import verify_key
from app.core.security import wrap_user_input
from app.models.schemas import (
    GenerateCardsRequest,
    GenerateCardsResponse,
    GenerateQuizQuestionsRequest,
    GenerateQuizQuestionsResponse,
)
from app.prompts.content_generation_prompts import (
    CARDS_GENERATION_PROMPT,
    CARDS_GENERATION_SYSTEM,
    QUIZ_GENERATION_PROMPT,
    QUIZ_GENERATION_SYSTEM,
)
from app.rate_limit import limiter
from app.utils import ai_json_request

router = APIRouter(prefix="/ai/content", tags=["Content Generation"])


@router.post("/generate-cards", response_model=GenerateCardsResponse, dependencies=[Depends(verify_key)])
@limiter.limit("20/minute")
async def generate_cards(request: Request, req: GenerateCardsRequest):
    count = max(3, min(req.count, 20))
    system = CARDS_GENERATION_SYSTEM.format(language=req.language)
    # Schema enforces max_length=10000; strip invisible chars before wrapping
    # to prevent zero-width character bypass of the tag sanitizer.
    cleaned_text = _strip_invisible_chars(req.text)
    prompt = CARDS_GENERATION_PROMPT.format(
        count=count,
        language=req.language,
        text=wrap_user_input(cleaned_text),
    )
    return await ai_json_request(
        system=system,
        prompt=prompt,
        response_model=GenerateCardsResponse,
        temperature=0.4,
        context="Card generation",
        model=settings.groq_model_heavy,
    )


@router.post("/generate-quiz-questions", response_model=GenerateQuizQuestionsResponse, dependencies=[Depends(verify_key)])
@limiter.limit("20/minute")
async def generate_quiz_questions(request: Request, req: GenerateQuizQuestionsRequest):
    count = max(3, min(req.count, 20))
    system = QUIZ_GENERATION_SYSTEM.format(language=req.language, level=req.level)
    prompt = QUIZ_GENERATION_PROMPT.format(
        count=count,
        language=req.language,
        topic=wrap_user_input(req.topic),
        level=req.level,
    )
    return await ai_json_request(
        system=system,
        prompt=prompt,
        response_model=GenerateQuizQuestionsResponse,
        temperature=0.5,
        context="Quiz generation",
        model=settings.groq_model_heavy,
    )
