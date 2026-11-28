# FE-03 / PERF-01 — Frontend performance profiling plan and baseline template

**Status: TEMPLATE — NO MEASUREMENT HAS BEEN RUN FOR THIS REPORT.** Every metric cell below is `NOT MEASURED`, `NOT AVAILABLE`, or `UNKNOWN`. No LCP, INP, CLS, TTFT, bundle size, rerender count, or SSE delta rate is asserted. This file is the profiling plan and the empty baseline; a future author fills cells from recorded artifacts and only then changes the header status.

## 0. Explicit no-fabrication rule (verbatim contract for this file)

> Every figure must cite a recorded command, timestamp, exit code, git SHA, runtime, and conditions; an unexecuted command is "NOT RUN" and never "green"; a number from an older tree is "STALE (superseded by ...)", as `docs/baseline.md` §6 already does for 74 passed/6 failed vs 1 failed/95 passed; missing measurements stay `NOT MEASURED`, never inferred from code reading or from a similar route; synthetic data and fake providers are labeled as such; no real learner text, transcript, token, key, credential, or local `.env`/`.env.local` value may be read, copied, or injected into a command, artifact, or this report; SLO values in PERF-01 are proposed staging targets, not proven capabilities and not pass/fail gates until a baseline exists. An empty cell means "no recorded evidence", not zero, not a pass, and not a failure.

This plan uses only synthetic fixtures and a fake provider. No live LLM provider, no production data, and no authenticated real account is involved in any command listed here. The CSP `connect-src` in `apps/web/next.config.ts` is left unchanged; a measurement must not widen it just to reach an instrument endpoint.

## 1. Provenance and scope

| Field | Value |
|---|---|
| Report file | `docs/frontend-performance.md` (this file; created by slice fe-21) |
| Report observation timestamp | `2026-11-28T03:36:45Z` (template observation; no measurement) |
| Git HEAD at observation | `3be6aa39ad65fc7cfef22d75c84e40c5927b0389` (from earlier report provenance; **NOT RE-VERIFIED for this file** — record `git rev-parse HEAD` at actual run time) |
| Working tree at observation | Dirty (many modified tracked files and untracked docs). No result in this file is attributed to any tree. |
| Roadmap scope | FE-03 lines 789–798 (profiling, SSE batching, lazy load, virtualization, memoization, LCP/INP/CLS), PERF-01 lines 937–955 (method, SLO proposal, evidence requirements) |
| Cross-links | `docs/baseline.md` is the authoritative general test baseline; `docs/benchmarks/*.md` are API/DB/runtime benchmark reports; `docs/benchmarks/frontend-baseline.template.json` is the empty machine-readable counterpart to this file. This file does not overwrite any of them. |
| Secrets policy | No `.env`, `.env.local`, token, credential, provider endpoint with credentials, real transcript, or learner PII was read or copied to create this plan. |

### 1.1 Current state checked (source inspection only, not a measurement)

| Observation | Evidence source | Status |
|---|---|---|
| FE-03 requires React Profiler, network waterfall, bundle output, Lighthouse on staging and a saved baseline | `LinguaAI_Engineering_Roadmap.md` §FE-03 | Requirement; NOT RUN |
| PERF-01 defines proposed staging SLOs and requires machine/runtime/dataset/commit/env/command/results/confidence recorded in `docs/benchmarks/` | `LinguaAI_Engineering_Roadmap.md` §PERF-01 | Requirement; NOT RUN |
| `docs/frontend-performance.md` did not exist before this slice | `docs/` listing at observation | CREATED (this file) |
| Playwright and Vitest configs exist | `apps/web/playwright.config.ts`, `apps/web/vitest.config.ts` | Present |
| SSE parser and its spec exist | `apps/web/src/lib/sse-parser.ts`, `sse-parser.spec.ts` | Present |
| TanStack Query, `@tanstack/react-virtual`, `recharts`, `framer-motion` are available dependencies | `apps/web/package.json` | Present; no bundle measurement |
| `useChatStream` hook from CHAT-03 does not exist yet | `apps/web/src/hooks/` listing at observation | NOT AVAILABLE — SSE batching plan is conditional on CHAT-03 |
| `next.config.ts` has a restricted CSP `connect-src` | `apps/web/next.config.ts` | Must remain unchanged for measurement |
| No frontend performance run, artifact, or baseline JSON exists | `docs/benchmarks/` listing at observation | NOT RUN |

## 2. Measurement matrix

