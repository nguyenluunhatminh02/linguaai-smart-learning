"""Feature-aware model routing with fallback compatibility and budget hooks.

This module is deliberately transport- and store-agnostic: it selects an ordered
set of model candidates from policy and returns a decision. The caller owns the
actual provider request, budget reservations and telemetry flush.

Policy comes from a versioned JSON file (``MODEL_POLICY_PATH`` overrides the
shipped default); prices are only referenced by a stable ``price_ref`` key,
never embedded as a number.

Kill switches and exhausted budgets fail closed: no candidates are returned.
"""

from __future__ import annotations

import copy
import hashlib
import json
import logging
import os
import re
import time
from contextlib import contextmanager
from dataclasses import dataclass, replace
from enum import Enum
from pathlib import Path
from typing import Any, Iterator, Mapping, Optional, Protocol, Sequence, runtime_checkable

logger = logging.getLogger(__name__)

_DEFAULT_CONFIG_VERSION = "rel-03.1"
_DEFAULT_PRICING_VERSION = "unversioned"
_MAX_FALLBACKS_DEFAULT = 2
# Policy JSON is operator-controlled config, but a pathological file must not
# make the router allocate an unbounded decision.
_MAX_POLICY_BYTES = 512 * 1024
_SAFE_TOKEN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$")


class Feature(str, Enum):
    """Feature names aligned with the guard/path features and the roadmap."""

    CHAT = "chat"
    WRITING_FEEDBACK = "writing_feedback"
    WRITING = "writing"
    GRAMMAR = "grammar"
    NLP = "nlp"
    ERROR_ANALYSIS = "error_analysis"
    ERRORS = "errors"
    READING_GENERATION = "reading_generation"
    READING = "reading"
    CARD_GENERATION = "card_generation"
    QUIZ_GENERATION = "quiz_generation"
    CONTENT_GENERATION = "content_generation"
    CONTENT = "content"
    SPEAKING_FEEDBACK = "speaking_feedback"
    HEALTH = "health"
    DEFAULT = "default"


@dataclass(frozen=True)
class ModelCapabilities:
    """What a candidate can do; used as a hard compatibility contract."""

    streaming: bool = True
    structured_output: bool = True
    supports_json_schema: bool = True
    context_window: int = 8_192
    max_output_tokens: int = 2_048
    quality_tier: str = "standard"

    def supports(self, *, streaming: bool, structured: bool, json_schema: bool = False) -> bool:
        if streaming and not self.streaming:
            return False
        if structured and not self.structured_output:
            return False
        if json_schema and not self.supports_json_schema:
            return False
        return True


@dataclass(frozen=True)
class ModelCandidate:
    """Immutable description of one provider/model option from policy."""

    model_id: str
    provider: str
    capabilities: ModelCapabilities
    quality_score: float = 0.5
    config_version: str = _DEFAULT_CONFIG_VERSION
    price_ref: str = "unknown"
    role: str = "primary"
    response_contract: str = "text"
    output_schema: Optional[str] = None
    eval_score: Optional[float] = None
    min_eval_score: Optional[float] = None

    @property
    def structured_output(self) -> bool:
        return self.capabilities.structured_output

    @property
    def streaming(self) -> bool:
        return self.capabilities.streaming

    @property
    def supports_json_schema(self) -> bool:
        return self.capabilities.supports_json_schema

    @property
    def context_window(self) -> int:
        return self.capabilities.context_window

    @property
    def max_output_tokens(self) -> int:
        return self.capabilities.max_output_tokens

    @property
    def quality_tier(self) -> str:
        return self.capabilities.quality_tier


@dataclass(frozen=True)
class ModelDecision:
    """Ordered candidates (primary first), plus the reason for the ordering."""

    candidates: tuple[ModelCandidate, ...] = ()
    reason: str = "no_candidates"
    feature: Feature = Feature.DEFAULT
    config_version: str = _DEFAULT_CONFIG_VERSION
    eval_score: Optional[float] = None
    fallback_limit: int = _MAX_FALLBACKS_DEFAULT

    @property
    def primary(self) -> Optional[ModelCandidate]:
        return self.candidates[0] if self.candidates else None

    @property
    def fallbacks(self) -> tuple[ModelCandidate, ...]:
        return self.candidates[1:]

    @property
    def available(self) -> bool:
        return bool(self.candidates)

    def __bool__(self) -> bool:
        return self.available


