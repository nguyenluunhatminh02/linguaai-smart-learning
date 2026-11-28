# TEST-15 — Kế hoạch load test (PLAN ONLY)

**Trạng thái: PLAN ONLY — CHƯA CHẠY.** Tài liệu này chỉ định nghĩa workload, SLO đề xuất và mẫu báo cáo. Không có kết quả đo nào được ghi nhận ở đây; mọi ô kết quả là `<NOT RUN>` hoặc `<TBD after baseline>`. Không đọc/copy `.env`; tài liệu chỉ dùng **tên biến môi trường**, không ghi giá trị thật, khóa API hay connection string.

| Trường | Giá trị |
|---|---|
| Nguồn roadmap | `LinguaAI_Engineering_Roadmap.md`: TEST-15 dòng 834; OPS-03 dòng 915–935; PERF-01 dòng 937–955; PERF-02 dòng 957–964 |
| Quy ước báo cáo | `docs/baseline.md`: lệnh chưa chạy là `NOT RUN`, không bao giờ là green; phân biệt RUN/PASS, EQUIVALENT CHECK, NOT RUN |
| Commit lúc lập kế hoạch | `3be6aa39ad65fc7cfef22d75c84e40c5927b0389` (`main`), working tree không sạch |
| Commit lúc chạy (placeholder) | `<HEAD_AT_RUN>` — phải ghi SHA thật, branch và danh sách file dirty tại thời điểm đo |
| Ngày lập kế hoạch | `2026-11-28` |
| Ngày chạy (placeholder) | `<DATE_AT_RUN>` |
| Môi trường chạy | `<STAGING_OR_LOCAL_TEST_STACK>` — chỉ stack test/staging tự quản |
| Tool chạy tải | `<TOOL_AND_VERSION_AT_RUN>` — repo hiện chưa có k6/artillery/locust/autocannon được cài đặt; tool phải được chọn và ghi rõ trước khi chạy |
| Kết quả thực thi | Tất cả bước trong tài liệu này: `<NOT RUN>` |

PERF-01 (dòng 939) nêu rõ: các mục tiêu dưới đây là **SLO đề xuất cho staging, cần điều chỉnh sau baseline; không phải khả năng hệ thống đã được chứng minh**. Vì vậy tài liệu này không tuyên bố pass/fail và không chèn số đo giả định.

## 1. Phạm vi, tiền đề và ranh giới

- Chỉ chạy trên môi trường test/staging do mình quản lý. **Không gửi tải tới provider LLM ngoài** khi chưa có phép; kịch bản live-provider là opt-in, số request nhỏ, có quota và phải ghi rõ người cấp phép trong evidence.
- Dùng fake provider cho các kịch bản API/DB, SSE và worker. Mọi payload là dữ liệu tổng hợp có seed cố định; không dùng production dump, user ID thật hay khóa thật.
- Prefix/version có thật: `app.setGlobalPrefix('api')` tại `apps/api/src/main.ts:504` và `VersioningType.URI`, `defaultVersion: '1'` tại dòng 518 → đường dẫn dạng `/api/v1/...`.
- `ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true })` tại `apps/api/src/main.ts:541–547` → payload phải khớp DTO; field thừa bị từ chối. Không được "đỡ" bằng bỏ validation.
- Compose dùng PostgreSQL migrate one-shot; API cần `AI_SERVICE_API_KEYS` đọc từ env. Tên biến được phép nhắc trong evidence; **giá trị thì không**.
- Hiện trạng repo theo PERF-02 dòng 961: `main.ts` dùng `WsAdapter` từ `@nestjs/platform-ws`, không phải Socket.IO. Không giả định Redis adapter Socket.IO cho raw WebSocket; nếu test cross-instance, thiết kế riêng cho giao thức hiện tại.
- Kết quả, raw output và báo cáo đi vào `docs/benchmarks/` (thư mục đã tồn tại). File này là kế hoạch, không phải báo cáo kết quả.

## 2. SLO placeholder — đề xuất, chưa đo

