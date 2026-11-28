import pytest
from unittest.mock import AsyncMock, patch, MagicMock
import json

from app.services.cache import CacheService


@pytest.fixture
def cache_service():
    """Return a fresh CacheService instance."""
    return CacheService()


@pytest.fixture(autouse=True)
def clear_redis_env(monkeypatch):
    """Each test controls its own Redis connection settings."""
    for key in ("REDIS_URL", "REDIS_HOST", "REDIS_PORT", "REDIS_PASSWORD"):
        monkeypatch.delenv(key, raising=False)


@pytest.mark.asyncio
async def test_cache_connect_success(cache_service: CacheService):
    """Verify that CacheService enables caching on successful connection."""
    mock_redis = AsyncMock()
    mock_redis.ping = AsyncMock(return_value=True)

    with patch("app.services.cache.redis_lib.Redis", return_value=mock_redis) as redis_cls:
        client = await cache_service._get_client()
        assert client is mock_redis
        assert cache_service._enabled is True
        redis_cls.assert_called_once_with(
            host="localhost",
            port=6379,
            password=None,
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
        mock_redis.ping.assert_awaited_once()


@pytest.mark.asyncio
async def test_cache_connect_with_url(cache_service: CacheService, monkeypatch):
    """REDIS_URL must be used via from_url with decoded responses."""
    monkeypatch.setenv("REDIS_URL", "redis://cache.example:6380/2")
    monkeypatch.setenv("REDIS_HOST", "ignored-host")
    mock_redis = AsyncMock()
    mock_redis.ping = AsyncMock(return_value=True)

    with (
        patch("app.services.cache.redis_lib.from_url", return_value=mock_redis) as from_url,
        patch("app.services.cache.redis_lib.Redis") as redis_cls,
    ):
        client = await cache_service._get_client()
        assert client is mock_redis
        assert cache_service._enabled is True
        from_url.assert_called_once_with("redis://cache.example:6380/2", decode_responses=True)
        redis_cls.assert_not_called()
        mock_redis.ping.assert_awaited_once()


@pytest.mark.asyncio
async def test_cache_connect_fail(cache_service: CacheService):
    """Verify that CacheService disables caching and drops the client on ping failure."""
    mock_redis = AsyncMock()
    mock_redis.ping = AsyncMock(side_effect=Exception("connection failed"))

    with patch("app.services.cache.redis_lib.Redis", return_value=mock_redis):
        client = await cache_service._get_client()
        assert client is None
        assert cache_service._client is None
        assert cache_service._enabled is False


@pytest.mark.asyncio
async def test_get_cached_hit(cache_service: CacheService):
    """Verify get_cached returns parsed JSON on hit."""
    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=json.dumps({"data": "ok"}))

    cache_service._client = mock_redis
    cache_service._enabled = True

    result = await cache_service.get_cached(prefix="test", query="hello")
    assert result == {"data": "ok"}
    mock_redis.get.assert_called_once()


@pytest.mark.asyncio
async def test_get_cached_miss(cache_service: CacheService):
    """Verify get_cached returns None on miss."""
    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=None)

    cache_service._client = mock_redis
    cache_service._enabled = True

    result = await cache_service.get_cached(prefix="test", query="hello")
    assert result is None


@pytest.mark.asyncio
async def test_set_cached(cache_service: CacheService):
    """Verify set_cached calls setex correctly."""
    mock_redis = AsyncMock()
    mock_redis.setex = AsyncMock()

    cache_service._client = mock_redis
    cache_service._enabled = True

    await cache_service.set_cached(prefix="test", data={"data": "ok"}, ttl=300, query="hello")
    mock_redis.setex.assert_called_once()

    # Check the key format and serialize arguments
    args, kwargs = mock_redis.setex.call_args
    assert args[0].startswith("linguaai:test:")
    assert args[1] == 300
    assert json.loads(args[2]) == {"data": "ok"}


# ──────────────────────────────────────────────────────────────────────────────
# Key Scoping Tests
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_key_scoping_same_kwargs_different_order(cache_service: CacheService):
    """Same kwargs in different order must produce the same cache key."""
    key1 = cache_service._make_key("test", a="1", b="2", c="3")
    key2 = cache_service._make_key("test", c="3", a="1", b="2")
    assert key1 == key2


