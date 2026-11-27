from fastapi import APIRouter, Request

from app.rate_limit import limiter

router = APIRouter()

# Simple in-memory TTL cache for the LLM health check so /ready doesn't call
# the LLM API on every probe. The cached value is shared across all workers
# (in-process) and refreshed every 30 seconds.
_llm_health_cache: dict[str, tuple[bool, float]] = {}


async def _cached_llm_health() -> bool:
    now = __import__("time").time()
    key = "llm"
    entry = _llm_health_cache.get(key)
    if entry is not None:
        ok, ts = entry
        if now - ts < 30:
            return ok
    from app.services.llm_client import llm_client

    ok = await llm_client.health_check()
    _llm_health_cache[key] = (ok, now)
    return ok


@router.get("/health")
@limiter.limit("20/minute")
async def health_check(request: Request):
    return {
        "status": "healthy",
        "service": "ai-service",
    }


@router.get("/ready")
@limiter.limit("20/minute")
async def readiness_check(request: Request):
    from app.config import settings

    if not settings.groq_api_key:
        return {"status": "not ready", "reason": "GROQ_API_KEY not configured"}

    llm_ok = await _cached_llm_health()
    if not llm_ok:
        from fastapi.responses import JSONResponse

        return JSONResponse(
            status_code=503,
            content={"status": "not ready", "llm": "unavailable"},
        )
    return {"status": "ready"}
