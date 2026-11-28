"""Tests for the AI-service Redis-backed slot guards (ai-19).

The service does not expose a standalone distributed-lock primitive. Its
lock-like behaviour lives in :mod:`app.rate_limit`: concurrency slots are
identified by feature plus an API-key fingerprint, expire via a TTL, are
released explicitly, and fail closed when Redis is unavailable. These tests
pin those ownership/scope, expiry, release and outage policies.

All Redis interactions are mocked. No live Redis, provider calls, ``.env``
values or credentials are used.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from starlette.requests import Request

from app import rate_limit
from app.core import exceptions, limits
from app.core.exceptions import (
    AiErrorCode,
    ConcurrencyLimitExceededException,
    ProviderUnavailableException,
)


@pytest.fixture(autouse=True)
def reset_redis_state(monkeypatch):
    """Each test owns the module-level Redis cache and outage latch."""
    monkeypatch.setattr(rate_limit, "_redis_client", None)
    monkeypatch.setattr(rate_limit, "_redis_unavailable", False)
    yield


@pytest.fixture(autouse=True)
def fail_closed(monkeypatch):
    """Billable guards must be fail-closed; outage tests toggle it explicitly."""
    monkeypatch.setattr(rate_limit, "FAIL_CLOSED_ON_STORE_ERROR", True)
    yield


@pytest.fixture(autouse=True)
def default_limits(monkeypatch):
    """Pin limits so an operator's environment cannot change expectations."""
    monkeypatch.setattr(rate_limit, "MAX_CONCURRENT_PER_USER", 2)
    monkeypatch.setattr(rate_limit, "MAX_CONCURRENT_GLOBAL", 8)
    monkeypatch.setattr(rate_limit, "RATE_WINDOW_SECONDS", 60)
    monkeypatch.setattr(rate_limit, "BUDGET_WINDOW_SECONDS", 86_400)
    yield


@pytest.fixture
def mock_redis(monkeypatch):
    """Install a fresh AsyncMock Redis client and return it."""
    client = AsyncMock()
    # redis-py's pipeline() is synchronous and returns an async context manager.
    client.pipeline = MagicMock()
    monkeypatch.setattr(rate_limit, "_redis_client", client)
    return client


@pytest.fixture
def fake_pipe(mock_redis):
    """Minimal async pipeline context manager with a controllable result."""
    class FakePipeline:
        def __init__(self):
            self.calls = []
            self.results = [1, 120, 1, 120]
            self.execute = AsyncMock(side_effect=lambda: self.results)

        def incr(self, key):
            self.calls.append(("incr", key))

        def expire(self, key, ttl):
            self.calls.append(("expire", key, ttl))

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

    pipe = FakePipeline()
    # app.rate_limit uses r.pipeline(...) directly as an async context manager.
    mock_redis.pipeline.return_value = pipe
    return pipe


def _request(
    path: str = "/v1/ai/chat", headers: list[tuple[bytes, bytes]] | None = None
) -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": path,
            "headers": headers or [],
            "scheme": "http",
            "server": ("testserver", 80),
            "client": ("127.0.0.1", 1234),
        }
    )


# ---------------------------------------------------------------------------
# Ownership / scope isolation
# ---------------------------------------------------------------------------


def test_concurrency_keys_separate_users_features_and_global_scope():
    """A slot belongs to one verified key and one feature only."""
    user_a = rate_limit._concurrency_key("chat", "key-a", "user")
    user_a_again = rate_limit._concurrency_key("chat", "key-a", "user")
    user_b = rate_limit._concurrency_key("chat", "key-b", "user")
    feature_b = rate_limit._concurrency_key("content", "key-a", "user")
    global_key = rate_limit._concurrency_key("chat", "key-a", "global")

    assert user_a == user_a_again
    assert len({user_a, user_b, feature_b, global_key}) == 4
    assert user_a.startswith("ai:concurrency:user:")
    assert ":chat" in user_a
    assert global_key == "ai:concurrency:global:chat"
    assert "key-a" not in user_a  # raw credentials never enter Redis keys
    assert "key-a" not in global_key


