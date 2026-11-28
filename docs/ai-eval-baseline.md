# AI-05 / TEST-13 evaluation report — template, not a result

**Status: TEMPLATE — NO EVALUATION HAS BEEN RUN FOR THIS REPORT.** Every result field below is a placeholder, `NOT RUN`, `NOT AVAILABLE`, or `UNKNOWN`. No pass, score, latency, token count, or cost is asserted.

## 0. Explicit no-fabrication rule (verbatim contract for this file)

> Every figure must cite a recorded command, timestamp, exit code and git SHA; an unexecuted command is "NOT RUN" and never "green"; a number from an older tree is "STALE (superseded by ...)" as docs/baseline.md section 6 already does for 74 passed/6 failed vs 1 failed/95 passed; missing provider usage is "unknown/estimated" with estimation method, never invented; synthetic cases are labeled synthetic; no real learner text or PII; no token, key, credential or local .env value may be copied into the report; LLM-as-judge is advisory only and never the same model self-certifying quality; no claims of official band score or proven learning efficacy without measured evidence (roadmap lines 739, 1077, 1188).

Additional rule for this template: an empty cell means "no recorded evidence", not zero, not a failure, and not a pass. A future author must fill the cells from evaluator artifacts and re-run instructions in section 9, then change the header status only after that evidence exists.

## 1. Provenance

| Field | Value |
|---|---|
| Report file | `docs/ai-eval-baseline.md` (created by slice ai-25; this file) |
| Report observation timestamp | `2026-11-28T03:36:45Z` |
| Git HEAD | `3be6aa39ad65fc7cfef22d75c84e40c5927b0389` |
| Branch | `main` |
| Working tree | Dirty. Many modified tracked files plus untracked AI-service prompt/registry/test files, API and web files, and other `docs/` reports were present at observation time (see `git status --short`). No eval run is attributed to this tree. |
| Roadmap scope | `LinguaAI_Engineering_Roadmap.md` AI-05 lines 715–749; TEST-13 line 832; supporting lines 739, 858, 1077, 1188 |
| Cross-link | `docs/baseline.md` remains the authoritative general baseline. This file is AI-eval-specific only and does not overwrite or restate its counts as current. See its section 6 for the `STALE (superseded by ...)` pattern. |
| General test counts observed elsewhere | `74 passed / 6 failed` in `docs/baseline.md` §3–4 is **STALE (superseded by `1 failed, 95 passed` in §6)**; neither count is an AI eval result. |
| Secrets policy | No `.env` file, token, key, credential, provider endpoint with credentials, real learner text, or PII was read or copied to produce this report. Model IDs below are aliases/source fields only, not resolved provider configuration. |

## 2. Scope and case inventory

The roadmap proposes `apps/ai-service/evals/` with 100–200 synthetic or appropriately licensed cases as an **initial target, not an existing dataset** (roadmap line 717). At the observation timestamp that directory did not exist. Therefore the dataset path, case count, and every per-case result are `NOT AVAILABLE`.

| Stratum key | Feature | Language(s) | Level(s) | Source label | Dataset path | Case count | Run status |
|---|---|---|---|---|---|---|---|
| S01 | `writing_feedback` | english | A2 | NOT AVAILABLE (must be `synthetic` or `licensed`) | NOT AVAILABLE | NOT AVAILABLE | NOT RUN |
| S02 | `grammar` | english | A1–B1 | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT RUN |
| S03 | `reading_generation` | english | A1–B2 | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT RUN |
| S04 | `chat` | english | A1–C1 | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT RUN |
| S05 | `translation` / meaning equivalence | english | A1–B2 | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT RUN |
| S06 | `content_generation` (cards/quiz) | english | A1–B2 | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT RUN |
| S07+ | Any added language × level cell | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT RUN |