| Luồng | Metric | Ngưỡng đề xuất từ PERF-01 | Status | Ngưỡng cuối |
|---|---|---|---|---|
| Read API thường (mock/no LLM) | HTTP p95 theo route template | p95 < 300 ms ở workload mục tiêu | `PROPOSED / NOT MEASURED` | `<TBD after baseline>` |
| SRS review / token transaction | HTTP p95 + invariant | p95 < 500 ms, 0 invariant violation | `PROPOSED / NOT MEASURED` | `<TBD after baseline>` |
| Chat SSE fake provider | Event loss / duplicate settlement | Không mất event, không duplicate settlement; TTFT đo riêng, không trộn vào p95 delta | `PROPOSED / NOT MEASURED` | `<TBD after baseline>` |
| Chat live provider | p95 TTFT, p95 total latency | Đo theo model/network; **không áp số cứng khi chưa đo** | `PROPOSED / NOT MEASURED` | `<TBD after baseline>` |
| API server errors | Tỷ lệ 5xx tại tải mục tiêu | < 1%, loại 4xx cố ý; 429 báo riêng, không gộp vào "success" | `PROPOSED / NOT MEASURED` | `<TBD after baseline>` |
| Resource headroom | DB pool wait, queue depth, RSS, event-loop lag | Không memory growth vô hạn; pool/queue còn headroom; lag không tăng vô hạn theo thời gian | `PROPOSED / NOT MEASURED` | `<TBD after baseline>` |

Cách đọc: `PROPOSED / NOT MEASURED` là trạng thái của ngưỡng, không phải đánh giá hệ thống. Chỉ sau khi có baseline có evidence, owner mới quyết định **điều chỉnh SLO** hay **tối ưu hệ thống** (xem mục 7). Không suy luận p95 từ một lần chạy hay từ trung bình.

## 3. Định nghĩa metric (ánh xạ OPS-03)

| Metric / tín hiệu | Nguồn đề xuất | Label được phép | Dùng cho |
|---|---|---|---|
| `http_request_duration_seconds` | Instrumentation HTTP theo route template | `route` (template), `method`, `status` | p50/p95/p99 từng endpoint; **không dùng raw URL** |
| `ai_requests_total` | API/AI service | `feature`, `model`, `outcome` | success/error rate |
| `ai_time_to_first_token_seconds` | SSE/fake provider | `feature`, `model` | TTFT, đo riêng cho SSE |
| `ai_provider_duration_seconds` | Provider adapter | `provider`, `model`, `outcome` | provider latency |
| `ai_provider_tokens_total` | Provider adapter | `model`, `direction` | usage/cost |
| `ai_operations_inflight` | AI operations | `feature`, `state` | backlog |
| `queue_job_duration_seconds` | Worker/queue | `queue`, `outcome` | worker health, queue depth |
| `token_reconciliation_mismatches_total` | Reconciliation job | `none` hoặc `type` | invariant violation; bất kỳ giá trị > 0 là dừng |
| `db_pool_wait_seconds` | Prisma/DB pool | `pool` | saturation |
| `sse_disconnects_total` | SSE transport | `reason` | streaming reliability |
| CPU/RAM/RSS, GC, event-loop lag | Runtime/container metrics | chỉ dimension máy/instance đã được phê duyệt | resource headroom |

**Cảnh báo cardinality:** không dùng user ID, request ID hay raw URL làm label metric (OPS-03 dòng 933). Correlation ID (`X-Request-ID` tại `main.ts:524–540`) chỉ dùng trong log/trace có policy, không làm label.

## 4. Workload steps

Quy ước chung cho mọi bước: ghi rõ VU, thời lượng, think-time, endpoint mix, dữ liệu đầu vào, metric thu, tiêu chí dừng và kết quả. Mọi tiêu chí dừng bao gồm **stop-on-invariant-violation**: nếu checklist mục 5 có item fail, dừng bước đó, giữ raw output, không "chạy lại cho đẹp". Mỗi bước có ô kết quả trống `<NOT RUN>`; không điền số khi chưa có evidence.

Route trong bảng là đường dẫn đầy đủ sau prefix `/api/v1`. Xác nhận lại bằng Swagger/controller tại thời điểm chạy vì code có thể thay đổi sau khi lập kế hoạch.

