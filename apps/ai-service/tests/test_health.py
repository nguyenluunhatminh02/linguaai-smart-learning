import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch

from app.main import app
from app.config import settings

client = TestClient(app)


def test_health_check():
    """Verify simple health check endpoint."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy", "service": "ai-service"}


def test_readiness_check_not_configured(monkeypatch):
    """Verify readiness check fails if GROQ_API_KEY is not configured."""
    monkeypatch.setattr(settings, "groq_api_key", "")

    response = client.get("/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "not ready", "reason": "GROQ_API_KEY not configured"}


@pytest.fixture(autouse=True)
def clear_llm_health_cache():
    """Clear the 30s health cache before each readiness test for isolation."""
    from app import health
    health._llm_health_cache.clear()
    yield
    health._llm_health_cache.clear()


@pytest.mark.asyncio
async def test_readiness_check_llm_healthy(monkeypatch):
    """Verify readiness check succeeds if LLM is healthy.

    health.py calls the module-level llm_client singleton's health_check(),
    not LLMClient.health_check as a class method. Patch the singleton.
    """
    monkeypatch.setattr(settings, "groq_api_key", "test-groq-key")

    with patch("app.services.llm_client.llm_client.health_check", new_callable=AsyncMock) as mock_health:
        mock_health.return_value = True

        response = client.get("/ready")
        assert response.status_code == 200
        assert response.json() == {"status": "ready"}
        mock_health.assert_awaited_once()


@pytest.mark.asyncio
async def test_readiness_check_llm_unhealthy(monkeypatch):
    """Verify readiness check fails (503) if LLM is unhealthy."""
    monkeypatch.setattr(settings, "groq_api_key", "test-groq-key")

    with patch("app.services.llm_client.llm_client.health_check", new_callable=AsyncMock) as mock_health:
        mock_health.return_value = False

        response = client.get("/ready")
        assert response.status_code == 503
        assert response.json() == {"status": "not ready", "llm": "unavailable"}
        mock_health.assert_awaited_once()