@dataclass(frozen=True)
class EvaluationScore:
    """Measured quality score for a feature/model pair, if available."""

    feature: Feature
    model_id: str
    score: float
    sample_size: int = 0
    evaluated_at: str = ""
    config_version: str = _DEFAULT_CONFIG_VERSION

    def __post_init__(self) -> None:
        if not 0.0 <= self.score <= 1.0:
            raise ValueError("score must be within [0, 1]")
        if self.sample_size < 0:
            raise ValueError("sample_size must be non-negative")


@dataclass(frozen=True)
class BudgetState:
    """Snapshot of budget availability given to the router.

    ``None`` means unknown (not a denial). A ``False`` value fails closed.
    """

    feature_budget_available: Optional[bool] = None
    global_budget_available: Optional[bool] = None
    estimated_tokens: Optional[int] = None
    feature_remaining_tokens: Optional[int] = None
    global_remaining_tokens: Optional[int] = None

    def has_budget(self, estimated_tokens: Optional[int] = None) -> bool:
        if self.feature_budget_available is False or self.global_budget_available is False:
            return False
        needed = estimated_tokens if estimated_tokens is not None else self.estimated_tokens
        for remaining in (self.feature_remaining_tokens, self.global_remaining_tokens):
            if remaining is not None and needed is not None and needed > remaining:
                return False
        return True


@runtime_checkable
class BudgetHook(Protocol):
    """Optional adapter to the existing Redis budget/rate-limit infrastructure."""

    def has_budget(self, feature: str, estimated_tokens: Optional[int]) -> bool: ...

    def reserve(self, feature: str, estimated_tokens: Optional[int]) -> bool: ...

    def commit(self, feature: str, actual_tokens: Optional[int], cost_estimate: Optional[float]) -> None: ...

    def release(self, feature: str, estimated_tokens: Optional[int]) -> None: ...


class NoopBudgetHook:
    """Default hook: budget is owned by the existing caller-side guards."""

    def has_budget(self, feature: str, estimated_tokens: Optional[int]) -> bool:
        return True

    def reserve(self, feature: str, estimated_tokens: Optional[int]) -> bool:
        return True

    def commit(self, feature: str, actual_tokens: Optional[int], cost_estimate: Optional[float]) -> None:
        return None

    def release(self, feature: str, estimated_tokens: Optional[int]) -> None:
        return None


@dataclass(frozen=True)
class AttemptRecord:
    """One provider attempt, safe for structured logging.

    Never contains prompts, transcripts, raw exception messages or secrets.
    ``request_ref`` is a short digest of the caller's id/hash, not user content.
    """

    operation_id: Optional[str]
    request_ref: Optional[str]
    feature: str
    provider: str
    model_id: str
    config_version: str
    price_ref: str
    pricing_version: str
    started_at: str
    latency_ms: Optional[int]
    input_tokens: Optional[int]
    output_tokens: Optional[int]
    cost_estimate: Optional[float]
    outcome: str
    is_estimated: bool = False
    is_fallback: bool = False
    attempt_index: int = 0

    def as_log_fields(self) -> dict[str, Any]:
        return {"provider_attempts": {k: v for k, v in vars(self).items() if v is not None}}


