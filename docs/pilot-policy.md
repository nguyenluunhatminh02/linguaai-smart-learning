# Pilot Policy — LinguaAI

Status: **documented policy, not fully implemented**. This file defines the rules for a small, voluntary product pilot (roadmap PRODUCT-06). It does not by itself create a consent field, endpoint, analytics gate, retention job or any other runtime behaviour. Every "must" below is a target for a follow-up implementation slice; where the current code does not yet meet it, the gap is recorded in section 8. Nothing in this document is a claim that the platform has been shown to improve learning outcomes.

Evidence basis: `LinguaAI_Engineering_Roadmap.md` sections 5.3, 12 (PRODUCT-06) and 13.1, `docs/data-retention.md` (DB-25 / SEC-11), `docs/ci-policy.md`, `apps/api/src/analytics/analytics.service.ts`, `apps/api/src/users/users.service.ts`, `apps/api/src/common/services/scheduled-delete.service.ts`, `apps/api/prisma/schema.prisma`. No `.env` values or API keys were read.

Owner: product + engineering lead. Reviewers: legal/privacy owner and pilot stakeholders. Effective date: **pending stakeholder sign-off** (v0.3 private beta gate); do not treat this draft as approved.

---

## 1. Principles

1. **Voluntary** — participation is opt-in, freely chosen, and separate from access to the core product. Declining or leaving the pilot must not reduce a learner's normal features, quota, price or support.
2. **Informed and specific** — before joining, a learner sees this policy (or an in-product summary that links to it): what is collected, why, who processes it, how long it is kept, how to leave, and the fact that no educational efficacy is claimed. Consent must be an affirmative action, not a pre-ticked box or an implication of continued use.
3. **Data minimisation** — collect only event identifiers and coarse metadata needed to answer the pilot questions. Never send raw learner text, transcripts, audio, prompts or completions to analytics, logs, metrics or operation records.
4. **No unverified efficacy claims** — internal measurements are for diagnosis and product decisions. Marketing, UI copy, reports and communications must not state or imply that the platform improves learning, proficiency, retention or exam outcomes unless the evidence bar in section 6 is met and a named reviewer has approved the exact wording.
5. **Reversible** — a learner can withdraw at any time without giving a reason; withdrawal takes effect immediately for future collection and triggers the deletion path in section 5.
6. **Documented gaps, not assumed compliance** — if a control is unimplemented or unverified, say so explicitly. Do not describe a target as a current capability in UI text, release notes or reports.

## 2. Eligibility and enrolment

### 2.1 Who may join

- Adults (18+) who have a normal account and can give informed consent themselves.
- **Under-18 users are excluded** from this pilot until legal review decides the consent/guardian conditions and child-protection obligations. Roadmap section 5.3 requires this review before collecting data from minors, especially audio. Do not onboard minors for audio features on the strength of this document.
- No enrolment through admin instruction, default configuration, employment or course requirement. A teacher or administrator must not make pilot participation a condition of a grade, job or service.
- A learner who cannot access the summary/policy in a language they understand must not be enrolled through a translated click-through they cannot read.

### 2.2 How consent is recorded (target design)

- A distinct, default-off pilot consent state per user, independent of terms-of-service acceptance and independent of marketing preferences. Existing users must not be silently enrolled by a migration; default is "not participated".
- Consent is **versioned**: record the policy version accepted and the timestamp. A material change to purposes, data classes, processors or retention requires a new explicit opt-in; continuing to use the product is not consent to the new version.
- Withdrawal is as easy as opting in: the same settings surface, no support ticket required, no confirmation friction beyond a single deliberate action.
- Consent state must be checked at the point of collection, not only at signup. If consent is absent or withdrawn, pilot analytics emission stops; caching the flag is allowed only with a bounded TTL and must never be treated as authority over a withdrawal (mirroring `docs/data-retention.md`: Redis is a cache, not the source of truth).
- Consent state and audit events must contain only user ID, version, action and timestamp — never text, transcripts, audio or file contents.

### 2.3 Scope boundary

The pilot covers the learning loop described in PRODUCT-05/PRODUCT-06: placement, daily plan, attempt, AI feedback, review and reassessment, plus the minimal event taxonomy in section 3. It does not authorise new data collection, new processors, paid purchases, or use of learner content for model training or marketing. Any expansion requires an update to this policy and renewed opt-in.

## 3. Data collected and explicitly excluded

### 3.1 Permitted pilot signals

| Signal | Purpose | Constraint |
|---|---|---|
| `onboarding_completed`, `lesson_started`, `lesson_completed`, `review_completed`, `feedback_received`, `plan_completed`, `error_reported` | Product diagnosis: where learners drop off, which steps produce reports, cost per completed lesson | User ID/pseudonymous ID, timestamps, coarse feature/level/version metadata only |
| Voluntary return indicators (D1/D7) | Understand whether learners come back on their own | Derived from existing auth/activity timestamps; no new tracking, no cross-site identifiers |
| Review count, plan completion count, reported-error count | Understand workflow health | Counts/IDs only; no free-form detail |
| Cost per completed lesson | Operations | Provider/token counters already present; no new payload contents |

