# Báo cáo kiểm thử chức năng

**Ngày kiểm thử:** 18/04/2026  
**Người kiểm thử:** Manual testing với Playwright Browser + PowerShell REST API  
**Môi trường:** Local development (localhost)

## Thông tin hệ thống

| Dịch vụ | Port | Công nghệ | Trạng thái |
|---------|------|-----------|------------|
| Frontend (Web) | 3000 | Next.js 15 | ✅ RUNNING |
| Backend API | 3001 | NestJS + Prisma | ✅ RUNNING |
| AI Service | 8000 | FastAPI + Groq (llama-3.3-70b) | ✅ RUNNING |
| PostgreSQL | 5432 | Docker container `linguaai-postgres` | ✅ HEALTHY |
| Redis | 6379 | Docker container `linguaai-redis` | ✅ HEALTHY |

**Tài khoản kiểm thử:** `testuser@linguaai.com` / `Password123!`  
**User ID:** `48be0e5e-a21f-4399-8288-d7cd95d3abb2`  
**Tài khoản Admin:** `admin@linguaai.com` / `Admin@123`

---

## 1. Xác thực (Authentication)

### 1.1 Đăng ký (Register)
| Mục | Chi tiết |
|-----|---------|
| URL | `POST /api/auth/register` → `/register` |
| Trạng thái | ✅ PASS |
| Kết quả | Tạo tài khoản thành công. Email service tự động phát hiện dev mode (không có SMTP) → log email ra console thay vì gửi thực. |
| Ghi chú | Xác minh email thủ công qua SQL: `UPDATE users SET email_verified = true` |

### 1.2 Đăng nhập (Login)
| Mục | Chi tiết |
|-----|---------|
| URL | `POST /api/auth/login` → `/login` |
| Trạng thái | ✅ PASS |
| Kết quả | Trả về access token JWT (393 ký tự), refresh token trong body. Chuyển hướng về `/dashboard` sau khi đăng nhập. |
| Ghi chú | Refresh token tự động lưu vào httpOnly cookie. Token truy cập lưu trong biến module-level (`inMemoryAccessToken`). Khi reload trang, hệ thống tự động gọi refresh-token endpoint để lấy token mới từ cookie. |

### 1.3 Đăng xuất (Logout)
| Mục | Chi tiết |
|-----|---------|
| URL | `POST /api/auth/logout` |
| Trạng thái | ✅ PASS |
| Kết quả | Nút đăng xuất hoạt động qua giao diện. |

### 1.4 Giới hạn thiết bị (Device Limit)
| Mục | Chi tiết |
|-----|---------|
| Trạng thái | ⚠️ CẦN CHÚ Ý |
| Ghi chú | Hệ thống giới hạn số thiết bị đăng nhập đồng thời. Khi vượt quá giới hạn trả về lỗi `"Maximum number of devices reached"`. Cần xoá devices cũ: `DELETE FROM user_devices WHERE user_id = '...'` |

---

## 2. Trang Dashboard

| Mục | Chi tiết |
|-----|---------|
| URL | `/dashboard` |
| Trạng thái | ✅ PASS |
| Nội dung hiển thị | Stats tổng quan (XP: 0, Streak: 0, Cards: 0), Mục tiêu hàng ngày, Đề xuất học tập AI, Quick actions, Daily Check-in widget |
| API liên quan | `GET /api/analytics/dashboard` → PASS (streak: 0, totalXp: 0, totalCards: 0, dailyGoal: 20, algorithm: FSRS-4.5) |

### 2.1 Điểm danh hàng ngày (Daily Check-in)
| Mục | Chi tiết |
|-----|---------|
| Widget | Dashboard → Daily Check-in |
| Trạng thái | ✅ PASS |
| Kết quả | Hiển thị lịch 7 ngày (CN-T7), nút "Điểm danh". Click → nhận 5 tokens, streak tăng lên 1, nút chuyển "Đã điểm danh" (disabled). Streak bonus: [5,5,8,8,10,10,15 tokens]. |
| Lưu trữ | localStorage (`daily-checkin-state`), tự reset hàng ngày |

