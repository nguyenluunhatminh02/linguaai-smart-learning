"""PostgreSQL full-text retrieval service for RAG (Retrieval-Augmented Generation).

This module implements document retrieval using PostgreSQL's native full-text search
capabilities (tsvector + GIN index). It provides a read-only interface for fetching
relevant document chunks based on semantic similarity to a query.

Security considerations:
- Retrieved documents are treated as untrusted data
- All text is sanitized before use in prompts
- Database access is read-only with connection pooling
- Query parameters are validated and bounded

The service lazy-imports asyncpg to avoid hard dependency on the driver when
retrieval is not configured. Deployment requires:
1. A PostgreSQL database with document chunks table (schema owned by apps/api)
2. RETRIEVAL_DATABASE_URL environment variable configured
3. asyncpg added to requirements.txt (or use psycopg2 as fallback)
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any, Optional

from app.core.exceptions import (
    InternalErrorException,
    ProviderUnavailableException,
    ValidationException,
)
from app.core.security import sanitize_user_input

logger = logging.getLogger(__name__)


def _is_connection_error(exc: Exception) -> bool:
    """Classify driver errors without depending on a specific driver package.

    asyncpg raises ``PostgresConnectionError`` / ``InterfaceError`` for broken
    pools; a pool swap should not be able to turn a 503 into a 500. Detection
    uses the exception class hierarchy rather than string matching on the
    message so an attacker-controlled message cannot change the mapping.
    """
    names = {cls.__name__ for cls in type(exc).__mro__}
    return bool(
        names
        & {
            "ConnectionError",
            "ConnectionDoesNotExistError",
            "ConnectionFailure",
            "InterfaceError",
            "PoolTimeoutError",
            "PostgresConnectionError",
        }
    )


# --- Configuration --------------------------------------------------------------

# Maximum number of document chunks to retrieve per query
MAX_RETRIEVAL_RESULTS = 10
# Hard ceiling to prevent unbounded result sets
MAX_RETRIEVAL_RESULTS_CEILING = 50
# Minimum similarity score (0.0 to 1.0) for a chunk to be considered relevant
MIN_SIMILARITY_THRESHOLD = 0.1
# Maximum query length in characters
MAX_QUERY_CHARS = 1000
# Default PostgreSQL text search configuration
DEFAULT_TS_CONFIG = "english"


@dataclass(frozen=True)
class RetrievedChunk:
    """A single retrieved document chunk with metadata.

    All fields are treated as untrusted data. Callers must sanitize text before
    using it in prompts or displaying it to users.
    """

    chunk_id: str
    document_id: str
    content: str
    source: str
    version: str
    similarity: float
    metadata: dict[str, Any]

    def __post_init__(self) -> None:
        """Validate retrieved chunk fields."""
        if not self.chunk_id or not isinstance(self.chunk_id, str):
            raise ValueError("chunk_id must be a non-empty string")
        if not self.document_id or not isinstance(self.document_id, str):
            raise ValueError("document_id must be a non-empty string")
        if not isinstance(self.content, str):
            raise ValueError("content must be a string")
        if not isinstance(self.source, str):
            raise ValueError("source must be a string")
        if not isinstance(self.version, str):
            raise ValueError("version must be a string")
        if not isinstance(self.similarity, (int, float)):
            raise ValueError("similarity must be a number")
        if not 0.0 <= self.similarity <= 1.0:
            raise ValueError("similarity must be between 0.0 and 1.0")
        if not isinstance(self.metadata, dict):
            raise ValueError("metadata must be a dict")


class RetrievalService:
    """PostgreSQL full-text search retrieval service.

    Provides read-only access to document chunks via full-text search. The service
    is designed to be dependency-injected so tests can supply a mock database
    connection.

    Usage:
        service = RetrievalService()
        chunks = await service.retrieve("how do I learn vocabulary", limit=5)
    """

    def __init__(self, database_url: Optional[str] = None):
        """Initialize the retrieval service.

        Args:
            database_url: PostgreSQL connection URL. If not provided, reads from
                         RETRIEVAL_DATABASE_URL environment variable. The URL must
                         point to a read-only replica or use read-only credentials.
        """
        self._database_url = database_url or os.getenv("RETRIEVAL_DATABASE_URL")
        self._pool: Optional[Any] = None
        self._ts_config = os.getenv("RETRIEVAL_TS_CONFIG", DEFAULT_TS_CONFIG)

    async def _get_pool(self) -> Any:
        """Lazily initialize and return the connection pool.

        Returns:
            asyncpg.Pool or compatible connection pool

        Raises:
            ProviderUnavailableException: If database URL is not configured or
                                        connection fails.
        """
        if self._pool is not None:
            return self._pool

        if not self._database_url:
            logger.warning("Retrieval database URL is not configured")
            raise ProviderUnavailableException(
                "Retrieval service is not configured"
            )

        try:
            # Lazy import to avoid hard dependency when retrieval is not used
            import asyncpg

            self._pool = await asyncpg.create_pool(
                self._database_url,
                min_size=1,
                max_size=5,
                command_timeout=10,
                statement_cache_size=0,  # Disable cache for read-only queries
            )
            logger.info("Retrieval database connection pool initialized")
            return self._pool
        except ImportError:
            logger.error(
                "asyncpg is not installed. Add it to requirements.txt or use "
                "an alternative PostgreSQL driver."
            )
            raise ProviderUnavailableException(
                "Retrieval service dependencies are not installed"
            )
        except Exception as e:
            logger.error("Failed to connect to retrieval database: %s", e)
            raise ProviderUnavailableException(
                "Retrieval database is unavailable"
            )

    async def close(self) -> None:
        """Close the connection pool gracefully."""
        if self._pool is not None:
            try:
                await self._pool.close()
                logger.info("Retrieval database connection pool closed")
            except Exception as e:
                logger.warning("Error closing retrieval database pool: %s", e)
            finally:
                self._pool = None

    def _validate_query(self, query: str) -> str:
        """Validate and sanitize the retrieval query.

        Args:
            query: Raw user query text

        Returns:
            Sanitized query string

        Raises:
            ValidationException: If query is empty or exceeds length limit
        """
        if not query or not isinstance(query, str):
            raise ValidationException("Query must be a non-empty string")

        # Sanitize and bound the query
        sanitized = sanitize_user_input(query, max_length=MAX_QUERY_CHARS)
        if not sanitized.strip():
            raise ValidationException("Query must contain valid text")

        return sanitized

    def _clamp_limit(self, limit: Optional[int]) -> int:
        """Clamp the result limit to valid bounds.

        Args:
            limit: Requested number of results

        Returns:
            Clamped limit value
        """
        if limit is None:
            return MAX_RETRIEVAL_RESULTS
        try:
            value = int(limit)
        except (TypeError, ValueError):
            return MAX_RETRIEVAL_RESULTS
        return max(1, min(value, MAX_RETRIEVAL_RESULTS_CEILING))

    async def retrieve(
        self,
        query: str,
        *,
        limit: Optional[int] = None,
        min_similarity: Optional[float] = None,
        filters: Optional[dict[str, Any]] = None,
    ) -> list[RetrievedChunk]:
        """Retrieve relevant document chunks for a query.

        Uses PostgreSQL full-text search with ts_rank to find and rank document
        chunks by relevance. The query is sanitized and bounded before use.

        Args:
            query: User query text (will be sanitized)
            limit: Maximum number of chunks to return (default: 10, max: 50)
            min_similarity: Minimum similarity threshold (default: 0.1)
            filters: Optional filters (e.g., {"source": "textbook", "version": "v2"})

        Returns:
            List of RetrievedChunk objects sorted by similarity (descending)

        Raises:
            ValidationException: If query is invalid
            ProviderUnavailableException: If database is unavailable
            InternalErrorException: If query execution fails
        """
        sanitized_query = self._validate_query(query)
        result_limit = self._clamp_limit(limit)
        similarity_threshold = (
            min_similarity
            if min_similarity is not None
            else MIN_SIMILARITY_THRESHOLD
        )

        if not 0.0 <= similarity_threshold <= 1.0:
            raise ValidationException("min_similarity must be between 0.0 and 1.0")

        # Validate filter values before building the parameterized query. Only
        # bounded text values are accepted for text columns; the SQL itself is
        # parameterized so values can never be interpreted as SQL syntax.
        safe_filters: dict[str, str] = {}
        for key, value in (filters or {}).items():
            if key not in ("source", "version"):
                continue
            if not isinstance(value, str) or not value.strip():
                raise ValidationException(
                    "retrieval filters must contain non-empty strings"
                )
            safe_filters[key] = sanitize_user_input(value, max_length=200)

        pool = await self._get_pool()

        try:
            async with pool.acquire() as conn:
                # Build the full-text search query
                # Using plainto_tsquery for natural language queries
                # ts_rank_cd for coverage-based ranking (better for phrases)
                sql = """
                    SELECT
                        id,
                        document_id,
                        content,
                        source,
                        version,
                        ts_rank_cd(
                            to_tsvector($1, content),
                            plainto_tsquery($1, $2),
                            32  -- normalization flag: rank / (rank + 1)
                        ) AS similarity,
                        metadata
                    FROM document_chunks
                    WHERE to_tsvector($1, content) @@ plainto_tsquery($1, $2)
                      AND ts_rank_cd(
                          to_tsvector($1, content),
                          plainto_tsquery($1, $2),
                          32
                      ) >= $3
                """

                params: list[Any] = [
                    self._ts_config,
                    sanitized_query,
                    similarity_threshold,
                ]

                # Add optional filters (parameterized, never interpolated)
                if "source" in safe_filters:
                    sql += " AND source = $4"
                    params.append(safe_filters["source"])
                if "version" in safe_filters:
                    sql += f" AND version = ${len(params) + 1}"
                    params.append(safe_filters["version"])

                sql += f" ORDER BY similarity DESC LIMIT ${len(params) + 1}"
                params.append(result_limit)

                rows = await conn.fetch(sql, *params)

                chunks = []
                for row in rows:
                    try:
                        chunk = RetrievedChunk(
                            chunk_id=str(row["id"]),
                            document_id=str(row["document_id"]),
                            content=str(row["content"]),
                            source=str(row["source"]),
                            version=str(row["version"]),
                            similarity=float(row["similarity"]),
                            metadata=dict(row["metadata"]) if row["metadata"] else {},
                        )
                        chunks.append(chunk)
                    except (ValueError, KeyError) as e:
                        logger.warning(
                            "Skipping malformed chunk row %s: %s", row.get("id"), e
                        )
                        continue

                logger.info(
                    "Retrieved %d chunks for query (limit=%d, threshold=%.2f)",
                    len(chunks),
                    result_limit,
                    similarity_threshold,
                )
                return chunks

        except (ProviderUnavailableException, ValidationException):
            raise
        except Exception as e:
            # Log the driver error class for diagnostics, but map it to fixed
            # client-safe errors. Never echo exception text to the caller.
            logger.error("Retrieval query failed (%s): %s", type(e).__name__, e)
            if _is_connection_error(e):
                raise ProviderUnavailableException(
                    "Retrieval database connection failed"
                )
            raise InternalErrorException("Retrieval operation failed")

    async def health_check(self) -> bool:
        """Check if the retrieval database is accessible.

        Returns:
            True if database is reachable, False otherwise
        """
        try:
            pool = await self._get_pool()
            async with pool.acquire() as conn:
                await conn.fetchval("SELECT 1")
            return True
        except Exception as e:
            logger.warning("Retrieval health check failed: %s", e)
            return False


# Module-level singleton for dependency injection
retrieval_service = RetrievalService()


__all__ = [
    "RetrievedChunk",
    "RetrievalService",
    "retrieval_service",
    "MAX_RETRIEVAL_RESULTS",
    "MAX_RETRIEVAL_RESULTS_CEILING",
    "MIN_SIMILARITY_THRESHOLD",
    "MAX_QUERY_CHARS",
]
