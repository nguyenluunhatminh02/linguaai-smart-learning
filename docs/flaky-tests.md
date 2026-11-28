# Flaky test policy, owner/cause/status template and candidate registry

**Status: policy and templates only. No test was run while writing this file.** Every result cell below is `NOT RUN`, `SUSPECTED`, or `UNVERIFIED`; none is a pass verdict. A test may be called green only if a recorded rerun with a real command, HEAD, exit code, pass/fail counts, and an artifact path exists in section 5. This document changes no code, test, config, or CI file.

Source of the policy: `LinguaAI_Engineering_Roadmap.md` §10.4 (lines 860–865), specifically: "Flaky test có issue owner/cause; không retry vô hạn để che lỗi" (a flaky test has an issue with owner and cause; do not hide failures with unbounded retries). The same evidence discipline as `docs/dependency-audit.md` and `docs/baseline.md` applies: record the exact command, UTC time, HEAD, tool versions, exit code, first error, and raw artifact. Do not read, print, copy, or commit `.env` values, API keys, or tokens; CI-only fake values already present in `.github/workflows/ci.yml` must remain fake and must never be replaced with real local values.

## 1. Scope and definitions

| Item | Covered here |
|---|---|
| Flaky-test policy, registry row template, run-log template, cause codes | Yes |
| Candidate list seeded from files actually inspected | Yes, all `SUSPECTED / UNVERIFIED` |
| Triage decisions, quarantine grants, issue creation, fixes, CI/config edits | No — later slices, driven by real runs |
| Pass/fail verdicts or current suite status | No — nothing was executed for this document |

Status vocabulary, in order of promotion:

| Status | Meaning | Minimum evidence to enter it |
|---|---|---|
| `NOT RUN` | No recorded execution for this test/candidate. | Nothing; this is the default for empty run-log rows. |
| `SUSPECTED` | A source/config/doc observation suggests instability; no interleaved pass/fail has been recorded. | File/line reference plus a candidate row. Never sufficient for quarantine. |
| `OBSERVED` | A failure or EACCES/blocked prerequisite was seen in a recorded run, but its intermittency and root cause are not established. | Section 5 run-log row with command, HEAD, exit code, first error, artifact path. |
| `CONFIRMED` | Recorded runs show an interleaved pass/fail pattern for the same test at the same HEAD and config, or a reproducible failure attributable to one cause. | At least two recorded runs, including one pass and one fail, or one deterministic failure with a cause analysis. |
| `OWNED` | A named owner alias and a real issue URL exist. | Non-placeholder owner and issue URL in the registry row. |
| `QUARANTINED` | Temporarily excluded from the blocking set under explicit, expiring approval. | Owner + cause hypothesis + issue URL + expiry date + follow-up fix test. Never from `UNKNOWN` and never from `SUSPECTED`. |
| `FIXED` | The cause was removed and a recorded rerun passes with counts and artifact. | Section 5 row after the fix, with failing-test ID shown as passing. |
| `CLOSED` | Issue closed after the follow-up fix test and a stable run sequence. | Issue link plus final run-log rows. |
| `WAIVED` | Deliberate acceptance without a fix. | Named human approver, rationale, and expiry date. No anonymous or blanket waiver; critical-path failures cannot be waived into a green release. |

An interleaved pass/fail sequence (same test, same HEAD and config) is `CONFIRMED` flaky. A single pass is never evidence of stability, and a single failure is not by itself evidence of flakiness. No status may be promoted by editing this document alone.

## 2. Registry row template

One row per full test ID. Copy this row verbatim and replace placeholders only with values from real runs or real issue records. `Owner` must never be blank; until a real owner/issue exists, keep the explicit `TBD` placeholders and leave status at `SUSPECTED`.

| Test ID | Layer | Owner | Cause | Status | First seen (UTC + HEAD SHA) | Repro command | Failure count / runs | Evidence path | Quarantine expiry | Critical path? |
|---|---|---|---|---|---|---|---|---|---|---|
| `<file>::<test name>` or `<node id>` | `<Jest / Vitest / Playwright / pytest>` | `<owner alias for layer>` + `<issue URL>` | `<cause code>: <observed cause or explicit hypothesis>` | `NOT RUN` / `SUSPECTED` | `<YYYY-MM-DDTHH:MM:SSZ + full HEAD SHA>` | `<exact command; cwd; TZ if relevant>` | `<failures>/<runs>; NOT RUN if none>` | `<artifact path from section 5>` | `<YYYY-MM-DDTHH:MM:SSZ or N/A>` | `yes` for auth / billing / SRS, else `no` |

