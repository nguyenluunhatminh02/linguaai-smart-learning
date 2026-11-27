# LinguaAI — Danh sách toàn bộ chức năng ứng dụng

---

## 1. Xác thực & Bảo mật tài khoản

### 1.1 Đăng ký & Đăng nhập
- Đăng ký bằng email/password với validation
- Đăng nhập bằng email/password trả về JWT + refresh token
- Refresh token rotation (httpOnly cookie)
- Xác thực email bằng token hết hạn
- Gửi lại email xác thực
- Mã hóa mật khẩu an toàn

### 1.2 Quản lý mật khẩu
- Quên mật khẩu (gửi email reset)
- Đặt lại mật khẩu bằng token
- Đổi mật khẩu khi đã đăng nhập
- Theo dõi lịch sử mật khẩu (ngăn tái sử dụng)

### 1.3 Xác thực đa yếu tố (MFA)
- Thiết lập MFA bằng TOTP với mã QR
- Xác minh MFA khi đăng nhập
- Kiểm tra trạng thái MFA
- Vô hiệu hóa MFA (yêu cầu mã TOTP)
- Tạo mã dự phòng (10 mã)
- Tái tạo mã dự phòng
- Đếm số mã dự phòng còn lại

### 1.4 Đăng nhập mạng xã hội (OAuth2)
- Đăng nhập Google OAuth2 (callback qua Passport)
- Đăng nhập GitHub OAuth2 (callback qua Passport)
- Liệt kê nhà cung cấp OAuth khả dụng (`GET /auth/oauth2/providers`)
- Liệt kê/hủy liên kết tài khoản: endpoint tồn tại nhưng **chưa triển khai**
  (trả về danh sách rỗng / thông báo giả), không dùng trong production

### 1.5 Quản lý phiên & Thiết bị
- Liệt kê phiên hoạt động
- Đăng xuất phiên hiện tại
- Đăng xuất tất cả phiên
- Đăng xuất thiết bị cụ thể theo ID
- Liệt kê thiết bị đang hoạt động với metadata
- Tin tưởng/Không tin tưởng thiết bị
- Đổi tên thiết bị
- Xóa thiết bị cá nhân
- Xóa tất cả thiết bị khác
- Vân tay thiết bị (trình duyệt, OS, IP)
- Giới hạn số thiết bị tối đa (mặc định: 3)

### 1.6 Hạ tầng bảo mật
- Khóa tài khoản sau nhiều lần đăng nhập thất bại (tự mở sau 30 phút)
- Theo dõi lần đăng nhập (theo email + IP)
- CAPTCHA (SVG, Redis, TTL 5 phút)
- CSRF protection (HMAC-SHA256, Redis)
- Rate limiting guard
- Audit logging (hành động, tài nguyên, IP, user agent, thiết bị)
- Câu hỏi bảo mật (1-3 mỗi user)
- Lên lịch xóa tài khoản vĩnh viễn (cron 2AM, 30 ngày ân hạn)
- Token blacklist service
- JWT strategy + guards

### 1.7 Vòng đời tài khoản
- Yêu cầu xóa tài khoản (30 ngày ân hạn)
- Hủy yêu cầu xóa tài khoản
- Vô hiệu hóa tài khoản
- Xóa vĩnh viễn tài khoản hết hạn (cron)
- Theo dõi trạng thái: active/locked/deleted

### API Endpoints
```
POST   /auth/register
POST   /auth/login
POST   /auth/verify-mfa
POST   /auth/refresh-token
POST   /auth/logout
POST   /auth/logout-all
POST   /auth/logout-session/:deviceId
GET    /auth/verify-email
POST   /auth/forgot-password
POST   /auth/reset-password
POST   /auth/change-password
POST   /auth/resend-verification
GET    /auth/login-history
GET    /auth/security-events
GET|POST    /mfa/*
GET    /auth/oauth2/providers
GET    /auth/oauth2/callback/google
GET    /auth/oauth2/callback/github
GET    /auth/oauth2/connected-accounts
DELETE /auth/oauth2/connected-accounts/:provider
GET|POST|DELETE /devices/*
```

### Trang Frontend
- `/login` — Đăng nhập
- `/register` — Đăng ký

---

## 2. Hồ sơ người dùng & Cài đặt

### 2.1 Quản lý hồ sơ
- Xem hồ sơ người dùng hiện tại
- Cập nhật hồ sơ (họ, tên, email, SĐT, ngày sinh, giới tính)
- Tải lên ảnh đại diện (multipart, tối đa 5MB, jpeg/png/gif/webp)
- Xóa ảnh đại diện
- Ngôn ngữ ưu tiên
- Cài đặt múi giờ

