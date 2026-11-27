# LinguaAI – Bộ sinh Báo cáo Đồ án (DOCX + PDF)

Bộ script tự động sinh báo cáo đồ án môn học cho dự án **LinguaAI** theo
chuẩn trình bày của Trường ĐH Công nghệ Thông tin – ĐHQG TP. HCM.

## Cấu trúc thư mục

```
baocao/
├── generate_docx.py         # Script sinh file DOCX chính (1 file = 1 báo cáo)
├── docx_to_pdf.py           # Convert DOCX → PDF (ưu tiên MS Word, fallback docx2pdf / LibreOffice)
├── build_report.bat         # Wrapper Windows: chạy cả 2 bước trên
├── LinguaAI_BaoCao_DoAn.docx
├── LinguaAI_BaoCao_DoAn.pdf
└── Nhom1_*.pdf              # File template tham khảo (do giảng viên cung cấp)
```

## Cách build

### Cách 1 – Một lệnh (khuyến nghị, chỉ Windows)

```bat
cd baocao
build_report.bat
```

Script sẽ tự cài `python-docx` + `pywin32`, sinh DOCX, rồi convert PDF
qua Microsoft Word (giữ nguyên định dạng + tự cập nhật trường PAGE).

### Cách 2 – Thủ công

```bash
# 1) Cài dependencies
pip install python-docx pywin32       # Windows
pip install python-docx docx2pdf       # macOS / Linux

# 2) Sinh DOCX
python generate_docx.py

# 3) Convert sang PDF
python docx_to_pdf.py
```

## Cấu trúc báo cáo (khớp chuẩn UIT)

1. **Trang bìa** – ĐHQG-HCM / UIT / Khoa CNPM / Tên đề tài / Nhóm SV / GVHD
2. **Trang nhận xét của GVHD** (có dòng kẻ trống để giảng viên viết)
3. **Lời cam đoan** *(đánh số La Mã: i)*
4. **Lời cảm ơn** *(ii)*
5. **Tóm tắt đồ án** – Tiếng Việt *(iii)*
6. **Abstract** – Tiếng Anh *(iv)*
7. **Mục lục** *(v–vi)*
8. **Danh mục bảng** *(vii)*
9. **Danh mục hình** *(viii)*
10. **Danh mục từ viết tắt** *(ix)*
11. **Đề cương chi tiết** *(đánh số Ả-Rập: 1)*
12. **Chương 1 – Tổng quan đề tài** *(4)*
13. **Chương 2 – Phân tích & thiết kế hệ thống** *(7)* — Use-case, Activity, Sequence, ERD
14. **Chương 3 – Mô tả giao diện** *(23)* — Người học + Quản trị viên
15. **Chương 4 – Kết quả dự án** *(34)*
16. **Chương 5 – Kết luận** *(36)* — Phân chia công việc, Ưu/nhược, Hướng phát triển
17. **Tài liệu tham khảo** *(40)*

## Tuỳ biến nhanh

Mở `generate_docx.py`, sửa các hằng ở đầu file (gần dòng 200):

```python
MEMBERS = [
    ("Nguyễn Văn An",  "21520123", "Trưởng nhóm"),  # ← đổi tên + MSSV thật
    ("Trần Thị Bình",  "21520456", "Thành viên"),
    ("Lê Văn Cường",   "21520789", "Thành viên"),
    ("Phạm Thị Dung",  "21520012", "Thành viên"),
]
GVHD = "TS. Nguyễn Văn Hướng Dẫn"     # ← tên thầy/cô GVHD
COURSE_NAME = "PHÁT TRIỂN ỨNG DỤNG WEB"
COURSE_CODE = "SE347"
SUBMIT_LOCATION = "TP. Hồ Chí Minh"
SUBMIT_MONTH_YEAR = "tháng 4 năm 2026"
```

Sau đó chạy lại `build_report.bat`.

## Sau khi sinh DOCX

Mở file `.docx` trong Microsoft Word, nhấn **Ctrl+A** → **F9** để Word
cập nhật toàn bộ trường (số trang trong footer, NUMPAGES tổng số trang).
Nếu dùng `build_report.bat` thì bước này đã được tự động hoá.

## Định dạng

- **Khổ giấy**: A4 (21 × 29.7 cm), lề 2.5 cm cả 4 cạnh.
- **Font**: Times New Roman, body 13pt, justify, line-spacing 1.15.
- **Heading**: Calibri Bold, màu xanh `#1F497D` (level 1) / `#2E74B5` (level 2).
- **Bảng**: header xanh đậm chữ trắng, viền nhạt, alt-row nhạt.
- **Header**: "LinguaAI – Báo cáo đồ án môn học" (in nghiêng, viền dưới).
- **Footer**: "Trang X / Y" (canh giữa).
- **Đánh số trang**: trang bìa + nhận xét **không số**, phần đầu La Mã (i, ii…),
  phần thân Ả-Rập (1, 2…).