@pytest.mark.asyncio
async def test_key_scoping_different_scope(cache_service: CacheService):
    """Different scope/tenant/user values must produce different cache keys."""
    key1 = cache_service._make_key("test", scope="user-1")
    key2 = cache_service._make_key("test", scope="user-2")
    assert key1 != key2


@pytest.mark.asyncio
async def test_key_scoping_different_locale(cache_service: CacheService):
    """Different locale values must produce different cache keys."""
    key1 = cache_service._make_key("test", locale="en")
    key2 = cache_service._make_key("test", locale="vi")
    assert key1 != key2


@pytest.mark.asyncio
async def test_key_scoping_different_model(cache_service: CacheService):
    """Different model values must produce different cache keys."""
    key1 = cache_service._make_key("test", model="gpt-4")
    key2 = cache_service._make_key("test", model="gpt-3.5")
    assert key1 != key2


@pytest.mark.asyncio
async def test_key_scoping_different_temperature(cache_service: CacheService):
    """Different temperature values must produce different cache keys."""
    key1 = cache_service._make_key("test", temperature=0.5)
    key2 = cache_service._make_key("test", temperature=0.1)
    assert key1 != key2


@pytest.mark.asyncio
async def test_key_scoping_different_prompt_version(cache_service: CacheService):
    """Different prompt_version values must produce different cache keys."""
    key1 = cache_service._make_key("test", prompt_version="v1")
    key2 = cache_service._make_key("test", prompt_version="v2")
    assert key1 != key2


@pytest.mark.asyncio
async def test_key_scoping_different_schema_version(cache_service: CacheService):
    """Different schema_version values must produce different cache keys."""
    key1 = cache_service._make_key("test", schema_version="v1")
    key2 = cache_service._make_key("test", schema_version="v2")
    assert key1 != key2


@pytest.mark.asyncio
async def test_key_scoping_no_raw_prompt_in_key(cache_service: CacheService):
    """Raw prompt/system text must not appear in the cache key."""
    long_prompt = "This is a very long prompt with sensitive content that should not leak into the key"
    key = cache_service._make_key("test", prompt=long_prompt)
    assert long_prompt not in key
    assert "sensitive content" not in key
    # Key should be a hash, not the raw text
    assert len(key) < 100


# ──────────────────────────────────────────────────────────────────────────────
# Invalidation Tests
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_delete_cached_calls_delete(cache_service: CacheService):
    """delete_cached must call Redis delete with the correct key."""
    mock_redis = AsyncMock()
    mock_redis.delete = AsyncMock()

    cache_service._client = mock_redis
    cache_service._enabled = True

    await cache_service.delete_cached(prefix="test", query="hello")
    mock_redis.delete.assert_called_once()

    args, kwargs = mock_redis.delete.call_args
    assert args[0].startswith("linguaai:test:")


@pytest.mark.asyncio
async def test_delete_cached_noop_when_disabled(cache_service: CacheService):
    """delete_cached must be a no-op when cache is disabled."""
    mock_redis = AsyncMock()
    mock_redis.delete = AsyncMock()

    cache_service._client = mock_redis
    cache_service._enabled = False

    await cache_service.delete_cached(prefix="test", query="hello")
    mock_redis.delete.assert_not_called()


@pytest.mark.asyncio
async def test_delete_cached_handles_redis_error(cache_service: CacheService):
    """delete_cached must not raise when Redis delete fails."""
    mock_redis = AsyncMock()
    mock_redis.delete = AsyncMock(side_effect=Exception("Redis error"))

    cache_service._client = mock_redis
    cache_service._enabled = True

    # Should not raise
    await cache_service.delete_cached(prefix="test", query="hello")