Field rules:

- **Test ID:** full Jest/Vitest path (`apps/api/src/...spec.ts::test name`), pytest node ID (`tests/test_x.py::test_y`), or Playwright file and title. A bare test name is not enough.
- **Layer:** one of `Jest`, `Vitest`, `Playwright`, `pytest`. For a tooling blocker that prevents a suite from starting, use the layer it blocks and make the cause explicit.
- **Owner:** person/team alias plus the real issue URL. Use a stable alias, not a personal name, when the team uses aliases. If either half is missing, the row stays `SUSPECTED` and cannot be quarantined.
- **Cause:** one code from section 3 plus a sentence. "It passed on retry" is not a cause. A pre-fix cause may be labeled `hypothesis:` until a rerun confirms it.
- **Status:** only values from section 1. `NOT RUN` is the default for a newly copied row.
- **First seen:** UTC timestamp and full HEAD SHA from the run that first produced the observed failure, not from the date the candidate was written down.
- **Repro command:** the exact command and working directory; include `TZ=` only when time-zone dependence is part of the hypothesis. Do not include real env values or keys.
- **Failure count / runs:** e.g. `2/5`. Keep the denominator, and keep the row even when the result is `0/1` after a fix.
- **Evidence path:** a stable artifact path defined in section 4, not a pasted terminal scrollback. `NOT RUN` rows have no evidence path.
- **Quarantine expiry:** required and non-`N/A` for `QUARANTINED`; `N/A` for every other status. An expired quarantine returns to `OWNED` and blocks again until renewed with a new expiry and a new issue comment.
- **Critical path?:** `yes` for auth, billing, and SRS tests and for any test that gates their release path. These failures fail release even if quarantined.

## 3. Cause codes

| Code | Use for |
|---|---|
| `TIME/TZ` | Clock, date, DST, locale, or time-zone dependence; fake timers and midnight-normalization assumptions. |
| `MOCK/INTEROP` | Mock module shape, import interop, tsconfig/`allowSyntheticDefaultImports`, stale stub contract, or provider stub drift. |
| `ENV/CONFIG` | Runtime/config or test-runner configuration, env-derived branches, execute-bit/tool invocation problems, retry policy. |
| `NATIVE_BINDING` | Native module ABI/platform mismatch (for example bcrypt), including a mock that hides the binding. |
| `INFRA/DB/REDIS` | Missing or dirty test database, migrations/seed/reset prerequisites, Redis availability, service containers. |
| `CONCURRENCY` | Parallel workers, shared keys/counters, race conditions, order-dependent setup/teardown. |
| `SCHEMA_DRIFT` | Response schema, validation rule, or fixture payload changed without updating the test contract. |
| `UNKNOWN` | Genuinely unexplained. Diagnostic only: **cannot** justify `QUARANTINED`. Investigate to a specific code before excluding a test from the blocking set. |

## 4. No silent retry rules

1. **Jest, Vitest, pytest: zero retries.** Do not add `jest.retryTimes`, `jest.retryTimes()` in setup, `pytest-rerunfailures`, `--reruns`, `vitest --retry`, or any equivalent. A failing test fails the job.
2. **Playwright: bounded ceiling only.** Current `apps/web/playwright.config.ts` has `retries: process.env.CI ? 2 : 0` and `trace: 'on-first-retry'`; that is the maximum, not a target to increase. Every retried attempt must retain its trace and a link to the issue in the registry row. Do not raise the retry count to make a red run green.
3. **Retry evidence is mandatory.** For any retried test, publish trace/JSON/JUnit output for *every* attempt, including the first failing attempt, plus the issue URL. A retry with no artifact is a silent retry and is treated as a policy violation, not a pass.
4. **Interleaved pass/fail is confirmed flaky.** Once observed, the test moves to `CONFIRMED` with owner and issue; it is not retried away. Re-running until green does not close the issue.
5. **Quarantine is explicit and expiring.** It requires owner + cause hypothesis + issue URL + expiry + a follow-up fix test linked in the issue. `UNKNOWN`, `SUSPECTED`, and "passed on retry" are not valid grounds. Quarantine excludes the test from the blocking set only until expiry; it never deletes the failure record.
6. **Critical path always blocks.** Auth, billing, and SRS failures fail release even if quarantined or marked `WAIVED`; `WAIVED` additionally needs a named approver and expiry.
7. **No hiding by config.** Do not increase retry counts, widen timeouts to absorb a race, skip a test, or convert a failure to a warning to make a run green. Any such change needs its own issue and evidence row explaining the root cause.
8. **No verdict without a run.** A row with `NOT RUN`, no exit code, or no artifact is never green. Stale counts from `docs/baseline.md` are historical evidence only and must be re-run before being used as a current status.

