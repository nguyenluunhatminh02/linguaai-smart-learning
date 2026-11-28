"""Content generation routes: structured input validation and bounded spend.

Both endpoints are billable: the ``feature_guard("content")`` dependency
authenticates the caller, checks the feature rate limit and daily budget, and
reserves a concurrency slot. That slot is released in ``finally`` on every
completion path, including provider and validation failures.

Request Pydantic models are the structured validators: FastAPI rejects unknown
fields, out-of-range counts and unsupported languages before the handler is
called. This module re-validates the model after normalization so a validator
cannot accidentally weaken the schema contract, then sends only sanitized,
bounded user data to the provider. Provider JSON is validated against the
response model by :func:`app.utils.ai_json_request`.
"""

from __future__ import annotations

import logging
import unicodedata
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ValidationError

from app.config import settings
from app.core.deps import feature_guard
from app.core.limits import (
    MAX_CONTEXT_CHARS,
    MAX_GENERATED_ITEMS,
    MAX_TEXT_CHARS,
    MAX_TOPIC_CHARS,
)
from app.core.security import wrap_user_input
from app.models.schemas import (
    GenerateCardsRequest,
    GenerateCardsResponse,
    GenerateQuizQuestionsRequest,
    GenerateQuizQuestionsResponse,
    validate_language,
)
from app.prompts.content_generation_prompts import (
    CARDS_GENERATION_PROMPT,
    CARDS_GENERATION_SYSTEM,
    QUIZ_GENERATION_PROMPT,
    QUIZ_GENERATION_SYSTEM,
)
from app.rate_limit import release_concurrency_slot
from app.utils import ai_json_request

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai/content", tags=["Content Generation"])

# The guard owns the feature-specific rate limit; slowapi is no longer needed
# on these billable routes. ONE callable is shared by both endpoints so FastAPI
# caches it per request: one reservation, one release. Creating the guard
# inline at each use site would reserve two slots and leak one of them.
CONTENT_FEATURE = "content"
_content_guard = feature_guard(CONTENT_FEATURE)
CARDS_TEMPERATURE = 0.4
QUIZ_TEMPERATURE = 0.5
_MIN_GENERATED_ITEMS = 3

# Prompt scaffolding around the untrusted field. Kept as an explicit allowance
# so the aggregate context ceiling is enforced against exactly what is sent.
_CARDS_PROMPT_OVERHEAD = len(CARDS_GENERATION_PROMPT) + len(CARDS_GENERATION_SYSTEM)
_QUIZ_PROMPT_OVERHEAD = len(QUIZ_GENERATION_PROMPT) + len(QUIZ_GENERATION_SYSTEM)


def _strip_invisible_chars(text: str) -> str:
    """Drop Unicode format (Cf) characters that can hide tag-smuggling payloads."""
    return "".join(ch for ch in text if unicodedata.category(ch) != "Cf")


def _clamp_count(count: int) -> int:
    """Keep the historical 3..20 prompt range (schema is ge=3, le=20)."""
    return max(_MIN_GENERATED_ITEMS, min(int(count), MAX_GENERATED_ITEMS))


def _check_context(used: int, overhead: int, field: str) -> None:
    """Reject inputs whose aggregate prompt would exceed the context ceiling."""
    if used + overhead > MAX_CONTEXT_CHARS:
        # No user text, field value or raw prompt is echoed in the error.
        raise HTTPException(
            status_code=422, detail="content request exceeds the context budget"
        )


def _estimate_call_tokens(prompt: str, system: str, count: int) -> int:
    """Content cost policy: bounded input estimate plus per-item output budget.

    Uses the shared estimator for the prompt text and the central
    ``MAX_GENERATED_ITEMS`` ceiling for the output side; the caller cannot raise
    either term above those bounds by increasing ``count``.
    """
    from app.rate_limit import estimate_tokens

    return estimate_tokens(prompt + system) + _clamp_count(count) * 100


