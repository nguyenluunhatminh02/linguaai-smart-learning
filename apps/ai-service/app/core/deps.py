"""Shared FastAPI dependencies used across routers.

Centralising verify_key here avoids circular router→router imports and keeps
the dependency close to the security module that defines the timing-safe
comparison (core.security.verify_api_key).

``feature_guard`` composes authentication, per-feature concurrency and daily
budget prechecks into a single dependency factory. Routers import it and
apply it per endpoint; it never grants system authority from AI output.
"""

from __future__ import annotations

from typing import Callable

from fastapi import Depends, HTTPException, Request, Security
from fastapi.security import APIKeyHeader

from app.config import settings
from app.core.security import verify_api_key

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def verify_key(
    api_key: str = Security(api_key_header),
) -> str:
    """Timing-safe API key validation using :func:`verify_api_key`.

    Fail-closed in production: if no keys are configured outside test/dev,
    every request is rejected rather than silently opening the service.
    """
    valid_keys = settings.valid_api_keys
    if not valid_keys:
        # In non-production environments an empty key set is allowed so local
        # development keeps working; in production the config validator
        # already rejects an empty AI_SERVICE_API_KEYS before we get here.
        from app.config import _is_production

        if _is_production():
            raise HTTPException(status_code=500, detail="Service misconfigured")
        return api_key or ""
    if not verify_api_key(api_key, valid_keys):
        raise HTTPException(status_code=401, detail="Invalid API key")
    return api_key


def feature_guard(feature: str) -> Callable:
    """Return a dependency that combines auth + concurrency + budget checks.

    The returned dependency:
      1. Runs :func:`verify_key` (authentication).
      2. Reserves a concurrency slot via :mod:`app.rate_limit`.
      3. Prechecks the daily budget.

    Routers use it as ``dependencies=[Depends(feature_guard("chat"))]``.
    """
    from app.rate_limit import (
        acquire_concurrency_slot,
        check_rate_limit,
        precheck_budget,
    )

    async def _guard(request: Request, api_key: str = Depends(verify_key)) -> str:
        # Cheap per-minute check first, then concurrency, then budget. All are
        # checked before the request body is processed so a caller over any
        # limit gets a fast 429 instead of a slow validation.
        await check_rate_limit(feature, api_key)
        await acquire_concurrency_slot(feature, api_key, request)
        await precheck_budget(feature)
        return api_key

    return _guard