The analytics service must whitelist keys and primitive value types and drop everything else, so an accidental extra field cannot become a transcript carrier. This is the intent of the existing sanitisation helper in `apps/api/src/analytics/analytics.service.ts`; the consent gate itself is not yet implemented (section 8).

### 3.2 Never collected for the pilot

- Raw chat messages, writing submissions, speaking transcripts, audio bytes or URLs, prompts, generated feedback text, or excerpts of learner text — even "short" ones.
- Knowledge-card content, answer strings, or error excerpts. Record an error type/category if already defined; do not copy the learner's sentence.
- Credentials, tokens, MFA secrets, payment details, precise location, contacts, or device identifiers beyond existing security purposes.
- Data from non-participants, including learners who declined or withdrew, and data from minors.
- Screenshots, keystroke traces, or background recording.

If a learning feature itself stores content for the learner's own review (e.g. `writing_submissions`, `speaking_submissions`), that storage is governed by `docs/data-retention.md`, not by pilot consent. Pilot opt-in does not grant the product extra rights to that content.

## 4. Privacy and processing

### 4.1 Purposes

Pilot data is used only to (a) find UX/AI problems, (b) measure operational health such as completion and provider cost, and (c) prepare an internal pre/post assessment described in section 6. It is not used for targeted advertising, resale, model training, automated high-stakes decisions, or individual performance scoring.

### 4.2 Processors

| Processor | Data | Status |
|---|---|---|
| Self-hosted PostgreSQL / Redis | Pilot event rows, consent state, TTL cache | Under the project's own infrastructure; Redis never authoritative for deletion |
| AI model/STT/TTS providers (e.g. Groq, translation TTS) | Learner text/audio only when the learner uses the corresponding learning feature, never added by the pilot | **Provider-side retention, no-training terms and deletion mechanism are not yet verified.** See `docs/data-retention.md` section 5. Do not assert compliance until evidence is recorded. |

The pilot must not add a new processor or send pilot events to a third-party analytics service. A data processing agreement / verified provider terms must exist before production use of the relevant feature; until then, keep the affected feature out of the pilot or record it as an open blocker.

### 4.3 Retention and logs

- Pilot events follow the retention decided in `docs/data-retention.md` for operational/audit data. Where that document marks a window as pending legal review, the pilot does not invent a number.
- Retain IDs, categories, timestamps and counts only. Do not create a durable transcript store through logging: the speaking gateway's transcript-prefix debug logging must remain bounded and disabled/reduced in production logging, and must not be replicated into pilot records.
- Consent records (version, user ID, action, timestamp) are kept for the period needed to demonstrate that collection was lawful, then handled under the same legal review as other audit records.
- Backups and log archives are out of scope of this policy until an owner documents their expiry and erasure procedure (`docs/data-retention.md` section 7).
- User-uploaded content remains subject to the public-URL caveat in `docs/data-retention.md`: do not ask pilot users to upload sensitive recordings while upload URLs are publicly accessible.

## 5. Withdrawal and erasure

1. **Action** — the learner opens the same settings surface used to opt in and withdraws, or submits a verified request to the operator. No reason is required. Withdrawal affects only the pilot; the account and its normal features remain intact.
2. **Immediate effect** — consent state is revoked server-side; event emission for that user stops at once. Cached flags are invalidated best-effort with a bounded TTL; a stale cache must not cause continued collection after the server-side revocation is known.
3. **Stored pilot data** — pilot events already collected are deleted or irreversibly de-identified on the same owner-scoped path used for other user data. Withdrawal does not silently leave a history behind.
4. **Learning content** — the learner keeps their normal account content and can delete conversations/submissions or request account deletion under `docs/data-retention.md`. Opting out of the pilot is not an account-deletion request.
5. **Audit trail** — record only user ID, action (`PILOT_CONSENT_WITHDRAWN`), policy version and timestamp. Never log the learner's free text, transcripts or audio as part of a withdrawal.
6. **Failure handling** — if erasure cannot be completed, report it to the operator and record the failure by ID/error class; do not report withdrawal as complete. Retry using the same idempotent, owner-scoped deletion path. A Redis failure must not block or falsify erasure.
7. **Rejoining** — allowed only through a fresh explicit opt-in to the current policy version. Prior consent must not be reused.

## 6. Evidence and claims

### 6.1 What the pilot may say

- "We are running a small voluntary pilot to find usability and AI-quality problems."
- "We record coarse product events, not your text or audio, for pilot analytics." (Only once the consent gate and whitelist in section 3 are implemented; before that, describe the target, not the current state.)
- "Early/internal observations are being collected and are not evidence of educational effectiveness."

### 6.2 What the pilot must not say

