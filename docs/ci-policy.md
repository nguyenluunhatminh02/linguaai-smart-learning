# CI Policy — LinguaAI

Tài liệu này định nghĩa các gate, tầng test, chính sách coverage, flaky-test, artifact và secrets cho pipeline CI của dự án. Mọi thay đổi workflow phải tuân thủ chính sách này; nếu cần ngoại lệ, ghi rõ lý do trong PR và cập nhật tài liệu.

---

## 1. Gate matrix

| Job | Trigger | Required? | Command / bước | Blocker nếu fail | Ghi chú |
|---|---|---|---|---|---|
| `checks` | PR + push `main` | **Required** | `pnpm --filter api type-check`, `pnpm --filter web type-check`, `pnpm --filter api lint`, `pnpm --filter web lint`, `pnpm --filter api test -- --runInBand`, `pnpm --filter web test:run`, `pytest -q` (ai-service) | Block merge | Unit tests, lint, type-check. Chạy trên mọi PR. |
| `integration` | PR + push `main` | **Required** (khi DB/Redis available) | `prisma migrate deploy` trên ephemeral PostgreSQL 16, `pnpm --filter api test:e2e` | Block merge nếu DB seeded; report `BLOCKED` nếu service không khả dụng | Cần service container PostgreSQL 16 + Redis 7 với healthcheck. |
| `build` | PR + push `main` | **Required** | `pnpm build` (turbo build), `docker build` cho `Dockerfile.api`, `Dockerfile.web`, `Dockerfile.ai` | Block merge | Image tag theo commit SHA, không dùng `latest`. |
| `browser-e2e` | PR (opt-in qua comment `/run-e2e`) + push `main` | **Optional** | `pnpm --filter web exec playwright test` | Non-blocking trên PR; blocking trên `main` | Dùng `apps/web/playwright.config.ts`. Retries tối đa 1 trong CI. |
| `ai-eval` | Push `main` (scheduled/manual) | **Optional** | Golden dataset eval, opt-in | Non-blocking | Không chạy trên PR không tin cậy. Cần live provider key, chỉ trên branch được bảo vệ. |

### Pinned versions

- **Node.js:** 22.14.0
- **pnpm:** 9.15.0 (frozen lockfile: `pnpm install --frozen-lockfile`)
- **Python:** 3.12.3 (cho ai-service)
- **PostgreSQL:** 16 (service container)
- **Redis:** 7 (service container)

---

## 2. Test layer definitions

Mỗi tầng test tương ứng với một nhóm TEST trong roadmap (section 10.2).

### 2.1. Unit tests

- **Phạm vi:** Pure functions, service logic không cần DB/Redis, algorithm (FSRS, SM-2), pricing, score normalization, daily grant policy.
- **Mapping:** TEST-01
- **Command:**
  - API: `pnpm --filter api test -- --runInBand`
  - Web: `pnpm --filter web test:run`
  - AI service: `pytest -q` trong `apps/ai-service`
- **Điều kiện pass:** Deterministic, không phụ thuộc external service, edge case đủ.
- **Thời gian mục tiêu:** < 5 phút.

### 2.2. Integration tests (disposable DB/Redis)

- **Phạm vi:** Token debit/refund/replay, SRS concurrent review, learning attempts, Redis outage simulation, distributed limiter.
- **Mapping:** TEST-02, TEST-03, TEST-04, TEST-05
- **Command:** `pnpm --filter api test:e2e` (Jest + Supertest + PostgreSQL thật)
- **Điều kiện pass:**
  - Ledger invariant: balance không âm, không duplicate charge.
  - SRS: không duplicate event khi concurrent review cùng card/operation.
  - Learning attempts: retry không tăng count, best/latest đúng.
  - Redis outage: DB correctness giữ nguyên, limiter đúng policy.
- **Fixture:** `apps/api/test/setup.ts`, `apps/api/test/fixtures/chat-billing.fixture.ts` — phải expose DB seed/reset helpers.
- **Cleanup:** Đóng connections, truncate tables sau mỗi test file.
- **Thời gian mục tiêu:** < 10 phút.

### 2.3. API E2E tests

