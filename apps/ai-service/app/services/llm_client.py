"""Provider client with feature-aware timeouts, bounded retries and attempt metadata.

The public surface (``LLMClient.generate/chat/generate_stream/chat_stream/
health_check/close`` and the module-level ``llm_client``) is unchanged. Callers
may bind a feature for the current context with :func:`bind_provider_context`
and reset it with :func:`reset_provider_context`; when they do not, the client
infers a feature from the request shape (chat messages, stream mode, etc.).

Attempt metadata is context-local and emitted as structured log fields. It
never contains prompts, raw exception text, response bodies, headers or keys.
"""

import asyncio
import contextvars
import json
import logging
import time
from dataclasses import dataclass
from typing import Any, AsyncGenerator, Mapping, Optional
from urllib.parse import urlsplit

import anyio
import httpx

from app.config import settings

logger = logging.getLogger(__name__)

# Hard ceiling on streamed response size to prevent unbounded memory use from
# a misbehaving upstream. 2 MB of SSE text is far beyond any legitimate
# completion and catches runaway streams before they exhaust the process.
_MAX_STREAM_BYTES = 2 * 1024 * 1024
# Hard ceiling on max_tokens accepted from callers, regardless of what they
# request. Prevents a single caller from driving unbounded provider cost.
_MAX_TOKENS_CEILING = 8192

# Policy settings are deliberately staging values, not measured SLOs. They can
# be tuned when provider latency percentiles are available.
_POLICY_VERSION = "rel-03.1"
_DEFAULT_CONNECT_TIMEOUT = 10.0
_DEFAULT_WRITE_TIMEOUT = 10.0
_DEFAULT_POOL_TIMEOUT = 10.0
_RETRYABLE_STATUSES = frozenset({429, 502, 503, 504})
_MAX_RETRY_AFTER_S = 30.0
_BACKOFF_BASE_S = 1.0
_BACKOFF_CAP_S = 8.0
_JITTER = 0.1


@dataclass(frozen=True)
class FeaturePolicy:
    """Per-feature network budgets and retry limits for provider calls."""

    feature: str
    connect_timeout_s: float
    read_timeout_s: float
    write_timeout_s: float
    pool_timeout_s: float
    overall_timeout_s: float
    max_attempts: int
    backoff_base_s: float = _BACKOFF_BASE_S
    backoff_cap_s: float = _BACKOFF_CAP_S
    jitter: float = _JITTER
    retryable_statuses: frozenset[int] = _RETRYABLE_STATUSES
    retry_stream_before_first_token: bool = True

    def http_timeout(self) -> httpx.Timeout:
        return httpx.Timeout(
            connect=self.connect_timeout_s,
            read=self.read_timeout_s,
            write=self.write_timeout_s,
            pool=self.pool_timeout_s,
        )


def _default_read_timeout() -> float:
    try:
        return float(settings.request_timeout)
    except (TypeError, ValueError):
        return 60.0


def _policy(
    feature: str,
    *,
    read: Optional[float] = None,
    overall: Optional[float] = None,
    attempts: int = 3,
) -> FeaturePolicy:
    read_timeout = _default_read_timeout() if read is None else read
    return FeaturePolicy(
        feature=feature,
        connect_timeout_s=_DEFAULT_CONNECT_TIMEOUT,
        read_timeout_s=read_timeout,
        write_timeout_s=_DEFAULT_WRITE_TIMEOUT,
        pool_timeout_s=_DEFAULT_POOL_TIMEOUT,
        # An unbounded overall budget would defeat the point of a wall-clock
        # deadline; derive one from the read budget when a feature omits it.
        overall_timeout_s=max(read_timeout, 10.0) if overall is None else overall,
        max_attempts=attempts,
    )


_FEATURE_POLICIES: dict[str, FeaturePolicy] = {
    "default": _policy("default"),
    "chat": _policy("chat", read=30.0, overall=60.0, attempts=3),
    "chat_stream": FeaturePolicy(
        feature="chat_stream",
        connect_timeout_s=5.0,
        read_timeout_s=15.0,
        write_timeout_s=10.0,
        pool_timeout_s=10.0,
        overall_timeout_s=90.0,
        max_attempts=2,
        retry_stream_before_first_token=True,
    ),
    "content_generation": _policy(
        "content_generation", read=60.0, overall=180.0, attempts=2
    ),
    "grammar": _policy("grammar", read=45.0, overall=120.0, attempts=2),
    "writing_feedback": _policy(
        "writing_feedback", read=45.0, overall=120.0, attempts=2
    ),
    "health": _policy("health", read=10.0, overall=15.0, attempts=1),
}


