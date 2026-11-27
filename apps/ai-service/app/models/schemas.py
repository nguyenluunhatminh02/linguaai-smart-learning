from enum import Enum
from typing import Annotated, Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

# The prompts request 1-10 scores, but the API normalizes 0-1, 1-10 and 0-100
# responses. Accept the full range the API understands while rejecting absurd
# values such as negative readability or trillion-point scores.
Score = Annotated[float, Field(ge=0, le=100)]
WritingScoreKey = Literal["grammar", "vocabulary", "coherence", "task_achievement", "overall"]


class LanguageLevel(str, Enum):
    A1 = "A1"
    A2 = "A2"
    B1 = "B1"
    B2 = "B2"
    C1 = "C1"
    C2 = "C2"


SUPPORTED_LANGUAGES = {
    "english",
    "vietnamese",
    "japanese",
    "chinese",
    "korean",
    "spanish",
    "french",
    "german",
}


def validate_language(value: str) -> str:
    """Normalize and validate a language before it is interpolated into a prompt."""
    normalized = value.strip().lower()
    if normalized not in SUPPORTED_LANGUAGES:
        raise ValueError(f"unsupported language: {value!r}")
    return normalized


# --- Writing ---
class WritingAssessRequest(BaseModel):
    user_text: str = Field(..., min_length=1, max_length=10000)
    language: str = "english"
    target_level: str = Field(default="B1", pattern=r"^[A-C][1-2]$")

    @field_validator("language")
    @classmethod
    def normalize_language(cls, v: str) -> str:
        return validate_language(v)


class WritingError(BaseModel):
    type: str
    original: str
    correction: str
    explanation: str


class WritingAssessResponse(BaseModel):
    corrected_text: str = Field(..., min_length=1)
    feedback: str = ""
    errors: List[WritingError]
    # Prompts ask for a 1-10 scale for each rubric score and the overall score.
    scores: Dict[WritingScoreKey, Score]
    tips: List[str]
    overall_score: Score


# --- Reading ---
class ReadingGenerateRequest(BaseModel):
    level: str = Field(default="B1", pattern=r"^[A-C][1-2]$")
    topic: str = Field(..., min_length=1, max_length=200)
    word_count: int = Field(default=300, ge=50, le=1000)
    language: str = "english"

    @field_validator("language")
    @classmethod
    def normalize_language(cls, v: str) -> str:
        return validate_language(v)


class VocabularyItem(BaseModel):
    word: str
    definition: str = ""
    part_of_speech: str = ""


class ReadingQuestion(BaseModel):
    question: str = Field(..., min_length=1)
    type: str = Field(default="mcq", pattern="^(mcq|true_false)$")
    options: List[str]
    correct_answer: str = Field(..., min_length=1)
    explanation: str = ""

    @field_validator("options", mode="before")
    @classmethod
    def coerce_options_to_str(cls, v):
        # A bare string is a malformed response, not a sequence of options:
        # iterating it would silently produce one-character options.
        if isinstance(v, (str, bytes)) or v is None:
            raise ValueError("options must be a list of strings")
        return [str(item) for item in v]

    @field_validator("options")
    @classmethod
    def check_options(cls, v: List[str]) -> List[str]:
        if not 2 <= len(v) <= 6:
            raise ValueError("options must contain between 2 and 6 entries")
        if any(not option.strip() for option in v):
            raise ValueError("options must not contain empty strings")
        return v

    @model_validator(mode="after")
    def check_correct_answer(self):
        # The prompt offers "A"/"B"/... labels, full option text, and
        # true/false answers; the API normalizes all of these when grading.
        answer = self.correct_answer.strip()
        if answer not in self.options and answer.upper() not in ("TRUE", "FALSE"):
            labels = [chr(ord("A") + i) for i in range(len(self.options))]
            if answer.upper() not in labels:
                raise ValueError("correct_answer must match one of the options")
        return self


class ReadingGenerateResponse(BaseModel):
    passage: str = Field(..., min_length=1)
    vocabulary: List[VocabularyItem] = Field(..., min_length=1)
    questions: List[ReadingQuestion] = Field(..., min_length=1)


# --- Grammar ---
class GrammarExplainRequest(BaseModel):
    grammar_point: str = Field(..., min_length=1, max_length=500)
    language: str = "english"
    user_question: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("language")
    @classmethod
    def normalize_language(cls, v: str) -> str:
        return validate_language(v)


class GrammarExplainResponse(BaseModel):
    point: str
    explanation: str
    examples: List[str]
    practice_exercises: List[dict]


# --- Chat ---
class ChatMessage(BaseModel):
    role: str = Field(..., pattern=r"^(user|assistant)$")
    content: str = Field(..., min_length=1, max_length=5000)


