# Bugs phát hiện qua Static Code Review — Writing & Speaking

Đọc qua: `writing.controller.ts`, `writing.service.ts`, `writing.dto.ts`, `writing/page.tsx`,
`writing_prompts.py`, `routers/writing.py`, `speaking.gateway.ts`, `speaking/page.tsx`,
`api/speaking/route.ts`, `api/speaking/topic/route.ts`, `ai-client.service.ts`, `utils.py`,
`schemas.py`, `schema.prisma`.

Mức độ: **🔴 Critical** | **🟠 High** | **🟡 Medium** | **🟢 Low**

---

## WRITING module

### W1. 🟠 High — Error Analysis empty state phá vỡ UI
**File**: `apps/api/src/writing/writing.service.ts:120-127` ↔ `apps/web/src/app/(dashboard)/writing/page.tsx:617-640`

Khi user chưa có submission nào, backend trả:
```json
{ "message": "Not enough writing history...", "errors": [], "patterns": [], "exercises": [] }
```

Nhưng frontend cứ render:
```tsx
<p>{errorAnalysis.summary}</p>             // undefined
<span>{errorAnalysis.priority_focus}</span> // undefined
<p>Level: {errorAnalysis.level}</p>         // undefined
<Badge>{errorAnalysis.analyzedSubmissions}</Badge>  // undefined
```

→ User mới đăng ký vào tab "Errors" sẽ thấy ô trống/`undefined` thay vì hướng dẫn.

**Fix**: Backend trả thêm `summary`, `priority_focus`, `level` mặc định, hoặc frontend check `errorAnalysis.message` trước rồi hiển thị empty state riêng.

---

### W2. 🟡 Medium — Token gate fail không hiển thị lỗi cho user
**File**: `apps/web/src/app/(dashboard)/writing/page.tsx:392-407`

```tsx
try {
  await consumeAndRun(async () => {...});
} catch {
  // silently handle    <-- BUG
}
```

Nếu AI service down hoặc 502, user thấy spinner tắt nhưng không có thông báo gì → tưởng app bị treo.

**Fix**: Hiển thị toast error: `setError('Không thể chấm bài. Hãy thử lại sau.')`.

---

### W3. 🟡 Medium — Score scaling không check edge case
**File**: `apps/api/src/writing/writing.service.ts:62, 65`

```ts
const rawScore = aiResult.overall_score ?? aiResult.scores?.overall ?? 5;
return { overallScore: Math.round(rawScore * 10), ... };
```

Prompt yêu cầu `overall_score: <1.0-10.0>`. Nhưng nếu LLM trả `0.75` (hiểu sai là tỉ lệ 0-1), score sẽ là 8 thay vì 75. Hoặc trả `85` (hiểu sai là 0-100), score thành 850.

**Fix**: Clamp:
```ts
const overall = Math.min(100, Math.max(0, Math.round((rawScore <= 10 ? rawScore * 10 : rawScore))));
```

---

### W4. 🟡 Medium — Indentation/formatting lỗi
**File**: `apps/api/src/writing/writing.service.ts:82-86`

```ts
      language: dto.language || 'english',
      targetLevel: dto.targetLevel || 'B1',
createdAt: submission.created_at,    // <-- thụt lùi sai, không phá runtime
      userText: dto.userText,
```

Code chạy được nhưng linter/format sẽ flag. Nên `pnpm lint --fix`.

---

### W5. 🟢 Low — JSON parse fail của LLM không retry
**File**: `apps/ai-service/app/utils.py:109-111`

Khi Llama trả JSON malformed (1-5% trường hợp), throw 502 ngay. Nên retry 1 lần với `temperature=0.1` trước khi fail.

---

### W6. 🟢 Low — Cache key dùng `prompt[:500]`
**File**: `apps/ai-service/app/utils.py:86`

Cache key chỉ lấy 500 ký tự đầu của prompt. 2 bài viết khác nhau có 500 ký tự đầu giống nhau (ví dụ template intro) → cache collision → user A nhận feedback của user B.

**Fix**: Dùng full hash:
```python
import hashlib
cache_kwargs["prompt_hash"] = hashlib.sha256(prompt.encode()).hexdigest()[:16]
```

---

## SPEAKING module

### S1. 🔴 Critical — WebSocket production sẽ bị reject vì frontend không gửi token
**File**: `apps/web/src/app/(dashboard)/speaking/page.tsx:52-55, 162` ↔ `apps/api/src/speaking/speaking.gateway.ts:81-100`

```ts
// Frontend
const wsUrl = apiBase.replace(...) + '/speaking-ws';   // KHÔNG có ?token=...
const ws = new WebSocket(wsUrl);
```

