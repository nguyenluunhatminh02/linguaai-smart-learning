# AI metadata lifecycle — prompt, model, version and cost

**Slice:** ai-30 (documentation only)
**Source of truth:** `LinguaAI_Engineering_Roadmap.md` lines 660–749 (AI-01 prompt registry, AI-02 structured output, AI-03 model routing and cost accounting, AI-04 cache design, AI-05 evaluation suite; Sprint 5 gate at line 749).
**Provenance observed:** `2026-11-28T03:38:39Z`; git HEAD `3be6aa39ad65fc7cfef22d75c84e40c5927b0389`; branch `main`; working tree dirty with many concurrent changes. This document is a **source-level inventory and contract proposal**, not a test report, cost report, or evaluation result.
**Scope rule:** this slice edited only `docs/ai-metadata.md`. No application source, schema, tests, `.env` file, token, key, credential, or provider endpoint value was read from local configuration or written here. Environment variable *names* appear only where source code exposes them.
**Status legend:** `PRESENT` = observed in the working tree; `PARTIAL` = declared but not wired end-to-end; `PLANNED` = contract proposed by this document; `NOT AVAILABLE` = no artefact found.

---

## 1. Why this document exists

Every AI result must be explainable after the fact: which prompt produced it, which model and configuration were used, which input/output contract was assumed, which locale was rendered, which provider attempts occurred, what usage and cost were observed or estimated, and whether an evaluation gate allowed that configuration to ship. Roadmap line 749 makes this a Sprint 5 gate: *each AI feature has prompt/model version, cost metadata and eval baseline; a model change must not break the contract; real cost is known before large quotas are opened.*

The current tree contains several pieces of this lifecycle but they are not connected:

| Capability | State | Evidence |
|---|---|---|
| Prompt registry with ID/version/locale/schema versions/changelog | `PRESENT` | `apps/ai-service/app/prompts/registry.py` (`PromptSpec`, `ModelConfig`, `PromptMetadata`, 8 registered specs) |
| Strict provider-attempt schema with token usage and micro-USD cost | `PRESENT` as schema | `apps/ai-service/app/models/provider_attempts.py` (`ProviderAttempt`, `TokenUsage`, `CostEstimate`) |
| Provider attempt dataclass + structured logs | `PRESENT` | `apps/ai-service/app/services/llm_client.py` (`ProviderAttemptMetadata`, context vars, `get_provider_attempts`) |
| Typed version-aware cache key | `PRESENT` as type | `apps/ai-service/app/services/cache.py` (`CacheKey`) |
| Cache key actually used by generation helper | `PARTIAL` | `apps/ai-service/app/utils.py:126-132` still uses legacy `{h,t,m,ctx}` key with no prompt/schema version |
| Model router with config version and `price_ref` | `PRESENT` as policy engine | `apps/ai-service/app/services/model_router.py`; not invoked by routers |
| FastAPI routers emitting metadata | `NOT AVAILABLE` | `apps/ai-service/app/routers/*.py` use legacy prompt modules; only chat SSE emits provider `usage` |
| Gateway request metadata headers | `PRESENT` (request side) | `apps/api/src/common/services/ai-client.service.ts:213-223` sends `X-AI-Feature`, `X-AI-Schema-Version`, `X-AI-Request-ID`, `X-AI-Deadline`, `X-AI-Operation-ID`, `X-AI-Envelope` |
| Durable AI operation with pricing version | `PARTIAL` | `apps/api/prisma/schema.prisma:684-709` has `pricing_version`; no prompt/model/schema columns and no provider-attempt table |
| Eval baseline | `NOT AVAILABLE` as result | `docs/ai-eval-baseline.md` is an explicit `TEMPLATE — NO EVALUATION HAS BEEN RUN`; `apps/ai-service/evals/` contains a schema file and a reading case file at observation time, not a runner result |

`PARTIAL` is the important word: these are building blocks, not proof that a production result can be reconstructed from stored metadata.

---

## 2. Non-negotiable rules

