# Manual Tests — Writing & Speaking

Bộ test thủ công cho 2 module AI quan trọng nhất.

## File trong folder

| File | Mục đích |
|---|---|
| `BUGS_FOUND.md` | Báo cáo 15 bug (S1–S9, W1–W6): 6 critical/high, 9 medium/low; 13 đã fix (xem bảng trạng thái cuối báo cáo) |
| `test-writing.mjs` | Test 5 sample texts qua HTTP /writing/assess + history + error-analysis |
| `test-writing-stable.mjs` | Smoke test ổn định cho /writing/assess |
| `test-speaking-ws.mjs` | Test full WebSocket pipeline /speaking-ws với 1 audio file |
| `test-all.bat` | Harness một cú chạy: start services, register user, chạy test-writing.mjs |
| `login_test.bat`, `login_test.mjs`, `login.json` | Đăng nhập/lưu credentials test (chứa email + password — không commit secrets thật) |
| `check-prisma.mjs`, `check-deps.mjs`, `check-deps2.mjs`, `check-speaking-routes.mjs`, `check-ws-deps.mjs`, `check-api-log.bat`, `quick-debug.mjs` | Script kiểm tra môi trường, dependency, route và log |
| `cascade-test.mjs`, `ws-test.js` | Test cascade delete và WebSocket cơ bản |
| `sample.wav` | Audio mẫu cho speaking tests |
| `README.md` | File này |

`test-all.bat` đăng ký user với field `username`/`displayName` (không còn hợp lệ) và bỏ qua lỗi register; nếu harness báo "registered" nhưng `register.json` chứa lỗi 400, hãy đăng ký thủ công bằng lệnh dưới đây trước khi chạy lại.

## Setup (1 lần)

```bat
REM 1. Đảm bảo Postgres + Redis đang chạy
docker compose -f docker\docker-compose.yml up -d postgres redis

REM 2. Migrate DB nếu chưa
pnpm db:migrate

REM 3. Cài ws nếu chưa có (cho test-speaking)
pnpm add -w -D ws
```

Tạo user test (nếu chưa có). `RegisterDto` yêu cầu `firstName` và mật khẩu có chữ hoa, chữ thường, số và ký tự đặc biệt:
```bat
curl -X POST http://localhost:3001/api/auth/register ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"admin@example.com\",\"password\":\"Admin123!\",\"firstName\":\"Admin\",\"lastName\":\"Test\"}"
```
Nếu response là `409`/"already exists" thì dùng user đó; nếu là `400` thì sửa payload theo ví dụ trên. Các script `.mjs` mặc định đăng nhập `admin@example.com` / `Admin123!`, nên phải tạo đúng user này (hoặc set `TEST_EMAIL`/`TEST_PASSWORD`).

## Test Writing

```bat
REM Mở 2 terminal
REM T1:
pnpm dev:api

REM T2:
pnpm dev:ai
```

Sau khi cả 2 service ready, mở terminal thứ 3:

```bat
node tests-manual\test-writing.mjs
```

Hoặc với credentials khác:

```bat
set TEST_EMAIL=user@test.com
set TEST_PASSWORD=MyPass123!
node tests-manual\test-writing.mjs
```

**Output mong đợi**:
- `PERFECT B2` → score >= 70
- `INTENTIONAL ERRORS` → errors.length >= 3, score < 60
- `A1 SHORT` → score thấp
- `VIETNAMESE` → có errors hoặc score reasonable
- `EDGE 1 char` → có thể trả 502 (AI từ chối)
- `error-analysis` empty state → script sẽ verify bug **W1** nếu thiếu `summary`

## Test Speaking

Cần file audio mẫu. Cách nhanh nhất:

1. Mở `https://online-voice-recorder.com/`
2. Ghi 10-15s tiếng Anh: *"Hello, my name is John. I really enjoy learning languages because it helps me connect with people from different cultures..."*
3. Download MP3, đặt vào `tests-manual\sample.mp3`

Thiết lập env:
```bat
set GROQ_API_KEY=gsk_xxx_your_key_here
```

Chạy:
```bat
REM Bạn cần API server đang chạy với JWT_SECRET + GROQ_API_KEY trong .env
node tests-manual\test-speaking-ws.mjs tests-manual\sample.mp3
```

**Output mong đợi**:
- Phase timing: open → connected → session_ready → transcript → first_chunk → feedback_done
- Transcript phải khớp gần đúng với những gì bạn nói
- 5 scores 0-100 (overall, pronunciation, fluency, grammar, vocabulary)
- Script auto-detect **S3**: nếu mọi score = 70 thì đó là regression (đã fix: trả `null`)

## Regression checks cho các bug đã FIXED

Các bug dưới đây đã được sửa theo bảng trạng thái trong `BUGS_FOUND.md` (13/15). Chạy để xác nhận hành vi đúng; nếu thấy lại hành vi cũ, đó là regression.

| Bug | Kết quả mong đợi |
|---|---|
| **S1** (WS prod no token) | Set `NODE_ENV=production` → restart API → mở `/speaking` với token hợp lệ: WS connection thành công; không có log `WS rejected — missing token in production` |
| **S2** (English hardcoded) | Trang `/speaking` có dropdown chọn ngôn ngữ đích; WS frame `start_session` gửi `targetLanguage` theo lựa chọn, không phải luôn `language: 'english'` |
| **S3** (parseScores fallback) | Chạy `test-speaking-ws.mjs` 5–10 lần: điểm parse thất bại là `null`, UI hiện banner "retry/thử lại"; không có trường hợp 5 scores cùng = 70 do fallback |
| **S4** (Base64 freeze) | DevTools Performance khi ghi 60s và Stop: không có main-thread task chặn >100ms do chuyển đổi Base64 (dùng `FileReader.readAsDataURL`) |
| **W1** (error-analysis UI broken) | User mới chưa có submission → `/writing` → tab Errors: hiển thị empty state; `summary`, `priority_focus`, `level` đều defined |

## Troubleshooting

**`ECONNREFUSED 127.0.0.1:3001`**: API server chưa chạy. `pnpm dev:api` trước.

**`Login failed (401)`**: User chưa tồn tại. Register trước (xem Setup).

**`AI service unavailable`**: AI service chưa chạy hoặc Groq API key sai. Check `_ai.log`.

**Speaking WS đóng ngay với 1008**:
- Token sai → check JWT_SECRET match giữa API và token vừa login
- Origin mismatch → set `CORS_ORIGINS=http://localhost:3000` trong API .env