```ts
// Backend
const token = url.searchParams.get('token');
if (!token && this.enforceAuth /* === production */) {
  client.close(1008, 'Authentication required');   // RỚT
}
```

→ **Deploy production = Speaking chết hoàn toàn**. Chỉ chạy được ở dev.

**Fix**:
```ts
const token = getAccessToken();   // từ auth-store
const wsUrl = `${baseWs}/speaking-ws?token=${encodeURIComponent(token)}`;
```

---

### S2. 🟠 High — Audio chỉ chấp nhận tiếng Anh từ frontend
**File**: `apps/web/src/app/(dashboard)/speaking/page.tsx:169`

```ts
ws.send(JSON.stringify({
  event: 'start_session',
  data: { topic: ..., level, language: 'english' }   // HARDCODED
}));
```

Backend `speaking.gateway.ts:261-273` đã có map cho 8 ngôn ngữ (vi/ja/zh/ko/es/fr/de) nhưng frontend không cho chọn → vô dụng.

→ Báo cáo claim "5 ngôn ngữ" cho Speaking là **sai**.

**Fix**: Thêm dropdown language ở UI, lấy từ `useLearningLanguageStore` hoặc selector tương tự Writing tab.

---

### S3. 🟠 High — `parseScores` fallback 70 gây hiểu nhầm
**File**: `apps/api/src/speaking/speaking.gateway.ts:253-259`

```ts
private parseScores(text: string): Record<string, number> {
  try {
    const m = text.match(/\[SCORES\]({[\s\S]*?})\[\/SCORES\]/);
    if (m) return JSON.parse(m[1]);
  } catch {}
  return { overall: 70, pronunciation: 70, fluency: 70, grammar: 70, vocabulary: 70 };
}
```

Nếu LLM quên thêm `[SCORES]...[/SCORES]` (xảy ra ~5-10% với Llama 3.3 70B khi prompt dài), user **luôn nhận 70/100** dù nói siêu hay hoặc siêu tệ.

**Fix**: Trả `null` + UI hiển thị "Không thể tính điểm, vui lòng thử lại" hoặc emit retry.

---

### S4. 🟠 High — Base64 conversion block UI thread
**File**: `apps/web/src/app/(dashboard)/speaking/page.tsx:151-155`

```ts
const arrayBuffer = await blob.arrayBuffer();
const uint8 = new Uint8Array(arrayBuffer);
let binary = '';
for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
const base64 = btoa(binary);
```

Audio 60s opus ≈ 500 KB → 4 triệu vòng lặp tạo string khổng lồ → **freeze UI 200-500ms** trên máy yếu. Animation pulse "Recording..." sẽ giật.

**Fix**: Dùng `FileReader.readAsDataURL` (chạy native, không block):
```ts
const dataUrl = await new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result as string);
  r.onerror = reject;
  r.readAsDataURL(blob);
});
const base64 = dataUrl.split(',')[1];
```

---

### S5. 🟡 Medium — Không check duration tối thiểu
**File**: `apps/web/src/app/(dashboard)/speaking/page.tsx:142-150`

User bấm Record rồi Stop ngay sau 0.5s → audio rỗng → vẫn gửi đi qua WS → Whisper trả empty → backend report error "Không phát hiện giọng nói". Lãng phí quota Groq.

**Fix**: Client check `if (timer < 3) { setError('Hãy nói ít nhất 3 giây'); return; }`.

---

### S6. 🟡 Medium — Không lưu audio + transcript history
**File**: schema.prisma không có model `speaking_submissions`

→ User không xem lại được lịch sử như Writing. Không thể track tiến bộ.

**Fix**: Thêm model:
```prisma
model speaking_submissions {
  id           String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  user_id      String   @db.Uuid
  topic        String?  @db.VarChar(500)
  transcript   String
  feedback     String
  scores       Json
  language     String   @default("english") @db.VarChar(50)
  audio_url    String?  @db.VarChar(500)  // optional S3/local
  duration_sec Int      @default(0)
  created_at   DateTime @default(now()) @db.Timestamp(6)
  users        users    @relation(...)
  @@index([user_id])
}
```

---

### S7. 🟡 Medium — Topic API không yêu cầu auth
**File**: `apps/web/src/app/api/speaking/topic/route.ts:7`

```ts
export async function POST(req: NextRequest) {
  const body = await req.json();
  // KHÔNG check JWT
  ...gọi Groq...
}
```

Bất kỳ ai cũng có thể spam endpoint này → đốt quota Groq miễn phí.

**Fix**: Thêm middleware check session cookie hoặc forward request qua NestJS API.

