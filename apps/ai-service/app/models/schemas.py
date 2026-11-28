"""Strict request/response schemas for the AI service.

User input is data, never instructions: schemas reject unknown fields, bound
every untrusted string/list and cap the aggregate context of a request before
it reaches a prompt. Provider output is likewise schema-validated before it
reaches a client; this module never renders, evaluates or executes it.
"""

from __future__ import annotations

from enum import Enum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.limits import (
    MAX_CHAT_HISTORY_MESSAGES,
    MAX_ERROR_ITEM_CHARS,
    MAX_EXAMPLES_PER_ITEM,
    MAX_GENERATED_ITEMS,
    MAX_GRAMMAR_POINT_CHARS,
    MAX_LIST_ITEMS,
    MAX_OPTIONS_PER_QUESTION,
    MAX_OUTPUT_CHARS,
    MAX_QUESTION_CHARS,
    MAX_STRING_CHARS,
    MAX_TEXT_CHARS,
    MAX_TOPIC_CHARS,
    MAX_LABEL_CHARS,
)

# The prompts request 1-10 scores, but the API normalizes 0-1, 1-10 and 0-100
# responses. Accept the full range the API understands while rejecting absurd
# values such as negative readability or trillion-point scores.
Score = Annotated[float, Field(ge=0, le=100)]
WritingScoreKey = Literal["grammar", "vocabulary", "coherence", "task_achievement", "overall"]
LevelLiteral = Literal["A1", "A2", "B1", "B2", "C1", "C2"]
ChatRole = Literal["user", "assistant"]

SUPPORTED_LANGUAGES = frozenset(
    {
        "english",
        "vietnamese",
        "japanese",
        "chinese",
        "korean",
        "spanish",
        "french",
        "german",
    }
)


class LanguageLevel(str, Enum):
    A1 = "A1"
    A2 = "A2"
    B1 = "B1"
    B2 = "B2"
    C1 = "C1"
    C2 = "C2"


def validate_language(value: str) -> str:
    """Normalize a language code without echoing the rejected value.

    The supported set is server-controlled and the result is used as data in a
    prompt; a client must not be able to inject instructions through this field
    or through Pydantic's error message.
    """
    if not isinstance(value, str):
        raise ValueError("unsupported language")
    normalized = value.strip().lower()
    if len(normalized) > 32 or normalized not in SUPPORTED_LANGUAGES:
        raise ValueError("unsupported language")
    return normalized


class StrictModel(BaseModel):
    """Base model with strict, bounded validation for all AI payloads."""

    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
        str_max_length=MAX_STRING_CHARS,
        validate_assignment=True,
        protected_namespaces=(),
    )


class RequestModel(StrictModel):
    """Common fields for every prompt-bearing request."""


class ResponseModel(StrictModel):
    """Common fields for every provider-output model."""


BoundedText = Annotated[str, Field(min_length=1, max_length=MAX_TEXT_CHARS)]
BoundedTopic = Annotated[str, Field(min_length=1, max_length=MAX_TOPIC_CHARS)]
BoundedString = Annotated[str, Field(max_length=MAX_STRING_CHARS)]
BoundedLevel = Annotated[str, Field(default="B1", pattern=r"^[A-C][1-2]$")]


def _language_field() -> str:
    return Field(default="english", max_length=32)


class _LanguageNormalizer(RequestModel):
    language: str = _language_field()

    @field_validator("language")
    @classmethod
    def normalize_language(cls, v: str) -> str:
        return validate_language(v)


# --- Writing ---
class WritingAssessRequest(_LanguageNormalizer):
    user_text: BoundedText
    target_level: BoundedLevel = "B1"


class WritingError(ResponseModel):
    type: BoundedString
    original: BoundedString
    correction: BoundedString
    explanation: BoundedString


class WritingAssessResponse(ResponseModel):
    corrected_text: Annotated[str, Field(min_length=1, max_length=MAX_OUTPUT_CHARS)]
    feedback: BoundedString = ""
    errors: Annotated[list[WritingError], Field(max_length=MAX_LIST_ITEMS)]
    # Prompts ask for a 1-10 scale for each rubric score and the overall score.
    scores: dict[WritingScoreKey, Score]
    tips: Annotated[list[BoundedString], Field(max_length=MAX_LIST_ITEMS)]
    overall_score: Score

    @model_validator(mode="after")
    def check_scores(self) -> "WritingAssessResponse":
        if len(self.scores) > len(WritingScoreKey.__args__):
            raise ValueError("too many score entries")
        return self


# --- Reading ---
class ReadingGenerateRequest(_LanguageNormalizer):
    level: BoundedLevel = "B1"
    topic: BoundedTopic
    word_count: int = Field(default=300, ge=50, le=1000)


class VocabularyItem(ResponseModel):
    word: BoundedString
    definition: BoundedString = ""
    part_of_speech: BoundedString = ""