1. **No fabrication.** Missing provider usage stays `None`/unknown; never coerce it to `0`. Roadmap line 702: provider usage that is missing is marked `unknown/estimated`, not invented. `TokenUsage` already models this with optional fields and rejects booleans/negatives (`provider_attempts.py:76-115`).
2. **No secrets or prompt bodies in telemetry.** Provider is a hostname only (`llm_client.py:454-457`); error type is a class name, never raw exception text (`llm_client.py:169-204`); `ProviderAttempt.to_log_fields()` and `to_metric_labels()` exclude operation ID, user ID, prompt and raw errors (`provider_attempts.py:237-279`). Preserve this when adding fields.
3. **Learning credits are not provider tokens.** `ai_operations.reserved_credits`/`charged_credits` and `AI_OPERATION_COSTS` are the learner-facing catalog price in credits (`apps/api/src/ai-operations/ai-operations.policy.ts:36-50,111-115`). `prompt_tokens`/`completion_tokens`/`total_tokens` are provider usage. `cost_micro_usd` is a separate provider-cost estimate in 1/1,000,000 USD (`provider_attempts.py:118-138`). Do not present one as the other, and do not adjust learner credits from a provider-cost estimate.
4. **Price values are versioned config, not permanent code.** `ModelCandidate.price_ref` points into a versioned pricing table (`model_router.py:82-96,287-304`); `ai_operations.pricing_version` stores the gateway catalog version. A price change requires a new `pricing_version`, never an in-place edit that reinterprets old rows.
5. **Published prompt versions are immutable.** Change the version, the changelog, and re-run eval regression (roadmap lines 667-669). `get_prompt(version=...)` supports explicit pinning (`registry.py:626-642`), which is the rollback mechanism.
6. **Untrusted input stays data.** System templates contain only allowlisted server values; learner data is wrapped and rendered only into explicit user fields (`registry.py:419-445`). Do not interpolate arbitrary input into instructions, SQL, HTML, code, or authorization decisions (roadmap lines 667, 686).
7. **Evidence is dated and attributed.** An unexecuted command has no exit code; a template is not a run; an empty cell means no observation, not zero, pass, or failure (same convention as `docs/ai-eval-baseline.md:5-9`).

---

## 3. Metadata contract

### 3.1 Canonical fields

| Field | Canonical form | Owner / source of truth | Present today | Notes |
|---|---|---|---|---|
| `prompt_id` | Stable dotted ID, e.g. `chat.tutor` | `registry.py:363-377` (`PromptSpec.id`) | `PRESENT` | Never derived from a model name or route path. |
| `prompt_version` | Registry integer `1`; wire string `v<major>.<minor>` mapped from integer as `v<integer>.0` | `registry.py:366`, `PROMPTS` key at `:402-404` | `PRESENT` | Wire string is `PLANNED`; keep registry integer as the backing value to avoid breaking existing specs. |
| `wire_prompt_key` | `<prompt_id>-v<major>.<minor>`, e.g. `chat.tutor-v1.0` | This document | `PLANNED` | Stable, low-cardinality label for headers, DB columns, metrics and eval rows. |
| `locale` | `en` baseline; `SUPPORTED_LOCALES = {"en"}` | `registry.py:38-39` | `PRESENT` | Unknown locale fails closed with `KeyError`; no silent fallback to `en`. |
| `input_schema_version` | `v1` | `registry.py:44,373` | `PRESENT` | Mirrors Pydantic request models; bump on request field changes. |
| `output_schema_version` | `v1` | `registry.py:45,374` | `PRESENT` | Mirrors Pydantic response models; bump on response field changes. |
| `response_model` | Class name, e.g. `ChatResponse` | `registry.py:377` | `PRESENT` | Metadata only; actual validation lives in `app.models.schemas`. |
| `model_alias` | `light` or `heavy` | `registry.py:341-359` | `PRESENT` | Deployment swaps the configured provider model without editing a prompt. |
| `resolved_model` | Provider model ID resolved at call time | `registry.py:659-665`, `settings.groq_model_light/heavy` | `PRESENT` in code, not emitted | Never copy a provider credential into this field. |
| `model_config` | `temperature`, `max_tokens`, router `config_version` | `registry.py:341-359`, `model_router.py:123-136` | `PRESENT` in code, not emitted | `max_tokens=None` means service default (`registry.py:351`). |
| `policy_version` | e.g. `rel-03.1` in current source | `llm_client.py:39,135-136`, `model_router.py:31` | `PRESENT` for retry/router policy | Keep separate from prompt version and pricing version. |
| `pricing_version` | Version string for a price catalog | `ai_operations.pricing_version` (`schema.prisma:690`), `model_router.py:263`, `provider_attempts.py:126-138` | `PRESENT` in DB + router | Gateway credit price and provider unit price are different catalogs; record both versions when both are used. |
| `price_ref` | Stable key into a versioned price table | `model_router.py:91,287-304` | `PRESENT` in router | Unresolvable `price_ref` means cost stays unknown; never invent a number. |
| `cost_micro_usd` | Non-negative integer, microdollars | `CostEstimate` (`provider_attempts.py:118-138`) | `PRESENT` as schema, not persisted | Store with `is_estimated` and `pricing_version`; omit when unknown. |
| `operation_id` | Opaque bounded ID; allow-list `^[A-Za-z0-9._:~-]{1,128}$` | `chat.py:35`, `provider_attempts.py:160-186` | `PRESENT` | Gateway `ai_operations.id` is a UUID; if a caller-supplied opaque ID is used instead, label it explicitly and do not pretend it is the DB primary key. |
| `request_id` | Bounded diagnostic ID | `ai-client.service.ts:57-64,194-222` | `PRESENT` request side | Correlates gateway ↔ AI service; not a prompt version. |
| `changelog` | Non-empty immutable tuple of strings | `registry.py:376,379-388,485` | `PRESENT` | Required by `PromptSpec.__post_init__`; new version, new entry. |

