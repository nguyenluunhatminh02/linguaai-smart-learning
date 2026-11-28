import logging

from fastapi import APIRouter, Depends, Request

from app.config import settings
from app.core.deps import verify_key
from app.core.exceptions import ProviderUnavailableException
from app.core.security import wrap_user_input
from app.models.schemas import WritingAssessRequest, WritingAssessResponse
from app.prompts.registry import get_prompt, render as render_prompt
from app.rate_limit import limiter
from app.services.model_router import ModelRouter
from app.utils import ai_json_request

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai/writing", tags=["Writing"])


def _writing_model_selection():
    """Resolve the writing model at call time from the configured heavy model.

    The policy is deliberately pass-through: one primary, no fallbacks, no
    provider keys or prices. Operator-provided policies remain authoritative.
    """
    from app.services.model_router import get_model_router, load_model_policy

    router = get_model_router()
    configured = load_model_policy()
    if not configured.get("features", {}).get("writing_feedback"):
        policy = {
            "version": router.config_version,
            "features": {
                "writing_feedback": {
                    "enabled": True,
                    "config_version": router.config_version,
                    "candidates": [
                        {
                            "model_id": settings.groq_model_heavy,
                            "role": "primary",
                            "capabilities": {"structured_output": True},
                            "response_contract": "json",
                        }
                    ],
                }
            },
        }
        router = ModelRouter(policy=policy, config_version=router.config_version)
    decision = router.select("writing_feedback", needs_structured=True, fallback_limit=0)
    primary = decision.primary
    if primary is None:
        logger.error(
            "Writing assessment: no model candidate (reason=%s, config_version=%s)",
            decision.reason,
            decision.config_version,
        )
        raise ProviderUnavailableException()
    return primary, decision.config_version


@router.post(
    "/assess", response_model=WritingAssessResponse, dependencies=[Depends(verify_key)]
)
@limiter.limit("20/minute")
async def assess_writing(request: Request, req: WritingAssessRequest):
    spec = get_prompt("writing.assess")
    rendered = render_prompt(
        "writing.assess",
        system_values={"language": req.language, "level": req.target_level},
        user_values={
            "language": req.language,
            "level": req.target_level,
            "user_text": wrap_user_input(req.user_text),
        },
        version=spec.version,
    )
    selection, config_version = _writing_model_selection()

    logger.info(
        "Writing assessment metadata: prompt_id=%s prompt_version=%s model=%s config_version=%s",
        rendered.metadata.prompt_id,
        rendered.metadata.prompt_version,
        selection.model_id,
        config_version,
    )
    return await ai_json_request(
        system=rendered.system,
        prompt=rendered.user,
        response_model=WritingAssessResponse,
        temperature=spec.model_config.temperature,
        context="Writing assessment",
        model=selection.model_id,
    )