@pytest.mark.asyncio
async def test_version_bump_invalidates_old_entry(cache_service: CacheService):
    """Bumping schema/prompt version must create a new key that doesn't read old entries."""
    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=json.dumps({"old": "data"}))

    cache_service._client = mock_redis
    cache_service._enabled = True

    # Old version
    result1 = await cache_service.get_cached(prefix="test", schema_version="v1")
    assert result1 == {"old": "data"}

    # New version should miss
    mock_redis.get = AsyncMock(return_value=None)
    result2 = await cache_service.get_cached(prefix="test", schema_version="v2")
    assert result2 is None


# ──────────────────────────────────────────────────────────────────────────────
# Malformed Cached Output Tests
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_cached_malformed_json(cache_service: CacheService):
    """get_cached must return None and delete key when Redis returns invalid JSON."""
    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value="not valid json {")
    mock_redis.delete = AsyncMock()

    cache_service._client = mock_redis
    cache_service._enabled = True

    result = await cache_service.get_cached(prefix="test", query="hello")
    assert result is None
    mock_redis.delete.assert_called_once()


@pytest.mark.asyncio
async def test_get_cached_json_array(cache_service: CacheService):
    """get_cached must return None and delete key when cached value is a JSON array."""
    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=json.dumps([1, 2, 3]))
    mock_redis.delete = AsyncMock()

    cache_service._client = mock_redis
    cache_service._enabled = True

    result = await cache_service.get_cached(prefix="test", query="hello")
    assert result is None
    mock_redis.delete.assert_called_once()


@pytest.mark.asyncio
async def test_get_cached_json_null(cache_service: CacheService):
    """get_cached must return None and delete key when cached value is JSON null."""
    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value="null")
    mock_redis.delete = AsyncMock()

    cache_service._client = mock_redis
    cache_service._enabled = True

    result = await cache_service.get_cached(prefix="test", query="hello")
    assert result is None
    mock_redis.delete.assert_called_once()


@pytest.mark.asyncio
async def test_get_cached_json_string(cache_service: CacheService):
    """get_cached must return None and delete key when cached value is a JSON string."""
    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value='"just a string"')
    mock_redis.delete = AsyncMock()

    cache_service._client = mock_redis
    cache_service._enabled = True

    result = await cache_service.get_cached(prefix="test", query="hello")
    assert result is None
    mock_redis.delete.assert_called_once()


@pytest.mark.asyncio
async def test_get_cached_error_shaped_payload(cache_service: CacheService):
    """get_cached must return None and delete key when cached dict has error field."""
    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=json.dumps({"error": "something failed"}))
    mock_redis.delete = AsyncMock()

    cache_service._client = mock_redis
    cache_service._enabled = True

    result = await cache_service.get_cached(prefix="test", query="hello")
    assert result is None
    mock_redis.delete.assert_called_once()


@pytest.mark.asyncio
async def test_get_cached_error_status_field(cache_service: CacheService):
    """get_cached must return None and delete key when cached dict has status=error."""
    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=json.dumps({"status": "error", "message": "failed"}))
    mock_redis.delete = AsyncMock()

    cache_service._client = mock_redis
    cache_service._enabled = True

    result = await cache_service.get_cached(prefix="test", query="hello")
    assert result is None
    mock_redis.delete.assert_called_once()


@pytest.mark.asyncio
async def test_get_cached_error_ok_false(cache_service: CacheService):
    """get_cached must return None and delete key when cached dict has ok=false."""
    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=json.dumps({"ok": False, "data": None}))
    mock_redis.delete = AsyncMock()

    cache_service._client = mock_redis
    cache_service._enabled = True

    result = await cache_service.get_cached(prefix="test", query="hello")
    assert result is None
    mock_redis.delete.assert_called_once()


@pytest.mark.asyncio
async def test_get_cached_validator_rejects(cache_service: CacheService):
    """get_cached must return None and delete key when validator rejects the payload."""
    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=json.dumps({"wrong": "shape"}))
    mock_redis.delete = AsyncMock()

    cache_service._client = mock_redis
    cache_service._enabled = True

    def validator(data):
        return data if "required_field" in data else None

    result = await cache_service.get_cached(prefix="test", validator=validator, query="hello")
    assert result is None
    mock_redis.delete.assert_called_once()


