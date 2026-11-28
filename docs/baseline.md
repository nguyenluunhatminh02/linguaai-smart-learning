# BASE-01 / BASE-02 baseline report

## 1. Snapshot and provenance

| Field | Value |
|---|---|
| Git HEAD | `384f82797419d919bf626e8526add1c1e3c111f9` (`main`) |
| Roadmap source | `LinguaAI_Engineering_Roadmap.md` (untracked at snapshot time), BASE-01 lines 138–176 and BASE-02 lines 178–186 |
| Commands from | Repository root, except the `cd apps/ai-service` block in the BASE-01 script |
| Timestamps | Full FastAPI suite: `2026-11-27T18:49:32Z`; API/web typechecks: `2026-11-27T18:51:03Z` / `2026-11-27T18:50:56Z`; Jest/Vitest CLI checks: `2026-11-27T18:49:58Z` |
| Working tree | Not clean. At HEAD: `M apps/web/src/lib/api-client.spec.ts`, untracked `LinguaAI_Engineering_Roadmap.md`. During the second check, other agents had additionally modified API token files, `apps/web/src/app/(dashboard)/pricing/page.tsx`, and had added AI-operations files and `docs/billing-call-sites.md`. No `chore/baseline` branch was observed; current branch is `main`. |

This is a point-in-time snapshot, not a statement that HEAD is green. Concurrent agents were changing code while this report was collected: the web typecheck failed both when first run and on recheck, but the specific errors changed between runs. No `.env` file was read or copied. Local secrets must stay local; `.env` files must not be committed.

## 2. Runtime and tooling versions observed

| Tool | Version / observation |
|---|---|
| Node | `v24.18.1` (`node -v`) |
| pnpm | `9.15.9` (`pnpm -v`); root `package.json` pins `packageManager: pnpm@9.15.0` |
| Python | `Python 3.12.3` (`python3 --version`) |
| Docker Compose | `Docker Compose version v5.5.1` (`docker compose version`) |
| TypeScript | `5.9.3` via `node node_modules/typescript/bin/tsc --version`. The `node_modules/.bin/tsc` symlink is not executable (EACCES), so `pnpm exec tsc` was used instead. |
| Jest | Package `29.7.0` present; `pnpm --dir apps/api exec jest --version` printed `29.7.0` (exit 0) and `./node_modules/.bin/jest --version` also printed `29.7.0`. An earlier attempt in this environment hit `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` / EACCES; current results must be read as CLI-only checks, not a test run. |
| Vitest | Package `4.1.8` present; `pnpm --dir apps/web exec vitest --version` failed with `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL: Command failed with EACCES: vitest --version`. The `node_modules/.bin/vitest` symlink lacks the execute bit. No Vitest suite was run. |
| Python test venv | Existing temporary venv `/tmp/ai-provider-venv` (outside the repo; ephemeral): pytest `9.2.0`, pytest-asyncio `1.5.0`, fastapi `0.115.6`, slowapi `0.1.9`, httpx `0.28.1`, Python `3.12.3`. `pytest.ini` sets `testpaths = tests` and `asyncio_mode = auto`. |

The venv was used as-is; it was not recreated during this baseline. `apps/ai-service/requirements.txt` pins the service dependencies (including fastapi `0.115.6`, httpx `0.28.1`, and slowapi `0.1.9`) but does not list pytest or pytest-asyncio, which the roadmap says to install separately if missing.

## 3. Exact BASE-01 commands and observed status

The command block below is copied verbatim from `LinguaAI_Engineering_Roadmap.md` lines 146–169. Statuses refer only to what was actually executed during this baseline; a command with no recorded invocation is `NOT RUN`, never green.

```bash
# Chạy từ root repo, sau khi cấu hình môi trường local theo SETUP.md.
node -v
pnpm -v
python3 --version
docker compose version
pnpm install --frozen-lockfile
pnpm --filter api db:generate
pnpm --filter api type-check
pnpm --filter web type-check
pnpm --filter api lint
pnpm --filter web lint
pnpm --filter api test --runInBand
pnpm --filter web test:run
pnpm build

# Python AI service
cd apps/ai-service
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
# Cài pytest và dependency test theo config nếu chưa nằm trong requirements.
python -m pytest -q
```