### 2.2 Cài đặt thông báo
- Bật/tắt thông báo email
- Bật/tắt thông báo push
- Bật/tắt thông báo in-app
- Bật/tắt thông báo bảo mật
- Bật/tắt thông báo đơn hàng
- Bật/tắt thông báo khuyến mãi
- Đăng ký FCM token (push mobile)

### 2.3 Cài đặt quyền riêng tư
- Hiển thị hồ sơ (công khai/riêng tư)
- Hiện/ẩn email
- Hiện/ẩn SĐT
- Hiện/ẩn trạng thái hoạt động

### API Endpoints
```
GET|PUT|PATCH  /users/me
DELETE         /users/me
POST           /users/me/cancel-delete
GET|PUT        /users/me/notification-preferences
GET|PUT        /users/me/privacy
POST           /users/me/fcm-token
GET            /users/me/devices
POST           /users/me/devices/:id/trust
POST           /users/me/devices/:id/untrust
DELETE         /users/me/devices/:id
POST           /users/me/security-questions
GET            /users/me/security-questions
GET            /users/me/sessions
DELETE         /users/me/sessions/:id
GET            /users/me/login-history
POST           /users/me/avatar
DELETE         /users/me/avatar
POST           /users/me/deactivate
```

### Trang Frontend
- `/profile` — Hồ sơ và cài đặt

---

## 3. Hệ thống Flashcard

### 3.1 Quản lý Bộ bài (Deck)
- Tạo bộ bài (tiêu đề, mô tả, ngôn ngữ, mức CEFR, công khai/riêng tư)
- Xem tất cả bộ bài (cá nhân + công khai, phân trang)
- Xem bộ bài của tôi
- Xem bộ bài theo ID
- Cập nhật bộ bài
- Xóa bộ bài
- Đếm số thẻ mỗi bộ

### 3.2 Quản lý Thẻ (Card)
- Tạo thẻ (mặt trước, mặt sau, phiên âm IPA, audio URL, câu ví dụ, hình ảnh)
- Tạo hàng loạt thẻ
- AI tạo flashcard từ đoạn văn bản (3-20 thẻ, trích xuất từ vựng)
- Xem tất cả thẻ trong bộ
- Xem thẻ theo ID
- Cập nhật thẻ
- Xóa thẻ

### 3.3 Chế độ Học tập
- Trang học tập theo bộ (`/flashcards/[deckId]/study`)
- Lên lịch thẻ dựa trên SRS

### API Endpoints
```
POST   /decks
GET    /decks
GET    /decks/my
GET    /decks/:id
PATCH  /decks/:id
DELETE /decks/:id
POST   /decks/:deckId/cards
POST   /decks/:deckId/cards/bulk
POST   /decks/:deckId/cards/generate-from-text
GET    /decks/:deckId/cards
GET    /decks/:deckId/cards/:id
PATCH  /decks/:deckId/cards/:id
DELETE /decks/:deckId/cards/:id
```

### Trang Frontend
- `/flashcards` — Danh sách bộ bài
- `/flashcards/[deckId]` — Chi tiết bộ bài
- `/flashcards/[deckId]/study` — Chế độ học

---

## 4. Hệ thống Lặp lại Ngắt quãng (SRS)

### 4.1 Thuật toán SM-2
- SuperMemo-2 cổ điển
- Ease factor (tối thiểu 1.3), tính toán interval, theo dõi lần lặp
- Lên lịch dựa trên chất lượng (thang 0-5)
- Reset khi thất bại (quality < 3)

### 4.2 Thuật toán FSRS-4.5
- Free Spaced Repetition Scheduler (tiên tiến nhất)
- Dự đoán Memory stability (S) và difficulty (D) cho mỗi thẻ
- Tính toán retrievability bằng power forgetting curve
- 4 mức đánh giá: Again, Hard, Good, Easy
- Mục tiêu retention 90%
- Initial stability/difficulty từ grade
- Cập nhật stability sau recall và sau khi quên
- Giới hạn interval tối đa (100 năm)

### 4.3 Tính năng SRS
- Lấy thẻ đến hạn theo bộ (với giới hạn)
- Gửi kết quả ôn tập thẻ (grade)
- Bắt đầu phiên ôn tập
- Kết thúc phiên ôn tập (thẻ đã ôn, đúng, thời lượng)
- Tổng quan thống kê SRS
- Dashboard retention (theo bộ: retrievability %, thẻ rủi ro, stability/difficulty, thẻ tồi nhất)
- Dự báo ôn tập 30 ngày

### API Endpoints
```
GET  /srs/due-cards?deckId&limit
POST /srs/review
POST /srs/session/start
POST /srs/session/finish
GET  /srs/stats
GET  /srs/retention-dashboard
GET  /srs/forecast?days
```

### Trang Frontend
- `/flashcards/[deckId]/study` — Phiên học SRS
- `/speed-review` — Trò chơi ôn tập có giờ
- `/difficult-words` — Thẻ có retrievability < 70%

