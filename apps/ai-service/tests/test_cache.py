import pytest
from unittest.mock import AsyncMock, patch
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