- **Phạm vi:** Auth, ownership, admin, forbidden routes, chat SSE + billing, writing history/detail, speaking uploads.
- **Mapping:** TEST-06, TEST-07, TEST-08
- **Command:** Cùng `test:e2e` nhưng phân loại qua Jest `--testPathPattern` hoặc tag.
- **Điều kiện pass:**
  - HTTP status đúng (200, 401, 403, 404).
  - Không unauthorized side effects.
  - Chat SSE: matrix CHAT-04 pass, đọc toàn bộ event stream và đối chiếu với DB.
  - Writing/speaking: score nhất quán, access control đúng.
- **Thời gian mục tiêu:** < 10 phút.

### 2.4. Browser E2E tests (Playwright)

- **Phạm vi:** Signup/login, flashcard, chat, writing, daily plan, switch conversation, cancel audio, token refresh.
- **Mapping:** TEST-11, TEST-12
- **Command:** `pnpm --filter web exec playwright test`
- **Config:** `apps/web/playwright.config.ts`
- **Điều kiện pass:**
  - User flow và error recovery đúng.
  - Không ghi nhầm state khi switch conversation.
  - Không double billing khi cancel audio/refresh token.
- **Retries trong CI:** Tối đa **1** (không phải 2 như hiện tại). Nếu vẫn flaky, áp dụng flaky-test policy.
- **Thời gian mục tiêu:** < 15 phút.

### 2.5. Contract tests

- **Phạm vi:** NestJS ↔ FastAPI schemas/errors, version tương thích.
- **Mapping:** TEST-09
- **Command:** Chưa tự động hóa; manual review hoặc schema snapshot test.
- **Điều kiện pass:** Invalid output fail rõ, version tương thích.
- **Ghi chú:** Cần thêm contract test automation trong sprint tương lai.

### 2.6. Worker / queue tests

- **Phạm vi:** Queue retry, crash, duplicate, outbox.
- **Mapping:** TEST-10
- **Command:** `pnpm --filter api test:e2e -- --testPathPattern=queue`
- **Điều kiện pass:** Không duplicate charge/result khi retry/crash.
- **Thời gian mục tiêu:** < 5 phút.

### 2.7. Infra / smoke tests

- **Phạm vi:** Docker build, readiness, migration, restore.
- **Mapping:** TEST-14
- **Command:** `docker build` trong job `build`, smoke test sau deploy staging.
- **Điều kiện pass:**
  - Image build thành công từ clean env.
  - Migration chạy thành công.
  - Readiness API trả 200 khi dependency up, 503 khi dependency down.
- **Thời gian mục tiêu:** < 5 phút (build), < 2 phút (smoke).

### 2.8. Load tests

- **Phạm vi:** API/DB/SSE/worker riêng biệt.
- **Mapping:** TEST-15
- **Command:** Manual hoặc scheduled job, không chạy trong CI PR.
- **Điều kiện pass:** SLO theo staging baseline.
- **Ghi chú:** Chạy trên staging, không phải CI gate.

### 2.9. Live AI eval

- **Phạm vi:** Golden dataset, report schema/content/rubric quality.
- **Mapping:** TEST-13
- **Command:** Script riêng, opt-in.
- **Điều kiện pass:** Quality score đạt threshold.
- **Ghi chú:** **Không chạy trên PR không tin cậy.** Chỉ trên branch được bảo vệ (`main`) hoặc manual trigger. Cần live provider key.

---

## 3. Coverage policy

### 3.1. Nguyên tắc

- **Không chạy theo 100% line coverage.** Coverage là công cụ, không phải mục tiêu.
- **Đo baseline trước khi đặt threshold.** Chạy coverage trên toàn bộ codebase hiện tại, ghi nhận baseline, sau đó đặt threshold tăng dần.
- **Ưu tiên critical branches:** billing (token debit/refund), auth (JWT, MFA, OAuth), SRS (FSRS, SM-2, review logic).

### 3.2. Critical paths — yêu cầu coverage tối thiểu

| Module | Coverage tối thiểu (sau khi đo baseline) | Lý do |
|---|---|---|
| `apps/api/src/tokens/*` | ≥ 80% branch | Billing logic, ledger invariant |
| `apps/api/src/auth/*` | ≥ 75% branch | Security, JWT, MFA |
| `apps/api/src/srs/*` | ≥ 80% branch | Core learning algorithm |
| `apps/api/src/chat/*` | ≥ 70% branch | SSE, billing integration |
| `apps/ai-service/app/routers/*` | ≥ 70% branch | AI routing, error handling |