Routes are from the FE-03 feature areas. Routes with a dynamic segment use a **synthetic fixture ID** only. No route below has measured numbers yet.

| Route (synthetic fixture) | Primary risk | React Profiler | Network waterfall | Bundle | Lighthouse | SSE | Baseline cell status |
|---|---|---|---|---|---|---|---|
| `/dashboard` | Chart-heavy first paint | Commit duration, rerender count of chart cards | TTFB, request count, transferred bytes for read APIs | First Load JS for route | LCP/INP/CLS | Not applicable | NOT MEASURED |
| `/chat` | Per-token rerender / jank | Commit duration per delta, rerender count of message list | TTFB, request count, SSE stream bytes | First Load JS for route | LCP/INP/CLS while stream idle and while streaming | Delta/s, dropped frames, terminal event, final text matches DB fixture | NOT MEASURED |
| `/flashcards/[deckId]/study` | Large card list scrolling | Commit duration on review/advance | TTFB, request count, payload size | First Load JS for route | LCP/INP/CLS | Not applicable | NOT MEASURED |
| `/speaking` | Media state rerenders / resource retention | Commit duration on record/stop | TTFB, request count, media/audio bytes | First Load JS for route | LCP/INP/CLS | Not applicable | NOT MEASURED |
| `/cms/[id]/edit` | Editor payload on first load | Commit duration on editor open/typing | TTFB, request count, payload size | First Load JS for route | LCP/INP/CLS | Not applicable | NOT MEASURED |

Metric definitions (declare before any run; changing a definition after results requires a new report version with a changelog entry):

- **React Profiler**: `actualDuration` / commit duration per commit and per component rerender, recorded via the React DevTools Profiler in a **development-only** build. Dev-mode numbers are not comparable to production Lighthouse numbers; record both modes separately.
- **Network waterfall**: TTFB per request, request count, transferred and decoded bytes, extracted from Chrome DevTools Performance/Network HAR or Playwright `requestfinished`/`response` events. SSE stream bytes counted separately from ordinary XHR/fetch.
- **Bundle**: `First Load JS` per route from `next build` output. Record the build SHA and exact command; do not infer from source file sizes.
- **Lighthouse**: LCP, INP, CLS from Lighthouse CLI in an external, version-pinned invocation. Record form factor, throttling profile, and run index.
- **SSE jank**: deltas per second, dropped frames (`longtask` observer plus frame timing), TTFT, `accepted`/`delta`/`completed`/`failed` event integrity (from CHAT-01), and equality of final rendered text against the fake-provider fixture's persisted message. No threshold asserted until baseline.
- **p50/p95**: computed from at least 5 repeated runs per route per condition; fewer samples are reported as `NOT MEASURED` with sample count stated, never as a percentile.

### 2.1 Conditions to record for every run

| Condition | Cold cache | Warm cache | Throttle | Notes |
|---|---|---|---|---|
| Browser cache / service worker | Cleared before navigation | Second navigation in same context | Not applicable to cache state | Record which one produced the artifact |
| Server/API cache | Fake provider with empty cache | Fake provider warmed per fixture | Record both | Do not use real provider state |
| CPU | No throttle (baseline) | No throttle | 4× CPU slowdown (separate run) | Record DevTools/CLI setting, not just the label |
| Network | No throttle (baseline) | No throttle | Slow 4G / 1.6 Mbps, 150 ms RTT (separate run) | Same profile for all routes in a comparison |
| Device | Desktop headless (baseline) | Desktop headless | Mobile emulation profile | Real-device run is a separate, explicitly labeled run |
| Repeat count | 5 runs per cell | 5 runs per cell | 5 runs per cell | Median and p95 only if ≥5 samples; otherwise raw samples only |

Warm and cold results are **separate rows** in the baseline. A before/after comparison must keep every condition identical except the one variable being changed (PERF-01 line 954).

## 3. Empty baseline table

`—` means "no recorded evidence". Do not replace `—` with 0, "pass", or "fail". Every future number must cite a run ID from §4 and the commit SHA recorded with that run.