def test_key_fingerprint_hides_the_api_key_but_keeps_it_distinct():
    fingerprint_a = rate_limit._fingerprint("key-a")
    assert fingerprint_a == rate_limit._fingerprint("key-a")
    assert fingerprint_a != rate_limit._fingerprint("key-b")
    assert "key-a" not in fingerprint_a
    assert len(fingerprint_a) == 64


def test_rate_limit_key_is_per_caller_and_per_path():
    """Caller hints split slowapi buckets; raw hints are never stored."""
    auth = [(b"x-api-key", b"key-a")]
    request = _request("/v1/ai/chat", auth)
    request.state.request_id = "hint-one"
    other = _request("/v1/ai/chat", auth)
    other.state.request_id = "hint-two"
    other_path = _request("/v1/ai/content/generate-cards", auth)
    other_path.state.request_id = "hint-one"

    first = rate_limit._rate_limit_key(request)
    assert first == rate_limit._rate_limit_key(request)
    assert first != rate_limit._rate_limit_key(other)
    assert first != rate_limit._rate_limit_key(other_path)
    assert "hint-one" not in first
    assert "key-a" not in first


def test_rate_limit_key_falls_back_when_no_api_key_is_present():
    """Unauthenticated diagnostics use the remote address, never a shared key."""
    assert rate_limit._rate_limit_key(_request()) == "127.0.0.1"


def test_budget_key_is_feature_scoped():
    assert rate_limit._budget_key("chat") == "ai:budget:daily:chat"
    assert rate_limit._budget_key("content") == "ai:budget:daily:content"


@pytest.mark.asyncio
async def test_acquire_increments_only_the_owning_users_keys(mock_redis, fake_pipe):
    """Acquire touches the caller's user key and the shared global key only."""
    mock_redis.pipeline.return_value = fake_pipe

    await rate_limit.acquire_concurrency_slot("chat", "key-a", _request())

    expected_user = rate_limit._concurrency_key("chat", "key-a", "user")
    expected_global = rate_limit._concurrency_key("chat", "key-a", "global")
    assert fake_pipe.calls == [
        ("incr", expected_user),
        ("expire", expected_user, 120),
        ("incr", expected_global),
        ("expire", expected_global, 120),
    ]
    fake_pipe.execute.assert_awaited_once()
    mock_redis.decr.assert_not_awaited()


@pytest.mark.asyncio
async def test_release_only_decrements_the_owning_users_keys(mock_redis):
    """Releasing one caller's slot must not free another caller's slot."""
    await rate_limit.release_concurrency_slot("chat", "key-a")

    expected_user = rate_limit._concurrency_key("chat", "key-a", "user")
    expected_global = rate_limit._concurrency_key("chat", "key-a", "global")
    assert mock_redis.decr.await_args_list[0].args == (expected_user,)
    assert mock_redis.decr.await_args_list[1].args == (expected_global,)


@pytest.mark.asyncio
async def test_release_deletes_zero_or_negative_counter(mock_redis):
    """A freed slot is fully removed, never left as a negative counter."""
    mock_redis.decr = AsyncMock(return_value=0)

    await rate_limit.release_concurrency_slot("chat", "key-a")

    expected_user = rate_limit._concurrency_key("chat", "key-a", "user")
    expected_global = rate_limit._concurrency_key("chat", "key-a", "global")
    assert mock_redis.delete.await_args_list[0].args == (expected_user,)
    assert mock_redis.delete.await_args_list[1].args == (expected_global,)


@pytest.mark.asyncio
async def test_release_keeps_a_still_held_counter(mock_redis):
    """Releasing one of several slots leaves the remaining count intact."""
    mock_redis.decr = AsyncMock(return_value=1)

    await rate_limit.release_concurrency_slot("chat", "key-a")

    mock_redis.delete.assert_not_awaited()