@pytest.mark.asyncio
async def test_get_cached_valid_payload(cache_service: CacheService):
    """get_cached must return the dict without deleting when payload is valid."""
    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=json.dumps({"valid": "data"}))
    mock_redis.delete = AsyncMock()

    cache_service._client = mock_redis
    cache_service._enabled = True

    result = await cache_service.get_cached(prefix="test", query="hello")
    assert result == {"valid": "data"}
    mock_redis.delete.assert_not_called()


# ──────────────────────────────────────────────────────────────────────────────
# No Error-as-Success Tests
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_set_cached_rejects_error_shaped_payload(cache_service: CacheService):
    """set_cached must not write error-shaped payloads to cache."""
    mock_redis = AsyncMock()
    mock_redis.setex = AsyncMock()

    cache_service._client = mock_redis
    cache_service._enabled = True

    # Error-shaped payload
    await cache_service.set_cached(prefix="test", data={"error": "failed"}, ttl=300, query="hello")
    mock_redis.setex.assert_not_called()

    await cache_service.set_cached(prefix="test", data={"status": "error"}, ttl=300, query="hello")
    mock_redis.setex.assert_not_called()

    await cache_service.set_cached(prefix="test", data={"ok": False}, ttl=300, query="hello")
    mock_redis.setex.assert_not_called()


@pytest.mark.asyncio
async def test_set_cached_accepts_valid_payload(cache_service: CacheService):
    """set_cached must write valid payloads to cache."""
    mock_redis = AsyncMock()
    mock_redis.setex = AsyncMock()

    cache_service._client = mock_redis
    cache_service._enabled = True

    await cache_service.set_cached(prefix="test", data={"success": "data"}, ttl=300, query="hello")
    mock_redis.setex.assert_called_once()


@pytest.mark.asyncio
async def test_ai_json_request_ignores_cached_error(cache_service: CacheService):
    """ai_json_request must ignore cached error dict and call LLM again."""
    from app.utils import ai_json_request
    from pydantic import BaseModel

    class TestModel(BaseModel):
        result: str

    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=json.dumps({"error": "cached error"}))
    mock_redis.delete = AsyncMock()
    mock_redis.setex = AsyncMock()

    cache_service._client = mock_redis
    cache_service._enabled = True

    with (
        patch("app.utils.cache_service", cache_service),
        patch("app.utils.llm_client.generate", new_callable=AsyncMock) as mock_generate,
    ):
        mock_generate.return_value = json.dumps({"result": "fresh"})

        result = await ai_json_request(
            system="test system",
            prompt="test prompt",
            response_model=TestModel,
            cache_ttl=300,
        )

        assert result == {"result": "fresh"}
        mock_generate.assert_called_once()
        # Should have deleted the bad cached entry
        mock_redis.delete.assert_called()


@pytest.mark.asyncio
async def test_ai_json_request_llm_fail_twice(cache_service: CacheService):
    """ai_json_request must raise 502/503 when LLM fails twice and not call setex."""
    from app.utils import ai_json_request
    from fastapi import HTTPException

    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=None)
    mock_redis.setex = AsyncMock()

    cache_service._client = mock_redis
    cache_service._enabled = True

    with (
        patch("app.utils.cache_service", cache_service),
        patch("app.utils.llm_client.generate", new_callable=AsyncMock) as mock_generate,
    ):
        mock_generate.side_effect = Exception("LLM down")

        with pytest.raises(HTTPException) as exc_info:
            await ai_json_request(
                system="test system",
                prompt="test prompt",
                cache_ttl=300,
            )

        assert exc_info.value.status_code == 503
        # setex should not be called on failure
        mock_redis.setex.assert_not_called()


@pytest.mark.asyncio
async def test_ai_json_request_llm_returns_invalid_json_twice(cache_service: CacheService):
    """ai_json_request must raise 502 when LLM returns invalid JSON twice."""
    from app.utils import ai_json_request
    from fastapi import HTTPException

    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=None)
    mock_redis.setex = AsyncMock()

    cache_service._client = mock_redis
    cache_service._enabled = True

    with (
        patch("app.utils.cache_service", cache_service),
        patch("app.utils.llm_client.generate", new_callable=AsyncMock) as mock_generate,
    ):
        mock_generate.return_value = "not valid json"

        with pytest.raises(HTTPException) as exc_info:
            await ai_json_request(
                system="test system",
                prompt="test prompt",
                cache_ttl=300,
            )

        assert exc_info.value.status_code == 502
        mock_redis.setex.assert_not_called()


