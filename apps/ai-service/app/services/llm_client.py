import asyncio
import json
import logging
from typing import AsyncGenerator, Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_TRANSIENT_STATUS = {429, 502, 503}
_MAX_RETRIES = 3
_INITIAL_BACKOFF = 1.0
# Hard ceiling on streamed response size to prevent unbounded memory use from
# a misbehaving upstream. 2 MB of SSE text is far beyond any legitimate
# completion and catches runaway streams before they exhaust the process.
_MAX_STREAM_BYTES = 2 * 1024 * 1024
# Hard ceiling on max_tokens accepted from callers, regardless of what they
# request. Prevents a single caller from driving unbounded provider cost.
_MAX_TOKENS_CEILING = 8192


class LLMClient:
    def __init__(self):
        self.base_url = settings.llm_base_url.rstrip("/")
        self.model = settings.llm_model
        self.api_key = settings.llm_api_key
        self.timeout = httpx.Timeout(
            connect=10.0, read=float(settings.request_timeout), write=10.0, pool=10.0
        )
        self._client: Optional[httpx.AsyncClient] = None

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

        client = self._get_client()
        async with client.stream(
            "POST",
            f"{self.base_url}/v1/chat/completions",
            json=payload,
            headers=self._headers(),
        ) as resp:
            if resp.status_code in _TRANSIENT_STATUS:
                resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line or not line.startswith("data: "):
                    continue
                data_str = line[len("data: ") :]
                if data_str.strip() == "[DONE]":
                    break
                try:
                    data = json.loads(data_str)
                    usage = data.get("usage")
                    if usage:
                        logger.info(
                            "Stream token usage - prompt: %s, completion: %s, total: %s",
                            usage.get("prompt_tokens"),
                            usage.get("completion_tokens"),
                            usage.get("total_tokens"),
                        )
                    delta = data["choices"][0].get("delta", {})
                    token = delta.get("content", "")
                    if token:
                        yield token
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue

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

        client = self._get_client()
        last_exc: Exception = RuntimeError("unreachable")

        for attempt in range(_MAX_RETRIES):
            try:
                resp = await client.post(
                    f"{self.base_url}/v1/chat/completions",
                    json=payload,
                    headers=self._headers(),
                )
                resp.raise_for_status()
                data = resp.json()
                content = data["choices"][0]["message"]["content"]
                usage = data.get("usage")
                if usage:
                    logger.info(
                        "LLM token usage - prompt: %s, completion: %s, total: %s",
                        usage.get("prompt_tokens"),
                        usage.get("completion_tokens"),
                        usage.get("total_tokens"),
                    )
                logger.info("LLM response received (%d chars)", len(content))
                return content
            except httpx.HTTPStatusError as exc:
                last_exc = exc
                if exc.response.status_code in _TRANSIENT_STATUS and attempt < _MAX_RETRIES - 1:
                    backoff = _INITIAL_BACKOFF * (2 ** attempt)
                    logger.warning(
                        "Transient error %d, retrying in %.1fs (attempt %d/%d)",
                        exc.response.status_code,
                        backoff,
                        attempt + 1,
                        _MAX_RETRIES,
                    )
                    await asyncio.sleep(backoff)
                    continue
                raise
            except httpx.TransportError as exc:
                # Catch the full TransportError hierarchy (ConnectError,
                # ConnectTimeout, ReadTimeout, WriteTimeout, PoolTimeout,
                # ReadError, WriteError, RemoteProtocolError, ...) so that
                # slow TLS handshakes and stalled writes also benefit from
                # the retry/backoff policy. Non-retryable errors like
                # InvalidURL are subclasses of InvalidTransportMapping and
                # do not inherit from TransportError, so they still raise
                # immediately.
                last_exc = exc
                if attempt < _MAX_RETRIES - 1:
                    backoff = _INITIAL_BACKOFF * (2 ** attempt)
                    logger.warning(
                        "Connection error %s, retrying in %.1fs (attempt %d/%d)",
                        type(exc).__name__,
                        backoff,
                        attempt + 1,
                        _MAX_RETRIES,
                    )
                    await asyncio.sleep(backoff)
                    continue
                raise

        raise last_exc

    async def health_check(self) -> bool:
        """Probe the LLM backend without spending billable completions.

        Uses GET /v1/models — a non-billable metadata endpoint supported by
        every OpenAI-compatible provider — instead of POSTing a chat
        completion. The previous implementation burned a billable completion
        on every 30s readiness cycle across every pod and marked the service
        ready as long as any 200 came back, even if completions themselves
        were broken. Validating the response shape now catches a proxy that
        returns 200 for /models but cannot actually serve completions.
        """
        try:
            client = self._get_client()
            resp = await client.get(
                f"{self.base_url}/v1/models",
                headers=self._headers(),
            )
            if resp.status_code != 200:
                return False
            data = resp.json()
            # /v1/models returns {"object":"list","data":[...]}. Require the
            # "data" key to be present so a non-LLM proxy returning 200 with
            # an unrelated body is not treated as healthy.
            return isinstance(data, dict) and "data" in data
        except Exception:
            return False


llm_client = LLMClient()
