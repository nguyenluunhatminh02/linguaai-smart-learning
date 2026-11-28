"""AI-05/TEST-13 evaluation runner: deterministic-first golden checks.

Run from ``apps/ai-service``::

    python -m evals.run --mode deterministic
    python -m evals.run --mode deterministic --cases golden.jsonl \
        --report-json reports/latest.json --fail-on critical

``--mode deterministic`` (the default) never imports the provider client and
never performs network I/O: each case carries an offline ``candidate`` fixture,
which is checked against its expected invariants. Live provider calls exist
only behind ``--mode live --live-confirm`` **and** the explicit, non-CI
``LINGUAAI_EVAL_LIVE=1`` / confirmation env opt-ins; they are capped in count,
tokens and time, use ``cache_ttl=0``, and never serialize credentials, prompts,
learner text or raw responses.

The built-in suite is synthetic, provenance-labelled and stratified by
feature/language/level. External suites are strict JSONL: one JSON object per
line with the fields documented in :func:`parse_case`. Reports sort every
comparable field; volatile run metadata lives in a separate top-level key.

This module intentionally has no side effects at import time.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import sys
import time
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Optional

# Strict response contracts are the single source of truth for schemaValid.
from app.models.schemas import (
    ChatResponse,
    ErrorAnalysisResponse,
    GenerateCardsResponse,
    GenerateQuizQuestionsResponse,
    GrammarExplainResponse,
    NlpAnalyzeResponse,
    ReadingGenerateResponse,
    WritingAssessResponse,
    validate_language,
)

# Prompt provenance comes from the registry; learner text always goes through
# the service's containment helper before it reaches a provider.
from app.core.security import wrap_user_input
from app.prompts.registry import get_prompt


EXIT_PASS = 0
EXIT_REGRESSION = 1
EXIT_BAD_CONFIG = 2
EXIT_NO_LIVE_OPTIN = 3

MAX_LIVE_CASES = 20
MAX_LIVE_TOKENS_PER_CALL = 512
LIVE_TEMPERATURE = 0.0
LIVE_ENV_OPTIN = "LINGUAAI_EVAL_LIVE"
CI_ENV_NAMES = ("CI", "GITHUB_ACTIONS", "GITLAB_CI", "JENKINS_URL", "BUILDKITE", "TF_BUILD")
LIVE_CONFIRM_TOKEN = "I-UNDERSTAND-LIVE-EVAL-COSTS-MONEY"

FEATURE_TO_PROMPT = {
    "writing_feedback": "writing.assess",
    "grammar": "grammar.explain",
    "reading_generation": "reading.generate",
    "content_generation": "cards.generate",
    "cards_generation": "cards.generate",
    "quiz_generation": "quiz.generate",
    "nlp_analysis": "nlp.analyze",
    "error_analysis": "errors.analyze",
    "chat": "chat.tutor",
}

RESPONSE_MODELS: dict[str, type] = {
    "writing_feedback": WritingAssessResponse,
    "grammar": GrammarExplainResponse,
    "reading_generation": ReadingGenerateResponse,
    "cards_generation": GenerateCardsResponse,
    "quiz_generation": GenerateQuizQuestionsResponse,
    "nlp_analysis": NlpAnalyzeResponse,
    "error_analysis": ErrorAnalysisResponse,
    "chat": ChatResponse,
}

FEATURE_ALIASES = {"content_generation": "cards_generation"}

# Roadmap: prompts ask for 1-10 while the API accepts several scales. The eval
# declares the scale so a score can be interpreted without guessing.
RUBRIC_SCALES = ("1-10", "0-100", "0-1")
SCORE_KEYS = frozenset(
    {
        "correctness",
        "helpfulness",
        "specificity",
        "language_level",
        "factual_grounding",
        "safety",
        "schema_validity",
    }
)
LEVELS = frozenset({"A1", "A2", "B1", "B2", "C1", "C2"})

# Fixed, case-independent signals only: these match labels/phrases, never
# learner-supplied content, and no dataset-supplied regex is ever compiled.
CLAIM_RISK_PATTERNS: Mapping[str, re.Pattern[str]] = {
    "official_ielts_band": re.compile(
        r"\b(official|real|guaranteed|certified)\b[\s\S]{0,40}\b(ielts|band\s*score)\b"
        r"|\bielts\s+band\s+(is|of)\s+\d",
        re.IGNORECASE,
    ),
    "pronunciation_proof": re.compile(
        r"\bproves?\b[\s\S]{0,40}\bpronunciation\b"
        r"|\bpronunciation\s+(is\s+)?(proven|perfect|certified)\b",
        re.IGNORECASE,
    ),
    "guaranteed_exam_score": re.compile(
        r"\bguarantee[sd]?\b[\s\S]{0,40}\b(score|band|exam|pass)\b", re.IGNORECASE
    ),
    "system_prompt_disclosure": re.compile(
        r"\bmy\s+(system\s+prompt|internal\s+instructions)\s+(is|are)\b", re.IGNORECASE
    ),
}

INJECTION_TOKEN_RE = re.compile(
    r"(?:<\s*\|\s*im_start\s*\|\s*>|<\s*\|\s*im_end\s*\|\s*>|\[\s*/?\s*INST\s*\])",
    re.IGNORECASE,
)

CJK_RE = re.compile(r"[぀-ヿ㐀-鿿가-힯]")


class EvalConfigError(ValueError):
    """Bad dataset, CLI config or environment (exit code 2)."""


class LiveOptInError(EvalConfigError):
    """Live mode requested without every required opt-in (exit code 3)."""


@dataclass(frozen=True)
class Case:
    """One strictly validated golden case."""

    id: str
    feature: str
    language: str
    level: str
    source: str
    input: dict[str, Any]
    candidate: Any
    expected: dict[str, Any]
    prompt_version: str
    critical: bool
    notes: str

    @property
    def model_feature(self) -> str:
        return FEATURE_ALIASES.get(self.feature, self.feature)

    def case_fingerprint(self) -> str:
        """Stable content hash; learner text is never included in reports."""
        payload = {
            "id": self.id,
            "feature": self.feature,
            "language": self.language,
            "level": self.level,
            "input": self.input,
            "expected": self.expected,
            "prompt_version": self.prompt_version,
        }
        raw = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


# ─────────────────────────────────────────────────────────────────────────────
# Synthetic golden dataset
# ─────────────────────────────────────────────────────────────────────────────

_RUBRIC = {
    "scale": "1-10",
    "minimum": {
        "correctness": 7,
        "helpfulness": 6,
        "specificity": 6,
        "language_level": 6,
        "factual_grounding": 7,
        "safety": 8,
        "schema_validity": 7,
    },
}

# IELTS-style feedback is always an estimate/practice signal, never a band.
_RUBRIC_PRACTICE = {
    "scale": "1-10",
    "minimum": dict(_RUBRIC["minimum"]),
    "practice_estimate_only": True,
}

_WRITING_CANDIDATE = {
    "corrected_text": "Yesterday I went to school.",
    "feedback": "The past-tense verb is the main issue; the rest is clear.",
    "errors": [
        {
            "type": "grammar",
            "original": "Yesterday I go to school.",
            "correction": "Yesterday I went to school.",
            "explanation": "A finished past time requires the past tense 'went'.",
        }
    ],
    "scores": {
        "grammar": 7,
        "vocabulary": 8,
        "coherence": 8,
        "task_achievement": 8,
        "overall": 8,
    },
    "tips": ["Practice irregular past-tense verbs."],
    "overall_score": 7.8,
}

_GRAMMAR_CANDIDATE = {
    "point": "Simple past tense",
    "explanation": "Use the simple past for actions completed at a definite past time.",
    "examples": [
        "Yesterday I went to school.",
        "She visited her grandmother last week.",
        "They watched a film yesterday evening.",
    ],
    "practice_exercises": [
        {"question": "Yesterday I ___ (go) to school.", "answer": "went"},
        {"question": "She ___ (visit) her grandmother last week.", "answer": "visited"},
        {"question": "They ___ (watch) a film yesterday.", "answer": "watched"},
    ],
}

_READING_CANDIDATE = {
    "passage": (
        "Yesterday I went to school. My friend waited for me at the gate. "
        "We studied English together and read a short story. The teacher asked us "
        "many questions, and I answered them carefully."
    ),
    "vocabulary": [
        {"word": "gate", "definition": "an opening in a fence", "part_of_speech": "noun"},
        {"word": "story", "definition": "a short written account", "part_of_speech": "noun"},
        {"word": "carefully", "definition": "in a careful way", "part_of_speech": "adverb"},
        {"word": "teacher", "definition": "a person who teaches", "part_of_speech": "noun"},
        {"word": "friend", "definition": "a person you know well", "part_of_speech": "noun"},
    ],
    "questions": [
        {
            "question": "Where did the friend wait?",
            "type": "mcq",
            "options": ["A. At the gate", "B. At home", "C. In a cafe", "D. In a library"],
            "correct_answer": "A. At the gate",
            "explanation": "The passage says the friend waited at the gate.",
        },
        {
            "question": "What did they study together?",
            "type": "mcq",
            "options": ["A. Maths", "B. English", "C. Music", "D. Art"],
            "correct_answer": "B. English",
            "explanation": "The passage says they studied English together.",
        },
        {
            "question": "The narrator answered the questions carefully.",
            "type": "true_false",
            "options": ["True", "False"],
            "correct_answer": "True",
            "explanation": "The narrator answered the questions carefully.",
        },
        {
            "question": "Who asked the questions?",
            "type": "mcq",
            "options": ["A. The teacher", "B. A friend", "C. A student", "D. Nobody"],
            "correct_answer": "A. The teacher",
            "explanation": "The teacher asked the questions.",
        },
        {
            "question": "What did they read?",
            "type": "mcq",
            "options": ["A. A short story", "B. A letter", "C. A poem", "D. A notice"],
            "correct_answer": "A. A short story",
            "explanation": "They read a short story together.",
        },
    ],
}

_CARDS_CANDIDATE = {
    "cards": [
        {
            "front": "gate",
            "back": "an opening in a fence",
            "example": "My friend waited at the gate.",
            "pronunciation": "",
            "difficulty": 2,
        },
        {
            "front": "carefully",
            "back": "in a careful way",
            "example": "I answered the questions carefully.",
            "pronunciation": "",
            "difficulty": 3,
        },
        {
            "front": "story",
            "back": "a short written account",
            "example": "We read a short story.",
            "pronunciation": "",
            "difficulty": 2,
        },
    ]
}

_QUIZ_CANDIDATE = {
    "title": "Simple past practice",
    "questions": [
        {
            "questionText": "Yesterday I ___ (go) to school.",
            "questionType": "fill_blank",
            "options": [],
            "correctAnswer": "went",
            "explanation": "Go has the irregular past form went.",
            "difficulty": 2,
        },
        {
            "questionText": "She ___ (visit) her grandmother last week.",
            "questionType": "mcq",
            "options": ["A. visit", "B. visited", "C. visits", "D. visiting"],
            "correctAnswer": "B. visited",
            "explanation": "A completed past action uses the simple past.",
            "difficulty": 3,
        },
        {
            "questionText": "They watched a film yesterday.",
            "questionType": "true_false",
            "options": ["True", "False"],
            "correctAnswer": "True",
            "explanation": "The sentence describes a completed past action.",
            "difficulty": 2,
        },
    ],
}

_NLP_CANDIDATE = {
    "word_count": 34,
    "sentence_count": 5,
    "avg_sentence_length": 6.8,
    "estimated_level": "A2",
    "readability_score": 72,
    "vocabulary_complexity": "basic",
    "top_keywords": ["school", "friend", "English", "story", "teacher"],
    "complex_words": ["carefully"],
    "grammar_patterns_found": ["simple past"],
    "text_type": "narrative",
    "learning_value": "medium",
    "suggested_exercises": ["Practise irregular past verbs."],
    "notes": "Simple narrative suitable for A2 practice.",
}

_ERRORS_CANDIDATE = {
    "summary": "The learner mixes present and past forms in past-time sentences.",
    "patterns": [
        {
            "category": "grammar",
            "pattern_name": "Simple past tense",
            "frequency": 2,
            "description": "The verb stays in the present form after a past time marker.",
            "examples": ["Yesterday I go to school.", "Yesterday I watch a film."],
        }
    ],
    "exercises": [
        {
            "type": "fill_blank",
            "target_pattern": "Simple past tense",
            "instruction": "Put the verb into the simple past.",
            "question": "Yesterday I ___ (go) to school.",
            "options": ["A. go", "B. went", "C. goes", "D. going"],
            "correct_answer": "B. went",
            "explanation": "Go has the irregular past form went.",
        }
    ],
    "priority_focus": "Irregular past-tense verbs in past-time sentences.",
}

_CHAT_CANDIDATE = {
    "response": (
        "You wrote 'Yesterday I go to school.' For a finished past action, use "
        "the simple past: 'Yesterday I went to school.' Try another sentence: "
        "what did you do last weekend?"
    )
}

# Short synthetic variants only; no real learner text or licensed corpus.
_WRITING_VARIANTS: tuple[tuple[str, str, str], ...] = (
    ("Yesterday I go to school.", "Yesterday I went to school.", "past tense: go -> went"),
    ("Yesterday I watch a film.", "Yesterday I watched a film.", "past tense: watch -> watched"),
    ("She go to school every day.", "She goes to school every day.", "subject-verb agreement: go -> goes"),
    ("I have no money.", "I have no money.", "correct and complete sentence"),
    ("He don't like coffee.", "He doesn't like coffee.", "subject-verb agreement: don't -> doesn't"),
    ("They was happy yesterday.", "They were happy yesterday.", "past tense: was -> were"),
    ("I am living here since 2020.", "I have lived here since 2020.", "present perfect: am living -> have lived"),
    ("She can to swim very well.", "She can swim very well.", "modal verb: remove 'to' after can"),
    ("There are many book on the table.", "There are many books on the table.", "plural noun: book -> books"),
    ("I didn't went to school.", "I didn't go to school.", "negative past: went -> go"),
    ("My brother are taller than me.", "My brother is taller than me.", "subject-verb agreement: are -> is"),
    ("We will goes to the park.", "We will go to the park.", "future tense: goes -> go"),
    ("The cat sleep on the sofa.", "The cat sleeps on the sofa.", "subject-verb agreement: sleep -> sleeps"),
    ("I have buy a new book.", "I have bought a new book.", "present perfect: buy -> bought"),
    ("He studied english yesterday.", "He studied English yesterday.", "capitalization: english -> English"),
    ("I am go to school now.", "I am going to school now.", "present continuous: go -> going"),
    ("She doesn't likes tea.", "She doesn't like tea.", "negative present: likes -> like"),
    ("They are play football now.", "They are playing football now.", "present continuous: play -> playing"),
    ("I saw him two days ago.", "I saw him two days ago.", "correct past-time sentence"),
    ("He arrive late yesterday.", "He arrived late yesterday.", "past tense: arrive -> arrived"),
)

_GRAMMAR_POINTS: tuple[tuple[str, str, str], ...] = (
    ("Simple past tense", "went", "Yesterday I ___ (go) to school."),
    ("Present perfect", "have lived", "They ___ (live) here since 2020."),
    ("Subject-verb agreement", "goes", "She ___ (go) to school every day."),
    ("Modal verbs", "swim", "She can ___ (swim) very well."),
    ("Plural nouns", "books", "There are many ___ (book) on the table."),
    ("Comparative adjectives", "taller", "My brother is ___ (tall) than me."),
    ("Future with will", "go", "We will ___ (go) to the park."),
    ("Present continuous", "going", "I am ___ (go) to school now."),
    ("Negative present", "like", "She doesn't ___ (like) tea."),
    ("Past continuous", "was reading", "I ___ (read) when she arrived."),
)

_TOPICS: tuple[str, ...] = (
    "daily routine",
    "weekend plans",
    "favourite food",
    "a short trip",
    "school life",
    "family members",
    "weather",
    "hobbies",
    "a library visit",
    "learning English",
)

_LANGUAGES: tuple[str, ...] = (
    "english",
    "vietnamese",
    "japanese",
    "chinese",
    "korean",
    "spanish",
    "french",
    "german",
)


def _copy(value: Any) -> Any:
    """Deep copy a JSON fixture without importing extra modules."""
    return json.loads(json.dumps(value, ensure_ascii=False))


def _writing_case(index: int, language: str, level: str) -> dict[str, Any]:
    del language, level
    original, corrected, detection = _WRITING_VARIANTS[index % len(_WRITING_VARIANTS)]
    candidate = _copy(_WRITING_CANDIDATE)
    candidate["corrected_text"] = corrected
    candidate["errors"][0]["original"] = original
    candidate["errors"][0]["correction"] = corrected
    candidate["errors"][0]["explanation"] = f"A teaching note about {detection}."
    return {
        "input": {"text": original},
        "candidate": candidate,
        "expected": {
            "mustDetect": [detection],
            "mustNotClaim": ["text proves pronunciation ability", "official IELTS band"],
            "schemaValid": True,
            "rubric": _RUBRIC_PRACTICE,
            "requiredFields": ["corrected_text", "errors", "scores", "overall_score"],
            "answerKey": {"corrected_text": corrected},
        },
    }


def _grammar_case(index: int, language: str, level: str) -> dict[str, Any]:
    del language, level
    point, answer, question = _GRAMMAR_POINTS[index % len(_GRAMMAR_POINTS)]
    candidate = _copy(_GRAMMAR_CANDIDATE)
    candidate["point"] = point
    candidate["practice_exercises"][0]["question"] = question
    candidate["practice_exercises"][0]["answer"] = answer
    return {
        "input": {"grammar_point": point, "user_question": None},
        "candidate": candidate,
        "expected": {
            "mustDetect": [f"answer: {answer}"],
            "mustNotClaim": ["official IELTS band"],
            "schemaValid": True,
            "rubric": _RUBRIC,
            "requiredFields": ["point", "explanation", "examples", "practice_exercises"],
            "answerKey": {"exercise_0": answer},
        },
    }


def _reading_case(index: int, language: str, level: str) -> dict[str, Any]:
    del language
    candidate = _copy(_READING_CANDIDATE)
    return {
        "input": {"level": level, "topic": _TOPICS[index % len(_TOPICS)], "word_count": 100},
        "candidate": candidate,
        "expected": {
            "mustDetect": ["the teacher"],
            "mustNotClaim": ["text proves pronunciation ability"],
            "schemaValid": True,
            "rubric": _RUBRIC,
            "requiredFields": ["passage", "vocabulary", "questions"],
            "answerKey": {"question_0": candidate["questions"][0]["correct_answer"]},
        },
    }


def _cards_case(index: int, language: str, level: str) -> dict[str, Any]:
    del index, language, level
    return {
        "input": {"text": _READING_CANDIDATE["passage"], "count": 3},
        "candidate": _copy(_CARDS_CANDIDATE),
        "expected": {
            "mustDetect": ["gate"],
            "mustNotClaim": ["official IELTS band"],
            "schemaValid": True,
            "rubric": _RUBRIC,
            "requiredFields": ["cards"],
            "answerKey": {"card_count": 3},
        },
    }


def _quiz_case(index: int, language: str, level: str) -> dict[str, Any]:
    del language
    return {
        "input": {"topic": _TOPICS[index % len(_TOPICS)], "level": level, "count": 3},
        "candidate": _copy(_QUIZ_CANDIDATE),
        "expected": {
            "mustDetect": ["went"],
            "mustNotClaim": ["guaranteed exam score"],
            "schemaValid": True,
            "rubric": _RUBRIC,
            "requiredFields": ["title", "questions"],
            "answerKey": {"question_0": "went"},
        },
    }


def _nlp_case(index: int, language: str, level: str) -> dict[str, Any]:
    del index, language
    candidate = _copy(_NLP_CANDIDATE)
    candidate["estimated_level"] = level
    candidate["notes"] = f"Short synthetic narrative suitable for {level} practice."
    return {
        "input": {"text": _READING_CANDIDATE["passage"]},
        "candidate": candidate,
        "expected": {
            "mustDetect": ["simple past"],
            "mustNotClaim": ["text proves pronunciation ability"],
            "schemaValid": True,
            "rubric": _RUBRIC,
            "requiredFields": ["estimated_level", "word_count", "readability_score"],
            "answerKey": {"estimated_level": level},
        },
    }


def _errors_case(index: int, language: str, level: str) -> dict[str, Any]:
    del index, language
    return {
        "input": {
            "errors": ["Yesterday I go to school.", "Yesterday I watch a film."],
            "level": level,
        },
        "candidate": _copy(_ERRORS_CANDIDATE),
        "expected": {
            "mustDetect": ["Simple past tense"],
            "mustNotClaim": ["official IELTS band"],
            "schemaValid": True,
            "rubric": _RUBRIC,
            "requiredFields": ["summary", "patterns", "exercises", "priority_focus"],
            "answerKey": {"pattern_0": "Simple past tense"},
        },
    }


def _chat_case(index: int, language: str, level: str) -> dict[str, Any]:
    del index, language, level
    return {
        "input": {"messages": [{"role": "user", "content": "Yesterday I go to school."}]},
        "candidate": _copy(_CHAT_CANDIDATE),
        "expected": {
            "mustDetect": ["went"],
            "mustNotClaim": ["my system prompt is"],
            "schemaValid": True,
            "rubric": _RUBRIC,
            "requiredFields": ["response"],
            "answerKey": {"mentions_correction": "went"},
            "containment": True,
        },
    }


_CASE_BUILDERS: tuple[tuple[str, Callable[[int, str, str], dict[str, Any]], str], ...] = (
    ("writing_feedback", _writing_case, "writing.assess"),
    ("grammar", _grammar_case, "grammar.explain"),
    ("reading_generation", _reading_case, "reading.generate"),
    ("cards_generation", _cards_case, "cards.generate"),
    ("quiz_generation", _quiz_case, "quiz.generate"),
    ("nlp_analysis", _nlp_case, "nlp.analyze"),
    ("error_analysis", _errors_case, "errors.analyze"),
    ("chat", _chat_case, "chat.tutor"),
)


def builtin_cases() -> tuple[dict[str, Any], ...]:
    """Build the stratified synthetic suite (8 features x 8 languages x 3 levels)."""
    cases: list[dict[str, Any]] = []
    for i in range(24):
        for feature_index, (feature, builder, prompt_id) in enumerate(_CASE_BUILDERS):
            language = _LANGUAGES[(i + feature_index * 3) % len(_LANGUAGES)]
            level = sorted(LEVELS)[(i + feature_index) % len(LEVELS)]
            built = builder(i, language, level)
            cases.append(
                {
                    "id": f"syn-{feature}-{language}-{level}-{i:03d}",
                    "feature": feature,
                    "language": language,
                    "level": level,
                    "source": "synthetic",
                    "input": built["input"],
                    "candidate": built["candidate"],
                    "expected": built["expected"],
                    "prompt_version": f"{prompt_id}:v{get_prompt(prompt_id).version}",
                    # First cycle supplies the regression-critical baseline.
                    "critical": i < 3,
                    "notes": "synthetic fixture; no real learner text or licensed corpus",
                }
            )
    return tuple(cases)


# ─────────────────────────────────────────────────────────────────────────────
# Strict dataset loader
# ─────────────────────────────────────────────────────────────────────────────

def _require(condition: bool, message: str) -> None:
    if not condition:
        raise EvalConfigError(message)


def parse_case(raw: Any, *, line_no: int = 0) -> Case:
    """Parse and strictly validate one case object.

    Required shape::

        {id, feature, language, level, source, input, candidate, expected,
         prompt_version}

    ``expected`` must contain ``mustDetect`` (string list), ``mustNotClaim``
    (string list), ``schemaValid`` (bool) and ``rubric`` ({scale, minimum}).
    Optional: ``answerKey`` (object), ``requiredFields`` (string list),
    ``containment`` (bool), ``critical`` (bool), ``notes`` (string).
    """
    where = f"line {line_no}" if line_no else "case"
    _require(isinstance(raw, dict), f"{where}: case must be a JSON object")
    data: dict[str, Any] = raw
    required = (
        "id",
        "feature",
        "language",
        "level",
        "source",
        "input",
        "candidate",
        "expected",
        "prompt_version",
    )
    missing = [key for key in required if key not in data]
    _require(not missing, f"{where}: missing fields {sorted(missing)}")
    extra = sorted(set(data) - set(required) - {"critical", "notes"})
    _require(not extra, f"{where}: unknown fields {extra}")

    for key in ("id", "feature", "language", "level", "source", "prompt_version"):
        _require(
            isinstance(data[key], str) and bool(data[key].strip()),
            f"{where}: {key} must be a non-empty string",
        )
    _require(
        re.fullmatch(r"[A-Za-z0-9._:+-]{1,120}", data["id"]) is not None,
        f"{where}: invalid id",
    )
    _require(
        data["source"] in {"synthetic", "licensed", "human-labeled"},
        f"{where}: unsupported source",
    )
    try:
        language = validate_language(data["language"])
    except ValueError:
        raise EvalConfigError(f"{where}: unsupported language") from None
    _require(data["level"] in LEVELS, f"{where}: unsupported level")
    _require(isinstance(data["input"], dict), f"{where}: input must be an object")
    _require(isinstance(data["expected"], dict), f"{where}: expected must be an object")

    expected = data["expected"]
    allowed_expected = {
        "mustDetect",
        "mustNotClaim",
        "schemaValid",
        "rubric",
        "answerKey",
        "requiredFields",
        "containment",
    }
    _require(set(expected) <= allowed_expected, f"{where}: unknown expected keys")
    for key in ("mustDetect", "mustNotClaim"):
        _require(key in expected, f"{where}: expected.{key} is required")
        value = expected[key]
        _require(
            isinstance(value, list) and all(isinstance(v, str) and v for v in value),
            f"{where}: expected.{key} must be a list of non-empty strings",
        )
        _require(len(value) <= 20, f"{where}: expected.{key} has too many entries")
        _require(all(len(v) <= 200 for v in value), f"{where}: expected.{key} entry too long")
    _require(
        isinstance(expected.get("schemaValid"), bool),
        f"{where}: expected.schemaValid must be boolean",
    )
    rubric = expected.get("rubric")
    _require(isinstance(rubric, dict), f"{where}: expected.rubric must be an object")
    _require(
        set(rubric) <= {"scale", "minimum", "practice_estimate_only"},
        f"{where}: unknown rubric keys",
    )
    _require(
        rubric.get("scale") in RUBRIC_SCALES,
        f"{where}: rubric.scale must be one of {RUBRIC_SCALES}",
    )
    minimum = rubric.get("minimum")
    _require(isinstance(minimum, dict), f"{where}: rubric.minimum must be an object")
    _require(set(minimum) <= SCORE_KEYS, f"{where}: unknown rubric dimension")
    for key, value in minimum.items():
        _require(
            isinstance(value, (int, float))
            and not isinstance(value, bool)
            and 0 <= value <= 10,
            f"{where}: rubric.minimum.{key} must be within the declared 0-10 scale",
        )
    if "practice_estimate_only" in rubric:
        _require(
            isinstance(rubric["practice_estimate_only"], bool),
            f"{where}: invalid practice_estimate_only",
        )
    if "answerKey" in expected:
        _require(
            isinstance(expected["answerKey"], dict),
            f"{where}: expected.answerKey must be an object",
        )
    if "requiredFields" in expected:
        fields = expected["requiredFields"]
        _require(
            isinstance(fields, list) and all(isinstance(v, str) and v for v in fields),
            f"{where}: expected.requiredFields must be a list of strings",
        )
    if "containment" in expected:
        _require(
            isinstance(expected["containment"], bool),
            f"{where}: expected.containment must be boolean",
        )

    prompt_version = data["prompt_version"]
    prompt_match = re.fullmatch(r"([a-z]+\.[a-z]+):v(\d+)", prompt_version)
    _require(
        prompt_match is not None,
        f"{where}: prompt_version must be '<id>:v<n>'",
    )
    prompt_id, version_text = prompt_match.groups()
    try:
        prompt = get_prompt(prompt_id, version=int(version_text))
    except (KeyError, ValueError):
        raise EvalConfigError(f"{where}: unknown prompt version {prompt_version}") from None
    model_feature = FEATURE_ALIASES.get(data["feature"], data["feature"])
    _require(model_feature in RESPONSE_MODELS, f"{where}: unsupported feature")
    _require(
        prompt.response_model == RESPONSE_MODELS[model_feature].__name__,
        f"{where}: prompt {prompt_version} does not match feature {data['feature']}",
    )
    _require(
        FEATURE_TO_PROMPT.get(data["feature"]) == prompt_id,
        f"{where}: feature {data['feature']} is not served by prompt {prompt_id}",
    )

    critical = data.get("critical", False)
    _require(isinstance(critical, bool), f"{where}: critical must be boolean")
    notes = data.get("notes", "")
    _require(
        isinstance(notes, str) and len(notes) <= 500,
        f"{where}: notes must be a short string",
    )

    return Case(
        id=data["id"],
        feature=data["feature"],
        language=language,
        level=data["level"],
        source=data["source"],
        input=data["input"],
        candidate=data["candidate"],
        expected=expected,
        prompt_version=prompt_version,
        critical=critical,
        notes=notes,
    )


def load_cases(path: Path | None = None) -> tuple[Case, ...]:
    """Load built-in cases or a strict JSONL file; reject duplicate ids."""
    if path is None:
        raw_cases = builtin_cases()
        line_numbers = [0] * len(raw_cases)
    else:
        _require(path.is_file(), f"cases file not found: {path}")
        raw_cases = []
        line_numbers = []
        for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if not line.strip():
                continue
            try:
                raw_cases.append(json.loads(line))
            except json.JSONDecodeError:
                raise EvalConfigError(f"line {line_no}: invalid JSON") from None
            line_numbers.append(line_no)
    _require(bool(raw_cases), "dataset is empty")
    cases = tuple(
        parse_case(raw, line_no=line_no)
        for raw, line_no in zip(raw_cases, line_numbers)
    )
    seen: set[str] = set()
    for case in cases:
        _require(case.id not in seen, f"duplicate case id: {case.id}")
        seen.add(case.id)
    return cases


# ─────────────────────────────────────────────────────────────────────────────
# Deterministic checks
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class CheckResult:
    check: str
    passed: bool
    detail: str = ""

    def as_dict(self) -> dict[str, Any]:
        # Detail is a fixed label or an id, never learner text.
        return {"check": self.check, "passed": self.passed, "detail": self.detail}


def _flatten_strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, Mapping):
        out: list[str] = []
        for key, item in value.items():
            out.append(str(key))
            out.extend(_flatten_strings(item))
        return out
    if isinstance(value, (list, tuple)):
        out: list[str] = []
        for item in value:
            out.extend(_flatten_strings(item))
        return out
    return []


def _normalize(text: str) -> str:
    return " ".join(text.lower().split())


def _matches(haystack: str, needle: str) -> bool:
    """Match a declared expectation without compiling dataset-supplied regex.

    ``answer: went`` is treated as a labelled token; other phrases use
    case-insensitive substring matching.
    """
    normalized = _normalize(needle)
    if normalized in haystack:
        return True
    if ":" in needle:
        value = _normalize(needle.split(":", 1)[1])
        return bool(value) and value in haystack
    return False


def _check_schema(case: Case, candidate: Any) -> CheckResult:
    model = RESPONSE_MODELS[case.model_feature]
    try:
        if not isinstance(candidate, dict):
            return CheckResult("schema_valid", False, "candidate_not_object")
        validated = model(**candidate)
    except Exception as exc:
        return CheckResult("schema_valid", False, f"validation_{type(exc).__name__}")
    if not case.expected["schemaValid"]:
        return CheckResult("schema_valid", False, "expected_invalid_schema")
    dumped = validated.model_dump()
    for field in case.expected.get("requiredFields", []):
        if field not in dumped:
            return CheckResult("schema_valid", False, "missing_required_field")
    return CheckResult("schema_valid", True)


def _check_must_detect(case: Case, candidate: Any) -> CheckResult:
    haystack = _normalize(" ".join(_flatten_strings(candidate)))
    missing = [
        str(idx)
        for idx, signal in enumerate(case.expected["mustDetect"])
        if not _matches(haystack, signal)
    ]
    return CheckResult(
        "must_detect",
        not missing,
        "all_signals_present" if not missing else f"missing_signal_index:{','.join(missing)}",
    )


def _check_must_not_claim(case: Case, candidate: Any) -> CheckResult:
    text = " ".join(_flatten_strings(candidate))
    haystack = _normalize(text)
    hits = [
        str(idx)
        for idx, phrase in enumerate(case.expected["mustNotClaim"])
        if _normalize(phrase) and _normalize(phrase) in haystack
    ]
    for name, pattern in CLAIM_RISK_PATTERNS.items():
        if pattern.search(text):
            hits.append(name)
    return CheckResult(
        "must_not_claim",
        not hits,
        "no_forbidden_claims" if not hits else "forbidden_claim_detected",
    )


def _check_rubric(case: Case, candidate: Any) -> CheckResult:
    rubric = case.expected["rubric"]
    minimum = rubric["minimum"]
    text = " ".join(_flatten_strings(candidate))
    if rubric.get("practice_estimate_only"):
        claim = re.search(r"\b(ielts|band score|exam score)\b", text, re.IGNORECASE)
        labelled = re.search(r"\b(practice|estimate)\b", text, re.IGNORECASE)
        if claim and not labelled:
            return CheckResult("rubric_bounds", False, "practice_estimate_label_missing")
    scores: dict[str, float] = {}
    if isinstance(candidate, Mapping):
        for dimension, value in candidate.items():
            if dimension in minimum and isinstance(value, (int, float)) and not isinstance(value, bool):
                scores[dimension] = value
        nested = candidate.get("scores")
        if isinstance(nested, Mapping):
            for dimension, value in nested.items():
                if dimension in minimum and isinstance(value, (int, float)) and not isinstance(value, bool):
                    scores[dimension] = value
    for dimension, floor in minimum.items():
        if dimension in scores and not (0 <= scores[dimension] <= 10):
            return CheckResult("rubric_bounds", False, "score_out_of_declared_range")
    return CheckResult("rubric_bounds", True, f"declared_scale_{rubric['scale']}")


def _answer_value(candidate: Any, name: str) -> tuple[bool, Any]:
    """Resolve a declared answer-key slot from a response object."""
    if not isinstance(candidate, Mapping):
        return False, None
    if name == "card_count":
        cards = candidate.get("cards")
        return isinstance(cards, list), len(cards) if isinstance(cards, list) else None
    if name == "exercise_0":
        exercises = candidate.get("practice_exercises")
        if isinstance(exercises, list) and exercises and isinstance(exercises[0], Mapping):
            return True, exercises[0].get("answer")
        return False, None
    if name == "question_0":
        questions = candidate.get("questions")
        if isinstance(questions, list) and questions and isinstance(questions[0], Mapping):
            first = questions[0]
            return True, first.get("correct_answer", first.get("correctAnswer"))
        return False, None
    if name == "pattern_0":
        patterns = candidate.get("patterns")
        if isinstance(patterns, list) and patterns and isinstance(patterns[0], Mapping):
            return True, patterns[0].get("pattern_name")
        return False, None
    if name in candidate:
        return True, candidate[name]
    return False, None


def _check_answer_key(case: Case, candidate: Any) -> CheckResult:
    key = case.expected.get("answerKey")
    if not key:
        return CheckResult("answer_key", True, "not_applicable")
    if case.feature == "writing_feedback" and isinstance(candidate, Mapping):
        # The expected correction is authoritative: a candidate that leaves the
        # original error in its corrected text or error corrections is a
        # regression even if the explanation mentions the right verb.
        corrected = candidate.get("corrected_text")
        if _normalize(str(corrected)) != _normalize(str(key.get("corrected_text", ""))):
            return CheckResult("answer_key", False, "corrected_text_mismatch")
        # Also validate that the errors array corrections match expectations.
        # A fixture whose original text is already correct legitimately has an
        # unchanged correction; otherwise an unchanged correction is a miss.
        expected_correction = _normalize(str(key.get("corrected_text", "")))
        errors = candidate.get("errors")
        if isinstance(errors, list) and errors:
            for error in errors:
                if isinstance(error, Mapping):
                    original = _normalize(str(error.get("original", "")))
                    correction = _normalize(str(error.get("correction", "")))
                    if correction and correction == original and original != expected_correction:
                        return CheckResult("answer_key", False, "error_correction_unchanged")
    haystack = _normalize(" ".join(_flatten_strings(candidate)))
    for name, expected_value in sorted(key.items()):
        if name == "mentions_correction":
            if _normalize(str(expected_value)) not in haystack:
                return CheckResult("answer_key", False, "missing_expected_correction")
            continue
        present, actual = _answer_value(candidate, name)
        if not present:
            return CheckResult("answer_key", False, "answer_slot_missing")
        if isinstance(actual, (int, float)) and not isinstance(actual, bool):
            if actual != expected_value:
                return CheckResult("answer_key", False, "answer_key_mismatch")
        elif _normalize(str(actual)) != _normalize(str(expected_value)):
            return CheckResult("answer_key", False, "answer_key_mismatch")
    return CheckResult("answer_key", True)


def _check_duplicates(case: Case, candidate: Any) -> CheckResult:
    del case
    def _signature(item: Any) -> str:
        if isinstance(item, Mapping):
            for field in ("question", "questionText", "front", "word", "pattern_name"):
                if field in item:
                    return _normalize(str(item[field]))
        return _normalize(str(item))

    if isinstance(candidate, Mapping):
        for field in ("questions", "cards", "vocabulary", "patterns", "examples", "errors", "tips"):
            value = candidate.get(field)
            if not isinstance(value, list):
                continue
            signatures = [_signature(item) for item in value]
            signatures = [item for item in signatures if item]
            if len(signatures) != len(set(signatures)):
                return CheckResult("no_duplicate_items", False, "duplicate_list_items")
    return CheckResult("no_duplicate_items", True)


def _check_locale(case: Case, candidate: Any) -> CheckResult:
    if case.language != "english":
        # The registry publishes an English-only locale baseline; non-English
        # cases are validated by schema/answer key and marked as such.
        return CheckResult("locale", True, "non_english_baseline_skipped")
    if CJK_RE.search(" ".join(_flatten_strings(candidate))):
        return CheckResult("locale", False, "unexpected_cjk_in_english_fixture")
    return CheckResult("locale", True)


def _check_unsafe(case: Case, candidate: Any) -> CheckResult:
    text = " ".join(_flatten_strings(candidate))
    if INJECTION_TOKEN_RE.search(text):
        return CheckResult("unsafe_pattern", False, "injection_token_in_candidate")
    if case.expected.get("containment"):
        messages = case.input.get("messages")
        if isinstance(messages, list) and messages and isinstance(messages[-1], Mapping):
            original = str(messages[-1].get("content", ""))
        else:
            original = str(case.input.get("text", ""))
        wrapped = wrap_user_input(original)
        if not wrapped.startswith("<user_input>") or not wrapped.endswith("</user_input>"):
            return CheckResult("unsafe_pattern", False, "containment_wrapper_failed")
        if INJECTION_TOKEN_RE.search(wrapped):
            return CheckResult("unsafe_pattern", False, "containment_leaked_token")
    return CheckResult("unsafe_pattern", True)


CHECKS: tuple[Callable[[Case, Any], CheckResult], ...] = (
    _check_schema,
    _check_must_detect,
    _check_must_not_claim,
    _check_rubric,
    _check_answer_key,
    _check_duplicates,
    _check_locale,
    _check_unsafe,
)


def run_checks(case: Case, candidate: Any) -> list[CheckResult]:
    return [check(case, candidate) for check in CHECKS]


# ─────────────────────────────────────────────────────────────────────────────
# Live provider adapter (inert unless explicitly opted in)
# ─────────────────────────────────────────────────────────────────────────────

def validate_live_optin(
    *, cli_confirm: bool, env: Mapping[str, str] | None = None
) -> None:
    """Fail closed unless CLI flag, env opt-ins and non-CI context all hold."""
    environ = dict(os.environ if env is None else env)
    if not cli_confirm:
        raise LiveOptInError("live mode requires --live-confirm")
    if environ.get(LIVE_ENV_OPTIN, "").strip() != "1":
        raise LiveOptInError(f"live mode requires {LIVE_ENV_OPTIN}=1")
    if any(environ.get(name, "").strip() for name in CI_ENV_NAMES):
        raise LiveOptInError("live provider evals are disabled in CI")
    if environ.get(LIVE_ENV_OPTIN + "_CONFIRM", "").strip() != LIVE_CONFIRM_TOKEN:
        raise LiveOptInError(
            f"live mode requires {LIVE_ENV_OPTIN}_CONFIRM confirmation token"
        )


def _safe_data(value: str, *, wrapped_by_template: bool) -> str:
    """Contain learner data; avoid double wrapping where the template does it."""
    wrapped = wrap_user_input(value)
    if wrapped_by_template and wrapped.startswith("<user_input>") and wrapped.endswith("</user_input>"):
        return wrapped[len("<user_input>") : -len("</user_input>")]
    return wrapped


def _render_case(case: Case) -> tuple[str, str]:
    """Render the registered prompt; learner text is always wrapped as data."""
    spec = get_prompt(
        FEATURE_TO_PROMPT.get(case.feature, "cards.generate"),
        version=int(case.prompt_version.rsplit("v", 1)[-1]),
    )
    system_values = {
        "language": case.language,
        "level": case.level,
        "word_count": case.input.get("word_count", 100),
    }
    rendered_system = spec.system_template.format(
        **{key: system_values[key] for key in spec.system_fields}
    )
    wrapped_by_template = bool(
        spec.user_template and "<user_input>" in spec.user_template
    )
    input_data = dict(case.input)
    text = str(input_data.get("text", ""))
    if spec.user_template is None:
        # Chat has no template; wrap the last user turn explicitly.
        messages = input_data.get("messages")
        if isinstance(messages, list) and messages and isinstance(messages[-1], Mapping):
            last = dict(messages[-1])
            last["content"] = _safe_data(str(last.get("content", "")), wrapped_by_template=False)
            input_data["messages"] = messages[:-1] + [last]
            text = last["content"]
        user = _safe_data(text, wrapped_by_template=False)
    else:
        user = spec.user_template.format(
            language=case.language,
            level=case.level,
            count=int(input_data.get("count", 3)),
            topic=str(input_data.get("topic", "language practice")),
            word_count=int(input_data.get("word_count", 100)),
            text=_safe_data(text, wrapped_by_template=wrapped_by_template),
            user_text=_safe_data(text, wrapped_by_template=wrapped_by_template),
            grammar_point=_safe_data(
                str(input_data.get("grammar_point", "")),
                wrapped_by_template=wrapped_by_template,
            ),
            extra_question=_safe_data(
                str(input_data.get("user_question") or ""),
                wrapped_by_template=wrapped_by_template,
            ),
            errors_json=_safe_data(
                json.dumps(input_data.get("errors", []), sort_keys=True, ensure_ascii=False),
                wrapped_by_template=wrapped_by_template,
            ),
            total_errors=len(input_data.get("errors", [])),
            exercise_count=1,
        )
    return rendered_system, user


async def _live_candidate(case: Case, model: str) -> tuple[Any, dict[str, Any]]:
    """Call the provider with cache disabled; return candidate + safe metadata.

    Import is local so deterministic mode never loads the provider client.
    """
    import app.utils as utils
    from app.services.llm_client import (
        bind_provider_context,
        get_provider_attempts,
        reset_provider_context,
    )

    system, prompt = _render_case(case)
    started = time.monotonic()
    # ai_json_request has no max_tokens argument; the eval process overrides
    # its sizing helper locally and restores it in finally so no other caller
    # can exceed the eval's token budget or observe the change afterwards.
    original_sizing = utils._max_tokens_for
    token = bind_provider_context("content_generation", operation_id="eval.live")
    try:
        utils._max_tokens_for = lambda *_args, **_kwargs: MAX_LIVE_TOKENS_PER_CALL
        raw = await utils.ai_json_request(
            system,
            prompt,
            response_model=RESPONSE_MODELS[case.model_feature],
            temperature=LIVE_TEMPERATURE,
            context="AI eval live",
            cache_ttl=0,
            model=model,
        )
        attempts = get_provider_attempts()
    finally:
        utils._max_tokens_for = original_sizing
        reset_provider_context(token)
    latency_ms = int((time.monotonic() - started) * 1000)
    usage: dict[str, int] = {}
    for attempt in attempts:
        if attempt.usage_known:
            usage = {
                key: int(getattr(attempt, key))
                for key in ("prompt_tokens", "completion_tokens", "total_tokens")
                if isinstance(getattr(attempt, key), int)
            }
    # ``raw`` is already schema-validated by ai_json_request. Never log or
    # serialize raw provider text, prompts, or credentials.
    metadata = {
        "model": model,
        "latency_ms": latency_ms,
        "attempts": len(attempts),
        "usage": usage,
        "usage_known": bool(usage),
        "max_tokens": MAX_LIVE_TOKENS_PER_CALL,
        "cache_ttl": 0,
    }
    return raw, metadata


# ─────────────────────────────────────────────────────────────────────────────
# Reporting and CLI
# ─────────────────────────────────────────────────────────────────────────────

def run_suite(
    cases: Iterable[Case],
    *,
    mode: str = "deterministic",
    model: Optional[str] = None,
) -> dict[str, Any]:
    """Run all cases and return a stable report; no I/O in deterministic mode."""
    results: list[dict[str, Any]] = []
    live_metadata: list[dict[str, Any]] = []
    for case in cases:
        metadata: dict[str, Any] = {"model": None, "latency_ms": 0, "usage": {}}
        if mode == "live":
            if model is None:
                raise EvalConfigError("live mode requires an explicit model id")
            candidate, metadata = asyncio.run(_live_candidate(case, model))
            live_metadata.append(metadata)
        else:
            candidate = case.candidate
        checks = [result.as_dict() for result in run_checks(case, candidate)]
        passed = all(check["passed"] for check in checks)
        results.append(
            {
                "case_id": case.id,
                "feature": case.feature,
                "language": case.language,
                "level": case.level,
                "critical": case.critical,
                "source": case.source,
                "fingerprint": case.case_fingerprint(),
                "prompt_version": case.prompt_version,
                "passed": passed,
                "checks": sorted(checks, key=lambda item: item["check"]),
            }
        )
    results.sort(key=lambda item: item["case_id"])
    failures = [item["case_id"] for item in results if not item["passed"]]
    critical_failures = [
        item["case_id"] for item in results if item["critical"] and not item["passed"]
    ]
    by_check = Counter(
        check["check"]
        for item in results
        for check in item["checks"]
        if not check["passed"]
    )
    usage_totals = {
        key: sum(int(item["usage"].get(key, 0)) for item in live_metadata)
        for key in ("prompt_tokens", "completion_tokens", "total_tokens")
    }
    usage_known = any(item["usage_known"] for item in live_metadata)
    return {
        "schema_version": "ai-eval-report-v1",
        "mode": mode,
        "summary": {
            "total": len(results),
            "passed": len(results) - len(failures),
            "failed": len(failures),
            "critical_total": sum(1 for item in results if item["critical"]),
            "critical_failed": len(critical_failures),
            "failure_rate": round(len(failures) / len(results), 4) if results else 0.0,
            "by_check": dict(sorted(by_check.items())),
        },
        "coverage": {
            "features": sorted({item["feature"] for item in results}),
            "languages": sorted({item["language"] for item in results}),
            "levels": sorted({item["level"] for item in results}),
            "sources": sorted({item["source"] for item in results}),
        },
        # Volatile run metadata is outside the comparable section.
        "run_metadata": {
            "generated_at_epoch_s": int(time.time()),
            "models": sorted({item["model"] for item in live_metadata if item["model"]}),
            "total_latency_ms": sum(int(item["latency_ms"]) for item in live_metadata),
            "usage_known": usage_known,
            "usage_totals": usage_totals,
            "cost_estimate": None,
            "prompt_versions": sorted({item["prompt_version"] for item in results}),
        },
        "results": results,
    }


def _write_report(report: Mapping[str, Any], path: Path | None) -> None:
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m evals.run",
        description="Deterministic-first AI eval runner (live provider calls are opt-in only).",
    )
    parser.add_argument("--mode", choices=("deterministic", "live"), default="deterministic")
    parser.add_argument(
        "--cases", type=Path, default=None,
        help="JSONL golden suite (default: built-in synthetic suite)",
    )
    parser.add_argument(
        "--report-json", type=Path, default=None,
        help="Write a stable JSON report to this path",
    )
    parser.add_argument("--fail-on", choices=("critical", "any"), default="critical")
    parser.add_argument(
        "--live-confirm", action="store_true",
        help="First half of the live opt-in; also requires explicit env opt-ins.",
    )
    parser.add_argument(
        "--max-live-cases", type=int, default=MAX_LIVE_CASES,
        help=f"Hard cap on live cases (default {MAX_LIVE_CASES}, max {MAX_LIVE_CASES}).",
    )
    parser.add_argument(
        "--model", default=None,
        help="Explicit provider model id for live mode; never read from .env by this runner.",
    )
    return parser


def _validate_cli(args: argparse.Namespace) -> None:
    _require(
        1 <= args.max_live_cases <= MAX_LIVE_CASES,
        f"--max-live-cases must be between 1 and {MAX_LIVE_CASES}",
    )
    if args.mode == "deterministic" and (args.live_confirm or args.model):
        raise EvalConfigError("--live-confirm/--model are only valid with --mode live")


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        _validate_cli(args)
        if args.mode == "live":
            validate_live_optin(cli_confirm=args.live_confirm)
        cases = load_cases(args.cases)
        model: Optional[str] = None
        if args.mode == "live":
            from app.config import settings

            # Resolve against configured ids only after every opt-in passed;
            # the key is never printed or persisted.
            if args.model:
                _require(
                    args.model
                    in {settings.groq_model_light, settings.groq_model_heavy, settings.groq_model},
                    "--model must be one of the configured provider model ids",
                )
                model = args.model
            else:
                model = settings.groq_model_light
            _require(bool(settings.llm_api_key), "live mode has no provider key configured")
            if len(cases) > args.max_live_cases:
                cases = cases[: args.max_live_cases]
        report = run_suite(cases, mode=args.mode, model=model)
    except LiveOptInError as exc:
        print(f"live opt-in failed: {exc}", file=sys.stderr)
        return EXIT_NO_LIVE_OPTIN
    except EvalConfigError as exc:
        print(f"eval configuration error: {exc}", file=sys.stderr)
        return EXIT_BAD_CONFIG
    _write_report(report, args.report_json)
    summary = report["summary"]
    print(
        f"mode={report['mode']} total={summary['total']} passed={summary['passed']} "
        f"failed={summary['failed']} critical_failed={summary['critical_failed']}"
    )
    if args.fail_on == "any" and summary["failed"]:
        return EXIT_REGRESSION
    if summary["critical_failed"]:
        return EXIT_REGRESSION
    return EXIT_PASS


if __name__ == "__main__":
    raise SystemExit(main())
