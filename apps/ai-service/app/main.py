import logging
import os
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler

from fastapi import FastAPI, HTTPException, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1.router import v1_router
from app.config import settings
from app.health import router as health_router
from app.rate_limit import limiter
from app.routers import chat, content, errors, grammar, nlp, reading, writing
from app.services.llm_client import llm_client

from app.core.logging_config import setup_logging
from app.core.middleware import RequestIDMiddleware

logger = logging.getLogger(__name__)

LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "logs")


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging(LOG_DIR)
    if not settings.groq_api_key:
        logger.warning("GROQ_API_KEY is not set — AI features will not work")
    yield
    await llm_client.close()


app = FastAPI(
    title="LinguaAI - AI Service",
    description="AI microservice powered by Groq (llama-3.3-70b-versatile)",
    version="1.0.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    # Preserve HTTPException semantics — let FastAPI's default handler return
    # the proper status code/body instead of converting every error to 500.
    if isinstance(exc, (HTTPException, StarletteHTTPException)):
        return await http_exception_handler(request, exc)
    logger.exception("Unhandled exception")
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "error_code": "INTERNAL_ERROR"},
    )


app.add_middleware(RequestIDMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["POST", "GET"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(v1_router)
app.include_router(health_router)


@app.get("/test")
@limiter.limit("20/minute")
async def test_page(request: Request):
    if not settings.debug:
        return JSONResponse(
            status_code=404, content={"detail": "not_found"}
        )
    html_path = os.path.join(os.path.dirname(__file__), "..", "test.html")
    return FileResponse(html_path, media_type="text/html")
