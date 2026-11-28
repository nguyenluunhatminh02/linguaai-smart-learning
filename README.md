# LinguaAI

Smart language learning platform with LLM-powered features and spaced repetition (FSRS/SM-2). Monorepo: NestJS API, Next.js web app, FastAPI AI service, PostgreSQL/Redis infrastructure and report sources.

## Architecture

| Component | Stack | Port | Role |
|---|---|---:|---|
| `apps/api` | NestJS, Prisma, PostgreSQL, Redis | 3001 | `/api/v1` REST API: auth/MFA/OAuth, decks, flashcards, SRS, quiz, writing, reading, speaking, chat, analytics, admin |
| `apps/web` | Next.js App Router, React, TypeScript | 3000 | Learner UI and CMS |
| `apps/ai-service` | Python FastAPI, Groq Cloud | 8000 | Content generation, writing assessment, grammar, tutor chat (SSE), error analysis, NLP |
| `packages/shared` | TypeScript | — | Shared types and constants |
| `docker/` | Docker Compose | — | PostgreSQL 16, Redis 7 and images for all three services |

The AI service calls Groq LLMs configured via `GROQ_MODEL`, `GROQ_MODEL_LIGHT` and `GROQ_MODEL_HEAVY`. The NestJS backend owns authorization, token billing, persistence and calls the AI service through `AI_SERVICE_URL`.

## Features

- JWT access/refresh tokens with blacklist, MFA (TOTP + backup codes), Google/GitHub OAuth, device/session management, role-based admin.
- Decks and flashcards, FSRS/SM-2 review scheduling, review forecasts, adaptive quizzes, streaks and goals.
- AI-generated flashcards, quizzes and reading passages; writing feedback; grammar explanations; streaming tutor chat; speaking support.
- Token economy with daily grants, idempotent consumption and transaction history.
- CMS for lessons with image/audio uploads and seeded JLPT/HSK vocabulary.
- Health checks, rate limiting, audit log and Redis caching.

## Requirements

- Node.js 20+ LTS, pnpm 9+
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

pnpm install
docker compose -f docker/docker-compose.yml up -d postgres redis
pnpm db:generate
pnpm db:migrate
pnpm db:seed

cd apps/ai-service
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd ../..
```

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

## Checks

```bash
pnpm type-check
pnpm test
pnpm --dir apps/web test:run
python -m pytest apps/ai-service/tests -q
```

## Layout

```text
apps/api/            NestJS backend, Prisma schema/migrations/seed
apps/web/            Next.js app, components, stores, i18n, API routes
apps/ai-service/     FastAPI app, prompts, routers, services, tests
packages/shared/     Shared TypeScript types
docker/              Dockerfiles and compose config
docs/                Technical documentation
baocao/              Report generation sources (PDF/DOCX)
tests-manual/        Manual test scripts
SETUP.md             Detailed setup guide (Vietnamese)
```

## Documentation

- [SETUP.md](SETUP.md) — detailed setup and operation guide.
- [docs/provider-setup.md](docs/provider-setup.md) — environment variable names, owners and secret rotation (values are never documented).
- [docs/function_app.md](docs/function_app.md) — feature catalogue.
- [docs/ai_service.md](docs/ai_service.md) — AI service API.
- [docs/test_func.md](docs/test_func.md) — functional test scenarios.

## Security

`.env`, `.env.local` and key files are gitignored. Never commit API keys, database passwords or JWT secrets.

Secrets checklist (SEC-10):

- [ ] Every `.env.example` uses `<replace-me>` placeholders, never a real or plausible credential; real values live only in gitignored env files or the deployment secret store.
- [ ] Provider key `GROQ_API_KEY` and service keys `AI_SERVICE_API_KEYS`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `MFA_ENCRYPTION_KEY`, `DATABASE_PASSWORD` / `POSTGRES_PASSWORD`, and `REDIS_PASSWORD` are set server-side only.
- [ ] No secret uses a `NEXT_PUBLIC_*` name; `NEXT_PUBLIC_DISABLE_AUTH=false` outside local development.
- [ ] Logs, CI output, error reports and client bundles contain no keys (`NEXT_PUBLIC_*` values are public at build time by design).
- [ ] If a secret was ever committed or logged, rotate it at the provider and update all owning env files; see [docs/provider-setup.md](docs/provider-setup.md) for the rotation checklist.
