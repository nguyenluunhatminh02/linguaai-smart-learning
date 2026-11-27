from fastapi import APIRouter

from app.routers import chat, content, errors, grammar, nlp, reading, writing

v1_router = APIRouter(prefix="/v1")

v1_router.include_router(chat.router, tags=["chat"])
v1_router.include_router(content.router, tags=["content"])
v1_router.include_router(errors.router, tags=["errors"])
v1_router.include_router(grammar.router, tags=["grammar"])
v1_router.include_router(nlp.router, tags=["nlp"])
v1_router.include_router(reading.router, tags=["reading"])
v1_router.include_router(writing.router, tags=["writing"])