def policy_for(feature: Optional[str]) -> FeaturePolicy:
    """Return the policy for ``feature``, falling back to current defaults."""
    if not feature:
        return _FEATURE_POLICIES["default"]
    return _FEATURE_POLICIES.get(feature.strip().lower(), _FEATURE_POLICIES["default"])


def policy_version() -> str:
    return _POLICY_VERSION


def feature_for_context(context: Optional[str]) -> str:
    """Map a caller-supplied context label (e.g. "Quiz generation") to a feature."""
    if not context:
        return "default"
    lowered = context.strip().lower()
    features = (
        "chat_stream",
        "content_generation",
        "writing_feedback",
        "grammar",
        "health",
        "chat",
        "default",
    )
    for feature in features:
        if feature in lowered:
            return feature
    labels = {
        "card generation": "content_generation",
        "quiz generation": "content_generation",
        "reading generation": "content_generation",
        "writing assessment": "writing_feedback",
        "grammar explanation": "grammar",
        "error analysis": "grammar",
        "nlp analysis": "grammar",
        "ai request": "default",
    }
    return labels.get(lowered, "default")


@dataclass(frozen=True)
class ProviderAttemptMetadata:
    """Safe, structured record of one provider attempt.

    ``provider`` is a host name only: credentials and paths are excluded.
    ``error_type`` is a class name only: exception messages may contain
    prompts, headers or other sensitive upstream data.
    """

    attempt: int
    feature: str
    provider: str
    model: str
    mode: str
    operation_id: Optional[str] = None
    request_id: Optional[str] = None
    policy_version: str = _POLICY_VERSION
    started_at_ms: int = 0
    duration_ms: int = 0
    outcome: str = "terminal_failure"
    status_code: Optional[int] = None
    error_type: Optional[str] = None
    retryable: bool = False
    ttft_ms: Optional[int] = None
    partial_tokens: int = 0
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    total_tokens: Optional[int] = None
    usage_known: bool = False

    def as_log_fields(self) -> dict[str, Any]:
        return {
            "provider_attempt": {
                key: value for key, value in vars(self).items() if value is not None
            }
        }


_provider_feature_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "provider_feature", default=None
)
_provider_operation_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "provider_operation_id", default=None
)
_provider_attempts_var: contextvars.ContextVar[tuple[ProviderAttemptMetadata, ...]] = (
    contextvars.ContextVar("provider_attempts", default=())
)
_last_stream_usage_var: contextvars.ContextVar[Optional[dict[str, int]]] = (
    contextvars.ContextVar("last_stream_usage", default=None)
)


@dataclass(frozen=True)
class _ProviderContextToken:
    feature: Any
    operation: Any
    attempts: Any
    usage: Any


def bind_provider_context(
    feature: Optional[str],
    operation_id: Optional[str] = None,
    request_id: Optional[str] = None,
) -> _ProviderContextToken:
    """Bind a feature for the current context; reset the returned token in finally.

    ``request_id`` is intentionally accepted for API symmetry with the roadmap:
    the existing request-id contextvar remains the single source of truth so
    values cannot drift between subsystems.
    """
    return _ProviderContextToken(
        feature=_provider_feature_var.set(feature),
        operation=_provider_operation_var.set(operation_id),
        attempts=_provider_attempts_var.set(()),
        usage=_last_stream_usage_var.set(None),
    )


def reset_provider_context(token: Optional[_ProviderContextToken]) -> None:
    if token is None:
        return
    _provider_feature_var.reset(token.feature)
    _provider_operation_var.reset(token.operation)
    _provider_attempts_var.reset(token.attempts)
    _last_stream_usage_var.reset(token.usage)