| Run ID | Route | Condition | Commit SHA | Node version | Browser + version | Device/profile | Network profile | Backend mode | Command | Metric | p50 | p95 | Evidence link | Confidence / limitations |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| NOT RUN | `/dashboard` | cold / unthrottled | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | fake provider | NOT RUN | LCP | NOT MEASURED | NOT MEASURED | NOT AVAILABLE | NOT MEASURED |
| NOT RUN | `/dashboard` | cold / unthrottled | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | fake provider | NOT RUN | INP | NOT MEASURED | NOT MEASURED | NOT AVAILABLE | NOT MEASURED |
| NOT RUN | `/dashboard` | cold / unthrottled | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | fake provider | NOT RUN | CLS | NOT MEASURED | NOT MEASURED | NOT AVAILABLE | NOT MEASURED |
| NOT RUN | `/dashboard` | build | NOT MEASURED | NOT MEASURED | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | fake provider | NOT RUN | First Load JS | NOT MEASURED | NOT MEASURED | NOT AVAILABLE | NOT MEASURED |
| NOT RUN | `/chat` | cold / unthrottled | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | fake provider | NOT RUN | LCP | NOT MEASURED | NOT MEASURED | NOT AVAILABLE | NOT MEASURED |
| NOT RUN | `/chat` | streaming | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | fake provider | NOT RUN | INP | NOT MEASURED | NOT MEASURED | NOT AVAILABLE | NOT MEASURED |
| NOT RUN | `/chat` | streaming | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | fake provider | NOT RUN | CLS | NOT MEASURED | NOT MEASURED | NOT AVAILABLE | NOT MEASURED |
| NOT RUN | `/chat` | streaming | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | fake provider | NOT RUN | TTFT | NOT MEASURED | NOT MEASURED | NOT AVAILABLE | NOT MEASURED |
| NOT RUN | `/chat` | streaming | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | fake provider | NOT RUN | delta/s | NOT MEASURED | NOT MEASURED | NOT AVAILABLE | NOT MEASURED |
| NOT RUN | `/chat` | streaming | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | fake provider | NOT RUN | dropped frames | NOT MEASURED | NOT MEASURED | NOT AVAILABLE | NOT MEASURED |
| NOT RUN | `/chat` | streaming | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | fake provider | NOT RUN | terminal event + final text | NOT APPLICABLE | NOT APPLICABLE | NOT AVAILABLE | NOT MEASURED |
| NOT RUN | `/chat` | build | NOT MEASURED | NOT MEASURED | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | fake provider | NOT RUN | First Load JS | NOT MEASURED | NOT MEASURED | NOT AVAILABLE | NOT MEASURED |
| NOT RUN | `/flashcards/[deckId]/study` | cold / unthrottled | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | fake provider | NOT RUN | LCP | NOT MEASURED | NOT MEASURED | NOT AVAILABLE | NOT MEASURED |
| NOT RUN | `/flashcards/[deckId]/study` | scroll | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | fake provider | NOT RUN | INP | NOT MEASURED | NOT MEASURED | NOT AVAILABLE | NOT MEASURED |
| NOT RUN | `/flashcards/[deckId]/study` | cold / unthrottled | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | fake provider | NOT RUN | CLS | NOT MEASURED | NOT MEASURED | NOT AVAILABLE | NOT MEASURED |
| NOT RUN | `/flashcards/[deckId]/study` | cold / unthrottled | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | fake provider | NOT RUN | TTFB / request count / payload | NOT MEASURED | NOT MEASURED | NOT AVAILABLE | NOT MEASURED |
| NOT RUN | `/flashcards/[deckId]/study` | build | NOT MEASURED | NOT MEASURED | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | fake provider | NOT RUN | First Load JS | NOT MEASURED | NOT MEASURED | NOT AVAILABLE | NOT MEASURED |
| NOT RUN | `/speaking` | cold / unthrottled | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | fake provider | NOT RUN | LCP | NOT MEASURED | NOT MEASURED | NOT AVAILABLE | NOT MEASURED |
| NOT RUN | `/speaking` | record/stop | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | fake provider | NOT RUN | INP | NOT MEASURED | NOT MEASURED | NOT AVAILABLE | NOT MEASURED |
| NOT RUN | `/speaking` | cold / unthrottled | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | fake provider | NOT RUN | CLS | NOT MEASURED | NOT MEASURED | NOT AVAILABLE | NOT MEASURED |
| NOT RUN | `/speaking` | build | NOT MEASURED | NOT MEASURED | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | fake provider | NOT RUN | First Load JS | NOT MEASURED | NOT MEASURED | NOT AVAILABLE | NOT MEASURED |
| NOT RUN | `/cms/[id]/edit` | cold / unthrottled | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | fake provider | NOT RUN | LCP | NOT MEASURED | NOT MEASURED | NOT AVAILABLE | NOT MEASURED |
| NOT RUN | `/cms/[id]/edit` | editor open/typing | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | fake provider | NOT RUN | INP | NOT MEASURED | NOT MEASURED | NOT AVAILABLE | NOT MEASURED |
| NOT RUN | `/cms/[id]/edit` | cold / unthrottled | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | fake provider | NOT RUN | CLS | NOT MEASURED | NOT MEASURED | NOT AVAILABLE | NOT MEASURED |
| NOT RUN | `/cms/[id]/edit` | cold / unthrottled | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | fake provider | NOT RUN | TTFB / payload | NOT MEASURED | NOT MEASURED | NOT AVAILABLE | NOT MEASURED |
| NOT RUN | `/cms/[id]/edit` | build | NOT MEASURED | NOT MEASURED | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | fake provider | NOT RUN | First Load JS | NOT MEASURED | NOT MEASURED | NOT AVAILABLE | NOT MEASURED |
| NOT RUN | all routes | dev-only profiling | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | fake provider | NOT RUN | commit duration / rerender count | NOT MEASURED | NOT MEASURED | NOT AVAILABLE | Dev mode only; not comparable with production |