---

## 5. Hệ thống Quiz

### 5.1 Quản lý Quiz
- Tạo quiz (tiêu đề, mô tả, liên kết bộ bài, giới hạn thời gian)
- AI tạo quiz từ chủ đề (MCQ, đúng/sai, điền khuyết, 3-20 câu)
- Xem tất cả quiz (phân trang)
- Xem quiz theo ID với tất cả câu hỏi
- Xóa quiz

### 5.2 Làm Quiz
- Gửi câu trả lời quiz (điểm, tổng câu, JSON câu trả lời, thời lượng)
- Chế độ quiz thích ứng (IRT-lite): câu tiếp điều chỉnh độ khó dựa trên correctRate
- Xem lịch sử làm quiz
- Loại câu hỏi: MCQ, đúng/sai, điền vào chỗ trống
- Mức độ khó mỗi câu (1-5)
- Giải thích cho mỗi câu

### API Endpoints
```
POST   /quiz
POST   /quiz/generate-from-topic
GET    /quiz
GET    /quiz/:id
POST   /quiz/submit
POST   /quiz/:id/adaptive/next
GET    /quiz/:id/attempts
DELETE /quiz/:id
```

### Trang Frontend
- `/quiz` — Danh sách quiz
- `/quiz/create` — Tạo quiz
- `/quiz/[quizId]` — Làm quiz

---

## 6. Luyện viết (Writing Practice)

### 6.1 Đánh giá bài viết
- Gửi bài viết để AI đánh giá (văn bản, ngôn ngữ, mức mục tiêu)
- AI trả về: văn bản đã sửa, danh sách lỗi (loại, gốc, sửa, giải thích), điểm (ngữ pháp, từ vựng, mạch lạc), mẹo, tổng điểm

### 6.2 Phân tích mẫu lỗi
- Tổng hợp lỗi từ các bài viết gần đây
- AI xác định mẫu điểm yếu và tạo bài tập针对性
- Phân tích theo ngôn ngữ

### 6.3 Lịch sử viết
- Lịch sử bài viết (phân trang)
- Xem bài viết với feedback đầy đủ

### API Endpoints
```
POST /writing/assess
GET  /writing/error-analysis?language&limit
GET  /writing/history?page&limit
GET  /writing/:id
```

### Trang Frontend
- `/writing` — Luyện viết với tabs: Viết, Lịch sử, Phân tích lỗi

---

## 7. Luyện đọc (Reading Practice)

### 7.1 Tạo bài đọc
- AI tạo bài đọc (chủ đề, mức A1-C2, 50-1000 từ)
- AI trả về: đoạn văn, danh sách từ vựng (từ, định nghĩa, từ loại), câu hỏi hiểu (MCQ với giải thích)

### 7.2 Phân tích văn bản NLP
- Phân tích đoạn văn bất kỳ
- Trả về: điểm readability, mức CEFR ước tính, từ khóa, độ phức tạp từ vựng, mẫu ngữ pháp, số từ, số câu

### 7.3 Gợi ý đọc
- Gợi ý chủ đề cá nhân hóa dựa trên lịch sử đọc
- Loại trừ chủ đề đã đọc gần đây

### 7.4 Lịch sử đọc
- Lịch sử bài đọc (phân trang)
- Xem bài đọc cá nhân

### API Endpoints
```
POST /reading/generate
POST /reading/analyze-text
GET  /reading/recommendations?language&limit
GET  /reading/history?page&limit
GET  /reading/:id
```

### Trang Frontend
- `/reading` — Luyện đọc
- `/japanese/reading` — Đọc tiếng Nhật
- `/chinese/reading` — Đọc tiếng Trung

---

## 8. Hướng dẫn Ngữ pháp (Grammar Guide)

### 8.1 Giải thích ngữ pháp
- Lấy giải thích ngữ pháp AI cho bất kỳ điểm ngữ pháp
- Câu hỏi thêm tùy chọn
- AI trả về: tên điểm, giải thích chi tiết, ví dụ, bài tập thực hành

### API Endpoints
```
POST /grammar/explain
```

### Trang Frontend
- `/grammar` — Hướng dẫn ngữ pháp
- `/japanese/grammar` — Ngữ pháp tiếng Nhật
- `/chinese/grammar` — Ngữ pháp tiếng Trung

---

## 9. Chatbot AI / Gia sư AI

### 9.1 Tính năng Chat
- Gửi tin nhắn cho gia sư AI (hội thoại nhiều lượt)
- Stream phản hồi AI qua Server-Sent Events (SSE)
- System prompt: gia sư ngôn ngữ chuyên nghiệp
- Quản lý nhiều hội thoại
- Xem tất cả hội thoại
- Xem tin nhắn trong hội thoại
- Xóa hội thoại

