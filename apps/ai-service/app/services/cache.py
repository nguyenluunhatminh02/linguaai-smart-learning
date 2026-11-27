import hashlib
import json
import logging
import os
from typing import Any, Optional

import redis.asyncio as redis_lib

logger = logging.getLogger(__name__)


class CacheService:
    def __init__(self):
        self._client: Optional[redis_lib.Redis] = None
        self._enabled = False

    async def _get_client(self) -> Optional[redis_lib.Redis]:
        if self._client is not None:
            return self._client
        redis_url = os.getenv("REDIS_URL")
        redis_host = os.getenv("REDIS_HOST", "localhost")
        redis_port = int(os.getenv("REDIS_PORT", "6379"))
        redis_password = os.getenv("REDIS_PASSWORD") or None
        try:
            if redis_url:
                self._client = redis_lib.from_url(redis_url, decode_responses=True)
            else:
                self._client = redis_lib.Redis(
                    host=redis_host,
                    port=redis_port,
                    password=redis_password,
                    decode_responses=True,
                    socket_connect_timeout=2,
                    socket_timeout=2,
                )
            await self._client.ping()
            self._enabled = True
            logger.info("Redis cache connected")
        except Exception as e:
            logger.warning("Redis cache unavailable: %s — caching disabled", e)
            self._enabled = False
            self._client = None
        return self._client

    @staticmethod
    def _make_key(prefix: str, **kwargs) -> str:
        raw = json.dumps(kwargs, sort_keys=True)
        digest = hashlib.sha256(raw.encode()).hexdigest()[:16]
        return f"linguaai:{prefix}:{digest}"

    async def get_cached(self, prefix: str, **kwargs) -> Optional[dict]:
        client = await self._get_client()
        if not self._enabled or not client:
            return None
        try:
            key = self._make_key(prefix, **kwargs)
            val = await client.get(key)
            if val:
                return json.loads(val)
        except Exception as e:
            logger.warning("Cache get error: %s", e)
        return None

    async def set_cached(
        self, prefix: str, data: Any, ttl: int = 300, **kwargs
    ) -> None:
        client = await self._get_client()
        if not self._enabled or not client:
            return
        try:
            key = self._make_key(prefix, **kwargs)
            await client.setex(key, ttl, json.dumps(data, ensure_ascii=False))
        except Exception as e:
            logger.warning("Cache set error: %s", e)


cache_service = CacheService()