def _validated_request(
    model: type[BaseModel], req: BaseModel, **overrides: Any
) -> BaseModel:
    """Re-validate normalized data against the same structured request model.

    The Pydantic request models are the structured validators: FastAPI owns
    first-pass validation (422), and this second pass proves that normalization
    did not weaken the request contract before any provider call is made.
    """
    data = req.model_dump()
    data.update(overrides)
    try:
        return model.model_validate(data)
    except ValidationError as exc:
        # Client-safe error with no echo of the rejected field values.
        raise HTTPException(status_code=422, detail="invalid content request") from exc


def _cards_request(req: GenerateCardsRequest) -> tuple[GenerateCardsRequest, int]:
    """Validate and normalize card-generation input; return data and count."""
    language = validate_language(req.language)
    # Schema enforces max_length=10000; strip invisible chars before wrapping
    # to prevent zero-width character bypass of the tag sanitizer.
    text = _strip_invisible_chars(req.text)[:MAX_TEXT_CHARS]
    _check_context(len(text), _CARDS_PROMPT_OVERHEAD, "text")
    count = _clamp_count(req.count)
    validated = _validated_request(
        GenerateCardsRequest, req, language=language, text=text, count=count
    )
    return validated, count


def _quiz_request(
    req: GenerateQuizQuestionsRequest,
) -> tuple[GenerateQuizQuestionsRequest, int]:
    """Validate and normalize quiz-generation input; return data and count."""
    language = validate_language(req.language)
    topic = _strip_invisible_chars(req.topic)[:MAX_TOPIC_CHARS]
    _check_context(len(topic), _QUIZ_PROMPT_OVERHEAD, "topic")
    count = _clamp_count(req.count)
    validated = _validated_request(
        GenerateQuizQuestionsRequest, req, language=language, topic=topic, count=count
    )
    return validated, count


async def _generate(
    *,
    api_key: str,
    system: str,
    prompt: str,
    count: int,
    response_model: type[BaseModel],
    temperature: float,
    context: str,
) -> dict:
    """Call the provider under the content guard, always releasing the slot."""
    # Apply the cost policy before spending: the bounded estimate is logged for
    # budget observability and the input itself is already context-checked.
    estimated_tokens = _estimate_call_tokens(prompt, system, count)
    logger.info("%s: estimated tokens=%d", context, estimated_tokens)
    try:
        return await ai_json_request(
            system=system,
            prompt=prompt,
            response_model=response_model,
            temperature=temperature,
            context=context,
            model=settings.groq_model_heavy,
        )
    finally:
        try:
            await release_concurrency_slot(CONTENT_FEATURE, api_key)
        except Exception:
            # Never mask the request outcome with a cleanup failure.
            logger.exception("Failed to release content concurrency slot")


@router.post(
    "/generate-cards",
    response_model=GenerateCardsResponse,
)
async def generate_cards(
    request: Request,
    req: GenerateCardsRequest,
    api_key: str = Depends(_content_guard),
):
    validated, count = _cards_request(req)
    system = CARDS_GENERATION_SYSTEM.format(language=validated.language)
    prompt = CARDS_GENERATION_PROMPT.format(
        count=count,
        language=validated.language,
        text=wrap_user_input(validated.text),
    )
    return await _generate(
        api_key=api_key,
        system=system,
        prompt=prompt,
        count=count,
        response_model=GenerateCardsResponse,
        temperature=CARDS_TEMPERATURE,
        context="Card generation",
    )


@router.post(
    "/generate-quiz-questions",
    response_model=GenerateQuizQuestionsResponse,
)
async def generate_quiz_questions(
    request: Request,
    req: GenerateQuizQuestionsRequest,
    api_key: str = Depends(_content_guard),
):
    validated, count = _quiz_request(req)
    system = QUIZ_GENERATION_SYSTEM.format(
        language=validated.language, level=validated.level
    )
    prompt = QUIZ_GENERATION_PROMPT.format(
        count=count,
        language=validated.language,
        topic=wrap_user_input(validated.topic),
        level=validated.level,
    )
    return await _generate(
        api_key=api_key,
        system=system,
        prompt=prompt,
        count=count,
        response_model=GenerateQuizQuestionsResponse,
        temperature=QUIZ_TEMPERATURE,
        context="Quiz generation",
    )
