import os

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _is_production() -> bool:
    """Production detection — accept either APP_ENV or NODE_ENV for cross-runtime parity."""
    return (os.getenv("APP_ENV") or os.getenv("NODE_ENV") or "").lower() == "production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", populate_by_name=True, extra="ignore")

    groq_base_url: str = "https://api.groq.com/openai"
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"
    groq_model_light: str = "llama-3.1-8b-instant"
    groq_model_heavy: str = "llama-3.3-70b-versatile"

    max_tokens: int = 2048
    temperature: float = 0.3
    request_timeout: int = 60

    cors_origins: str = "http://localhost:3000,http://localhost:5173"

    debug: bool = Field(default=False, alias="DEBUG")

    api_keys: str = Field(default="", alias="AI_SERVICE_API_KEYS")

    @field_validator("groq_api_key")
    @classmethod
    def validate_groq_key(cls, v: str) -> str:
        if not v and _is_production():
            raise ValueError("GROQ_API_KEY must be set in production")
        return v

    @field_validator("api_keys")
    @classmethod
    def validate_api_keys(cls, v: str) -> str:
        # In production, AI_SERVICE_API_KEYS must be configured to prevent
        # public abuse of the LLM. Empty value would make all routes public.
        if _is_production() and not (v or "").strip():
            raise ValueError(
                "AI_SERVICE_API_KEYS must be set in production "
                "(comma-separated list of allowed keys)."
            )
        return v

    @property
    def llm_base_url(self) -> str:
        return self.groq_base_url

    @property
    def llm_model(self) -> str:
        return self.groq_model

    @property
    def llm_api_key(self) -> str:
        return self.groq_api_key

    @property
    def cors_origin_list(self) -> list[str]:
        if not self.cors_origins:
            return []
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def valid_api_keys(self) -> set[str]:
        if not self.api_keys:
            return set()
        return {k.strip() for k in self.api_keys.split(",") if k.strip()}


settings = Settings()