class AttemptRecorder:
    """Builds and logs :class:`AttemptRecord` values.

    ``clock`` and ``emit`` are injectable so tests are deterministic. The
    default emitter uses the application's structured JSON logger; no prompt
    text or provider credential is ever passed to it.
    """

    def __init__(
        self,
        *,
        clock: Any = time.time,
        emit: Any = None,
        pricing_version: str = _DEFAULT_PRICING_VERSION,
        config_version: str = _DEFAULT_CONFIG_VERSION,
    ) -> None:
        self._clock = clock
        self._emit = emit or self._default_emit
        self._pricing_version = pricing_version
        self._config_version = config_version
        self._attempts: list[AttemptRecord] = []

    @staticmethod
    def _default_emit(record: AttemptRecord) -> None:
        logger.info("provider_attempts", extra=record.as_log_fields())

    @staticmethod
    def stable_request_ref(value: Optional[str]) -> Optional[str]:
        """Hash an id/content digest; accept only safe tokens, never raw text."""
        if not value:
            return None
        candidate = str(value)
        if _SAFE_TOKEN.fullmatch(candidate):
            return candidate
        return hashlib.sha256(candidate.encode("utf-8", errors="ignore")).hexdigest()[:32]

    @staticmethod
    def price_for(price_ref: str, pricing_table: Mapping[str, Any]) -> Optional[Mapping[str, Any]]:
        """Look up a price entry by reference, including dotted paths.

        Returns ``None`` for unknown refs; callers must then leave the estimate
        as ``None`` and mark ``is_estimated=True`` rather than invent a number.
        """
        if not isinstance(price_ref, str) or not price_ref:
            return None
        parts = price_ref.split(".")
        if any(not _SAFE_TOKEN.fullmatch(part) for part in parts):
            return None
        node: Any = pricing_table
        for part in parts:
            if not isinstance(node, Mapping) or part not in node:
                return None
            node = node[part]
        return node if isinstance(node, Mapping) else None

    @staticmethod
    def estimate_cost(
        entry: Optional[Mapping[str, Any]], input_tokens: Optional[int], output_tokens: Optional[int]
    ) -> Optional[float]:
        """Compute a cost estimate from a price entry, never from hardcoded rates."""
        if entry is None:
            return None
        prices = entry.get("usd_per_1m_tokens")
        if not isinstance(prices, Mapping):
            return None
        try:
            input_rate = prices.get("input")
            output_rate = prices.get("output")
            if input_rate is None or output_rate is None:
                return None
            in_rate = float(input_rate)
            out_rate = float(output_rate)
        except (TypeError, ValueError):
            return None
        if in_rate < 0 or out_rate < 0:
            return None
        if input_tokens is None and output_tokens is None:
            return None
        return round(
            (in_rate * (input_tokens or 0) + out_rate * (output_tokens or 0)) / 1_000_000,
            12,
        )

    def record(
        self,
        decision: ModelDecision | ModelCandidate,
        *,
        operation_id: Optional[str] = None,
        request_ref: Optional[str] = None,
        provider: Optional[str] = None,
        outcome: str,
        started_at: Optional[float] = None,
        latency_ms: Optional[int] = None,
        input_tokens: Optional[int] = None,
        output_tokens: Optional[int] = None,
        cost_estimate: Optional[float] = None,
        pricing_table: Optional[Mapping[str, Any]] = None,
        attempt_index: int = 0,
        is_estimated: bool = False,
        is_fallback: bool = False,
    ) -> AttemptRecord:
        candidate = decision.primary if isinstance(decision, ModelDecision) else decision
        if candidate is None:
            raise ValueError("cannot record an attempt without a candidate")
        start = self._clock() if started_at is None else started_at
        measured = latency_ms
        if measured is None:
            measured = max(0, int((self._clock() - start) * 1000))
        known_cost = cost_estimate
        if known_cost is None and pricing_table is not None:
            known_cost = self.estimate_cost(
                self.price_for(candidate.price_ref, pricing_table), input_tokens, output_tokens
            )
        # Unknown usage or an unresolvable price must stay unknown.
        uncertain = is_estimated or input_tokens is None or output_tokens is None or known_cost is None
        record = AttemptRecord(
            operation_id=self.stable_request_ref(operation_id),
            request_ref=self.stable_request_ref(request_ref),
            feature=(decision.feature.value if isinstance(decision, ModelDecision) else "unknown"),
            provider=provider or candidate.provider,
            model_id=candidate.model_id,
            config_version=candidate.config_version,
            price_ref=candidate.price_ref,
            pricing_version=self._pricing_version,
            started_at=self._iso_utc(start),
            latency_ms=measured,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_estimate=known_cost,
            outcome=outcome,
            is_estimated=bool(uncertain),
            is_fallback=is_fallback,
            attempt_index=attempt_index,
        )
        self._attempts.append(record)
        self._emit(record)
        return record

    @staticmethod
    def _iso_utc(timestamp: float) -> str:
        from datetime import datetime, timezone

        return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat(timespec="milliseconds")

    @property
    def attempts(self) -> tuple[AttemptRecord, ...]:
        return tuple(self._attempts)