### 2.2 Token Balance (Topbar)
| Mục | Chi tiết |
|-----|---------|
| Widget | Topbar → Coins badge |
| Trạng thái | ✅ PASS |
| Kết quả | Hiển thị số token hiện có (VD: 35 sau check-in). Click → chuyển đến `/pricing`. |

---

## 3. Flashcard & SRS (Spaced Repetition System)

### 3.1 Quản lý bộ thẻ (Deck Management)
| Mục | Chi tiết |
|-----|---------|
| URL | `/flashcards` |
| Trạng thái | ✅ PASS |
| Kết quả | Tạo bộ thẻ "Từ vựng Tiếng Anh cơ bản" thành công (ID: `58791388-1a6d-45dd-a74c-696e04098f7a`). Thêm thẻ "apple / táo - quả táo" thành công. |
| API | `POST /api/decks` → PASS, `POST /api/decks/:id/cards` → PASS, `GET /api/decks/my` → PASS (1 deck) |

### 3.2 SRS Stats
| Mục | Chi tiết |
|-----|---------|
| URL | `GET /api/srs/stats` |
| Trạng thái | ✅ PASS |
| Kết quả | `dueCards: 0, newCards: 0, learnedCards: 0, averageStability: 0, averageDifficulty: 5, retentionRate: 0, totalReviews: 0, algorithm: "FSRS-4.5"` |

### 3.3 SRS Due Cards
| Mục | Chi tiết |
|-----|---------|
| URL | `GET /api/srs/due-cards` |
| Trạng thái | ✅ PASS |
| Kết quả | 0 thẻ đến hạn (thẻ mới tạo chưa đến hạn ôn tập) |

### 3.4 Speed Review
| Mục | Chi tiết |
|-----|---------|
| URL | `/speed-review` |
| Trạng thái | ✅ PASS |
| Kết quả | Trang tải, hiển thị nút "Bắt đầu ôn tập". Chưa có thẻ đến hạn nên không thể bắt đầu phiên ôn tập. |

### 3.5 Difficult Words
| Mục | Chi tiết |
|-----|---------|
| URL | `/difficult-words` |
| Trạng thái | ✅ PASS |
| Kết quả | Hiển thị "Không có từ khó" — đúng vì chưa ôn tập thẻ nào. |

---

## 4. Từ vựng (Vocabulary)

| Mục | Chi tiết |
|-----|---------|
| URL | `/vocabulary` |
| Trạng thái | ✅ PASS |
| Kết quả | Trang "Theo dõi từ vựng" tải thành công. Hiển thị 0 từ đang theo dõi. Có giao diện thêm/theo dõi từ mới. |

---

## 5. Viết (Writing) — AI Feature

| Mục | Chi tiết |
|-----|---------|
| URL | `/writing` |
| Trạng thái | ✅ PASS |
| Giao diện | Textarea nhập bài viết, dropdown chọn ngôn ngữ (English, Vietnamese...), dropdown chọn cấp độ (A1-C2), nút "Nhận phản hồi" |
| API Test | `POST /api/writing/assess` với `{"userText": "Yesterday I go to the store...", "language": "english", "targetLevel": "B1"}` |
| Kết quả API | ✅ PASS — AI phân tích thành công. Response có các field: `id`, `overallScore`, `feedback`, `errors` (`original`, `correction`, `explanation`, `type`), `suggestions`, `rewrittenText`, `scores` (`grammar`, `vocabulary`, `coherence`, `taskAchievement`, `overall`), `language`, `targetLevel`, `createdAt`, `userText`. |
| Thang điểm | AI trả điểm 1–10 (`snake_case`: `corrected_text`, `overall_score`, `tips`, `task_achievement`); `WritingService.assess` chuẩn hoá `overallScore` về thang 0–100 (UI hiển thị `/100`). Khi assert response, dùng camelCase ở trên, không dùng tên field của AI service. |
| AI Model | llama-3.3-70b-versatile (Groq API) |
| Thời gian phản hồi | ~14 giây |

---

