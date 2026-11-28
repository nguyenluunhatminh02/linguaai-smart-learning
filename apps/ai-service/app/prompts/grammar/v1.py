"""Grammar explanation prompt v1 with prompt-registry metadata.

Implements AI-01 (Prompt Registry) for the grammar explain feature:

* stable ``prompt_id``/``version`` plus input/output schema versions, locale,
  changelog and a model selector (``light``, resolved by the caller via
  ``settings.groq_model_light``);
* versioned ``register``/``resolve_prompt`` helpers with duplicate detection and
  rollback support;
* strict rendering: ``render_system`` formats only the server-allowlisted
  ``{language}`` field, and ``render_user`` formats only a fixed set of named
  keys. Learner text is passed in already wrapped by ``wrap_user_input`` and is
  never treated as a format template.

This module is self-contained under the single-file slice constraint: templates
are byte-for-byte copies of the original ``grammar_prompts.py`` templates and
the local registry keeps registration working in isolation. If the shared
``app.prompts.registry`` from a parallel slice becomes the project-wide source
of truth, this module can be reduced to a thin re-export of that spec.
"""

from __future__ import annotations

import string
from dataclasses import dataclass, field
from typing import Optional


# ---------------------------------------------------------------------------
# Registry primitives (self-contained fallback)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ModelConfig:
    """Model selection metadata; the concrete model id is resolved at call time."""

    model_alias: str = "light"
    temperature: float = 0.5

    def __post_init__(self) -> None:
        if self.model_alias not in ("light", "heavy"):
            raise ValueError("unknown model alias")
        if not 0.0 <= self.temperature <= 1.0:
            raise ValueError("temperature out of range")


@dataclass(frozen=True)
class PromptSpec:
    """Immutable description of one published grammar prompt version."""

    prompt_id: str
    version: str
    input_schema_version: str
    output_schema_version: str
    locale: str
    changelog: tuple[str, ...]
    model_config: ModelConfig
    system_template: str
    user_template: str
    system_fields: frozenset[str] = field(default_factory=frozenset)
    user_fields: frozenset[str] = field(default_factory=frozenset)
    response_model: str = "GrammarExplainResponse"
    context: str = "Grammar explanation"

    def __post_init__(self) -> None:
        if not self.prompt_id or not self.version or not self.changelog:
            raise ValueError("prompt spec requires id, version and changelog")
        if not self.system_fields:
            object.__setattr__(
                self, "system_fields", frozenset(_fields(self.system_template))
            )
        if not self.user_fields:
            object.__setattr__(self, "user_fields", frozenset(_fields(self.user_template)))
        if _fields(self.system_template) != set(self.system_fields):
            raise ValueError("system template fields do not match allowlist")
        if _fields(self.user_template) != set(self.user_fields):
            raise ValueError("user template fields do not match allowlist")

    @property
    def key(self) -> tuple[str, str]:
        return (self.prompt_id, self.version)

    def metadata(self) -> dict[str, object]:
        """Provenance suitable for result metadata and cache key composition."""
        return {
            "prompt_id": self.prompt_id,
            "prompt_version": self.version,
            "schema_version": self.output_schema_version,
            "input_schema_version": self.input_schema_version,
            "output_schema_version": self.output_schema_version,
            "locale": self.locale,
            "model_alias": self.model_config.model_alias,
            "temperature": self.model_config.temperature,
            "context": self.context,
            "response_model": self.response_model,
        }


def _fields(template: str) -> set[str]:
    return {
        name
        for _, name, _, _ in string.Formatter().parse(template)
        if name is not None
    }


_REGISTRY: dict[tuple[str, str], PromptSpec] = {}
_ACTIVE_VERSIONS: dict[str, str] = {}


def register(spec: PromptSpec) -> PromptSpec:
    """Register a spec; a duplicate ``(prompt_id, version)`` is rejected."""
    if spec.key in _REGISTRY:
        raise ValueError(f"duplicate prompt registration: {spec.key}")
    _REGISTRY[spec.key] = spec
    current = _ACTIVE_VERSIONS.get(spec.prompt_id)
    if current is None or _version_tuple(spec.version) >= _version_tuple(current):
        _ACTIVE_VERSIONS[spec.prompt_id] = spec.version
    return spec


def _version_tuple(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in version.lstrip("v").split(".") if part.isdigit())