class KillSwitch:
    """Feature kill switch; empty/unknown features fail closed."""

    def __init__(self, killed_features: Optional[Sequence[str]] = None) -> None:
        self._killed = frozenset(self._normalize(killed_features or ()))

    @staticmethod
    def _normalize(values: Sequence[str]) -> set[str]:
        normalized: set[str] = set()
        for value in values:
            if isinstance(value, str):
                normalized.add(value.strip().lower())
        return normalized

    def is_killed(self, feature: Feature | str) -> bool:
        name = feature.value if isinstance(feature, Feature) else str(feature).strip().lower()
        return name in self._killed or name == Feature.DEFAULT.value or not name


def _coerce_feature(value: Any) -> Feature:
    if isinstance(value, Feature):
        return value
    name = str(value or "default").strip().lower().replace("-", "_").replace(" ", "_")
    try:
        return Feature(name)
    except ValueError:
        return Feature.DEFAULT


def _coerce_float(value: Any, default: float) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if 0.0 <= result <= 1.0 else default


def _coerce_int(value: Any, default: int, minimum: int = 0) -> int:
    try:
        result = int(value)
    except (TypeError, ValueError):
        return default
    return result if result >= minimum else default


def _safe_id(value: Any) -> Optional[str]:
    if not isinstance(value, str) or not value.strip():
        return None
    candidate = value.strip()
    return candidate if _SAFE_TOKEN.fullmatch(candidate) else None


def _provider_from_model(model_id: str, configured: Any = None) -> str:
    provider = _safe_id(configured)
    if provider:
        return provider
    if ":" in model_id:
        return model_id.split(":", 1)[0].lower()
    return "unknown"


