# Compose operations (OPS-01)

Run from the repository root:

```bash
docker compose -f docker/docker-compose.yml config --quiet   # no secret output
docker compose -f docker/docker-compose.yml up -d --build
docker compose -f docker/docker-compose.yml ps
curl -i http://127.0.0.1:3001/api/health          # liveness: 200 while process is alive
curl -i http://127.0.0.1:3001/api/health/ready    # readiness: 200 ready, 503 dependency down
```

`docker/.env` is gitignored. Keep real values there; never commit them, and never
paste `docker compose config` output with interpolated secrets into logs or issues.

## Public vs internal API URLs

| Variable | Scope | Meaning |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | browser + web build | Browser-facing base URL (e.g. public origin + `/api/v1`). Inlined into client JS at **image build time**; changing it at runtime does nothing until the web image is rebuilt. Never use a Docker service hostname here. Compose passes it both as the required `NEXT_PUBLIC_API_URL` build arg and as a runtime env for server-side readers. |
| `INTERNAL_API_URL` | web server only | Compose-network URL for Next.js server routes (default `http://api:3001/api/v1`). Not a `NEXT_PUBLIC_*` variable; never sent to the browser. Must match the server routes' expected env name. |
| `CMS_BACKEND_URL` | web server only | Backend used by CMS proxy routes; defaults to the same internal API URL so server-side requests stay on the compose network. |
| `GROQ_API_KEY` / `GROQ_MODEL` | web server (temporary) + AI service | Server-only provider credentials for web routes not yet migrated behind the API/AI service. They are not exposed to the client bundle, but must be removed from `web` once those routes are migrated. Do not put JWT signing secrets on `web`. |

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
  the `503` status — the current controller reports `degraded` in the body
  without changing the status code, so this is an open interface requirement.
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
