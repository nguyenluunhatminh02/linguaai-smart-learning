# Hướng dẫn Cài đặt & Vận hành Hệ thống LinguaAI

Tài liệu này là hướng dẫn duy nhất và đầy đủ nhất giúp bạn cài đặt, cấu hình biến môi trường, vận hành cơ sở dữ liệu và khởi động hệ thống **LinguaAI** (bao gồm NestJS backend, Next.js frontend, và AI Microservice FastAPI) từ đầu sau khi giải nén gói mã nguồn đính kèm.

---

## 📋 Yêu cầu hệ thống (Prerequisites)

| Công cụ | Phiên bản tối thiểu | Ghi chú |
|---------|---------------------|---------|
| **Node.js** | 20+ LTS | Khuyên dùng Node.js 20.x |
| **pnpm** | 9+ | Trình quản lý gói monorepo (`npm i -g pnpm@9`) |
| **Python** | 3.12+ | Cần thiết để khởi chạy AI Microservice |
| **Docker & Compose** | 24+ | Để chạy nhanh cơ sở dữ liệu & Redis qua container |
| **PostgreSQL** | 16 | (Nếu cài đặt cục bộ, không dùng qua Docker) |
| **Redis** | 7 | (Nếu cài đặt cục bộ, không dùng qua Docker) |

---

## 🚀 Các bước cài đặt chi tiết

### Bước 1: Giải nén mã nguồn và di chuyển vào thư mục gốc

Dự án được cung cấp dưới dạng file nén `.zip`. Hãy giải nén và truy cập vào thư mục gốc:

#### Trên Windows (PowerShell)
```powershell
# Giải nén file zip (thay <tên-file.zip> bằng tên file thực tế)
Expand-Archive -Path "<tên-file.zip>" -DestinationPath "."

# Di chuyển vào thư mục gốc dự án
cd "Development of a Smart Language Learning Platform Integrated with Large Language Models and Spaced Repetition Algorithms"
```

#### Trên macOS / Linux
```bash
# Giải nén file zip
unzip <tên-file.zip>

# Di chuyển vào thư mục gốc dự án
cd "Development of a Smart Language Learning Platform Integrated with Large Language Models and Spaced Repetition Algorithms"
```

> **Lưu ý:** Sau khi giải nén, đảm bảo bạn đang đứng trong thư mục gốc của dự án (nơi chứa file `package.json`, `turbo.json`, `pnpm-workspace.yaml`) trước khi thực hiện các bước tiếp theo.

### Bước 2: Kiểm tra & Cập nhật biến môi trường (`.env`)

