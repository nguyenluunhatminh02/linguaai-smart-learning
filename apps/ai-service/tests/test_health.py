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


@pytest.mark.asyncio
async def test_readiness_check_llm_healthy(monkeypatch):
    """Verify readiness check succeeds if LLM is healthy."""
    monkeypatch.setattr(settings, "groq_api_key", "test-groq-key")

    with patch("app.services.llm_client.LLMClient.health_check", new_callable=AsyncMock) as mock_health:
        mock_health.return_value = True

        response = client.get("/ready")
        assert response.status_code == 200
        assert response.json() == {"status": "ready"}


@pytest.mark.asyncio
async def test_readiness_check_llm_unhealthy(monkeypatch):
    """Verify readiness check fails (503) if LLM is unhealthy."""
    monkeypatch.setattr(settings, "groq_api_key", "test-groq-key")

    with patch("app.services.llm_client.LLMClient.health_check", new_callable=AsyncMock) as mock_health:
        mock_health.return_value = False

        # Clear the internal cache in health.py
        from app import health
        health._llm_health_cache.clear()

        response = client.get("/ready")
        assert response.status_code == 503
        assert response.json() == {"status": "not ready", "llm": "unavailable"}