Language and level values above are planned strata from the roadmap and the registered prompt fields, not evidence of collected cases. Input language for learner-facing prompts is `en` in the prompt registry; target language (for example `english`) is a separate rendered field. The registry source was read read-only; no configuration values were resolved.

### Case record shape (proposed, not populated)

Per roadmap lines 719–732, a golden case must carry `id`, `feature`, `language`, `level`, `input`, and `expected` with `mustDetect`, `mustNotClaim`, and `schemaValid`. No example below is a measured case; it is a format skeleton with placeholder strings.

```json
{
  "id": "<CASE_ID>",
  "feature": "<FEATURE_LABEL>",
  "language": "<TARGET_LANGUAGE>",
  "level": "<LEVEL>",
  "source": "synthetic | licensed",
  "input": {"text": "<SYNTHETIC_OR_LICENSED_TEXT>"},
  "expected": {
    "mustDetect": ["<DETERMINISTIC_EXPECTATION>"],
    "mustNotClaim": ["<FORBIDDEN_CLAIM>"],
    "schemaValid": true
  }
}
```

`source` is an added report requirement: a case without `synthetic` or `licensed` provenance is not admissible. Do not copy real learner text into a case. The roadmap's `writing-en-a2-001` example is documentation from the roadmap, not a corpus file in this tree.

## 3. Prompt, model, and schema metadata

Source read: `apps/ai-service/app/prompts/registry.py` (8 `PromptSpec` declarations observed), `apps/ai-service/app/models/provider_attempts.py`, and `apps/ai-service/app/services/llm_client.py`. These are source declarations only; no prompt was rendered and no model was called for this report.

| Prompt ID | Version | Locale | Model alias / config | Input schema | Output schema | Response model | Changelog | Evaluated? |
|---|---|---|---|---|---|---|---|---|
| `chat.tutor` | 1 | `en` | `heavy`, temperature `0.7` | `v1` | `v1` | `ChatResponse` | `v1: initial registry snapshot of the existing prompt templates` | NOT RUN |
| `writing.assess` | 1 | `en` | `heavy`, temperature `0.3` | `v1` | `v1` | `WritingAssessResponse` | `v1: initial registry snapshot of the existing prompt templates` | NOT RUN |
| `grammar.explain` | 1 | `en` | `light`, temperature `0.5` | `v1` | `v1` | `GrammarExplainResponse` | `v1: initial registry snapshot of the existing prompt templates` | NOT RUN |
| `reading.generate` | 1 | `en` | `heavy`, temperature `0.7` | `v1` | `v1` | `ReadingGenerateResponse` | `v1: initial registry snapshot of the existing prompt templates` | NOT RUN |
| `cards.generate` | 1 | `en` | `heavy`, temperature `0.4` | `v1` | `v1` | `GenerateCardsResponse` | `v1: initial registry snapshot of the existing prompt templates` | NOT RUN |
| `quiz.generate` | 1 | `en` | `heavy`, temperature `0.5` | `v1` | `v1` | `GenerateQuizQuestionsResponse` | `v1: initial registry snapshot of the existing prompt templates` | NOT RUN |
| `nlp.analyze` | 1 | `en` | `light`, temperature `0.2` | `v1` | `v1` | `NlpAnalyzeResponse` | `v1: initial registry snapshot of the existing prompt templates` | NOT RUN |
| `errors.analyze` | 1 | `en` | `light`, temperature `0.4` | `v1` | `v1` | `ErrorAnalysisResponse` | `v1: initial registry snapshot of the existing prompt templates` | NOT RUN |
| `speaking.feedback` | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT RUN |

Notes: the registry holds prompt directories for `chat`, `grammar`, `speaking`, and `writing`, but the observed `PROMPTS` mapping declares the eight IDs in the table. A speaking prompt ID/version must be recorded from the registry or evaluator output before any speaking eval result can be accepted; it is not inferred here. Provider model IDs are resolved at call time from settings (`light`/`heavy` aliases via `resolve_model`, and provider policy version from `llm_client.py`); no resolved ID or setting value is copied into this template. `max_tokens` is `None` for all eight specs (inherits service default) per source inspection, not a measured runtime value.

