"""Cost-policy tests for the AI service.

Covers the AI-15 slice: budget boundaries, usage recording, per-feature kill
switch, fail-closed guards and the ``feature_guard`` composition order.

Tests never read real .env values or credentials: settings.api_keys is patched
with synthetic values and all Redis access goes through in-process fakes.
"""

import pytest
from fastapi import Request
from unittest.mock import patch

from app.core.exceptions import (
    AiErrorCode,
    BudgetExceededException,
    ProviderUnavailableException,
    RateLimitExceededException,
)
from app.core.limits import BUDGET_WINDOW_SECONDS
from app.services.model_router import BudgetState, KillSwitch, ModelRouter, parse_kill_switch


# ---------------------------------------------------------------------------
# Fakes and fixtures
# ---------------------------------------------------------------------------

class FakePipeline:
    """Minimal async pipeline implementing the interface used by acquire()."""

    def __init__(self, results):
        self.results = results
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return None

    def incr(self, key):
        self.calls.append(("incr", key))
        return self

    def expire(self, key, ttl):
        self.calls.append(("expire", key, ttl))
        return self

    async def execute(self):
        return list(self.results)


class FakeRedis:
    """In-memory key/value fake with optional failure injection."""

    def __init__(self):
        self.store = {}
        self.ttls = {}
        self.get_calls = []
        self.incrby_calls = []
        self.pipeline_calls = []
        self.pipeline_results = [1, True, 1, True]
        self.fail_get = False
        self.fail_incrby = False
        self.fail_pipeline = False

    async def get(self, key):
        self.get_calls.append(key)
        if self.fail_get:
            raise RuntimeError("store unavailable")
        return self.store.get(key)

    async def incr(self, key):
        value = int(self.store.get(key, 0)) + 1
        self.store[key] = value
        return value

    async def incrby(self, key, amount):
        self.incrby_calls.append((key, amount))
        if self.fail_incrby:
            raise RuntimeError("store unavailable")
        value = int(self.store.get(key, 0)) + amount
        self.store[key] = value
        return value

    async def expire(self, key, ttl):
        self.ttls[key] = ttl
        return True

    async def decr(self, key):
        value = int(self.store.get(key, 0)) - 1
        self.store[key] = value
        return value

    async def delete(self, key):
        self.store.pop(key, None)
        return True

    def pipeline(self, transaction=True):
        self.pipeline_calls.append(transaction)
        if self.fail_pipeline:
            raise RuntimeError("store unavailable")
        return FakePipeline(self.pipeline_results)


@pytest.fixture
def redis():
    """Fresh in-process Redis fake with no sticky module state."""
    import app.rate_limit as rate_limit

    fake = FakeRedis()
    original_client = rate_limit._redis_client
    original_unavailable = rate_limit._redis_unavailable
    rate_limit._redis_client = fake
    rate_limit._redis_unavailable = False
    try:
        yield fake
    finally:
        rate_limit._redis_client = original_client
        rate_limit._redis_unavailable = original_unavailable


@pytest.fixture
def small_budget(monkeypatch):
    """Deterministic budget value patched where the guards actually read it."""
    import app.core.limits as limits
    import app.rate_limit as rate_limit

    monkeypatch.setattr(limits, "DAILY_TOKEN_BUDGET", 1000)
    monkeypatch.setattr(rate_limit, "DAILY_TOKEN_BUDGET", 1000)
    return 1000


@pytest.fixture
def request_stub():
    """Minimal Request for guard calls that accept a request argument."""
    return Request({
        "type": "http",
        "method": "POST",
        "path": "/v1/ai/chat",
        "headers": [(b"x-api-key", b"synthetic-key"), (b"x-request-id", b"req-1")],
    })


# ---------------------------------------------------------------------------
# Budget boundaries
# ---------------------------------------------------------------------------

class TestBudgetBoundaries:
    @pytest.mark.asyncio
    async def test_absent_counter_allows(self, redis, small_budget):
        from app.rate_limit import precheck_budget

        await precheck_budget("chat")
        assert redis.get_calls == ["ai:budget:daily:chat"]

    @pytest.mark.asyncio
    async def test_one_token_below_budget_allows(self, redis, small_budget):
        from app.rate_limit import precheck_budget

        redis.store["ai:budget:daily:chat"] = small_budget - 1
        await precheck_budget("chat")

    @pytest.mark.asyncio
    async def test_exact_budget_blocks_with_429_rate_limited(self, redis, small_budget):
        from app.rate_limit import precheck_budget

        redis.store["ai:budget:daily:chat"] = small_budget
        with pytest.raises(BudgetExceededException) as raised:
            await precheck_budget("chat")

        exc = raised.value
        assert exc.status_code == 429
        assert exc.code == AiErrorCode.RATE_LIMITED
        assert exc.error_code == "RATE_LIMITED"

    @pytest.mark.asyncio
    async def test_over_budget_blocks(self, redis, small_budget):
        from app.rate_limit import precheck_budget

        redis.store["ai:budget:daily:chat"] = small_budget + 1
        with pytest.raises(BudgetExceededException):
            await precheck_budget("chat")

    @pytest.mark.asyncio
    async def test_feature_counters_are_independent(self, redis, small_budget):
        from app.rate_limit import precheck_budget

        redis.store["ai:budget:daily:chat"] = small_budget
        redis.store["ai:budget:daily:content"] = small_budget - 1

        with pytest.raises(BudgetExceededException):
            await precheck_budget("chat")
        await precheck_budget("content")