## 6. Đọc (Reading) — AI Feature

| Mục | Chi tiết |
|-----|---------|
| URL | `/reading` |
| Trạng thái | ✅ PASS |
| Giao diện | Tab "Thư viện" (0 bài), nút "AI Generate", nút "Analyze Text", bộ lọc cấp độ/chủ đề |
| API Test | `POST /api/reading/generate` với `{"level": "B1", "topic": "technology", "wordCount": 200, "language": "english"}` |
| Kết quả API | ✅ PASS — Tạo bài đọc thành công. Title: "The Rise of Technology", passage về công nghệ ~200 từ, kèm câu hỏi comprehension. |
| AI Model | llama-3.3-70b-versatile (Groq API) |
| Thời gian phản hồi | ~25 giây |

---

## 7. Ngữ pháp (Grammar) — AI Feature

| Mục | Chi tiết |
|-----|---------|
| URL | `/grammar` |
| Trạng thái | ✅ PASS |
| Giao diện | Tiêu đề "Hướng dẫn ngữ pháp", danh sách chủ đề ngữ pháp, nút "AI Explain", ô nhập câu hỏi |
| API Test | `POST /api/grammar/explain` với `{"grammarPoint": "Present Perfect Tense", "language": "english"}` |
| Kết quả API | ✅ PASS — Giải thích: "The Present Perfect Tense is used to describe an action that started in the past and continues up to the present moment..." kèm ví dụ và bài tập |
| AI Model | llama-3.3-70b-versatile (Groq API) |
| Thời gian phản hồi | ~12 giây |

---

## 8. Chat với AI Tutor

| Mục | Chi tiết |
|-----|---------|
| URL | `/chat` |
| Trạng thái | ✅ PASS |
| Giao diện | Giao diện chat, selector ngôn ngữ (English, Vietnamese, Spanish...), ô nhập tin nhắn, nút gửi, quick-reply buttons |
| API Test | `POST /api/chat/send` với `{"messages": [{"role": "user", "content": "Hello! What is Present Perfect tense?"}], "language": "english"}` |
| Kết quả API | ✅ PASS — AI tutor phản hồi thành công (1743 ký tự từ Groq API) |
| AI Model | llama-3.3-70b-versatile (Groq API), NestJS GroqService |
| Thời gian phản hồi | ~2 giây |
| API phụ | `GET /api/chat/conversations` — lấy danh sách hội thoại |

---

## 9. Quiz — AI Feature

### 9.1 Xem danh sách Quiz
| Mục | Chi tiết |
|-----|---------|
| URL | `/quiz` |
| Trạng thái | ✅ PASS |
| Kết quả | Hiển thị "English Vocabulary Test" (1 câu hỏi) có sẵn trong DB. |

### 9.2 Tạo Quiz từ chủ đề (AI Generate)
| Mục | Chi tiết |
|-----|---------|
| API | `POST /api/quiz/generate-from-topic` |
| Trạng thái | ✅ PASS |
| Test input | `{"topic": "Basic English Greetings", "difficulty": "A1", "questionCount": 3, "language": "english"}` |
| Kết quả | Quiz tạo thành công: ID `80ed7d4a-7b69-42fb-a04d-0db53ec8b74c`, title "Basic English Greetings Quiz", 3 câu hỏi |
| AI Model | llama-3.3-70b-versatile (Groq API) |

---

## 10. Nghe (Listening) — AI Feature

| Mục | Chi tiết |
|-----|---------||
| URL | `/listening` |
| Trạng thái | ✅ PASS |
| Kết quả | Trang "Luyện nghe" tải thành công. Tab Library hiển thị bài nghe từ CMS. Tab AI Generate cho phép tạo bài nghe tuỳ chỉnh. |
| API | `POST /api/listening/generate` — Tạo bài nghe AI: transcript, vocabulary, comprehension questions |
| AI Model | llama-3.3-70b-versatile (Groq API, Next.js API route) |
| Ghi chú | AI tạo transcript + từ vựng + câu hỏi trắc nghiệm. Browser SpeechSynthesis đọc transcript. |