## 4. Rubric and metric definitions — thresholds declared before any run

These are definitions only. No thresholds were met or missed because no evaluation ran. Declare numeric thresholds here **before** executing an eval; changing a threshold after seeing results requires a new report version with a changelog entry.

| Metric | Definition / evidence source | Threshold before run | Status |
|---|---|---|---|
| Correctness | Deterministic match against `expected.mustDetect`; forbidden claims from `mustNotClaim` absent | NOT SET (owner must declare before run) | NOT RUN |
| Helpfulness | Human-labeled rubric: response advances the learner's stated task without padding | NOT SET | NOT RUN |
| Specificity | Human-labeled rubric: cites the exact error/evidence in the input, not generic advice | NOT SET | NOT RUN |
| Language level | Target CEFR-level vocabulary/complexity judged against the case's `level` | NOT SET | NOT RUN |
| Factual grounding | Claims are supported by the case input or licensed source; no invented evidence | NOT SET | NOT RUN |
| Safety | Prompt-injection/untrusted-input cases do not reveal system rules or follow embedded instructions | NOT SET | NOT RUN |
| Schema validity | Pydantic response model validation; `expected.schemaValid` + deterministic parse check | NOT SET (suggested: 100% on critical cases, but not adopted without owner declaration) | NOT RUN |
| Critical-case regression gate | Release blocked on large regression over critical cases (roadmap line 738) | NOT SET | NOT RUN |

Evaluation order: deterministic checks first (schema, mustDetect/mustNotClaim, exact answerability), then human-labeled reference where needed, then LLM-as-judge as advisory only. The judge must not be the same model self-certifying its own output as absolute quality (roadmap line 736). IELTS-style feedback, if evaluated, is labeled `estimate`/`practice` only; no official band or score guarantee (line 739). No learning-efficacy claim without a pre/post measured study (lines 1077, 1188).

## 5. Execution matrix

No evaluator command exists in this tree. `apps/ai-service/evals/` was absent at `2026-11-28T03:36:45Z`; no runner version, command, or exit code is available. There is no `NOT RUN` command with an exit code — an unexecuted command has no exit code.

| Run ID | Exact command | Runner version | Mode | Timestamp (UTC) | Exit code | Status |
|---|---|---|---|---|---|---|
| EVAL-000 | NOT AVAILABLE (`apps/ai-service/evals/` absent) | NOT AVAILABLE | mock-backed default; live provider is opt-in and quota-controlled per roadmap line 858 | `2026-11-28T03:36:45Z` (template observation) | N/A — not executed | NOT RUN |
| EVAL-001+ | <TO BE FILLED FROM ACTUAL RUN LOG> | <TO BE FILLED> | mock / opt-in live | <TO BE FILLED> | <TO BE FILLED> | NOT RUN |

No live provider call was made. No API key, token, `.env` value, or credential was read. A run log must be retained with the command, timestamp, exit code, HEAD SHA, and tree state before any result cell may leave `NOT RUN`/`UNKNOWN`.

## 6. Results table — deliberately empty

`—` means no recorded observation. It does not mean zero, pass, or failure. Every future number must cite a run ID from section 5 and the provenance SHA in section 1.

| Run ID | Stratum | Passed | Failed | Total | Correctness | Helpfulness | Specificity | Level | Grounding | Safety | Schema validity | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| EVAL-000 | S01 | — | — | — | — | — | — | — | — | — | — | NOT RUN |
| EVAL-000 | S02–S06 | — | — | — | — | — | — | — | — | — | — | NOT RUN |

### Latency, tokens, and cost

Per AI-03 and `provider_attempts.py`, missing provider usage stays `None`/unknown and must never be coerced to 0. Latency/TTFT percentiles require measured samples; no sample exists here.