| Bước | VU | Thời lượng | Think-time | Endpoint mix | Dữ liệu đầu vào | Metric thu | Tiêu chí dừng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| 0. Preflight | 1 | `<TBD>` (đến khi readiness 200) | Không áp dụng | `GET /api/v1/health/ready` (kiểm tra DB + Redis, 503 nếu dependency down), `GET /api/v1/health` | Stack test đã migrate/seed xong; fake provider sẵn sàng; dataset có user/token/card/deck hợp lệ | HTTP status readiness, latency DB/Redis, row counts, HEAD/dirty-tree, version tool | Dừng nếu readiness ≠ 200, migrate/seed chưa xong, hoặc fake provider không kiểm soát được | `<NOT RUN>` |
| 1. Smoke | 1–2 | `<TBD>` (ngắn, đủ 1 lượt mỗi route) | `<TBD>` | `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh-token`, `GET /api/v1/users/me`, `GET /api/v1/srs/due-cards?deckId=<uuid>&limit=20`, `POST /api/v1/srs/review` (`cardId`, `grade` 1–4, `operationId` UUID tùy chọn), `GET /api/v1/tokens/balance`, `GET /api/v1/tokens/history`, `POST /api/v1/tokens/consume` (header `idempotency-key`), `POST /api/v1/chat/stream` (header `idempotency-key`), `GET /api/v1/chat/operations/:operationId` | User fixture, deck/card fixture, key idempotency duy nhất mỗi VU, token đủ; SSE đọc đến terminal event | Status code, latency, SSE event sequence, invariant mục 5 | Dừng nếu route trả lỗi ngoài dự kiến, SSE thiếu terminal event, hoặc invariant fail | `<NOT RUN>` |
| 2. Warm-up | Theo bước tiếp theo (bắt đầu 10) | 5 phút | `<TBD>` | Giống bước 3, mix read-heavy | Cùng dataset bước 1; không đổi cấu hình giữa warm-up và đo | p50/p95/p99, error breakdown, resource baseline | Dừng nếu invariant fail hoặc resource tăng bất thường không giải thích được | `<NOT RUN>` |
| 3. Steady-state bước 10 VU | 10 | 10 phút | `<TBD>` | Xem endpoint mix bước 3 bên dưới | Cùng dataset; mỗi VU có phiên đăng nhập/token riêng | Mục 3 + throughput | Stop-on-invariant-violation; dừng nếu 5xx ≥ 1% hoặc pool/queue mất headroom | `<NOT RUN>` |
| 3. Steady-state bước 25 VU | 25 | 10 phút | `<TBD>` | Giữ nguyên mix bước 3 | Giữ nguyên dataset và cấu hình; chỉ đổi VU | Mục 3 + throughput | Như trên | `<NOT RUN>` |
| 3. Steady-state bước 50 VU | 50 | 10 phút | `<TBD>` | Giữ nguyên mix bước 3 | Giữ nguyên dataset và cấu hình; chỉ đổi VU | Mục 3 + throughput | Như trên | `<NOT RUN>` |
| 3. Steady-state bước 100 VU | 100 | 10 phút | `<TBD>` | Giữ nguyên mix bước 3 | Giữ nguyên dataset và cấu hình; chỉ đổi VU | Mục 3 + throughput | Như trên | `<NOT RUN>` |
| 4. Ramp-to-failure | Tăng dần từ mức cuối cùng ổn định: `<TBD step size>` | `<TBD>` mỗi mức, ghi mức đầu tiên breach SLO | `<TBD>` | Giữ nguyên mix bước 3 | Dataset đủ lớn để không bị "hết dữ liệu" giữa chừng | Mục 3 + điểm đầu tiên vi phạm SLO, bottleneck từ metric | Dừng ngay khi invariant fail, 5xx vượt ngưỡng, hoặc resource không hồi phục; **không** tiếp tục chỉ để có số đẹp hơn | `<NOT RUN>` |
| 5. Cooldown + đối chiếu | 0 VU, chỉ job đối chiếu | `<TBD>` | Không áp dụng | Không gửi tải; chạy reconciliation/ledger check, đọc trạng thái operation | Snapshot ledger/operation/SRS event/SSE log trước và sau | `token_reconciliation_mismatches_total`, số operation terminal, số review event/card, SSE disconnect reason | Dừng và giữ evidence nếu bất kỳ invariant mục 5 fail | `<NOT RUN>` |
| 6a. API/DB riêng | Theo kịch bản, bắt đầu 10 VU | 5 phút warm-up + 10 phút đo | `<TBD>` | Read API + SRS review + token consume; **không** gọi provider | Dataset DB tổng hợp, seed cố định | Latency route template, DB pool wait, invariant ledger/SRS | Stop-on-invariant-violation | `<NOT RUN>` |
| 6b. SSE fake provider riêng | Theo kịch bản, bắt đầu 10 VU | 5 phút warm-up + 10 phút đo | `<TBD>` | `POST /api/v1/chat/stream` + `GET /api/v1/chat/operations/:operationId`; mỗi key idempotency duy nhất, có replay có chủ đích | Fake provider có delay/counter kiểm soát; token đủ | TTFT, p95/total (đo riêng), event seq, terminal event, duplicate settlement, `sse_disconnects_total` | Dừng nếu mất event, duplicate settlement, hoặc thiếu terminal event | `<NOT RUN>` |
| 6c. Worker/queue riêng | Theo kịch bản, `<TBD>` | `<TBD>` | `<TBD>` | Enqueue job qua luồng ứng dụng được phép trong stack test; không gọi provider ngoài | Job fixture có thể retry/duplicate có kiểm soát | `queue_job_duration_seconds`, queue depth, duplicate result count, retry/outbox state | Dừng nếu duplicate result hoặc operation stuck quá deadline | `<NOT RUN>` |
| 6d. Live-provider smoke (opt-in) | 1–2 | Số request nhỏ, có quota: `<TBD>` | `<TBD>` | `POST /api/v1/chat/stream` theo model đã được cấp phép | Cần phê duyệt + quota + tên biến cấu hình (không ghi giá trị) | p95 TTFT, p95 total, outcome/error breakdown | Dừng nếu vượt quota, chi phí, hoặc không có phép; không áp số cứng SLO khi chưa đo | `<NOT RUN>` |