class ReadingQuestion(ResponseModel):
    question: BoundedTopic
    type: Literal["mcq", "true_false"] = "mcq"
    options: Annotated[list[str], Field(max_length=MAX_OPTIONS_PER_QUESTION)]
    correct_answer: BoundedTopic
    explanation: BoundedString = ""

    @field_validator("options", mode="before")
    @classmethod
    def coerce_options_to_str(cls, v):
        # A bare string is a malformed response, not a sequence of options:
        # iterating it would silently produce one-character options.
        if isinstance(v, (str, bytes)) or v is None:
            raise ValueError("options must be a list of strings")
        if not isinstance(v, (list, tuple)):
            raise ValueError("options must be a list")
        return [str(item) for item in v]

    @field_validator("options")
    @classmethod
    def check_options(cls, v: list[str]) -> list[str]:
        if not 2 <= len(v) <= MAX_OPTIONS_PER_QUESTION:
            raise ValueError("options must contain between 2 and 6 entries")
        if any(not option.strip() for option in v):
            raise ValueError("options must not contain empty strings")
        return v

    @model_validator(mode="after")
    def check_correct_answer(self) -> "ReadingQuestion":
        # The prompt offers "A"/"B"/... labels, full option text, and
        # true/false answers; the API normalizes all of these when grading.
        answer = self.correct_answer.strip()
        if answer not in self.options and answer.upper() not in ("TRUE", "FALSE"):
            labels = [chr(ord("A") + i) for i in range(len(self.options))]
            if answer.upper() not in labels:
                raise ValueError("correct_answer must match one of the options")
        return self


class ReadingGenerateResponse(ResponseModel):
    passage: Annotated[str, Field(min_length=1, max_length=MAX_OUTPUT_CHARS)]
    vocabulary: Annotated[list[VocabularyItem], Field(min_length=1, max_length=MAX_GENERATED_ITEMS)]
    questions: Annotated[list[ReadingQuestion], Field(min_length=1, max_length=MAX_GENERATED_ITEMS)]
    # The reading router computes and adds the passage word count to every
    # response; accept it as a legitimate response field.
    word_count: int = Field(default=0, ge=0)


# --- Grammar ---
class GrammarExplainRequest(_LanguageNormalizer):
    grammar_point: Annotated[str, Field(min_length=1, max_length=MAX_GRAMMAR_POINT_CHARS)]
    user_question: Annotated[str | None, Field(max_length=MAX_QUESTION_CHARS)] = None