@pytest.mark.asyncio
async def test_user_limit_rolls_back_both_counters(mock_redis, fake_pipe):
    """A rejected user must not leak a global slot."""
    fake_pipe.results = [3, 120, 1, 120]
    mock_redis.pipeline.return_value = fake_pipe

    with pytest.raises(ConcurrencyLimitExceededException) as exc:
        await rate_limit.acquire_concurrency_slot("chat", "key-a", _request())

    assert exc.value.error_code == AiErrorCode.RATE_LIMITED.value
    expected_user = rate_limit._concurrency_key("chat", "key-a", "user")
    expected_global = rate_limit._concurrency_key("chat", "key-a", "global")
    assert [call.args[0] for call in mock_redis.decr.await_args_list] == [
        expected_user,
        expected_global,
    ]


@pytest.mark.asyncio
async def test_global_limit_rolls_back_both_counters(mock_redis, fake_pipe):
    """A rejected global request must not leak the caller's user slot."""
    fake_pipe.results = [1, 120, 9, 120]
    mock_redis.pipeline.return_value = fake_pipe

    with pytest.raises(ConcurrencyLimitExceededException):
        await rate_limit.acquire_concurrency_slot("chat", "key-a", _request())

    expected_user = rate_limit._concurrency_key("chat", "key-a", "user")
    expected_global = rate_limit._concurrency_key("chat", "key-a", "global")
    assert [call.args[0] for call in mock_redis.decr.await_args_list] == [
        expected_user,
        expected_global,
    ]


# ---------------------------------------------------------------------------
# Expiry (TTL)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_acquire_sets_a_ttl_on_both_counters(mock_redis, fake_pipe):
    """Both counters get a 120s TTL in the same pipeline as the increments."""
    mock_redis.pipeline.return_value = fake_pipe

    await rate_limit.acquire_concurrency_slot("chat", "key-a", _request())

    expiries = [call for call in fake_pipe.calls if call[0] == "expire"]
    assert [call[2] for call in expiries] == [120, 120]
    assert {call[1] for call in expiries} == {
        rate_limit._concurrency_key("chat", "key-a", "user"),
        rate_limit._concurrency_key("chat", "key-a", "global"),
    }


@pytest.mark.asyncio
async def test_rate_limit_sets_ttl_only_on_first_hit(mock_redis):
    """The rate window starts when the bucket is created, not on every hit."""
    mock_redis.incr = AsyncMock(return_value=1)

    await rate_limit.check_rate_limit("chat", "key-a")

    key = f"ai:rate:chat:{rate_limit._fingerprint('key-a')}"
    mock_redis.expire.assert_awaited_once_with(key, 60)

    mock_redis.expire.reset_mock()
    mock_redis.incr.return_value = 2
    await rate_limit.check_rate_limit("chat", "key-a")
    mock_redis.expire.assert_not_awaited()


@pytest.mark.asyncio
async def test_budget_usage_refreshes_the_daily_ttl(mock_redis):
    """Recorded usage keeps the budget counter in a bounded daily window."""
    await rate_limit.record_usage("chat", 42)

    key = rate_limit._budget_key("chat")
    mock_redis.incrby.assert_awaited_once_with(key, 42)
    mock_redis.expire.assert_awaited_once_with(key, 86_400)


@pytest.mark.asyncio
async def test_expired_budget_allows_a_fresh_window(mock_redis):
    """An expired budget key is a miss; a full key blocks until it expires."""
    key = rate_limit._budget_key("chat")
    mock_redis.get = AsyncMock(
        side_effect=[str(limits.DAILY_TOKEN_BUDGET), None]
    )

    with pytest.raises(exceptions.BudgetExceededException) as exc:
        await rate_limit.precheck_budget("chat")
    assert exc.value.error_code == AiErrorCode.RATE_LIMITED.value

    # A None reply models a key that has passed its TTL.
    await rate_limit.precheck_budget("chat")

    assert mock_redis.get.await_args_list[0].args == (key,)
    assert mock_redis.get.await_args_list[1].args == (key,)


# ---------------------------------------------------------------------------
# Redis outage / fail-closed policy
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_acquire_fails_closed_without_redis(monkeypatch):
    """No Redis means no billable provider spend."""
    monkeypatch.setattr(rate_limit, "_get_redis", lambda: None)

    with pytest.raises(ProviderUnavailableException) as exc:
        await rate_limit.acquire_concurrency_slot("chat", "key-a", _request())

    assert exc.value.error_code == AiErrorCode.PROVIDER_UNAVAILABLE.value