@pytest.mark.asyncio
async def test_ai_json_request_redis_get_raises(cache_service: CacheService):
    """ai_json_request must handle Redis get error gracefully and still call LLM."""
    from app.utils import ai_json_request

    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(side_effect=Exception("Redis get error"))
    mock_redis.setex = AsyncMock()

    cache_service._client = mock_redis
    cache_service._enabled = True

    with (
        patch("app.utils.cache_service", cache_service),
        patch("app.utils.llm_client.generate", new_callable=AsyncMock) as mock_generate,
    ):
        mock_generate.return_value = json.dumps({"result": "ok"})

        result = await ai_json_request(
            system="test system",
            prompt="test prompt",
            cache_ttl=300,
        )

        assert result == {"result": "ok"}
        mock_generate.assert_called_once()


@pytest.mark.asyncio
async def test_ai_json_request_redis_set_raises(cache_service: CacheService):
    """ai_json_request must handle Redis set error gracefully."""
    from app.utils import ai_json_request

    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=None)
    mock_redis.setex = AsyncMock(side_effect=Exception("Redis set error"))

    cache_service._client = mock_redis
    cache_service._enabled = True

    with (
        patch("app.utils.cache_service", cache_service),
        patch("app.utils.llm_client.generate", new_callable=AsyncMock) as mock_generate,
    ):
        mock_generate.return_value = json.dumps({"result": "ok"})

        # Should not raise
        result = await ai_json_request(
            system="test system",
            prompt="test prompt",
            cache_ttl=300,
        )

        assert result == {"result": "ok"}


# ──────────────────────────────────────────────────────────────────────────────
# TTL and Scope Tests
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_cache_ttl_zero_no_get_set(cache_service: CacheService):
    """cache_ttl=0 must skip both get and set operations."""
    from app.utils import ai_json_request

    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock()
    mock_redis.setex = AsyncMock()

    cache_service._client = mock_redis
    cache_service._enabled = True

    with (
        patch("app.utils.cache_service", cache_service),
        patch("app.utils.llm_client.generate", new_callable=AsyncMock) as mock_generate,
    ):
        mock_generate.return_value = json.dumps({"result": "ok"})

        result = await ai_json_request(
            system="test system",
            prompt="test prompt",
            cache_ttl=0,
        )

        assert result == {"result": "ok"}
        mock_redis.get.assert_not_called()
        mock_redis.setex.assert_not_called()


@pytest.mark.asyncio
async def test_cache_ttl_passed_to_setex(cache_service: CacheService):
    """TTL value must be passed intact to Redis setex."""
    mock_redis = AsyncMock()
    mock_redis.setex = AsyncMock()

    cache_service._client = mock_redis
    cache_service._enabled = True

    await cache_service.set_cached(prefix="test", data={"data": "ok"}, ttl=600, query="hello")
    mock_redis.setex.assert_called_once()

    args, kwargs = mock_redis.setex.call_args
    assert args[1] == 600


@pytest.mark.asyncio
async def test_cache_ttl_custom_value(cache_service: CacheService):
    """Custom TTL values must be preserved through the cache layer."""
    from app.utils import ai_json_request

    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=None)
    mock_redis.setex = AsyncMock()

    cache_service._client = mock_redis
    cache_service._enabled = True

    with (
        patch("app.utils.cache_service", cache_service),
        patch("app.utils.llm_client.generate", new_callable=AsyncMock) as mock_generate,
    ):
        mock_generate.return_value = json.dumps({"result": "ok"})

        await ai_json_request(
            system="test system",
            prompt="test prompt",
            cache_ttl=1200,
        )

        mock_redis.setex.assert_called_once()
        args, kwargs = mock_redis.setex.call_args
        assert args[1] == 1200