class GrammarExercise(BaseModel):
    """Provider exercises are opaque key/value data, not executable content."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    question: BoundedTopic
    answer: BoundedString = ""


class GrammarExplainResponse(ResponseModel):
    point: BoundedString
    explanation: Annotated[str, Field(max_length=MAX_OUTPUT_CHARS)]
    examples: Annotated[list[BoundedString], Field(max_length=MAX_GENERATED_ITEMS)]
    practice_exercises: Annotated[list[GrammarExercise], Field(max_length=MAX_GENERATED_ITEMS)]


# --- Chat ---
class ChatMessage(RequestModel):
    role: ChatRole
    content: Annotated[str, Field(min_length=1, max_length=MAX_TEXT_CHARS)]


class ChatRequest(_LanguageNormalizer):
    # Client-supplied history is untrusted data, not authoritative conversation
    # state. The router must truncate it to the most recent bounded turn(s).
    messages: Annotated[
        list[ChatMessage], Field(min_length=1, max_length=MAX_CHAT_HISTORY_MESSAGES)
    ]

    @model_validator(mode="after")
    def check_context_size(self) -> "ChatRequest":
        if not self.messages:
            raise ValueError("at least one message is required")
        if self.messages[-1].role != "user":
            raise ValueError("last message must have role user")
        if sum(len(m.content) for m in self.messages) > MAX_OUTPUT_CHARS:
            raise ValueError("conversation context is too large")
        return self


class ChatResponse(ResponseModel):
    response: Annotated[str, Field(max_length=MAX_OUTPUT_CHARS)]


# --- Error Pattern Analysis ---
class ErrorItem(RequestModel):
    """A learner error entry.

    ``type`` is a bounded label selected by the caller; all other keys are
    opaque learner text. No arbitrary object is passed to a prompt.
    """

    type: Annotated[str, Field(min_length=1, max_length=MAX_LABEL_CHARS)] = "general"
    data: Annotated[str, Field(min_length=1, max_length=MAX_ERROR_ITEM_CHARS)] | None = None
    text: Annotated[str, Field(min_length=1, max_length=MAX_ERROR_ITEM_CHARS)] | None = None
    original: Annotated[str, Field(min_length=1, max_length=MAX_ERROR_ITEM_CHARS)] | None = None
    category: Annotated[str, Field(max_length=MAX_LABEL_CHARS)] | None = None


class ErrorAnalysisRequest(_LanguageNormalizer):
    # Each entry is either a bounded string or a small, explicit set of fields.
    # Unknown keys are rejected, so arbitrary JSON never reaches the prompt and
    # the router can safely iterate over ``type``/``data``.
    errors: Annotated[list[ErrorItem | str], Field(min_length=1, max_length=MAX_LIST_ITEMS)]
    level: BoundedLevel = "B1"

    @model_validator(mode="after")
    def check_context_size(self) -> "ErrorAnalysisRequest":
        total = sum(len(e) if isinstance(e, str) else len(e.data or "") for e in self.errors)
        if total > MAX_OUTPUT_CHARS:
            raise ValueError("error context is too large")
        return self


# --- Content Generation ---
class GenerateCardsRequest(_LanguageNormalizer):
    text: Annotated[str, Field(min_length=10, max_length=MAX_TEXT_CHARS)]
    count: int = Field(default=10, ge=3, le=MAX_GENERATED_ITEMS)


class GenerateQuizQuestionsRequest(_LanguageNormalizer):
    topic: BoundedTopic
    level: BoundedLevel = "B1"
    count: int = Field(default=10, ge=3, le=MAX_GENERATED_ITEMS)


# --- NLP Analysis ---
class NlpAnalyzeRequest(_LanguageNormalizer):
    text: Annotated[str, Field(min_length=10, max_length=MAX_TEXT_CHARS)]


# --- Additional Response Models ---
class FlashcardItem(ResponseModel):
    front: BoundedTopic
    back: BoundedTopic
    example: BoundedString = ""
    pronunciation: BoundedString = ""
    difficulty: int = Field(default=3, ge=1, le=5)


class GenerateCardsResponse(ResponseModel):
    cards: Annotated[list[FlashcardItem], Field(min_length=1, max_length=MAX_GENERATED_ITEMS)]


class QuizQuestionItem(ResponseModel):
    questionText: BoundedTopic
    questionType: Literal["mcq", "true_false", "fill_blank"] = "mcq"
    options: Annotated[list[BoundedString], Field(max_length=MAX_OPTIONS_PER_QUESTION)] = Field(
        default_factory=list
    )
    correctAnswer: BoundedTopic
    explanation: BoundedString = ""
    difficulty: int = Field(default=3, ge=1, le=5)

    @model_validator(mode="after")
    def check_options_for_type(self) -> "QuizQuestionItem":
        if self.questionType == "mcq" and len(self.options) < 2:
            raise ValueError("mcq questions need at least two options")
        if self.questionType == "true_false" and (
            len(self.options) != 2
            or {option.strip().lower() for option in self.options} != {"true", "false"}
        ):
            raise ValueError("true_false questions need exactly True and False options")
        return self


class GenerateQuizQuestionsResponse(ResponseModel):
    title: BoundedTopic
    questions: Annotated[list[QuizQuestionItem], Field(min_length=1, max_length=MAX_GENERATED_ITEMS)]


class NlpAnalyzeResponse(ResponseModel):
    word_count: int = Field(default=0, ge=0)
    sentence_count: int = Field(default=0, ge=0)
    avg_sentence_length: float = Field(default=0, ge=0)
    estimated_level: LevelLiteral = "B1"
    readability_score: float = Field(default=0, ge=0, le=100)
    vocabulary_complexity: Literal["basic", "intermediate", "advanced", "mixed"] = "intermediate"
    top_keywords: Annotated[list[BoundedString], Field(max_length=MAX_GENERATED_ITEMS)] = Field(
        default_factory=list
    )
    complex_words: Annotated[list[BoundedString], Field(max_length=MAX_GENERATED_ITEMS)] = Field(
        default_factory=list
    )
    grammar_patterns_found: Annotated[
        list[BoundedString], Field(max_length=MAX_GENERATED_ITEMS)
    ] = Field(default_factory=list)
    text_type: Literal[
        "narrative", "expository", "descriptive", "argumentative", "instructional"
    ] = "narrative"
    learning_value: Literal["low", "medium", "high"] = "medium"
    suggested_exercises: Annotated[
        list[BoundedString], Field(max_length=MAX_GENERATED_ITEMS)
    ] = Field(default_factory=list)
    notes: BoundedString = ""


class ErrorPatternItem(ResponseModel):
    category: Literal["grammar", "spelling", "vocabulary", "punctuation", "style"] = "grammar"
    pattern_name: BoundedTopic
    frequency: int = Field(..., ge=1, le=MAX_LIST_ITEMS)
    description: Annotated[str, Field(min_length=1, max_length=MAX_OUTPUT_CHARS)]
    examples: Annotated[list[BoundedString], Field(max_length=MAX_EXAMPLES_PER_ITEM)] = Field(
        default_factory=list
    )


class ErrorExerciseItem(ResponseModel):
    type: Literal["fill_blank", "rewrite", "multiple_choice", "error_correction"] = (
        "error_correction"
    )
    target_pattern: BoundedTopic
    instruction: BoundedTopic
    question: BoundedTopic
    options: Annotated[list[BoundedString], Field(max_length=MAX_OPTIONS_PER_QUESTION)] = Field(
        default_factory=list
    )
    correct_answer: BoundedTopic
    explanation: BoundedString = ""


class ErrorAnalysisResponse(ResponseModel):
    summary: Annotated[str, Field(min_length=1, max_length=MAX_OUTPUT_CHARS)]
    patterns: Annotated[list[ErrorPatternItem], Field(min_length=1, max_length=MAX_LIST_ITEMS)]
    exercises: Annotated[list[ErrorExerciseItem], Field(min_length=1, max_length=MAX_LIST_ITEMS)]
    priority_focus: BoundedTopic