### API Endpoints
```
POST   /chat/send
POST   /chat/stream
GET    /chat/conversations
GET    /chat/conversations/:id/messages
DELETE /chat/conversations/:id
```

### Trang Frontend
- `/chat` — Giao diện chat gia sư AI

---

## 10. Gợi ý học tập AI (Learning Recommendations)

### 10.1 Lộ trình học tập cá nhân hóa
- Tạo danh sách xếp hạng hoạt động học tập được gợi ý
- Phân tích dữ liệu retention FSRS (thẻ đến hạn, thẻ rủi ro)
- Phân tích mẫu lỗi viết
- Kiểm tra lịch sử đọc, quiz, ngữ pháp
- Loại hoạt động: ôn SRS, đọc, viết, quiz, bài tập lỗi, ngữ pháp
- Mức ưu tiên: cao, trung bình, thấp
- Ước tính thời gian mỗi hoạt động
- Cache 30 phút với invalidation thủ công

### API Endpoints
```
GET  /recommendations/learning-path
POST /recommendations/invalidate-cache
```

---

## 11. Thống kê & Gamification

### 11.1 Dashboard thống kê
- Số ngày liên tiếp (streak)
- Tổng XP
- Tổng thẻ, thẻ đã mastered (5+ lần ôn), thẻ đến hạn
- Tiến trình mục tiêu hàng ngày
- Biểu đồ hoạt động hàng tuần (XP + phút mỗi ngày)

### 11.2 Bảng xếp hạng
- Bảng xếp hạng theo XP (top N users)

### 11.3 Lịch sử phiên ôn tập
- Phiên ôn tập gần đây với thống kê

### 11.4 Ghi nhận hoạt động
- Ghi nhận XP kiếm được và phút học
- Theo dõi streak hàng ngày
- Logic tự động tăng/reset streak

### 11.5 Mô hình dữ liệu Gamification
- `streak_count` trên user
- `total_xp` trên user
- `daily_goal` trên user (mặc định 20)
- `user_streaks` mỗi ngày (xp_earned, minutes_studied)
- `badges` — huy hiệu với tên, mô tả, icon, điều kiện
- `user_badges` — huy hiệu đã đạt

### API Endpoints
```
GET /analytics/dashboard
GET /analytics/leaderboard?limit
GET /analytics/sessions
```

### Trang Frontend
- `/dashboard` — Dashboard chính
- `/leaderboard` — Bảng xếp hạng XP

---

## 12. Luyện nói (Speaking Practice)

### 12.1 Tạo chủ đề nói
- AI tạo chủ đề nói theo danh mục và mức độ
- Trả về: chủ đề, prompt, mẹo, cụm từ mẫu, thời lượng, độ khó
- Danh mục: Đời sống, Du lịch, Công việc & Học tập, Ý kiến, Kể chuyện
- Mức: A2, B1, B2, C1

### 12.2 Ghi âm & Chuyển ngữ
- Tích hợp Web Speech API
- Chuyển ngữ thời gian thực với kết quả tạm thời
- Đồng hồ đếm thời gian ghi âm

### 12.3 Phân tích bài nói (qua Groq LLM)
- Tổng điểm (1-100)
- Điểm phát âm + feedback + từ vấn đề
- Điểm trôi chảy + feedback
- Điểm ngữ pháp + feedback + sửa lỗi
- Điểm từ vựng + feedback + gợi ý
- Feedback tổng thể
- Text-to-speech cho từ vấn đề/gợi ý

### API Routes (Frontend)
```
POST /api/speaking          — Phân tích bài nói (proxy Groq)
POST /api/speaking/topic    — Tạo chủ đề nói
```

### Trang Frontend
- `/speaking` — Toàn bộ quy trình luyện nói

---

## 13. Luyện nghe (Listening Practice)

### 13.1 Thư viện bài học
- Nội dung bài học dựa trên CMS với audio
- Danh mục: Hội thoại, Thông báo, Bài giảng, Phỏng vấn, Tin tức
- Lọc theo mức (A1-C1)
- Phát audio (HTML5)
- Hiện/ẩn bản chép
- Từ vựng quan trọng với định nghĩa
- Câu hỏi hiểu (MCQ) với chấm điểm
- Tóm tắt điểm với đậu/rớt

### Trang Frontend
- `/listening` — Luyện nghe với Library + AI tabs

---

## 14. Luyện dịch (Translation Practice)

### 14.1 Dịch Việt-Anh
- Bài học dựa trên CMS (câu song ngữ)
- Danh mục: Đời sống, Du lịch, Công việc, Xã hội, Ý kiến, Học thuật
- Lọc theo mức (A1-C2)
- Bài tập dịch câu từng câu
- Feedback ngay lập tức với highlight diff từng từ
- Chấp nhận đáp án thay thế
- Tóm tắt điểm (% + số đúng)
- Text-to-speech cho đáp án đúng
- Thanh tiến trình
- Xem kết quả chi tiết

