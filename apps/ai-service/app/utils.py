import hashlib
import json
import logging
import re
from typing import Optional

from fastapi import HTTPException
from pydantic import BaseModel, ValidationError

from app.services.cache import cache_service
from app.services.llm_client import llm_client

logger = logging.getLogger(__name__)


def _hash_for_cache(text: str) -> str:
    """W6: stable short hash for cache keys, avoiding prefix collisions."""
    return hashlib.sha256(text.encode("utf-8", errors="ignore")).hexdigest()[:16]


def _extract_json_bracket(text: str, open_ch: str, close_ch: str) -> Optional[dict]:
    start = text.find(open_ch)
    if start < 0:
        return None
    depth = 0
    in_string = False
    escape = False
    for i in range(start, len(text)):
        ch = text[i]
        if escape:
            escape = False
            continue
        if ch == '\\' and in_string:
            escape = True
            continue
        if ch == '"' and not escape:
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth == 0:
                candidate = text[start:i + 1]
                try:
                    return json.loads(candidate)
                except json.JSONDecodeError:
                    decoder = json.JSONDecoder()
                    try:
                        obj, _ = decoder.raw_decode(candidate)
                        return obj
                    except json.JSONDecodeError:
                        return None
    return None


def extract_json(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    text = text.strip()

    decoder = json.JSONDecoder()
    for i, ch in enumerate(text):
        if ch in ('{', '['):
            try:
                obj, _ = decoder.raw_decode(text, i)
                return obj
            except json.JSONDecodeError:
                continue

    for open_ch, close_ch in [("{", "}"), ("[", "]")]:
        result = _extract_json_bracket(text, open_ch, close_ch)
        if result is not None:
            return result

    logger.error("No JSON found in AI response: %s", repr(text[:300]))
    raise json.JSONDecodeError("No JSON found", text, 0)


def _max_tokens_for(
    system: str, prompt: str, response_model: Optional[type[BaseModel]]
) -> int:
    """Size the output budget to the requested JSON, not the client default.

    Reading generation asks for a ~1000-word passage plus 5 vocabulary entries and
    5 questions with explanations; 2048 output tokens truncates that into invalid
    JSON. Use the configured budget as a floor and scale up for large requests.
    """
    from app.config import settings

    budget = settings.max_tokens
    # A word costs roughly 1.3 tokens; JSON punctuation and the prompt's
    # vocabulary/questions add more. Estimate from the explicit word count when
    # one is present in the system prompt, otherwise from the prompt length.
    word_count = 0
    match = re.search(r"\((\d+)\s*words approximately\)", system)
    if match:
        word_count = int(match.group(1))
    elif len(prompt) > 500:
        word_count = len(prompt.split())

    needed = int(word_count * 4) + 2048
    return max(budget, needed)


async def ai_json_request(
    system: str,
    prompt: str,
    response_model: Optional[type[BaseModel]] = None,
    temperature: float = 0.5,
    context: str = "AI request",
    cache_ttl: int = 300,
    model: Optional[str] = None,
) -> dict:
    from app.config import settings

    # Resolve once so the cache key always describes the model actually used.
    resolved_model = model or settings.llm_model

    # W6: hash full prompt+system instead of truncated prefix to avoid cache collisions.
    # The model and effective temperature are part of the key: a model rollout or a
    # parse-failure retry must never serve results generated with different settings.
    def _cache_kwargs(temp: float) -> dict:
        return {
            "h": _hash_for_cache(f"{system}\u241F{prompt}"),
            "t": temp,
            "m": resolved_model,
            "ctx": context,
        }

    cache_kwargs = _cache_kwargs(temperature)

    if cache_ttl > 0:
        cached = await cache_service.get_cached("ai", **cache_kwargs)
        if cached is not None:
            # Schemas can gain required fields; never serve a cache entry that no
            # longer validates \u2014 drop it and fall through to a fresh LLM call.
            if response_model is not None:
                try:
                    validated_cached = response_model(**cached)
                except (ValidationError, TypeError) as exc:
                    logger.warning(
                        "%s: invalid cached response (%s) \u2014 refreshing",
                        context,
                        type(exc).__name__,
                    )
                    # Do not leave the stale entry around if the fresh call fails.
                    await cache_service.delete_cached("ai", **cache_kwargs)
                    cached = None
                else:
                    cached = validated_cached.model_dump()
            if cached is not None:
                logger.info("%s: cache hit", context)
                return cached

    async def _attempt(temp: float) -> tuple[dict, float]:
        raw = await llm_client.generate(
            prompt=prompt,
            system=system,
            model=resolved_model,
            temperature=temp,
            max_tokens=_max_tokens_for(system, prompt, response_model),
        )
        data = extract_json(raw)
        if not isinstance(data, dict):
            raise TypeError("AI response JSON is not an object")
        if response_model is not None:
            validated = response_model(**data)
            return validated.model_dump(), temp
        return data, temp

    try:
        try:
            result, effective_temperature = await _attempt(temperature)
        except (json.JSONDecodeError, ValidationError, TypeError) as first_err:
            # W5: retry once with deterministic temperature on parse/schema failure.
            logger.warning(
                "%s: first attempt failed (%s) — retrying with temperature=0.1",
                context,
                type(first_err).__name__,
            )
            try:
                result, effective_temperature = await _attempt(0.1)
            except (json.JSONDecodeError, ValidationError, TypeError) as second_err:
                logger.error("%s: retry also failed: %s", context, second_err)
                if isinstance(second_err, json.JSONDecodeError):
                    raise HTTPException(status_code=502, detail="AI returned invalid JSON")
                raise HTTPException(status_code=502, detail="AI returned malformed response")

        if cache_ttl > 0:
            await cache_service.set_cached(
                "ai", result, ttl=cache_ttl, **_cache_kwargs(effective_temperature)
            )
        return result
    except HTTPException:
        raise
    except Exception:
        logger.exception("%s failed", context)
        raise HTTPException(
            status_code=503, detail="AI service temporarily unavailable"
        )