| Command (roadmap text) | Status | Result / evidence |
|---|---|---|
| `node -v` | RUN / PASS | `v24.18.1`. |
| `pnpm -v` | RUN / PASS | `9.15.9`. |
| `python3 --version` | RUN / PASS | `Python 3.12.3`. |
| `docker compose version` | RUN / PASS | `Docker Compose version v5.5.1`. |
| `pnpm install --frozen-lockfile` | NOT RUN | No install performed in this baseline (package managers were not run). |
| `pnpm --filter api db:generate` | NOT RUN | Prisma generation not verified here. |
| `pnpm --filter api type-check` | EQUIVALENT CHECK RUN / PASS | `pnpm exec tsc --noEmit --incremental false -p apps/api/tsconfig.json` exited 0 at `2026-11-27T18:51:03Z`. The exact scripted command (`tsc --noEmit && tsc --noEmit -p tsconfig.spec.json`) was not run; only the equivalent no-emit check just described is verified. |
| `pnpm --filter web type-check` | EQUIVALENT CHECK RUN / FAIL | `pnpm exec tsc --noEmit --incremental false -p apps/web/tsconfig.json` exited 2 at `2026-11-27T18:50:56Z`. Errors: `TokenPackage` / `apiClient` / `toast` / `Sparkles` / `CreditCard` / `Loader2` cannot be found in `apps/web/src/app/(dashboard)/pricing/page.tsx` (TS2304). A concurrent edit to that file changed the exact error set between two runs; both runs failed. The exact `pnpm --filter web type-check` script was not run. |
| `pnpm --filter api lint` | NOT RUN | No lint result. |
| `pnpm --filter web lint` | NOT RUN | No lint result. |
| `pnpm --filter api test --runInBand` | NOT RUN | Jest suite not run; only `--version` was checked. See the tooling note above about the earlier EACCES observation. |
| `pnpm --filter web test:run` | NOT RUN | Vitest suite not run; the CLI `--version` check itself hit EACCES. |
| `pnpm build` | NOT RUN | No build result. |
| `cd apps/ai-service` | RUN (shell context only) | Python checks were executed from `apps/ai-service`. |
| `python3 -m venv .venv` | NOT RUN | Existing `apps/ai-service/.venv` and `/tmp/ai-provider-venv` were not created in this baseline. |
| `source .venv/bin/activate` | NOT RUN | The temp venv interpreter was invoked by absolute path instead. |
| `python -m pip install -r requirements.txt` | NOT RUN | No package installation performed in this baseline. |
| `python -m pytest -q` | RUN / FAIL (in temp venv) | Absolute-path invocation: `/tmp/ai-provider-venv/bin/python -m pytest -q`, exit 1, `74 passed, 6 failed in 1.48s` at `2026-11-27T18:49:32Z`. A repeat with `--tb=no` reported `6 failed, 74 passed, 1 warning in 1.38s`. This is not the exact roadmap command (which assumes an activated `.venv`). |

E2E commands from roadmap lines 173–176 are **NOT RUN**:

```bash
pnpm --filter api test:e2e
pnpm --filter web exec playwright test
```

They require a test database, migrations/seed, and test URLs as described in the roadmap. No reset/truncate command was executed against any database.

## 4. FastAPI results and the six failures

Reproduction command (from `apps/ai-service`, with the already-existing temp venv):

```bash
/tmp/ai-provider-venv/bin/python -m pytest -q
```

Result: exit 1, `74 passed / 6 failed`. Pytest-asyncio emitted a `PytestDeprecationWarning` because `asyncio_default_fixture_loop_scope` is unset; this is a warning, not one of the six failures. A Redis cache warning appeared in captured logs (cache disabled); it did not change test outcomes.

1. `tests/test_llm_client.py::test_health_check_returns_true_on_200` — `assert False is True`. The stub returns HTTP 200 and configures only `mock_client.post`, but `health_check()` now issues `GET /v1/models` and requires a response dict containing `data`; the mock does not cover that contract.
2. `tests/test_routers_chat.py::test_chat_stream_emits_stream_interrupted_on_llm_failure` — the error event is emitted as expected, but the router deliberately also sends `data: [DONE]`; the stale assertion `[DONE] not in response.text` fails.
3. `tests/test_security.py::test_all_protected_endpoints_accept_configured_key[/v1/ai/content/generate-cards-payload2-mock_response2]` — the cached mock payload has an empty cards list, rejected by the current Pydantic `min_length=1` validation (`502 AI returned malformed response` is the expected branch). The router additionally raises `NameError: name '_strip_invisible_chars' is not defined` at `app/routers/content.py:31`.
4. `tests/test_security.py::test_all_protected_endpoints_accept_configured_key[/v1/ai/content/generate-quiz-questions-payload3-mock_response3]` — stale mock payload has `questions=[]`, failing `GenerateQuizQuestionsResponse` `min_length=1`; endpoint returns 502 instead of 200.
5. `tests/test_security.py::test_all_protected_endpoints_accept_configured_key[/v1/ai/errors/analyze-payload4-mock_response4]` — stale mock payload has `patterns=[]` and `exercises=[]`, failing `ErrorAnalysisResponse` `min_length=1`; endpoint returns 502 instead of 200.
6. `tests/test_security.py::test_all_protected_endpoints_accept_configured_key[/v1/ai/reading/generate-payload7-mock_response7]` — stale mock payload has `vocabulary=[]` and `questions=[]`, failing `ReadingGenerateResponse` `min_length=1`; endpoint returns 502 instead of 200.