class ModelRouter:
    """Selects model candidates from versioned per-feature policy.

    Fallback candidates must share the primary's response contract (structured
    vs streaming, schema/output shape) and stay within the same feature policy
    and fallback limit. A killed feature or an unavailable budget yields an
    empty decision.
    """

    def __init__(
        self,
        policy: Optional[Mapping[str, Any]] = None,
        *,
        config_version: Optional[str] = None,
        pricing_version: Optional[str] = None,
        pricing_table: Optional[Mapping[str, Any]] = None,
        fallback_limit: Optional[int] = None,
        eval_gate: Optional[Mapping[str, Any]] = None,
        kill_switch: Optional[KillSwitch | Sequence[str]] = None,
        budget_hook: Optional[BudgetHook] = None,
        attempt_recorder: Optional[AttemptRecorder] = None,
    ) -> None:
        self._config_version = config_version or _DEFAULT_CONFIG_VERSION
        self._pricing_version = pricing_version or _DEFAULT_PRICING_VERSION
        self._pricing_table = dict(pricing_table or {})
        self._fallback_limit = fallback_limit
        self._eval_gate = dict(eval_gate or {})
        self._kill_switch = (
            kill_switch
            if isinstance(kill_switch, KillSwitch)
            else KillSwitch(kill_switch)
        )
        self._budget_hook = budget_hook or NoopBudgetHook()
        self._recorder = attempt_recorder
        self._evaluations: dict[tuple[Feature, str], EvaluationScore] = {}
        self._policy: dict[str, Any] = copy.deepcopy(dict(policy)) if policy is not None else load_model_policy()

    @classmethod
    def from_env(cls, **overrides: Any) -> "ModelRouter":
        """Build a router from config/env without importing the settings module."""
        policy = load_model_policy()
        kwargs: dict[str, Any] = {
            "policy": policy,
            "config_version": policy.get("version") or os.getenv("MODEL_CONFIG_VERSION") or _DEFAULT_CONFIG_VERSION,
            "pricing_version": os.getenv("PRICING_CONFIG_VERSION") or _DEFAULT_PRICING_VERSION,
            "fallback_limit": env_int("AI_MODEL_FALLBACK_LIMIT", None),
            "kill_switch": KillSwitch(parse_kill_switch(os.getenv("AI_FEATURE_KILL_SWITCH", ""))),
        }
        ref = os.getenv("PRICING_TABLE_REF", "")
        if ref:
            kwargs["pricing_table"] = load_pricing_table(ref)
        kwargs.update(overrides)
        return cls(**kwargs)

    @property
    def config_version(self) -> str:
        return self._config_version

    @property
    def pricing_version(self) -> str:
        return self._pricing_version

    @property
    def pricing_table(self) -> dict[str, Any]:
        """Copy of the referenced pricing table; the code owns no hardcoded prices."""
        return dict(self._pricing_table)

    @property
    def recorder(self) -> AttemptRecorder:
        if self._recorder is None:
            self._recorder = AttemptRecorder(
                pricing_version=self._pricing_version, config_version=self._config_version
            )
        return self._recorder

    def set_eval_scores(self, scores: Sequence[Mapping[str, Any] | EvaluationScore]) -> None:
        """Install measured eval scores (the gate is advisory if none exist)."""
        for item in scores:
            score = item if isinstance(item, EvaluationScore) else EvaluationScore(
                feature=_coerce_feature(item.get("feature")),
                model_id=str(item.get("model_id") or ""),
                score=_coerce_float(item.get("score"), 0.0),
                sample_size=_coerce_int(item.get("sample_size"), 0),
                evaluated_at=str(item.get("evaluated_at") or ""),
                config_version=str(item.get("config_version") or self._config_version),
            )
            self._evaluations[(score.feature, score.model_id)] = score

    def eval_score_for(self, feature: Feature | str, model_id: str) -> Optional[float]:
        score = self._evaluations.get((_coerce_feature(feature), model_id))
        return score.score if score else None

    def budget_available(
        self,
        feature: Feature | str,
        *,
        estimated_tokens: Optional[int] = None,
        budget_state: Optional[BudgetState | Mapping[str, Any]] = None,
    ) -> bool:
        """Check budget without reserving it; unknown state means no denial."""
        state = self._coerce_budget_state(budget_state)
        hook_ok = True
        try:
            hook_ok = bool(self._budget_hook.has_budget(
                _coerce_feature(feature).value, estimated_tokens
            ))
        except Exception:
            # Store errors fail closed for billable work.
            hook_ok = False
        return hook_ok and state.has_budget(estimated_tokens)

    @staticmethod
    def _coerce_budget_state(value: Optional[BudgetState | Mapping[str, Any]]) -> BudgetState:
        if value is None:
            return BudgetState()
        if isinstance(value, BudgetState):
            return value
        if isinstance(value, Mapping):
            return BudgetState(
                feature_budget_available=value.get("feature_budget_available"),
                global_budget_available=value.get("global_budget_available"),
                estimated_tokens=value.get("estimated_tokens"),
                feature_remaining_tokens=value.get("feature_remaining_tokens"),
                global_remaining_tokens=value.get("global_remaining_tokens"),
            )
        raise TypeError("budget_state must be a BudgetState or mapping")

    @contextmanager
    def reserved_budget(
        self,
        feature: Feature | str,
        *,
        estimated_tokens: Optional[int] = None,
        budget_state: Optional[BudgetState | Mapping[str, Any]] = None,
    ) -> Iterator[dict[str, Any]]:
        """Reserve/release/commit a budget hook around one provider call.

        Yields a reservation dict whose ``reserved`` flag says whether the
        caller may spend. Attach actual usage via :meth:`commit_usage` before
        leaving the context, otherwise the estimate is released.
        """
        name = _coerce_feature(feature).value
        reservation: dict[str, Any] = {
            "feature": name,
            "estimated_tokens": estimated_tokens,
            "reserved": False,
            "actual_tokens": None,
            "cost_estimate": None,
        }
        if self.budget_available(name, estimated_tokens=estimated_tokens, budget_state=budget_state):
            try:
                reservation["reserved"] = bool(
                    self._budget_hook.reserve(name, estimated_tokens)
                )
            except Exception:
                reservation["reserved"] = False
        try:
            yield reservation
        except BaseException:
            if reservation["reserved"]:
                try:
                    self._budget_hook.release(name, estimated_tokens)
                except Exception:
                    logger.warning("budget release failed", extra={"feature": name})
            raise
        else:
            if reservation["reserved"]:
                actual, cost = reservation["actual_tokens"], reservation["cost_estimate"]
                try:
                    if actual is not None or cost is not None:
                        self._budget_hook.commit(name, actual, cost)
                    else:
                        self._budget_hook.release(name, estimated_tokens)
                except Exception:
                    logger.warning("budget finalize failed", extra={"feature": name})

    @staticmethod
    def commit_usage(
        reservation: dict[str, Any],
        *,
        actual_tokens: Optional[int],
        cost_estimate: Optional[float],
    ) -> None:
        """Attach outcome metadata to a :meth:`reserved_budget` reservation."""
        reservation["actual_tokens"] = actual_tokens
        reservation["cost_estimate"] = cost_estimate

    def select(
        self,
        feature: Feature | str,
        *,
        needs_streaming: bool = False,
        needs_structured: bool = False,
        needs_json_schema: bool = False,
        min_quality: Optional[float] = None,
        eval_score: Optional[float] = None,
        threshold: Optional[float] = None,
        estimated_tokens: Optional[int] = None,
        budget_state: Optional[BudgetState | Mapping[str, Any]] = None,
        killed_features: Optional[Sequence[str]] = None,
        config_version: Optional[str] = None,
        override_model: Optional[str] = None,
        fallback_limit: Optional[int] = None,
    ) -> ModelDecision:
        """Pick an ordered candidate tuple; empty means fail closed."""
        resolved = _coerce_feature(feature)
        version = config_version or self._config_version

        killed = self._kill_switch
        if killed_features:
            killed = KillSwitch(list(killed_features))
        if killed.is_killed(resolved):
            return ModelDecision(
                reason="killed", feature=resolved, config_version=version,
                eval_score=eval_score,
            )

        state = self._coerce_budget_state(budget_state)
        if not self.budget_available(
            resolved, estimated_tokens=estimated_tokens, budget_state=state
        ):
            return ModelDecision(
                reason="budget_exceeded", feature=resolved, config_version=version,
                eval_score=eval_score,
            )

        policy = self._policy_for(resolved, version)
        if not policy or not policy.get("enabled", True):
            return ModelDecision(
                reason="feature_disabled", feature=resolved, config_version=version,
                eval_score=eval_score,
            )

        gate = dict(self._eval_gate)
        gate.update(policy.get("eval_gate", {}) if isinstance(policy.get("eval_gate"), Mapping) else {})
        measured = eval_score if eval_score is not None else self.eval_score_for(resolved, override_model or "")
        threshold_value = threshold
        if threshold_value is None:
            threshold_value = gate.get("min_score") or gate.get("threshold")
        if threshold_value is not None and measured is not None:
            try:
                if float(measured) < float(threshold_value):
                    return ModelDecision(
                        reason="eval_below_threshold", feature=resolved,
                        config_version=version, eval_score=measured,
                    )
            except (TypeError, ValueError):
                return ModelDecision(
                    reason="eval_invalid", feature=resolved, config_version=version,
                    eval_score=measured,
                )

        raw_candidates = policy.get("candidates")
        if not isinstance(raw_candidates, Sequence) or isinstance(raw_candidates, (str, bytes)):
            return ModelDecision(
                reason="no_candidates", feature=resolved, config_version=version,
                eval_score=measured,
            )

        parsed: list[ModelCandidate] = []
        seen: set[str] = set()
        for entry in raw_candidates:
            candidate = self._parse_candidate(entry, resolved, version)
            if candidate is None or candidate.model_id in seen:
                continue
            seen.add(candidate.model_id)
            parsed.append(candidate)

        allowed = _coerce_int(
            fallback_limit if fallback_limit is not None else self._fallback_limit,
            _MAX_FALLBACKS_DEFAULT,
        )
        allowed = max(0, allowed)

        chosen: list[ModelCandidate] = []
        if override_model:
            for candidate in parsed:
                if candidate.model_id == override_model:
                    chosen.append(candidate)
                    break
            if not chosen:
                return ModelDecision(
                    reason="override_not_allowed", feature=resolved,
                    config_version=version, eval_score=measured,
                )
        else:
            primary = next((c for c in parsed if c.role == "primary"), None)
            if primary is None:
                primary = parsed[0] if parsed else None
            if primary is None:
                return ModelDecision(
                    reason="no_candidates", feature=resolved, config_version=version,
                    eval_score=measured,
                )
            if not self._compatible(
                primary, needs_streaming, needs_structured, needs_json_schema,
                min_quality, estimated_tokens,
            ):
                return ModelDecision(
                    reason="primary_incompatible", feature=resolved,
                    config_version=version, eval_score=measured,
                )
            chosen.append(primary)
            for candidate in parsed:
                if len(chosen) - 1 >= allowed:
                    break
                if candidate.model_id == primary.model_id:
                    continue
                if not self._fallback_compatible(primary, candidate):
                    continue
                if not self._compatible(
                    candidate, needs_streaming, needs_structured, needs_json_schema,
                    min_quality, estimated_tokens,
                ):
                    continue
                chosen.append(replace(candidate, role="fallback"))

        return ModelDecision(
            candidates=tuple(chosen),
            reason="selected" if chosen else "no_candidates",
            feature=resolved,
            config_version=version,
            eval_score=measured,
            fallback_limit=min(allowed, max(0, len(chosen) - 1)),
        )

    def _policy_for(self, feature: Feature, version: str) -> Mapping[str, Any]:
        features = self._policy.get("features")
        if not isinstance(features, Mapping):
            return {}
        entry = features.get(feature.value)
        if not isinstance(entry, Mapping):
            return {}
        if version and entry.get("config_version") not in (None, version):
            return {}
        return entry

    def _parse_candidate(
        self, entry: Any, feature: Feature, version: str
    ) -> Optional[ModelCandidate]:
        if not isinstance(entry, Mapping):
            return None
        model_id = _safe_id(entry.get("model_id") or entry.get("id"))
        if model_id is None:
            return None
        caps = entry.get("capabilities")
        caps = caps if isinstance(caps, Mapping) else {}
        capabilities = ModelCapabilities(
            streaming=bool(caps.get("streaming", True)),
            structured_output=bool(caps.get("structured_output", True)),
            supports_json_schema=bool(caps.get("supports_json_schema", True)),
            context_window=_coerce_int(caps.get("context_window"), 8_192, 1),
            max_output_tokens=_coerce_int(
                caps.get("max_output_tokens"), capabilities_default_output(), 1
            ),
            quality_tier=str(caps.get("quality_tier") or "standard"),
        )
        role = str(entry.get("role") or "primary").strip().lower()
        if role not in ("primary", "fallback"):
            role = "fallback"
        price_ref = _safe_id(entry.get("price_ref")) or "unknown"
        return ModelCandidate(
            model_id=model_id,
            provider=_provider_from_model(model_id, entry.get("provider")),
            capabilities=capabilities,
            quality_score=_coerce_float(entry.get("quality_score"), 0.5),
            config_version=str(entry.get("config_version") or version),
            price_ref=price_ref,
            role=role,
            response_contract=str(entry.get("response_contract") or "text"),
            output_schema=_safe_id(entry.get("output_schema")),
            eval_score=entry.get("eval_score"),
            min_eval_score=entry.get("min_eval_score"),
        )

    @staticmethod
    def _compatible(
        candidate: ModelCandidate,
        streaming: bool,
        structured: bool,
        json_schema: bool,
        min_quality: Optional[float],
        estimated_tokens: Optional[int],
    ) -> bool:
        if not candidate.capabilities.supports(
            streaming=streaming, structured=structured, json_schema=json_schema
        ):
            return False
        if min_quality is not None and candidate.quality_score < min_quality:
            return False
        if estimated_tokens is not None and estimated_tokens > candidate.context_window:
            return False
        if candidate.min_eval_score is not None:
            measured = candidate.eval_score
            if measured is None or measured < candidate.min_eval_score:
                return False
        return True

    @staticmethod
    def _fallback_compatible(primary: ModelCandidate, fallback: ModelCandidate) -> bool:
        """Fallbacks must share the response contract and shape with the primary."""
        return (
            primary.response_contract == fallback.response_contract
            and primary.output_schema == fallback.output_schema
            and primary.capabilities.structured_output == fallback.capabilities.structured_output
            and primary.capabilities.supports_json_schema == fallback.capabilities.supports_json_schema
        )

    def resolve_alias(self, alias: Optional[str], feature: Feature | str) -> Optional[str]:
        """Resolve legacy GROQ_MODEL/LIGHT/HEAVY aliases to a policy model id."""
        if not alias:
            return None
        aliases = self._policy.get("aliases")
        if not isinstance(aliases, Mapping):
            return alias
        mapping = aliases.get(alias) or aliases.get(str(alias).lower())
        if isinstance(mapping, Mapping):
            value = mapping.get(_coerce_feature(feature).value) or mapping.get("default")
            return str(value) if value else alias
        return str(mapping) if mapping else alias

    def record_attempt(self, decision: ModelDecision, **kwargs: Any) -> AttemptRecord:
        return self.recorder.record(decision, **kwargs)


