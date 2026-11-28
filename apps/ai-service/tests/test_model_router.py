"""Offline tests for feature-aware model routing and bounded fallbacks.

The router is policy-driven: no provider credentials, network access or Redis
instance is required. Provider calls and budget hooks are local fakes, so these
tests never touch a real store or a real model.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

import httpx
import pytest

from app.core.exceptions import (
    BudgetExceededException,
    ProviderUnavailableException,
    ValidationException,
)
from app.services.model_router import (
    BudgetState,
    Feature,
    ModelCapabilities,
    ModelDecision,
    ModelRouter,
    NoopBudgetHook,
)

POLICY_VERSION = "test-policy-v1"

# Server-owned tiers. Names are deliberately fake: config/policy supplies the
# real ids and no client-supplied value can enter this table.
LIGHT_PRIMARY = "test-light:primary"
LIGHT_FALLBACK = "test-light:fallback"
HEAVY_PRIMARY = "test-heavy:primary"
HEAVY_FALLBACK = "test-heavy:fallback"
HEAVY_STREAM = "test-heavy:stream"

LIGHT_FEATURES = ("grammar", "errors", "nlp")
HEAVY_FEATURES = ("chat", "writing", "reading", "content")
KNOWN_FEATURES = frozenset(LIGHT_FEATURES + HEAVY_FEATURES)
TRANSIENT_STATUSES = (400, 401, 404, 422)  # non-retryable, no fallback


def _caps(**overrides: Any) -> dict[str, Any]:
    caps: dict[str, Any] = {
        "streaming": True,
        "structured_output": True,
        "supports_json_schema": True,
        "context_window": 16_000,
        "max_output_tokens": 2_048,
    }
    caps.update(overrides)
    return caps


def _candidate(
    model_id: str,
    *,
    role: str = "primary",
    contract: str = "text",
    caps: dict[str, Any] | None = None,
    schema: str | None = None,
    quality: float = 0.8,
) -> dict[str, Any]:
    return {
        "model_id": model_id,
        "role": role,
        "response_contract": contract,
        "output_schema": schema,
        "quality_score": quality,
        "capabilities": caps or _caps(),
        "price_ref": "models.test",
    }


def _policy() -> dict[str, Any]:
    features: dict[str, Any] = {}
    for name in LIGHT_FEATURES:
        features[name] = {
            "enabled": True,
            "candidates": [
                _candidate(LIGHT_PRIMARY, schema=f"{name}.v1"),
                _candidate(
                    LIGHT_FALLBACK,
                    role="fallback",
                    schema=f"{name}.v1",
                    quality=0.7,
                ),
            ],
        }
    for name in HEAVY_FEATURES:
        features[name] = {
            "enabled": True,
            "candidates": [
                _candidate(HEAVY_PRIMARY, schema=f"{name}.v1"),
                _candidate(
                    HEAVY_FALLBACK,
                    role="fallback",
                    schema=f"{name}.v1",
                    quality=0.7,
                ),
            ],
        }
    features["chat"]["candidates"].append(
        _candidate(
            HEAVY_STREAM,
            role="fallback",
            contract="stream",
            caps=_caps(structured_output=False, supports_json_schema=False),
            quality=0.75,
        )
    )
    # A non-streaming model cannot serve the chat stream; it must never be
    # selected as a streaming fallback even though it is in the policy.
    features["chat"]["candidates"].append(
        _candidate("test-light:no-stream", role="fallback", caps=_caps(streaming=False))
    )
    return {
        "version": POLICY_VERSION,
        "aliases": {
            "GROQ_MODEL_LIGHT": {"default": LIGHT_PRIMARY},
            "GROQ_MODEL_HEAVY": {"default": HEAVY_PRIMARY},
            "GROQ_MODEL": {"default": HEAVY_PRIMARY},
        },
        "features": features,
    }


@dataclass
class _FakeBudgetHook(NoopBudgetHook):
    """In-memory budget hook recording every reservation transition."""

    available: bool = True
    reserve_ok: bool = True
    events: list[tuple[str, ...]] | None = None

    def __post_init__(self) -> None:
        if self.events is None:
            self.events = []

    def has_budget(self, feature: str, estimated_tokens: int | None) -> bool:
        assert self.events is not None
        self.events.append(("has_budget", feature))
        return self.available

    def reserve(self, feature: str, estimated_tokens: int | None) -> bool:
        assert self.events is not None
        self.events.append(("reserve", feature))
        return self.reserve_ok

    def commit(
        self,
        feature: str,
        actual_tokens: int | None,
        cost_estimate: float | None,
    ) -> None:
        assert self.events is not None
        self.events.append(("commit", feature, str(actual_tokens)))

    def release(self, feature: str, estimated_tokens: int | None) -> None:
        assert self.events is not None
        self.events.append(("release", feature))


def _router(*, hook: NoopBudgetHook | None = None, **kwargs: Any) -> ModelRouter:
    return ModelRouter(
        policy=_policy(),
        config_version=POLICY_VERSION,
        budget_hook=hook or NoopBudgetHook(),
        **kwargs,
    )


def _http_error(status: int) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "https://provider.invalid/v1/chat/completions")
    response = httpx.Response(status, request=request)
    return httpx.HTTPStatusError("provider failure", request=request, response=response)


async def _bounded_attempts(
    decision: ModelDecision,
    call: Callable[[str, int], Awaitable[str]],
    *,
    retryable: frozenset[int] = frozenset({429, 502, 503, 504}),
    sleep: Callable[[float], Awaitable[None]] | None = None,
) -> str:
    """Apply an ordered decision to a provider callable with bounded fallback.

    This mirrors the caller-side fallback contract under test: retry only
    transient status codes, cap attempts at the decision's candidate count,
    and never retry a stream after a delta has been emitted.
    """
    if not decision.available:
        raise ProviderUnavailableException("No compatible model available")
    last_error: BaseException | None = None
    for index, candidate in enumerate(decision.candidates[: decision.fallback_limit + 1]):
        try:
            return await call(candidate.model_id, index)
        except httpx.HTTPStatusError as exc:
            last_error = exc
            status = exc.response.status_code
            if status not in retryable or index >= decision.fallback_limit:
                raise
            if sleep is not None:
                await sleep(0.01 * (index + 1))
        except (httpx.TransportError, TimeoutError):
            raise  # a stream/transport failure after partial output is terminal
    if last_error is not None:
        raise last_error
    raise ProviderUnavailableException("No compatible model available")


def _run_decision(decision: ModelDecision, **kwargs: Any) -> str:
    return asyncio.run(_bounded_attempts(decision, **kwargs))


def _require_decision(decision: ModelDecision, feature: str) -> ModelDecision:
    """Translate an empty routing decision into the guard-level API error."""
    if decision.available:
        return decision
    if decision.reason in {"killed", "feature_disabled", "override_not_allowed"}:
        raise ValidationException(f"Unknown AI feature: {feature}")
    if decision.reason == "budget_exceeded":
        raise BudgetExceededException(f"Daily {feature} budget exhausted")
    raise ProviderUnavailableException("No compatible model available")


class TestFeatureRouting:
    @pytest.mark.parametrize("feature", LIGHT_FEATURES)
    def test_light_features_select_light_tier(self, feature: str):
        decision = _router().select(feature, needs_structured=True)
        assert decision.reason == "selected"
        assert decision.primary is not None
        assert decision.primary.model_id == LIGHT_PRIMARY
        assert [c.model_id for c in decision.fallbacks] == [LIGHT_FALLBACK]

    @pytest.mark.parametrize("feature", HEAVY_FEATURES)
    def test_heavy_features_select_heavy_tier(self, feature: str):
        decision = _router().select(feature, needs_structured=True)
        assert decision.reason == "selected"
        assert decision.primary is not None
        assert decision.primary.model_id == HEAVY_PRIMARY
        assert [c.model_id for c in decision.fallbacks] == [HEAVY_FALLBACK]

    def test_streaming_chat_stays_on_heavy_tier(self):
        decision = _router().select(Feature.CHAT, needs_streaming=True)
        # The streaming-only heavy candidate replaces the text fallback because
        # two fallbacks are allowed by default and it is schema-incompatible.
        assert [c.model_id for c in decision.candidates] == [
            HEAVY_PRIMARY,
            HEAVY_FALLBACK,
        ]
        assert all(c.model_id.startswith("test-heavy:") for c in decision.candidates)
        assert all(c.capabilities.streaming for c in decision.candidates)

    def test_model_ids_come_from_policy_not_client(self, monkeypatch):
        monkeypatch.setenv("MODEL_POLICY_JSON", json.dumps(_policy()))
        router = ModelRouter.from_env()
        decision = router.select("grammar")
        assert decision.primary is not None
        assert decision.primary.model_id == LIGHT_PRIMARY
        assert router.resolve_alias("GROQ_MODEL_LIGHT", "grammar") == LIGHT_PRIMARY
        assert router.resolve_alias("GROQ_MODEL_HEAVY", "chat") == HEAVY_PRIMARY

    @pytest.mark.parametrize("override", ["gpt-attacker", "attacker/model"])
    def test_client_model_override_outside_policy_is_rejected(self, override: str):
        decision = _router().select("grammar", override_model=override)
        assert not decision.available
        assert decision.reason == "override_not_allowed"

    def test_blank_override_does_not_bypass_policy(self):
        decision = _router().select("grammar", override_model="  ")
        assert not decision.available
        assert decision.reason == "override_not_allowed"

    def test_server_alias_override_is_allowed(self):
        router = _router()
        decision = router.select(
            "grammar", override_model=router.resolve_alias("GROQ_MODEL_LIGHT", "grammar")
        )
        assert decision.available
        assert decision.primary is not None
        assert decision.primary.model_id == LIGHT_PRIMARY

    def test_known_feature_set_matches_guard_features(self):
        assert frozenset(_router()._policy["features"]) == KNOWN_FEATURES


class TestFallback:
    @pytest.mark.parametrize("status", [429, 503, 502, 504])
    def test_transient_provider_error_uses_one_compatible_fallback(self, status: int):
        decision = _router().select("chat", needs_structured=True)
        calls: list[str] = []

        async def provider(model: str, index: int) -> str:
            calls.append(model)
            if index == 0:
                raise _http_error(status)
            return model

        chosen = _run_decision(decision, call=provider)
        assert calls == [HEAVY_PRIMARY, HEAVY_FALLBACK]
        assert chosen == HEAVY_FALLBACK

    @pytest.mark.parametrize("status", TRANSIENT_STATUSES)
    def test_non_transient_error_does_not_fallback(self, status: int):
        decision = _router().select("grammar", needs_structured=True)
        calls: list[str] = []

        async def provider(model: str, index: int) -> str:
            calls.append(model)
            raise _http_error(status)

        with pytest.raises(httpx.HTTPStatusError) as exc:
            _run_decision(decision, call=provider)
        assert exc.value.response.status_code == status
        assert calls == [LIGHT_PRIMARY]

    def test_no_silent_stream_restart_after_partial_delta(self):
        decision = _router().select(Feature.CHAT, needs_streaming=True)
        calls: list[str] = []

        async def provider(model: str, index: int) -> str:
            calls.append(model)
            if index == 0:
                raise httpx.ReadTimeout("provider failed after first delta")
            return model

        with pytest.raises(httpx.ReadTimeout):
            _run_decision(decision, call=provider)
        assert calls == [HEAVY_PRIMARY]

    def test_fallback_count_is_bounded(self, monkeypatch):
        async def no_sleep(_: float) -> None:
            return None

        monkeypatch.setattr(asyncio, "sleep", no_sleep)
        decision = _router(fallback_limit=1).select(Feature.CHAT, needs_streaming=True)
        calls: list[str] = []

        async def provider(model: str, index: int) -> str:
            calls.append(model)
            raise _http_error(503)

        with pytest.raises(httpx.HTTPStatusError):
            _run_decision(decision, call=provider, sleep=no_sleep)
        assert calls == [HEAVY_PRIMARY, HEAVY_FALLBACK]
        assert len(calls) <= decision.fallback_limit + 1

    def test_no_compatible_fallback_raises_provider_unavailable(self):
        # A killed feature yields no candidates, so the bounded call path must
        # stop at the provider-unavailable error without invoking any provider.
        decision = _router(kill_switch=["chat"]).select("chat")
        calls: list[str] = []

        async def provider(model: str, index: int) -> str:
            calls.append(model)
            return model

        with pytest.raises(ProviderUnavailableException):
            _run_decision(decision, call=provider)
        assert calls == []

    def test_zero_fallback_limit_retries_only_the_primary(self):
        decision = _router(fallback_limit=0).select("writing", needs_structured=True)
        calls: list[str] = []

        async def provider(model: str, index: int) -> str:
            calls.append(model)
            raise _http_error(503)

        with pytest.raises(httpx.HTTPStatusError):
            _run_decision(decision, call=provider)
        assert calls == [HEAVY_PRIMARY]

    def test_incompatible_stream_model_is_never_selected(self):
        decision = _router().select(Feature.CHAT, needs_streaming=True)
        assert all(c.model_id != "test-light:no-stream" for c in decision.candidates)

    def test_fallback_requires_same_schema_contract(self):
        decision = _router().select("grammar", needs_structured=True)
        primary = decision.primary
        assert primary is not None
        for fallback in decision.fallbacks:
            assert fallback.response_contract == primary.response_contract
            assert fallback.output_schema == primary.output_schema
            assert fallback.supports_json_schema == primary.supports_json_schema


class TestUnknownFeature:
    @pytest.mark.parametrize("feature", ["billing_admin", "unknown", "chat;DROP", None])
    def test_unknown_feature_is_rejected_before_budget_or_provider(self, feature: Any):
        hook = _FakeBudgetHook()
        router = _router(hook=hook)
        hook.events = []  # only calls made by select() are measured
        decision = router.select(feature or "")
        assert not decision.available
        assert hook.events == []

    def test_unknown_feature_never_reaches_budget_guard(self):
        hook = _FakeBudgetHook()
        router = _router(hook=hook)
        feature = "definitely_unknown_feature"
        assert feature not in KNOWN_FEATURES
        decision = router.select(feature)
        assert not decision.available
        with pytest.raises(ValidationException) as exc:
            _require_decision(decision, feature)
        assert exc.value.status_code == 400
        assert exc.value.code.value == "VALIDATION_ERROR"
        assert hook.events == []


class TestBudgetGuard:
    @pytest.mark.asyncio
    async def test_exhausted_budget_blocks_provider(self):
        hook = _FakeBudgetHook(available=False)
        router = _router(hook=hook)
        hook.events = []
        calls: list[str] = []
        decision = router.select("chat", estimated_tokens=100)
        assert not decision.available
        assert decision.reason == "budget_exceeded"
        with pytest.raises(BudgetExceededException):
            _require_decision(decision, "chat")
        assert calls == []

    @pytest.mark.asyncio
    async def test_exhausted_budget_blocks_fallback(self):
        hook = _FakeBudgetHook(available=False)
        router = _router(hook=hook)
        hook.events = []
        decision = router.select("grammar", estimated_tokens=100)
        assert not decision.available
        assert decision.fallbacks == ()
        with pytest.raises(BudgetExceededException):
            _require_decision(decision, "grammar")

    def test_missing_budget_state_does_not_invent_a_denial(self):
        hook = _FakeBudgetHook()
        router = _router(hook=hook)
        assert router.budget_available("chat")
        decision = router.select("chat", budget_state=BudgetState())
        assert decision.available

    def test_usage_is_recorded_once_from_provider_total(self):
        hook = _FakeBudgetHook()
        router = _router(hook=hook)
        usage = {"prompt_tokens": 12, "completion_tokens": 8, "total_tokens": 20}
        with router.reserved_budget("chat", estimated_tokens=15) as reservation:
            assert reservation["reserved"] is True
            router.commit_usage(
                reservation,
                actual_tokens=usage["total_tokens"],
                cost_estimate=None,
            )
        assert hook.events is not None
        assert [e for e in hook.events if e[0] == "commit"] == [("commit", "chat", "20")]
        assert not [e for e in hook.events if e[0] == "release"]

    def test_missing_provider_usage_is_not_fabricated(self):
        hook = _FakeBudgetHook()
        router = _router(hook=hook)
        with router.reserved_budget("grammar", estimated_tokens=10) as reservation:
            assert reservation["actual_tokens"] is None
            assert reservation["cost_estimate"] is None
        assert hook.events is not None
        assert ("release", "grammar") in hook.events
        assert not [e for e in hook.events if e[0] == "commit"]

    def test_store_error_fails_closed(self):
        class BrokenHook(NoopBudgetHook):
            def has_budget(self, feature: str, estimated_tokens: int | None) -> bool:
                raise RuntimeError("redis unavailable")

        router = _router(hook=BrokenHook())
        decision = router.select("chat", estimated_tokens=1)
        assert not decision.available
        assert decision.reason == "budget_exceeded"

    def test_reservation_released_on_provider_failure(self):
        hook = _FakeBudgetHook()
        router = _router(hook=hook)
        with pytest.raises(ProviderUnavailableException):
            with router.reserved_budget("chat", estimated_tokens=10) as reservation:
                assert reservation["reserved"] is True
                raise ProviderUnavailableException("provider down")
        assert hook.events is not None
        assert ("release", "chat") in hook.events
        assert not [e for e in hook.events if e[0] == "commit"]


class TestPolicyCompatibility:
    def test_capabilities_reject_unsupported_stream_or_schema(self):
        caps = ModelCapabilities(streaming=False, supports_json_schema=False)
        assert not caps.supports(streaming=True, structured=True)
        assert caps.supports(streaming=False, structured=True)
        assert not caps.supports(streaming=False, structured=True, json_schema=True)

    def test_cost_estimate_stays_unknown_when_price_missing(self):
        router = _router(pricing_version="unpriced")
        decision = router.select("chat", needs_structured=True)
        assert decision.primary is not None
        record = router.record_attempt(
            decision,
            outcome="success",
            started_at=1.0,
            latency_ms=5,
            input_tokens=10,
            output_tokens=None,
        )
        assert record.is_estimated is True
        assert record.cost_estimate is None