class ChatRequest(BaseModel):
    messages: List[ChatMessage] = Field(..., min_length=1, max_length=50)
    language: str = "english"

    @field_validator("language")
    @classmethod
    def normalize_language(cls, v: str) -> str:
        return validate_language(v)


class ChatResponse(BaseModel):
    response: str


# --- Error Pattern Analysis ---
class ErrorAnalysisRequest(BaseModel):
    errors: List[Any] = Field(..., min_length=1, max_length=100)
    language: str = "english"
    level: str = Field(default="B1", pattern=r"^[A-C][1-2]$")

    @field_validator("language")
    @classmethod
    def normalize_language(cls, v: str) -> str:
        return validate_language(v)


# --- Content Generation ---
class GenerateCardsRequest(BaseModel):
    text: str = Field(..., min_length=10, max_length=10000)
    language: str = "english"
    count: int = Field(default=10, ge=3, le=20)

    @field_validator("language")
    @classmethod
    def normalize_language(cls, v: str) -> str:
        return validate_language(v)


class GenerateQuizQuestionsRequest(BaseModel):
    topic: str = Field(..., min_length=1, max_length=200)
    language: str = "english"
    level: str = Field(default="B1", pattern=r"^[A-C][1-2]$")
    count: int = Field(default=10, ge=3, le=20)

    @field_validator("language")
    @classmethod
    def normalize_language(cls, v: str) -> str:
        return validate_language(v)


# --- NLP Analysis ---
class NlpAnalyzeRequest(BaseModel):
    text: str = Field(..., min_length=10, max_length=10000)
    language: str = "english"

    @field_validator("language")
    @classmethod
    def normalize_language(cls, v: str) -> str:
        return validate_language(v)


# --- Additional Response Models ---
class FlashcardItem(BaseModel):
    front: str = Field(..., min_length=1)
    back: str = Field(..., min_length=1)
    example: str = ""
    pronunciation: str = ""
    difficulty: int = Field(default=3, ge=1, le=5)


class GenerateCardsResponse(BaseModel):
    cards: List[FlashcardItem] = Field(..., min_length=1)


class QuizQuestionItem(BaseModel):
    questionText: str = Field(..., min_length=1)
    questionType: str = Field(default="mcq", pattern="^(mcq|true_false|fill_blank)$")
    options: List[str] = Field(default_factory=list)
    correctAnswer: str = Field(..., min_length=1)
    explanation: str = ""
    difficulty: int = Field(default=3, ge=1, le=5)

    @model_validator(mode="after")
    def check_options_for_type(self):
        if self.questionType == "mcq" and len(self.options) < 2:
            raise ValueError("mcq questions need at least two options")
        if self.questionType == "true_false" and (
            len(self.options) != 2
            or {option.strip().lower() for option in self.options} != {"true", "false"}
        ):
            raise ValueError("true_false questions need exactly True and False options")
        return self


class GenerateQuizQuestionsResponse(BaseModel):
    title: str = Field(..., min_length=1)
    questions: List[QuizQuestionItem] = Field(..., min_length=1)


class NlpAnalyzeResponse(BaseModel):
    word_count: int = Field(..., ge=0)
    sentence_count: int = Field(..., ge=0)
    avg_sentence_length: float = Field(..., ge=0)
    estimated_level: str = Field(default="B1", pattern="^[A-C][1-2]$")
    readability_score: float = Field(..., ge=0, le=100)
    vocabulary_complexity: str = Field(default="intermediate", pattern="^(basic|intermediate|advanced|mixed)$")
    top_keywords: List[str] = []
    complex_words: List[str] = []
    grammar_patterns_found: List[str] = []
    text_type: str = Field(default="narrative", pattern="^(narrative|expository|descriptive|argumentative|instructional)$")
    learning_value: str = Field(default="medium", pattern="^(low|medium|high)$")
    suggested_exercises: List[str] = []
    notes: str = ""


class ErrorPatternItem(BaseModel):
    category: str = Field(default="grammar", pattern="^(grammar|spelling|vocabulary|punctuation|style)$")
    pattern_name: str = Field(..., min_length=1)
    frequency: int = Field(..., ge=1)
    description: str = Field(..., min_length=1)
    examples: List[str] = Field(default_factory=list)


class ErrorExerciseItem(BaseModel):
    type: str = Field(default="error_correction", pattern="^(fill_blank|rewrite|multiple_choice|error_correction)$")
    target_pattern: str = Field(..., min_length=1)
    instruction: str = Field(..., min_length=1)
    question: str = Field(..., min_length=1)
    options: List[str] = Field(default_factory=list)
    correct_answer: str = Field(..., min_length=1)
    explanation: str = ""


class ErrorAnalysisResponse(BaseModel):
    summary: str = Field(..., min_length=1)
    patterns: List[ErrorPatternItem] = Field(..., min_length=1)
    exercises: List[ErrorExerciseItem] = Field(..., min_length=1)
    priority_focus: str = Field(..., min_length=1)