# ---------------------------------------------------------------------------
# Usage recording
# ---------------------------------------------------------------------------

class TestUsageRecording:
    @pytest.mark.asyncio
    async def test_records_exact_tokens_under_feature_key(self, redis):
        from app.rate_limit import record_usage

        await record_usage("chat", 500)

        assert redis.incrby_calls == [("ai:budget:daily:chat", 500)]

    @pytest.mark.asyncio
    async def test_sets_daily_ttl(self, redis):
        from app.rate_limit import record_usage

        await record_usage("chat", 100)

        assert redis.ttls["ai:budget:daily:chat"] == BUDGET_WINDOW_SECONDS

    @pytest.mark.asyncio
    async def test_zero_tokens_still_refresh_ttl(self, redis):
        from app.rate_limit import record_usage

        await record_usage("chat", 0)

        assert redis.incrby_calls == [("ai:budget:daily:chat", 0)]
        assert redis.ttls["ai:budget:daily:chat"] == BUDGET_WINDOW_SECONDS

    @pytest.mark.asyncio
    async def test_negative_tokens_decrement_counter(self, redis):
        from app.rate_limit import record_usage

        redis.store["ai:budget:daily:chat"] = 300
        await record_usage("chat", -100)

        assert redis.store["ai:budget:daily:chat"] == 200

    @pytest.mark.asyncio
    async def test_recorded_usage_is_visible_to_precheck(self, redis, small_budget):
        from app.rate_limit import precheck_budget, record_usage

        await record_usage("chat", small_budget - 1)
        await precheck_budget("chat")  # still under the limit
        await record_usage("chat", 1)
        with pytest.raises(BudgetExceededException):
            await precheck_budget("chat")


# ---------------------------------------------------------------------------
# Kill switch
# ---------------------------------------------------------------------------

class TestKillSwitch:
    def test_enabled_feature_is_not_killed(self):
        ks = KillSwitch(["chat"])
        assert not ks.is_killed("content")

    def test_disabled_feature_is_killed(self):
        ks = KillSwitch(["chat"])
        assert ks.is_killed("chat")

    def test_disabling_one_feature_leaves_others_enabled(self):
        ks = KillSwitch(["chat"])
        assert ks.is_killed("chat")
        assert not ks.is_killed("content")
        assert not ks.is_killed("grammar")

    def test_empty_feature_fails_closed(self):
        ks = KillSwitch([])
        assert ks.is_killed("")
        assert ks.is_killed("   ")

    def test_sentinel_default_is_always_killed(self):
        ks = KillSwitch([])
        assert ks.is_killed("default")

    def test_case_insensitive_and_trims_whitespace(self):
        ks = KillSwitch([" CHAT ", "Content"])
        assert ks.is_killed("chat")
        assert ks.is_killed("CHAT")
        assert ks.is_killed("content")

    def test_parse_kill_switch_variants(self):
        assert parse_kill_switch("") == ()
        assert parse_kill_switch("chat") == ("chat",)
        assert parse_kill_switch("chat , content") == ("chat", "content")
        assert parse_kill_switch("CHAT,Content") == ("chat", "content")
        assert parse_kill_switch("writing-feedback") == ("writing_feedback",)

    def test_env_toggle_takes_effect_without_module_reload(self, monkeypatch):
        import os

        monkeypatch.setenv("AI_FEATURE_KILL_SWITCH", "chat")
        killed_chat = parse_kill_switch(os.getenv("AI_FEATURE_KILL_SWITCH", ""))
        assert KillSwitch(killed_chat).is_killed("chat")

        monkeypatch.setenv("AI_FEATURE_KILL_SWITCH", "content")
        killed_content = parse_kill_switch(os.getenv("AI_FEATURE_KILL_SWITCH", ""))
        ks = KillSwitch(killed_content)
        assert ks.is_killed("content")
        assert not ks.is_killed("chat")

    def test_router_returns_killed_decision_without_candidates(self):
        router = ModelRouter(policy={"version": "test"}, kill_switch=KillSwitch(["chat"]))
        decision = router.select("chat")
        assert decision.reason == "killed"
        assert not decision.available
        assert decision.primary is None

    def test_router_per_kill_switch_override(self):
        router = ModelRouter(policy={"version": "test"}, kill_switch=KillSwitch([]))
        decision = router.select("chat", killed_features=["chat"])
        assert decision.reason == "killed"
        assert not decision.available


# ---------------------------------------------------------------------------
# Fail-closed guards
# ---------------------------------------------------------------------------