### Trang Frontend
- `/translation` — Bài tập dịch

---

## 15. Quản lý Từ vựng (Vocabulary)

### 15.1 Từ của tôi
- Thêm từ tùy chỉnh (từ, nghĩa, câu ví dụ)
- Theo dõi trạng thái: mới, đang học, đã biết
- Chuyển trạng thái (đánh dấu đang học, đã biết)
- Tìm kiếm/lọc theo từ
- Lọc theo trạng thái (tất cả, mới, đang học, đã biết)
- Thẻ thống kê (tổng, mới, đang học, đã biết)
- Thanh tiến trình mức độ thành thạo

### 15.2 Gói từ vựng
- Nội dung gói từ vựng dựa trên CMS
- Hiển thị: mức, tiêu đề (EN+VI), số từ, mô tả
- Xem chi tiết gói với danh sách từ đầy đủ
- Thêm từ riêng lẻ từ gói vào bộ sưu tập cá nhân
- Từ bao gồm: từ, IPA, từ loại, định nghĩa EN/VI, ví dụ, chủ đề

### Trang Frontend
- `/vocabulary` — Từ của tôi + Gói từ vựng

---

## 16. Trò chơi Ôn tập Nhanh (Speed Review)

### 16.1 Cơ chế trò chơi
- Ôn tập flashcard có giờ (đếm ngược 60 giây)
- Lấy thẻ SRS đến hạn thực từ API
- Lựa chọn đúng/sai nhị phân
- Điểm: 10 điểm + bonus streak (2/streak)
- Đếm streak + streak tốt nhất
- Phần trăm chính xác
- Tóm tắt vòng (điểm, chính xác, streak tốt nhất, từ đã ôn)
- Feedback trực quan (viền thẻ xanh/đỏ)

### Trang Frontend
- `/speed-review` — Trò chơi ôn tập nhanh

---

## 17. Từ khó (Difficult Words)

### 17.1 Tự động nhận diện
- Sử dụng dữ liệu SRS retention dashboard
- Nhận diện thẻ có retrievability < 70%
- Hiển thị: từ, % retention, stability, số lần thử, lần thử cuối
- Thanh tiến trình chính xác
- Nút luyện tập
- Xóa khỏi danh sách

### Trang Frontend
- `/difficult-words` — Xem từ khó

---

## 18. Mục tiêu hàng ngày (Daily Goals)

### 18.1 Theo dõi mục tiêu
- Ba loại mục tiêu: phút/ngày, từ/ngày, ôn tập/ngày
- Mục tiêu mặc định: 30 phút, 10 từ, 20 ôn tập
- Chỉnh sửa mục tiêu
- Tự động reset hàng ngày
- Tiến trình hoàn thành tổng thể
- Biểu đồ tổng quan hàng tuần (T2-CN)
- Lưu trữ localStorage

### Trang Frontend
- `/goals` — Theo dõi mục tiêu hàng ngày

---

## 19. Học tiếng Trung (Chinese)

### 19.1 Module con
- Trang tổng quan tiếng Trung (Chinese Hub)
- Từ vựng HSK (gói từ vựng có cấu trúc)
- Ngữ pháp tiếng Trung
- Bài tập dịch Việt-Trung
- Luyện đọc tiếng Trung

### Trang Frontend
- `/chinese` — Trang tổng quan tiếng Trung
- `/chinese/vocabulary`
- `/chinese/grammar`
- `/chinese/translation`
- `/chinese/reading`

---

## 20. Học tiếng Nhật (Japanese)

### 20.1 Module con
- Trang tổng quan tiếng Nhật (Japanese Hub)
- Từ vựng JLPT (gói từ vựng có cấu trúc)
- Ngữ pháp tiếng Nhật
- Bài tập dịch Việt-Nhật
- Luyện đọc tiếng Nhật

### Trang Frontend
- `/japanese` — Trang tổng quan tiếng Nhật
- `/japanese/vocabulary`
- `/japanese/grammar`
- `/japanese/translation`
- `/japanese/reading`

---

## 21. Bảng điều khiển Admin

### 21.1 Dashboard Admin
- Thống kê tổng quan nền tảng
- Quản lý người dùng (liệt kê, cập nhật vai trò, xóa)
- Quản lý nội dung (CRUD cho đọc, ngữ pháp, nghe)
- Loại nội dung: READING, GRAMMAR, LISTENING
- Kiểm soát truy cập theo vai trò (ADMIN)

### API Endpoints
```
GET    /admin/overview
GET    /admin/users?page&limit
PATCH  /admin/users/:id/role
DELETE /admin/users/:id
GET    /admin/content?type
POST   /admin/content
PATCH  /admin/content/:id
DELETE /admin/content/:id
```