- "Improves learning outcomes / proficiency / retention / exam scores", "proven effective", "learners improve X% faster", "clinically/educationally validated", or any comparative claim against another method.
- Implicit claims through before/after charts, testimonials presented as typical results, or UI badges such as "effective" / "verified learning gain" when no approved evidence exists.
- Treating completion, voluntary return, satisfaction or mastery-model changes as proof of learning efficacy. These are product signals, not learning outcomes. A mastery value changing because the SRS model updated is not evidence that the learner learned.
- Publishing numbers from an underpowered, uncontrolled or unfinished assessment, even with a caveat.

### 6.3 Evidence bar before any efficacy statement

All of the following must be true before wording is approved:

1. A pre/post or comparative assessment is designed **before** looking at results, with the population, measure, duration and analysis method written down. Use an appropriate existing test instrument; do not invent a score from app events.
2. The analysis accounts for voluntary self-selection and typical pilot confounders (different starting levels, different usage, missing post-tests). A voluntary pilot alone cannot support a general effectiveness claim.
3. Sample size and uncertainty are reported; no conclusion is drawn from a handful of participants or from a single cohort.
4. Results are reproduced or reviewed by a named independent reviewer, and limitations are written into the same report.
5. The exact public wording is reviewed and approved by the product/legal owner and recorded with the evidence link and approval date.

Until these conditions are met, the correct public position is: **no verified learning-efficacy claim**. This matches roadmap PRODUCT-06: compare outcomes with a suitable pre/post test, but do not claim educational effectiveness without sufficient evidence.

### 6.4 Internal reporting

Internal pilot reports may include observations and counts, but must label them as exploratory, state the participant count and collection window, and include a "not evidence of efficacy" line. Reports must not contain raw learner text, audio or transcripts.

## 7. Roles and launch gates

| Role | Responsibility |
|---|---|
| Product owner | Defines pilot questions, approves participant list, signs off public wording; ensures no efficacy claim without section 6.3 |
| Engineering owner | Implements consent state, analytics gate, whitelist, withdrawal/deletion path; verifies no text/audio in events or logs |
| Legal/privacy owner | Reviews minors exclusion, provider terms/DPAs, retention windows, consent copy; sign-off required before pilot |
| Operator | Handles verified erasure requests, failure retries, and records approvals |

**Before opening the pilot:**

- [ ] This policy is reviewed and signed off by product, engineering and legal/privacy owners; version and effective date recorded.
- [ ] Consent is default-off, explicit, versioned, and applied to existing users without auto-enrolment.
- [ ] Withdrawal is available in-product and tested end to end, including stored-event cleanup and stale-cache behaviour.
- [ ] Event whitelist verified: no raw text, transcript, audio URL, prompt or free-form payload in analytics, logs, metrics or `ai_operations`.
- [ ] Provider retention/no-training terms verified and recorded, or affected features excluded from the pilot.
- [ ] Minors excluded by an enforced check, not just a policy statement.
- [ ] Public-facing copy and UI strings reviewed against section 6; no efficacy claim anywhere.
- [ ] Data deletion gaps from `docs/data-retention.md` that affect pilot data are either closed or the affected data class is excluded from the pilot.

## 8. Current implementation gaps (as of 2026-11-28)

These must not be described as working controls yet:

- No `pilot_consent` field, consent endpoints, or versioned consent record exist in the API/schema (verified by search of `apps/api/src` and `apps/api/prisma/schema.prisma`). No user is gated today.
- The analytics service sanitises payload keys/values but does not check a consent flag before emitting; a consent gate and its tests are still required.
- `docs/data-retention.md` records unresolved purge gaps (no full owner purge from the scheduled job, raw-SQL rows and uploaded audio/web lessons not cleared, no rolling audit-log retention, no verified provider retention). Withdrawal cannot be claimed complete for those data classes until they are closed.
- Upload URLs under `/uploads/` are publicly served, so pilot instructions must not ask for sensitive recordings until private read routes exist.
- No legal sign-off exists for minors or for the provider DPAs named above.

## 9. Open decisions and blockers

1. **Legal review for minors** (roadmap 5.3): consent/guardian conditions and child-protection duties before any under-18 participation or audio collection. Until resolved, adults only.
2. **Provider agreements**: retention, no-training terms and deletion mechanism for model/STT/TTS providers must be verified and recorded before production use.
3. **Stakeholder review** of this document before public/private beta announcement (v0.3 milestone); record version and date.
4. **Retention windows** for pilot events, consent records and audit logs need a named legal decision; do not hardcode guesses.
5. **Migration**: adding consent state for existing users must default to not-participated and must not auto-enrol anyone.
6. **Marketing review**: all beta copy, screenshots and docs must be checked against section 6 before release.

## 10. Change control

Any change to purposes, data classes, processors, retention or the claims bar requires a new policy version, renewed explicit opt-in from current participants, and a re-run of the launch gates in section 7. Record the change, approver and effective date here.

| Version | Date | Change | Approver |
|---|---|---|---|
| 0.1-draft | 2026-11-28 | Initial policy for voluntary pilot, privacy and no unverified efficacy claims | Pending |