Endpoint mix mặc định cho bước 3 (tỷ lệ là **đề xuất cần ghi nhận tại run**, không phải kết quả):

| Nhóm | Route | Tỷ lệ đề xuất |
|---|---|---|
| Auth/setup | `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh-token` | `<TBD>` — refresh-token xoay vòng, không dùng lại token cũ ngoài ý định |
| Read | `GET /api/v1/users/me`, `GET /api/v1/srs/due-cards?deckId=<uuid>&limit=20`, `GET /api/v1/tokens/balance`, `GET /api/v1/tokens/history` | Read-heavy; deckId là UUID hợp lệ của fixture user |
| Write có invariant | `POST /api/v1/srs/review` (`cardId`, `grade` ∈ {1,2,3,4}, `operationId` UUID), `POST /api/v1/tokens/consume` (header `idempotency-key`) | Dùng operationId/idempotency-key sinh mới hoặc replay có kiểm soát; không gộp nhầm 409 replay vào 5xx |
| SSE | `POST /api/v1/chat/stream` (header `idempotency-key`), `GET /api/v1/chat/operations/:operationId` | Đọc stream đến `completed` hoặc `failed`, đối chiếu DB |

Ghi chú payload: `ReviewCardDto` yêu cầu `cardId` là UUID và `grade` 1–4, `operationId` là UUID tùy chọn (`apps/api/src/srs/dto/srs.dto.ts:4–26`). `ConsumeTokensDto` có `feature` (bắt buộc), `cost` tùy chọn bị server bỏ qua để dùng catalog, `operationKey` tùy chọn (`apps/api/src/tokens/dto/tokens.dto.ts:14–29`). `StreamChatDto` nhận `message`, `conversationId` (UUID v4 hoặc null), `language` trong danh sách cho phép, `idempotencyKey` tối đa 64 ký tự (`apps/api/src/chat/dto/chat.dto.ts:85–116`); controller cũng chấp nhận header `idempotency-key` (`chat.controller.ts:269`). Không gửi field ngoài DTO vì `forbidNonWhitelisted: true`.

## 5. Checklist invariant — sau mỗi bước, chưa tick

Đánh dấu chỉ khi có evidence từ DB/log/stream thực tế; ô trống nghĩa là chưa kiểm tra.

