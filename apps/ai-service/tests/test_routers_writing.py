import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch

from app.main import app
from app.config import settings

client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_api_keys(monkeypatch):
    """Set up test API keys for verify_key dependency."""
    monkeypatch.setattr(settings, "api_keys", "test-api-key-123")


# ──────────────────────────────────────────────────────────────────────────────
# Writing Assessment Tests
# ──────────────────────────────────────────────────────────────────────────────


def test_writing_requires_api_key():
    """Request without X-API-Key should return 401."""
    response = client.post(
        "/v1/ai/writing/assess",
        json={"user_text": "I has a dog.", "language": "english", "target_level": "B1"},
    )
    assert response.status_code == 401


def test_writing_rejects_invalid_api_key():
    """Request with wrong X-API-Key should return 401."""
    response = client.post(
        "/v1/ai/writing/assess",
        headers={"X-API-Key": "wrong-key"},
        json={"user_text": "I has a dog.", "language": "english", "target_level": "B1"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_writing_success_with_valid_key():
    """Happy path: writing assessment succeeds with valid key and mocked LLM client."""
    mock_llm_json_response = """
    {
        "corrected_text": "I have a dog.",
        "feedback": "Minor grammar error corrected.",
        "errors": [
            {
                "type": "grammar",
                "original": "has",
                "correction": "have",
                "explanation": "Subject-verb agreement error with first person pronoun."
            }
        ],
        "scores": {
            "grammar": 4.0,
            "vocabulary": 4.5,
            "coherence": 5.0
        },
        "tips": ["Pay attention to pronoun-verb agreement."],
        "overall_score": 4.5
    }
    """

    with patch("app.services.llm_client.LLMClient.generate", new_callable=AsyncMock) as mock_generate:
        mock_generate.return_value = mock_llm_json_response

        response = client.post(
            "/v1/ai/writing/assess",
            headers={"X-API-Key": "test-api-key-123"},
            json={"user_text": "I has a dog.", "language": "english", "target_level": "B1"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["corrected_text"] == "I have a dog."
        assert len(data["errors"]) == 1
        assert data["overall_score"] == 4.5
        mock_generate.assert_called_once()
