"""RAG ingestion and retrieval policy (AI-06).

This module defines the contract for licensed document ingestion, chunking,
and retrieval context assembly. It is policy-only: no database, vector store
or LLM dependency. All retrieved text is treated as untrusted data and wrapped
in an explicit envelope before reaching a prompt.

Roadmap requirements:
- Licensed docs only (server-controlled allowlist)
- Version and source metadata on every document and chunk
- Chunk policy with bounds and sanitization
- Citation provenance preserved through retrieval
- Retrieval does not replace schema validation of provider output
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.limits import MAX_CONTEXT_CHARS, MAX_TEXT_CHARS
from app.core.security import sanitize_user_input
from app.models.schemas import (
    SUPPORTED_LANGUAGES,
    StrictModel,
    validate_language,
)

# Server-controlled license allowlist. Only documents with one of these licenses
# may be ingested or retrieved. "all-rights-reserved" and unknown licenses are
# rejected at ingestion time.
ALLOWED_LICENSES = frozenset(
    {
        "owned",  # Platform-owned content
        "cc-by",  # Creative Commons Attribution
        "cc-by-sa",  # Creative Commons Attribution-ShareAlike
        "cc-by-nc",  # Creative Commons Attribution-NonCommercial
        "cc-by-nc-sa",  # Creative Commons Attribution-NonCommercial-ShareAlike
        "cc0",  # Creative Commons Zero (public domain)
        "public-domain",  # Explicit public domain dedication
    }
)

# Chunk bounds. These are hard ceilings; callers may pass smaller values.
MAX_CHUNK_CHARS = 2_000
MAX_CHUNKS_PER_QUERY = 10
MAX_CONTEXT_CHARS_RAG = min(MAX_CONTEXT_CHARS, 8_000)  # RAG context budget

# Schema version for forward compatibility. Bump when the SourceDocument or
# DocumentChunk schema changes in a way that breaks old stored documents.
SCHEMA_VERSION = "v1"


class SourceDocument(StrictModel):
    """Metadata for a licensed source document.

    Every document must declare a source_id, version, schema_version and an
    allowed license. Language is normalized and validated. Level is optional
    (some documents are level-agnostic). Provenance tracks where the document
    came from (URL, file path, manual entry).
    """

    source_id: Annotated[str, Field(min_length=1, max_length=200)]
    version: Annotated[str, Field(min_length=1, max_length=50)]
    schema_version: Annotated[str, Field(min_length=1, max_length=20)] = SCHEMA_VERSION
    license: Annotated[str, Field(min_length=1, max_length=50)]
    language: Annotated[str, Field(min_length=1, max_length=32)]
    level: Annotated[Optional[str], Field(max_length=10)] = None
    provenance: Annotated[Optional[str], Field(max_length=500)] = None
    ingested_at: datetime = Field(default_factory=datetime.utcnow)

    @field_validator("license")
    @classmethod
    def validate_license(cls, v: str) -> str:
        """Reject licenses not in the server-controlled allowlist."""
        normalized = v.strip().lower()
        if normalized not in ALLOWED_LICENSES:
            raise ValueError(
                f"license '{normalized}' not in allowed set: {sorted(ALLOWED_LICENSES)}"
            )
        return normalized

    @field_validator("language")
    @classmethod
    def normalize_language(cls, v: str) -> str:
        """Normalize and validate the document language."""
        return validate_language(v)

    @field_validator("level")
    @classmethod
    def validate_level(cls, v: Optional[str]) -> Optional[str]:
        """Validate CEFR level if provided."""
        if v is None:
            return None
        normalized = v.strip().upper()
        if normalized not in {"A1", "A2", "B1", "B2", "C1", "C2"}:
            raise ValueError("level must be a valid CEFR level (A1-C2)")
        return normalized

    @model_validator(mode="after")
    def check_schema_version(self) -> "SourceDocument":
        """Warn if schema_version doesn't match current (logged by caller)."""
        # Policy: accept old versions but flag them for migration.
        return self


