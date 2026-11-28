#!/usr/bin/env bash
# Verify that the real root .dockerignore keeps secrets/artifacts out of the
# build context without dropping sources the Dockerfiles need. Fixture files
# are used instead of real .env files, so no secret is ever read or copied.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
work=$(mktemp -d)
image="dockerignore-context-test:$RANDOM"
trap 'docker image rm "$image" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

# Docker reads .dockerignore from the root of the build context, so it must
# live inside the context directory alongside the fixtures.
mkdir -p "$work/context"
context="$work/context"
cp "$root/.dockerignore" "$context/.dockerignore"

make_file() {
  mkdir -p "$(dirname "$context/$1")"
  printf 'fixture %s\n' "$1" > "$context/$1"
}

# Paths that must NOT reach the build context.
make_file apps/api/node_modules/pkg/index.js
make_file apps/web/node_modules/pkg/index.js
make_file packages/shared/node_modules/pkg/index.js
make_file apps/api/dist/main.js
make_file apps/web/.next/BUILD_ID
make_file apps/api/build/old.js
make_file .turbo/cache.json
make_file apps/api/.pytest_cache/state
make_file apps/ai-service/app/__pycache__/main.cpython-312.pyc
make_file apps/ai-service/app/main.pyc
make_file apps/ai-service/.venv/bin/python
make_file apps/api/coverage/lcov.info
make_file apps/api/tsconfig.tsbuildinfo
make_file packages/shared/tsconfig.tsbuildinfo
make_file .git/config
make_file docs/notes.txt
make_file baocao/report.txt
make_file plans/plan.txt
make_file tts/cache.bin
make_file test-screenshots/shot.png
make_file tests-manual/cases.txt
make_file .claude/settings.json
make_file .vscode/settings.json
make_file .playwright-mcp/state.json
make_file apps/api/uploads/user.png
make_file apps/web/public/uploads/audio/user.mp3
make_file apps/api/src/generated/generated.ts
make_file packages/shared/src/generated/generated.ts
make_file apps/ai-service/logs/app.log
make_file apps/ai-service/test.html
make_file apps/web/playwright-report/index.html
make_file apps/web/test-results/result.json
make_file apps/api/server.log
make_file apps/api/nul
make_file apps/api/clear-devices.js
make_file apps/web/public/test-lesson.png
make_file apps/web/test-vocab.js
make_file apps/api/test_mfa.js
make_file secrets/server.pem
make_file secrets/private.key
make_file secrets/identity.p12
make_file secrets/identity.pfx

# Synthetic secret fixtures (plain placeholder text, never real values).
make_file .env
make_file .env.local
make_file apps/api/.env
make_file apps/web/.env.local
make_file apps/ai-service/.env.production

# Paths that MUST remain in the build context. Note: .dockerignore is already
# copied above; recreating it here would overwrite the real ignore rules.
make_file .npmrc
make_file package.json
make_file pnpm-lock.yaml
make_file pnpm-workspace.yaml
make_file turbo.json
make_file .env.example
make_file apps/api/.env.example
make_file apps/web/.env.example
make_file apps/ai-service/.env.example
make_file apps/api/prisma/schema.prisma
make_file apps/api/prisma.config.ts
make_file apps/api/src/main.ts
make_file apps/api/package.json
make_file apps/web/src/app/page.tsx
make_file apps/web/package.json
make_file apps/web/public/communication-audio/directions.mp3
make_file packages/shared/package.json
make_file packages/shared/src/index.ts
make_file apps/ai-service/requirements.txt
make_file apps/ai-service/app/main.py
make_file docker/Dockerfile.api

cat > "$work/Dockerfile" <<'EOF'
FROM busybox:1.36
COPY . /ctx
EOF

if ! docker build --no-cache -q -t "$image" -f "$work/Dockerfile" "$context" >"$work/build.log" 2>&1; then
  cat "$work/build.log" >&2
  echo "FAIL: fixture context build failed" >&2
  exit 1
fi

status=0
check_absent() {
  if docker run --rm --entrypoint sh "$image" -c "test -e '/ctx/$1'"; then
    echo "FAIL: '$1' should be excluded from the build context" >&2
    status=1
  else
    echo "ok (excluded): $1"
  fi
}
check_present() {
  if docker run --rm --entrypoint sh "$image" -c "test -f '/ctx/$1'"; then
    echo "ok (present): $1"
  else
    echo "FAIL: '$1' should be present in the build context" >&2
    status=1
  fi
}

while IFS= read -r path; do
  [ -n "$path" ] && check_absent "$path"
done <<'ABSENT'
apps/api/node_modules/pkg/index.js
apps/web/node_modules/pkg/index.js
packages/shared/node_modules/pkg/index.js
apps/api/dist/main.js
apps/web/.next/BUILD_ID
apps/api/build/old.js
.turbo/cache.json
apps/api/.pytest_cache/state
apps/ai-service/app/__pycache__/main.cpython-312.pyc
apps/ai-service/app/main.pyc
apps/ai-service/.venv/bin/python
apps/api/coverage/lcov.info
apps/api/tsconfig.tsbuildinfo
packages/shared/tsconfig.tsbuildinfo
.git/config
docs/notes.txt
baocao/report.txt
plans/plan.txt
tts/cache.bin
test-screenshots/shot.png
tests-manual/cases.txt
.claude/settings.json
.vscode/settings.json
.playwright-mcp/state.json
apps/api/uploads/user.png
apps/web/public/uploads/audio/user.mp3
apps/api/src/generated/generated.ts
packages/shared/src/generated/generated.ts
apps/ai-service/logs/app.log
apps/ai-service/test.html
apps/web/playwright-report/index.html
apps/web/test-results/result.json
apps/api/server.log
apps/api/nul
apps/api/clear-devices.js
apps/web/public/test-lesson.png
apps/web/test-vocab.js
apps/api/test_mfa.js
secrets/server.pem
secrets/private.key
secrets/identity.p12
secrets/identity.pfx
.env
.env.local
apps/api/.env
apps/web/.env.local
apps/ai-service/.env.production
ABSENT

while IFS= read -r path; do
  [ -n "$path" ] && check_present "$path"
done <<'PRESENT'
.dockerignore
.npmrc
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
turbo.json
.env.example
apps/api/.env.example
apps/web/.env.example
apps/ai-service/.env.example
apps/api/prisma/schema.prisma
apps/api/prisma.config.ts
apps/api/src/main.ts
apps/api/package.json
apps/web/src/app/page.tsx
apps/web/package.json
apps/web/public/communication-audio/directions.mp3
packages/shared/package.json
packages/shared/src/index.ts
apps/ai-service/requirements.txt
apps/ai-service/app/main.py
docker/Dockerfile.api
PRESENT

docker image rm "$image" >/dev/null 2>&1 || true

if [ "$status" -ne 0 ]; then
  echo "FAIL: .dockerignore context assertions failed" >&2
  exit 1
fi
echo "PASS: .dockerignore excludes secrets/artifacts and keeps required sources"
