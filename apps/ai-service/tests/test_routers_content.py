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
# Content Generation Endpoint Tests
# ──────────────────────────────────────────────────────────────────────────────

CARDS_PAYLOAD = {
    "text": "A sample passage about daily routines and vocabulary for flashcards.",
    "language": "english",
}
QUIZ_PAYLOAD = {
    "topic": "present perfect tense",
    "language": "english",
    "level": "B1",
}


def test_generate_cards_requires_api_key():
    """Request without X-API-Key should return 401."""
    response = client.post("/v1/ai/content/generate-cards", json=CARDS_PAYLOAD)
    assert response.status_code == 401


def test_generate_cards_rejects_invalid_api_key():
    """Request with wrong X-API-Key should return 401."""
    response = client.post(
        "/v1/ai/content/generate-cards",
        headers={"X-API-Key": "wrong-key"},
        json=CARDS_PAYLOAD,
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_generate_cards_success_with_valid_key():
    """Happy path: card generation succeeds with valid key and mocked LLM client."""
    mock_llm_json_response = """
    {
        "cards": [
            {
                "front": "resilience",
                "back": "the ability to recover after difficulty",
                "example": "Her resilience helped her recover.",
                "pronunciation": "",
                "difficulty": 3
            }
        ]
    }
    """

    with patch("app.services.llm_client.LLMClient.generate", new_callable=AsyncMock) as mock_generate:
        mock_generate.return_value = mock_llm_json_response

        response = client.post(
            "/v1/ai/content/generate-cards",
            headers={"X-API-Key": "test-api-key-123"},
            json=CARDS_PAYLOAD,
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data["cards"]) == 1
        assert data["cards"][0]["front"] == "resilience"
        assert data["cards"][0]["difficulty"] == 3
        mock_generate.assert_called_once()


def test_generate_quiz_questions_requires_api_key():
    """Request without X-API-Key should return 401."""
    response = client.post("/v1/ai/content/generate-quiz-questions", json=QUIZ_PAYLOAD)
    assert response.status_code == 401


def test_generate_quiz_questions_rejects_invalid_api_key():
    """Request with wrong X-API-Key should return 401."""
    response = client.post(
        "/v1/ai/content/generate-quiz-questions",
        headers={"X-API-Key": "wrong-key"},
        json=QUIZ_PAYLOAD,
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_generate_quiz_questions_success_with_valid_key():
    """Happy path: quiz generation succeeds with valid key and mocked LLM client."""
    mock_llm_json_response = """
    {
        "title": "Present Perfect Practice",
        "questions": [
            {
                "questionText": "I ___ to the store yesterday.",
                "questionType": "mcq",
                "options": ["go", "went", "gone", "going"],
                "correctAnswer": "went",
                "explanation": "Past simple is used for completed actions.",
                "difficulty": 2
            }
        ]
    }
    """

    with patch("app.services.llm_client.LLMClient.generate", new_callable=AsyncMock) as mock_generate:
        mock_generate.return_value = mock_llm_json_response

        response = client.post(
            "/v1/ai/content/generate-quiz-questions",
            headers={"X-API-Key": "test-api-key-123"},
            json=QUIZ_PAYLOAD,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "Present Perfect Practice"
        assert len(data["questions"]) == 1
        assert data["questions"][0]["questionType"] == "mcq"
        assert data["questions"][0]["correctAnswer"] == "went"
        mock_generate.assert_called_once()


@pytest.mark.asyncio
async def test_generate_cards_invalid_json_twice_returns_502():
    """Two malformed completions must map to 502 rather than an unhandled 500."""
    payload = dict(CARDS_PAYLOAD)
    payload["text"] = CARDS_PAYLOAD["text"] + " invalid-json-contract-check."
    with patch(
        "app.services.llm_client.LLMClient.generate",
        new_callable=AsyncMock,
        return_value="not json at all",
    ) as mock_generate:
        response = client.post(
            "/v1/ai/content/generate-cards",
            headers={"X-API-Key": "test-api-key-123"},
            json=payload,
        )

    assert response.status_code == 502
    assert response.json() == {"detail": "AI returned invalid JSON"}
    assert mock_generate.await_count == 2


# ──────────────────────────────────────────────────────────────────────────────
# Invisible-Character Helper Tests
# ──────────────────────────────────────────────────────────────────────────────

from app.routers.content import _strip_invisible_chars


class TestStripInvisibleChars:
    def test_preserves_visible_text(self):
        assert _strip_invisible_chars("Hello world") == "Hello world"

    def test_drops_zero_width_space(self):
        assert _strip_invisible_chars("Hel​lo") == "Hello"

    def test_drops_bidi_controls(self):
        assert _strip_invisible_chars("abc‮def") == "abcdef"

    def test_preserves_newlines_and_unicode_letters(self):
        text = "Tiếng Việt\nhas accents"
        assert _strip_invisible_chars(text) == text
