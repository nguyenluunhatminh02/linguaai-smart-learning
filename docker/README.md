# Compose operations (OPS-01)

Run from the repository root:

```bash
docker compose version
docker compose -f docker/docker-compose.yml config --quiet
docker compose -f docker/docker-compose.yml config --services
docker compose -f docker/docker-compose.yml up -d --build
docker compose -f docker/docker-compose.yml ps --format 'table {{.Name}}\t{{.Status}}'
docker inspect --format '{{.State.ExitCode}}' linguaai-migrate
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/api/health
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/api/health/ready
```

`docker/.env` is gitignored. Keep real values there; never commit them, and never
paste `docker compose config` output with interpolated secrets into logs or issues.

Encrypted logical backups, retention and the isolated-DB restore drill are covered by
`docs/backup-restore.md`; the one-shot migration job (`linguaai-migrate`) is the only
migration boundary — see `docs/migration-safety.md`. Do not restore into the
`postgres_data` volume.

## Validation without secret disclosure

Every command above is safe to paste into an issue, PR description or chat log
because its output contains only service names, status strings, exit codes and
HTTP status numbers — never interpolated environment values, request/response
headers or raw log lines. The acceptance gates for a healthy stack are:

| Check | Command | Pass criterion |
| --- | --- | --- |
| Compose syntax + interpolation | `docker compose -f docker/docker-compose.yml config --quiet` | exit `0` |
| All six services present | `docker compose -f docker/docker-compose.yml config --services` | output lists `postgres`, `redis`, `migrate`, `api`, `web`, `ai` (one per line) |
| Compose v2 available | `docker compose version` | prints a version string |
| Containers running | `docker compose -f docker/docker-compose.yml ps --format 'table {{.Name}}\t{{.Status}}'` | each long-running service shows `Up` (and `healthy` once its healthcheck passes) |
| Migration job succeeded | `docker inspect --format '{{.State.ExitCode}}' linguaai-migrate` | `0` |
| API liveness | `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/api/health` | `200` |
| API readiness (full stack) | `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/api/health/ready` | `200` |
| API readiness (dependency down) | stop `redis` or `postgres`, re-run readiness | `503`; restore the dependency and re-run — must return to `200` |

The readiness `503` is the expected behaviour only on a test stack where a
mandatory dependency has been stopped; it is not a production defect. The
readiness body is already filtered to public fields (see
`apps/api/src/health/health.controller.ts`), but status-only output removes any
risk if the contract ever changes.

### Safe to paste — never paste

| Safe to share (output contains no secrets) | Never paste into issues, logs or artifacts |
| --- | --- |
| `docker compose config --quiet` (exit code only) | `docker compose config` (prints fully interpolated YAML) |
| `docker compose config --services` (service names) | `docker inspect <container>` without `--format` (exposes env) |
| `docker compose ps --format 'table {{.Name}}\t{{.Status}}'` | `docker compose ps` with default format (may include env-derived labels) |
| `docker inspect --format '{{.State.ExitCode}}' <name>` | `docker logs <container>` raw (may contain keys if misconfigured) |
| `curl -sS -o /dev/null -w '%{http_code}\n' <url>` | `curl -i` / `curl -v` in shared evidence |
| `docker compose version` | `env`, `printenv`, `cat .env*`, `set` |

If you do need to debug locally with a command that prints raw config or logs,
run it in a private shell and redact every value before attaching the output to
an issue or PR. Variable **names** and ownership are fine to share; values are
not. For which variables each service requires and where to obtain them, see
[`docs/provider-setup.md`](../docs/provider-setup.md) and the CI composite
values in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) — neither
source contains real credentials.

## Public vs internal API URLs

| Variable | Scope | Meaning |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | browser + web build | Browser-facing base URL (e.g. public origin + `/api/v1`). Inlined into client JS at **image build time**; changing it at runtime does nothing until the web image is rebuilt. Never use a Docker service hostname here. Compose passes it both as the required `NEXT_PUBLIC_API_URL` build arg and as a runtime env for server-side readers. |
| `INTERNAL_API_URL` | web server only | Compose-network URL for Next.js server routes (default `http://api:3001/api/v1`). Not a `NEXT_PUBLIC_*` variable; never sent to the browser. Must match the server routes' expected env name. |
| `CMS_BACKEND_URL` | web server only | Backend used by CMS proxy routes; defaults to the same internal API URL so server-side requests stay on the compose network. |
| `GROQ_API_KEY` / `GROQ_MODEL` | web server (temporary) + AI service | Server-only provider credentials for web routes not yet migrated behind the API/AI service. They are not exposed to the client bundle, but must be removed from `web` once those routes are migrated. Do not put JWT signing secrets on `web`. |

`NEXT_PUBLIC_API_URL` is intentionally public and non-secret: it is inlined into
the browser bundle at image build time and cannot be changed by runtime env.
Never place a credential in it or in any other `NEXT_PUBLIC_*` variable.

Server-side Next.js routes must read `INTERNAL_API_URL` (or `CMS_BACKEND_URL`)
instead of relying on a `localhost` fallback: `localhost` inside the web
container is the web process itself, so such a fallback hides misconfiguration.
Changing these compose variable names requires updating the local `docker/.env`
out of band.

## Readiness policy

- **Liveness** — `GET /api/health` returns `200` only when the API process is
  alive; it deliberately does not inspect dependencies. The container
  `HEALTHCHECK` and compose `depends_on: condition: service_healthy` on `web`
  use this route (paths include the NestJS `/api` global prefix).
- **Readiness** — `GET /api/health/ready` checks PostgreSQL and Redis and must
  return `200` when all mandatory dependencies are up and `503` when any is
  down (including timeouts). Route it through the load balancer/reverse proxy;
  do not expose its dependency detail publicly. The API slice owns returning
  the `503` status; the controller sets it when a dependency check fails and
  filters the public body to status and latency only.
- Redis is currently **mandatory**: rate limiting/queues depend on it. A stopped
  Redis must keep the API out of rotation until it recovers; a degraded-cache
  policy would need an explicit product decision. The `ai` service waits for
  Redis health because its own `/health` probe does not check Redis.
- The FastAPI service uses `GET /health` (no `/api` prefix) for liveness.
- In a test stack only, stop Redis/PostgreSQL, confirm readiness becomes `503`,
  restore them, and confirm recovery to `200`.

## Migration and seed policy

- `migrate` is a one-shot service (`restart: "no"`) that runs
  `prisma migrate deploy` and exits `0`; `api` waits for
  `service_completed_successfully` before starting. No API replica runs
  migrations at boot, and images started outside compose should be launched
  with an explicit migration step. `seed` is likewise an explicit operator job
  (for example `pnpm db:seed`), never part of replica startup.
- `up --build` rebuilds images; `docker compose run --rm migrate` re-runs the
  migration job when needed. Confirm the job succeeded before routing traffic
  to `api` on a fresh database.
- PostgreSQL and Redis use named persistent volumes (`postgres_data`,
  `redis_data`). Uploaded file storage needs a separate persistent/volume
  strategy (REL-04); it is not provided by this stack.