class DocumentChunk(StrictModel):
    """A sanitized, bounded chunk of a source document.

    Every chunk inherits the document's license, version and language. The text
    is sanitized and bounded. Provenance includes section/page/offset for
    citation. Chunks are untrusted data and must be wrapped before use in a
    prompt.
    """

    document_id: Annotated[str, Field(min_length=1, max_length=200)]
    document_version: Annotated[str, Field(min_length=1, max_length=50)]
    license: Annotated[str, Field(min_length=1, max_length=50)]
    language: Annotated[str, Field(min_length=1, max_length=32)]
    level: Annotated[Optional[str], Field(max_length=10)] = None
    text: Annotated[str, Field(min_length=1, max_length=MAX_CHUNK_CHARS)]
    section: Annotated[Optional[str], Field(max_length=200)] = None
    page: Annotated[Optional[int], Field(ge=1)] = None
    offset: Annotated[Optional[int], Field(ge=0)] = None
    chunk_id: Annotated[str, Field(min_length=1, max_length=100)]

    @field_validator("license")
    @classmethod
    def validate_license(cls, v: str) -> str:
        """Reject licenses not in the server-controlled allowlist."""
        normalized = v.strip().lower()
        if normalized not in ALLOWED_LICENSES:
            raise ValueError(f"license '{normalized}' not allowed")
        return normalized

    @field_validator("language")
    @classmethod
    def normalize_language(cls, v: str) -> str:
        """Normalize and validate the chunk language."""
        return validate_language(v)

    @field_validator("text")
    @classmethod
    def sanitize_and_bound_text(cls, v: str) -> str:
        """Sanitize the chunk text and enforce the hard character limit."""
        sanitized = sanitize_user_input(v, max_length=MAX_CHUNK_CHARS)
        if not sanitized.strip():
            raise ValueError("chunk text is empty after sanitization")
        return sanitized

    @field_validator("level")
    @classmethod
    def validate_level(cls, v: Optional[str]) -> Optional[str]:
        """Validate CEFR level if provided."""
        if v is None:
            return None
        normalized = v.strip().upper()
        if normalized not in {"A1", "A2", "B1", "B2", "C1", "C2"}:
            raise ValueError("level must be a valid CEFR level (A1-C2)")
        return normalized


def validate_chunk(chunk_data: dict) -> DocumentChunk:
    """Validate and sanitize a chunk from raw dict data.

    This is the ingestion entry point. It applies all policy checks: license
    allowlist, language validation, text sanitization and bounds. Raises
    pydantic.ValidationError on failure.
    """
    return DocumentChunk.model_validate(chunk_data)


def build_retrieval_context(
    chunks: list[DocumentChunk],
    *,
    target_language: Optional[str] = None,
    max_chars: int = MAX_CONTEXT_CHARS_RAG,
) -> str:
    """Assemble a bounded retrieval context from validated chunks.

    Filters chunks by language (if target_language is provided), wraps each
    chunk in a citation envelope, and respects the total character budget.
    Returns an empty string if no chunks survive filtering or the budget is
    exhausted.

    The returned text is untrusted data wrapped in <retrieved_context> tags.
    It must not be interpreted as instructions by the model.
    """
    if not chunks:
        return ""

    # Bound the number of chunks to prevent abuse.
    bounded_chunks = chunks[:MAX_CHUNKS_PER_QUERY]

    # Filter by language if specified.
    if target_language:
        normalized_target = validate_language(target_language)
        bounded_chunks = [
            c for c in bounded_chunks if c.language == normalized_target
        ]

    if not bounded_chunks:
        return ""

    # Build the context with citation envelopes, respecting the budget.
    context_parts = []
    total_chars = 0
    envelope_overhead = len("<retrieved_context>\n\n</retrieved_context>")

    for chunk in bounded_chunks:
        # Build citation line.
        citation_parts = [f"source={chunk.document_id}"]
        if chunk.document_version:
            citation_parts.append(f"version={chunk.document_version}")
        if chunk.section:
            citation_parts.append(f"section={chunk.section}")
        if chunk.page is not None:
            citation_parts.append(f"page={chunk.page}")
        citation = ", ".join(citation_parts)

        # Wrap the chunk text with citation.
        wrapped = f"[{citation}]\n{chunk.text}"
        chunk_len = len(wrapped)

        # Check if adding this chunk would exceed the budget.
        if total_chars + chunk_len + envelope_overhead > max_chars:
            # Budget exhausted; stop here.
            break

        context_parts.append(wrapped)
        total_chars += chunk_len

    if not context_parts:
        return ""

    # Assemble the final context envelope.
    context_body = "\n\n".join(context_parts)
    return f"<retrieved_context>\n{context_body}\n</retrieved_context>"


def select_latest_version(chunks: list[DocumentChunk]) -> list[DocumentChunk]:
    """Select the latest version of each document from a chunk list.

    When multiple versions of the same document are present, keep only the
    chunks from the highest version (lexicographic comparison). This prevents
    outdated content from polluting retrieval results.
    """
    if not chunks:
        return []

    # Group by document_id.
    by_doc: dict[str, list[DocumentChunk]] = {}
    for chunk in chunks:
        by_doc.setdefault(chunk.document_id, []).append(chunk)

    # For each document, select the highest version.
    result = []
    for doc_chunks in by_doc.values():
        max_version = max(c.document_version for c in doc_chunks)
        result.extend(c for c in doc_chunks if c.document_version == max_version)

    return result


__all__ = [
    "ALLOWED_LICENSES",
    "DocumentChunk",
    "MAX_CHUNK_CHARS",
    "MAX_CHUNKS_PER_QUERY",
    "MAX_CONTEXT_CHARS_RAG",
    "SCHEMA_VERSION",
    "SourceDocument",
    "build_retrieval_context",
    "select_latest_version",
    "validate_chunk",
]