### 3.2 Current registered prompt inventory

Observed from `apps/ai-service/app/prompts/registry.py:487-602`. All eight specs are `version=1`, `locale="en"`, `input_schema_version="v1"`, `output_schema_version="v1"`, `max_tokens=None`, and share `V1_CHANGELOG`. These are declarations, not evaluation results or measured runtime configurations.

| `prompt_id` | Model alias | Temperature | Response model |
|---|---|---:|---|
| `chat.tutor` | `heavy` | 0.7 | `ChatResponse` |
| `writing.assess` | `heavy` | 0.3 | `WritingAssessResponse` |
| `grammar.explain` | `light` | 0.5 | `GrammarExplainResponse` |
| `reading.generate` | `heavy` | 0.7 | `ReadingGenerateResponse` |
| `cards.generate` | `heavy` | 0.4 | `GenerateCardsResponse` |
| `quiz.generate` | `heavy` | 0.5 | `GenerateQuizQuestionsResponse` |
| `nlp.analyze` | `light` | 0.2 | `NlpAnalyzeResponse` |
| `errors.analyze` | `light` | 0.4 | `ErrorAnalysisResponse` |

There is a `prompts/speaking/` directory in the tree, but no `speaking.*` spec in `PROMPTS`. Speaking must not be assigned a prompt ID/version by inference; register it or record `NOT AVAILABLE` in eval and cost reports. `docs/ai-eval-baseline.md:77` uses exactly that conservative treatment.

### 3.3 Two schema versions that must not be confused

- **Prompt data schema**: `registry.py` `input_schema_version` / `output_schema_version`, currently `v1`. This describes the Pydantic shape a prompt expects and returns.
- **Gateway wire envelope schema**: `AI_SCHEMA_VERSION = '1.0.0'` in `apps/api/src/common/services/ai-client.service.ts:7`; sent as `X-AI-Schema-Version` (`:213-223`) and checked during envelope unwrap (`:229-245`). This describes the NestJS ↔ FastAPI envelope.

They may change independently. A wire-envelope bump is not a prompt-output schema bump, and a prompt-output bump does not automatically change the envelope. Record both when debugging a contract break.

---

## 4. Lifecycle

