# ADR-005: Mastery model MVP

- Status: Proposed (roadmap slice rel-40; decision and non-goals only)
- Date: 2026-11-28
- Scope: A document decision for the learning platform's skill/knowledge mastery signal. This ADR does not change code, Prisma schema, migrations, tests, UI, API routes or the roadmap checklist.
- Sources: `LinguaAI_Engineering_Roadmap.md` §PRODUCT-02/03 (lines 993–1038), sprint gate (line 1088), PR template (lines 1148–1167), ADR-005 deliverable (line 1183).
- Related: `docs/adr/ADR-003-operation-idempotency.md`, `docs/adr/ADR-004-modular-monolith.md`, `apps/api/src/proficiency/HANDOFF.md`.

## Context

The roadmap defines a learning loop: placement → plan → attempt → feedback → review → reassessment, with the sprint gate requiring that "mastery changes have evidence, without duplicates" (roadmap line 1088). PRODUCT-03 proposes a deliberately simple, rule-based and explainable mastery model rather than ML: a Beta-like evidence score that starts at a 0.5 prior, explicitly reports insufficient data while evidence is thin, and remains separate from FSRS scheduling (lines 1028–1038). PRODUCT-02 proposes the supporting records (`knowledge_items`, `knowledge_prerequisites`, `activity_knowledge_items`, `learner_mastery`, `mastery_events`, `learner_errors`) and requires idempotent evidence events, evidence source/confidence and no graph DB (lines 993–1026).

Current code already has a coarse proficiency signal: `ProficiencyService.recordEvidence(userId, SkillEvidence{language, skill, score, total, weight?})`, a `ProficiencyItem.needsMoreEvidence` flag, `MIN_EVIDENCE_FOR_CONFIDENT = 5`, and the `skill_proficiency` / `placement_attempts` tables from migration `20261128003000_skill_proficiency`. That signal is per language/skill and oriented toward placement; it is not a per-knowledge-item, attempt-level mastery record. A separate `mastery.service.ts` exists in the working tree but is peer-owned and outside this ADR's scope; nothing here assumes it is final.

Other owners' contracts are prerequisites, not existing guarantees of this slice:

- Knowledge-map owner: `knowledge_items` identity is `(language, code, version)`; `knowledge_prerequisites` must be validated against cycles; `activity_knowledge_items` carries mapping weights. This ADR assumes `knowledgeId` is stable and versioned.
- Attempt/learning owner: a durable `attemptId` with `activityType`, `activityId`, `contentVersion`, `language`, `score`/`total`, evidence source and confidence is required. Current `LearningService.completeScenario` / `completeSkillActivity` and the `learning_completions` upsert do not yet expose such an id; supplying it is a prerequisite for implementation, not a fact asserted here.
- SRS owner: `SrsService.reviewCard` replay semantics use `operationId` and `FsrsGrade`, with `getDueCards` for scheduling. FSRS remains the card scheduler.
- API owner: `userId` comes from JWT; `app.module.ts` registration is peer-owned per `apps/api/src/proficiency/HANDOFF.md`; any `/learning/mastery` or `/proficiency` route contract is future work.
- AI-service owner: AI feedback used as evidence must carry source, confidence and "unverified" status; LLM output cannot decide mastery authoritatively.

This ADR records the decision only. No measurement of learning effectiveness, accuracy, throughput or cost is claimed.

## Goal / non-goals

### Goal

Decide one explainable, conservative mastery rule and the boundaries of its evidence, so a later implementation slice can add per-knowledge-item state without creating a second authoritative proficiency store or changing scheduling.

### Non-goals

This ADR explicitly does **not** decide to:

- train, fine-tune or use an ML model to infer mastery, or claim any validated predictive accuracy;
- claim equivalence to a CEFR level or replace the existing placement/proficiency signal;
- replace, modify or reimplement FSRS scheduling, `reviewCard` replay or `getDueCards`;
- trust AI feedback as authoritative evidence, auto-promote unverified LLM judgments, or auto-accept learner corrections without the owning flow's rules;
- introduce a graph database, a new payment/monetization flow, or a mobile application;
- transfer a score across languages or across versions of a knowledge item;
- label a skill "mastered" after one correct answer or hide the "not enough data" state;
- delete, rewrite or migrate existing `skill_proficiency` / `placement_attempts` data;
- implement daily-plan generation, error-to-flashcard conversion, new routes, DI registration, schema/migrations or tests in this slice.

