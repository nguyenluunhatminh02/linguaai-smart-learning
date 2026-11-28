# Provider and secret setup (SEC-10)

This page lists **variable names only**. It never contains working values. Copy the relevant `.env.example` file to the runtime env file (`.env`, `.env.local`, or `apps/api/.env`) and supply each value from your own secret manager or local shell. Do not paste real values into chat, issues, commits, or build artifacts.

## Rule

- `docs/` examples and `.env.example` files use placeholders such as `<replace-me>`; a placeholder is not a credential and must never be used as one.
- Keep real values only in gitignored local env files or in the deployment platform's secret store.
- `NEXT_PUBLIC_*` variables are embedded in the browser bundle at build time. Never put a secret in a `NEXT_PUBLIC_*` name.
- CI logs are not secret stores. Do not echo env files or print resolved env values in CI.

## Groq LLM provider

`GROQ_API_KEY` is the provider credential. Obtain it from your Groq account and set it **only** in server-side env files/secret stores:

| Owner file | Purpose |
|---|---|
| `apps/ai-service/.env` | Python FastAPI service (production refuses to boot without `GROQ_API_KEY`). |
| `apps/api/.env` | NestJS API when it calls Groq directly. |
| `apps/web/.env.local` | **Transitional only**: some existing Next.js server routes still call Groq directly. Do not widen this usage; move these routes behind the API and then remove the key from the web app. |

Model selectors (not secrets): `GROQ_MODEL`, `GROQ_MODEL_LIGHT`, `GROQ_MODEL_HEAVY`. Endpoint override (not a secret): `GROQ_BASE_URL`. Generation knobs: `MAX_TOKENS`, `TEMPERATURE`, `REQUEST_TIMEOUT`.

## AI service authentication

`AI_SERVICE_API_KEYS` is a comma-separated list of keys the API uses to call the AI service. It is required in production for both apps and is checked at startup by the FastAPI settings. Generate each key locally with a cryptographically random generator; never commit the generated output.

`AI_SERVICE_URL` / `NEXT_PUBLIC_AI_SERVICE_URL` are non-secret endpoint URLs. `NEXT_PUBLIC_AI_SERVICE_URL` is public by design and should point at the API/AI-service proxy, not expose a credential.

## Database and cache

| Variable | Owner file | Secret? |
|---|---|---|
| `DATABASE_URL`, `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_SSL` | root `.env`, `apps/api/.env`, compose interpolation | `DATABASE_URL` and `DATABASE_PASSWORD` are secrets. |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | root `.env` (Docker Compose) | `POSTGRES_PASSWORD` is a secret. |
| `REDIS_URL`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | root `.env`, `apps/ai-service/.env`, `apps/api/.env`, compose interpolation | `REDIS_URL` (may embed credentials) and `REDIS_PASSWORD` are secrets. |

## Auth and session secrets

`JWT_SECRET`, `JWT_REFRESH_SECRET`, `MFA_ENCRYPTION_KEY` — set in root `.env`, `apps/api/.env`, and compose interpolation. All three are secrets. `JWT_ACCESS_EXPIRY` and `JWT_REFRESH_EXPIRY` are durations, not secrets.

`apps/web/src/lib/auth/jwt-verify.ts` still reads `JWT_SECRET` for local route verification. This is a transitional pattern from the current architecture, not a recommended place for the API signing secret; do not add it to new web routes, and remove it when verification moves behind the API.

OAuth client credentials `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `GITHUB_CALLBACK_URL` belong in `apps/api/.env`. Client IDs and callback URLs are configuration; client secrets are secrets.

Seeding-only names `SEED_CURATOR_EMAIL`, `SEED_CURATOR_PASSWORD` belong in a local env file used for seeding, never in production configuration committed to the repo.

## Web/API configuration (non-secret unless noted)

- `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_DISABLE_AUTH` — public build-time values; `NEXT_PUBLIC_DISABLE_AUTH` must stay `false` outside local development.
- `CMS_BACKEND_URL` — server-side URL; treat any URL with embedded credentials as a secret and move the credentials to a dedicated secret variable.
- `API_PORT`, `WEB_PORT`, `AI_PORT`, `NODE_ENV`, `APP_ENV`, `DEBUG`, `SWAGGER_ENABLED` — runtime settings.
- `CORS_ORIGINS`, `TRUST_PROXY_IPS` / `TRUSTED_PROXIES` / `TRUSTED_PROXY_IPS`, `ALLOW_INSECURE_HTTP_ORIGINS`, `RATE_LIMIT_MAX_REQUESTS`, `RATE_LIMIT_WINDOW_MS`, `FRONTEND_URL`, `PASSWORD_HISTORY_LIMIT` — deployment configuration; review per environment.

## Rotation checklist (SEC-10)

1. Revoke/rotate the affected credential at its provider first (Groq console, database/cache admin, OAuth provider) and issue a new value into the secret store.
2. Update every owner listed above, redeploy, and verify health checks.
3. Revoke old sessions/tokens if `JWT_SECRET` or `JWT_REFRESH_SECRET` changed; re-encrypt MFA data if `MFA_ENCRYPTION_KEY` changed.
4. Search git history, CI logs, client bundles, and error reports for the old value. If it was ever committed or logged, treat it as compromised and rotate again after removal.
5. Never put the rotated value back into a tracked example file; keep placeholders there.
