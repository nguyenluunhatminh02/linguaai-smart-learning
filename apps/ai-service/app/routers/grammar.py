"""Grammar explanation route, wired through the AI-01/AI-03 abstractions.

The published ``grammar.explain`` prompt spec is the single source of truth for
the system/user templates, temperature and model alias. The feature-aware
``ModelRouter`` may override the concrete model id when policy config is
available; if it has no usable candidate, the alias resolved from settings is
used so the existing response contract and behavior are unchanged.
"""

from fastapi import APIRouter, Depends, Request

from app.core.deps import verify_key
from app.core.security import wrap_user_input
from app.models.schemas import (
    GrammarExplainRequest,
    GrammarExplainResponse,
    validate_language,
)
from app.prompts.registry import get_prompt, resolve_model
from app.rate_limit import limiter
from app.services.model_router import Feature, get_model_router
from app.utils import ai_json_request

router = APIRouter(prefix="/ai/grammar", tags=["Grammar"])

PROMPT_ID = "grammar.explain"


def resolve_grammar_model(model_alias: str) -> str:
    """Resolve the configured model id for this feature.

    A routed candidate wins when the decision is available; otherwise the
    registry alias resolved from settings is used so a killed/disabled feature
    or exhausted budget cannot silently switch the backend model.
    """
    fallback = resolve_model_from_alias(model_alias)
    decision = get_model_router().select(Feature.GRAMMAR, needs_structured=True)
    primary = decision.primary
    if not decision.available or primary is None:
        return fallback
    candidate_id = str(primary.model_id or "").strip()
    if not candidate_id:
        return fallback
    return router_model_id(candidate_id, fallback)


def resolve_model_from_alias(model_alias: str) -> str:
    """Resolve ``light``/``heavy`` aliases through the shared registry."""
    from app.prompts.registry import ModelConfig

    return resolve_model(ModelConfig(model_alias=model_alias, temperature=0.5))


def router_model_id(candidate_id: str, fallback_id: str) -> str:
    """Return a routed model id only when it is a configured provider model."""
    from app.config import settings

    if candidate_id in (settings.groq_model_light, settings.groq_model_heavy):
        return candidate_id
    return fallback_id


@router.post(
    "/explain",
    response_model=GrammarExplainResponse,
    dependencies=[Depends(verify_key)],
)
@limiter.limit("20/minute")
async def explain_grammar(request: Request, req: GrammarExplainRequest):
    spec = get_prompt(PROMPT_ID)
    # The request schema validates this via validate_language, but re-validate
    # here so only a canonical allowlisted value can reach either prompt role.
    language = validate_language(req.language)
    extra = (
        f"\nAdditional question: {wrap_user_input(req.user_question)}"
        if req.user_question
        else ""
    )
    rendered = spec.render(
        system_values={"language": language},
        user_values={
            "language": language,
            "grammar_point": wrap_user_input(req.grammar_point),
            "extra_question": extra,
        },
    )
    model_id = resolve_grammar_model(spec.model_config.model_alias)
    return await ai_json_request(
        system=rendered.system,
        prompt=rendered.user,
        response_model=GrammarExplainResponse,
        temperature=spec.model_config.temperature,
        context="Grammar explanation",
        model=model_id,
    )