def capabilities_default_output() -> int:
    """Output ceiling from the shared limits module, with a local fallback."""
    try:
        from app.core.limits import MAX_OUTPUT_TOKENS

        return int(MAX_OUTPUT_TOKENS)
    except (ImportError, TypeError, ValueError):
        return 2_048


def env_int(name: str, default: Optional[int]) -> Optional[int]:
    raw = os.getenv(name)
    if raw is None or not str(raw).strip():
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return default
    return value if value >= 0 else default


def parse_kill_switch(raw: Optional[str]) -> tuple[str, ...]:
    if not raw:
        return ()
    return tuple(
        part.strip().lower().replace("-", "_")
        for part in str(raw).split(",")
        if part.strip()
    )


def load_policy_file() -> dict[str, Any]:
    """Load the shipped versioned policy JSON without touching secrets."""
    limit = _coerce_int(os.getenv("AI_MODEL_POLICY_MAX_BYTES"), _MAX_POLICY_BYTES, 1)
    limit = min(limit, _MAX_POLICY_BYTES)
    candidates: list[Path] = []
    configured = os.getenv("MODEL_POLICY_PATH")
    if configured:
        candidates.append(Path(configured))
    candidates.append(Path(__file__).resolve().parent.parent / "config" / "model_policy.json")
    for path in candidates:
        try:
            if not path.is_file() or path.stat().st_size > limit:
                continue
            with path.open("r", encoding="utf-8") as handle:
                data = json.load(handle)
            return dict(data) if isinstance(data, dict) else {}
        except (OSError, ValueError):
            continue
    return {}


