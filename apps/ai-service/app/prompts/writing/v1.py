"""Writing prompt v1 with rubric version metadata.

Implements AI-01 (Prompt Registry) and AI-04 (Cache design) requirements:
- PromptSpec with prompt_id, versions, rubric_version, schema versions, locale
- Registry with register/get/list_versions for rollback support
- Validated rendering that separates system instructions from user data
- Metadata suitable for cache key composition per roadmap AI-04

This module is self-contained under the single-file constraint. If
app.prompts.registry exists from a parallel slice, it will be preferred.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional


# ---------------------------------------------------------------------------
# Registry primitives (self-contained shim)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ModelConfig:
    """Model role reference and temperature, not hardcoded model ID."""
    model_role: str  # e.g., "groq_model_heavy"
    temperature: float = 0.3


@dataclass(frozen=True)
class PromptSpec:
    """Immutable prompt specification with full version metadata.

    Fields:
        prompt_id: Stable identifier (e.g., "writing.assess")
        prompt_version: Semantic version string (e.g., "v1")
        rubric_version: Rubric contract version (e.g., "writing-rubric-v1")
        input_schema_version: Request schema version
        output_schema_version: Response schema version
        locale: Server-controlled language for instruction text (default "en")
        model_config: Model role + temperature (resolved at call time)
        changelog: Human-readable change description
        system_template: System instruction template (server-validated placeholders only)
        user_template: User prompt template (receives validated language/level
            and wrapped user data as named fields)
    """
    prompt_id: str
    prompt_version: str
    rubric_version: str
    input_schema_version: str
    output_schema_version: str
    locale: str
    model_config: ModelConfig
    changelog: str
    system_template: str
    user_template: str

    def render(
        self,
        language: str,
        level: str,
        user_text_wrapped: str,
    ) -> tuple[str, str]:
        """Render system and user prompts with validated inputs.

        Args:
            language: Server-validated language (from SUPPORTED_LANGUAGES)
            level: Server-validated CEFR level (A1-C2)
            user_text_wrapped: User text already wrapped via wrap_user_input()

        Returns:
            (system_prompt, user_prompt) tuple

        Raises:
            ValueError: If inputs don't match expected patterns
        """
        # Validate language: lowercase, max 32 chars, no injection
        if not re.match(r"^[a-z]{2,32}$", language):
            raise ValueError(f"invalid language: {language!r}")

        # Validate level: CEFR A1-C2
        if not re.match(r"^[A-C][1-2]$", level):
            raise ValueError(f"invalid level: {level!r}")

        # System template: only {language} and {level} placeholders
        system = self.system_template.format(language=language, level=level)

        # User template: {language}, {level} (server-validated) and {user_text}
        # (already wrapped by wrap_user_input). Never interpolate raw user text.
        user = self.user_template.format(
            language=language, level=level, user_text=user_text_wrapped
        )

        return system, user


# Global registry keyed by (prompt_id, prompt_version)
_REGISTRY: dict[tuple[str, str], PromptSpec] = {}
_ACTIVE_VERSIONS: dict[str, str] = {}  # prompt_id -> active prompt_version


def register(spec: PromptSpec) -> None:
    """Register a prompt spec. Rejects duplicate (prompt_id, prompt_version)."""
    key = (spec.prompt_id, spec.prompt_version)
    if key in _REGISTRY:
        raise ValueError(f"duplicate prompt registration: {key}")
    _REGISTRY[key] = spec
    # Mark as active version for this prompt_id
    _ACTIVE_VERSIONS[spec.prompt_id] = spec.prompt_version


def get(prompt_id: str, version: Optional[str] = None) -> PromptSpec:
    """Retrieve a prompt spec by ID and optional version.

    Args:
        prompt_id: Prompt identifier
        version: Specific version, or None for active pinned version

    Returns:
        PromptSpec instance

    Raises:
        KeyError: If prompt not found
    """
    if version is None:
        version = _ACTIVE_VERSIONS.get(prompt_id)
        if version is None:
            raise KeyError(f"no active version for prompt_id={prompt_id!r}")

    key = (prompt_id, version)
    if key not in _REGISTRY:
        raise KeyError(f"prompt not found: {key}")
    return _REGISTRY[key]


def list_versions(prompt_id: str) -> list[str]:
    """List all registered versions for a prompt_id, sorted."""
    versions = [v for (pid, v) in _REGISTRY.keys() if pid == prompt_id]
    return sorted(versions)


# ---------------------------------------------------------------------------
# Writing prompt v1 definition
# ---------------------------------------------------------------------------

WRITING_SYSTEM_TEMPLATE = """You are a strict and experienced {language} language teacher. 
Your task is to assess a student's writing at the {level} level.
You must respond ONLY with valid JSON, no explanations outside of JSON.

Analyze the text and return a JSON object with this exact structure.
The numbers below are examples: replace every score with an integer from 1 to 10
(overall_score may be a decimal from 1.0 to 10.0). Use exactly one of the five
listed error types ("grammar", "spelling", "vocabulary", "punctuation", "style").
{{
  "corrected_text": "the full corrected and improved version of the text, rewritten to meet {level} standards",
  "feedback": "2-3 sentence overall feedback summarizing strengths and areas for improvement",
  "errors": [
    {{
      "type": "grammar",
      "original": "the incorrect text",
      "correction": "the corrected text",
      "explanation": "brief explanation"
    }}
  ],
  "scores": {{
    "grammar": 8,
    "vocabulary": 8,
    "coherence": 8,
    "task_achievement": 8,
    "overall": 8
  }},
  "tips": ["tip 1", "tip 2", "tip 3"],
  "overall_score": 8.0
}}"""

WRITING_USER_TEMPLATE = """Assess the following {language} writing (target level: {level}):

---
{user_text}
---

Remember: respond ONLY with valid JSON following the exact structure specified."""


# Define the writing prompt v1 spec
WRITING_PROMPT_V1 = PromptSpec(
    prompt_id="writing.assess",
    prompt_version="v1",
    rubric_version="writing-rubric-v1",  # Matches WRITING_RUBRIC_VERSIONS in writing.dto.ts
    input_schema_version="v1",
    output_schema_version="v1",
    locale="en",  # English instruction text
    model_config=ModelConfig(
        model_role="groq_model_heavy",
        temperature=0.3,
    ),
    changelog=(
        "v1: Initial registry-based writing prompt. Preserves legacy "
        "writing_prompts.py semantics (WRITING_SYSTEM, WRITING_PROMPT) with "
        "explicit version metadata for cache keys and rubric contract. "
        "System template formats only server-validated {language}/{level}; "
        "user template receives validated {language}/{level} plus wrapped "
        "user_text via named parameters."
    ),
    system_template=WRITING_SYSTEM_TEMPLATE,
    user_template=WRITING_USER_TEMPLATE,
)

# Register on import
register(WRITING_PROMPT_V1)


# ---------------------------------------------------------------------------
# Convenience exports
# ---------------------------------------------------------------------------

__all__ = [
    "PromptSpec",
    "ModelConfig",
    "WRITING_PROMPT_V1",
    "register",
    "get",
    "list_versions",
]
