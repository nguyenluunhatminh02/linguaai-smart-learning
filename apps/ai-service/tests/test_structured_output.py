"""AI-02 structured-output tests for malformed provider completions.

Covers the roadmap cases (malformed JSON, extra fields, truncated output,
wrong language, repeated answers) at three levels:

* ``extract_json`` parsing of provider text;
* Pydantic response schemas, which are the only validation gate on output;
* end-to-end router behavior with the LLM client mocked, including the
  retry-once policy and the bounded 502 error envelope.

Two cases are documented gaps, not regressions: the service does not check
the locale of provider output and it does not reject duplicate items. The
tests assert the current behavior so a future fix fails loudly here and the
gap is visible instead of silently assumed to be covered.

No real credentials, ``.env`` values or provider calls are used.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import settings
from app.main import app
from app.models.schemas import (
    FlashcardItem,
    GenerateCardsResponse,
    QuizQuestionItem,
    ReadingQuestion,
    WritingAssessResponse,
    validate_language,
)
from app.utils import extract_json

client = TestClient(app)

API_KEY = "structured-output-test-key"
HEADERS = {"X-API-Key": API_KEY}
CARDS_PATH = "/v1/ai/content/generate-cards"


@pytest.fixture(autouse=True)
def _offline_guards(monkeypatch):
    """Give billable routes a valid in-process guard store under pytest.

    Production keeps Redis and fail-closed behavior. The test configuration's
    ``memory://`` URI is not accepted by redis.asyncio, which would otherwise
    make every mocked provider call fail with 503 before reaching the model.
    """
    import app.rate_limit as rate_limit

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

    store = _Store()
    rate_limit._redis_client = store
    rate_limit._redis_unavailable = False
    from app.services.cache import cache_service

    monkeypatch.setattr(cache_service, "get_cached", AsyncMock(return_value=None))
    monkeypatch.setattr(cache_service, "set_cached", AsyncMock())
    yield
    # Do not restore a latched outage from an earlier test module: later test
    # files expect the guards to be usable with their own fakes.
    rate_limit._redis_unavailable = False


CARDS_REQUEST = {
    "text": "A short passage about daily routines and useful vocabulary.",
    "language": "english",
}


def _card(**overrides) -> dict:
    payload = {"front": "resilience", "back": "the ability to recover", "difficulty": 3}
    payload.update(overrides)
    return payload


def _quiz(**overrides) -> dict:
    payload = {
        "questionText": "Which word means 'to recover'?",
        "questionType": "mcq",
        "options": ["resilience", "fragility", "routine"],
        "correctAnswer": "resilience",
        "difficulty": 3,
    }
    payload.update(overrides)
    return payload


def _reading_question(**overrides) -> dict:
    payload = {
        "question": "Where does the passage take place?",
        "type": "mcq",
        "options": ["In a library", "In a park"],
        "correct_answer": "In a library",
    }
    payload.update(overrides)
    return payload


def _scores(**overrides) -> dict:
    payload = {
        "grammar": 8,
        "vocabulary": 8,
        "coherence": 8,
        "task_achievement": 8,
        "overall": 8,
    }
    payload.update(overrides)
    return payload


def _writing(**overrides) -> dict:
    payload = {
        "corrected_text": "I have lived here for two years.",
        "feedback": "Good use of the present perfect.",
        "errors": [],
        "scores": _scores(),
        "tips": [],
        "overall_score": 8,
    }
    payload.update(overrides)
    return payload


class TestExtractJson:
    """Provider text parsing, including the recovery behavior on truncation."""

    def test_fenced_json_object_is_extracted(self):
        raw = '```json\n{"cards": [{"front": "resilience", "back": "recover"}]}\n```'
        assert extract_json(raw) == {
            "cards": [{"front": "resilience", "back": "recover"}]
        }

    def test_complete_json_surrounded_by_prose_is_extracted(self):
        raw = 'Here is the requested output.\n{"title": "Practice", "count": 1}\nHope this helps.'
        assert extract_json(raw) == {"title": "Practice", "count": 1}

    def test_malformed_text_without_json_raises_json_decode_error(self):
        with pytest.raises(json.JSONDecodeError):
            extract_json("The model declined to answer with a JSON object.")

    def test_truncation_without_a_complete_object_raises_json_decode_error(self):
        # A cut-off containing only an opening brace has no recoverable object.
        with pytest.raises(json.JSONDecodeError):
            extract_json('{"cards": [{"front": "resilience", "back": "the abili')

    def test_truncated_object_yields_its_last_complete_value(self):
        # Current behavior: the decoder salvages the innermost closed object.
        # This is not a valid GenerateCardsResponse, so schema validation is
        # what ultimately rejects it; pin the parser behavior explicitly.
        raw = '{"cards": [{"front": "alpha", "back": "A"},'
        assert extract_json(raw) == {"front": "alpha", "back": "A"}


class TestSchemaValidation:
    """Strict response schemas are the output validation gate."""

    def test_extra_fields_are_rejected_and_never_echoed(self):
        with pytest.raises(ValidationError) as card_error:
            FlashcardItem(**_card(debug_prompt="DO_NOT_ECHO"))
        assert any(
            error["type"] == "extra_forbidden"
            for error in card_error.value.errors()
        )

        with pytest.raises(ValidationError):
            GenerateCardsResponse(
                cards=[_card()], unexpected="provider-injected-field"
            )

        with pytest.raises(ValidationError) as quiz_error:
            QuizQuestionItem(**_quiz(injected=True))
        assert any(
            error["type"] == "extra_forbidden"
            for error in quiz_error.value.errors()
        )

    def test_rubric_scores_are_bounded_and_keys_are_fixed(self):
        valid = WritingAssessResponse(**_writing())
        assert valid.scores["grammar"] == 8

        with pytest.raises(ValidationError):
            WritingAssessResponse(**_writing(scores=_scores(grammar=101)))
        with pytest.raises(ValidationError):
            WritingAssessResponse(**_writing(overall_score=-1))
        with pytest.raises(ValidationError):
            WritingAssessResponse(**_writing(scores=_scores(fluency=8)))

    def test_question_answer_consistency_is_enforced_for_reading_and_true_false(self):
        assert ReadingQuestion(**_reading_question()).correct_answer == "In a library"

        with pytest.raises(ValidationError):
            ReadingQuestion(
                **_reading_question(correct_answer="None of the above")
            )
        # Letter labels are explicitly accepted by the reading prompt contract.
        assert ReadingQuestion(**_reading_question(correct_answer="A")).correct_answer == "A"

        true_false = QuizQuestionItem(
            **_quiz(questionType="true_false", options=["True", "False"], correctAnswer="True")
        )
        assert true_false.correctAnswer == "True"
        with pytest.raises(ValidationError):
            QuizQuestionItem(
                **_quiz(questionType="true_false", options=["True", "True"], correctAnswer="True")
            )
        with pytest.raises(ValidationError):
            QuizQuestionItem(**_quiz(questionType="mcq", options=[]))

    def test_duplicate_items_and_options_are_currently_accepted(self):
        """Gap: no duplicate detection exists in the response schemas."""
        duplicate_cards = GenerateCardsResponse(
            cards=[_card(), _card()]
        )
        assert [item.front for item in duplicate_cards.cards] == ["resilience", "resilience"]

        repeated_options = QuizQuestionItem(
            **_quiz(options=["alpha", "alpha"], correctAnswer="alpha")
        )
        assert repeated_options.options == ["alpha", "alpha"]

    def test_locale_is_checked_on_requests_not_on_provider_output(self):
        assert validate_language("  VIETNAMESE ") == "vietnamese"
        with pytest.raises(ValueError, match="unsupported language"):
            validate_language("klingon")

        # Gap: response schemas accept any bounded Unicode text, so a French
        # completion for an English request is not detected at this layer.
        french = GenerateCardsResponse(
            cards=[_card(front="résilience", back="la capacité de récupérer")]
        )
        assert french.cards[0].front == "résilience"


class TestStructuredOutputIntegration:
    """Router-level behavior with the provider deterministic and offline."""

    @pytest.fixture(autouse=True)
    def offline_provider(self, monkeypatch):
        monkeypatch.setattr(settings, "api_keys", API_KEY)
        previous = getattr(app.state.limiter, "enabled", None)
        app.state.limiter.enabled = False
        with (
            patch(
                "app.services.cache.cache_service.get_cached",
                new_callable=AsyncMock,
                return_value=None,
            ),
            patch(
                "app.services.cache.cache_service.set_cached",
                new_callable=AsyncMock,
            ),
        ):
            yield
        app.state.limiter.enabled = True if previous is None else previous

    @staticmethod
    def _assert_invalid_output(response):
        assert response.status_code == 502
        body = response.json()
        assert set(body) == {"error"}
        error = body["error"]
        assert error["code"] == "INVALID_AI_OUTPUT"
        assert error["message"] == "AI service returned an invalid result"
        assert error["retryable"] is False
        assert isinstance(error["requestId"], str) and error["requestId"]
        assert isinstance(error["operationId"], str) and error["operationId"]

    def test_malformed_json_retries_once_then_fails_closed(self):
        valid = json.dumps({"cards": [_card()]})
        with patch(
            "app.services.llm_client.LLMClient.generate",
            new_callable=AsyncMock,
            side_effect=["not json at all", valid],
        ) as generate:
            recovered = client.post(CARDS_PATH, json=CARDS_REQUEST, headers=HEADERS)

        assert recovered.status_code == 200
        assert recovered.json()["cards"][0]["front"] == "resilience"
        assert generate.await_count == 2
        # The retry uses a deterministic temperature and keeps the same prompt.
        assert [call.kwargs["temperature"] for call in generate.await_args_list] == [0.4, 0.1]
        assert generate.await_args_list[0].kwargs["prompt"] == generate.await_args_list[1].kwargs["prompt"]

        with patch(
            "app.services.llm_client.LLMClient.generate",
            new_callable=AsyncMock,
            side_effect=["not json at all", "still not json"],
        ) as generate:
            failed = client.post(CARDS_PATH, json=CARDS_REQUEST, headers=HEADERS)

        self._assert_invalid_output(failed)
        assert generate.await_count == 2
        assert "not json at all" not in failed.text

    def test_extra_provider_field_is_rejected_without_echoing_it(self):
        poisoned = json.dumps({"cards": [_card(debug_prompt="DO_NOT_ECHO")]})
        with patch(
            "app.services.llm_client.LLMClient.generate",
            new_callable=AsyncMock,
            side_effect=[poisoned, poisoned],
        ) as generate:
            response = client.post(CARDS_PATH, json=CARDS_REQUEST, headers=HEADERS)

        self._assert_invalid_output(response)
        assert generate.await_count == 2
        assert "DO_NOT_ECHO" not in response.text

    def test_truncated_completion_is_rejected_after_one_retry(self):
        truncated = '{"cards": [{"front": "resilience", "back": "the abili'
        with patch(
            "app.services.llm_client.LLMClient.generate",
            new_callable=AsyncMock,
            side_effect=[truncated, truncated],
        ) as generate:
            response = client.post(CARDS_PATH, json=CARDS_REQUEST, headers=HEADERS)

        self._assert_invalid_output(response)
        assert generate.await_count == 2
        assert "resilience" not in response.text

    def test_wrong_locale_output_is_currently_accepted(self):
        """Gap: an English request does not validate the output language."""
        french = json.dumps(
            {"cards": [_card(front="résilience", back="la capacité de récupérer")]}
        )
        with patch(
            "app.services.llm_client.LLMClient.generate",
            new_callable=AsyncMock,
            return_value=french,
        ) as generate:
            response = client.post(CARDS_PATH, json=CARDS_REQUEST, headers=HEADERS)

        assert response.status_code == 200
        assert response.json()["cards"][0]["front"] == "résilience"
        assert generate.await_count == 1
        assert "english" in generate.await_args.kwargs["system"]

    def test_repeated_cards_are_currently_accepted(self):
        """Gap: duplicate items are not detected by the generation endpoint."""
        duplicates = json.dumps({"cards": [_card(), _card()]})
        with patch(
            "app.services.llm_client.LLMClient.generate",
            new_callable=AsyncMock,
            return_value=duplicates,
        ) as generate:
            response = client.post(CARDS_PATH, json=CARDS_REQUEST, headers=HEADERS)

        assert response.status_code == 200
        cards = response.json()["cards"]
        assert len(cards) == 2
        assert [card["front"] for card in cards] == ["resilience", "resilience"]
        assert generate.await_count == 1