### Trang Frontend
- `/admin` — Dashboard admin
- `/admin/users` — Quản lý người dùng
- `/admin/analytics` — Thống kê nền tảng

---

## 22. Hệ thống Quản lý Nội dung (CMS)

### 22.1 CMS Backend
- Model nội dung với metadata phong phú
- Hỗ trợ nhiều loại nội dung
- Hỗ trợ tiêu đề tiếng Việt (title_vi)
- Gán mức CEFR
- Trường JSON cho nội dung linh hoạt
- Hỗ trợ audio URL
- Trạng thái xuất bản/chưa xuất bản
- Sắp xếp thứ tự

### 22.2 CMS Frontend
- Lưu trữ bài học dựa trên file (cms-data/lessons.json)
- CRUD bài học
- Lọc bài học (loại, ngôn ngữ, mức, xuất bản, tìm kiếm)
- Slug routing duy nhất
- Component tải hình ảnh
- Component form bài học
- Chỉnh sửa bài học (`/cms/[id]/edit`)
- Tạo bài học mới (`/cms/new`)

### API Routes (Frontend)
```
GET|POST         /api/cms/lessons
GET|PATCH|DELETE /api/cms/lessons/[id]
POST             /api/cms/upload
POST             /api/cms/upload-audio
```

> **Cấu hình bắt buộc:** các route proxy CMS cần `CMS_BACKEND_URL` trỏ tới API NestJS
> (ví dụ `http://localhost:3001/api/v1`). Mặc định trong `apps/web/.env.example` và
> một số route vẫn là `http://localhost:4000/api/v1`, không khớp cổng 3001 của API
> trong compose. Hãy đặt biến này trước khi chạy CMS, nếu không các yêu cầu
> bài học/upload sẽ bị từ chối kết nối.

### Trang Frontend
- `/cms` — Danh sách bài học CMS
- `/cms/new` — Tạo bài học mới
- `/cms/[id]/edit` — Chỉnh sửa bài học

---

## 23. Dịch vụ Email

### 23.1 Loại Email
- Email chào mừng (với CTA: "Bắt đầu học")
- Email xác thực (link hết hạn 24 giờ)
- Email đặt lại mật khẩu (link hết hạn 60 phút)
- Thông báo khóa tài khoản (cảnh báo bảo mật)
- Xác nhận đổi mật khẩu

### 23.2 Hạ tầng Email
- Nodemailer với SMTP cấu hình được
- Template HTML với gradient header thương hiệu
- Nút CTA với link
- Responsive design
- Chế độ development (không đặt `EMAIL_HOST`): email chỉ ghi log ra console,
  không gửi thật; xác thực email trong dev có thể thao tác trực tiếp bằng SQL.
  Production bắt buộc cấu hình `EMAIL_HOST`, `EMAIL_USER`, `EMAIL_PASS`.

---

## 24. Hệ thống Thông báo

### 24.1 Hạ tầng thông báo
- Model thông báo (tiêu đề, nội dung, loại, kênh, đã đọc, dữ liệu)
- Kênh: EMAIL, PUSH, IN_APP, WEB_PUSH
- Loại: SYSTEM, SECURITY, ACCOUNT, ORDER, PROMOTION
- Cài đặt thông báo theo user
- Đăng ký FCM token cho push
- Theo dõi đã đọc/chưa đọc

---

## 25. Trang Bảng giá (Pricing)

### 25.1 Gói token (mua một lần)
- Starter: 100 token — $0.99
- Basic: 500 token — $3.99
- Plus: 1.200 token — $7.99
- Pro: 3.000 token — $14.99

### 25.2 Token miễn phí
- Người dùng nhận 30 token miễn phí mỗi ngày (`FREE_DAILY_TOKENS`)
- Các tính năng AI (chat, writing, reading, grammar, quiz, speaking) trừ token
  theo bảng `COSTS` trong `apps/api/src/tokens/tokens.service.ts`

> Ứng dụng **không** bán gói đăng ký Pro/Premium theo tháng/năm; bảng giá là
> các gói token dùng một lần như liệt kê ở trên.

### Trang Frontend
- `/pricing` — Gói giá

---

## 26. Đa ngôn ngữ (i18n)

### 26.1 Ngôn ngữ hỗ trợ
- Tiếng Anh (en) — chính
- Tiếng Việt (vi)
- Tiếng Nhật (ja)
- Tiếng Hàn (ko)
- Tiếng Trung (zh)

### 26.2 Hạ tầng i18n
- Component chuyển đổi ngôn ngữ (sidebar)
- LanguageHydration provider
- Zustand language store
- Bản dịch đầy đủ cho tất cả UI text

---

## 27. Chế độ Tối / Giao diện