```text
author/version prompt
  -> register (immutable PromptSpec + changelog)
  -> render (allowlisted server fields + wrapped learner data)
  -> select model (alias/config version/price_ref, budget + kill switch)
  -> cache lookup (versioned key; schema validation on hit)
  -> provider call (attempt records: host, model, latency, tokens, outcome)
  -> result + metadata emission (HTTP headers / SSE completed / structured log)
  -> gateway persistence (ai_operations metadata + ai_provider_attempts)
  -> eval regression + cost review
  -> pin current version or rollback to an older registered version
```

### Stage 1 — Author and register (AI-01)

1. Create a new `PromptSpec` rather than editing a published template. Keep `id`, `version`, `locale`, schema versions, `ModelConfig`, `changelog`, and `response_model` explicit (`registry.py:341-388`).
2. Keep system and user templates separate. `PromptSpec.__post_init__` requires the set of `str.format` fields to equal the allow-list exactly; extra or missing fields raise `ValueError` (`registry.py:379-400`).
3. Add snapshot tests for render, escaping and context limits (roadmap line 669). Existing registry tests live at `apps/ai-service/tests/test_prompt_registry.py`.
4. Do not enable the new version in a routing path until eval regression passes (roadmap line 668). Rollback is `get_prompt(prompt_id, locale=..., version=<previous>)`; no prompt file deletion is required.

### Stage 2 — Render and validate (AI-02)

`render()` returns `RenderedPrompt(system, user, metadata)` (`registry.py:474-478`). The metadata is a frozen `PromptMetadata` with `model_dump()` (`registry.py:448-471`). Call sites must pass that same object to cache keys, logs and response metadata; do not rebuild it from route-local strings.

Response validation remains Pydantic-based. `ai_json_request()` parses JSON, validates with `response_model`, retries once at temperature `0.1` on parse/schema failure, and rejects invalid cached entries rather than serving them (`utils.py:136-197`). The retry's effective temperature belongs in the cache key so a parse-failure retry cannot be confused with the original setting (`utils.py:120-132`).

### Stage 3 — Select a model (AI-03)

`ModelRouter` already provides a versioned decision surface: `Feature`, `ModelCandidate` (model ID, provider, capabilities, `config_version`, `price_ref`, `response_contract`, `output_schema`, eval score), `ModelDecision`, `BudgetState`, `BudgetHook`, a telemetry emitter, kill switches, and fail-closed behaviour when budgets are exhausted (`model_router.py:40-136,168-220,440-520`). It is not wired into routers at observation time.

Rules for the wiring follow-up:

- Select by feature + required capabilities + eval score + budget; a fallback must satisfy the same capability contract (roadmap line 699).
- Record both the alias/config used for selection and the resolved provider model actually sent.
- `price_ref` resolves against a versioned pricing table. Prices are never hardcoded as permanent truth (roadmap line 700).
- Do not switch a feature's primary model without a blind A/B eval record with quality, latency, tokens and cost side by side (roadmap line 737; `docs/ai-eval-baseline.md:135-141` is still `NOT RUN`).

### Stage 4 — Cache (AI-04)

`CacheKey` already encodes the right dimensions:

```text
linguaai:v1:{feature}:{prompt_version}:{schema_version}:{tenant}:{locale}:{model}:{temperature}:{input_hash}
```

(`apps/ai-service/app/services/cache.py:22-85`). Components are sanitized/bounded and the entire key is hashed if it exceeds `_MAX_KEY_LENGTH`.

The gap: `ai_json_request()` still calls `cache_service.get_cached("ai", **cache_kwargs)` with legacy fields `{h, t, m, ctx}` where `h` hashes `system␟prompt` and `ctx` is a context label (`utils.py:126-137`). That key has no prompt version, schema version, locale or tenant scope. A prompt edit with identical rendered text in a different schema version could reuse an old entry.

Required cache rules:

- Use the typed `CacheKey` for generation paths; include prompt version, resolved model, effective temperature, locale, canonical input hash, schema version and tenant scope for private data (roadmap line 708).
- Never share cache across users for transcripts, personal feedback or conversation history (line 709).
- Validate cached output against the current Pydantic response model before returning it (line 710; already partially implemented in `utils.py:139-155`).
- Use single-flight/lock TTL with ownership for stampede control, but never treat a cache lock as a billing guarantee (line 711).
- Do not cache provider errors as successes; short negative caching only where policy allows (line 712).
- Semantic caching only after an eval proves equivalence; never for graded/scored work (line 713).

Versioned keys cause a one-time cold-cost spike on rollout. Record it as a rollout cost, not as an efficiency regression.

### Stage 5 — Provider attempts and cost (AI-03)

The transport layer emits immutable `ProviderAttemptMetadata` records with `attempt`, `feature`, `provider` (hostname only), `model`, `mode`, `operation_id`, `request_id`, `policy_version`, `started_at_ms`, `duration_ms`, `outcome`, `status_code`, `error_type`, `retryable`, `ttft_ms`, partial tokens, token counts and `usage_known` (`llm_client.py:169-204`). Each attempt is appended to a context-local tuple and logged once as a structured field (`:267-276,352-377`). `bind_provider_context`/`reset_provider_context` scope feature, operation ID and attempts to one logical request (`:229-255`).

The strict schema in `provider_attempts.py` converts these to storable records via `ProviderAttempt.from_metadata()` (`:281-336`). The outcome mapping is explicit:

| `llm_client` outcome | `ProviderAttemptOutcome` |
|---|---|
| `success` | `SUCCESS` |
| `terminal_failure`, `retryable_failure` | `FAILURE` |
| `partial_failure` | `PARTIAL` |
| `timeout` | `TIMEOUT` |
| anything else / disconnect | `UNKNOWN` |

Cost rules:

- `usage=None` when no token field is present; `usage_known=False` when the provider returned no usable usage (`llm_client.py:398-411`).
- `CostEstimate` requires an amount and a non-empty bounded `pricing_version`, and defaults `is_estimated=True` (`provider_attempts.py:118-138`).
- `ModelRouter` keeps cost unknown when input/output tokens or the price entry are unavailable (`model_router.py:306-380`). Use `estimate_cost()` only with a resolved `price_ref` and a versioned table.
- Provider attempts are recorded for health probes too (`llm_client.py:761-798`). Exclude non-billable health attempts from cost dashboards, but keep them for reliability metrics.

### Stage 6 — Emit metadata (transport contract)

Current state:

- FastAPI JSON routes return only their declared Pydantic response bodies; no prompt/model metadata headers were found.
- Chat SSE currently emits `accepted` (operation/conversation IDs), `delta`, and `completed` with `operationId` plus `usage` only when the provider actually returned it (`chat.py:3-13,138-178`). `usage` comes from `llm_client.last_stream_usage`, a raw dict in context-local storage (`llm_client.py:277-290,459-462`).
- Gateway requests already carry `X-AI-Feature`, `X-AI-Schema-Version`, `X-AI-Request-ID`, `X-AI-Deadline`, `X-AI-Operation-ID`, `X-AI-Envelope` (`ai-client.service.ts:213-223`).

Proposed additive contract (`PLANNED`; do not treat as implemented):

| Surface | Proposed fields | Compatibility rule |
|---|---|---|
| JSON response headers | `X-AI-Prompt-ID`, `X-AI-Prompt-Version`, `X-AI-Model`, `X-AI-Model-Config-Version`, `X-AI-Input-Schema-Version`, `X-AI-Output-Schema-Version`, `X-AI-Locale`, `X-AI-Pricing-Version`, `X-AI-Cost-Status` (`known`/`estimated`/`unknown`) | Additive only; omit a header when the value is unknown rather than writing `0`/`none`. Keep existing response bodies byte-compatible. |
| Chat SSE `completed` | `metadata: {prompt_id, prompt_version, locale, model, model_config_version, input_schema_version, output_schema_version, policy_version, pricing_version, cost_status}` alongside the existing `usage` | Preserve existing event names, `seq`, and `usage`; clients that ignore `metadata` must keep working. |
| Structured log | `ai_result` with bounded metadata fields + `provider_attempt` group already present | No prompt text, user text, raw response, headers or credentials. |
| Gateway request headers | Keep existing `X-AI-*` headers; add optional budget/eval headers only when a caller opts in | A missing metadata header must not break the current adapter. |

