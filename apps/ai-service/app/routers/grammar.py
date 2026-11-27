from fastapi import APIRouter, Depends, Request

from app.config import settings
from app.core.deps import verify_key
from app.core.security import wrap_user_input
from app.models.schemas import (
    GrammarExplainRequest,
    GrammarExplainResponse,
    validate_language,
)
from app.prompts.grammar_prompts import GRAMMAR_PROMPT, GRAMMAR_SYSTEM
from app.rate_limit import limiter
from app.utils import ai_json_request

router = APIRouter(prefix="/ai/grammar", tags=["Grammar"])


@router.post(
    "/explain",
    response_model=GrammarExplainResponse,
    dependencies=[Depends(verify_key)],
)
@limiter.limit("20/minute")
async def explain_grammar(request: Request, req: GrammarExplainRequest):
    extra = (
        f"\nAdditional question: {wrap_user_input(req.user_question)}"
        if req.user_question
        else ""
    )
    # The request schema validates this via validate_language, but re-validate
    # here so only a canonical allowlisted value can reach either prompt role.
    language = validate_language(req.language)
    system = GRAMMAR_SYSTEM.format(language=language)
    prompt = GRAMMAR_PROMPT.format(
        language=language,
        grammar_point=wrap_user_input(req.grammar_point),
        extra_question=extra,
    )
    return await ai_json_request(
        system=system,
        prompt=prompt,
        response_model=GrammarExplainResponse,
        temperature=0.5,
        context="Grammar explanation",
        model=settings.groq_model_light,
    )