def get_provider_context() -> dict[str, Optional[str]]:
    from app.core.context import get_request_id

    return {
        "feature": _provider_feature_var.get(),
        "operation_id": _provider_operation_var.get(),
        "request_id": get_request_id(),
    }


def record_provider_attempt(metadata: ProviderAttemptMetadata) -> None:
    # Immutable tuple append: a parent context never sees a child's attempts,
    # and no consumer can mutate a record after it is logged.
    _provider_attempts_var.set(_provider_attempts_var.get() + (metadata,))


def get_provider_attempts() -> tuple[ProviderAttemptMetadata, ...]:
    return _provider_attempts_var.get()


def set_last_stream_usage(usage: Optional[Mapping[str, int]]) -> None:
    if not usage:
        return
    _last_stream_usage_var.set(
        {
            key: int(usage[key])
            for key in ("prompt_tokens", "completion_tokens", "total_tokens")
            if isinstance(usage.get(key), (int, float)) and not isinstance(usage.get(key), bool)
        }
    )


def get_last_stream_usage() -> Optional[dict[str, int]]:
    return _last_stream_usage_var.get()


def _jitter(policy: FeaturePolicy = _FEATURE_POLICIES["default"]) -> float:
    """Patchable jitter factor; deterministic by default for reproducible retries.

    Production deployments that need thundering-herd smoothing can patch this
    function (or raise a policy's ``jitter`` and replace the patch), but the
    default keeps backoff exact so callers can reason about retry budgets.
    """
    return 1.0


def _retry_after_seconds(response: Any) -> Optional[float]:
    headers = getattr(response, "headers", None)
    if headers is None:
        return None
    raw = None
    try:
        raw = headers.get("retry-after")
    except (AttributeError, TypeError):
        return None
    if raw is None:
        return None
    try:
        return min(max(float(raw), 0.0), _MAX_RETRY_AFTER_S)
    except (TypeError, ValueError):
        return None


class _ProviderAttempt:
    """Records one attempt and emits exactly one structured log line."""

    def __init__(
        self,
        client: "LLMClient",
        policy: FeaturePolicy,
        feature: str,
        mode: str,
        model: str,
        index: int,
        context: Mapping[str, Optional[str]],
    ) -> None:
        self.client = client
        self.policy = policy
        self.feature = feature
        self.mode = mode
        self.model = model
        self.index = index
        self.context = context
        self.started_ns = time.monotonic_ns()
        self.outcome = "terminal_failure"
        self.status_code: Optional[int] = None
        self.error_type: Optional[str] = None
        self.retryable = False
        self.ttft_ms: Optional[int] = None
        self.partial_tokens = 0
        self.prompt_tokens: Optional[int] = None
        self.completion_tokens: Optional[int] = None
        self.total_tokens: Optional[int] = None
        self.usage_known = False

    def _finish(self) -> ProviderAttemptMetadata:
        metadata = ProviderAttemptMetadata(
            attempt=self.index,
            feature=self.feature,
            provider=self.client.provider_host,
            model=self.model,
            mode=self.mode,
            operation_id=self.context.get("operation_id"),
            request_id=self.context.get("request_id"),
            policy_version=self.policy_version,
            started_at_ms=self.started_ns // 1_000_000,
            duration_ms=(time.monotonic_ns() - self.started_ns) // 1_000_000,
            outcome=self.outcome,
            status_code=self.status_code,
            error_type=self.error_type,
            retryable=self.retryable,
            ttft_ms=self.ttft_ms,
            partial_tokens=self.partial_tokens,
            prompt_tokens=self.prompt_tokens,
            completion_tokens=self.completion_tokens,
            total_tokens=self.total_tokens,
            usage_known=self.usage_known,
        )
        record_provider_attempt(metadata)
        logger.info("provider attempt", extra=metadata.as_log_fields())
        return metadata

    @property
    def policy_version(self) -> str:
        return _POLICY_VERSION

    def record_response(self, response: Any) -> None:
        self.status_code = getattr(response, "status_code", None)
        self.outcome = "success" if self.status_code == 200 else "terminal_failure"

    def record_exception(
        self, exc: BaseException, *, outcome: str, retryable: bool
    ) -> None:
        self.outcome = outcome
        self.retryable = retryable
        self.error_type = type(exc).__name__
        response = getattr(exc, "response", None)
        self.status_code = getattr(response, "status_code", None)
        if isinstance(exc, (TimeoutError, httpx.TimeoutException)):
            self.outcome = "timeout"

    def record_usage(self, usage: Any) -> None:
        if not isinstance(usage, Mapping):
            return
        try:
            self.prompt_tokens = _as_token_count(usage.get("prompt_tokens"))
            self.completion_tokens = _as_token_count(usage.get("completion_tokens"))
            self.total_tokens = _as_token_count(usage.get("total_tokens"))
        except (TypeError, ValueError):
            return
        self.usage_known = any(
            value is not None
            for value in (self.prompt_tokens, self.completion_tokens, self.total_tokens)
        )
        set_last_stream_usage(usage)

    def finish(self) -> ProviderAttemptMetadata:
        return self._finish()