### 27.1 Tính năng giao diện
- Tích hợp next-themes
- Tự động phát hiện sở thích hệ thống
- Chuyển đổi sáng/tối dựa trên class
- Chuyển đổi mượt mà
- ThemeProvider

---

## 28. Trang chủ (Landing Page)

### 28.1 Nội dung trang chủ
- Hero: "Học Ngôn ngữ Thông minh hơn với AI"
- Badge: "Powered by Local AI - 100% Private"
- Tính năng nổi bật: Flashcard thông minh, Đánh giá viết, Gia sư AI, Luyện đọc, Ngữ pháp, Quiz
- Thống kê: Module học, Ngôn ngữ, Mô hình AI, Bảo mật
- CTA: "Bắt đầu học miễn phí"

### Trang Frontend
- `/` (trang gốc)

---

## 29. AI Service (Python FastAPI, Port 8000)

### 29.1 API Endpoints

| Endpoint | Mô tả |
|---|---|
| `POST /ai/chat` | Chat với gia sư AI (đồng bộ) |
| `POST /ai/chat/stream` | Chat với gia sư AI (SSE stream) |
| `POST /ai/writing/assess` | Đánh giá viết với phát hiện lỗi |
| `POST /ai/grammar/explain` | Giải thích ngữ pháp với bài tập |
| `POST /ai/reading/generate` | Tạo bài đọc với câu hỏi |
| `POST /ai/content/generate-cards` | Tạo flashcard từ văn bản |
| `POST /ai/content/generate-quiz-questions` | Tạo câu hỏi quiz từ chủ đề |
| `POST /ai/nlp/analyze` | Phân tích NLP (readability, CEFR, từ khóa) |
| `POST /ai/errors/analyze` | Phân tích mẫu lỗi với bài tập |
| `GET /health` | Kiểm tra sức khỏe |
| `GET /ready` | Kiểm tra sẵn sàng (LLM) |

### 29.2 Hạ tầng AI
- FastAPI với Pydantic validation
- Groq SDK (model llama-3.3-70b-versatile)
- Xác thực API key (X-API-Key header)
- Rate limiting (20 request/phút/endpoint)
- Input sanitization (bọc user input trong `<user_input>`)
- JSON prompt response cấu trúc
- Response caching
- 7 file prompt template theo domain
- CORS configuration

---

## 30. Hạ tầng & DevOps

### 30.1 Docker Services

| Service | Image | Port | Mục đích |
|---|---|---|---|
| `postgres` | postgres:16-alpine | 5432 | Cơ sở dữ liệu chính |
| `redis` | redis:7-alpine | 6379 | Cache, session, rate limiting |
| `api` | Custom NestJS | 3001 | Backend API |
| `web` | Custom Next.js | 3000 | Frontend web |
| `ai` | Custom FastAPI | 8000 | AI microservice |

### 30.2 Hạ tầng Build
- Turborepo monorepo với pnpm workspaces
- Docker build multi-stage
- Giới hạn memory mỗi container (256-512MB)
- Health checks cho postgres và redis
- Shared network (linguaai-net)
- Named volumes cho dữ liệu

### 30.3 Lệnh Development
```bash
pnpm dev              # Khởi động tất cả services
pnpm dev:api          # NestJS backend
pnpm dev:web          # Next.js frontend
pnpm dev:ai           # Python AI service
pnpm build            # Build tất cả
pnpm db:generate      # Generate Prisma client
pnpm db:migrate       # Chạy migrations
pnpm db:seed          # Seed data
pnpm docker:dev       # Khởi động hạ tầng
pnpm lint             # Lint tất cả packages
pnpm type-check       # TypeScript check
pnpm test             # Chạy tests
pnpm clean            # Xóa build artifacts
```

---

## 31. Mô hình Dữ liệu (Prisma Schema)

### 31.1 Models cốt lõi

| Model | Mục đích | Trường chính |
|---|---|---|
| `users` | Tài khoản người dùng | email, password, profile, gamification (streak, XP, goals), language preferences |
| `roles` | Vai trò | name (ADMIN, USER, MODERATOR) |
| `user_roles` | Gán vai trò | Composite PK |

### 31.2 Models xác thực

| Model | Mục đích |
|---|---|
| `refresh_tokens` | JWT refresh tokens với device tracking |
| `oauth_accounts` | Liên kết Google/GitHub OAuth |
| `mfa_secrets` | TOTP secrets (mã hóa) + backup codes |
| `user_devices` | Theo dõi thiết bị đăng ký |
| `login_attempts` | Log lần đăng nhập |
| `login_history` | Lịch sử sự kiện đăng nhập |
| `audit_logs` | Audit trail bảo mật |
| `verification_tokens` | Token xác thực email + đặt lại mật khẩu |
| `password_history` | Ngăn tái sử dụng mật khẩu |
| `security_questions` | Câu hỏi bảo mật |
| `device_fingerprints` | Nhận diện thiết bị |
| `notifications` | Thông báo người dùng |