def load_model_policy() -> dict[str, Any]:
    """Prefer an explicit JSON override; otherwise use the shipped policy file."""
    raw = os.getenv("MODEL_POLICY_JSON")
    if raw and raw.strip():
        try:
            data = json.loads(raw)
            if isinstance(data, dict):
                return data
        except (TypeError, ValueError):
            logger.warning("invalid MODEL_POLICY_JSON; using shipped policy")
    return load_policy_file()


def load_pricing_table(ref: Optional[str]) -> dict[str, Any]:
    """Load the operator-provided pricing table referenced by ``PRICING_TABLE_REF``.

    Prices are never hardcoded here: a missing/invalid file yields an empty
    table so all cost estimates remain unknown.
    """
    if not ref or not ref.strip():
        return {}
    path = Path(ref.strip())
    try:
        if not path.is_file() or path.stat().st_size > _MAX_POLICY_BYTES:
            return {}
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    models = data.get("models", data)
    return dict(models) if isinstance(models, Mapping) else {}


_default_router: Optional[ModelRouter] = None


def get_model_router() -> ModelRouter:
    """Process-wide router built from config; safe to replace in tests."""
    global _default_router
    if _default_router is None:
        _default_router = ModelRouter.from_env()
    return _default_router


__all__ = [
    "AttemptRecord",
    "AttemptRecorder",
    "BudgetHook",
    "BudgetState",
    "EvaluationScore",
    "Feature",
    "KillSwitch",
    "ModelCapabilities",
    "ModelCandidate",
    "ModelDecision",
    "ModelRouter",
    "NoopBudgetHook",
    "get_model_router",
    "load_model_policy",
    "load_pricing_table",
]
