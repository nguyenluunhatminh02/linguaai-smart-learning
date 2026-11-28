# Benchmark harness (OPS-15 / PERF-01)

This directory holds reports produced by `scripts/benchmark.mjs`. The harness
is a zero-dependency Node.js ESM script that measures client-side latency,
throughput and SSE behaviour against the API with bounded virtual-user
workers. It does **not** assert SLO pass/fail on its own; proposed thresholds
live in `LinguaAI_Engineering_Roadmap.md` (PERF-01) and `docs/load-test-plan.md`.

## Scope

- Fake provider by default. Live provider is opt-in and requires an explicit
  non-production base URL, `--allow-live`, `--max-requests <n>` and a
  dedicated test account whose password is read from an environment variable
  (the value is never printed or stored).
- Scenarios: `read`, `srs`, `chat-sse`, `all`.
- Concurrency steps (default `10,25,50,100`), per-step warm-up, steady-state
  and ramp durations.
- Measured outputs: p50/p95/p99 latency, throughput, error breakdown, SSE
  TTFT, sequence-gap count, client RSS/heap/CPU.
- Reports are JSON files written under `docs/benchmarks/` with a run id
  derived from the timestamp, mode and scenario.

## Required metadata in every report

Each JSON report records:

- Commit SHA and branch (`provenance.git.head`, `provenance.git.branch`).
- Node and pnpm versions (`provenance.tools`).
- Machine, OS, CPU count and total memory (`provenance.machine`).
- Dataset seed and synthetic-data description (`provenance.dataset`).
- Environment variable **names only** (`provenance.envVariableNames`); values
  are never recorded.
- The exact command line, with secrets redacted (`provenance.command`).
- Start and finish timestamps (`provenance.startedAt`, `provenance.finishedAt`).
- Limitations and invariants that still need manual verification
  (`provenance.limitations`).

## Running locally (fake provider)

```bash
# Validate configuration without making any network call.
pnpm benchmark:dry

# Run the default scenario against a local API on port 3001.
pnpm benchmark

# Custom steps and shorter durations for a quick sanity check.
pnpm benchmark -- --steps 5,10 --warmup-ms 500 --steady-ms 1500 --scenario read

# Machine-readable JSON on stdout instead of a file.
pnpm benchmark -- --json
```

The test user must exist in the target database; the default email is
`benchmark@example.test` and the password is read from
`BENCHMARK_LOGIN_PASSWORD` (or the name passed via `--login-password-env`).

## Running against a live provider (opt-in)

Live mode is **never** the default and cannot fall back from fake. It requires
every one of the following guards:

- `--mode live`
- `--allow-live`
- `--max-requests <n>` (positive integer, hard cap)
- `--base-url` that resolves to loopback, `.local`, `.internal` or `.test`
- `--login-password-env <NAME>` pointing at a dedicated test account

```bash
BENCHMARK_LIVE_PASSWORD='…' pnpm benchmark -- \
  --mode live --allow-live --max-requests 20 \
  --base-url http://api.staging.test:3001 \
  --login-password-env BENCHMARK_LIVE_PASSWORD \
  --scenario chat-sse
```

Warnings are printed before any request is made. Stop immediately if cost,
quota or authorization is exceeded; do not re-run to "get a nicer number".

## Unit tests

`scripts/benchmark.spec.mjs` covers argument parsing, step validation,
percentile math, SSE line buffering (CRLF, split UTF-8, multibyte), terminal
event detection and redaction. It uses `node:test` and has no network
dependency.

```bash
pnpm benchmark:test
```

CI runs both `benchmark:test` and `benchmark:dry` as non-blocking steps; no
load test and no provider call ever run in pull-request CI.

## Interpretation

- Latency is measured client-side and includes network + server time. For
  server-side breakdowns (DB pool wait, queue depth, GC, event-loop lag) use
  the instrumentation described in OPS-03 / `docs/load-test-plan.md`.
- The harness does not verify server-side invariants (ledger balance,
  duplicate settlement, SRS event uniqueness). Those checks are manual and
  belong in the per-run report template from `docs/load-test-plan.md`.
- A single run is not evidence of an SLO. Repeat runs, different scenarios
  and different machine classes are needed before promoting a threshold from
  `PROPOSED / NOT MEASURED` to a committed SLO.
- `sse.sequenceGaps > 0` or missing terminal events are correctness signals,
  not performance signals; investigate before optimising latency.

## Files

- `scripts/benchmark.mjs` — harness entry point.
- `scripts/benchmark.spec.mjs` — deterministic unit tests.
- `docs/benchmarks/<run-id>.json` — generated reports (gitignored except for
  this README).
- `docs/load-test-plan.md` — workload definition, invariant checklist and
  report template that complements this harness.