## Decision

### 1. One rule-based score, explicitly a heuristic

For a knowledge item keyed by `(language, code, version)`, maintain weighted success and failure evidence. With outcome `s ∈ [0, 1]` and weight `w`, add `w * s` to `success_weight` and `w * (1 - s)` to `failure_weight`. The displayed score is:

```text
mastery = (1 + success_weight) / (2 + success_weight + failure_weight)
```

The `1` and `2` are a Beta(1,1) prior: with no evidence, `mastery = 0.5`. This number is an **explanatory heuristic for UI and review prioritization**, not FSRS memory stability, not a probability of correctness with validated calibration, and not a CEFR instrument. No rollout claim about learning outcomes is made.

Implementation rules that follow from this decision (to be implemented by a later slice, not here):

- Weights are bounded and sourced: objective quiz/attempt outcomes are stronger evidence than unverified AI feedback; every event records `evidence_type`, `source` and `confidence`.
- Confidence is gated by `evidence_count` **and** evidence quality. `MIN_EVIDENCE_FOR_CONFIDENT = 5` is the existing coarse-signal threshold; the mastery slice must define its own documented threshold/quality rule before showing a confident label. Until then, low-evidence items display **"chưa đủ dữ liệu"** rather than a percentage presented as reliable.
- The score is computed from durable events, so it can be recomputed and explained (" successes vs failures, when last practiced "), rather than being an unexplained mutable number.
- A low score alone never blocks content; review suggestions use mastery together with `last_practiced_at`, prerequisites and the learner goal (PRODUCT-03). Full daily-plan generation is a separate slice.

### 2. Relationship to the existing proficiency signal

The coarse `skill_proficiency` / `placement_attempts` data remains the existing placement/proficiency record. The knowledge-level mastery signal **complements** it: per `(language, knowledge item version)`, backed by attempt-level events, used for review prioritization and explanation. It must not silently become a second authoritative store for the same fact:

- Implementation must consume `ProficiencyService`'s exported facade where a coarse language/skill signal is needed; it must not duplicate that table's writes under a new name.
- If a future API exposes a combined profile, it must label which value comes from placement/proficiency and which from knowledge-level mastery.
- This ADR does not authorize deletion, backfill or rewrite of existing proficiency rows.

### 3. Evidence, identity and idempotency

- Each evidence event is keyed by `(attempt_id, knowledge_id, evidence_type)`, matching the roadmap's `mastery_events` uniqueness intent, so an attempt retry or reconnect cannot update mastery twice (roadmap lines 1013–1015, 1026, 1037).
- The durable `attemptId` prerequisite must include `activityType`, `activityId`, `contentVersion`, `language`, `score`/`total`, evidence source and confidence. Missing or invalid evidence is rejected; it is not coerced into a success.
- Concurrent events for the same attempt are serialized in one database transaction or equivalent durable handler with a unique-constraint guard. A duplicate is a no-op replay of the stored result, not an increment.
- A version change of a knowledge item starts a new identity `(language, code, new version)`; old-version evidence is never silently transferred to the new version. Language isolation is enforced by the identity key.
- If SRS review is ever counted as mastery evidence, it needs a single explicit non-double-counting rule: one review/attempt maps to at most one evidence event for a given `(attempt_id, knowledge_id, evidence_type)`. FSRS still owns the card schedule; the review's grade is only an input to the evidence rule, never a replacement for it.
- AI feedback may enter only as `unverified`, low-confidence evidence with source recorded. It cannot alone produce a confident or "mastered" state, and the learner/report correction path stays with its owning flow.

### 4. Read model and API boundary

- Mastery state is persisted in PostgreSQL, consistent with `docs/adr/ADR-004-modular-monolith.md` (PostgreSQL is the source of truth; Redis is cache only).
- The API owns authorization (`userId` from JWT) and any future `/learning/mastery` or `/proficiency` contract. This ADR specifies no new route, controller, DTO, module registration or dependency injection wiring.
- UI must expose the evidence basis and the low-evidence state; it must not present a prior-only 0.5 as a measured result.