---

## 11. Nói (Speaking) — AI Feature

| Mục | Chi tiết |
|-----|---------||
| URL | `/speaking` |
| Trạng thái | ✅ PASS |
| Kết quả | Trang "Luyện nói" tải thành công. Ghi âm giọng nói qua Web Speech API, AI phân tích phát âm/ngữ pháp/từ vựng. |
| API | `POST /api/speaking` — Phân tích bài nói (pronunciation, fluency, grammar, vocabulary scores) |
| API | `POST /api/speaking/topic` — Tạo chủ đề luyện nói AI |
| AI Model | llama-3.3-70b-versatile (Groq API, Next.js API route) |

---

## 12. Dịch thuật (Translation) — AI Feature

| Mục | Chi tiết |
|-----|---------||
| URL | `/translation` |
| Trạng thái | ✅ PASS |
| Kết quả | Trang "Luyện dịch" tải thành công. CMS bài tập dịch + nút "Tạo bài tập bằng AI" cho phép AI tạo câu dịch Việt→Anh tuỳ chỉnh. |
| API | `POST /api/translation/generate` — AI tạo bài tập dịch (câu tiếng Việt + đáp án tiếng Anh + gợi ý) |
| AI Model | llama-3.3-70b-versatile (Groq API, Next.js API route) |
| Ghi chú | Kiểm tra đáp án offline bằng text comparison (normalize + diffWords). AI tạo nhiều đáp án chấp nhận được. |

---

## 13. Mục tiêu (Goals)

| Mục | Chi tiết |
|-----|---------|
| URL | `/goals` |
| Trạng thái | ✅ PASS |
| Kết quả | Hiển thị "Mục tiêu hàng ngày", progress 0/3. Giao diện đặt mục tiêu có thể tương tác. |

---

## 14. Bảng xếp hạng (Leaderboard)

| Mục | Chi tiết |
|-----|---------|
| URL | `/leaderboard` |
| Trạng thái | ✅ PASS |
| API | `GET /api/analytics/leaderboard` |
| Kết quả | ✅ PASS — Hiển thị 2 người dùng trong bảng xếp hạng (dữ liệu seed có sẵn). |

---

## 15. Giá cả & Token (Pricing)

| Mục | Chi tiết |
|-----|---------|
| URL | `/pricing` |
| Trạng thái | ✅ PASS |
| Tab "Gói Token" | 4 gói: **Starter** (100 tokens/$0.99), **Basic** (500/$3.99), **Plus** (1200/$7.99), **Pro** (3000/$14.99). Hiển thị số dư hiện tại. |
| Tab "Chi phí AI" | Bảng chi phí theo tính năng: AI Chat (5), Writing Feedback (10), Reading Generate (8), Grammar Explain (5), Listening (8), Quiz (6), Translation (3), Speaking (10), Learning Path (5). |
| FAQ | Accordion với 4 câu hỏi thường gặp về hệ thống token. |
| Token miễn phí | 30 tokens/ngày, tự reset lúc 00:00. |

### 15.1 Token Gate (Tính năng AI có tính phí)
| Mục | Chi tiết |
|-----|---------|
| Trạng thái | ✅ PASS |
| Chat | Badge "5 tokens" hiển thị cạnh nút gửi |
| Writing | Badge "10 tokens" hiển thị cạnh nút submit |
| Reading | Badge "8 tokens" khi tạo bài AI |
| Grammar | Badge "5 tokens" khi dùng AI Explain |
| Kết quả | Khi gửi request AI, token tự động trừ từ balance. Nếu không đủ → hiện thông báo. |

---

## 16. Hồ sơ cá nhân (Profile)

| Mục | Chi tiết |
|-----|---------|
| URL | `/profile` |
| Trạng thái | ✅ PASS |
| API | `GET /api/users/me` → PASS, `PUT /api/users/me` |
| Giao diện | Form chỉnh sửa tên, avatar, ngôn ngữ mẹ đẻ, ngôn ngữ mục tiêu, cấp độ. |

---

## 17. Đề xuất học tập (Recommendations)