> **Các file `.env` đã được đính kèm sẵn trong gói ZIP.** Bạn **không cần tạo lại** từ đầu. Chỉ cần mở từng file và **điền `GROQ_API_KEY` của bạn** (lấy miễn phí tại [https://console.groq.com](https://console.groq.com)) vào các vị trí được đánh dấu bên dưới.

Dưới đây là danh sách các file cấu hình và các biến cần chú ý:

#### 1. Backend API — `apps/api/.env`
Mở file, tìm và thay thế dòng `GROQ_API_KEY`:
```env
# Groq LLM — ⚠️ Thay bằng API key thực của bạn (https://console.groq.com)
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxx   ← THAY THẾ DÒNG NÀY
GROQ_MODEL=llama-3.3-70b-versatile
```
> Các biến còn lại (Database, Redis, JWT, Port...) đã được cấu hình sẵn đúng cho môi trường local, **không cần sửa**.

#### 2. Frontend Next.js — `apps/web/.env.local`
Mở file, tìm và thay thế dòng `GROQ_API_KEY`:
```env
# Groq API Key — ⚠️ Thay bằng API key thực của bạn
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxx   ← THAY THẾ DÒNG NÀY
GROQ_MODEL=llama-3.3-70b-versatile
```

#### 3. AI FastAPI Service — `apps/ai-service/.env`
Mở file, tìm và thay thế dòng `GROQ_API_KEY`:
```env
# ⚠️ Thay bằng API key thực của bạn
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxx   ← THAY THẾ DÒNG NÀY
GROQ_MODEL=llama-3.3-70b-versatile
AI_SERVICE_API_KEYS=dev-api-key-12345
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
DEBUG=true
```

#### 4. Docker Infrastructure — `docker/.env`
File này **không cần chỉnh sửa**, đã được cấu hình sẵn:
```env
POSTGRES_PASSWORD=linguaai_secret
REDIS_PASSWORD=redis_secret
```

> **Tóm lại:** Chỉ cần thay `GROQ_API_KEY` ở **3 file** trên là hệ thống sẵn sàng hoạt động hoàn toàn.

---

### Bước 3: Cài đặt Dependencies cho Monorepo
Từ thư mục gốc của dự án, chạy lệnh cài đặt duy nhất (Turborepo + pnpm workspaces sẽ tự động liên kết các thư viện của toàn bộ thư mục `apps/` và `packages/`):
```bash
pnpm install
```

---

### Bước 4: Khởi động cơ sở dữ liệu & Redis

#### Lựa chọn A: Sử dụng Docker Compose (Khuyên dùng)
Dự án đã đóng gói sẵn môi trường lưu trữ. Chạy lệnh sau tại thư mục gốc:
```bash
pnpm docker:dev
```
*Lệnh này sẽ khởi động container PostgreSQL 16 tại cổng `5432` và Redis 7 tại cổng `6379` chạy ngầm.*

#### Lựa chọn B: Cài đặt thủ công cục bộ (Ví dụ qua Scoop trên Windows)
Nếu không chạy Docker, bạn có thể tự khởi động database của máy:
```powershell
scoop install postgresql redis
pg_ctl start
redis-server
```

---

### Bước 5: Khởi tạo dữ liệu và sinh Prisma Client

Sau khi PostgreSQL đã sẵn sàng kết nối, hãy tạo cấu trúc bảng và nạp dữ liệu mẫu bằng một trong hai cách:

#### Cách 1: Nạp file dump dữ liệu thực tế (Khuyên dùng để có đầy đủ bài học JLPT, HSK & từ vựng)
Dự án đi kèm tệp dump SQL chứa dữ liệu mẫu chuẩn [linguaai_data.sql](./linguaai_data.sql) tại thư mục gốc.
1. **Tạo Prisma Client**:
   ```bash
   pnpm db:generate
   ```
2. **Khôi phục dữ liệu**:
   * Trên **Windows (PowerShell)**:
     ```powershell
     # Đặt encoding session sang UTF-8 để tránh vỡ font tiếng Việt có dấu
     $OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::InputEncoding = [System.Text.Encoding]::UTF8; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
     Get-Content -Encoding utf8 linguaai_data.sql | docker exec -i linguaai-postgres psql -U linguaai -d linguaai
     ```
   * Trên **macOS / Linux**:
     ```bash
     docker exec -i linguaai-postgres psql -U linguaai -d linguaai < linguaai_data.sql
     ```

#### Cách 2: Khởi tạo database trống và Seed tự động
Nếu muốn dùng database trống hoặc tự động chạy migration:
1. **Tạo Prisma Client & Sinh bảng**:
   ```bash
   pnpm db:generate
   pnpm db:migrate
   ```
2. **Nạp dữ liệu mẫu cơ bản (Prisma Seed)**:
   ```bash
   pnpm db:seed
   ```
   *Lưu ý: Quá trình seed sẽ tự động nạp các gói từ vựng mẫu (gồm các bộ từ vựng JLPT N5–N1 của tiếng Nhật và HSK 1–6 của tiếng Trung) đồng thời nạp trọn bộ 5 bài học dịch mẫu tiếng Anh (A1-C1). Tất cả dữ liệu từ vựng và tiến trình ôn tập SRS của người dùng hiện được đồng bộ trực tiếp vào cơ sở dữ liệu thay vì lưu trữ tạm thời in-memory.*

---

### Bước 6: Thiết lập môi trường Python cho AI Service (FastAPI)

1. Di chuyển vào thư mục AI Service:
   ```bash
   cd apps/ai-service
   ```
2. Khởi tạo và kích hoạt môi trường ảo Python (`venv`):
   ```bash
   python -m venv .venv
   ```
   * **Kích hoạt trên Windows (PowerShell)**:
     ```powershell
     .\.venv\Scripts\Activate.ps1
     ```
   * **Kích hoạt trên macOS / Linux**:
     ```bash
     source .venv/bin/activate
     ```
3. Cài đặt các thư viện phụ thuộc:
   ```bash
   pip install -r requirements.txt
   ```
4. Quay trở về thư mục gốc:
   ```bash
   cd ../..
   ```

---

## 🏃 Chạy ứng dụng ở chế độ Development

Từ thư mục gốc của dự án, bạn có thể chạy đồng thời tất cả các dịch vụ (NestJS + Next.js + FastAPI) bằng một lệnh duy nhất:
```bash
pnpm dev
```

Nếu muốn chạy riêng lẻ từng dịch vụ để debug dễ dàng hơn:
* **Chỉ chạy Backend NestJS API (cổng 3001)**:
  ```bash
  pnpm dev:api
  ```
* **Chỉ chạy Frontend Next.js App (cổng 3000)**:
  ```bash
  pnpm dev:web
  ```
* **Chỉ chạy AI Microservice FastAPI (cổng 8000)**:
  ```bash
  pnpm dev:ai
  ```

---

## 🏗️ Đóng gói ứng dụng (Build for Production)

Để đóng gói (build) ứng dụng cho môi trường sản xuất (production), chạy lệnh sau tại thư mục gốc:
```bash
pnpm build
```
*Lệnh này sử dụng Turborepo để tự động tối ưu hóa và build song song toàn bộ các dự án Node.js/TypeScript bao gồm Next.js frontend (`apps/web`), NestJS backend (`apps/api`), và shared package (`packages/shared`).*

### Tại sao AI Microservice không có trong `pnpm build`?

**Python là ngôn ngữ thông dịch** — không có bước compile hay tạo bundle như TypeScript. `apps/ai-service` chạy trực tiếp từ mã nguồn `.py` mà không cần sinh ra thư mục `dist/`. Do đó Turborepo bỏ qua service này trong lệnh build — đây là hoàn toàn bình thường.

### So sánh lệnh Dev vs Production cho AI Service

| | Development | Production |
|--|-------------|------------|
| **Lệnh** | `uvicorn app.main:app --reload --port 8000` | `uvicorn app.main:app --port 8000` |
| **Khác biệt** | Có `--reload` → tự restart khi sửa file | Không có `--reload` → ổn định, hiệu năng tốt hơn |
| **Dùng khi** | Đang phát triển, debug | Demo, chấm điểm, triển khai |

Để khởi động ứng dụng sau khi đã build:
* **Chạy NestJS backend (API)**:
  ```bash
  pnpm --filter api start:prod
  ```
* **Chạy Next.js frontend (Web)**:
  ```bash
  pnpm --filter web start
  ```
* **Chạy AI Microservice FastAPI (Production)**:
  ```bash
  cd apps/ai-service
  .venv\Scripts\Activate.ps1  # Windows
  # source .venv/bin/activate  # macOS / Linux
  uvicorn app.main:app --port 8000
  ```

---

## 🔗 Danh sách các cổng kết nối cục bộ
* **Frontend App**: [http://localhost:3000](http://localhost:3000)
* **Backend API Gateway**: [http://localhost:3001](http://localhost:3001)
* **Swagger API Documentation**: [http://localhost:3001/api/docs](http://localhost:3001/api/docs)
* **AI Microservice**: [http://localhost:8000](http://localhost:8000)
* **FastAPI Docs (AI)**: [http://localhost:8000/docs](http://localhost:8000/docs)

---

## 🔑 Tài khoản dùng thử (Test Accounts)

Sau khi phục hồi database hoặc chạy seed thành công, bạn có thể đăng nhập bằng các tài khoản kiểm thử sau:

### 1. Tài khoản Quản trị viên (Admin / Curator)
Quyền truy cập trang quản trị hệ thống, duyệt bài học, quản lý người dùng & nạp token:
* **Email:** `seed-curator@linguaai.local`
* **Mật khẩu:** `SeedCurator!2024`

### 2. Tài khoản Học viên (Learners)
Có sẵn lộ trình học tập, lịch sử biểu đồ hoạt động XP và streak:
* **Mật khẩu chung:** `TestUser!2024`
* **Danh sách tài khoản:**
  * **Học Tiếng Anh:** `nguyen.minh@linguaai.local` (USER, mật khẩu: `SeedUser!2024` hoặc `TestUser!2024`) hoặc `vo.an@linguaai.local` (MODERATOR)
  * **Học Tiếng Nhật (JLPT):** `tran.linh@linguaai.local` (USER)
  * **Học Tiếng Trung (HSK):** `le.hoa@linguaai.local` (USER)
  * **Học Tiếng Hàn (TOPIK):** `pham.duc@linguaai.local` (USER)

---

## 🧩 Lưu ý & Sửa lỗi thường gặp (Troubleshooting)

* **Lỗi "Validation failed" khi đăng ký tài khoản mới**: Mật khẩu bắt buộc phải có tối thiểu 8 ký tự, bao gồm ít nhất 1 chữ hoa, 1 chữ thường, 1 chữ số và 1 ký tự đặc biệt (`@$!%*?&`).
* **Lỗi "Please verify your email" khi đăng nhập**: Dự án ở chế độ phát triển (Dev) không gửi email thật. Hãy kiểm tra tab terminal đang chạy `pnpm dev:api` để lấy link kích hoạt tài khoản được in trực tiếp ra console.
* **Lỗi Rate Limit 429**: Dịch vụ có giới hạn số lượt request từ một địa chỉ IP. Vui lòng đợi 1 phút hoặc khởi động lại Redis.
* **Lỗi AI không phản hồi**: Vui lòng kiểm tra lại cấu hình `GROQ_API_KEY` trong các file `.env` đã chính xác chưa, và đảm bảo tài khoản Groq của bạn vẫn còn hạn mức sử dụng (quota).

---

## 🛠️ Các lệnh tiện ích monorepo

* **pnpm type-check**: Kiểm tra kiểu dữ liệu TypeScript toàn dự án.
* **pnpm build**: Đóng gói toàn bộ các dịch vụ để triển khai lên Production.
* **pnpm clean**: Xóa các thư mục build (`dist`, `.next`, `node_modules`) và cache để làm sạch dự án.
* **pnpm test**: Khởi chạy bộ kiểm thử tự động của dự án.
