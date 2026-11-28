"""Owned, TTL-bounded single-flight locks for cache stampede reduction.

This module is an optimization only. It is deliberately fail-open: lock or
store errors never propagate into a request, and a lock never becomes a
billing correctness guarantee. Credit reserve/settle/refund correctness stays
with the transactional, uniquely constrained billing store.

Ownership is enforced with a random token and Lua compare-and-delete /
compare-and-expire operations, so a lock whose TTL elapsed cannot be released
or extended by its former owner and steal a newer owner's lock.
"""

from __future__ import annotations

import logging
import secrets
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Optional

logger = logging.getLogger(__name__)

__all__ = [
    "LOCK_KEY_PREFIX",
    "DEFAULT_LOCK_TTL_SECONDS",
    "new_lock_token",
    "acquire_owned_lock",
    "release_owned_lock",
    "refresh_owned_lock",
    "owned_lock",
]

LOCK_KEY_PREFIX = "linguaai:lock:"
DEFAULT_LOCK_TTL_SECONDS = 30

_RELEASE_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
end
return 0
"""

_REFRESH_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('expire', KEYS[1], ARGV[2])
end
return 0
"""


def new_lock_token() -> str:
    """Return a fresh opaque owner token (no user data, no environment data)."""
    return secrets.token_hex(16)


def _lock_key(key: str) -> Optional[str]:
    """Normalize a caller key into the namespaced Redis key."""
    if not isinstance(key, str) or not key.strip():
        logger.warning("Single-flight lock refused: empty key")
        return None
    key = key.strip()
    if key.startswith(LOCK_KEY_PREFIX):
        return key
    return f"{LOCK_KEY_PREFIX}{key}"


def _positive_ttl(ttl_seconds: int) -> Optional[int]:
    """Redis EX/EXPIRE only accept positive whole seconds."""
    try:
        ttl = int(ttl_seconds)
    except (TypeError, ValueError):
        logger.warning("Single-flight lock refused: invalid TTL %r", ttl_seconds)
        return None
    if ttl <= 0:
        logger.warning("Single-flight lock refused: non-positive TTL %r", ttl_seconds)
        return None
    return ttl


def _valid_token(token: str) -> bool:
    if not isinstance(token, str) or not token:
        logger.warning("Single-flight lock refused: empty owner token")
        return False
    return True


async def acquire_owned_lock(
    client: Any, key: str, token: str, ttl_seconds: int
) -> bool:
    """Try to acquire the lock; return False on contention or store error.

    Uses ``SET key token NX EX ttl`` so acquisition and expiry are one atomic
    Redis operation. A client may be ``None`` when Redis is unavailable.
    """
    if client is None or not _valid_token(token):
        return False
    lock_key = _lock_key(key)
    ttl = _positive_ttl(ttl_seconds)
    if lock_key is None or ttl is None:
        return False
    try:
        result = await client.set(lock_key, token, nx=True, ex=ttl)
        # redis-py returns None on NX contention, True when the key was set.
        return bool(result)
    except Exception as exc:
        logger.warning("Single-flight lock acquire failed (%s); continuing unlocked", type(exc).__name__)
        return False


async def release_owned_lock(client: Any, key: str, token: str) -> bool:
    """Release only if ``token`` still owns the lock; fail open on errors."""
    if client is None or not _valid_token(token):
        return False
    lock_key = _lock_key(key)
    if lock_key is None:
        return False
    try:
        result = await client.eval(_RELEASE_SCRIPT, 1, lock_key, token)
        return bool(result)
    except Exception as exc:
        logger.warning("Single-flight lock release failed (%s); lock will expire", type(exc).__name__)
        return False


async def refresh_owned_lock(
    client: Any, key: str, token: str, ttl_seconds: int
) -> bool:
    """Extend the lock only if ``token`` still owns it; fail open on errors."""
    if client is None or not _valid_token(token):
        return False
    lock_key = _lock_key(key)
    ttl = _positive_ttl(ttl_seconds)
    if lock_key is None or ttl is None:
        return False
    try:
        result = await client.eval(_REFRESH_SCRIPT, 1, lock_key, token, ttl)
        return bool(result)
    except Exception as exc:
        logger.warning("Single-flight lock refresh failed (%s); continuing", type(exc).__name__)
        return False


@asynccontextmanager
async def owned_lock(
    client: Any,
    key: str,
    token: Optional[str] = None,
    ttl_seconds: int = DEFAULT_LOCK_TTL_SECONDS,
) -> AsyncIterator[bool]:
    """Yield whether the lock was acquired; release it only if we own it.

    Any store failure yields ``False`` rather than raising, so callers can
    always fall through and generate the value. The lock must wrap only the
    provider call and validation, never guards, budgets or billing.
    """
    owner = token or new_lock_token()
    acquired = await acquire_owned_lock(client, key, owner, ttl_seconds)
    try:
        yield acquired
    finally:
        if acquired:
            await release_owned_lock(client, key, owner)