### 3.3. Đo coverage

- **API:** `pnpm --filter api test -- --coverage --runInBand` (Jest v8 coverage)
- **Web:** `pnpm --filter web test:run -- --coverage` (Vitest v8 coverage)
- **AI service:** `pytest --cov=app --cov-report=term-missing` (pytest-cov)
- **Artifact:** Upload coverage report (JSON, HTML) làm artifact.

### 3.4. Threshold enforcement

- **Giai đoạn 1 (hiện tại):** Đo baseline, không block merge vì coverage.
- **Giai đoạn 2 (sau 2 sprint):** Block merge nếu coverage critical path giảm quá 5% so với baseline.
- **Giai đoạn 3 (sau 4 sprint):** Block merge nếu coverage critical path dưới threshold.

### 3.5. Exemption

- Test file (`*.spec.ts`, `test_*.py`) không tính vào coverage denominator.
- Generated code (Prisma client, OpenAPI) không tính.
- Nếu cần exclude file khác, ghi rõ lý do trong PR và cập nhật coverage config.

---

## 4. Flaky-test policy

### 4.1. Định nghĩa

Flaky test là test **không deterministic**: pass/fail không ổn định trên cùng code, cùng input, cùng environment.

### 4.2. Nguyên tắc

- **Không retry vô hạn để che lỗi.** Retry chỉ để diagnose, không phải để pass.
- **Không skip test để green gate.** Skip test = hide failure.
- **Mỗi flaky test phải có issue riêng** với owner, cause, và plan fix.

### 4.3. Quy trình

1. **Phát hiện:** Test fail trên CI, pass local, hoặc pass/fail không ổn định trên CI.
2. **Label:** Gán label `flaky` trên PR/issue.
3. **Issue:** Tạo issue riêng với:
   - **Owner:** Người chịu trách nhiệm fix.
   - **Cause:** Root cause (race condition, timing, external dependency, test design).
   - **Plan:** Các bước fix, deadline.
4. **Rerun:** Cho phép **tối đa 1 rerun** trong CI để diagnose. Nếu rerun pass, test vẫn được coi là flaky, không phải fix.
5. **Quarantine:** Nếu test flaky quá 3 lần trong 7 ngày, **quarantine** (disable trong CI gate) cho đến khi fix.
6. **Remove from required gate:** Chỉ khi có documented decision trong issue, với lý do rõ ràng (ví dụ: test không còn relevant, được thay bằng test khác).

### 4.4. Browser E2E retries

- `apps/web/playwright.config.ts` hiện tại có `retries: 2` trong CI.
- **Phải giảm xuống `retries: 1`** để tuân thủ policy.
- Nếu test vẫn flaky sau 1 retry, áp dụng quy trình flaky-test.

### 4.5. Monitoring

- Ghi log flaky test rate hàng tuần.
- Nếu flaky rate > 5% tổng số test, ưu tiên fix trước feature mới.

---

## 5. Evidence / artifact policy

### 5.1. Artifact bắt buộc

Mỗi CI run phải upload các artifact sau:

| Artifact | Format | Retention | Mục đích |
|---|---|---|---|
| JUnit XML | XML | 7 ngày | Debug test fail |
| Coverage report | JSON + HTML | 7 ngày | Track coverage trend |
| Lint report | JSON (eslint) | 7 ngày | Debug lint fail |
| Build logs | Text | 7 ngày | Debug build fail |
| Docker image digest | Text (SHA256) | 30 ngày | Trace image → commit |

### 5.2. JUnit report

- **API:** Jest JUnit reporter, output `apps/api/coverage/junit.xml`
- **Web:** Vitest JUnit reporter, output `apps/web/coverage/junit.xml`
- **AI service:** `pytest --junitxml=apps/ai-service/coverage/junit.xml`
- **Browser E2E:** Playwright JUnit reporter, output `apps/web/playwright-report/junit.xml`

### 5.3. Coverage report

- **API:** `apps/api/coverage/coverage-final.json`, `apps/api/coverage/index.html`
- **Web:** `apps/web/coverage/coverage-final.json`, `apps/web/coverage/index.html`
- **AI service:** `apps/ai-service/coverage/coverage.json`

### 5.4. Image digest

- Sau khi `docker build`, ghi digest vào file `docker/image-digests.txt`:
  ```
  api: <sha256:...>
  web: <sha256:...>
  ai: <sha256:...>
  ```
