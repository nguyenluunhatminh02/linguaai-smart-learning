"""
Generate PDF report for LinguaAI project
Format based on: Nhom1_21520385_21520203_21521998_21522170.pdf
"""

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable, KeepTogether
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import os

# ─── Register fonts ───────────────────────────────────────────────────────────
# Standalone ReportLab generator: fonts are discovered portably on
# Windows/macOS/Linux. ReportLab's built-in Helvetica family is the fallback
# when no TTF is installed, so this script no longer fails at import time.
FONT_CANDIDATES = {
    "Arial": [
        "C:/Windows/Fonts/arial.ttf",
        "/Library/Fonts/Arial.ttf",
        "/usr/share/fonts/truetype/msttcorefonts/Arial.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ],
    "Arial-Bold": [
        "C:/Windows/Fonts/arialbd.ttf",
        "/Library/Fonts/Arial Bold.ttf",
        "/usr/share/fonts/truetype/msttcorefonts/Arial_Bold.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ],
    "Arial-Italic": [
        "C:/Windows/Fonts/ariali.ttf",
        "/Library/Fonts/Arial Italic.ttf",
        "/usr/share/fonts/truetype/msttcorefonts/Arial_Italic.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Italic.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf",
    ],
    "Arial-BoldItalic": [
        "C:/Windows/Fonts/arialbi.ttf",
        "/Library/Fonts/Arial Bold Italic.ttf",
        "/usr/share/fonts/truetype/msttcorefonts/Arial_BoldItalic.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-BoldItalic.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf",
    ],
}
FALLBACK_FONTS = {
    "Arial": "Helvetica",
    "Arial-Bold": "Helvetica-Bold",
    "Arial-Italic": "Helvetica-Oblique",
    "Arial-BoldItalic": "Helvetica-BoldOblique",
}


def _register_fonts():
    """Register fonts under the logical Arial* names used by the styles."""
    resolved = {}
    for font_name, candidates in FONT_CANDIDATES.items():
        for path in candidates:
            if not os.path.isfile(path):
                continue
            try:
                pdfmetrics.registerFont(TTFont(font_name, path))
                resolved[font_name] = font_name
                break
            except Exception:
                # Skip corrupt/unsupported TTFs and try the next candidate.
                continue
        if font_name not in resolved:
            resolved[font_name] = FALLBACK_FONTS[font_name]
    pdfmetrics.registerFontFamily(
        "Arial",
        normal=resolved["Arial"],
        bold=resolved["Arial-Bold"],
        italic=resolved["Arial-Italic"],
        boldItalic=resolved["Arial-BoldItalic"],
    )
    return resolved


FONT_NAMES = _register_fonts()

# ─── Styles ───────────────────────────────────────────────────────────────────
PAGE_W, PAGE_H = A4
MARGIN = 2.5 * cm

def make_styles():
    styles = {}

    styles["Normal"] = ParagraphStyle(
        "Normal", fontName=FONT_NAMES["Arial"], fontSize=12, leading=18,
        alignment=TA_JUSTIFY, spaceAfter=6,
    )
    styles["CenterNormal"] = ParagraphStyle(
        "CenterNormal", fontName=FONT_NAMES["Arial"], fontSize=12, leading=18,
        alignment=TA_CENTER, spaceAfter=6,
    )
    styles["Bold"] = ParagraphStyle(
        "Bold", fontName=FONT_NAMES["Arial-Bold"], fontSize=12, leading=18,
        alignment=TA_JUSTIFY, spaceAfter=6,
    )
    styles["Title"] = ParagraphStyle(
        "Title", fontName=FONT_NAMES["Arial-Bold"], fontSize=16, leading=22,
        alignment=TA_CENTER, spaceAfter=10,
    )
    styles["H1"] = ParagraphStyle(
        "H1", fontName=FONT_NAMES["Arial-Bold"], fontSize=14, leading=20,
        alignment=TA_LEFT, spaceBefore=14, spaceAfter=8,
    )
    styles["H2"] = ParagraphStyle(
        "H2", fontName=FONT_NAMES["Arial-Bold"], fontSize=13, leading=18,
        alignment=TA_LEFT, spaceBefore=10, spaceAfter=6,
    )
    styles["H3"] = ParagraphStyle(
        "H3", fontName=FONT_NAMES["Arial-Bold"], fontSize=12, leading=16,
        alignment=TA_LEFT, spaceBefore=8, spaceAfter=4,
    )
    styles["TOC"] = ParagraphStyle(
        "TOC", fontName=FONT_NAMES["Arial"], fontSize=11, leading=16,
        alignment=TA_LEFT, spaceAfter=4,
    )
    styles["TOCBold"] = ParagraphStyle(
        "TOCBold", fontName=FONT_NAMES["Arial-Bold"], fontSize=11, leading=16,
        alignment=TA_LEFT, spaceAfter=4,
    )
    styles["SmallCenter"] = ParagraphStyle(
        "SmallCenter", fontName=FONT_NAMES["Arial"], fontSize=10, leading=14,
        alignment=TA_CENTER, spaceAfter=4,
    )
    styles["PageNum"] = ParagraphStyle(
        "PageNum", fontName=FONT_NAMES["Arial"], fontSize=11, leading=14,
        alignment=TA_CENTER,
    )
    styles["Italic"] = ParagraphStyle(
        "Italic", fontName=FONT_NAMES["Arial-Italic"], fontSize=11, leading=16,
        alignment=TA_CENTER, spaceAfter=4,
    )
    return styles


def table_style_default():
    return TableStyle([
        ("FONTNAME", (0, 0), (-1, 0), FONT_NAMES["Arial-Bold"]),
        ("FONTNAME", (0, 1), (-1, -1), FONT_NAMES["Arial"]),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("LEADING", (0, 0), (-1, -1), 14),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#4472C4")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("ALIGN", (0, 0), (-1, 0), "CENTER"),
        ("ALIGN", (0, 1), (0, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#DDEEFF")]),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ])


# ─── Page numbering ───────────────────────────────────────────────────────────
class NumberedCanvas:
    """Mixin to draw page numbers via DocTemplate callbacks."""
    pass


def on_page(canvas, doc):
    canvas.saveState()
    canvas.setFont(FONT_NAMES["Arial"], 10)
    canvas.drawCentredString(PAGE_W / 2, 1.2 * cm, str(doc.page))
    canvas.restoreState()


# ─── Build document ───────────────────────────────────────────────────────────
OUTPUT = os.path.join(
    os.path.dirname(__file__),
    "LinguaAI_BaoCao_ReportLab.pdf"
)

def build():
    S = make_styles()
    doc = SimpleDocTemplate(
        OUTPUT,
        pagesize=A4,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN,
        bottomMargin=MARGIN + 0.5 * cm,
    )
    story = []
    W = PAGE_W - 2 * MARGIN

    def p(text, style="Normal"):
        return Paragraph(text, S[style])

    def sp(h=0.3):
        return Spacer(1, h * cm)

    def hr():
        return HRFlowable(width="100%", thickness=1, color=colors.HexColor("#4472C4"))

    # ══════════════════════════════════════════════════════════════════════════
    # PAGE 1 – BÌA
    # ══════════════════════════════════════════════════════════════════════════
    story += [
        sp(2),
        p("TRƯỜNG ĐẠI HỌC CÔNG NGHỆ THÔNG TIN", "Title"),
        p("KHOA CÔNG NGHỆ PHẦN MỀM", "Title"),
        sp(0.5),
        hr(),
        sp(1.5),
        p("PHÁT TRIỂN ỨNG DỤNG WEB", "Title"),
        sp(2),
        p("ĐỀ TÀI:", "CenterNormal"),
        sp(0.3),
        p("<b>XÂY DỰNG NỀN TẢNG HỌC NGÔN NGỮ THÔNG MINH<br/>TÍCH HỢP MÔ HÌNH NGÔN NGỮ LỚN<br/>VÀ THUẬT TOÁN LẶP LẠI CÓ KHOẢNG CÁCH</b>", "Title"),
        sp(2),
        p("GVHD: ThS. Mai Xuân Hùng", "CenterNormal"),
        sp(1),
        p("<b>Nhóm sinh viên thực hiện:</b>", "CenterNormal"),
        sp(0.4),
        p("Trần Ngọc Tố Như (MSSV: 21520385) – Trưởng nhóm", "CenterNormal"),
        p("Lê Thùy Dương (MSSV: 21520203) – Thành viên", "CenterNormal"),
        p("Trần Thanh Huy (MSSV: 21522170) – Thành viên", "CenterNormal"),
        p("Mai Trần Khương Duy (MSSV: 21521998) – Thành viên", "CenterNormal"),
        sp(2),
        p("TP. HCM, tháng 4 năm 2026", "CenterNormal"),
        PageBreak(),
    ]

    # ══════════════════════════════════════════════════════════════════════════
    # PAGE 2 – NHẬN XÉT GIÁO VIÊN
    # ══════════════════════════════════════════════════════════════════════════
    story += [
        p("NHẬN XÉT CỦA GIÁO VIÊN HƯỚNG DẪN", "Title"),
        sp(1),
    ]
    for _ in range(18):
        story += [
            p("." * 120, "Normal"),
            sp(0.1),
        ]
    story += [
        sp(1),
        p("……., ngày……...tháng……năm 2026", "CenterNormal"),
        sp(0.5),
        p("<b>Người nhận xét</b>", "CenterNormal"),
        sp(0.3),
        p("<i>(Ký tên và ghi rõ họ tên)</i>", "Italic"),
        PageBreak(),
    ]

    # ══════════════════════════════════════════════════════════════════════════
    # PAGE 3 – MỤC LỤC
    # ══════════════════════════════════════════════════════════════════════════
    def toc_entry(text, page, indent=0, bold=False):
        pad = "\u00a0" * (indent * 4)
        style = "TOCBold" if bold else "TOC"
        dots = " " + "." * max(1, 80 - len(text) - indent * 4) + " "
        return p(f"{pad}{text}{dots}{page}", style)

    story += [
        p("MỤC LỤC", "Title"),
        sp(0.3),
        toc_entry("MỤC LỤC", 3, bold=True),
        toc_entry("DANH MỤC BẢNG", 5, bold=True),
        toc_entry("DANH MỤC HÌNH", 6, bold=True),
        toc_entry("LỜI CẢM ƠN", 8, bold=True),
        toc_entry("ABSTRACT", 9, bold=True),
        toc_entry("ĐỀ CƯƠNG CHI TIẾT", 10, bold=True),
        toc_entry("CHƯƠNG 1. TỔNG QUAN ĐỀ TÀI", 13, bold=True),
        toc_entry("1.1. Nhu cầu thực tế của đề tài", 13, indent=1),
        toc_entry("1.2. Khảo sát hiện trạng", 14, indent=1),
        toc_entry("1.3. Phát biểu bài toán", 15, indent=1),
        toc_entry("CHƯƠNG 2. PHÂN TÍCH VÀ THIẾT KẾ HỆ THỐNG", 16, bold=True),
        toc_entry("2.1. Xác định và mô hình hóa yêu cầu phần mềm", 16, indent=1),
        toc_entry("2.1.1. Danh sách Actor", 16, indent=2),
        toc_entry("2.1.2. Danh sách Use-case", 16, indent=2),
        toc_entry("2.2. Sơ đồ Use-cases", 18, indent=1),
        toc_entry("2.3. Sơ đồ Activity", 19, indent=1),
        toc_entry("2.4. Sơ đồ Sequence", 22, indent=1),
        toc_entry("2.5. Thiết kế cơ sở dữ liệu", 25, indent=1),
        toc_entry("CHƯƠNG 3. MÔ TẢ GIAO DIỆN", 32, bold=True),
        toc_entry("3.1. Giao diện người học", 32, indent=1),
        toc_entry("3.2. Giao diện quản trị viên", 40, indent=1),
        toc_entry("CHƯƠNG 4. KẾT QUẢ DỰ ÁN", 43, bold=True),
        toc_entry("4.1. Giới thiệu sản phẩm", 43, indent=1),
        toc_entry("4.2. Môi trường triển khai", 44, indent=1),
        toc_entry("4.3. Kết luận kết quả", 44, indent=1),
        toc_entry("CHƯƠNG 5. KẾT LUẬN", 45, bold=True),
        toc_entry("5.1. Bảng phân chia công việc", 45, indent=1),
        toc_entry("5.2. Ưu điểm và nhược điểm", 46, indent=1),
        toc_entry("5.3. Hướng phát triển", 47, indent=1),
        PageBreak(),
    ]

    # ══════════════════════════════════════════════════════════════════════════
    # PAGE 5 – DANH MỤC BẢNG
    # ══════════════════════════════════════════════════════════════════════════
    story += [
        p("DANH MỤC BẢNG", "Title"),
        sp(0.3),
    ]
    bang_list = [
        ("Bảng 2.1.1", "Danh sách Actor", "16"),
        ("Bảng 2.1.2", "Danh sách Use-case – Quản trị viên", "16"),
        ("Bảng 2.1.3", "Danh sách Use-case – Người học", "17"),
        ("Bảng 2.5.1", "Bảng users", "25"),
        ("Bảng 2.5.2", "Bảng decks", "26"),
        ("Bảng 2.5.3", "Bảng cards", "27"),
        ("Bảng 2.5.4", "Bảng user_card_progress", "27"),
        ("Bảng 2.5.5", "Bảng review_sessions", "28"),
        ("Bảng 2.5.6", "Bảng quizzes", "28"),
        ("Bảng 2.5.7", "Bảng quiz_questions", "29"),
        ("Bảng 2.5.8", "Bảng quiz_attempts", "29"),
        ("Bảng 2.5.9", "Bảng writing_submissions", "30"),
        ("Bảng 2.5.10", "Bảng reading_passages", "30"),
        ("Bảng 2.5.11", "Bảng chat_conversations", "31"),
        ("Bảng 2.5.12", "Bảng chat_messages", "31"),
        ("Bảng 2.5.13", "Bảng user_streaks", "31"),
        ("Bảng 2.5.14", "Bảng badges và user_badges", "32"),
        ("Bảng 3.1.1", "Mô tả màn hình trang chủ Dashboard", "32"),
        ("Bảng 3.1.2", "Mô tả màn hình quản lý Deck", "33"),
        ("Bảng 3.1.3", "Mô tả màn hình ôn tập SRS", "34"),
        ("Bảng 3.1.4", "Mô tả màn hình làm Quiz", "35"),
        ("Bảng 3.1.5", "Mô tả màn hình luyện viết AI", "36"),
        ("Bảng 3.1.6", "Mô tả màn hình luyện đọc AI", "37"),
        ("Bảng 3.1.7", "Mô tả màn hình AI Chat Tutor", "38"),
        ("Bảng 3.2.1", "Mô tả màn hình quản lý người dùng", "40"),
        ("Bảng 3.2.2", "Mô tả màn hình thống kê hệ thống", "41"),
        ("Bảng 5.1.1", "Bảng đánh giá phân chia công việc", "45"),
    ]
    for num, title, page in bang_list:
        dots = "." * max(1, 75 - len(num) - len(title) - len(page))
        story.append(p(f"{num} {title} {dots} {page}", "TOC"))
    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════════════════
    # PAGE 6 – DANH MỤC HÌNH
    # ══════════════════════════════════════════════════════════════════════════
    story += [
        p("DANH MỤC HÌNH", "Title"),
        sp(0.3),
    ]
    hinh_list = [
        ("Hình 2.2.1", "Sơ đồ Use-case tổng quát", "18"),
        ("Hình 2.2.2", "Sơ đồ Use-case chi tiết của Quản trị viên", "18"),
        ("Hình 2.2.3", "Sơ đồ Use-case chi tiết của Người học", "19"),
        ("Hình 2.3.1", "Sơ đồ hoạt động – Đăng nhập / Đăng ký", "19"),
        ("Hình 2.3.2", "Sơ đồ hoạt động – Quản lý Deck & Flashcard", "20"),
        ("Hình 2.3.3", "Sơ đồ hoạt động – Ôn tập SRS", "20"),
        ("Hình 2.3.4", "Sơ đồ hoạt động – Làm Quiz", "21"),
        ("Hình 2.3.5", "Sơ đồ hoạt động – Luyện viết AI", "21"),
        ("Hình 2.3.6", "Sơ đồ hoạt động – Luyện đọc AI", "22"),
        ("Hình 2.3.7", "Sơ đồ hoạt động – AI Chat Tutor", "22"),
        ("Hình 2.4.1", "Sơ đồ tuần tự – Đăng nhập", "22"),
        ("Hình 2.4.2", "Sơ đồ tuần tự – Đăng ký", "23"),
        ("Hình 2.4.3", "Sơ đồ tuần tự – Tạo và quản lý Deck", "23"),
        ("Hình 2.4.4", "Sơ đồ tuần tự – Ôn tập SRS (SM-2/FSRS)", "24"),
        ("Hình 2.4.5", "Sơ đồ tuần tự – Tạo Quiz và làm bài", "24"),
        ("Hình 2.4.6", "Sơ đồ tuần tự – AI Writing Feedback", "24"),
        ("Hình 2.4.7", "Sơ đồ tuần tự – AI Reading Passage", "25"),
        ("Hình 2.4.8", "Sơ đồ tuần tự – AI Chat Tutor", "25"),
        ("Hình 3.1.1", "Màn hình giao diện trang đăng nhập", "32"),
        ("Hình 3.1.2", "Màn hình giao diện Dashboard", "32"),
        ("Hình 3.1.3", "Màn hình giao diện quản lý Deck", "33"),
        ("Hình 3.1.4", "Màn hình giao diện ôn tập SRS Flashcard", "34"),
        ("Hình 3.1.5", "Màn hình giao diện làm Quiz", "35"),
        ("Hình 3.1.6", "Màn hình giao diện luyện viết AI", "36"),
        ("Hình 3.1.7", "Màn hình giao diện luyện đọc AI", "37"),
        ("Hình 3.1.8", "Màn hình giao diện AI Chat Tutor", "38"),
        ("Hình 3.1.9", "Màn hình giao diện phân tích học tập", "39"),
        ("Hình 3.2.1", "Màn hình giao diện quản lý người dùng", "40"),
        ("Hình 3.2.2", "Màn hình giao diện thống kê hệ thống", "41"),
        ("Hình 3.2.3", "Màn hình giao diện quản lý nội dung CMS", "42"),
    ]
    for num, title, page in hinh_list:
        dots = "." * max(1, 75 - len(num) - len(title) - len(page))
        story.append(p(f"{num} {title} {dots} {page}", "TOC"))
    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════════════════
    # PAGE 8 – LỜI CẢM ƠN
    # ══════════════════════════════════════════════════════════════════════════
    story += [
        p("LỜI CẢM ƠN", "Title"),
        sp(0.5),
        p(
            "Trên thực tế không có sự thành công nào mà không gắn liền với những sự hỗ trợ, "
            "giúp đỡ dù ít hay nhiều, dù trực tiếp hay gián tiếp của người khác. Trong suốt "
            "học kỳ này khi bắt đầu làm đồ án môn Phát triển Ứng dụng Web, nhóm em đã nhận "
            "được rất nhiều sự quan tâm, giúp đỡ của quý thầy cô, các anh chị khóa trên và "
            "bạn bè trong và ngoài lớp."
        ),
        sp(0.3),
        p(
            "Với lòng biết ơn sâu sắc nhất, nhóm em xin chân thành cảm ơn giảng viên hướng "
            "dẫn đã tận tâm hướng dẫn chúng em qua từng buổi học trên lớp, giải đáp kịp thời "
            "các thắc mắc của chúng em. Nếu không có những lời hướng dẫn tận tình của thầy "
            "thì chắc chắn bài báo cáo của nhóm sẽ rất khó để hoàn thành được."
        ),
        sp(0.3),
        p(
            "Đề tài được xây dựng trong vòng một học kỳ do vậy không tránh khỏi những thiếu "
            "sót là điều chắc chắn. Nhóm em rất mong nhận được những ý kiến đóng góp quý báu "
            "của thầy để cho ứng dụng cũng như kiến thức của nhóm em được hoàn thiện hơn."
        ),
        sp(0.3),
        p(
            "Sau cùng, kính chúc thầy thật dồi dào sức khỏe, niềm tin để tiếp tục thực hiện "
            "sứ mệnh cao đẹp của mình là truyền đạt kiến thức cho thế hệ mai sau."
        ),
        PageBreak(),
    ]

    # ══════════════════════════════════════════════════════════════════════════
    # PAGE 9 – ABSTRACT
    # ══════════════════════════════════════════════════════════════════════════
    story += [
        p("ABSTRACT", "Title"),
        sp(0.5),
        p(
            "The rapid advancement of artificial intelligence and natural language processing "
            "technologies has opened unprecedented opportunities in educational technology. "
            "Language learning, in particular, stands to benefit greatly from the integration "
            "of Large Language Models (LLMs) and evidence-based cognitive science techniques "
            "such as spaced repetition."
        ),
        sp(0.3),
        p(
            "This report presents <b>LinguaAI</b> — a smart language learning platform that "
            "combines state-of-the-art LLM capabilities with the scientifically proven "
            "Spaced Repetition System (SRS). The platform is built on a modern microservices "
            "architecture consisting of a NestJS 10.4 backend API, a Next.js 15.1 frontend, and "
            "a Python FastAPI AI microservice."
        ),
        sp(0.3),
        p(
            "The platform's core learning module implements both the SM-2 and FSRS (Free Spaced "
            "Repetition Scheduler) algorithms to optimize flashcard review intervals based on "
            "each learner's individual performance. The AI-powered features — powered by "
            "Groq Cloud LPU — include: AI writing feedback with detailed scoring, "
            "AI-generated reading passages with comprehension questions, interactive grammar "
            "explanations, and a conversational AI tutor for real-time language practice."
        ),
        sp(0.3),
        p(
            "Key features include: <b>Flashcard Management</b> (create/edit decks and cards), "
            "<b>SRS Review Engine</b> (SM-2/FSRS scheduling), <b>Quiz Engine</b> (multiple "
            "choice and fill-in-the-blank), <b>AI Writing Coach</b> (grammar and style "
            "feedback), <b>AI Reading Module</b> (passage generation and comprehension), "
            "<b>AI Chat Tutor</b> (conversational practice), <b>Speaking Module</b> "
            "(pronunciation practice), <b>Learning Analytics</b> (XP, streaks, badges), "
            "and <b>Admin Dashboard</b> (user and content management)."
        ),
        sp(0.3),
        p(
            "The system supports multi-language interfaces (English, Vietnamese, Japanese, "
            "Korean, Chinese) and is fully containerized using Docker and orchestrated with "
            "Turborepo for a streamlined development experience. The report covers the "
            "project overview, software analysis and design, interface descriptions, "
            "deployment results, and future development directions."
        ),
        PageBreak(),
    ]

    # ══════════════════════════════════════════════════════════════════════════
    # PAGE 10 – ĐỀ CƯƠNG CHI TIẾT
    # ══════════════════════════════════════════════════════════════════════════
    story += [
        p("ĐỀ CƯƠNG CHI TIẾT", "Title"),
        sp(0.5),
        p("<b>TÊN ĐỀ TÀI:</b> XÂY DỰNG NỀN TẢNG HỌC NGÔN NGỮ THÔNG MINH TÍCH HỢP MÔ HÌNH NGÔN NGỮ LỚN VÀ THUẬT TOÁN LẶP LẠI CÓ KHOẢNG CÁCH"),
        sp(0.2),
        p("<b>TÊN ĐỀ TÀI (TIẾNG ANH):</b> Development of a Smart Language Learning Platform Integrated with Large Language Models and Spaced Repetition Algorithms"),
        sp(0.2),
        p("<b>Cán bộ hướng dẫn:</b> ThS. Mai Xuân Hùng"),
        sp(0.2),
        p("<b>Thời gian thực hiện:</b> Từ ngày 01/02/2026 đến ngày 21/04/2026"),
        sp(0.2),
        p("<b>Sinh viên thực hiện:</b>"),
        p("- Trần Ngọc Tố Như (MSSV: 21520385) – Trưởng nhóm"),
        p("- Lê Thùy Dương (MSSV: 21520203) – Thành viên"),
        p("- Trần Thanh Huy (MSSV: 21522170) – Thành viên"),
        p("- Mai Trần Khương Duy (MSSV: 21521998) – Thành viên"),
        sp(0.4),
        p("<b>Short Description:</b>"),
        p(
            "Với sự phát triển mạnh mẽ của trí tuệ nhân tạo và xử lý ngôn ngữ tự nhiên, "
            "việc tích hợp các Mô hình Ngôn ngữ Lớn (LLM) vào nền tảng học ngôn ngữ mở ra "
            "cơ hội lớn cho người học. Dự án LinguaAI xây dựng một nền tảng học ngôn ngữ "
            "thông minh, kết hợp thuật toán SRS (SM-2/FSRS) để tối ưu hóa lịch ôn tập "
            "flashcard với các tính năng AI bao gồm: phản hồi bài viết, tạo đoạn đọc hiểu, "
            "giải thích ngữ pháp và AI tutor trò chuyện."
        ),
        sp(0.4),
        p("<b>Technologies/Models/Tools/Languages:</b>"),
        p("Công nghệ Backend: NestJS 10.4 (Node.js 20 LTS), TypeScript 5.7, Prisma ORM 7.5, PostgreSQL 16"),
        p("Công nghệ Frontend: Next.js 15.1 (App Router), React 19, TypeScript 5.7, Tailwind CSS 4, Zustand 5"),
        p("AI Microservice: Python 3.12, FastAPI 0.115, Pydantic 2.9, Groq Cloud LPU (llama-3.3-70b-versatile)"),
        p("Cache & Queue: Redis (ioredis)"),
        p("Containerization: Docker, Docker Compose"),
        p("Monorepo: Turborepo, pnpm workspaces"),
        p("Cloud Storage: Local file storage / Cloudinary"),
        p("Quản lý mã nguồn: Git, GitHub"),
        p("Công cụ phát triển: Visual Studio Code, Postman"),
        sp(0.4),
        p("<b>Tóm tắt nội dung đề tài</b>", "H3"),
        p("<b>Lý do chọn đề tài:</b>"),
        p(
            "Học ngoại ngữ là nhu cầu thiết yếu trong thời đại toàn cầu hóa. Tuy nhiên, "
            "phần lớn người học gặp khó khăn trong việc duy trì động lực và tối ưu hóa "
            "quá trình ôn tập. Nghiên cứu khoa học nhận thức đã chứng minh rằng kỹ thuật "
            "<i>lặp lại có khoảng cách</i> (Spaced Repetition) giúp tăng cường trí nhớ dài "
            "hạn đáng kể so với phương pháp học tập truyền thống. Đồng thời, sự xuất hiện "
            "của các Mô hình Ngôn ngữ Lớn như GPT, LLaMA mở ra khả năng cung cấp phản hồi "
            "tức thời, cá nhân hóa và chất lượng cao cho người học."
        ),
        sp(0.3),
        p("<b>Mục tiêu:</b>"),
        p("- Xây dựng hệ thống quản lý flashcard với thuật toán SRS (SM-2 và FSRS)."),
        p("- Tích hợp AI để cung cấp phản hồi viết, tạo nội dung đọc, giải thích ngữ pháp."),
        p("- Xây dựng AI tutor hỗ trợ luyện hội thoại theo thời gian thực."),
        p("- Cung cấp hệ thống gamification (XP, streak, badge) tăng động lực học tập."),
        p("- Xây dựng analytics chi tiết để theo dõi tiến trình học."),
        sp(0.3),
        p("<b>Phạm vi:</b>"),
        p("- Phạm vi người dùng: Người học ngôn ngữ (tiếng Anh, tiếng Nhật, tiếng Hàn, tiếng Trung, tiếng Việt)."),
        p("- Phạm vi công nghệ: Web application (không bao gồm mobile native)."),
        p("- Phạm vi AI: Sử dụng Groq Cloud LPU (llama-3.3-70b-versatile)."),
        sp(0.3),
        p("<b>Kết quả mong đợi:</b>"),
        p("- Hệ thống hoạt động đầy đủ với tất cả các tính năng đã đề ra."),
        p("- Giao diện người dùng thân thiện, hỗ trợ đa ngôn ngữ (en, vi, ja, ko, zh)."),
        p("- AI phản hồi chính xác và hữu ích cho người học."),
        p("- Hệ thống bảo mật cao, hỗ trợ đăng nhập qua Google/GitHub OAuth."),
        PageBreak(),
    ]

    # ══════════════════════════════════════════════════════════════════════════
    # CHƯƠNG 1 – TỔNG QUAN ĐỀ TÀI
    # ══════════════════════════════════════════════════════════════════════════
    story += [
        p("CHƯƠNG 1. TỔNG QUAN ĐỀ TÀI", "H1"),
        p("1.1. Nhu cầu thực tế của đề tài", "H2"),
        p(
            "Trong bối cảnh toàn cầu hóa và hội nhập quốc tế ngày càng sâu rộng, nhu cầu học "
            "ngoại ngữ đã trở thành một yêu cầu thiết yếu không chỉ đối với học sinh, sinh viên "
            "mà còn với người đi làm. Theo thống kê, hơn 1,5 tỷ người trên thế giới đang học "
            "tiếng Anh, và hàng triệu người châu Á đang học các ngôn ngữ như Nhật, Hàn, Trung."
        ),
        sp(0.3),
        p(
            "Tuy nhiên, phần lớn người học gặp phải thách thức lớn về việc ghi nhớ từ vựng lâu "
            "dài và duy trì động lực học tập. Nghiên cứu của Hermann Ebbinghaus về 'đường cong "
            "quên lãng' cho thấy con người có thể quên tới 70% thông tin mới trong vòng 24 giờ "
            "nếu không được ôn tập đúng lúc. Kỹ thuật lặp lại có khoảng cách (Spaced Repetition) "
            "đã được khoa học nhận thức chứng minh là phương pháp hiệu quả nhất để khắc phục "
            "vấn đề này, giúp tối ưu hóa thời điểm ôn tập dựa trên độ khó và lịch sử ôn tập "
            "của mỗi người học."
        ),
        sp(0.3),
        p(
            "Bên cạnh đó, sự bùng nổ của các Mô hình Ngôn ngữ Lớn (LLM) như GPT-4, LLaMA, "
            "Gemini đã tạo ra cơ hội chưa từng có để xây dựng các trợ lý AI ngôn ngữ thông "
            "minh, có khả năng cung cấp phản hồi chi tiết, cá nhân hóa và tức thời — điều mà "
            "các gia sư truyền thống không thể đáp ứng một cách có thể mở rộng."
        ),

        p("1.2. Khảo sát hiện trạng", "H2"),
        p(
            "Trước khi bắt tay vào xây dựng hệ thống, nhóm đã tiến hành khảo sát các nền tảng "
            "học ngôn ngữ hiện có trên thị trường như Duolingo, Anki, Babbel, Rosetta Stone và "
            "Busuu. Qua quá trình phân tích, nhóm nhận thấy:"
        ),
        p(
            "<b>Hạn chế của các nền tảng hiện có:</b><br/>"
            "• Anki: Mạnh về SRS nhưng giao diện cũ kỹ, không có tính năng AI.<br/>"
            "• Duolingo: Giao diện đẹp nhưng thuật toán học không tối ưu cho người học nâng cao.<br/>"
            "• Các nền tảng AI hiện tại: Thiếu tích hợp SRS và gamification có hệ thống.<br/>"
            "• Hầu hết thiếu tính năng phản hồi viết chi tiết từ AI.<br/>"
            "• Không hỗ trợ đa ngôn ngữ giao diện cho người dùng Việt Nam."
        ),
        sp(0.3),
        p(
            "<b>Ưu điểm cần học hỏi:</b><br/>"
            "• Gamification (streak, badge, XP) giúp duy trì động lực rất hiệu quả.<br/>"
            "• Hệ thống adaptive learning cá nhân hóa trải nghiệm người học.<br/>"
            "• Tích hợp AI tutoring ngày càng được người dùng đón nhận tích cực.<br/>"
            "• Giao diện đơn giản, dễ dùng trên nhiều thiết bị."
        ),

        p("1.3. Phát biểu bài toán", "H2"),
        p(
            "Từ những thông tin thu thập được từ khảo sát và nhu cầu thực tế, bài toán đặt ra "
            "cho nhóm là: Làm thế nào để xây dựng một nền tảng học ngôn ngữ thông minh, kết "
            "hợp được sức mạnh của thuật toán Spaced Repetition với khả năng của AI, đồng thời "
            "cung cấp trải nghiệm người dùng đủ hấp dẫn và cá nhân hóa để giúp người học duy "
            "trì động lực và đạt được kết quả học tập tốt nhất?"
        ),
        p(
            "Mục tiêu cụ thể là xây dựng hệ thống LinguaAI — một nền tảng tích hợp đầy đủ từ "
            "quản lý flashcard, ôn tập SRS, làm quiz, đến luyện kỹ năng viết/đọc/nói với AI "
            "— được triển khai trên kiến trúc microservices hiện đại, đảm bảo hiệu suất cao "
            "và khả năng mở rộng."
        ),
        PageBreak(),
    ]

    # ══════════════════════════════════════════════════════════════════════════
    # CHƯƠNG 2 – PHÂN TÍCH VÀ THIẾT KẾ HỆ THỐNG
    # ══════════════════════════════════════════════════════════════════════════
    story += [
        p("CHƯƠNG 2. PHÂN TÍCH VÀ THIẾT KẾ HỆ THỐNG", "H1"),
        p("2.1. Xác định và mô hình hóa yêu cầu phần mềm", "H2"),
        p("2.1.1. Danh sách Actor", "H3"),
    ]

    actor_data = [
        ["STT", "Tên Actor", "Ý nghĩa / Ghi chú"],
        ["1", "Quản trị viên\n(Admin)", "Người quản lý hệ thống, có toàn quyền truy cập vào tất cả\ncác tính năng bao gồm quản lý người dùng, nội dung, thống kê."],
        ["2", "Người học\n(User)", "Người dùng đăng ký tài khoản để học ngôn ngữ, sử dụng\ncác tính năng flashcard, quiz, AI và xem analytics."],
    ]
    story.append(p("<i>Bảng 2.1.1 Danh sách Actor</i>", "Italic"))
    actor_table = Table(actor_data, colWidths=[1.2 * cm, 3.5 * cm, W - 4.7 * cm])
    actor_table.setStyle(table_style_default())
    story += [actor_table, sp(0.5)]

    story.append(p("2.1.2. Danh sách Use-case", "H3"))
    story.append(p("<i>Bảng 2.1.2 Danh sách Use-case – Quản trị viên</i>", "Italic"))

    uc_admin = [
        ["STT", "Tên Use-case", "Ý nghĩa / Ghi chú"],
        ["1", "Đăng nhập", "Đăng nhập vào hệ thống quản trị."],
        ["2", "Quản lý người dùng", "Xem/khóa/xóa tài khoản người dùng."],
        ["3", "Xem thống kê hệ thống", "Xem các số liệu: tổng người dùng, lượt học, quiz,..."],
        ["4", "Quản lý nội dung CMS", "Thêm/sửa/xóa bài học, bài đọc, bài tập ngữ pháp."],
        ["5", "Quản lý huy hiệu", "Tạo và cấu hình hệ thống badge/thành tích."],
        ["6", "Quản lý cấu hình AI", "Cấu hình prompt, model cho AI microservice."],
        ["7", "Đăng xuất", "Đăng xuất khỏi hệ thống."],
    ]
    t = Table(uc_admin, colWidths=[1.2 * cm, 4.5 * cm, W - 5.7 * cm])
    t.setStyle(table_style_default())
    story += [t, sp(0.5)]

    story.append(p("<i>Bảng 2.1.3 Danh sách Use-case – Người học</i>", "Italic"))
    uc_user = [
        ["STT", "Tên Use-case", "Ý nghĩa / Ghi chú"],
        ["1", "Đăng ký / Đăng nhập", "Tạo tài khoản mới hoặc đăng nhập (Local/Google/GitHub)."],
        ["2", "Quản lý Deck (Bộ thẻ)", "Tạo, sửa, xóa bộ thẻ flashcard theo ngôn ngữ/chủ đề."],
        ["3", "Quản lý Flashcard", "Thêm, sửa, xóa thẻ trong deck; nhập IPA, ảnh, âm thanh."],
        ["4", "Ôn tập SRS", "Ôn tập thẻ theo lịch SRS (SM-2/FSRS), đánh giá chất lượng nhớ."],
        ["5", "Làm Quiz", "Tạo và tham gia bài kiểm tra trắc nghiệm/điền từ theo deck."],
        ["6", "Luyện viết AI", "Nộp bài viết, nhận phản hồi AI về ngữ pháp, từ vựng, cấu trúc."],
        ["7", "Luyện đọc AI", "Nhận đoạn đọc AI theo chủ đề/cấp độ, trả lời câu hỏi hiểu."],
        ["8", "Giải thích ngữ pháp", "Nhập câu/cấu trúc, nhận giải thích ngữ pháp chi tiết từ AI."],
        ["9", "Chat với AI Tutor", "Trò chuyện với AI để luyện ngôn ngữ theo thời gian thực."],
        ["10", "Luyện phát âm", "Thực hành phát âm với phản hồi từ hệ thống speech."],
        ["11", "Xem Analytics", "Xem thống kê học tập: XP, streak, badge, thẻ đã học,..."],
        ["12", "Quản lý hồ sơ", "Chỉnh sửa thông tin cá nhân, ngôn ngữ học, mục tiêu hàng ngày."],
        ["13", "Đăng xuất", "Đăng xuất khỏi tài khoản."],
    ]
    t2 = Table(uc_user, colWidths=[1.2 * cm, 4.5 * cm, W - 5.7 * cm])
    t2.setStyle(table_style_default())
    story += [t2, sp(0.5), PageBreak()]

    # ── 2.2 Use-case diagrams ──────────────────────────────────────────────────
    story += [
        p("2.2. Sơ đồ Use-cases", "H2"),
        p("2.2.1. Sơ đồ Use-case tổng quát", "H3"),
        p(
            "Mọi actor đều phải đăng nhập để truy cập và sử dụng các tính năng của hệ thống. "
            "Người học chưa có tài khoản có thể đăng ký mới hoặc đăng nhập qua OAuth "
            "(Google, GitHub). Quản trị viên chỉ có thể đăng nhập qua tài khoản Local."
        ),
        sp(0.3),
        p("[Hình 2.2.1 – Sơ đồ Use-case tổng quát]", "Italic"),
        sp(0.5),
        p("2.2.2. Sơ đồ Use-case chi tiết của Quản trị viên", "H3"),
        p(
            "Quản trị viên sau khi đăng nhập có thể truy cập: Quản lý người dùng, "
            "Xem thống kê hệ thống, Quản lý nội dung CMS, Quản lý huy hiệu, "
            "Cấu hình AI và Đăng xuất."
        ),
        sp(0.3),
        p("[Hình 2.2.2 – Sơ đồ Use-case chi tiết của Quản trị viên]", "Italic"),
        sp(0.5),
        p("2.2.3. Sơ đồ Use-case chi tiết của Người học", "H3"),
        p(
            "Người học sau khi đăng nhập có thể sử dụng đầy đủ 12 use-case bao gồm các "
            "tính năng học tập cốt lõi và tính năng AI. Mỗi use-case được mô tả chi tiết "
            "trong phần sơ đồ Activity và Sequence bên dưới."
        ),
        sp(0.3),
        p("[Hình 2.2.3 – Sơ đồ Use-case chi tiết của Người học]", "Italic"),
        PageBreak(),
    ]

    # ── 2.3 Activity diagrams ──────────────────────────────────────────────────
    story += [
        p("2.3. Sơ đồ Activity", "H2"),
        p("2.3.1. Đăng nhập / Đăng ký", "H3"),
        p(
            "Luồng đăng nhập: Người học nhập email + mật khẩu → hệ thống xác thực thông tin "
            "→ nếu hợp lệ phát JWT access token + refresh token → chuyển đến Dashboard. "
            "Luồng OAuth: Chọn Google/GitHub → redirect OAuth → callback → tạo/cập nhật "
            "tài khoản → phát token."
        ),
        p("[Hình 2.3.1 – Sơ đồ hoạt động – Đăng nhập / Đăng ký]", "Italic"),
        sp(0.5),
        p("2.3.2. Quản lý Deck và Flashcard", "H3"),
        p(
            "Người học tạo deck → thêm cards (front/back text, IPA, hình ảnh) → hệ thống "
            "khởi tạo user_card_progress với ease_factor = 2.5, interval = 0. "
            "Có thể import/export cards theo định dạng CSV."
        ),
        p("[Hình 2.3.2 – Sơ đồ hoạt động – Quản lý Deck & Flashcard]", "Italic"),
        sp(0.5),
        p("2.3.3. Ôn tập SRS (Spaced Repetition)", "H3"),
        p(
            "Hệ thống lấy danh sách cards đến hạn ôn (next_review_date ≤ hôm nay) → "
            "hiển thị từng card → người học đánh giá chất lượng nhớ (0–5) → "
            "SM-2/FSRS tính interval mới → cập nhật next_review_date. "
            "Mỗi phiên ôn tập được lưu vào review_sessions."
        ),
        p("[Hình 2.3.3 – Sơ đồ hoạt động – Ôn tập SRS]", "Italic"),
        sp(0.5),
        p("2.3.4. Làm Quiz", "H3"),
        p(
            "Người học chọn deck → tạo quiz (hoặc chọn quiz có sẵn) → hệ thống tạo câu hỏi "
            "MCQ từ cards → người học trả lời trong thời gian giới hạn → "
            "hệ thống chấm điểm và lưu quiz_attempts."
        ),
        p("[Hình 2.3.4 – Sơ đồ hoạt động – Làm Quiz]", "Italic"),
        sp(0.5),
        p("2.3.5. Luyện viết AI", "H3"),
        p(
            "Người học nhập bài viết (có thể có prompt gợi ý) → gửi đến AI microservice → "
            "LLM phân tích ngữ pháp, từ vựng, cấu trúc câu → trả về feedback chi tiết kèm "
            "điểm số → lưu writing_submission."
        ),
        p("[Hình 2.3.5 – Sơ đồ hoạt động – Luyện viết AI]", "Italic"),
        sp(0.5),
        p("2.3.6. Luyện đọc AI", "H3"),
        p(
            "Người học chọn chủ đề và cấp độ → AI tạo đoạn đọc phù hợp kèm từ vựng nổi bật "
            "và câu hỏi hiểu → người học đọc và trả lời → hệ thống lưu reading_passage."
        ),
        p("[Hình 2.3.6 – Sơ đồ hoạt động – Luyện đọc AI]", "Italic"),
        sp(0.5),
        p("2.3.7. AI Chat Tutor", "H3"),
        p(
            "Người học bắt đầu cuộc trò chuyện → gửi tin nhắn → AI xử lý ngữ cảnh đàm thoại "
            "→ phản hồi bằng ngôn ngữ đích → lưu chat_messages theo conversation. "
            "Hỗ trợ nhiều cuộc hội thoại song song."
        ),
        p("[Hình 2.3.7 – Sơ đồ hoạt động – AI Chat Tutor]", "Italic"),
        PageBreak(),
    ]

    # ── 2.4 Sequence diagrams ─────────────────────────────────────────────────
    story += [
        p("2.4. Sơ đồ Sequence", "H2"),
        p("2.4.1. Đăng nhập", "H3"),
        p(
            "Client → POST /auth/login (email, password) → AuthService.validateUser() → "
            "bcrypt.compare() → JwtService.sign() (access token, refresh token) → "
            "RefreshTokensRepo.save() → Response 200 {accessToken, refreshToken}."
        ),
        p("[Hình 2.4.1 – Sơ đồ tuần tự – Đăng nhập]", "Italic"),
        sp(0.5),
        p("2.4.2. Đăng ký tài khoản", "H3"),
        p(
            "Client → POST /auth/register {email, password, firstName, lastName} → "
            "UsersService.create() → bcrypt.hash(password) → PrismaService.users.create() → "
            "EmailService.sendVerification() → Response 201 {user, message}."
        ),
        p("[Hình 2.4.2 – Sơ đồ tuần tự – Đăng ký]", "Italic"),
        sp(0.5),
        p("2.4.3. Tạo Deck và thêm Card", "H3"),
        p(
            "Client → POST /decks {title, language, level} → DecksService.create() → "
            "PrismaService.decks.create() → Response 201 {deck}. "
            "Client → POST /decks/:id/cards {frontText, backText, ...} → "
            "CardsService.create() → khởi tạo user_card_progress → Response 201 {card}."
        ),
        p("[Hình 2.4.3 – Sơ đồ tuần tự – Tạo Deck và thêm Card]", "Italic"),
        sp(0.5),
        p("2.4.4. Ôn tập SRS", "H3"),
        p(
            "Client → GET /srs/due-cards → SrsService.getDueCards() → "
            "PrismaService.user_card_progress.findMany(next_review_date ≤ now) → "
            "Response {cards[]}. Sau ôn tập: POST /srs/review {cardId, quality} → "
            "SM2Algorithm.calculate() | FSRSAlgorithm.calculate() → "
            "PrismaService.user_card_progress.update() → cập nhật XP, streak."
        ),
        p("[Hình 2.4.4 – Sơ đồ tuần tự – Ôn tập SRS]", "Italic"),
        sp(0.5),
        p("2.4.5. Làm Quiz", "H3"),
        p(
            "Client → POST /quiz/generate {deckId} → QuizService.generateQuiz() → "
            "lấy cards từ deck → tạo quiz_questions (MCQ) → Response {quiz}. "
            "Client → POST /quiz/:id/submit {answers[]} → QuizService.grade() → "
            "lưu quiz_attempts → Response {score, feedback}."
        ),
        p("[Hình 2.4.5 – Sơ đồ tuần tự – Tạo Quiz và làm bài]", "Italic"),
        sp(0.5),
        p("2.4.6. AI Writing Feedback", "H3"),
        p(
            "Client → POST /writing/submit {text, language} → WritingService.submitWriting() → "
            "gọi AI Microservice POST /api/v1/writing/feedback → FastAPI xử lý → "
            "Groq LLM phân tích → trả feedback JSON → "
            "PrismaService.writing_submissions.create() → Response {feedback, score}."
        ),
        p("[Hình 2.4.6 – Sơ đồ tuần tự – AI Writing Feedback]", "Italic"),
        sp(0.5),
        p("2.4.7. AI Reading Passage", "H3"),
        p(
            "Client → POST /reading/generate {topic, level, language} → "
            "ReadingService.generatePassage() → gọi AI Microservice POST /api/v1/reading/generate → "
            "Groq tạo passage + vocabulary + questions → "
            "PrismaService.reading_passages.create() → Response {passage, questions}."
        ),
        p("[Hình 2.4.7 – Sơ đồ tuần tự – AI Reading Passage]", "Italic"),
        sp(0.5),
        p("2.4.8. AI Chat Tutor", "H3"),
        p(
            "Client → POST /chat/conversations/:id/messages {content} → "
            "ChatService.sendMessage() → lưu user message → "
            "gọi AI Microservice POST /api/v1/chat/message → "
            "Groq xử lý context đàm thoại → trả AI response → "
            "lưu assistant message → Response {message}."
        ),
        p("[Hình 2.4.8 – Sơ đồ tuần tự – AI Chat Tutor]", "Italic"),
        PageBreak(),
    ]

    # ── 2.5 Database Design ───────────────────────────────────────────────────
    story += [
        p("2.5. Thiết kế cơ sở dữ liệu", "H2"),
        p(
            "Dựa trên phân tích yêu cầu, hệ thống sử dụng PostgreSQL với Prisma ORM. "
            "Dưới đây là thiết kế các bảng chính của nền tảng LinguaAI."
        ),
        sp(0.3),
        p("2.5.1. Bảng users", "H3"),
        p("<i>Bảng 2.5.1 Bảng users</i>", "Italic"),
    ]
    users_data = [
        ["Tên trường", "Kiểu dữ liệu", "Ràng buộc", "Mô tả"],
        ["id", "UUID", "PK", "Mã định danh người dùng"],
        ["email", "VARCHAR", "UNIQUE, NOT NULL", "Địa chỉ email đăng nhập"],
        ["password", "VARCHAR", "NULLABLE", "Mật khẩu (null nếu dùng OAuth)"],
        ["first_name", "VARCHAR", "NOT NULL", "Tên người dùng"],
        ["last_name", "VARCHAR", "NOT NULL", "Họ người dùng"],
        ["provider", "ENUM", "DEFAULT LOCAL", "Phương thức đăng nhập (LOCAL/GOOGLE/GITHUB)"],
        ["email_verified", "BOOLEAN", "DEFAULT FALSE", "Trạng thái xác thực email"],
        ["is_active", "BOOLEAN", "DEFAULT TRUE", "Tài khoản có đang hoạt động"],
        ["streak_count", "INT", "DEFAULT 0", "Số ngày học liên tiếp"],
        ["total_xp", "INT", "DEFAULT 0", "Tổng điểm kinh nghiệm"],
        ["daily_goal", "INT", "DEFAULT 20", "Mục tiêu thẻ ôn mỗi ngày"],
        ["preferred_language", "VARCHAR", "DEFAULT 'english'", "Ngôn ngữ đang học"],
        ["created_at", "TIMESTAMP", "DEFAULT NOW()", "Thời gian tạo tài khoản"],
    ]
    t = Table(users_data, colWidths=[3.5*cm, 2.8*cm, 3.5*cm, W - 9.8*cm])
    t.setStyle(table_style_default())
    story += [t, sp(0.5)]

    story.append(p("2.5.2. Bảng decks", "H3"))
    story.append(p("<i>Bảng 2.5.2 Bảng decks</i>", "Italic"))
    decks_data = [
        ["Tên trường", "Kiểu dữ liệu", "Ràng buộc", "Mô tả"],
        ["id", "UUID", "PK", "Mã bộ thẻ"],
        ["title", "VARCHAR(255)", "NOT NULL", "Tiêu đề bộ thẻ"],
        ["description", "VARCHAR(1000)", "DEFAULT ''", "Mô tả bộ thẻ"],
        ["language", "VARCHAR(50)", "DEFAULT 'english'", "Ngôn ngữ của bộ thẻ"],
        ["level", "VARCHAR(10)", "DEFAULT 'A1'", "Cấp độ (A1/A2/B1/B2/C1/C2)"],
        ["is_public", "BOOLEAN", "DEFAULT FALSE", "Bộ thẻ có công khai không"],
        ["creator_id", "UUID", "FK → users.id", "Người tạo bộ thẻ"],
        ["card_count", "INT", "DEFAULT 0", "Số lượng thẻ trong bộ"],
        ["created_at", "TIMESTAMP", "DEFAULT NOW()", "Thời gian tạo"],
    ]
    t = Table(decks_data, colWidths=[3.5*cm, 3*cm, 3.5*cm, W - 10*cm])
    t.setStyle(table_style_default())
    story += [t, sp(0.5)]

    story.append(p("2.5.3. Bảng cards", "H3"))
    story.append(p("<i>Bảng 2.5.3 Bảng cards</i>", "Italic"))
    cards_data = [
        ["Tên trường", "Kiểu dữ liệu", "Ràng buộc", "Mô tả"],
        ["id", "UUID", "PK", "Mã thẻ flashcard"],
        ["deck_id", "UUID", "FK → decks.id", "Bộ thẻ chứa thẻ này"],
        ["front_text", "VARCHAR(500)", "NOT NULL", "Nội dung mặt trước thẻ (từ/câu)"],
        ["back_text", "VARCHAR(500)", "NOT NULL", "Nội dung mặt sau thẻ (nghĩa/bản dịch)"],
        ["ipa_pronunciation", "VARCHAR(255)", "NULLABLE", "Phát âm IPA"],
        ["audio_url", "VARCHAR(500)", "NULLABLE", "Đường dẫn file âm thanh"],
        ["example_sentence", "VARCHAR(1000)", "NULLABLE", "Câu ví dụ sử dụng từ"],
        ["image_url", "VARCHAR(500)", "NULLABLE", "Hình ảnh minh họa"],
        ["created_at", "TIMESTAMP", "DEFAULT NOW()", "Thời gian tạo thẻ"],
    ]
    t = Table(cards_data, colWidths=[3.5*cm, 3*cm, 3.5*cm, W - 10*cm])
    t.setStyle(table_style_default())
    story += [t, sp(0.5), PageBreak()]

    story.append(p("2.5.4. Bảng user_card_progress", "H3"))
    story.append(p("<i>Bảng 2.5.4 Bảng user_card_progress</i>", "Italic"))
    ucp_data = [
        ["Tên trường", "Kiểu dữ liệu", "Ràng buộc", "Mô tả"],
        ["id", "UUID", "PK", "Mã tiến trình"],
        ["user_id", "UUID", "FK → users.id", "Người học"],
        ["card_id", "UUID", "FK → cards.id", "Thẻ được theo dõi"],
        ["ease_factor", "FLOAT", "DEFAULT 2.5", "Hệ số dễ dàng (SM-2)"],
        ["difficulty", "FLOAT", "DEFAULT 5.0", "Độ khó (FSRS)"],
        ["interval_days", "INT", "DEFAULT 0", "Khoảng cách ôn tập (ngày)"],
        ["repetition_count", "INT", "DEFAULT 0", "Số lần đã ôn tập"],
        ["next_review_date", "TIMESTAMP", "DEFAULT NOW()", "Ngày ôn tập tiếp theo"],
        ["quality_history", "JSON", "DEFAULT []", "Lịch sử chất lượng nhớ"],
    ]
    t = Table(ucp_data, colWidths=[3.8*cm, 3*cm, 3.5*cm, W - 10.3*cm])
    t.setStyle(table_style_default())
    story += [t, sp(0.5)]

    story.append(p("2.5.5. Bảng quizzes", "H3"))
    story.append(p("<i>Bảng 2.5.5 Bảng quizzes</i>", "Italic"))
    quiz_data = [
        ["Tên trường", "Kiểu dữ liệu", "Ràng buộc", "Mô tả"],
        ["id", "UUID", "PK", "Mã quiz"],
        ["title", "VARCHAR(255)", "NOT NULL", "Tiêu đề bài quiz"],
        ["deck_id", "UUID", "FK → decks.id (nullable)", "Bộ thẻ gắn với quiz (nếu có)"],
        ["creator_id", "UUID", "FK → users.id", "Người tạo quiz"],
        ["time_limit_minutes", "INT", "DEFAULT 15", "Thời gian giới hạn (phút)"],
        ["created_at", "TIMESTAMP", "DEFAULT NOW()", "Thời gian tạo"],
    ]
    t = Table(quiz_data, colWidths=[3.5*cm, 3*cm, 4*cm, W - 10.5*cm])
    t.setStyle(table_style_default())
    story += [t, sp(0.5)]

    story.append(p("2.5.6. Bảng writing_submissions", "H3"))
    story.append(p("<i>Bảng 2.5.6 Bảng writing_submissions</i>", "Italic"))
    ws_data = [
        ["Tên trường", "Kiểu dữ liệu", "Ràng buộc", "Mô tả"],
        ["id", "UUID", "PK", "Mã bài viết"],
        ["user_id", "UUID", "FK → users.id", "Người nộp bài"],
        ["prompt_text", "VARCHAR(2000)", "NULLABLE", "Đề bài / gợi ý viết"],
        ["user_text", "TEXT", "NOT NULL", "Nội dung bài viết của người học"],
        ["ai_feedback", "JSON", "NULLABLE", "Phản hồi chi tiết từ AI"],
        ["score", "JSON", "NULLABLE", "Điểm số đánh giá (ngữ pháp, từ vựng,...)"],
        ["language", "VARCHAR(50)", "DEFAULT 'english'", "Ngôn ngữ bài viết"],
        ["created_at", "TIMESTAMP", "DEFAULT NOW()", "Thời gian nộp bài"],
    ]
    t = Table(ws_data, colWidths=[3.5*cm, 3*cm, 3.5*cm, W - 10*cm])
    t.setStyle(table_style_default())
    story += [t, sp(0.5)]

    story.append(p("2.5.7. Bảng chat_conversations và chat_messages", "H3"))
    story.append(p("<i>Bảng 2.5.7 Bảng chat_conversations</i>", "Italic"))
    cc_data = [
        ["Tên trường", "Kiểu dữ liệu", "Ràng buộc", "Mô tả"],
        ["id", "UUID", "PK", "Mã cuộc trò chuyện"],
        ["user_id", "UUID", "FK → users.id", "Người dùng"],
        ["title", "VARCHAR(255)", "DEFAULT 'New Conversation'", "Tiêu đề hội thoại"],
        ["created_at", "TIMESTAMP", "DEFAULT NOW()", "Thời gian tạo"],
    ]
    t = Table(cc_data, colWidths=[3.5*cm, 3*cm, 4*cm, W - 10.5*cm])
    t.setStyle(table_style_default())
    story += [t, sp(0.3)]
    story.append(p("<i>Bảng 2.5.8 Bảng chat_messages</i>", "Italic"))
    cm_data = [
        ["Tên trường", "Kiểu dữ liệu", "Ràng buộc", "Mô tả"],
        ["id", "UUID", "PK", "Mã tin nhắn"],
        ["conversation_id", "UUID", "FK → chat_conversations.id", "Cuộc hội thoại"],
        ["role", "VARCHAR(20)", "DEFAULT 'user'", "Vai trò: 'user' hoặc 'assistant'"],
        ["content", "TEXT", "NOT NULL", "Nội dung tin nhắn"],
        ["created_at", "TIMESTAMP", "DEFAULT NOW()", "Thời gian gửi"],
    ]
    t = Table(cm_data, colWidths=[3.5*cm, 3*cm, 4*cm, W - 10.5*cm])
    t.setStyle(table_style_default())
    story += [t, sp(0.5), PageBreak()]

    # ══════════════════════════════════════════════════════════════════════════
    # CHƯƠNG 3 – MÔ TẢ GIAO DIỆN
    # ══════════════════════════════════════════════════════════════════════════
    story += [
        p("CHƯƠNG 3. MÔ TẢ GIAO DIỆN", "H1"),
        p("3.1. Giao diện người học", "H2"),
        p("3.1.1. Trang đăng nhập / Đăng ký", "H3"),
        p("[Hình 3.1.1 – Màn hình đăng nhập]", "Italic"),
    ]
    login_desc = [
        ["STT", "Tên", "Chức năng"],
        ["1", "Email", "Nhập địa chỉ email đã đăng ký"],
        ["2", "Mật khẩu", "Nhập mật khẩu tài khoản"],
        ["3", "Đăng nhập với Google", "Đăng nhập qua tài khoản Google (OAuth)"],
        ["4", "Đăng nhập với GitHub", "Đăng nhập qua tài khoản GitHub (OAuth)"],
        ["5", "Quên mật khẩu", "Yêu cầu đặt lại mật khẩu qua email"],
        ["6", "Đăng ký", "Chuyển hướng đến trang tạo tài khoản mới"],
    ]
    t = Table(login_desc, colWidths=[1.2*cm, 4*cm, W - 5.2*cm])
    t.setStyle(table_style_default())
    story += [t, sp(0.5)]

    story += [
        p("3.1.2. Dashboard – Trang chủ người học", "H3"),
        p("[Hình 3.1.2 – Màn hình Dashboard]", "Italic"),
    ]
    dash_desc = [
        ["STT", "Tên", "Chức năng"],
        ["1", "Streak hiện tại", "Hiển thị số ngày học liên tiếp"],
        ["2", "Tổng XP", "Hiển thị tổng điểm kinh nghiệm đã đạt được"],
        ["3", "Thẻ đến hạn ôn", "Hiển thị số thẻ cần ôn hôm nay theo SRS"],
        ["4", "Bắt đầu ôn tập", "Chuyển đến màn hình ôn tập SRS"],
        ["5", "Bộ thẻ của tôi", "Danh sách các deck của người học"],
        ["6", "Tiến trình tuần", "Biểu đồ hoạt động học tập trong 7 ngày qua"],
        ["7", "Huy hiệu gần đây", "Các badge mới đạt được"],
    ]
    t = Table(dash_desc, colWidths=[1.2*cm, 3.5*cm, W - 4.7*cm])
    t.setStyle(table_style_default())
    story += [t, sp(0.5)]

    story += [
        p("3.1.3. Quản lý Deck (Bộ thẻ)", "H3"),
        p("[Hình 3.1.3 – Màn hình quản lý Deck]", "Italic"),
    ]
    deck_desc = [
        ["STT", "Tên", "Chức năng"],
        ["1", "Tạo Deck mới", "Mở form tạo bộ thẻ mới (tiêu đề, ngôn ngữ, cấp độ)"],
        ["2", "Danh sách Deck", "Hiển thị tất cả deck của người học"],
        ["3", "Số lượng thẻ", "Hiển thị số thẻ trong mỗi deck"],
        ["4", "Chỉnh sửa", "Chỉnh sửa thông tin deck"],
        ["5", "Xóa Deck", "Xóa deck và tất cả thẻ bên trong"],
        ["6", "Mở Deck", "Xem và quản lý các flashcard trong deck"],
    ]
    t = Table(deck_desc, colWidths=[1.2*cm, 3.5*cm, W - 4.7*cm])
    t.setStyle(table_style_default())
    story += [t, sp(0.5)]

    story += [
        p("3.1.4. Màn hình ôn tập SRS Flashcard", "H3"),
        p("[Hình 3.1.4 – Màn hình ôn tập SRS Flashcard]", "Italic"),
    ]
    srs_desc = [
        ["STT", "Tên", "Chức năng"],
        ["1", "Mặt trước thẻ", "Hiển thị từ/câu cần học, có nút phát âm"],
        ["2", "Lật thẻ", "Lật sang mặt sau xem nghĩa và ví dụ"],
        ["3", "Lại (Again)", "Đánh giá chất lượng nhớ = 0 (quên hoàn toàn)"],
        ["4", "Khó (Hard)", "Đánh giá chất lượng nhớ = 1–2"],
        ["5", "Ổn (Good)", "Đánh giá chất lượng nhớ = 3–4"],
        ["6", "Dễ (Easy)", "Đánh giá chất lượng nhớ = 5"],
        ["7", "Tiến trình phiên", "Thanh tiến độ thẻ đã ôn / tổng thẻ cần ôn"],
    ]
    t = Table(srs_desc, colWidths=[1.2*cm, 3.5*cm, W - 4.7*cm])
    t.setStyle(table_style_default())
    story += [t, sp(0.5), PageBreak()]

    story += [
        p("3.1.5. Màn hình làm Quiz", "H3"),
        p("[Hình 3.1.5 – Màn hình làm Quiz]", "Italic"),
    ]
    quiz_desc = [
        ["STT", "Tên", "Chức năng"],
        ["1", "Câu hỏi", "Hiển thị câu hỏi trắc nghiệm / điền từ"],
        ["2", "Đáp án A/B/C/D", "Lựa chọn đáp án (MCQ)"],
        ["3", "Đồng hồ đếm ngược", "Hiển thị thời gian còn lại"],
        ["4", "Thanh tiến độ", "Câu hiện tại / tổng số câu"],
        ["5", "Nộp bài", "Xác nhận nộp bài và xem kết quả"],
        ["6", "Giải thích", "Hiển thị đáp án đúng và giải thích sau khi nộp"],
    ]
    t = Table(quiz_desc, colWidths=[1.2*cm, 3.5*cm, W - 4.7*cm])
    t.setStyle(table_style_default())
    story += [t, sp(0.5)]

    story += [
        p("3.1.6. Màn hình luyện viết AI", "H3"),
        p("[Hình 3.1.6 – Màn hình luyện viết AI]", "Italic"),
    ]
    writing_desc = [
        ["STT", "Tên", "Chức năng"],
        ["1", "Đề bài / Prompt", "Hiển thị chủ đề hoặc gợi ý viết từ AI"],
        ["2", "Khung nhập bài viết", "Vùng soạn thảo bài viết của người học"],
        ["3", "Nộp bài", "Gửi bài viết đến AI để phân tích"],
        ["4", "Phản hồi AI", "Hiển thị nhận xét chi tiết về ngữ pháp, từ vựng, cấu trúc"],
        ["5", "Điểm số", "Hiển thị điểm tổng và điểm theo từng tiêu chí"],
        ["6", "Lịch sử bài viết", "Xem các bài viết và phản hồi trước đó"],
    ]
    t = Table(writing_desc, colWidths=[1.2*cm, 3.5*cm, W - 4.7*cm])
    t.setStyle(table_style_default())
    story += [t, sp(0.5)]

    story += [
        p("3.1.7. Màn hình luyện đọc AI", "H3"),
        p("[Hình 3.1.7 – Màn hình luyện đọc AI]", "Italic"),
    ]
    reading_desc = [
        ["STT", "Tên", "Chức năng"],
        ["1", "Chọn chủ đề & Cấp độ", "Chọn topic và CEFR level cho bài đọc"],
        ["2", "Tạo bài đọc", "Yêu cầu AI tạo đoạn văn theo thông số"],
        ["3", "Đoạn văn", "Hiển thị đoạn đọc được tạo bởi AI"],
        ["4", "Từ vựng nổi bật", "Danh sách từ vựng quan trọng trong bài"],
        ["5", "Câu hỏi hiểu bài", "Các câu hỏi comprehension questions"],
        ["6", "Xem đáp án", "Hiển thị đáp án và giải thích"],
    ]
    t = Table(reading_desc, colWidths=[1.2*cm, 3.5*cm, W - 4.7*cm])
    t.setStyle(table_style_default())
    story += [t, sp(0.5)]

    story += [
        p("3.1.8. Màn hình AI Chat Tutor", "H3"),
        p("[Hình 3.1.8 – Màn hình AI Chat Tutor]", "Italic"),
    ]
    chat_desc = [
        ["STT", "Tên", "Chức năng"],
        ["1", "Danh sách hội thoại", "Hiển thị các cuộc hội thoại đã lưu"],
        ["2", "Tạo hội thoại mới", "Bắt đầu cuộc trò chuyện mới với AI Tutor"],
        ["3", "Khung nhắn tin", "Vùng hiển thị lịch sử tin nhắn"],
        ["4", "Ô nhập tin nhắn", "Nhập tin nhắn để gửi cho AI"],
        ["5", "Gửi", "Gửi tin nhắn và nhận phản hồi từ AI"],
        ["6", "Chế độ học", "Chọn chủ đề học tập cho cuộc hội thoại"],
    ]
    t = Table(chat_desc, colWidths=[1.2*cm, 3.5*cm, W - 4.7*cm])
    t.setStyle(table_style_default())
    story += [t, sp(0.5), PageBreak()]

    story += [
        p("3.2. Giao diện quản trị viên", "H2"),
        p("3.2.1. Quản lý người dùng", "H3"),
        p("[Hình 3.2.1 – Màn hình quản lý người dùng]", "Italic"),
    ]
    admin_user_desc = [
        ["STT", "Tên", "Chức năng"],
        ["1", "Dashboard", "Trang tổng quan Admin"],
        ["2", "Quản lý người dùng", "Danh sách tất cả người dùng hệ thống"],
        ["3", "Thanh tìm kiếm", "Tìm kiếm người dùng theo email/tên"],
        ["4", "Bộ lọc", "Lọc theo trạng thái tài khoản, ngày đăng ký"],
        ["5", "Xem chi tiết", "Xem thông tin chi tiết người dùng"],
        ["6", "Khóa/Mở khóa", "Khóa hoặc mở khóa tài khoản người dùng"],
        ["7", "Xuất Excel", "Xuất danh sách người dùng ra file Excel"],
        ["8", "Phân trang", "Điều hướng qua các trang danh sách"],
    ]
    t = Table(admin_user_desc, colWidths=[1.2*cm, 3.5*cm, W - 4.7*cm])
    t.setStyle(table_style_default())
    story += [t, sp(0.5)]

    story += [
        p("3.2.2. Thống kê hệ thống", "H3"),
        p("[Hình 3.2.2 – Màn hình thống kê hệ thống]", "Italic"),
    ]
    stats_desc = [
        ["STT", "Tên", "Chức năng"],
        ["1", "Tổng người dùng", "Số lượng tài khoản đã đăng ký"],
        ["2", "Người dùng hoạt động", "Số người dùng có hoạt động trong 30 ngày"],
        ["3", "Tổng lượt ôn tập SRS", "Tổng số thẻ đã được ôn tập"],
        ["4", "Biểu đồ đăng ký mới", "Biểu đồ cột theo ngày/tuần/tháng"],
        ["5", "Top languages", "Ngôn ngữ học phổ biến nhất"],
        ["6", "Thống kê AI usage", "Số lượt sử dụng tính năng AI (writing/reading/chat)"],
    ]
    t = Table(stats_desc, colWidths=[1.2*cm, 3.5*cm, W - 4.7*cm])
    t.setStyle(table_style_default())
    story += [t, sp(0.5), PageBreak()]

    # ══════════════════════════════════════════════════════════════════════════
    # CHƯƠNG 4 – KẾT QUẢ DỰ ÁN
    # ══════════════════════════════════════════════════════════════════════════
    story += [
        p("CHƯƠNG 4. KẾT QUẢ DỰ ÁN", "H1"),
        p("4.1. Giới thiệu sản phẩm", "H2"),
        p(
            "LinguaAI là một nền tảng học ngôn ngữ thông minh toàn diện, cung cấp trải nghiệm "
            "học tập cá nhân hóa thông qua sự kết hợp giữa khoa học nhận thức và trí tuệ nhân "
            "tạo. Nền tảng được xây dựng trên kiến trúc microservices hiện đại với ba thành phần "
            "chính:"
        ),
        p(
            "<b>Backend API (NestJS 10):</b> Xử lý toàn bộ logic nghiệp vụ, quản lý xác thực "
            "(JWT + OAuth), và điều phối giữa các module. Hỗ trợ WebSocket cho tính năng "
            "real-time và REST API cho toàn bộ tính năng học tập."
        ),
        p(
            "<b>Frontend (Next.js 15):</b> Giao diện người dùng hiện đại với App Router, "
            "hỗ trợ Server-Side Rendering, đa ngôn ngữ (en/vi/ja/ko/zh) và responsive "
            "design cho mọi thiết bị."
        ),
        p(
            "<b>AI Microservice (Python FastAPI):</b> Xử lý toàn bộ tính năng AI bao gồm: "
            "phân tích bài viết, tạo đoạn đọc hiểu, giải thích ngữ pháp và chatbot ngôn ngữ, "
            "sử dụng Groq Cloud LPU để gọi mô hình LLM."
        ),
        sp(0.3),
        p("<b>Tính năng chính đã hoàn thành:</b>"),
        p("• Hệ thống xác thực: Đăng ký/đăng nhập Local, Google OAuth, GitHub OAuth, 2FA (TOTP), giới hạn thiết bị đồng thời."),
        p("• Flashcard & SRS: Quản lý deck/card, ôn tập với SM-2 và FSRS algorithm, theo dõi tiến trình chi tiết."),
        p("• Quiz Engine: Tạo quiz tự động từ deck, nhiều dạng câu hỏi, chấm điểm tự động."),
        p("• AI Writing Coach: Nộp bài viết nhận phản hồi chi tiết về ngữ pháp, từ vựng, mạch văn."),
        p("• AI Reading Module: Tạo đoạn đọc theo chủ đề/cấp độ, kèm câu hỏi comprehension."),
        p("• Grammar Explainer: Giải thích quy tắc ngữ pháp bằng ví dụ sinh động."),
        p("• AI Chat Tutor: Trò chuyện thực hành ngôn ngữ với AI, lưu lịch sử hội thoại."),
        p("• Speaking Module: Luyện phát âm với text-to-speech."),
        p("• Gamification: Hệ thống XP, streak, badge, leaderboard."),
        p("• Analytics: Dashboard học tập với biểu đồ tiến trình, thống kê chi tiết."),
        p("• Admin Dashboard: Quản lý người dùng, nội dung CMS, thống kê hệ thống."),
        p("• Đa ngôn ngữ giao diện: English, Vietnamese, Japanese, Korean, Chinese."),

        p("4.2. Môi trường triển khai", "H2"),
        p("Hệ điều hành: Windows 10/11, Ubuntu 22.04 LTS (Production)"),
        p("Runtime: Node.js 20 LTS, Python 3.12"),
        p("Database: PostgreSQL 16 (Docker)"),
        p("Cache: Redis 7 (Docker)"),
        p("AI Model: Groq Cloud LPU với LLaMA 3.3 70B"),
        p("Containerization: Docker Desktop, Docker Compose"),
        p("IDE: Visual Studio Code"),
        p("Version Control: Git, GitHub"),
        p("Package Manager: pnpm 9 (monorepo), pip (Python)"),

        p("4.3. Kết luận kết quả", "H2"),
        p(
            "Từ những kết quả đạt được trong quá trình thực hiện đồ án, nhóm rút ra một số "
            "kết luận sau:"
        ),
        p(
            "<b>Về mặt kỹ thuật:</b> Hệ thống đã được thiết kế và triển khai thành công trên "
            "kiến trúc microservices với NestJS, Next.js và FastAPI. Thuật toán SRS (SM-2 và FSRS) "
            "được cài đặt đúng theo tài liệu khoa học, cho kết quả lịch ôn tập hợp lý. "
            "AI microservice tích hợp với Groq Cloud LPU hoạt động ổn định và cho phản hồi chất lượng."
        ),
        p(
            "<b>Về mặt tính năng:</b> Hệ thống đáp ứng đầy đủ các yêu cầu ban đầu đề ra, "
            "bao gồm tất cả các tính năng học tập cốt lõi và tính năng AI. Giao diện thân thiện, "
            "hỗ trợ đa ngôn ngữ và responsive trên nhiều thiết bị."
        ),
        p(
            "<b>Về mặt bảo mật:</b> Hệ thống áp dụng các biện pháp bảo mật hiện đại: JWT "
            "authentication, refresh token rotation, rate limiting, input sanitization (AI service), "
            "HTTPS, device fingerprinting và audit logging đầy đủ."
        ),
        PageBreak(),
    ]

    # ══════════════════════════════════════════════════════════════════════════
    # CHƯƠNG 5 – KẾT LUẬN
    # ══════════════════════════════════════════════════════════════════════════
    story += [
        p("CHƯƠNG 5. KẾT LUẬN", "H1"),
        p("5.1. Bảng phân chia công việc", "H2"),
        p("<i>Bảng 5.1.1 Bảng đánh giá phân chia công việc</i>", "Italic"),
    ]
    work_data = [
        ["STT", "MSSV", "Họ tên", "Vai trò", "Công việc chính", "%"],
        ["1", "21520385", "Trần Ngọc Tố Như", "Trưởng nhóm",
         "Backend NestJS: Auth, Users, SRS, Decks, Cards\nChương 4, Chương 5", "100%"],
        ["2", "21520203", "Lê Thùy Dương", "Thành viên",
         "Frontend Next.js: Dashboard, Flashcard, SRS UI\nChương 3 (giao diện người học)", "100%"],
        ["3", "21522170", "Trần Thanh Huy", "Thành viên",
         "AI Microservice: FastAPI, LLM Integration\nChương 2 (thiết kế CSDL, sơ đồ)", "100%"],
        ["4", "21521998", "Mai Trần Khương Duy", "Thành viên",
         "Backend: Quiz, Writing, Reading, Chat, Admin\nChương 1, Chương 3 (giao diện admin)", "100%"],
    ]
    t = Table(work_data, colWidths=[1*cm, 2.5*cm, 3*cm, 2.5*cm, W - 10.5*cm, 1.5*cm])
    t.setStyle(table_style_default())
    story += [t, sp(0.5)]

    story += [
        p("5.2. Ưu điểm và nhược điểm", "H2"),
        p("<b>Ưu điểm:</b>"),
        p(
            "Sau quá trình phát triển và kiểm thử, hệ thống LinguaAI đạt được những kết quả "
            "tích cực:"
        ),
        p("• Tích hợp thành công thuật toán SRS khoa học (SM-2 và FSRS) giúp tối ưu hóa lịch ôn tập."),
        p("• Kiến trúc microservices rõ ràng, tách biệt AI service khỏi core backend, dễ scale độc lập."),
        p("• AI features (writing, reading, grammar, chat) hoạt động ổn định với phản hồi có chất lượng."),
        p("• Hệ thống bảo mật toàn diện: JWT rotation, 2FA, device management, rate limiting, audit log."),
        p("• Giao diện đa ngôn ngữ hỗ trợ 5 ngôn ngữ, responsive trên mọi thiết bị."),
        p("• Gamification (XP/streak/badge) tạo động lực duy trì thói quen học tập hàng ngày."),
        p("• Monorepo với Turborepo giúp quản lý codebase lớn hiệu quả, chia sẻ types/constants."),
        p("• Hệ thống đáp ứng đầy đủ các yêu cầu về tính năng ban đầu đặt ra với tiến độ đúng hạn."),
        sp(0.3),
        p("<b>Nhược điểm:</b>"),
        p("• Phụ thuộc vào kết nối Internet để gọi Groq Cloud API, khi hết quota miễn phí có thể bị gián đoạn."),
        p("• Tính năng Speaking (phát âm) chấm từ transcript Whisper chứ chưa phân tích đặc trưng âm học (acoustic features)."),
        p("• Chưa có mobile native app (chỉ web responsive), hạn chế trải nghiệm trên điện thoại."),
        p("• Hệ thống recommendation chưa đủ thông minh để cá nhân hóa lộ trình học toàn diện."),
        p("• Độ trễ gọi LLM có thể lên tới 3–5 giây khi không dùng streaming."),
        p("• Chưa có tính năng community/social learning (học theo nhóm, chia sẻ deck công khai)."),

        p("5.3. Hướng phát triển", "H2"),
        p("5.3.1. Về hệ thống", "H3"),
        p("Để khắc phục các hạn chế còn tồn tại và nâng cấp hệ thống trong tương lai, nhóm đề xuất:"),
        p("• <b>Nâng cấp AI:</b> Tích hợp thêm các mô hình thương mại trả phí (GPT-4o, Claude 3.5, Gemini 1.5) để làm premium tier."),
        p("• <b>Mobile App:</b> Phát triển ứng dụng React Native dùng chung codebase với Next.js frontend."),
        p("• <b>Speaking AI:</b> Tích hợp Azure Speech Pronunciation Assessment hoặc tự phát triển acoustic model chấm phoneme-level."),
        p("• <b>Adaptive Learning:</b> Xây dựng recommendation engine cá nhân hóa lộ trình học dựa trên dữ liệu hiệu suất."),
        p("• <b>Social Features:</b> Thêm tính năng chia sẻ deck, học theo nhóm, leaderboard cộng đồng."),
        p("• <b>Offline Mode:</b> PWA với service worker để học flashcard khi không có kết nối."),
        p("• <b>CI/CD:</b> Thiết lập pipeline tự động với GitHub Actions, triển khai lên Kubernetes."),
        p("5.3.2. Về con người", "H3"),
        p(
            "Nhóm nhận rõ được những kinh nghiệm quý báu từ dự án này: việc làm việc trên "
            "monorepo lớn đòi hỏi kỷ luật cao về kiến trúc và quy ước code. Tích hợp AI "
            "vào ứng dụng thực tế phức tạp hơn nhiều so với PoC — cần xử lý streaming, "
            "error handling, prompt engineering cẩn thận. Hệ thống SRS đòi hỏi hiểu sâu "
            "về thuật toán và kiểm thử kỹ lưỡng để đảm bảo lịch ôn tập chính xác. "
            "Những bài học này sẽ là nền tảng quan trọng cho sự phát triển nghề nghiệp "
            "của từng thành viên trong nhóm."
        ),
    ]

    # ─── Build PDF ─────────────────────────────────────────────────────────────
    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    print(f"PDF generated: {OUTPUT}")


if __name__ == "__main__":
    build()
