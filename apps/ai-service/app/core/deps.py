"""
Shared FastAPI dependencies used across routers.

Centralising verify_key here avoids circular router→router imports
and keeps the dependency close to the security module that defines
the timing-safe comparison (core.security.verify_api_key).
"""

from fastapi import Depends, HTTPException, Security
from fastapi.security import APIKeyHeader

from app.config import settings
from app.core.security import verify_api_key

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def verify_key(api_key: str = Security(api_key_header)):
    """Timing-safe API key validation using :func:`verify_api_key`."""
    if not verify_api_key(api_key, settings.valid_api_keys):
        raise HTTPException(status_code=401, detail="Invalid API key")
    return api_key