- [ ] Token: `balance = tổng ledger` cho mọi user fixture sau bước; `token_reconciliation_mismatches_total = 0`.
- [ ] Token: 1 `operationId` → đúng 1 debit, kể cả khi replay/trùng key; refund (nếu có) được đối chiếu riêng.
- [ ] SRS: đúng 1 review event cho mỗi cặp `(card, operationId)`; retry cùng operationId không tạo event thứ hai.
- [ ] Chat: 1 operation key → 1 provider call trên đường thường (không ambiguous failure); terminal state khớp DB.
- [ ] SSE: event `accepted` → `delta(seq)` tăng liên tục không trống → đúng 1 event terminal (`completed` hoặc `failed`); không có delta sau terminal, không mất seq.
- [ ] SSE: `[DONE]`/completed khớp trạng thái DB; terminal `SUCCEEDED` chỉ phát sau khi persistence transaction commit (`chat.controller.ts:375–387`); không second debit khi replay.
- [ ] Queue: không duplicate result; retry/outbox không tạo charge hoặc result trùng; operation không stuck quá deadline.
- [ ] 4xx cố ý và 429 được tách riêng trong error breakdown, không đếm là 5xx và không giấu dưới "success".

## 6. Template báo cáo trống (dùng chung trong `docs/benchmarks/`)

Sao chép template này vào `docs/benchmarks/<run-id>.md` khi chạy; điền Evidence path, không điền số tưởng tượng.

```markdown
# TEST-15 — <run-id> load test report

Status: <RUN / NOT RUN — chọn đúng sự thật>

## Provenance
- Roadmap: TEST-15, OPS-03, PERF-01, PERF-02
- HEAD: <HEAD_AT_RUN>
- Branch / dirty files: <TBD>
- Machine / OS / kernel: <TBD>
- CPU / RAM / disk: <TBD>
- Runtime versions (node, pnpm, Python, Docker Compose, tool load-test): <TBD>
- Target stack: <STAGING_OR_LOCAL_TEST_STACK>
- Dataset id / PRNG seed / row counts: <TBD>
- Env flags (TÊN BIẾN only, KHÔNG ghi giá trị): <TBD>
- Exact commands: <TBD>
- Raw output path: <TBD>
- Owner: <TBD>
- Date / timezone: <TBD>

## Workload actually executed
| Step | VU | Duration | Think-time | Endpoint mix | Notes |
|---|---|---|---|---|---|
| <TBD> | <TBD> | <TBD> | <TBD> | <TBD> | <TBD> |

## Results
| Flow | p50 | p95 | p99 | Throughput | Error breakdown (4xx intentional / 429 / 5xx) |
|---|---|---|---|---|---|
| <TBD> | <NOT RUN> | <NOT RUN> | <NOT RUN> | <NOT RUN> | <NOT RUN> |

| Resource | Observed headroom | Evidence |
|---|---|---|
| DB pool wait | <NOT RUN> | <TBD> |
| Queue depth / duration | <NOT RUN> | <TBD> |
| RSS / memory growth | <NOT RUN> | <TBD> |
| GC / event-loop lag | <NOT RUN> | <TBD> |

## Invariant checklist
- [ ] balance = ledger ...
- [ ] 1 operationId → 1 debit ...
- [ ] (copy full checklist from docs/load-test-plan.md and mark only with evidence)

## Confidence and limitations
- <TBD: what was measured, what was not, deviations from plan, environment instability>

## Decision
- <TBD: adjust SLO / optimize system / rerun — kèm lý do có evidence>
```

## 7. Tiêu chí ra quyết định sau baseline

1. Nếu baseline đo được và thấp hơn ngưỡng đề xuất: ghi rõ workload, machine, dataset, commit; **đề xuất điều chỉnh SLO** thay vì giữ số chưa thực tế.
2. Nếu invariant fail dù latency đạt: hệ thống **không đạt**, ưu tiên sửa correctness trước khi tối ưu hiệu năng.
3. Nếu bottleneck rõ từ metric: chỉ tối ưu **một biến mỗi lần** (PERF-01 dòng 954), chạy lại cùng workload và đối chiếu evidence trước/sau.
4. Nếu live-provider không được phép hoặc hết quota: ghi `NOT RUN`, không suy ra từ fake provider và không gán số cứng cho live provider.
5. Mọi báo cáo phải phân biệt RUN/PASS, EQUIVALENT CHECK và NOT RUN theo `docs/baseline.md`; không gộp nhiều lần chạy thành một con số mà không có raw output.
