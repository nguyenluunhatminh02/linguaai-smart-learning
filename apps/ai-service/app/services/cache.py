import hashlib
import json
import logging
import os
import re
from dataclasses import dataclass
from typing import Any, Callable, Optional

import redis.asyncio as redis_lib

logger = logging.getLogger(__name__)


# Maximum length for individual key components before hashing
_MAX_COMPONENT_LENGTH = 64
# Maximum total key length
_MAX_KEY_LENGTH = 200
# Valid characters for key components (alphanumeric, hyphen, underscore, dot)
_SAFE_COMPONENT_PATTERN = re.compile(r'^[a-zA-Z0-9._-]+$')


@dataclass(frozen=True)
class CacheKey:
    """Typed cache key with all required dimensions for cache isolation.

    All fields are required to prevent silent cache collisions. The key format is:
    linguaai:v1:{feature}:{prompt_version}:{schema_version}:{tenant}:{locale}:{model}:{temperature}:{input_hash}
    """
    feature: str
    prompt_version: str
    schema_version: str
    model: str
    locale: str
    tenant: str
    temperature: float
    input_hash: str

    def __post_init__(self) -> None:
        """Validate and normalize all fields."""
        # Validate required fields are non-empty
        for field_name in ('feature', 'prompt_version', 'schema_version', 'model', 'locale', 'tenant', 'input_hash'):
            value = getattr(self, field_name)
            if not value or not isinstance(value, str):
                raise ValueError(f"{field_name} must be a non-empty string")
            if len(value) == 0:
                raise ValueError(f"{field_name} cannot be empty")

        # Validate temperature is a number
        if not isinstance(self.temperature, (int, float)):
            raise ValueError("temperature must be a number")

        # Validate input_hash is a hex string
        if not re.match(r'^[a-f0-9]+$', self.input_hash):
            raise ValueError("input_hash must be a hexadecimal string")

    def _sanitize_component(self, value: str, max_length: int = _MAX_COMPONENT_LENGTH) -> str:
        """Sanitize a key component: bound length, escape unsafe characters."""
        # If value is too long or contains unsafe characters, hash it
        if len(value) > max_length or not _SAFE_COMPONENT_PATTERN.match(value):
            return hashlib.sha256(value.encode('utf-8')).hexdigest()[:16]
        return value

    def to_key_string(self) -> str:
        """Convert to the versioned key format."""
        components = [
            'linguaai',
            'v1',
            self._sanitize_component(self.feature),
            self._sanitize_component(self.prompt_version),
            self._sanitize_component(self.schema_version),
            self._sanitize_component(self.tenant),
            self._sanitize_component(self.locale),
            self._sanitize_component(self.model),
            str(self.temperature),
            self.input_hash[:16],  # Bound hash length
        ]
        key = ':'.join(components)

        # Enforce maximum key length
        if len(key) > _MAX_KEY_LENGTH:
            # Hash the entire key if it's too long
            full_hash = hashlib.sha256(key.encode('utf-8')).hexdigest()[:32]
            key = f"linguaai:v1:{self.feature[:20]}:{full_hash}"

        return key


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
        """Build a key from the legacy prefix/kwargs form.

        Kept for callers that have not yet migrated to the typed CacheKey.
        All dimensions are hashed together so a delimiter cannot be injected.
        """
        raw = json.dumps({"prefix": prefix, **kwargs}, sort_keys=True)
        digest = hashlib.sha256(raw.encode()).hexdigest()[:16]
        return f"linguaai:{prefix}:{digest}"

    @staticmethod
    def make_key(key: CacheKey) -> str:
        """Build the versioned key from a typed CacheKey."""
        if not isinstance(key, CacheKey):
            raise TypeError("cache key must be a CacheKey")
        return key.to_key_string()

    @staticmethod
    def _is_error_shaped(data: Any) -> bool:
        """Return True when ``data`` looks like an error payload, not a success."""
        if not isinstance(data, dict):
            return False
        if data.get("error"):
            return True
        if data.get("status") == "error":
            return True
        if data.get("ok") is False:
            return True
        return False

    async def get_cached(
        self,
        prefix: str,
        *,
        validator: Optional[Callable[[dict], Optional[dict]]] = None,
        **kwargs,
    ) -> Optional[dict]:
        """Return a cached payload, or None on miss/invalid data.

        ``validator`` may clean and return the payload; returning None means a
        miss. Corrupt JSON, non-dict payloads, error-shaped dicts, and validator
        errors are treated as a miss and the poisoned key is evicted.
        """
        client = await self._get_client()
        if not self._enabled or not client:
            return None
        key = self._make_key(prefix, **kwargs)
        try:
            val = await client.get(key)
            if not val:
                return None
            try:
                data = json.loads(val)
            except (json.JSONDecodeError, TypeError, ValueError):
                logger.warning("Cache payload is not valid JSON; evicting key")
                await self._evict(client, key)
                return None
            if not isinstance(data, dict):
                logger.warning("Cache payload is not an object; evicting key")
                await self._evict(client, key)
                return None
            if self._is_error_shaped(data):
                logger.warning("Cache payload is error-shaped; evicting key")
                await self._evict(client, key)
                return None
            if validator is not None:
                try:
                    data = validator(data)
                except Exception as exc:
                    logger.warning("Cache validator error (%s); evicting key", type(exc).__name__)
                    await self._evict(client, key)
                    return None
                if data is None or not isinstance(data, dict):
                    logger.warning("Cache validator rejected payload; evicting key")
                    await self._evict(client, key)
                    return None
            return data
        except Exception as e:
            logger.warning("Cache get error: %s", e)
        return None

    async def _evict(self, client: redis_lib.Redis, key: str) -> None:
        """Best-effort deletion of a poisoned cache entry."""
        try:
            await client.delete(key)
        except Exception as e:
            logger.warning("Cache eviction error: %s", e)

    async def set_cached(
        self, prefix: str, data: Any, ttl: int = 300, **kwargs
    ) -> None:
        client = await self._get_client()
        if not self._enabled or not client:
            return
        if not isinstance(data, dict) or self._is_error_shaped(data):
            logger.warning("Refusing to cache non-object or error-shaped payload")
            return
        try:
            key = self._make_key(prefix, **kwargs)
            await client.setex(key, ttl, json.dumps(data, ensure_ascii=False))
        except Exception as e:
            logger.warning("Cache set error: %s", e)

    async def delete(self, key: str) -> bool:
        """Delete one cache entry by raw key (no-op when Redis is unavailable)."""
        client = await self._get_client()
        if not self._enabled or not client:
            return False
        try:
            return bool(await client.delete(key))
        except Exception as e:
            logger.warning("Cache delete error: %s", e)
            return False

    async def delete_cached(self, prefix: str, **kwargs) -> bool:
        """Delete the entry identified by ``prefix`` and ``kwargs`` dimensions."""
        client = await self._get_client()
        if not self._enabled or not client:
            return False
        return await self.delete(self._make_key(prefix, **kwargs))

    async def invalidate_prefix(self, prefix: str) -> int:
        """Delete all keys under ``prefix`` using SCAN (never KEYS)."""
        client = await self._get_client()
        if not self._enabled or not client:
            return 0
        pattern = f"{prefix}*"
        deleted = 0
        try:
            async for batch in client.scan_iter(match=pattern, count=100):
                if isinstance(batch, (bytes, bytearray)):
                    batch = batch.decode()
                if isinstance(batch, (list, tuple)):
                    keys = [k.decode() if isinstance(k, (bytes, bytearray)) else k for k in batch]
                else:
                    keys = [batch]
                if keys:
                    deleted += int(await client.delete(*keys))
        except Exception as e:
            logger.warning("Cache invalidate error: %s", e)
        return deleted


cache_service = CacheService()