## 5. Evidence / run-log template

Use this for every reproduction attempt. Replace each `<...>` with values from the actual run; leave it unfilled until then.

| Field | Value |
|---|---|
| Date (UTC) | `<YYYY-MM-DDTHH:MM:SSZ>` |
| Git HEAD | `<git rev-parse HEAD>` |
| Branch / working tree | `<branch; clean or list of dirty paths>` |
| Layer | `<Jest / Vitest / Playwright / pytest>` |
| Test ID | `<full test ID from section 2>` |
| Exact command + cwd | `<command>` in `<directory>` |
| Tool version | `<node/pnpm/jest/vitest/playwright/python/pytest/pytest-asyncio version as applicable>` |
| TZ / env mode | `<observed TZ or CI/local marker; env var names only, no values>` |
| Exit code | `<exit code>` |
| Pass / fail / skipped counts | `<observed counts>` |
| First error | `<first failing line, including test ID and error type>` |
| Attempt number / retry | `<1 of 1; or 2 of 3 with trace path>` |
| Artifact path | `<stable path defined by section 6>` |
| Registry row updated? | `<yes / no; issue URL if yes>` |

```text
RUN LOG <YYYY-MM-DDTHH:MM:SSZ>
HEAD: <git rev-parse HEAD>
BRANCH/TREE: <branch; clean/dirty note>
COMMAND: <exact command> (cwd: <directory>)
VERSIONS: <tool versions>
TZ/ENV: <time zone and mode; variable names only>
EXIT: <code>
COUNTS: <passed>/<failed>/<skipped>
FIRST ERROR: <first failing line>
ATTEMPT: <n of m>, trace: <path or none>
ARTIFACT: <path>
```

Rules for the log: keep failure rows even after a fix; never overwrite a failing attempt with a later passing attempt; note concurrent edits to the working tree, since they can make a result stale. Forbidden in artifacts and in this file: `.env` contents, API keys, tokens, credentials, and real provider URLs derived from local config.

## 6. Candidate registry — all SUSPECTED / UNVERIFIED

These rows were seeded by read-only inspection of the listed files and `docs/baseline.md`. **None was reproduced for this document.** They are leads for a later verification slice, not confirmed flaky tests and not quarantine requests. Owner and issue cells are intentionally unfilled placeholders; keep them that way until real values exist.