### 31.3 Models học tập

| Model | Mục đích | Trường chính |
|---|---|---|
| `decks` | Bộ flashcard | title, language, level, is_public, card_count |
| `cards` | Flashcard | front_text, back_text, ipa_pronunciation, audio_url, example_sentence, image_url |
| `user_card_progress` | SRS tracking mỗi user-card | ease_factor, difficulty, interval_days, repetition_count, next_review_date |
| `review_sessions` | Phiên học | cards_reviewed, cards_correct, duration_seconds |
| `writing_submissions` | Bài viết | prompt_text, user_text, ai_feedback (JSON), score (JSON), language |
| `reading_passages` | Bài đọc | passage_text, vocabulary (JSON), questions (JSON), level, topic |
| `chat_conversations` | Hội thoại AI | title, user_id |
| `chat_messages` | Tin nhắn chat | role (user/assistant), content |
| `quizzes` | Quiz | title, description, deck_id, time_limit_minutes |
| `quiz_questions` | Câu hỏi quiz | question_text, question_type, options (JSON), correct_answer, explanation, difficulty |
| `quiz_attempts` | Lần làm quiz | score, total_questions, answers (JSON), duration_seconds |
| `user_streaks` | Streak hàng ngày | date, xp_earned, minutes_studied |
| `badges` | Huy hiệu thành tích | name, description, icon_url, condition (JSON) |
| `user_badges` | Huy hiệu đã đạt | Composite PK, earned_at |
| `content_items` | Nội dung CMS | type, title, title_vi, level, category, content, data, audio_url, published |

---

## 32. Shared Package

### 32.1 @linguaai/shared
- TypeScript types đồng bộ với Prisma schema enums
- Shared enums và constants
- Importable cho cả frontend và backend

---

## Tóm tắt tổng quan

| STT | Chức năng | Mô tả ngắn |
|---|---|---|
| 1 | Xác thực & Bảo mật | Đăng nhập/đăng ký, MFA, OAuth2, quản lý phiên/thiết bị, CAPTCHA, CSRF, rate limiting |
| 2 | Hồ sơ & Cài đặt | Profile, avatar, thông báo, quyền riêng tư |
| 3 | Flashcard | CRUD bộ bài/thẻ, AI tạo thẻ từ văn bản |
| 4 | SRS | SM-2 + FSRS-4.5, dashboard retention, dự báo 30 ngày |
| 5 | Quiz | MCQ/đúng-sai/điền khuyết, AI tạo quiz, quiz thích ứng |
| 6 | Luyện viết | AI đánh giá, phân tích lỗi, lịch sử |
| 7 | Luyện đọc | AI tạo bài đọc, phân tích NLP, gợi ý |
| 8 | Ngữ pháp | AI giải thích ngữ pháp với bài tập |
| 9 | Gia sư AI | Chat đa lượt, SSE streaming, quản lý hội thoại |
| 10 | Gợi ý học tập | Lộ trình cá nhân hóa dựa trên dữ liệu học |
| 11 | Thống kê & Gamification | XP, streak, leaderboard, badges, dashboard |
| 12 | Luyện nói | AI tạo chủ đề, nhận diện giọng nói, phân tích phát âm |
| 13 | Luyện nghe | Thư viện bài học với audio, câu hỏi hiểu |
| 14 | Luyện dịch | Dịch Việt-Anh với feedback tức thì |
| 15 | Từ vựng | Từ cá nhân + gói từ vựng CMS |
| 16 | Speed Review | Trò chơi ôn tập nhanh 60 giây |
| 17 | Từ khó | Tự nhận diện thẻ retention thấp |
| 18 | Mục tiêu hàng ngày | Theo dõi phút/từ/ôn tập mỗi ngày |
| 19 | Tiếng Trung | HSK, ngữ pháp, dịch, đọc |
| 20 | Tiếng Nhật | JLPT, ngữ pháp, dịch, đọc |
| 21 | Admin | Dashboard, quản lý user, quản lý nội dung |
| 22 | CMS | CRUD nội dung, bài học, upload hình ảnh |
| 23 | Email | Chào mừng, xác thực, reset mật khẩu, bảo mật |
| 24 | Thông báo | Email, push, in-app, web push |
| 25 | Bảng giá | Free, Pro, Premium với so sánh |
| 26 | Đa ngôn ngữ | EN, VI, JA, KO, ZH |
| 27 | Dark Mode | Sáng/tối tự động |
| 28 | Landing Page | Trang chủ giới thiệu |
| 29 | AI Service | FastAPI + Groq LLM, 10 endpoints |
| 30 | DevOps | Docker, Turborepo, PostgreSQL, Redis |