Low-cardinality metric labels should be limited to feature, prompt ID/version, model, policy version, outcome and cost status. Operation ID and request ID belong in correlated logs, not high-cardinality metric labels.

### Stage 7 — Persist (gateway)

`ai_operations` currently stores `pricing_version`, `reserved_credits`, `charged_credits`, status, lease/version fields, `request_hash`, `conversation_id`, `result_ref` and `error_code` (`schema.prisma:684-709`). `AiOperationsService.findOrCreate()` hashes a canonical payload and stores the server-side pricing version (`ai-operations.service.ts:63-104`); there are no prompt/model/schema columns and no provider-attempt table.

Planned expand/contract migration (`PLANNED`, not applied by this slice):

- Add nullable columns to `ai_operations`: `prompt_id`, `prompt_version`, `wire_prompt_key`, `resolved_model`, `model_config_version`, `input_schema_version`, `output_schema_version`, `locale`, `policy_version`, `provider_pricing_version`, `cost_status`, `cost_micro_usd`, `cost_is_estimated`. Keep the existing credit `pricing_version` under its current name; do not repurpose it for provider prices.
- Add `ai_provider_attempts` keyed by a new UUID, with `operation_id` referencing `ai_operations.id` when the gateway owns one, plus attempt number, provider host, model, mode, latency, TTFT, outcome, error code, token counts, `usage_known`, `price_ref`, `pricing_version`, `cost_micro_usd`, `is_estimated`, and `created_at`. Never store prompt bodies or raw provider text.
- Backfill old rows with `NULL`/`unknown` for new metadata; never synthesize versions for historical results.
- Follow `DB-05` (`schema.prisma` migration safety) and `docs/migration-safety.md`: one migration job per release, nullable expand first, backfill, switch readers/writers, then contract in a later release. Avoid long locks and keep the app compatible with both schema states.

### Stage 8 — Evaluate, gate, roll back (AI-05)

- Every prompt-version or model change requires an eval regression entry keyed by `wire_prompt_key` + resolved model + config version + locale + schema versions, with quality, latency, token and cost fields (`docs/ai-eval-baseline.md:151-158`).
- `docs/ai-eval-baseline.md` is still a template: no run, no thresholds, no results. `apps/ai-service/evals/` having a schema and case file is not proof an evaluator ran. Do not enable model routing/fallback as an automatic quality decision before that baseline exists.
- LLM-as-judge is advisory and must not be the same model self-certifying absolute quality (roadmap line 736).
- Rollback means pinning a previously registered prompt version and/or reverting a router config version; record the reason, the failing eval case IDs and the new PR/release reference in the changelog.

---

## 5. Worked example (illustrative, not measured)

```json
{
  "request_id": "<bounded-request-id>",
  "operation_id": "<gateway-owned-uuid-or-opaque-id>",
  "feature": "writing_feedback",
  "prompt": {"id": "writing.assess", "version": "v1.0", "locale": "en", "changelog": "v1: initial registry snapshot of the existing prompt templates"},
  "model": {"alias": "heavy", "resolved_id": "<configured-at-call-time>", "config_version": "<router-policy-version>", "policy_version": "<retry-policy-version>"},
  "schemas": {"input": "v1", "output": "v1", "response_model": "WritingAssessResponse", "wire_envelope": "1.0.0"},
  "usage": {"prompt_tokens": null, "completion_tokens": null, "total_tokens": null, "status": "unknown"},
  "cost": {"status": "unknown", "amount_micro_usd": null, "price_ref": "<configured-price-ref>", "pricing_version": "<catalog-version>", "is_estimated": true},
  "attempts": [
    {"attempt": 1, "provider": "<hostname-only>", "model": "<configured-at-call-time>", "latency_ms": "<measured>", "outcome": "success", "usage_known": false}
  ]
}
```

Angle-bracket values are placeholders. `null` means unknown, not zero. No provider ID, price value, learner text, key or `.env` value is asserted here.