The machine-readable counterpart with the same `NOT_MEASURED` semantics is `docs/benchmarks/frontend-baseline.template.json`.

## 4. Execution plan (no commands executed for this report)

All commands below are **proposed, NOT RUN**. Record command text, timestamp (UTC), exit code, HEAD SHA, working-tree state, runtime versions, and output artifact path before filling any cell. Do not paste `.env` values or tokens into commands or artifacts. Do not use a live provider: use the fake provider and synthetic fixtures only.

| Step | Tool / command (proposed) | Output artifact | Status |
|---|---|---|---|
| P0 | `git rev-parse HEAD`, `git status --short`, `node --version`, browser `--version` | Run provenance block in `docs/benchmarks/frontend-baseline.md` | NOT RUN |
| P1 | `BUILD_STANDALONE=true pnpm --filter web build` **only when standalone output is required**; otherwise `pnpm --filter web build` | Build log + `First Load JS` table copy | NOT RUN |
| P2 | Start the local staging-equivalent stack with fake provider and seeded synthetic fixtures (fixture IDs from `apps/web/cms-data` or a dedicated test seed; never production data) | Run log with fixture IDs and commit SHA | NOT RUN |
| P3 | `pnpm --filter web exec playwright test e2e/performance.spec.ts` (uses `baseURL` from `apps/web/playwright.config.ts`; no hardcoded origin or credential) | `apps/web/test-results/frontend-performance.json`, Playwright trace | NOT RUN |
| P4 | Chrome DevTools Performance recording per route, cold and warm, with the throttle profile from §2.1 | Performance trace export (JSON/trace) per route | NOT RUN |
| P5 | React DevTools Profiler in a **dev-only** run, per interaction listed in §2 | Profiler export (JSON) + commit/rerender counts | NOT RUN |
| P6 | Lighthouse CLI, **version-pinned, invoked from outside the repo** (no new dependency or script in `apps/web/package.json` for this first pass), one run per route per condition | Lighthouse JSON reports under `docs/benchmarks/` (evidence links in §3) | NOT RUN |
| P7 | Copy `docs/benchmarks/frontend-baseline.template.json` to a run-specific file and fill only measured fields; keep every unmeasured field `null` / `NOT_MEASURED` | Run-specific baseline JSON | NOT RUN |
| P8 | Re-run after any change with identical conditions (§2.1); compare one variable at a time | Before/after section with evidence links and confidence notes | NOT RUN |

No package manager invocation, build, server start, browser run, or Lighthouse invocation was performed to produce this plan. The `pnpm` strings above are documentation of intended commands only.

### 4.1 Playwright artifact contract

`apps/web/e2e/performance.spec.ts` (owned by a separate slice, not by this document) is intended to collect `largest-contentful-paint`, `event` (INP), `layout-shift`, `longtask`, and resource timing through `PerformanceObserver`, plus SSE terminal-event integrity using the CHAT-01 event contract (`accepted {operationId, conversationId}`, `delta {seq, text}`, `completed {operationId, messageId, balance}`, `failed {code}`). Its assertions check **structure** — metric observed, no page errors, terminal event reached — not numeric thresholds, until a real baseline exists. It must read `baseURL` from `apps/web/playwright.config.ts` and write JSON to `apps/web/test-results/frontend-performance.json`. References to this file here are a planned interface, not evidence of its existence or success.