def resolve_prompt(prompt_id: str, version: Optional[str] = None) -> PromptSpec:
    """Resolve a spec by id and optional version; unknown keys fail closed."""
    resolved_version = version or _ACTIVE_VERSIONS.get(prompt_id)
    if resolved_version is None:
        raise KeyError(f"no active version for prompt_id={prompt_id!r}")
    try:
        return _REGISTRY[(prompt_id, resolved_version)]
    except KeyError:
        raise KeyError(f"prompt not found: {(prompt_id, resolved_version)!r}") from None


def get(prompt_id: str, version: Optional[str] = None) -> PromptSpec:
    """Backwards-compatible alias for :func:`resolve_prompt`."""
    return resolve_prompt(prompt_id, version)


def list_versions(prompt_id: str) -> list[str]:
    """List all registered versions of a prompt id."""
    return sorted(
        (version for (pid, version) in _REGISTRY if pid == prompt_id),
        key=_version_tuple,
    )


# ---------------------------------------------------------------------------
# v1 templates — verbatim copies of the original grammar_prompts.py templates
# ---------------------------------------------------------------------------

GRAMMAR_SYSTEM = """You are a patient and knowledgeable {language} grammar teacher.
Explain grammar concepts clearly with examples, suitable for language learners.
You must respond ONLY with valid JSON, no explanations outside of JSON.

Return a JSON object with this exact structure:
{{
  "point": "the grammar point name",
  "explanation": "clear, detailed explanation with rules",
  "examples": [
    "Example sentence 1 — with translation/note",
    "Example sentence 2 — with translation/note",
    "Example sentence 3 — with translation/note"
  ],
  "practice_exercises": [
    {{
      "question": "Fill in the blank: She ___ (go) to school yesterday.",
      "answer": "went"
    }},
    {{
      "question": "Fill in the blank: They ___ (live) here since 2020.",
      "answer": "have lived"
    }},
    {{
      "question": "Fill in the blank: By the time we arrived, the film ___ (start).",
      "answer": "had started"
    }}
  ]
}}"""

GRAMMAR_PROMPT = """Explain the following {language} grammar point: "{grammar_point}"
{extra_question}
Provide a clear explanation, at least 3 examples, and 3 practice exercises.

Remember: respond ONLY with valid JSON following the exact structure specified."""


# ---------------------------------------------------------------------------
# Published spec
# ---------------------------------------------------------------------------

GRAMMAR_EXPLAIN_V1 = PromptSpec(
    prompt_id="grammar.explain",
    version="v1",
    input_schema_version="GrammarExplainRequest@1",
    output_schema_version="GrammarExplainResponse@1",
    locale="en",
    changelog=(
        "v1: initial registry snapshot of the existing grammar explanation "
        "templates; adds versioned input/output schema metadata.",
    ),
    model_config=ModelConfig(model_alias="light", temperature=0.5),
    system_template=GRAMMAR_SYSTEM,
    user_template=GRAMMAR_PROMPT,
    system_fields=frozenset({"language"}),
    user_fields=frozenset({"language", "grammar_point", "extra_question"}),
    response_model="GrammarExplainResponse",
    context="Grammar explanation",
)

register(GRAMMAR_EXPLAIN_V1)


# ---------------------------------------------------------------------------
# Strict render helpers
# ---------------------------------------------------------------------------


def _validated_language(language: str) -> str:
    """Accept only canonical allowlisted language codes in the system role."""
    from app.models.schemas import validate_language

    return validate_language(language)


def render_system(language: str, spec: Optional[PromptSpec] = None) -> str:
    """Render the system instruction; only a server-validated language is used."""
    active = spec or GRAMMAR_EXPLAIN_V1
    return active.system_template.format(language=_validated_language(language))


def render_user(
    language: str,
    grammar_point: str,
    extra_question: str = "",
    spec: Optional[PromptSpec] = None,
) -> str:
    """Render user data via fixed named keys, never as a format template."""
    active = spec or GRAMMAR_EXPLAIN_V1
    return active.user_template.format(
        language=_validated_language(language),
        grammar_point=grammar_point,
        extra_question=extra_question,
    )


def render(
    language: str,
    grammar_point: str,
    extra_question: str = "",
    *,
    version: Optional[str] = None,
) -> tuple[str, str]:
    """Render both roles from a resolved spec, with fixed allowlisted fields."""
    active = resolve_prompt("grammar.explain", version)
    return (
        render_system(language, active),
        render_user(language, grammar_point, extra_question, active),
    )


__all__ = [
    "ModelConfig",
    "PromptSpec",
    "GRAMMAR_SYSTEM",
    "GRAMMAR_PROMPT",
    "GRAMMAR_EXPLAIN_V1",
    "register",
    "resolve_prompt",
    "get",
    "list_versions",
    "render_system",
    "render_user",
    "render",
]