class TestFailClosed:
    @pytest.mark.asyncio
    async def test_no_redis_blocks_all_three_guards(self, redis, request_stub):
        import app.rate_limit as rate_limit

        rate_limit._redis_client = None
        rate_limit._redis_unavailable = True

        with patch.object(rate_limit, "FAIL_CLOSED_ON_STORE_ERROR", True):
            with pytest.raises(ProviderUnavailableException):
                await rate_limit.precheck_budget("chat")
            with pytest.raises(ProviderUnavailableException):
                await rate_limit.check_rate_limit("chat", "synthetic-key")
            with pytest.raises(ProviderUnavailableException):
                await rate_limit.acquire_concurrency_slot(
                    "chat", "synthetic-key", request_stub
                )

    @pytest.mark.asyncio
    async def test_fail_open_when_policy_disabled(self, redis, request_stub):
        import app.rate_limit as rate_limit

        rate_limit._redis_client = None
        rate_limit._redis_unavailable = True

        with patch.object(rate_limit, "FAIL_CLOSED_ON_STORE_ERROR", False):
            await rate_limit.precheck_budget("chat")
            await rate_limit.check_rate_limit("chat", "synthetic-key")
            await rate_limit.acquire_concurrency_slot(
                "chat", "synthetic-key", request_stub
            )

    @pytest.mark.asyncio
    async def test_store_error_fails_closed(self, redis):
        import app.rate_limit as rate_limit

        redis.fail_get = True
        with patch.object(rate_limit, "FAIL_CLOSED_ON_STORE_ERROR", True):
            with pytest.raises(ProviderUnavailableException):
                await rate_limit.precheck_budget("chat")

    @pytest.mark.asyncio
    async def test_record_usage_swallows_store_errors(self, redis):
        from app.rate_limit import record_usage

        redis.fail_incrby = True
        await record_usage("chat", 100)  # no exception


# ---------------------------------------------------------------------------
# feature_guard composition
# ---------------------------------------------------------------------------

class TestFeatureGuard:
    @pytest.mark.asyncio
    async def test_guard_runs_checks_in_order_and_returns_key(self, redis, request_stub):
        import app.core.deps as deps
        import app.rate_limit as rate_limit

        order = []
        original_rate = rate_limit.check_rate_limit
        original_concurrency = rate_limit.acquire_concurrency_slot
        original_budget = rate_limit.precheck_budget

        async def track_rate(feature, key):
            order.append("rate")
            return await original_rate(feature, key)

        async def track_concurrency(feature, key, request):
            order.append("concurrency")
            return await original_concurrency(feature, key, request)

        async def track_budget(feature):
            order.append("budget")
            return await original_budget(feature)

        # Patch before building the guard: deps.feature_guard captures the
        # functions when the factory runs (local import inside the function).
        with patch.object(rate_limit, "check_rate_limit", track_rate), \
             patch.object(rate_limit, "acquire_concurrency_slot", track_concurrency), \
             patch.object(rate_limit, "precheck_budget", track_budget):
            guard = deps.feature_guard("chat")
            result = await guard(request_stub, api_key="synthetic-key")

        assert order == ["rate", "concurrency", "budget"]
        assert result == "synthetic-key"

    @pytest.mark.asyncio
    async def test_guard_blocks_on_rate_limit(self, redis, request_stub):
        from app.core.deps import feature_guard
        from app.rate_limit import _fingerprint

        # check_rate_limit hashes the API key for the Redis key.
        rate_key = f"ai:rate:chat:{_fingerprint('synthetic-key')}"
        redis.store[rate_key] = 999

        guard = feature_guard("chat")
        with pytest.raises(RateLimitExceededException):
            await guard(request_stub, api_key="synthetic-key")

    @pytest.mark.asyncio
    async def test_guard_blocks_on_budget(self, redis, request_stub, small_budget):
        from app.core.deps import feature_guard

        redis.store["ai:budget:daily:chat"] = small_budget

        guard = feature_guard("chat")
        with pytest.raises(BudgetExceededException):
            await guard(request_stub, api_key="synthetic-key")

    @pytest.mark.asyncio
    async def test_guard_succeeds_with_all_guards_available(self, redis, request_stub):
        from app.core.deps import feature_guard

        guard = feature_guard("chat")
        assert await guard(request_stub, api_key="synthetic-key") == "synthetic-key"


# ---------------------------------------------------------------------------
# ModelRouter budget state
# ---------------------------------------------------------------------------

class TestBudgetState:
    def test_unknown_state_does_not_deny(self):
        state = BudgetState()
        assert state.has_budget()
        assert state.has_budget(estimated_tokens=1000)

    def test_exhausted_feature_or_global_denies(self):
        assert not BudgetState(feature_budget_available=False).has_budget()
        assert not BudgetState(global_budget_available=False).has_budget()

    def test_insufficient_remaining_tokens_denies(self):
        state = BudgetState(feature_remaining_tokens=500)
        assert not state.has_budget(estimated_tokens=1000)
        assert state.has_budget(estimated_tokens=100)

    def test_global_remaining_is_also_checked(self):
        state = BudgetState(feature_remaining_tokens=2000, global_remaining_tokens=500)
        assert not state.has_budget(estimated_tokens=1000)