### 4.2 Evidence and limitations block to attach to every filled row

- Commit SHA, working-tree state (clean/dirty and reason), timestamp UTC.
- Node version, browser + version, device/profile, network profile, CPU throttle, cache state, sample count.
- Backend mode: `fake provider + synthetic fixtures`; explicitly state if any live component was present (it should not be).
- Exact command and exit code; link to raw artifact (Playwright JSON, Lighthouse JSON, trace, build log).
- Confidence/limitations: dev-only profiler caveat, headless vs real-device caveat, throttling approximation, p50/p95 sample count, any run excluded from the baseline and why.
- If a number comes from an older tree, mark `STALE (superseded by ...)`; never silently carry it forward.

## 5. Decision rules for optimization (evidence-gated, not applied here)

These are **decision rules**, not findings. No optimization is justified by this document alone.

| Evidence | Action | Guardrail |
|---|---|---|
| React Profiler shows commit duration exceeding the frame budget (16.7 ms at 60 Hz; state the target frame rate in the run) or rerender jank repeats across runs | Batch SSE delta UI updates in a `requestAnimationFrame` window (~16–32 ms) in the CHAT-03 `useChatStream` hook, keeping `seq` ordering, abort guard, terminal event handling, and final text identical to the fixture/persisted message | Do not reintroduce old debit/persist behavior; never drop `completed`/`failed`; preserve conversation state on switch (FE-03 sprint gate) |
| Build output shows a route's First Load JS materially increased by chart/editor libraries | Lazy-load `recharts` charts / the CMS editor and show a loading state | Record before/after bundle numbers and verify no regression in LCP/INP/CLS or UI state |
| Long lists show scroll INP or profiling cost above budget | Virtualize with the already-available `@tanstack/react-virtual` | Verify keyboard access and scroll restoration; keep behavior unchanged |
| Profiler shows expensive rerenders from stable props/expensive derived data | Apply targeted memoization only at the measured components | No blanket `useMemo`/`React.memo`; re-measure to confirm benefit |
| Speaking route shows rerender cost | Optimize only the measured rerenders | Keep media-track stop and object-URL revoke behavior from FE-01; verify no media leak |
| Image/audio caching measured as a bottleneck | Tune caching for those assets | No prefetch of private data after logout; keep CSP unchanged |

The FE-03 sprint gate additionally requires regression tests for the same business flow before/after a refactor, no lost UI state when switching conversations, no media leak, and an explained reason for any bundle/latency increase.

### 5.1 Proposed staging SLOs — not gates yet

From PERF-01 (roadmap lines 941–948): read API p95 < 300 ms, SRS/token p95 < 500 ms with 0 invariant violations, chat SSE fake provider with no lost or duplicated settlement events and TTFT measured separately, live provider p95 TTFT/total latency measured per model/network without a hard number, API server errors <1% excluding deliberate 4xx with 429 reported separately, and no unbounded memory growth. These targets belong to the API/DB benchmark track; frontend numbers must be compared to them only where the metric is shared, and never treated as achieved until a run in §4 records them.

### 5.2 Out-of-scope changes recorded, not made

- `apps/web/package.json`, `apps/web/next.config.ts`, and any CSP widening: deferred until repeated runs justify a script/dependency or an explicit, reviewed origin change.
- `apps/web/src/app/(dashboard)/chat/page.tsx` and the CHAT-03 `apps/web/src/hooks/use-chat-stream.ts`: conditional on CHAT-03 availability and profiler evidence.
- `apps/web/src/components/cms/lesson-form.tsx` and chart/motion users: conditional on bundle evidence.
- `apps/web/src/app/(dashboard)/speaking/page.tsx`: conditional on profiler evidence, with FE-01 media cleanup preserved.
- Adding a benchmark runner, modifying API/AI-service code, or running any load test against an external provider: not part of this slice.

## 6. Handoff checklist for the next author

1. Run P0–P8 in §4; keep the no-fabrication rule in §0 in force.
2. Fill §3 cells from artifacts, one row per run ID and condition; keep unmeasured cells as `NOT MEASURED`.
3. Fill `docs/benchmarks/frontend-baseline.template.json` copy with the same values; never write secrets, tokens, transcripts, or real learner data into either file.
4. Only after that, change the header status from TEMPLATE and add a changelog entry with SHA, timestamp, and evidence links.
5. Apply §5 changes one at a time and re-measure under identical conditions; record `STALE` for any superseded number.