| Test ID | Layer | Owner | Cause | Status | First seen (UTC + HEAD SHA) | Repro command | Failure count / runs | Evidence path | Quarantine expiry | Critical path? |
|---|---|---|---|---|---|---|---|---|---|---|
| `apps/api/src/auth/services/password-history.service.spec.ts` (all tests) | Jest | `<Jest/API owner alias>` + `<issue URL TBD>` | `NATIVE_BINDING` / `MOCK/INTEROP` hypothesis: bcrypt is replaced by a deterministic `jest.mock('bcrypt', ...)`; a change in mock/import shape or a reintroduced native binding could make these password-reuse tests platform-dependent | `SUSPECTED / UNVERIFIED` | `<NOT RUN; source inspected only>` | `pnpm --filter api test -- --runInBand --testPathPattern=src/auth/services/password-history.service.spec.ts` from repo root | `NOT RUN` | `NOT RUN` | `N/A` | `yes` (auth) |
| `apps/api/src/common/services/redis.service.spec.ts` (all tests) | Jest | `<Jest/API owner alias>` + `<issue URL TBD>` | `MOCK/INTEROP` hypothesis: `jest.mock('ioredis')` exports `{ __esModule: true, default: ctor }` because tsconfig uses `allowSyntheticDefaultImports` without `esModuleInterop`; a compiler/config change would break the mock shape | `SUSPECTED / UNVERIFIED` | `<NOT RUN; source inspected only>` | `pnpm --filter api test -- --runInBand --testPathPattern=src/common/services/redis.service.spec.ts` from repo root | `NOT RUN` | `NOT RUN` | `N/A` | `no` |
| `apps/api/src/srs/sm2.algorithm.spec.ts::getNextReviewDate` tests | Jest | `<Jest/API owner alias>` + `<issue URL TBD>` | `TIME/TZ` hypothesis: tests pin fake timers to `2026-03-08` and assert UTC-midnight output across a DST boundary; behavior under a non-UTC host `TZ` is unverified | `SUSPECTED / UNVERIFIED` | `<NOT RUN; source inspected only>` | `pnpm --filter api test -- --runInBand --testPathPattern=src/srs/sm2.algorithm.spec.ts` from repo root; repeat with `TZ=UTC` and `TZ=America/New_York` as separate rows | `NOT RUN` | `NOT RUN` | `N/A` | `yes` (SRS) |
| `apps/ai-service/tests/` (pytest-asyncio event-loop scope) | pytest | `<pytest/AI owner alias>` + `<issue URL TBD>` | `ENV/CONFIG` hypothesis: `apps/ai-service/pytest.ini` now sets `asyncio_mode = auto` and `asyncio_default_fixture_loop_scope = function` while `apps/ai-service/tests/conftest.py` normalizes `APP_ENV`/`NODE_ENV`/`DEBUG` before app import; older deprecation warnings in `docs/baseline.md` §2/§4 are stale and need a rerun | `SUSPECTED / UNVERIFIED` | `<NOT RUN; config inspected only>` | `cd apps/ai-service && <venv python> -m pytest -q --tb=line` from repo root | `NOT RUN` | `NOT RUN` | `N/A` | `no` |
| `tests/test_llm_client.py::test_health_check_returns_true_on_200`, `tests/test_routers_chat.py::test_chat_stream_emits_stream_interrupted_on_llm_failure`, and the four `tests/test_security.py::test_all_protected_endpoints_accept_configured_key[...]` cases recorded in `docs/baseline.md` §4/§6 | pytest | `<pytest/AI owner alias>` + `<issue URL TBD>` | `SCHEMA_DRIFT` / `MOCK/INTEROP` hypothesis: stale mock payloads and changed `health_check`/stream-terminator contracts; `docs/baseline.md` §6 supersedes §4 with `1 failed, 95 passed` and reports `ResponseValidationError: extra_forbidden word_count`. Both counts are historical, not current | `SUSPECTED / UNVERIFIED` | `<NOT RUN for this doc; baseline evidence is stale>` | `cd apps/ai-service && <venv python> -m pytest -q --tb=line` (record full node IDs from output) | `NOT RUN` | `NOT RUN` | `N/A` | `no` for these units, but re-check any auth/billing/SRS test before release |
| Vitest suite start (web unit suite) | Vitest | `<Vitest/Web owner alias>` + `<issue URL TBD>` | `ENV/CONFIG` observed blocker in `docs/baseline.md` §2/§5/§6: `node_modules/.bin/vitest` lacks the execute bit (EACCES); no Vitest suite has been run, so no flakiness is claimed | `SUSPECTED / UNVERIFIED` | `<NOT RUN for this doc; baseline observed EACCES>` | `pnpm --dir apps/web exec vitest --version` then `pnpm --filter web test:run` from repo root | `NOT RUN` | `NOT RUN` | `N/A` | `no` |
| `apps/api/test/*.e2e-spec.ts` (billing/ledger e2e) | Jest | `<Jest/E2E owner alias>` + `<issue URL TBD>` | `INFRA/DB/REDIS` hypothesis: `apps/api/test/jest-e2e.json` has no DB setup of its own and the e2e suite explicitly requires a disposable, migrated, seeded PostgreSQL database; `docs/baseline.md` §6 records the suite as not run | `SUSPECTED / UNVERIFIED` | `<NOT RUN; config inspected only>` | `pnpm --filter api test:e2e` from repo root, against a disposable migrated/seedable test DB | `NOT RUN` | `NOT RUN` | `N/A` | `yes` (billing) |
| `apps/web/e2e/**` (Playwright suite) | Playwright | `<Playwright/Web owner alias>` + `<issue URL TBD>` | `ENV/CONFIG` + `CONCURRENCY` hypothesis: `apps/web/playwright.config.ts` uses `fullyParallel: true`, `retries: process.env.CI ? 2 : 0`, `trace: 'on-first-retry'`, and only the HTML reporter; any hidden flakiness would be masked without per-attempt artifacts | `SUSPECTED / UNVERIFIED` | `<NOT RUN; config inspected only>` | `pnpm --filter web exec playwright test` from repo root; record each attempt and trace | `NOT RUN` | `NOT RUN` | `N/A` | `no` |