| Run ID | Stratum | Latency p50 / p95 (ms) | TTFT p50 / p95 (ms, streaming) | Tokens in / out | Cost status | Amount / pricing version | Estimation method |
|---|---|---|---|---|---|---|---|
| EVAL-000 | all | — / — | — / — | — / — | UNKNOWN | — / — | N/A — no run |
| future | future | MEASURED / ESTIMATED / UNKNOWN | MEASURED / ESTIMATED / UNKNOWN | MEASURED / ESTIMATED / UNKNOWN | MEASURED / ESTIMATED / UNKNOWN | <value + version, or —> | Required when status is ESTIMATED; e.g. observed tokens × recorded unit price with pricing version. Never invent a provider price. |

## 7. Failure corpus and issue links

No case has executed, so there is no failure corpus. Future entries must use stable case IDs and link an issue or follow-up slice; a failed case without an owner/issue is not considered triaged.

| Case ID | Stratum | Failure type | First observed error | Issue / follow-up link | Status |
|---|---|---|---|---|---|
| — | — | — | — | — | NO FAILURES RECORDED (NOT RUN, not zero failures) |

## 8. Blind A/B comparison

No blind prompt/model A vs B comparison was performed (roadmap line 737). A future comparison must hide prompt/model identity from scorers, record both configurations from section 3, and report quality, latency, tokens, and cost side by side from the same case set.

| A (prompt/model/version) | B (prompt/model/version) | Blind scorer method | Cases | Quality delta | Latency delta | Cost delta | Status |
|---|---|---|---|---|---|---|---|
| NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | — | — | — | — | NOT RUN |

## 9. Confidence, limitations, supersession, and re-run instructions

**Confidence:** high that no eval result exists in this tree at the observation timestamp; no confidence claim about model quality, cost, or latency is made.

**Limitations:** no `apps/ai-service/evals/` directory, golden cases, runner, run log, provider usage, or prompt-version evaluation log was found. Source declarations for prompts, provider-attempt schema, and retry policy exist but are not execution evidence. The working tree was dirty and concurrently changing, so any future result must carry its own SHA and timestamp. `docs/baseline.md` describes general test commands only; its pass/fail counts are not AI eval metrics and its superseded counts must not be quoted as current.

**Supersession:** this template supersedes nothing. When a real evaluation is run, add a new dated section with run ID, SHA, command, exit code, and case/result artifacts, and mark older metric tables `STALE (superseded by ...)`. Never delete the no-fabrication rule or the empty evidence trail.

**Re-run instructions for a future owner (all currently NOT RUN):**
1. From the repository root, record `git rev-parse HEAD`, `git branch --show-current`, `git status --short`, and `date -u +%Y-%m-%dT%H:%M:%SZ` in section 1.
2. Add the golden dataset under `apps/ai-service/evals/` (create the directory if absent) with the case shape in section 2, `synthetic`/`licensed` labels, and no learner PII.
3. Implement or identify the eval runner; record its exact version and invocation. Keep LLM calls mock-backed by default; use a live provider only as an explicit, quota-controlled opt-in with no key or `.env` value in the report.
4. Freeze thresholds in section 4 before running. Run deterministic checks first; add human labels where required; keep LLM-as-judge advisory and never self-certifying.
5. Save per-case records containing case ID, feature, language, level, prompt ID/version, locale, schema versions, model alias/config, deterministic results, rubric scores, latency, tokens, cost status plus estimate method, and outcome. Populate sections 5–8 from those records only.
6. Record the exit code and timestamp for each run. If a command was not executed, keep it `NOT RUN`; if provider usage is missing, keep it `UNKNOWN`; if an older result is replaced, mark it `STALE (superseded by ...)`.
7. Re-check the header status: remove `TEMPLATE — NO EVALUATION HAS BEEN RUN` only after sections 2–8 contain cited evidence for the same HEAD SHA and tree state.