@pytest.mark.asyncio
async def test_rate_and_budget_guards_fail_closed_without_redis(monkeypatch):
    """Every preflight guard rejects rather than silently allowing spend."""
    monkeypatch.setattr(rate_limit, "_get_redis", lambda: None)

    with pytest.raises(ProviderUnavailableException):
        await rate_limit.check_rate_limit("chat", "key-a")
    with pytest.raises(ProviderUnavailableException):
        await rate_limit.precheck_budget("chat")


@pytest.mark.asyncio
async def test_release_is_a_noop_without_redis(monkeypatch):
    """Cleanup after an outage must never turn into a second error."""
    monkeypatch.setattr(rate_limit, "_get_redis", lambda: None)

    await rate_limit.release_concurrency_slot("chat", "key-a")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "call",
    [
        lambda: rate_limit.acquire_concurrency_slot("chat", "key-a", _request()),
        lambda: rate_limit.check_rate_limit("chat", "key-a"),
        lambda: rate_limit.precheck_budget("chat"),
    ],
    ids=["concurrency", "rate", "budget"],
)
async def test_store_errors_are_fail_closed(mock_redis, call):
    """A Redis command failure is treated like an outage for preflight guards."""
    error = RuntimeError("redis down")
    mock_redis.pipeline = SimpleNamespace(
        __aenter__=AsyncMock(side_effect=error),
        __aexit__=AsyncMock(return_value=False),
    )
    mock_redis.incr = AsyncMock(side_effect=error)
    mock_redis.get = AsyncMock(side_effect=error)

    with pytest.raises(ProviderUnavailableException):
        await call()


@pytest.mark.asyncio
async def test_pipeline_result_shortage_fails_closed(mock_redis, fake_pipe):
    """A truncated pipeline reply must not be read as a successful acquire."""
    fake_pipe.results = [1]
    mock_redis.pipeline.return_value = fake_pipe

    with pytest.raises(ProviderUnavailableException):
        await rate_limit.acquire_concurrency_slot("chat", "key-a", _request())


@pytest.mark.asyncio
async def test_release_swallows_redis_errors(mock_redis):
    """Best-effort cleanup must not mask the original request error."""
    mock_redis.decr = AsyncMock(side_effect=RuntimeError("redis down"))

    await rate_limit.release_concurrency_slot("chat", "key-a")

    assert mock_redis.decr.await_count == 2


@pytest.mark.asyncio
async def test_guards_are_permissive_when_fail_closed_is_disabled(monkeypatch):
    """Non-billable environments may degrade open; the policy is explicit."""
    monkeypatch.setattr(rate_limit, "FAIL_CLOSED_ON_STORE_ERROR", False)
    monkeypatch.setattr(rate_limit, "_get_redis", lambda: None)

    await rate_limit.acquire_concurrency_slot("chat", "key-a", _request())
    await rate_limit.check_rate_limit("chat", "key-a")
    await rate_limit.precheck_budget("chat")


@pytest.mark.asyncio
async def test_redis_import_failure_latches_outage(monkeypatch):
    """A failed client construction is remembered instead of retried forever."""
    monkeypatch.setattr(rate_limit, "_redis_unavailable", False)
    monkeypatch.setattr(rate_limit, "_redis_client", None)

    class FakeRedisModule:
        @staticmethod
        def from_url(*args, **kwargs):
            raise RuntimeError("cannot connect")

    monkeypatch.setitem(rate_limit.sys.modules, "redis.asyncio", FakeRedisModule)

    assert rate_limit._get_redis() is None
    assert rate_limit._redis_unavailable is True

    monkeypatch.setitem(rate_limit.sys.modules, "redis.asyncio", None)
    assert rate_limit._get_redis() is None


def test_reused_redis_client_skips_connection_setup(mock_redis):
    """Once connected, the guard reuses the cached client."""
    assert rate_limit._get_redis() is mock_redis
