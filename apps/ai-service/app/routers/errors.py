import json
import logging

from fastapi import APIRouter, Depends, Request

from app.config import settings
from app.core.deps import verify_key
from app.core.security import wrap_data_recursive_filtered, wrap_user_input
from app.models.schemas import ErrorAnalysisRequest, ErrorAnalysisResponse
from app.prompts.errors_prompts import ERRORS_PROMPT, ERRORS_SYSTEM
from app.rate_limit import limiter
from app.utils import ai_json_request

router = APIRouter(prefix="/ai/errors", tags=["Error Analysis"])
logger = logging.getLogger(__name__)

# Only schema-allowlisted keys survive. Any arbitrary key (or nested key) is
# dropped so caller-controlled field names never become part of the prompt.
_ALLOWED_ERROR_KEYS = ("type", "data", "text", "original", "category")


def _contained_errors(errors) -> list[dict]:
    """Return error entries whose every string leaf is wrapped as data."""
    contained: list[dict] = []
    for entry in errors:
        if isinstance(entry, dict):
            wrapped = wrap_data_recursive_filtered(entry, _ALLOWED_ERROR_KEYS)
            raw_type = wrapped.get("type", "general")
            # `type` is a server-side category label (used for exercise
            # counting), so strip the data envelope after sanitising it.
            if isinstance(raw_type, str):
                wrapped["type"] = (
                    raw_type.removeprefix("<user_input>").removesuffix("</user_input>")
                    or "general"
                )
            elif raw_type is None:
                wrapped["type"] = "general"
            else:
                wrapped["type"] = str(raw_type)
            contained.append(wrapped)
        else:
            contained.append({
                "type": "general",
                "data": wrap_user_input(str(entry)),
            })
    return contained


@router.post("/analyze", response_model=ErrorAnalysisResponse, dependencies=[Depends(verify_key)])
@limiter.limit("20/minute")
async def analyze_errors(request: Request, req: ErrorAnalysisRequest):
    validated_errors = _contained_errors(req.errors)

    # The prompt asks for one exercise per distinct pattern, capped at 5.
    # Do not inflate the count to 3 when fewer patterns were supplied.
    distinct_types = {
        str(e["type"]) for e in validated_errors if e.get("type") is not None
    }
    exercise_count = max(1, min(len(distinct_types), 5))

    errors_json = json.dumps(validated_errors, ensure_ascii=False, indent=2)
    system = ERRORS_SYSTEM.format(language=req.language)
    prompt = ERRORS_PROMPT.format(
        language=req.language,
        level=req.level,
        errors_json=errors_json,
        total_errors=len(validated_errors),
        exercise_count=exercise_count,
    )
    return await ai_json_request(
        system=system,
        prompt=prompt,
        response_model=ErrorAnalysisResponse,
        temperature=0.4,
        context="Error analysis",
        model=settings.groq_model_light,
    )