def _as_token_count(value: Any) -> Optional[int]:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
        return None
    return int(value)


def _is_retryable(exc: BaseException, policy: FeaturePolicy) -> bool:
    """Classify a provider failure against the feature's retry policy.

    Status-based errors are retried only for the configured transient statuses;
    transport failures and timeouts are retryable. Errors that carry no status
    (e.g. synthesized HTTPStatusError objects in tests) are treated as
    transport-like so a genuine outage is not silently downgraded.
    """
    if isinstance(exc, httpx.HTTPStatusError):
        response = getattr(exc, "response", None)
        status = getattr(response, "status_code", None)
        if status is None:
            return True
        return status in policy.retryable_statuses
    return isinstance(exc, (httpx.TransportError, TimeoutError))


class LLMClient:
    def __init__(self):
        self.base_url = settings.llm_base_url.rstrip("/")
        self.model = settings.llm_model
        self.api_key = settings.llm_api_key
        # Kept for compatibility; per-call policies override it below.
        self.timeout = httpx.Timeout(
            connect=_DEFAULT_CONNECT_TIMEOUT,
            read=_default_read_timeout(),
            write=_DEFAULT_WRITE_TIMEOUT,
            pool=_DEFAULT_POOL_TIMEOUT,
        )
        self._client: Optional[httpx.AsyncClient] = None

    @property
    def provider_host(self) -> str:
        """Provider host only — never credentials, paths or API keys."""
        return (urlsplit(self.base_url).hostname or "unknown").lower()

    @property
    def last_stream_usage(self) -> Optional[dict[str, int]]:
        """Usage from the most recent streamed SSE ``usage`` chunk in this context."""
        return get_last_stream_usage()

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=self.timeout,
                limits=httpx.Limits(
                    max_connections=100,
                    max_keepalive_connections=20,
                    keepalive_expiry=60,
                ),
            )
        return self._client

    def _headers(self) -> dict:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _resolve_policy(self, feature: str) -> tuple[FeaturePolicy, str, Mapping[str, Optional[str]]]:
        context = get_provider_context()
        bound = context.get("feature")
        # A bound "default" means an explicit opt-out (e.g. a generic request);
        # no binding at all lets the call infer from its own shape.
        resolved_feature = bound or feature
        return policy_for(resolved_feature), resolved_feature, context

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def generate(
        self,
        prompt: str,
        system: Optional[str] = None,
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 2048,
    ) -> str:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        return await self._chat_completion(
            messages=messages,
            model=model or self.model,
            temperature=temperature,
            max_tokens=max_tokens,
        )

    async def chat(
        self,
        messages: list[dict],
        model: Optional[str] = None,
        temperature: float = 0.7,
    ) -> str:
        return await self._chat_completion(
            messages=messages,
            model=model or self.model,
            temperature=temperature,
            max_tokens=settings.max_tokens,
        )

    async def generate_stream(
        self,
        prompt: str,
        system: Optional[str] = None,
        model: Optional[str] = None,
        temperature: float = 0.7,
    ) -> AsyncGenerator[str, None]:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        async for token in self.chat_stream(
            messages=messages, model=model, temperature=temperature
        ):
            yield token

    async def chat_stream(
        self,
        messages: list[dict],
        model: Optional[str] = None,
        temperature: float = 0.7,
    ) -> AsyncGenerator[str, None]:
        payload = {
            "model": model or self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": settings.max_tokens,
            "stream": True,
        }

        policy, feature, context = self._resolve_policy("chat_stream")
        client = self._get_client()
        deadline = time.monotonic() + policy.overall_timeout_s
        stream_bytes = 0
        last_exc: Optional[BaseException] = None

        for attempt in range(1, policy.max_attempts + 1):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                if last_exc is not None:
                    raise last_exc
                raise httpx.ReadTimeout("Provider overall timeout")
            record = _ProviderAttempt(
                self, policy, feature, "stream", str(payload["model"]), attempt, context
            )
            first_token = True
            try:
                with anyio.fail_after(remaining):
                    # A per-call timeout never mutates the shared client used by
                    # other concurrent requests.
                    async with client.stream(
                        "POST",
                        f"{self.base_url}/v1/chat/completions",
                        json=payload,
                        headers=self._headers(),
                        timeout=policy.http_timeout(),
                    ) as resp:
                        if resp.status_code in policy.retryable_statuses:
                            resp.raise_for_status()
                        async for line in resp.aiter_lines():
                            stream_bytes += len(line.encode("utf-8", errors="ignore"))
                            if stream_bytes > _MAX_STREAM_BYTES:
                                raise ValueError("stream size limit exceeded")
                            if not line or not line.startswith("data: "):
                                continue
                            data_str = line[len("data: ") :]
                            if data_str.strip() == "[DONE]":
                                break
                            try:
                                data = json.loads(data_str)
                                usage = data.get("usage")
                                if usage:
                                    record.record_usage(usage)
                                delta = data["choices"][0].get("delta", {})
                                token = delta.get("content", "")
                                if token:
                                    if first_token:
                                        first_token = False
                                        record.ttft_ms = int(
                                            (time.monotonic_ns() - record.started_ns) / 1_000_000
                                        )
                                    record.partial_tokens += 1
                                    yield token
                            except (json.JSONDecodeError, KeyError, IndexError):
                                continue
                record.outcome = "success"
                record.finish()
                return
            except (httpx.HTTPStatusError, httpx.TransportError, TimeoutError) as exc:
                last_exc = exc
                retryable = _is_retryable(exc, policy)
                is_timeout = isinstance(exc, (httpx.TimeoutException, TimeoutError))
                # Only retry streams that failed before any delta was emitted.
                # After a token the SSE contract requires a `failed` event, not
                # a silent restart that would duplicate content for the client.
                if (
                    retryable
                    and first_token
                    and attempt < policy.max_attempts
                    and not bound_retry_disabled(policy)
                ):
                    record.record_exception(
                        exc, outcome="retryable_failure", retryable=True
                    )
                    delay = await self._backoff(exc, policy, attempt)
                    record.finish()
                    if delay is not None and time.monotonic() + delay < deadline:
                        await self._sleep(delay)
                        continue
                    raise exc
                record.record_exception(
                    exc,
                    outcome="partial_failure" if not first_token else "terminal_failure",
                    retryable=False if not first_token else retryable,
                )
                if is_timeout:
                    record.outcome = (
                        "partial_failure" if not first_token else "timeout"
                    )
                record.finish()
                raise
            except BaseException as exc:
                last_exc = exc
                record.record_exception(
                    exc,
                    outcome="partial_failure" if not first_token else "terminal_failure",
                    retryable=False,
                )
                record.finish()
                raise

        if last_exc is not None:
            raise last_exc
        raise httpx.ReadTimeout("Provider overall timeout")

    async def _chat_completion(
        self,
        messages: list[dict],
        model: str,
        temperature: float,
        max_tokens: int = 2048,
    ) -> str:
        # Clamp caller-supplied max_tokens to a hard ceiling so a single
        # caller cannot drive unbounded provider cost.
        clamped_max_tokens = min(max_tokens, _MAX_TOKENS_CEILING)
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": clamped_max_tokens,
        }

        logger.info("LLM request -> %s model=%s", self.base_url, model)

        policy, feature, context = self._resolve_policy("chat")
        client = self._get_client()
        deadline = time.monotonic() + policy.overall_timeout_s
        last_exc: Optional[BaseException] = None

        for attempt in range(1, policy.max_attempts + 1):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                if last_exc is not None:
                    raise last_exc
                raise httpx.ReadTimeout("Provider overall timeout")
            record = _ProviderAttempt(
                self, policy, feature, "generate", model, attempt, context
            )
            try:
                with anyio.fail_after(remaining):
                    resp = await client.post(
                        f"{self.base_url}/v1/chat/completions",
                        json=payload,
                        headers=self._headers(),
                        timeout=policy.http_timeout(),
                    )
                    resp.raise_for_status()
                    record.record_response(resp)
                    data = resp.json()
                    content = data["choices"][0]["message"]["content"]
                    record.record_usage(data.get("usage"))
                    logger.info("LLM response received (%d chars)", len(content))
                record.finish()
                return content
            except (httpx.HTTPStatusError, httpx.TransportError, TimeoutError) as exc:
                last_exc = exc
                retryable = _is_retryable(exc, policy)
                if retryable and attempt < policy.max_attempts:
                    record.record_exception(
                        exc, outcome="retryable_failure", retryable=True
                    )
                    delay = await self._backoff(exc, policy, attempt)
                    record.finish()
                    if delay is None:
                        continue
                    if time.monotonic() + delay >= deadline:
                        raise exc
                    await self._sleep(delay)
                    continue
                record.record_exception(
                    exc, outcome="terminal_failure", retryable=False
                )
                record.finish()
                raise
            except BaseException as exc:
                last_exc = exc
                record.record_exception(
                    exc, outcome="terminal_failure", retryable=False
                )
                record.finish()
                raise

        if last_exc is not None:
            raise last_exc
        raise httpx.ReadTimeout("Provider overall timeout")

    async def _backoff(
        self, exc: BaseException, policy: FeaturePolicy, attempt: int
    ) -> Optional[float]:
        """Return a bounded delay, honoring a sane ``Retry-After`` when present."""
        retry_after = _retry_after_seconds(getattr(exc, "response", None))
        if retry_after is not None:
            return retry_after
        base = min(
            policy.backoff_base_s * (2 ** (attempt - 1)) * _jitter(policy),
            policy.backoff_cap_s,
        )
        return max(0.0, base)

    async def _sleep(self, delay: float) -> None:
        # Module-level patch point retained so tests can run without real waits.
        await asyncio.sleep(delay)

    async def health_check(self) -> bool:
        """Probe the LLM backend without spending billable completions.

        Uses GET /v1/models — a non-billable metadata endpoint supported by
        every OpenAI-compatible provider — instead of POSTing a chat
        completion. Validating the response shape catches a proxy that returns
        200 for /models but cannot actually serve completions.
        """
        policy, feature, context = self._resolve_policy("health")
        record = _ProviderAttempt(
            self, policy, feature, "health", self.model, 1, context
        )
        try:
            client = self._get_client()
            with anyio.fail_after(policy.overall_timeout_s):
                resp = await client.get(
                    f"{self.base_url}/v1/models",
                    headers=self._headers(),
                    timeout=policy.http_timeout(),
                )
            if resp.status_code != 200:
                record.status_code = resp.status_code
                record.error_type = "NonSuccessStatus"
                record.finish()
                return False
            data = resp.json()
            # /v1/models returns {"object":"list","data":[...]}. Require the
            # "data" key to be present so a non-LLM proxy returning 200 with
            # an unrelated body is not treated as healthy.
            healthy = isinstance(data, dict) and "data" in data
            record.record_response(resp)
            record.outcome = "success" if healthy else "terminal_failure"
            record.finish()
            return healthy
        except Exception as exc:
            record.record_exception(exc, outcome="timeout", retryable=False)
            record.finish()
            return False


def bound_retry_disabled(policy: FeaturePolicy) -> bool:
    """Whether this policy opts out of stream retries despite transient errors."""
    return not policy.retry_stream_before_first_token


# Kept as read-only aliases for compatibility with earlier policy prototypes.
TRANSIENT_STATUS = _RETRYABLE_STATUSES
MAX_RETRIES = _FEATURE_POLICIES["default"].max_attempts
INITIAL_BACKOFF = _BACKOFF_BASE_S

llm_client = LLMClient()