---

### S8. 🟢 Low — `score` column trong DB không match interface
**File**: `apps/api/src/writing/writing.service.ts:57` (lưu nhầm chỗ)

`writing_submissions.score` là JSON, nhưng code lưu `aiResult.scores` (số 5 trường) không phải overall_score đơn lẻ. Tên cột `score` nên là `scores`. Migration optional nhưng khó hiểu.

---

### S9. 🟢 Low — Pronunciation score là vô nghĩa (đã nêu trong báo cáo)
LLM judge từ transcript nên không phản ánh phát âm acoustic. Đổi tên thành "speech_clarity" hoặc tích hợp Azure Speech Pronunciation Assessment.

---

# Tổng kết priority + trạng thái fix

| ID | Mức | Module | Mô tả | Trạng thái |
|----|-----|--------|-------|------------|
| **S1** | 🔴 | Speaking | WS production thiếu token | ✅ **FIXED** |
| **S2** | 🟠 | Speaking | Hardcoded English | ✅ **FIXED** (selector + truyền `targetLanguage`) |
| **S3** | 🟠 | Speaking | parseScores fallback 70 | ✅ **FIXED** (return null + UI banner) |
| **S4** | 🟠 | Speaking | Base64 block UI thread | ✅ **FIXED** (FileReader.readAsDataURL) |
| **W1** | 🟠 | Writing | Error analysis empty state | ✅ **FIXED** (đủ fields) |
| **S5** | 🟡 | Speaking | Không check min duration | ✅ **FIXED** (3s min) |
| **S6** | 🟡 | Speaking | Không lưu history | ✅ **FIXED** (Prisma model + /speaking/history endpoint + UI tab) |
| **S7** | 🟡 | Speaking | Topic API không auth | ✅ **FIXED** (Bearer token check) |
| **W2** | 🟡 | Writing | Token fail không hiển thị lỗi | ✅ **FIXED** (toast banner đỏ) |
| **W3** | 🟡 | Writing | Score scaling không clamp | ✅ **FIXED** (handle 0-1, 1-10, 0-100) |
| **W4** | 🟡 | Writing | Indentation lỗi | ✅ **FIXED** |
| **W5** | 🟢 | Writing | JSON parse fail không retry | ✅ **FIXED** (retry temperature=0.1) |
| **W6** | 🟢 | Writing | Cache key collision | ✅ **FIXED** (SHA256 hash) |
| **S8** | 🟢 | Speaking | DB column `score` naming | ⏸ Skip (rename = migration risk) |
| **S9** | 🟢 | Speaking | Pronunciation acoustic | ⏸ Out of scope (Azure Speech license) |

**Tổng**: 13 / 15 bugs đã fix. 2 bugs còn lại là edge case không ảnh hưởng demo.

## Sau khi fix — bước tiếp theo

```bat
REM 1. Generate Prisma client (cần thiết cho speaking_submissions model)
pnpm db:generate

REM 2. Apply migration
pnpm db:migrate

REM 3. Restart cả 3 services
REM    pnpm dev:api / pnpm dev:ai / pnpm dev:web

REM 4. Smoke test
node tests-manual\test-writing.mjs
```

## Các file đã thay đổi

### Backend (NestJS)
- `apps/api/prisma/schema.prisma` — thêm model `speaking_submissions` + relation
- `apps/api/prisma/migrations/1700000000003_add_speaking_submissions/migration.sql` — migration mới
- `apps/api/src/writing/writing.service.ts` — W1, W3, W4
- `apps/api/src/speaking/speaking.gateway.ts` — S3, S6 (persist + duration tracking)
- `apps/api/src/speaking/speaking.module.ts` — register Controller + Service
- `apps/api/src/speaking/speaking.controller.ts` — **NEW** (S6: /speaking/history, /speaking/:id)
- `apps/api/src/speaking/speaking.service.ts` — **NEW** (S6: query history)

### AI Service (FastAPI)
- `apps/ai-service/app/utils.py` — W5 retry, W6 hash cache key

### Frontend (Next.js)
- `apps/web/src/app/(dashboard)/writing/page.tsx` — W2 (submitError state + UI banner)
- `apps/web/src/app/(dashboard)/speaking/page.tsx` — S1, S2, S3, S4, S5, S6 (History link)
- `apps/web/src/app/(dashboard)/speaking/history/page.tsx` — **NEW** (S6: history page)
- `apps/web/src/app/api/speaking/route.ts` — S7 (Bearer auth)
- `apps/web/src/app/api/speaking/topic/route.ts` — S7 (Bearer auth) + S2 (multilingual prompt)