## Tasks (for the later implementation slice, not performed here)

- [ ] Prerequisite: durable attempt id with content version, source and confidence (attempt/learning owner).
- [ ] Knowledge item identity/version and prerequisite cycle validation (knowledge-map owner).
- [ ] Pure score function plus confidence gating and bounded weights.
- [ ] Evidence event persistence with `(attempt_id, knowledge_id, evidence_type)` uniqueness, transaction/concurrency handling and no-double-count rule for SRS reviews.
- [ ] Compatibility contract with `ProficiencyService`; no rewrite of existing placement data.
- [ ] Optional future API/UI surface labelled by source and with "chưa đủ dữ liệu" for low evidence.
- [ ] Docs and observability: record evidence source/confidence in logs without PII or raw learner text.

## Acceptance criteria (Given / When / Then)

- **Given** a fresh `(language, knowledge item, version)` with no events, **when** mastery is read, **then** the score is `0.5` from the prior and the UI reports **"chưa đủ dữ liệu"**, never "mastered".
- **Given** one successful objective attempt, **when** the event is recorded, **then** `success_weight += w * s`, `failure_weight += w * (1 - s)` and confidence remains gated; no "mastered" label is produced.
- **Given** a fractional score `s` in `[0, 1]` and weight `w` within its documented bounds, **when** the score is recomputed, **then** the formula above is applied exactly and the result stays in `(0, 1)`.
- **Given** the same `attemptId`, `knowledgeId` and evidence type delivered twice (retry, reconnect or concurrent duplicate), **when** both writes are processed, **then** exactly one evidence row and one weight increment exist.
- **Given** an event missing `language`, `knowledgeId`, `contentVersion`, `score`/`total`, source or confidence, **when** it is submitted, **then** it is rejected and no mastery state changes.
- **Given** equal evidence for the same knowledge code in two languages, or for two different versions, **when** mastery is read, **then** the values are independent; no cross-language or cross-version transfer occurs.
- **Given** an SRS review and an attempt event that could represent the same performance, **when** both are processed, **then** the documented no-double-count rule admits at most one evidence event.
- **Given** unverified AI feedback as the only evidence, **when** mastery is displayed, **then** the source is shown as unverified and the item is not confidently labelled.

## Evidence

This slice is documentation-only: no commands were run against application code, no screenshots were taken and no metrics were collected. No effectiveness, throughput, coverage or cost result is claimed. Acceptance criteria above are the tests to be executed and recorded by the implementation slice (pure-score cases for prior/success/failure/fractional score/weight bounds/language isolation/version change, confidence gating, duplicate-attempt idempotency, concurrent-attempt serialization, invalid/missing evidence rejection, and no-double-count between SRS review and attempt evidence).

## Risks and rollback

| Risk | Mitigation / rollback |
|---|---|
| Second authoritative proficiency store | Consume `ProficiencyService` facade; keep this signal per knowledge item/version; existing tables untouched. Rollback: remove the new read model, no data to migrate back. |
| Duplicate evidence on retry/concurrency | Unique `(attempt_id, knowledge_id, evidence_type)` plus transactional update; duplicates are no-ops. Rollback: stop writing new events, existing prior-based display still works. |
| False confidence from thin or AI-only evidence | Confidence gating, "chưa đủ dữ liệu" display, source/confidence labels; no single-answer "mastered". Rollback: raise the threshold or hide the score entirely. |
| Confusion with FSRS | Document that FSRS schedules cards; mastery only informs skill-level review priority. Rollback: ignore mastery for scheduling — no scheduler change exists to revert. |
| Missing durable attempt id | Treat as a prerequisite blocker; do not fabricate ids or coerce `learning_completions` into fake attempts. Rollback: none needed because nothing is implemented. |
| Version/language leakage | Include language and version in identity; test isolation. Rollback: hide affected items until identity is corrected. |

No code, schema or configuration is changed by this ADR, so rollback for this slice consists of reverting this document alone.