---

## 6. Acceptance checklist for the Sprint 5 gate

- [ ] Every routed feature resolves to exactly one registered `prompt_id`/version/locale and one `wire_prompt_key`; speaking is registered or explicitly `NOT AVAILABLE`.
- [ ] Prompt edits create a new immutable version with changelog and a render/escaping/context snapshot test.
- [ ] Response bodies are validated against a named `response_model` with an explicit `output_schema_version`; malformed JSON and truncated output fail safely with bounded retries.
- [ ] Cache keys use prompt version, resolved model, effective temperature, locale, canonical input hash, schema version and tenant scope; cached payloads are schema-validated before use.
- [ ] Every provider attempt produces a bounded record with operation correlation, host/model, latency, TTFT where applicable, outcome, token usage (or unknown), and cost status.
- [ ] Cost estimates cite `price_ref` + `pricing_version` + estimation method; unknown stays unknown; credit price and provider cost are stored separately.
- [ ] Gateway durability holds prompt/model/schema metadata on `ai_operations` and attempt rows in `ai_provider_attempts`, with an expand/contract migration and backward-compatible readers.
- [ ] A real eval baseline exists and gates prompt/model changes; blind A/B reports include quality, latency, tokens and cost; no official-band or learning-efficacy claim without evidence.
- [ ] Each new metadata field is tested in `apps/ai-service/tests/` and `apps/api/src/ai-operations/*.spec.ts`; an end-to-end test follows one operation from request headers through SSE/JSON response to persisted attempts.

No test was executed by this documentation slice. Commands for a future owner (all **NOT RUN** here): `pytest apps/ai-service/tests` from `apps/ai-service`, `pnpm --filter api test` from the repository root, Prisma validate/migration checks in a disposable database, and the eval runner once it exists.

---

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| One-time cache miss/cold cost when versioned keys are introduced | Deploy during a controlled window; record miss rate and provider cost separately from steady-state metrics. Do not flush shared keys blindly. |
| Prisma migration lock or lock contention | Nullable expand first, backfill in batches, one migration job per release, contract only after readers/writers switch. |
| Older clients ignoring new headers/SSE fields | Additive contract; existing fields unchanged; omit unknown values instead of sending placeholders. |
| Prompt registry drift from legacy prompt modules | Until all routers import `registry.render()`, record the legacy module as the effective prompt source and mark metadata `PARTIAL`; add a test that compares rendered bytes for each version. |
| Cost-estimate variance or missing provider usage | Keep `cost_status` and `is_estimated`; store method and pricing version; dashboards separate measured from estimated values. |
| Tracking latency or telemetry growth | Use the existing bounded dataclass/schema fields, low-cardinality metric labels, and one structured log line per attempt. |
| Schema-version drift between registry, Pydantic models and wire envelope | Keep the two version namespaces distinct; add contract tests that fail when a field changes without a version bump. |
| No eval baseline, so routing changes are unverified | Keep `ModelRouter` unwired for automatic selection; require a recorded eval run before any fallback/routing enablement. |
| Historical operations cannot be annotated retrospectively | Leave new columns `NULL`/`unknown`; never backfill invented prompt, model, token or cost values. |

---

## 8. Follow-ups outside this slice (recorded, not changed)

1. Wire `registry.render()` into `apps/ai-service/app/routers/{chat,writing,grammar,reading,content,errors,nlp}.py` and emit `PromptMetadata`.
2. Replace the legacy `ai_json_request` cache kwargs with typed `CacheKey`.
3. Convert `ProviderAttemptMetadata` through `ProviderAttempt.from_metadata()` and persist attempts behind the gateway.
4. Add metadata columns/table via a reviewed Prisma migration; regenerate the client only after that migration.
5. Extend the API DTO/repository/service to accept and persist metadata; keep `request_hash` semantics unchanged.
6. Add the eval runner and a first dated baseline before enabling routing/fallback.
7. Register a speaking prompt spec or keep speaking explicitly out of eval/cost claims.

These are intentionally not performed here: the assigned path for this slice was `docs/ai-metadata.md` only.
