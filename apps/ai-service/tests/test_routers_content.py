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


@pytest.fixture(autouse=True)
def offline_guards(monkeypatch):
    """Use a fresh in-process guard store and no response cache in these tests.

    Production keeps Redis and fail-closed guards. The pytest ``memory://`` URI
    is rejected by redis.asyncio, which would fail every mocked request with a
    503 before the provider is called.
    """
    import app.rate_limit as rate_limit
    from app.services.cache import cache_service

    class _Pipeline:
        def __init__(self, store):
            self._store = store
            self._ops = []

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        def incr(self, key):
            self._ops.append(("incr", key))

        def expire(self, key, ttl):
            self._ops.append(("expire", key, ttl))

        async def execute(self):
            results = []
            for op, key, *_ in self._ops:
                if op == "incr":
                    value = int(self._store.get(key, 0)) + 1
                    self._store[key] = value
                    results.append(value)
                elif op == "expire":
                    results.append(True)
            self._ops.clear()
            return results

    class _Store:
        def __init__(self):
            self.data = {}

        async def incr(self, key):
            value = int(self.data.get(key, 0)) + 1
            self.data[key] = value
            return value

        async def expire(self, key, ttl):
            return True

        async def get(self, key):
            return self.data.get(key)

        async def decr(self, key):
            value = int(self.data.get(key, 0)) - 1
            self.data[key] = value
            return value

        async def delete(self, key):
            self.data.pop(key, None)
            return 1

        def pipeline(self, transaction=True):
            return _Pipeline(self.data)

    rate_limit._redis_client = _Store()
    rate_limit._redis_unavailable = False
    monkeypatch.setattr(cache_service, "get_cached", AsyncMock(return_value=None))
    monkeypatch.setattr(cache_service, "set_cached", AsyncMock())
    yield
    # Avoid leaking a latched outage from an earlier test module into later
    # test files that install their own guard fakes.
    rate_limit._redis_unavailable = False


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
    # All client errors use the bounded roadmap envelope; the legacy
    # {"detail": ...} shape was replaced by it.
    body = response.json()
    assert set(body) == {"error"}
    assert body["error"]["code"] == "INVALID_AI_OUTPUT"
    assert body["error"]["message"] == "AI service returned an invalid result"
    assert body["error"]["retryable"] is False
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