No row above authorizes skipping a test or failing a release silently. Promote rows only using section 5 evidence and section 1 status definitions.

## 7. Interfaces required from neighbouring slices (read-only here)

These are requirements for other files, not changes made by this document. Record gaps here; implement them in their own slices with tests where appropriate.

| Interface | Current observation | Requirement for evidence/traceability |
|---|---|---|
| `.github/workflows/ci.yml` | Uses `python -m pytest -q` (no JUnit XML) and uploads no test artifacts; env block holds CI-only fake values. | Keep fake CI-only env values and never substitute real `.env`/key values. Publish retry/trace artifacts for any retried test, and provide one stable artifact path per test layer that the `Evidence path` column can reference. JUnit XML for pytest (and API/web suites) is the expected machine-readable input. Adding `--junitxml=<path>` and an upload step is a future CI slice, not part of this document. |
| `apps/web/playwright.config.ts` | `retries: process.env.CI ? 2 : 0`, `trace: 'on-first-retry'`, `reporter: 'html'`. | Those retry/trace settings are the bounded ceiling. Add a JSON/JUnit reporter or publish `playwright-report/` and `test-results/` as stable evidence paths, preserving per-attempt traces and issue links. Never raise the retry count to hide a failure. |
| `apps/api/jest.config.js` and `apps/web/vitest.config.ts` | No JSON/JUnit output path configured; no retry option configured. | If machine-checkable evidence is added later, expose explicit JSON/JUnit output paths per suite. Do not introduce Jest/Vitest retry options. Keep the zero-retry rule in section 4. |
| `apps/ai-service/pytest.ini` | `asyncio_mode = auto`, `asyncio_default_fixture_loop_scope = function`, `testpaths = tests`. | Treat `asyncio_default_fixture_loop_scope = function` as the fixed deterministic setting; do not revert it. Future runs may add `--junitxml=<path>` for evidence. `apps/ai-service/tests/conftest.py` must keep isolating test env vars before app import without reading real `.env` values. |
| Issue tracker | No per-layer owner alias or flaky-test label/project was verified here. | A label/project and an owner alias per layer must exist so every candidate can have a real issue URL. Until then, status stays `SUSPECTED` and no quarantine is permitted. |

## 8. Verification steps for the next slice (not executed here)

1. For each row in section 6, run exactly its `Repro command` from the stated directory, in a disposable environment with pinned tool versions. Do not run package managers just to collect flakiness evidence; use the environment already provisioned for that layer.
2. Create one section 5 run-log row per attempt, including HEAD, UTC time, branch/dirty-tree note, versions, exit code, counts, first error, retry number, and artifact path. Leave `Owner`/`Issue URL` as TBD if no tracker record exists.
3. Repeat a candidate at least twice with the same HEAD and config. If results interleave pass/fail, promote to `CONFIRMED` and open an issue with owner and cause code. If a candidate cannot run (EACCES, missing DB, missing venv), keep it `OBSERVED` with the blocker and do not call it green.
4. Only after a real issue URL, a specific cause code (not `UNKNOWN`), an expiry, and a linked follow-up fix test exist may a non-critical test be moved to `QUARANTINED`. Critical-path auth/billing/SRS failures still fail release.
5. Fix the confirmed cause, rerun, and record the post-fix run as a new section 5 row; promote to `FIXED` and then `CLOSED` only with that evidence. Re-check the `docs/baseline.md` counts — they are stale and must never be quoted as current without a rerun.
6. Re-read this document after applying a slice and update only the rows whose evidence actually changed; preserve every past failure row.

This document itself makes no claim that any suite is green, stable, quarantined, or fixed.