- Upload file này làm artifact.

### 5.5. Migration log

- Nếu chạy `prisma migrate deploy`, ghi log vào `migration.log` và upload làm artifact.

---

## 6. Secrets policy

### 6.1. Nguyên tắc

- **Không đọc file `.env` trong CI.** Mọi env var phải set trực tiếp trong workflow.
- **Không dùng live provider key trên PR không tin cậy.** Chỉ dùng fake key.
- **Live provider key chỉ trên branch được bảo vệ** (`main`) hoặc manual trigger, với approval.

### 6.2. Fake CI values

Workflow `ci.yml` phải set các env var fake, non-secret:

```yaml
env:
  NODE_ENV: test
  APP_ENV: test
  CI: "true"
  DATABASE_URL: postgresql://ci:ci@127.0.0.1:5432/linguaai_ci
  JWT_SECRET: ci-only-jwt-secret-not-a-real-key-0123456789
  JWT_REFRESH_SECRET: ci-only-refresh-secret-not-a-real-key-0123456789
  AI_SERVICE_API_KEYS: ci-only-ai-service-key-0123456789
  GROQ_API_KEY: ci-fake-groq-key
  GROQ_MODEL: llama-3.3-70b-versatile
  AI_SERVICE_URL: http://127.0.0.1:8000
  FRONTEND_URL: http://127.0.0.1:3000
```

### 6.3. Live provider key

- **Chỉ dùng trong job `ai-eval`** (optional, opt-in).
- **Chỉ chạy trên branch được bảo vệ** (`main`) hoặc manual trigger.
- **Không chạy trên PR từ fork.**
- Key lưu trong GitHub Secrets, không hardcode trong workflow.

### 6.4. Secrets scan

- Dùng `gitleaks` hoặc `trufflehog` scan commit trước merge.
- Nếu phát hiện secret, block merge và rotate secret ngay.

### 6.5. Staging / production secrets

- Tách biệt staging và production secrets.
- Dùng GitHub Environments với required reviewers cho production deploy.
- Không share JWT signing secret giữa staging và production.

---

## 7. Workflow structure

### 7.1. Current state

Workflow `.github/workflows/ci.yml` hiện tại chỉ có job `checks` (lint, type-check, unit tests). Chưa có integration, build, browser-e2e.

### 7.2. Required additions

Theo plan, cần thêm 3 job:

1. **`integration`:** PostgreSQL 16 + Redis 7 service container, `prisma migrate deploy`, `pnpm --filter api test:e2e`.
2. **`build`:** `pnpm build` + `docker build` cho 3 Dockerfile, image tag theo commit SHA.
3. **`browser-e2e`:** Optional, PR-comment gated, dùng Playwright với retries ≤ 1.

### 7.3. Trigger

- **`pull_request`:** Chạy `checks`, `integration` (nếu DB available), `build`. `browser-e2e` chỉ khi có comment `/run-e2e`.
- **`push` to `main`:** Chạy tất cả, bao gồm `browser-e2e` (blocking) và `ai-eval` (optional, scheduled).

### 7.4. Concurrency

```yaml
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

Cancel CI run cũ khi có commit mới trên cùng PR/branch.

---

## 8. Compliance checklist

Mọi thay đổi workflow phải check:

- [ ] Không đọc `.env` file trong CI.
- [ ] Không hardcode live provider key.
- [ ] Image tag theo commit SHA, không dùng `latest`.
- [ ] Upload JUnit + coverage artifact.
- [ ] Browser E2E retries ≤ 1.
- [ ] Flaky test có issue riêng với owner/cause/plan.
- [ ] Integration job report `BLOCKED` nếu DB/Redis không available, không green.
- [ ] Live AI eval chỉ trên branch được bảo vệ, opt-in.
- [ ] Secrets scan trước merge.

---

## 9. Revision history

| Date | Change | Author |
|---|---|---|
| 2026-11-28 | Initial version, grounded in roadmap 10.1-10.4, OPS-02 | CI policy slice (test-20) |

---

**Ghi chú:** Tài liệu này là policy, không phải implementation. Implementation chi tiết trong `.github/workflows/ci.yml` và các file config liên quan. Nếu có conflict giữa policy và implementation, policy thắng và cần update implementation.
