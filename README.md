# LinguaAI

Smart language learning platform with LLM-powered features and spaced repetition (FSRS/SM-2). Monorepo: NestJS API, Next.js web app, FastAPI AI service, PostgreSQL/Redis infrastructure and report sources.

This README describes the source tree at commit `3be6aa3` (`3be6aa39ad65fc7cfef22d75c84e40c5927b0389`, 2026-11-28). It is a source map and documented walkthrough, **not a release certificate**: see [Verification status](#verification-status) before treating any gate as green. No `.env` value or provider key is reproduced here; use only the `<replace-me>` example files listed below.

## Product use case

A learner signs in, sets a target language, takes a placement check, reviews due flashcards on an FSRS/SM-2 schedule, practises writing/reading/grammar/speaking, and chats with an AI tutor. AI calls are metered from a token balance with durable operation records; a teacher/moderator can review AI-generated content before it is published. Admins manage users, lessons and token grants. The product is a development portfolio/demo, not a certified assessment or a measured learning-outcome claim; see [Known limitations](#known-limitations).

## Architecture

| Component | Stack | Port | Role |
|---|---|---:|---|
| `apps/api` | NestJS, Prisma, PostgreSQL, Redis | 3001 | `/api/v1` REST API: auth/MFA/OAuth, decks, flashcards, SRS, quiz, writing, reading, speaking, chat, analytics, admin, plus new proficiency, content-workflow and durable AI-operation modules |
| `apps/web` | Next.js App Router, React, TypeScript | 3000 | Learner UI, admin/CMS, teacher review UI, incremental SSE parser |
| `apps/ai-service` | Python FastAPI, Groq Cloud | 8000 | Content generation, writing assessment, grammar, tutor chat (SSE), error analysis, NLP, centralized limits and model routing |
| `packages/shared` | TypeScript | — | Shared types and constants |
| `docker/` | Docker Compose | — | PostgreSQL 16, Redis 7 and images for all three services |

The AI service calls Groq LLMs. `GROQ_MODEL`, `GROQ_MODEL_LIGHT` and `GROQ_MODEL_HEAVY` are still read as legacy aliases by `app/services/model_router.py`, which resolves them to policy model ids. The NestJS backend owns authorization, token billing, persistence and calls the AI service through `AI_SERVICE_URL`. All routes are mounted under `/api/v1`; paths below omit that prefix.

### Modules added in the current slice

| Module | Location / routes | What is actually present |
|---|---|---|
| AI operations | `apps/api/src/ai-operations/` (`AiOperationsModule`, repository, service, transition policy, DTOs) | Durable operation lifecycle: scoped find/create, fenced lease claim, terminal transitions and refund policy hooks. **No controller** — the service is consumed in-process by the chat/billing orchestration, not exposed as a public endpoint. Backed by migration `20261128000000_add_ai_operations` and the `ai_operations` Prisma model. |
| Daily grants | migration `20261128001000_add_daily_credit_grants`, `daily_credit_grants` Prisma model | Once-per-UTC-day marker for top-up and check-in grants, including zero-amount processed days; unique on `(user_id, grant_type, day)`. Redis is not the source of truth for the marker. |
| Proficiency | `apps/api/src/proficiency/` (`ProficiencyModule`, controller with JWT guard) | `GET /proficiency/summary`, `GET /proficiency/placement-attempts`, `POST /proficiency/placement`, plus onboarding, mastery, daily-plan and error endpoints in the same controller. `RecordEvidenceDto` exists in the service layer only, not as a new public HTTP route. Raw-SQL tables `skill_proficiency` / `placement_attempts` come from `20261128003000_skill_proficiency`. |
| Content workflow | `apps/api/src/content-workflow/` (`ContentWorkflowModule`, JWT + admin/moderator roles) | `GET|POST /content-workflow/submissions`, `GET /content-workflow/submissions/:id`, `PATCH /content-workflow/submissions/:id/approve`, `PATCH /content-workflow/submissions/:id/reject`, with audit logging and optimistic version checks. Raw-SQL table `content_submissions` comes from `20261128004000_content_workflow`. |
| Teacher review UI | `apps/web/src/app/(dashboard)/teacher/review/page.tsx` | Review list and approve/reject actions against `/content-workflow/submissions`; no separate browser E2E run is recorded. |
| SSE parser | `apps/web/src/lib/sse-parser.ts` and `.spec.ts` | Incremental parsing of arbitrary byte splits, multi-event chunks, Unicode, terminal/failure/cancel and EOF/`[DONE]` handling. The web unit suite includes its spec; browser flows are not verified here. |
| File validation and storage | `apps/api/src/files/file-validation.ts` | Shared decoded-byte budget (10 MB audio, 5 MB images), MIME allow-list, magic-byte checks, strict base64 decoding, server-generated owner-scoped keys and checksums for REST uploads, transcription and WebSocket frames. `StorageAdapter` still writes to the **local filesystem** (`uploads/`) and returns public URLs. |
| AI service limits | `apps/ai-service/app/core/limits.py` | Character/token ceilings (e.g. 12,000 context chars, 8,192 hard max-token ceiling), per-feature rate knobs, concurrency caps and a daily token budget; `FAIL_CLOSED_ON_STORE_ERROR = True` for billable routes. |

`ProficiencyModule`, `ContentWorkflowModule` and `AiOperationsModule` are registered in `apps/api/src/app.module.ts`, so the routes above are mounted. The older `apps/api/src/proficiency/HANDOFF.md` note saying registration is pending is stale. `skill_proficiency` and `content_submissions` are raw-SQL tables intentionally absent from `schema.prisma`; Prisma-only tooling does not model them.

## Features

- JWT access/refresh tokens with blacklist, MFA (TOTP + backup codes), Google/GitHub OAuth, device/session management, role-based admin.
- Decks and flashcards, FSRS/SM-2 review scheduling, review forecasts, adaptive quizzes, streaks and goals.
- AI-generated flashcards, quizzes and reading passages; writing feedback; grammar explanations; streaming tutor chat; speaking support.
- Token economy with durable AI operations, idempotent consumption, reserve/settle/refund transitions, daily grants and transaction history. No public token-purchase flow is offered.
- Placement, mastery summaries, daily plans and error-to-flashcard flows; reviewable AI-generated content submissions for admins/moderators.
- CMS for lessons with image/audio uploads and seeded JLPT/HSK vocabulary.
- Health checks, rate limiting, audit log and Redis caching.

## Requirements

- Node.js 20+ LTS, pnpm 9+ (root pins `pnpm@9.15.0`)
- Python 3.12+
- Docker & Docker Compose (recommended for PostgreSQL/Redis), or PostgreSQL 16 + Redis 7 locally

## Quick start

```bash
git clone https://github.com/nguyenluunhatminh02/linguaai-smart-learning.git
cd linguaai-smart-learning

cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
cp apps/ai-service/.env.example apps/ai-service/.env
# Fill in: GROQ_API_KEY, JWT_SECRET, JWT_REFRESH_SECRET, MFA_ENCRYPTION_KEY,
# POSTGRES_PASSWORD, REDIS_PASSWORD, AI_SERVICE_API_KEYS.
# NestJS also needs apps/api/.env with the corresponding values.
# Never commit those files or paste real values into docs, issues or CI logs.

pnpm install
docker compose -f docker/docker-compose.yml up -d postgres redis
pnpm db:generate
pnpm db:migrate
pnpm db:seed

cd apps/ai-service
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
pip install pytest pytest-asyncio   # test-only; see requirements-dev.txt when present
cd ../..
```

Use only local, randomly generated secrets. [SETUP.md](SETUP.md) contains a **placeholder-looking** Groq key prefix in its illustrative text; treat it as a placeholder, not a usable credential. `docs/provider-setup.md` lists variable names, owners and rotation steps but never real values.

## Run

```bash
pnpm dev        # all services in development
pnpm dev:api    # NestJS at http://localhost:3001/api/v1
pnpm dev:web    # Next.js at http://localhost:3000
pnpm dev:ai     # FastAPI at http://localhost:8000
```

Docker (all services):

```bash
pnpm docker:dev
pnpm docker:down
```

Production build:

```bash
pnpm build
pnpm --dir apps/api start:prod
```

The Python service is not compiled by `pnpm build`; run it directly with `uvicorn app.main:app --port 8000`.

## Demo walkthrough (manual, not a recorded video)

1. Start the stack via Quick start; confirm `GET /api/v1/health` and `GET http://localhost:8000/health` respond.
2. Register and log in at `http://localhost:3000/login`, then open the learner dashboard. Static screenshots of a prior manual pass are in [`test-screenshots/`](test-screenshots/) (login, dashboard, admin users/lessons, vocabulary packs); they are historical evidence of UI navigation, not of the current commit.
3. Open a deck, review due cards, then use a writing or chat feature. For chat, watch the SSE stream terminate explicitly: a completed event ends successfully; a failed/aborted event or EOF without `[DONE]` must **not** be shown as success. Mock the provider or use fake keys locally so no billable call is made.
4. Check the token balance/transaction history after an AI call, then (as admin/moderator) open `/content-workflow/submissions` or the teacher review page and approve/reject a draft; verify the version conflict path by submitting a stale version.
5. To exercise failure handling deliberately, stop Redis for a billable AI route and confirm the request fails closed rather than spending upstream budget, then restore it. Do not run reset/truncate scripts against a shared or production database.

Playwright specs under `apps/web/e2e/` (`auth-flow`, `learning-flow`, `review-session`, `state-isolation`) describe browser flows, but **no browser run is recorded for the current commit**. There is no demo video in the repository.

## Checks

Reproduce with these commands, recording exit codes, first errors and the commit SHA:

```bash
pnpm type-check
pnpm --filter api test -- --runInBand
pnpm --filter web test:run
python -m pytest -q --tb=line   # from apps/ai-service, in a venv with pytest installed
pnpm build                      # known local failure, see below
```

The CI skeleton in `.github/workflows/ci.yml` runs install, Prisma generate, type-checks, lints, unit suites and AI-service pytest with **fake** env values; it has no service containers, DB migration, browser E2E, load test or deploy job. Passing CI unit jobs is not evidence that E2E or production behaviour works.

## Verification status

Observed results from `docs/test-report.md`, collected at HEAD `3be6aa3` in a dirty working tree with concurrent edits. These are point-in-time observations, not release gates; re-run at a fixed HEAD before relying on them.

| Check | Observed status |
|---|---|
| `pnpm --filter api type-check` | RUN / PASS (exit 0) |
| `pnpm --filter web type-check` | RUN / PASS (exit 0) |
| `pnpm --filter api test -- --runInBand` | RUN / PASS (exit 0; 52 suites, 632 tests) |
| `pnpm --filter web test:run` | RUN / PASS (exit 0; 9 files, 59 tests) |
| AI-service pytest via pre-existing `/tmp/ai-provider-venv/bin/python -m pytest -q --tb=line` | RUN / PASS (exit 0; 107 passed). The exact roadmap form `python -m pytest -q` in a fresh repo venv was **NOT RUN**. |
| `pnpm --filter web lint` | RUN / FAIL (exit 1; 41 errors, 597 warnings, mostly `no-explicit-any`) |
| `pnpm build` | RUN / FAIL (exit 1; missing Linux `lightningcss.linux-x64-gnu.node` in local `node_modules`) |
| `docker compose -f docker/docker-compose.yml config --quiet` | RUN / FAIL (exit 1; `MFA_ENCRYPTION_KEY` interpolation missing locally) |
| `pnpm --filter api lint` | UNRESOLVED / CONCURRENT (over 7 minutes with another ESLint process running; no trustworthy result) |
| API DB E2E `pnpm --filter api test:e2e` | **NOT RUN** — needs a disposable, migrated, seeded PostgreSQL DB; `apps/api/test/setup.ts` runs `TRUNCATE TABLE users CASCADE`. |
| Web E2E `pnpm --filter web exec playwright test` | **NOT RUN** |
| AI eval, load/performance, infra smoke, dependency audit | **NOT RUN** (procedures and specs exist; no invocation recorded) |
| `pnpm install --frozen-lockfile`, `pnpm --filter api db:generate` | **NOT RUN** |

Important: the new modules are covered by API unit specs (e.g. `ai-operations.policy.spec.ts`, `ai-operations.service.spec.ts`, `content-workflow.service.spec.ts`, `content-workflow.spec.ts`, `proficiency.controller.spec.ts`) and web `sse-parser.spec.ts`, but their **DB concurrency, crash-recovery and browser E2E scenarios are contract-only/NOT RUN**. Test-file existence is not execution evidence. `apps/ai-service/requirements-dev.txt` and `apps/ai-service/tests/conftest.py` are untracked local additions; `conftest.py` forces `APP_ENV`/`NODE_ENV=test` before app import, so non-test-env behaviour of the rate-limit store is unverified.

## Known limitations

1. **No verified production readiness.** Web lint and build fail locally; API lint unresolved; compose config blocked; all DB E2E, browser E2E, load and AI-eval gates are NOT RUN. Do not call the tree green from unit totals alone.
2. **Storage is local and public.** `StorageAdapter` writes to `uploads/` and serves public URLs; it is not a multi-instance or private object store. Do not upload sensitive audio or private learner data as if it were protected. `docs/data-retention.md` records unresolved purge gaps for raw-SQL rows and uploads.
3. **AI limits are staging hypotheses.** The numbers in `app/core/limits.py` (chat 10/min, content 3/min, 2 per-user concurrent, 8 global, 2M estimated daily tokens) are *starting values to measure*, not verified capacity or provider quotas. Billable routes fail closed on Redis/store errors, but non-test-env store behaviour has not been exercised. Input bounds and output schemas reduce risk; they do not guarantee prompt-injection safety or age-appropriate content.
4. **AI output is not an authority.** Model output is validated structurally but must be reviewed for correctness; AI feedback is not certified grading and must not be presented as an official exam result or as a proven learning improvement. Provider-side retention, no-training terms and deletion mechanisms remain unverified; see `docs/data-retention.md` and `docs/pilot-policy.md`.
5. **Proposals are not implementations.** Roadmap items for RAG, BullMQ worker queues, S3-compatible storage, sequence diagrams, ADR-005, demo video and load/cost reports are proposals or pending deliverables, not shipped features. Only ADR-001–004 exist. `docs/billing-call-sites.md`, `docs/endpoint-inventory-*.md`, `docs/baseline.md`, `docs/ai_service.md`, `docs/function_app.md` and `docs/test_func.md` are **historical snapshots** of earlier source states (several pinned to `384f827` or earlier); they describe routes such as public `/tokens/consume` and free `/chat/stream` that have since changed. `docs/baseline.md` in particular is explicitly superseded by `docs/test-report.md` and must not be quoted as current.
6. **No public purchase path.** Token purchase was disabled in BILL-01; only server-side grants/consumption are in scope.

## Layout

```text
apps/api/            NestJS backend, Prisma schema/migrations/seed, ai-operations, proficiency, content-workflow, files
apps/web/            Next.js app, components, stores, i18n, API routes, teacher/review UI, sse-parser
apps/ai-service/     FastAPI app, prompts, routers, services, core limits, tests
packages/shared/     Shared TypeScript types
docker/              Dockerfiles and compose config
docs/                Technical documentation (mixed current policy and historical snapshots)
baocao/              Report generation sources (PDF/DOCX)
test-screenshots/    Historical manual UI screenshots (not current-commit evidence)
tests-manual/        Manual test scripts
SETUP.md             Detailed setup guide (Vietnamese)
```

## Documentation

- [SETUP.md](SETUP.md) — detailed setup and operation guide (Vietnamese; illustrative keys are placeholders).
- [docs/provider-setup.md](docs/provider-setup.md) — environment variable names, owners and secret rotation (values are never documented).
- [docs/test-report.md](docs/test-report.md) — current observed command/exit-code matrix and blocker register for HEAD `3be6aa3`.
- [docs/baseline.md](docs/baseline.md) — **historical** BASE-01/02 snapshot at `384f827`; superseded results, do not treat as current.
- [docs/data-retention.md](docs/data-retention.md) and [docs/pilot-policy.md](docs/pilot-policy.md) — documented policy with explicit implementation gaps.
- [docs/function_app.md](docs/function_app.md) — pre-`3be6aa3` feature catalogue (historical).
- [docs/ai_service.md](docs/ai_service.md) — pre-`3be6aa3` AI service description (historical).
- [docs/test_func.md](docs/test_func.md) — older functional test scenarios (historical).

## Security

`.env`, `.env.local` and key files are gitignored. Never commit API keys, database passwords or JWT secrets.

Secrets checklist (SEC-10):

- [ ] Every `.env.example` uses `<replace-me>` placeholders, never a real or plausible credential; real values live only in gitignored env files or the deployment secret store.
- [ ] Provider key `GROQ_API_KEY` and service keys `AI_SERVICE_API_KEYS`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `MFA_ENCRYPTION_KEY`, `DATABASE_PASSWORD` / `POSTGRES_PASSWORD`, and `REDIS_PASSWORD` are set server-side only.
- [ ] No secret uses a `NEXT_PUBLIC_*` name; `NEXT_PUBLIC_DISABLE_AUTH=false` outside local development.
- [ ] Logs, CI output, error reports and client bundles contain no keys (`NEXT_PUBLIC_*` values are public at build time by design).
- [ ] If a secret was ever committed or logged, rotate it at the provider and update all owning env files; see [docs/provider-setup.md](docs/provider-setup.md) for the rotation checklist.

Checklist items are policy targets, not verified completions; CI currently checks only that no tracked `.env` exists and uses fake values.