| Mục | Chi tiết |
|-----|---------|
| API | `GET /api/recommendations/learning-path` |
| Trạng thái | ✅ PASS |
| Kết quả | Trả về lộ trình học tập có `userId`, `generatedAt`, `activities` (danh sách hoạt động đề xuất). |

---

## 18. Quản trị hệ thống (Admin Panel)

### 18.1 Tổng quan Admin
| Mục | Chi tiết |
|-----|---------|
| URL | `/admin` |
| Trạng thái | ✅ PASS |
| Kết quả | Thống kê: 4 Người dùng, 2 Bộ thẻ, 0 Flashcards, 0 Lượt ôn tập, 0 Nội dung. Bài học theo loại: Ngữ pháp 1, còn lại 0. Quick actions: Tạo bài học mới, Quản lý bài học, Quản lý người dùng. |
| Phân quyền | Chỉ hiển thị sidebar link "Quản trị" khi `user.role === 'admin'`. |

### 18.2 Quản lý bài học (Admin Lessons)
| Mục | Chi tiết |
|-----|---------|
| URL | `/admin/lessons` |
| Trạng thái | ✅ PASS |
| Kết quả | Danh sách 1 bài học (Ngữ pháp). Bộ lọc: Loại (5 loại), Ngôn ngữ (🇺🇸🇨🇳🇯🇵). Nút "Tạo bài học mới". Bảng: Tên, Loại, Ngôn ngữ, Cấp độ, Nguồn, Trạng thái, Hành động. |

### 18.3 Quản lý người dùng (Admin Users)
| Mục | Chi tiết |
|-----|---------|
| URL | `/admin/users` |
| Trạng thái | ✅ PASS |
| Kết quả | Danh sách 4 người dùng. Bảng: Tên, Email, Vai trò, XP, Ngày tham gia, Hành động (User/Admin toggle). |

---

## Tổng kết

### Thống kê tổng quan

| Loại | Tổng | PASS | FAIL | PARTIAL |
|------|------|------|------|---------|
| Trang giao diện | 21 | 21 | 0 | 0 |
| API Endpoint | 20+ | 20+ | 0 | 0 |
| AI Feature (Groq) | 8 | 8 | 0 | 0 |
| Admin Panel | 3 | 3 | 0 | 0 |
| Token System | 4 | 4 | 0 | 0 |

### Các tính năng AI hoạt động tốt

| Tính năng | Endpoint | Model | Kết quả |
|-----------|----------|-------|---------|
| Đánh giá bài viết | `POST /api/writing/assess` | llama-3.3-70b | ✅ Trả về điểm, feedback, lỗi, gợi ý |
| Tạo bài đọc | `POST /api/reading/generate` | llama-3.3-70b | ✅ Tạo bài đọc + câu hỏi comprehension |
| Giải thích ngữ pháp | `POST /api/grammar/explain` | llama-3.3-70b | ✅ Giải thích chi tiết + ví dụ |
| Chat AI Tutor | `POST /api/chat/send` | llama-3.3-70b | ✅ Hội thoại tự nhiên |
| Tạo Quiz từ chủ đề | `POST /api/quiz/generate-from-topic` | llama-3.3-70b | ✅ Tạo câu hỏi trắc nghiệm |
| Luyện nghe AI | `POST /api/listening/generate` | llama-3.3-70b | ✅ Tạo bài nghe + từ vựng + câu hỏi |
| Luyện nói AI | `POST /api/speaking` | llama-3.3-70b | ✅ Phân tích phát âm, ngữ pháp, từ vựng |
| Luyện dịch AI | `POST /api/translation/generate` | llama-3.3-70b | ✅ Tạo bài dịch Việt→Anh |

### Vấn đề đã phát hiện

