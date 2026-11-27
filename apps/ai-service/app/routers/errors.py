import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from app.config import settings
from app.core.deps import verify_key
from app.core.security import wrap_user_input
from app.models.schemas import ErrorAnalysisRequest, ErrorAnalysisResponse
from app.prompts.errors_prompts import ERRORS_PROMPT, ERRORS_SYSTEM
from app.rate_limit import limiter
from app.utils import ai_json_request

router = APIRouter(prefix="/ai/errors", tags=["Error Analysis"])
logger = logging.getLogger(__name__)


@router.post("/analyze", response_model=ErrorAnalysisResponse, dependencies=[Depends(verify_key)])
@limiter.limit("20/minute")
async def analyze_errors(request: Request, req: ErrorAnalysisRequest):
    validated_errors = []
    for e in req.errors:
        if isinstance(e, dict):
            sanitized = {
                str(k): wrap_user_input(str(v)) if isinstance(v, str) else v
                for k, v in e.items()
            }
            # Normalise the type so it is always a safe, hashable string: the
            # request schema accepts arbitrary values in each error entry.
            raw_type = sanitized.get("type", "general")
            if isinstance(raw_type, str):
                error_type = raw_type.removeprefix("<user_input>").removesuffix("</user_input>")
            elif raw_type is not None:
                error_type = str(raw_type)
            else:
                error_type = "general"
            sanitized["type"] = error_type or "general"
            validated_errors.append(sanitized)
        else:
            validated_errors.append({
                "type": "general",
                "data": wrap_user_input(str(e)),
            })

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