These are pre-existing test/code contract drift (stale mocks, changed health-check contract, changed stream terminator behaviour, and a missing helper), **not** a regression caused by new LLM-provider work. Fix ownership belongs to the relevant code/test slices; this documentation slice changed no code, tests, or configuration.

## 5. Re-run instructions and caveats

- Use a local Python venv and install both `requirements.txt` and pytest/pytest-asyncio; do not assume `/tmp/ai-provider-venv` survives. Do not commit `.env` files or secrets.
- The `node_modules/.bin/tsc` and `node_modules/.bin/vitest` symlinks are not executable in this environment. `pnpm exec tsc ...` worked for TypeScript; no Vitest suite could be started. Record the observed command and error rather than treating this as a universal binary absence.
- Counts, failing test IDs, and the web typecheck result are tied to HEAD `384f82797419d919bf626e8526add1c1e3c111f9` and the dirty working tree described in section 1. Concurrent agents can make any of these results stale; re-run before relying on them.
- Commands not listed as RUN above (`db:generate`, lint, API/web test suites, build, E2E, install, venv creation) remain unverified. None are marked green.
- BASE-02 also asks for endpoint enumeration via Swagger/controllers and test fixtures; those items were outside this slice's assigned `docs/`-only scope and are not claimed here.

## 6. P0 verification follow-up (2026-11-28, HEAD `384f827`, dirty tree)

Observations only; none of these results marks a P0 gate green.

| Check | Command / source | Observed result |
|---|---|---|
| AI-service tests | From `apps/ai-service`: `/tmp/ai-provider-venv/bin/python -m pytest -q --tb=line` | Exit 1; `1 failed, 95 passed in 1.78s`. Sole failure: `tests/test_security.py::test_all_protected_endpoints_accept_configured_key[/v1/ai/reading/generate-payload7-mock_response7]`, first error `ResponseValidationError: extra_forbidden word_count`. This **supersedes** the `74 passed / 6 failed` count in sections 3–4; that count is stale for the current tree and must not be quoted as current without a rerun. |
| API DB e2e | `pnpm --filter api test:e2e` (script `apps/api/package.json:14`, config `apps/api/test/jest-e2e.json:1-16`) | **NOT RUN.** `apps/api/test/chat-billing.e2e-spec.ts:1-10` explicitly requires a disposable PostgreSQL database for billing-ledger assertions. A container named `linguaai-journey-test` is up, but no migration, seed, reset, or e2e run was observed; container presence is not a verified test DB. |
| Web e2e | `pnpm --filter web exec playwright test` | **NOT RUN.** |
| Vitest CLI | `pnpm --dir apps/web exec vitest --version` | Failed: `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL: Command failed with EACCES: vitest --version`; first error `spawn vitest EACCES`. `node_modules/.bin/vitest` mode `-rw-rw-rw-` (no execute bit). Consequently `pnpm --filter web test:run` is **NOT RUN** and no Vitest suite ran; consistent with sections 2, 3, and 5. |
| slowapi / env configuration | Read-only source inspection: `apps/ai-service/app/rate_limit.py:96-125`, `apps/ai-service/app/core/limits.py:52-88`, `apps/ai-service/tests/test_chat_stream_contract.py:36-40`, `apps/ai-service/.env.example:23-35` | Process-level verification **NOT RUN**. `rate_limit.py` selects `memory://` only when pytest is loaded or `APP_ENV=test`; otherwise it builds `redis://host:port` with in-memory fallback enabled. `limits.py` reads rate/budget env vars, but the stream contract test disables the limiter directly rather than validating env-based configuration. The example file only shows placeholders (`REDIS_URL=` empty, `APP_ENV=development`); no real `.env` value was read or written. |

Unblock steps: (1) run the API e2e suite against a disposable, migrated and seeded PostgreSQL DB; (2) restore execute permission on `node_modules/.bin/vitest` or invoke Vitest through a working runner, then rerun the web tests; (3) add an env-specific slowapi storage verification without reading or committing real `.env` values. Until those are done, DB e2e, Vitest, and non-test-env slowapi behavior remain unverified, and the AI-service suite still has one confirmed failure.