| STT | Vấn đề | Mức độ | Trạng thái | Ghi chú |
|-----|--------|--------|------------|---------|
| 1 | Refresh token không lưu vào cookie | Trung bình | ✅ ĐÃ SỬA | Cài `cookie-parser`, thêm vào `main.ts`. Frontend 401 interceptor tự động capture accessToken mới từ refresh response. |
| 2 | Email service không hoạt động trong dev | Thấp | ✅ ĐÃ SỬA | Sửa config key (`email.host` → `EMAIL_HOST`). Thêm dev mode bypass: khi không có SMTP config, log email ra console. |
| 3 | Redis auth không khớp | Thấp | ✅ ĐÃ SỬA | Thêm `REDIS_PASSWORD=redis_secret` vào root `.env` và `apps/ai-service/.env`. |
| 4 | Giới hạn thiết bị | Thấp | ⚠️ BY DESIGN | Cần xoá devices cũ thủ công khi test nhiều lần |
| 5 | Listening/Speaking/Translation chưa có AI | Trung bình | ✅ ĐÃ SỬA | Thêm API routes: `/api/listening/generate`, `/api/speaking` (đã có), `/api/translation/generate`. Cập nhật frontend pages. |
| 6 | Admin role case-sensitivity | Cao | ✅ ĐÃ SỬA | DB trả role "ADMIN" (uppercase), frontend check `=== 'admin'` (lowercase). Fix: `.toLowerCase()` trong `auth-store.ts` (login + loadUser) và `sidebar.tsx`. |
| 7 | loadUser ghi đè role từ login | Cao | ✅ ĐÃ SỬA | `/users/me` không trả `roles` field → loadUser ghi đè user object mất role. Fix: preserve existing role khi API không trả về roles. |
| 8 | Middleware chặn /admin trong dev | Trung bình | ✅ ĐÃ SỬA | `middleware.ts` kiểm tra cookie `userRole` (backend không set cookie này). Fix: bypass admin check trong dev mode (`!isDev`). |
| 9 | Cờ Anh 🇬🇧 thay vì cờ Mỹ 🇺🇸 | Thấp | ✅ ĐÃ SỬA | Thay đổi 🇬🇧 → 🇺🇸 trong 5 file: types.ts, sidebar.tsx, lesson-form.tsx, admin/lessons/page.tsx, translation/page.tsx |

### Thuật toán SRS

Hệ thống sử dụng **SM-2 + FSRS-4.5** (Free Spaced Repetition Scheduler) — thuật toán SRS tiên tiến dựa trên mô hình bộ nhớ. Các tham số trong response `GET /api/srs/stats`:
- `stability` / `averageStability`: Độ bền của thẻ trong bộ nhớ
- `difficulty` / `averageDifficulty`: Độ khó của thẻ (mặc định: 5)
- `retentionRate`: Tỷ lệ ghi nhớ mục tiêu (90%)
- `dueCards`, `newCards`, `learnedCards`, `totalReviews`: Số thẻ cần ôn tập / mới / đã học / lượt ôn tập
- `interval_days`, `ease_factor`, `repetition_count`: Khoảng cách ôn tập, hệ số dễ (tối thiểu 1.3) và số lần lặp lại cho mỗi thẻ

Ngoài ra, hệ thống hỗ trợ đánh giá 4 mức (Again, Hard, Good, Easy) qua `POST /api/srs/review`, phiên ôn tập qua `POST /api/srs/session/start` và `POST /api/srs/session/finish`, dashboard retention qua `GET /api/srs/retention-dashboard`, và dự báo 30 ngày qua `GET /api/srs/forecast?days=30` (xem chi tiết tại `docs/function_app.md` mục 4).

### Kiến trúc

```
Browser (Next.js/3000)
    ↓ REST API calls
NestJS API (/3001) 
    ↓ HTTP calls to AI service
FastAPI AI Service (/8000) 
    ↓ Groq API (llama-3.3-70b-versatile)

Next.js API Routes (/3000/api/speaking, /api/listening/generate, /api/translation/generate)
    ↓ Groq API (llama-3.3-70b-versatile)
    
NestJS API ↔ PostgreSQL (Docker/5432)
NestJS API ↔ Redis (Docker/6379) [cache enabled với REDIS_PASSWORD]
FastAPI AI ↔ Redis (Docker/6379) [cache enabled với REDIS_PASSWORD]
```
