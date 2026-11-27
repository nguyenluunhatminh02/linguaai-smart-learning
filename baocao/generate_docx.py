"""
Generate a beautiful Word DOCX report for LinguaAI project.
"""

from docx import Document
from docx.shared import Pt, Cm, RGBColor, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.enum.style import WD_STYLE_TYPE
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
import copy, os

# ── Colour palette ────────────────────────────────────────────────────────────
BLUE_DARK   = RGBColor(0x1F, 0x49, 0x7D)   # #1F497D  heading 1
BLUE_MED    = RGBColor(0x2E, 0x74, 0xB5)   # #2E74B5  heading 2
BLUE_LIGHT  = RGBColor(0x9D, 0xC3, 0xE6)   # #9DC3E6  table header bg  (approx)
ACCENT      = RGBColor(0x44, 0x72, 0xC4)   # #4472C4  accent
WHITE       = RGBColor(0xFF, 0xFF, 0xFF)
GRAY_TEXT   = RGBColor(0x40, 0x40, 0x40)
TEAL        = RGBColor(0x00, 0x70, 0x5D)

OUTPUT = os.path.join(os.path.dirname(__file__), "LinguaAI_BaoCao_DoAn.docx")

# ── Helpers ───────────────────────────────────────────────────────────────────
def set_cell_bg(cell, hex_color: str):
    """Set table cell background colour."""
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_color)
    tcPr.append(shd)

def set_cell_border(cell, **kwargs):
    """Set borders on a cell. kwargs: top, bottom, left, right → dict with size, color, val."""
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    tcBorders = OxmlElement("w:tcBorders")
    for edge, data in kwargs.items():
        border = OxmlElement(f"w:{edge}")
        border.set(qn("w:val"),   data.get("val", "single"))
        border.set(qn("w:sz"),    data.get("sz", "4"))
        border.set(qn("w:space"), "0")
        border.set(qn("w:color"), data.get("color", "auto"))
        tcBorders.append(border)
    tcPr.append(tcBorders)

def rgb_hex(r, g, b): return f"{r:02X}{g:02X}{b:02X}"
BLUE_HEX   = "2E74B5"
BLUE_D_HEX = "1F497D"
ACCENT_HEX = "4472C4"
LIGHT_BLUE = "DDEEFF"
WHITE_HEX  = "FFFFFF"
ALT_ROW    = "EBF3FB"

def add_run_rgb(para, text, bold=False, italic=False, size=12, color: RGBColor = None):
    run = para.add_run(text)
    run.bold = bold
    run.italic = italic
    run.font.size = Pt(size)
    if color:
        run.font.color.rgb = color
    return run

def para_format(para, space_before=0, space_after=6, line_spacing=1.15, align=WD_ALIGN_PARAGRAPH.JUSTIFY):
    pf = para.paragraph_format
    pf.space_before = Pt(space_before)
    pf.space_after  = Pt(space_after)
    pf.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
    pf.line_spacing      = line_spacing
    pf.alignment = align

def add_heading(doc, text, level=1, numbered=""):
    """Add a styled heading."""
    p = doc.add_paragraph()
    para_format(p, space_before=14 if level==1 else 10, space_after=8, align=WD_ALIGN_PARAGRAPH.LEFT)
    color = BLUE_DARK if level == 1 else (BLUE_MED if level == 2 else ACCENT)
    size  = 16 if level == 1 else (14 if level == 2 else 13)
    label = f"{numbered} {text}".strip() if numbered else text
    run = add_run_rgb(p, label, bold=True, size=size, color=color)
    # Bottom border for level 1
    if level == 1:
        pPr = p._p.get_or_add_pPr()
        pBdr = OxmlElement("w:pBdr")
        bottom = OxmlElement("w:bottom")
        bottom.set(qn("w:val"), "single")
        bottom.set(qn("w:sz"), "6")
        bottom.set(qn("w:space"), "1")
        bottom.set(qn("w:color"), BLUE_D_HEX)
        pBdr.append(bottom)
        pPr.append(pBdr)
    return p

def add_body(doc, text, indent=False):
    p = doc.add_paragraph()
    para_format(p, space_after=5)
    if indent:
        p.paragraph_format.left_indent = Cm(0.5)
    run = add_run_rgb(p, text, size=11, color=GRAY_TEXT)
    return p

def add_bullet(doc, text, bold_prefix=""):
    p = doc.add_paragraph(style="List Bullet")
    para_format(p, space_after=3, align=WD_ALIGN_PARAGRAPH.LEFT)
    p.paragraph_format.left_indent  = Cm(0.8)
    p.paragraph_format.first_line_indent = Cm(-0.4)
    if bold_prefix:
        add_run_rgb(p, bold_prefix, bold=True, size=11, color=GRAY_TEXT)
        add_run_rgb(p, text, size=11, color=GRAY_TEXT)
    else:
        add_run_rgb(p, text, size=11, color=GRAY_TEXT)
    return p

def add_caption(doc, text):
    p = doc.add_paragraph()
    para_format(p, space_before=4, space_after=8, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_run_rgb(p, text, italic=True, size=10, color=RGBColor(0x60, 0x60, 0x60))
    return p

def add_page_break(doc):
    doc.add_page_break()

def bookmark_paragraph(paragraph, bookmark_id, name):
    """Mark a heading/caption paragraph so PAGEREF fields can point at it."""
    start = OxmlElement("w:bookmarkStart")
    start.set(qn("w:id"), str(bookmark_id))
    start.set(qn("w:name"), name)
    end = OxmlElement("w:bookmarkEnd")
    end.set(qn("w:id"), str(bookmark_id))
    paragraph._p.insert(0, start)
    paragraph._p.append(end)

def add_pageref(paragraph, bookmark_name):
    """Insert a PAGEREF field; Word/LibreOffice recomputes it on open/export."""
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar"); begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText"); instr.set(qn("xml:space"), "preserve")
    instr.text = " PAGEREF " + bookmark_name + " \\h "
    separate = OxmlElement("w:fldChar"); separate.set(qn("w:fldCharType"), "separate")
    placeholder = OxmlElement("w:t"); placeholder.text = "?"
    end = OxmlElement("w:fldChar"); end.set(qn("w:fldCharType"), "end")
    for el in (begin, instr, separate, placeholder, end):
        run._r.append(el)
    return run

# Field-based page numbering: the lists of contents/tables/figures use
# PAGEREF fields so Word/LibreOffice computes the numbers from the actual
# layout instead of trusting hand-typed, stale values.
import re as _re
_PAGE_REFS = {}          # reference label -> bookmark name
_BOOKMARK_ID = 1000

def page_ref_name(label):
    key = str(label).strip()
    if key not in _PAGE_REFS:
        _PAGE_REFS[key] = "pr" + str(len(_PAGE_REFS) + 1)
    return _PAGE_REFS[key]

def resolve_page_refs(doc):
    """Attach bookmarks to the headings/captions referenced by the field lists."""
    global _BOOKMARK_ID
    # Match by exact text first, then by the leading section/caption number.
    # Dot-leader paragraphs are TOC/list lines, never targets.
    for label, name in _PAGE_REFS.items():
        target = None
        number = _re.match(r"^(?:\d+(?:\.\d+)*\.?|[IVX]+\.)", label)
        number = number.group(0) if number else None
        for para in doc.paragraphs:
            text = para.text.strip()
            if not text or "......" in text or "..." in text:
                continue
            if text == label or text.startswith(label + " ") or text.startswith(label + " – "):
                target = para
                break
            if number and text.startswith(number):
                target = para
                break
        if target is not None:
            _BOOKMARK_ID += 1
            bookmark_paragraph(target, _BOOKMARK_ID, name)
        else:
            print(f"WARNING: no target paragraph for page reference {label!r}")

def add_horizontal_rule(doc):
    p = doc.add_paragraph()
    para_format(p, space_before=4, space_after=4)
    pPr = p._p.get_or_add_pPr()
    pBdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "8")
    bottom.set(qn("w:space"), "1")
    bottom.set(qn("w:color"), ACCENT_HEX)
    pBdr.append(bottom)
    pPr.append(pBdr)
    return p

def make_table(doc, headers, rows, col_widths_cm=None, caption=""):
    """Create a beautifully styled table."""
    ncols = len(headers)
    table = doc.add_table(rows=1 + len(rows), cols=ncols)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.style = "Table Grid"

    # ── Header row ────────────────────────────────────────────────────────────
    hdr_cells = table.rows[0].cells
    for i, h in enumerate(headers):
        set_cell_bg(hdr_cells[i], BLUE_D_HEX)
        hdr_cells[i].vertical_alignment = WD_ALIGN_VERTICAL.CENTER
        p = hdr_cells[i].paragraphs[0]
        p.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(4)
        p.paragraph_format.space_after  = Pt(4)
        run = p.add_run(h)
        run.bold = True
        run.font.size = Pt(10)
        run.font.color.rgb = WHITE
        # borders
        for edge in ("top","bottom","left","right"):
            set_cell_border(hdr_cells[i], **{edge: {"val":"single","sz":"4","color":"FFFFFF"}})

    # ── Data rows ─────────────────────────────────────────────────────────────
    for ri, row_data in enumerate(rows):
        row_cells = table.rows[ri + 1].cells
        bg = ALT_ROW if ri % 2 == 1 else WHITE_HEX
        for ci, cell_text in enumerate(row_data):
            set_cell_bg(row_cells[ci], bg)
            row_cells[ci].vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            p = row_cells[ci].paragraphs[0]
            p.paragraph_format.space_before = Pt(3)
            p.paragraph_format.space_after  = Pt(3)
            # First column: centered
            p.paragraph_format.alignment = (
                WD_ALIGN_PARAGRAPH.CENTER if ci == 0 else WD_ALIGN_PARAGRAPH.LEFT
            )
            # Support bold prefix with **text**
            parts = str(cell_text).split("**")
            bold_toggle = False
            for part in parts:
                if part:
                    run = p.add_run(part)
                    run.font.size = Pt(10)
                    run.font.color.rgb = GRAY_TEXT
                    run.bold = bold_toggle
                bold_toggle = not bold_toggle
            # borders
            for edge in ("top","bottom","left","right"):
                set_cell_border(row_cells[ci], **{edge: {"val":"single","sz":"4","color":"B8CCE4"}})

    # ── Column widths ─────────────────────────────────────────────────────────
    if col_widths_cm:
        for ri2 in range(len(table.rows)):
            for ci2, w in enumerate(col_widths_cm):
                table.rows[ri2].cells[ci2].width = Cm(w)

    if caption:
        add_caption(doc, caption)
    return table

# ── Cover page ────────────────────────────────────────────────────────────────
MEMBERS = [
    ("Trần Ngọc Tố Như",  "21520385", "Trưởng nhóm"),
    ("Lê Thùy Dương",     "21520203", "Thành viên"),
    ("Trần Thanh Huy",    "21522170", "Thành viên"),
    ("Mai Trần Khương Duy", "21521998", "Thành viên"),
]
GVHD = "ThS. Mai Xuân Hùng"
COURSE_NAME = "PHÁT TRIỂN ỨNG DỤNG WEB"
COURSE_CODE = "SE347"
SUBMIT_LOCATION = "TP. Hồ Chí Minh"
SUBMIT_MONTH_YEAR = "tháng 4 năm 2026"

def build_cover(doc):
    # ── ĐHQG-HCM block (parent institution) ───────────────────────────────────
    p = doc.add_paragraph()
    para_format(p, space_before=18, space_after=0, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_run_rgb(p, "ĐẠI HỌC QUỐC GIA TP. HỒ CHÍ MINH", bold=True, size=13, color=BLUE_DARK)

    p = doc.add_paragraph()
    para_format(p, space_before=2, space_after=0, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_run_rgb(p, "TRƯỜNG ĐẠI HỌC CÔNG NGHỆ THÔNG TIN", bold=True, size=15, color=BLUE_DARK)

    p = doc.add_paragraph()
    para_format(p, space_before=2, space_after=0, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_run_rgb(p, "KHOA CÔNG NGHỆ PHẦN MỀM", bold=True, size=13, color=BLUE_MED)

    add_horizontal_rule(doc)

    # ── Course / context ──────────────────────────────────────────────────────
    p = doc.add_paragraph()
    para_format(p, space_before=22, space_after=4, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_run_rgb(p, "BÁO CÁO ĐỒ ÁN MÔN HỌC", bold=True, size=20, color=BLUE_DARK)

    p = doc.add_paragraph()
    para_format(p, space_before=2, space_after=20, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_run_rgb(p, f"{COURSE_NAME}  ({COURSE_CODE})", italic=True, size=13, color=BLUE_MED)

    # ── Big title block ───────────────────────────────────────────────────────
    add_horizontal_rule(doc)

    p = doc.add_paragraph()
    para_format(p, space_before=12, space_after=4, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_run_rgb(p, "ĐỀ TÀI", bold=True, size=13, color=GRAY_TEXT)

    p = doc.add_paragraph()
    para_format(p, space_before=2, space_after=4, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_run_rgb(p,
        "XÂY DỰNG NỀN TẢNG HỌC NGÔN NGỮ THÔNG MINH\n"
        "TÍCH HỢP MÔ HÌNH NGÔN NGỮ LỚN\n"
        "VÀ THUẬT TOÁN LẶP LẠI CÓ KHOẢNG CÁCH",
        bold=True, size=18, color=BLUE_DARK)

    p = doc.add_paragraph()
    para_format(p, space_before=4, space_after=12, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_run_rgb(p,
        "Development of a Smart Language Learning Platform\n"
        "Integrated with Large Language Models and Spaced Repetition Algorithms",
        italic=True, size=12, color=BLUE_MED)

    add_horizontal_rule(doc)

    # ── Advisor / Team ────────────────────────────────────────────────────────
    p = doc.add_paragraph()
    para_format(p, space_before=14, space_after=4, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_run_rgb(p, "Giảng viên hướng dẫn:", bold=True, size=12, color=GRAY_TEXT)
    p = doc.add_paragraph()
    para_format(p, space_before=0, space_after=10, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_run_rgb(p, GVHD, size=12, color=BLUE_DARK)

    p = doc.add_paragraph()
    para_format(p, space_before=2, space_after=4, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_run_rgb(p, "Nhóm sinh viên thực hiện:", bold=True, size=12, color=GRAY_TEXT)

    for name, mssv, role in MEMBERS:
        p = doc.add_paragraph()
        para_format(p, space_before=2, space_after=2, align=WD_ALIGN_PARAGRAPH.CENTER)
        add_run_rgb(p, f"{name}  –  MSSV: {mssv}  ({role})", size=12, color=GRAY_TEXT)

    # ── Footer date ───────────────────────────────────────────────────────────
    p = doc.add_paragraph()
    para_format(p, space_before=24, space_after=4, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_run_rgb(p, f"{SUBMIT_LOCATION}, {SUBMIT_MONTH_YEAR}", italic=True, size=12, color=GRAY_TEXT)

    add_page_break(doc)

# ── Instructor comment page ───────────────────────────────────────────────────
def build_comment_page(doc):
    p = doc.add_paragraph()
    para_format(p, space_before=10, space_after=10, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_run_rgb(p, "NHẬN XÉT CỦA GIÁO VIÊN HƯỚNG DẪN", bold=True, size=15, color=BLUE_DARK)
    add_horizontal_rule(doc)
    for _ in range(20):
        p = doc.add_paragraph()
        para_format(p, space_before=0, space_after=4)
        add_run_rgb(p, "." * 110, size=11, color=RGBColor(0xBB,0xBB,0xBB))
    p = doc.add_paragraph()
    para_format(p, space_before=16, space_after=4, align=WD_ALIGN_PARAGRAPH.RIGHT)
    add_run_rgb(p, "……., ngày …… tháng …… năm 2026", size=11, color=GRAY_TEXT)
    p = doc.add_paragraph()
    para_format(p, space_before=4, space_after=2, align=WD_ALIGN_PARAGRAPH.RIGHT)
    add_run_rgb(p, "Người nhận xét", bold=True, size=11, color=GRAY_TEXT)
    p = doc.add_paragraph()
    para_format(p, space_before=2, space_after=0, align=WD_ALIGN_PARAGRAPH.RIGHT)
    add_run_rgb(p, "(Ký tên và ghi rõ họ tên)", italic=True, size=10, color=GRAY_TEXT)
    add_page_break(doc)

# ── Table of Contents ─────────────────────────────────────────────────────────
def build_toc(doc):
    p = doc.add_paragraph()
    para_format(p, space_before=6, space_after=10, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_run_rgb(p, "MỤC LỤC", bold=True, size=15, color=BLUE_DARK)
    add_horizontal_rule(doc)

    entries = [
        # ── Front matter (đánh số La Mã i, ii, iii, ...) ──────────────────────
        (0, "LỜI CAM ĐOAN"),
        (0, "LỜI CẢM ƠN"),
        (0, "TÓM TẮT ĐỒ ÁN"),
        (0, "ABSTRACT"),
        (0, "MỤC LỤC"),
        (0, "DANH MỤC BẢNG"),
        (0, "DANH MỤC HÌNH"),
        (0, "DANH MỤC TỪ VIẾT TẮT"),
        # ── Body (đánh số Ả Rập 1, 2, 3, ...) ────────────────────────────────
        (0, "ĐỀ CƯƠNG CHI TIẾT"),
        (0, "CHƯƠNG 1. TỔNG QUAN ĐỀ TÀI"),
        (1, "1.1. Nhu cầu thực tế của đề tài"),
        (1, "1.2. Khảo sát hiện trạng"),
        (1, "1.3. Phát biểu bài toán"),
        (0, "CHƯƠNG 2. PHÂN TÍCH VÀ THIẾT KẾ HỆ THỐNG"),
        (1, "2.1. Xác định và mô hình hóa yêu cầu phần mềm"),
        (2, "2.1.1. Danh sách Actor"),
        (2, "2.1.2. Danh sách Use-case (Admin 16 + Học viên 35)"),
        (1, "2.2. Sơ đồ Use-cases"),
        (1, "2.3. Sơ đồ Activity (11 sơ đồ)"),
        (1, "2.4. Sơ đồ Sequence (12 sơ đồ)"),
        (1, "2.5. Thiết kế cơ sở dữ liệu (32 bảng)"),
        (0, "CHƯƠNG 3. MÔ TẢ GIAO DIỆN"),
        (1, "3.1. Giao diện người học (17 màn hình)"),
        (1, "3.2. Giao diện quản trị viên (4 màn hình)"),
        (0, "CHƯƠNG 4. KẾT QUẢ DỰ ÁN"),
        (1, "4.1. Giới thiệu sản phẩm + 51 tính năng đã hoàn thành"),
        (1, "4.2. Môi trường triển khai"),
        (1, "4.3. Kết luận kết quả"),
        (0, "CHƯƠNG 5. KẾT LUẬN"),
        (1, "5.1. Bảng phân chia công việc"),
        (1, "5.2. Ưu điểm và nhược điểm"),
        (1, "5.3. Hướng phát triển"),
        (0, "TÀI LIỆU THAM KHẢO"),
    ]

    for level, title in entries:
        p = doc.add_paragraph()
        pf = p.paragraph_format
        pf.space_before = Pt(2)
        pf.space_after  = Pt(2)
        pf.alignment = WD_ALIGN_PARAGRAPH.LEFT
        indent = [0, 0.5, 1.0][level]
        pf.left_indent = Cm(indent)
        # Dot leader via tab stop is not easy in python-docx, simulate with text
        color = BLUE_DARK if level == 0 else (BLUE_MED if level == 1 else GRAY_TEXT)
        bold  = (level == 0)
        size  = 11.5 if level == 0 else (11 if level == 1 else 10.5)
        dots_len = max(1, 85 - len(title) - int(indent * 6))
        add_run_rgb(p, f"{title}{'.' * dots_len}", bold=bold, size=size, color=color)
        add_pageref(p, page_ref_name(title))

    add_page_break(doc)

# ── List of tables ────────────────────────────────────────────────────────────
def build_list_tables(doc):
    p = doc.add_paragraph()
    para_format(p, space_before=6, space_after=10, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_run_rgb(p, "DANH MỤC BẢNG", bold=True, size=15, color=BLUE_DARK)
    add_horizontal_rule(doc)
    items = [
        ("Bảng 2.1.1",  "Danh sách Actor"),
        ("Bảng 2.1.2",  "Danh sách Use-case – Quản trị viên"),
        ("Bảng 2.1.3",  "Danh sách Use-case – Người học (5 nhóm)"),
        ("Bảng 2.5.0",  "Tổng quan 32 bảng cơ sở dữ liệu"),
        ("Bảng 2.5.1",  "Bảng users"),
        ("Bảng 2.5.2",  "Bảng decks"),
        ("Bảng 2.5.3",  "Bảng cards"),
        ("Bảng 2.5.4",  "Bảng user_card_progress"),
        ("Bảng 2.5.5",  "Bảng quizzes"),
        ("Bảng 2.5.6",  "Bảng writing_submissions"),
        ("Bảng 2.5.7",  "Bảng chat_conversations & chat_messages"),
        ("Bảng 2.5.8",  "Bảng refresh_tokens"),
        ("Bảng 2.5.9",  "Bảng mfa_secrets (Two-Factor Authentication)"),
        ("Bảng 2.5.10", "Bảng oauth_accounts"),
        ("Bảng 2.5.11", "Bảng audit_logs"),
        ("Bảng 2.5.12", "Bảng user_streaks"),
        ("Bảng 2.5.13", "Bảng badges & user_badges"),
        ("Bảng 2.5.14", "Bảng content_items (CMS)"),
        ("Bảng 2.5.15", "Bảng device_fingerprints & user_devices"),
        ("Bảng 3.1.1",  "Mô tả màn hình trang đăng nhập / đăng ký"),
        ("Bảng 3.1.2",  "Mô tả màn hình Dashboard"),
        ("Bảng 3.1.3",  "Mô tả màn hình quản lý Deck"),
        ("Bảng 3.1.4",  "Mô tả màn hình ôn tập SRS Flashcard"),
        ("Bảng 3.1.5",  "Mô tả màn hình làm Quiz"),
        ("Bảng 3.1.6",  "Mô tả màn hình luyện viết AI"),
        ("Bảng 3.1.7",  "Mô tả màn hình luyện đọc AI"),
        ("Bảng 3.1.8",  "Mô tả màn hình AI Chat Tutor"),
        ("Bảng 3.1.9",  "Mô tả màn hình Vocabulary"),
        ("Bảng 3.1.10", "Mô tả màn hình Listening"),
        ("Bảng 3.1.11", "Mô tả màn hình Translation"),
        ("Bảng 3.1.12", "Mô tả màn hình Speed Review"),
        ("Bảng 3.1.13", "Mô tả màn hình Difficult Words"),
        ("Bảng 3.1.14", "Mô tả màn hình Goals & Streak"),
        ("Bảng 3.1.15", "Mô tả màn hình Leaderboard"),
        ("Bảng 3.1.16", "Mô tả màn hình Hub Tiếng Nhật / Trung"),
        ("Bảng 3.1.17", "Mô tả màn hình MFA & Device Management"),
        ("Bảng 3.2.1",  "Mô tả màn hình quản lý người dùng (Admin)"),
        ("Bảng 3.2.2",  "Mô tả màn hình thống kê hệ thống"),
        ("Bảng 3.2.3",  "Mô tả màn hình quản lý CMS"),
        ("Bảng 3.2.4",  "Mô tả màn hình Audit Log"),
        ("Bảng 4.2",    "Công nghệ và phiên bản các thành phần"),
        ("Bảng 5.1.1",  "Bảng đánh giá phân chia công việc"),
    ]
    for num, title in items:
        p = doc.add_paragraph()
        para_format(p, space_before=1, space_after=3, align=WD_ALIGN_PARAGRAPH.LEFT)
        dots = "." * max(1, 78 - len(num) - len(title))
        add_run_rgb(p, f"{num}  {title}{dots}", size=11, color=GRAY_TEXT)
        add_pageref(p, page_ref_name(num))
    add_page_break(doc)

# ── List of figures ───────────────────────────────────────────────────────────
def build_list_figures(doc):
    p = doc.add_paragraph()
    para_format(p, space_before=6, space_after=10, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_run_rgb(p, "DANH MỤC HÌNH", bold=True, size=15, color=BLUE_DARK)
    add_horizontal_rule(doc)
    items = [
        # Use-case
        # Activity (11)
        # Sequence (12)
        # User screens (17)
        # Admin screens (4)
    ]
    for num, title in items:
        p = doc.add_paragraph()
        para_format(p, space_before=1, space_after=3, align=WD_ALIGN_PARAGRAPH.LEFT)
        dots = "." * max(1, 78 - len(num) - len(title))
        add_run_rgb(p, f"{num}  {title}{dots}", size=11, color=GRAY_TEXT)
        add_pageref(p, page_ref_name(num))
    add_page_break(doc)

# ── List of abbreviations ─────────────────────────────────────────────────────
def build_abbreviations(doc):
    p = doc.add_paragraph()
    para_format(p, space_before=6, space_after=10, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_run_rgb(p, "DANH MỤC TỪ VIẾT TẮT", bold=True, size=15, color=BLUE_DARK)
    add_horizontal_rule(doc)
    rows = [
        ["AI",     "Artificial Intelligence", "Trí tuệ nhân tạo"],
        ["API",    "Application Programming Interface", "Giao diện lập trình ứng dụng"],
        ["CEFR",   "Common European Framework of Reference", "Khung tham chiếu ngôn ngữ chung Châu Âu"],
        ["CMS",    "Content Management System", "Hệ quản trị nội dung"],
        ["CSDL",   "Cơ sở dữ liệu", "Database"],
        ["DTO",    "Data Transfer Object", "Đối tượng truyền dữ liệu"],
        ["FSRS",   "Free Spaced Repetition Scheduler", "Thuật toán lặp lại có khoảng cách thế hệ mới"],
        ["IPA",    "International Phonetic Alphabet", "Bảng phiên âm quốc tế"],
        ["JWT",    "JSON Web Token", "Mã thông báo JSON"],
        ["LLM",    "Large Language Model", "Mô hình ngôn ngữ lớn"],
        ["MCQ",    "Multiple Choice Question", "Câu hỏi trắc nghiệm nhiều lựa chọn"],
        ["MSSV",   "Mã số sinh viên", "Student ID"],
        ["OAuth",  "Open Authorization", "Giao thức ủy quyền mở"],
        ["ORM",    "Object–Relational Mapping", "Ánh xạ đối tượng – quan hệ"],
        ["REST",   "Representational State Transfer", "Kiến trúc API REST"],
        ["SM-2",   "SuperMemo-2 Algorithm", "Thuật toán SuperMemo-2"],
        ["SRS",    "Spaced Repetition System", "Hệ thống lặp lại có khoảng cách"],
        ["SSR",    "Server-Side Rendering", "Kết xuất phía máy chủ"],
        ["STT",    "Speech-To-Text", "Chuyển giọng nói thành văn bản"],
        ["TOTP",   "Time-based One-Time Password", "Mật khẩu một lần theo thời gian (2FA)"],
        ["TTS",    "Text-To-Speech", "Chuyển văn bản thành giọng nói"],
        ["UI/UX",  "User Interface / User Experience", "Giao diện và trải nghiệm người dùng"],
        ["XP",     "Experience Points", "Điểm kinh nghiệm trong gamification"],
    ]
    make_table(doc,
        headers=["Viết tắt", "Tiếng Anh", "Ý nghĩa tiếng Việt"],
        rows=rows,
        col_widths_cm=[2.5, 6.5, 8.0],
    )
    add_page_break(doc)

# ── Lời cam đoan ──────────────────────────────────────────────────────────────
def build_oath_page(doc):
    p = doc.add_paragraph()
    para_format(p, space_before=6, space_after=10, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_run_rgb(p, "LỜI CAM ĐOAN", bold=True, size=15, color=BLUE_DARK)
    add_horizontal_rule(doc)
    for txt in [
        "Nhóm chúng em xin cam đoan rằng đề tài đồ án \"Xây dựng nền tảng học ngôn ngữ "
        "thông minh tích hợp Mô hình Ngôn ngữ Lớn và Thuật toán Lặp lại có khoảng cách\" "
        "là công trình nghiên cứu của bản thân nhóm dưới sự hướng dẫn trực tiếp của giảng "
        "viên hướng dẫn. Toàn bộ mã nguồn, thiết kế hệ thống, phân tích yêu cầu và nội dung "
        "báo cáo đều do nhóm tự thực hiện.",
        "Các tài liệu, số liệu, hình ảnh tham khảo từ những nguồn khác đều đã được nhóm "
        "trích dẫn rõ ràng và đầy đủ trong phần Tài liệu tham khảo. Nhóm xin chịu hoàn toàn "
        "trách nhiệm nếu có bất kỳ sự gian lận hay sao chép nào trong nội dung đồ án này.",
        "Nhóm trân trọng cảm ơn quý thầy cô trong Khoa Công nghệ Phần mềm – Trường Đại học "
        "Công nghệ Thông tin – ĐHQG TP. HCM đã tạo điều kiện để nhóm hoàn thành đồ án này.",
    ]:
        add_body(doc, txt)

    # Signature block
    p = doc.add_paragraph()
    para_format(p, space_before=18, space_after=2, align=WD_ALIGN_PARAGRAPH.RIGHT)
    add_run_rgb(p, f"{SUBMIT_LOCATION}, {SUBMIT_MONTH_YEAR}", italic=True, size=11, color=GRAY_TEXT)
    p = doc.add_paragraph()
    para_format(p, space_before=2, space_after=2, align=WD_ALIGN_PARAGRAPH.RIGHT)
    add_run_rgb(p, "Đại diện nhóm thực hiện", bold=True, size=11, color=GRAY_TEXT)
    p = doc.add_paragraph()
    para_format(p, space_before=0, space_after=0, align=WD_ALIGN_PARAGRAPH.RIGHT)
    add_run_rgb(p, "(Ký và ghi rõ họ tên)", italic=True, size=10, color=GRAY_TEXT)
    p = doc.add_paragraph()
    para_format(p, space_before=36, space_after=0, align=WD_ALIGN_PARAGRAPH.RIGHT)
    add_run_rgb(p, MEMBERS[0][0], bold=True, size=11, color=GRAY_TEXT)
    add_page_break(doc)

# ── Tóm tắt (Vietnamese summary) ──────────────────────────────────────────────
def build_summary_vi(doc):
    p = doc.add_paragraph()
    para_format(p, space_before=6, space_after=10, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_run_rgb(p, "TÓM TẮT ĐỒ ÁN", bold=True, size=15, color=BLUE_DARK)
    add_horizontal_rule(doc)
    for txt in [
        "Trong bối cảnh học ngôn ngữ trở thành kỹ năng thiết yếu, các nền tảng học truyền "
        "thống bộc lộ nhiều hạn chế: nội dung cứng nhắc, thiếu cá nhân hóa và đặc biệt là "
        "không tận dụng được các tiến bộ của Trí tuệ Nhân tạo (AI). Đồ án \"LinguaAI\" "
        "được nhóm xây dựng nhằm kết hợp hai yếu tố then chốt — Thuật toán Lặp lại có "
        "khoảng cách (Spaced Repetition System – SRS) và Mô hình Ngôn ngữ Lớn (Large "
        "Language Model – LLM) — vào một nền tảng web thống nhất, hỗ trợ năm ngôn ngữ "
        "giao diện (Anh, Việt, Nhật, Hàn, Trung).",

        "Hệ thống được thiết kế theo kiến trúc microservices gồm ba thành phần chính: "
        "(1) Backend API xây dựng bằng NestJS 10.4 + Prisma ORM + PostgreSQL 16 quản lý "
        "toàn bộ logic nghiệp vụ; (2) Frontend Next.js 15.1 với React 19 cung cấp giao diện "
        "hiện đại, hỗ trợ Server-Side Rendering và đa ngôn ngữ; (3) AI Microservice viết "
        "bằng Python FastAPI, tích hợp Groq để phục vụ các tác vụ như chấm bài "
        "viết, tạo đoạn đọc, giải thích ngữ pháp và chatbot luyện hội thoại.",

        "Module học cốt lõi cài đặt thuật toán FSRS-4.5 (Free Spaced Repetition Scheduler) "
        "với 17 trọng số và kế thừa SM-2 cho khả năng tương thích ngược, cho phép tính toán "
        "khoảng thời gian ôn tập tối ưu cho từng người học theo công thức đường cong quên "
        "lãng. Hệ thống còn cung cấp Quiz Engine có Adaptive mode (tự điều chỉnh độ khó), "
        "AI Writing Coach (chấm theo 4 tiêu chí), AI Reading Module (sinh đoạn đọc CEFR), "
        "AI Chat Tutor có streaming response, Speed Review, Difficult Words tracker, "
        "Retention Dashboard và 8 endpoint AI chuyên biệt.",

        "Đặc biệt, nền tảng cung cấp ba hub học ngôn ngữ chuyên biệt: tiếng Anh (CEFR A1-C2), "
        "tiếng Trung (HSK 1-6) và tiếng Nhật (JLPT N5-N1) — mỗi hub bao gồm đầy đủ Vocabulary, "
        "Grammar, Reading và Translation Việt-Anh / Việt-Trung / Việt-Nhật. Hệ thống "
        "gamification gồm XP, streak counter, daily check-in, badges (định nghĩa qua JSON "
        "condition) và leaderboard tuần/tháng/all-time.",

        "Về bảo mật, hệ thống áp dụng đầy đủ các tiêu chuẩn hiện đại: JWT với refresh token "
        "rotation, đăng nhập OAuth 2.0 (Google + GitHub), MFA TOTP với 10 backup codes, "
        "device fingerprinting, audit logging toàn hệ thống, rate limiting Redis-backed, "
        "CSRF/CAPTCHA protection, password history chống tái sử dụng và 90 ngày login history.",

        "Cơ sở dữ liệu PostgreSQL 16 thiết kế với 32 bảng chia 5 nhóm (xác thực, bảo mật, "
        "học tập, AI, gamification & CMS), kèm CMS quản lý nội dung (lesson/passage/vocabulary/"
        "listening) hỗ trợ draft/publish và sort_order. Sản phẩm được container hoá toàn phần "
        "bằng Docker + Docker Compose và quản lý monorepo qua Turborepo + pnpm, sẵn sàng "
        "triển khai trên môi trường thực tế.",

        "Từ khoá: Spaced Repetition, FSRS-4.5, SM-2, Large Language Model, Groq, "
        "NestJS, Next.js, FastAPI, microservices, OAuth 2.0, MFA TOTP, JLPT, HSK, CEFR, "
        "Adaptive Learning, học ngoại ngữ thông minh.",
    ]:
        add_body(doc, txt)
    add_page_break(doc)

# ── Tài liệu tham khảo ───────────────────────────────────────────────────────
def build_references(doc):
    add_heading(doc, "TÀI LIỆU THAM KHẢO", level=1)
    refs = [
        # Khoa học nhận thức / SRS
        ("Ebbinghaus, H. (1885). ", "Memory: A Contribution to Experimental Psychology. ",
         "New York: Teachers College, Columbia University. (Bản dịch tiếng Anh năm 1913)."),
        ("Wozniak, P. A. (1990). ", "Optimization of learning. ",
         "Master's Thesis, University of Technology in Poznan."),
        ("Wozniak, P. A., & Gorzelanczyk, E. J. (1994). ",
         "Optimization of repetition spacing in the practice of learning. ",
         "Acta Neurobiologiae Experimentalis, 54(1), 59–62."),
        ("Open Spaced Repetition. (2024). ", "FSRS – Free Spaced Repetition Scheduler. ",
         "Truy cập tại: https://github.com/open-spaced-repetition/fsrs4anki."),
        # LLM / NLP
        ("Vaswani, A. et al. (2017). ", "Attention Is All You Need. ",
         "Advances in Neural Information Processing Systems (NeurIPS)."),
        ("Brown, T. et al. (2020). ", "Language Models are Few-Shot Learners. ",
         "Advances in Neural Information Processing Systems 33 (GPT-3)."),
        ("Touvron, H. et al. (2023). ", "LLaMA: Open and Efficient Foundation Language Models. ",
         "Meta AI Research, arXiv:2302.13971."),
        ("Groq. (2024). ", "Groq LPU Inference Engine. ",
         "Truy cập tại: https://groq.com."),
        # Web / Framework
        ("NestJS Documentation. (2024). ",
         "A progressive Node.js framework for building efficient and scalable server-side applications. ",
         "Truy cập tại: https://docs.nestjs.com."),
        ("Vercel. (2024). ", "Next.js 15 Documentation. ",
         "Truy cập tại: https://nextjs.org/docs."),
        ("Prisma. (2024). ", "Prisma – Next-generation Node.js and TypeScript ORM. ",
         "Truy cập tại: https://www.prisma.io/docs."),
        ("FastAPI. (2024). ",
         "FastAPI framework, high performance, easy to learn, fast to code, ready for production. ",
         "Truy cập tại: https://fastapi.tiangolo.com."),
        ("PostgreSQL Global Development Group. (2024). ",
         "PostgreSQL 17 Documentation. ",
         "Truy cập tại: https://www.postgresql.org/docs/17/."),
        ("Redis Ltd. (2024). ", "Redis 7 Documentation. ",
         "Truy cập tại: https://redis.io/docs/."),
        # Bảo mật
        ("OWASP Foundation. (2023). ", "OWASP Top 10:2021. ",
         "Truy cập tại: https://owasp.org/Top10/."),
        ("RFC 7519. (2015). ", "JSON Web Token (JWT). ",
         "Internet Engineering Task Force."),
        ("RFC 6238. (2011). ", "TOTP: Time-Based One-Time Password Algorithm. ",
         "Internet Engineering Task Force."),
        # CEFR / giáo dục ngoại ngữ
        ("Council of Europe. (2020). ",
         "Common European Framework of Reference for Languages: Learning, teaching, assessment – Companion volume. ",
         "Strasbourg: Council of Europe Publishing."),
    ]
    for i, (authors, title_part, source) in enumerate(refs, start=1):
        p = doc.add_paragraph()
        pf = p.paragraph_format
        pf.space_before = Pt(2)
        pf.space_after  = Pt(4)
        pf.left_indent  = Cm(0.8)
        pf.first_line_indent = Cm(-0.8)
        pf.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        add_run_rgb(p, f"[{i}] ", bold=True, size=11, color=BLUE_DARK)
        add_run_rgb(p, authors, size=11, color=GRAY_TEXT)
        add_run_rgb(p, title_part, italic=True, size=11, color=GRAY_TEXT)
        add_run_rgb(p, source, size=11, color=GRAY_TEXT)

# ── Header / Footer with page numbers ────────────────────────────────────────
def _add_field(paragraph, instr_text):
    """Insert a Word field (e.g. PAGE) into a paragraph run."""
    run = paragraph.add_run()
    fld_char_begin = OxmlElement("w:fldChar"); fld_char_begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText"); instr.set(qn("xml:space"), "preserve"); instr.text = instr_text
    fld_char_sep   = OxmlElement("w:fldChar"); fld_char_sep.set(qn("w:fldCharType"), "separate")
    fld_char_end   = OxmlElement("w:fldChar"); fld_char_end.set(qn("w:fldCharType"), "end")
    run._r.append(fld_char_begin); run._r.append(instr)
    run._r.append(fld_char_sep);   run._r.append(fld_char_end)
    return run

def setup_section_page_number(section, fmt="decimal", start=None, header_text=None,
                              show_footer_page=True, mirror=False):
    """Configure header & footer for a section.
    fmt: 'decimal' | 'lowerRoman' | 'upperRoman'
    """
    # --- Page number format ------------------------------------------------
    sectPr = section._sectPr
    # Remove previous pgNumType
    for old in sectPr.findall(qn("w:pgNumType")):
        sectPr.remove(old)
    pgNumType = OxmlElement("w:pgNumType")
    pgNumType.set(qn("w:fmt"), fmt)
    if start is not None:
        pgNumType.set(qn("w:start"), str(start))
    sectPr.append(pgNumType)

    # --- Header ------------------------------------------------------------
    header = section.header
    header.is_linked_to_previous = False
    # Clear existing
    for p in list(header.paragraphs):
        for r in list(p.runs):
            r.text = ""
    h_p = header.paragraphs[0]
    h_p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    if header_text:
        run = h_p.add_run(header_text)
        run.font.size = Pt(9)
        run.font.italic = True
        run.font.color.rgb = RGBColor(0x70, 0x70, 0x70)
        # Bottom border for header
        pPr = h_p._p.get_or_add_pPr()
        pBdr = OxmlElement("w:pBdr")
        bottom = OxmlElement("w:bottom")
        bottom.set(qn("w:val"), "single"); bottom.set(qn("w:sz"), "6")
        bottom.set(qn("w:space"), "1"); bottom.set(qn("w:color"), BLUE_D_HEX)
        pBdr.append(bottom); pPr.append(pBdr)

    # --- Footer ------------------------------------------------------------
    footer = section.footer
    footer.is_linked_to_previous = False
    for p in list(footer.paragraphs):
        for r in list(p.runs):
            r.text = ""
    f_p = footer.paragraphs[0]
    f_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    if show_footer_page:
        run = f_p.add_run("Trang ")
        run.font.size = Pt(10); run.font.color.rgb = GRAY_TEXT
        _add_field(f_p, "PAGE")
        run = f_p.add_run(" / ")
        run.font.size = Pt(10); run.font.color.rgb = GRAY_TEXT
        _add_field(f_p, "NUMPAGES")
        for r in f_p.runs:
            r.font.size = Pt(10); r.font.color.rgb = GRAY_TEXT

def add_section(doc, page_break=True):
    """Insert a new continuous/page-break section break."""
    from docx.enum.section import WD_SECTION
    new_sec = doc.add_section(WD_SECTION.NEW_PAGE if page_break else WD_SECTION.CONTINUOUS)
    new_sec.page_width  = Cm(21)
    new_sec.page_height = Cm(29.7)
    new_sec.left_margin  = Cm(2.5)
    new_sec.right_margin = Cm(2.5)
    new_sec.top_margin   = Cm(2.5)
    new_sec.bottom_margin = Cm(2.5)
    return new_sec

# ─────────────────────────────────────────────────────────────────────────────
def build():
    doc = Document()

    # ── Page setup: A4 ────────────────────────────────────────────────────────
    section = doc.sections[0]
    section.page_width  = Cm(21)
    section.page_height = Cm(29.7)
    section.left_margin = section.right_margin = Cm(2.5)
    section.top_margin  = section.bottom_margin = Cm(2.5)

    # Default paragraph font (Times New Roman = standard academic)
    doc.styles["Normal"].font.name = "Times New Roman"
    doc.styles["Normal"].font.size = Pt(13)
    # East-Asian font fallback so Vietnamese & special chars render correctly
    rPr = doc.styles["Normal"].element.get_or_add_rPr()
    rFonts = rPr.find(qn("w:rFonts"))
    if rFonts is None:
        rFonts = OxmlElement("w:rFonts")
        rPr.append(rFonts)
    rFonts.set(qn("w:eastAsia"), "Times New Roman")
    rFonts.set(qn("w:cs"), "Times New Roman")
    rFonts.set(qn("w:hAnsi"), "Times New Roman")
    rFonts.set(qn("w:ascii"), "Times New Roman")

    REPORT_HEADER = "LinguaAI – Báo cáo đồ án môn học"

    # ══════════════════════════════════════════════════════════════════════════
    # SECTION 1 — COVER + COMMENT PAGE  (no page numbers)
    # ══════════════════════════════════════════════════════════════════════════
    build_cover(doc)
    build_comment_page(doc)
    # Configure section 1: no header/footer, no page numbers
    setup_section_page_number(section, fmt="decimal", start=1,
                               header_text=None, show_footer_page=False)
    # Different first page so cover stays clean
    section.different_first_page_header_footer = True

    # ══════════════════════════════════════════════════════════════════════════
    # SECTION 2 — FRONT MATTER  (Roman numerals: i, ii, iii, ...)
    # ══════════════════════════════════════════════════════════════════════════
    front_section = add_section(doc, page_break=True)

    # 1) Lời cam đoan
    build_oath_page(doc)
    # 2) Lời cảm ơn (kept inline below)
    p = doc.add_paragraph()
    para_format(p, space_before=6, space_after=10, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_run_rgb(p, "LỜI CẢM ƠN", bold=True, size=15, color=BLUE_DARK)
    add_horizontal_rule(doc)
    for txt in [
        "Trên thực tế không có sự thành công nào mà không gắn liền với những sự hỗ trợ, "
        "giúp đỡ dù ít hay nhiều, dù trực tiếp hay gián tiếp của người khác. Trong suốt "
        "học kỳ này khi bắt đầu làm đồ án môn Phát triển Ứng dụng Web, nhóm em đã nhận "
        "được rất nhiều sự quan tâm, giúp đỡ của quý thầy cô, các anh chị khóa trên và "
        "bạn bè trong và ngoài lớp.",
        "Với lòng biết ơn sâu sắc nhất, nhóm em xin chân thành cảm ơn giảng viên hướng "
        f"dẫn — {GVHD} — đã tận tâm hướng dẫn chúng em qua từng buổi học trên lớp, giải "
        "đáp kịp thời các thắc mắc của chúng em. Nếu không có những lời hướng dẫn tận "
        "tình của thầy thì chắc chắn bài báo cáo của nhóm sẽ rất khó để hoàn thành được.",
        "Đề tài được xây dựng trong vòng một học kỳ do vậy không tránh khỏi những thiếu "
        "sót là điều chắc chắn. Nhóm em rất mong nhận được những ý kiến đóng góp quý báu "
        "của thầy để cho ứng dụng cũng như kiến thức của nhóm em được hoàn thiện hơn.",
        "Sau cùng, kính chúc thầy thật dồi dào sức khỏe, niềm tin để tiếp tục thực hiện "
        "sứ mệnh cao đẹp của mình là truyền đạt kiến thức cho thế hệ mai sau.",
    ]:
        add_body(doc, txt)
    add_page_break(doc)

    # 3) Tóm tắt VI
    build_summary_vi(doc)

    # 4) Abstract EN
    p = doc.add_paragraph()
    para_format(p, space_before=6, space_after=10, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_run_rgb(p, "ABSTRACT", bold=True, size=15, color=BLUE_DARK)
    add_horizontal_rule(doc)
    for txt in [
        "The rapid advancement of artificial intelligence and natural language processing "
        "technologies has opened unprecedented opportunities in educational technology. "
        "Language learning, in particular, stands to benefit greatly from the integration "
        "of Large Language Models (LLMs) and evidence-based cognitive science techniques "
        "such as spaced repetition.",
        "This report presents LinguaAI — a smart language learning platform that combines "
        "state-of-the-art LLM capabilities with the scientifically proven Spaced Repetition "
        "System (SRS). The platform is built on a modern microservices architecture consisting "
        "of a NestJS 10.4 backend API, a Next.js 15.1 frontend, and a Python FastAPI AI microservice.",
        "The platform's core learning module implements both the SM-2 and FSRS (Free Spaced "
        "Repetition Scheduler) algorithms to optimize flashcard review intervals based on each "
        "learner's individual performance. The AI-powered features — powered by Groq Cloud "
        "LLMs — include: AI writing feedback with detailed scoring, AI-generated reading passages "
        "with comprehension questions, interactive grammar explanations, and a conversational "
        "AI tutor for real-time language practice.",
        "Key features include: Flashcard Management, SRS Review Engine (SM-2/FSRS scheduling), "
        "Quiz Engine (multiple choice and fill-in-the-blank), AI Writing Coach, AI Reading Module, "
        "AI Chat Tutor, Speaking Module, Learning Analytics (XP, streaks, badges), and Admin "
        "Dashboard. The system supports multi-language interfaces (English, Vietnamese, Japanese, "
        "Korean, Chinese) and is fully containerized using Docker and orchestrated with Turborepo.",
        "Keywords: Spaced Repetition, SM-2, FSRS, Large Language Model, NestJS, Next.js, FastAPI, "
        "Groq, microservices, intelligent language learning.",
    ]:
        add_body(doc, txt)
    add_page_break(doc)

    # 5) Mục lục
    build_toc(doc)

    # 6) Danh mục bảng
    build_list_tables(doc)

    # 7) Danh mục hình
    build_list_figures(doc)

    # 8) Danh mục từ viết tắt
    build_abbreviations(doc)

    # Configure front-matter section: Roman numerals starting from i
    setup_section_page_number(front_section, fmt="lowerRoman", start=1,
                               header_text=REPORT_HEADER, show_footer_page=True)

    # ══════════════════════════════════════════════════════════════════════════
    # SECTION 3 — BODY  (Arabic numerals: 1, 2, 3, ...)
    # ══════════════════════════════════════════════════════════════════════════
    body_section = add_section(doc, page_break=True)

    # ══════════════════════════════════════════════════════════════════════════
    # ĐỀ CƯƠNG CHI TIẾT  (mở đầu phần thân báo cáo)
    # ══════════════════════════════════════════════════════════════════════════
    p = doc.add_paragraph()
    para_format(p, space_before=6, space_after=10, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_run_rgb(p, "ĐỀ CƯƠNG CHI TIẾT", bold=True, size=15, color=BLUE_DARK)
    add_horizontal_rule(doc)

    info_rows = [
        ("Tên đề tài:", "XÂY DỰNG NỀN TẢNG HỌC NGÔN NGỮ THÔNG MINH TÍCH HỢP MÔ HÌNH NGÔN NGỮ LỚN VÀ THUẬT TOÁN LẶP LẠI CÓ KHOẢNG CÁCH"),
        ("Tên tiếng Anh:", "Development of a Smart Language Learning Platform Integrated with Large Language Models and Spaced Repetition Algorithms"),
        ("Môn học:", f"{COURSE_NAME}  ({COURSE_CODE})"),
        ("Cán bộ hướng dẫn:", GVHD),
        ("Thời gian thực hiện:", "Từ ngày 01/02/2026 đến ngày 21/04/2026"),
    ]
    for label, value in info_rows:
        p = doc.add_paragraph()
        para_format(p, space_before=2, space_after=4, align=WD_ALIGN_PARAGRAPH.LEFT)
        add_run_rgb(p, label + "  ", bold=True, size=11, color=BLUE_MED)
        add_run_rgb(p, value, size=11, color=GRAY_TEXT)

    p = doc.add_paragraph()
    para_format(p, space_before=4, space_after=2, align=WD_ALIGN_PARAGRAPH.LEFT)
    add_run_rgb(p, "Sinh viên thực hiện:", bold=True, size=11, color=BLUE_MED)
    for name, mssv, role in MEMBERS:
        add_bullet(doc, f"{name}  (MSSV: {mssv})  –  {role}")

    add_heading(doc, "Công nghệ sử dụng", level=3)
    techs = [
        ("Backend:",  "NestJS 10.4 (Node.js 20 LTS), TypeScript 5.7, Prisma ORM 7.5, PostgreSQL 16, Passport.js"),
        ("Frontend:", "Next.js 15.1 (App Router), React 19, TypeScript 5.7, Tailwind CSS 4, Zustand 5, class-variance-authority + Lucide icons"),
        ("AI Service:", "Python 3.12, FastAPI 0.115, Pydantic 2.9, Groq Cloud LPU (llama-3.3-70b-versatile)"),
        ("Cache & Queue:", "Redis 7 (cache, rate-limit, CSRF, CAPTCHA), ioredis"),
        ("DevOps:",   "Docker 25, Docker Compose 2.27, Turborepo 2, pnpm workspaces 9.15"),
        ("Auth & Security:", "JWT, Refresh Token Rotation, OAuth2 (Google + GitHub), MFA TOTP (otplib), bcrypt, AES-256-GCM"),
        ("Realtime:", "WebSocket (ws + @nestjs/platform-ws cho Speaking module), Server-Sent Events (Chat streaming)"),
        ("Email:",    "Nodemailer + SMTP cho verification + reset password"),
        ("Testing:",  "Jest (backend), Vitest (frontend), Pytest (AI service)"),
        ("IDE & VCS:", "Visual Studio Code, Cursor, GitHub Copilot — Git, GitHub, Conventional Commits"),
    ]
    for bold_part, rest in techs:
        add_bullet(doc, rest, bold_prefix=bold_part + "  ")

    add_heading(doc, "Lý do chọn đề tài", level=3)
    add_body(doc,
        "Học ngoại ngữ là nhu cầu thiết yếu trong thời đại toàn cầu hóa. Phần lớn người học "
        "gặp khó khăn duy trì động lực và ghi nhớ từ vựng lâu dài. Kỹ thuật lặp lại có khoảng "
        "cách (Spaced Repetition) đã được khoa học nhận thức chứng minh là giải pháp tối ưu. "
        "Sự bùng nổ của LLM (GPT, LLaMA, Mistral, Groq,...) mở ra khả năng cung cấp phản hồi "
        "tức thời, cá nhân hóa — điều mà gia sư truyền thống không thể đáp ứng với quy mô lớn. "
        "Riêng đối với người Việt Nam, chưa có nền tảng nào tích hợp đồng thời SRS chuẩn khoa "
        "học (FSRS-4.5), tutor AI đa ngôn ngữ và 3 thứ tiếng phổ biến (Anh / Trung / Nhật) "
        "với giao diện hoàn toàn bằng tiếng Việt.")

    add_heading(doc, "Mục tiêu & Kết quả mong đợi", level=3)
    for t in [
        "Xây dựng nền tảng học flashcard cài đặt thuật toán SRS hiện đại (FSRS-4.5 + SM-2 backward-compat).",
        "Tích hợp 8 endpoint AI: writing assess, reading generate, grammar explain, chat (kèm streaming), "
        "content-generate-cards, content-generate-quiz, errors analyze, NLP analyze.",
        "Xây dựng 3 hub học ngôn ngữ chuyên biệt: English, Tiếng Trung (HSK 1-6), Tiếng Nhật (JLPT N5-N1).",
        "Quiz Engine có Adaptive mode — câu kế tiếp tự điều chỉnh độ khó.",
        "Hệ thống bảo mật toàn diện: JWT rotation, MFA TOTP, OAuth, device fingerprinting, audit log.",
        "Gamification đầy đủ: XP, streak, daily check-in, badges (JSON condition), leaderboard.",
        "CMS quản lý nội dung: lesson, passage, vocabulary, listening (publish/draft, sort_order).",
        "Đa ngôn ngữ giao diện 5 thứ tiếng: English, Tiếng Việt, 日本語, 한국어, 中文.",
        "Container hoá toàn bộ + monorepo Turborepo + CI-ready architecture.",
    ]:
        add_bullet(doc, t)
    add_page_break(doc)

    # ══════════════════════════════════════════════════════════════════════════
    # CHƯƠNG 1
    # ══════════════════════════════════════════════════════════════════════════
    add_heading(doc, "CHƯƠNG 1. TỔNG QUAN ĐỀ TÀI", level=1)
    add_heading(doc, "1.1. Nhu cầu thực tế của đề tài", level=2)
    add_body(doc,
        "Trong bối cảnh toàn cầu hóa và hội nhập quốc tế ngày càng sâu rộng, nhu cầu học "
        "ngoại ngữ đã trở thành một yêu cầu thiết yếu. Theo thống kê, hơn 1,5 tỷ người "
        "trên thế giới đang học tiếng Anh, và hàng triệu người châu Á đang học Nhật, Hàn, Trung.")
    add_body(doc,
        "Nghiên cứu của Hermann Ebbinghaus về \"đường cong quên lãng\" cho thấy con người "
        "có thể quên tới 70% thông tin mới trong vòng 24 giờ nếu không được ôn tập đúng lúc. "
        "Kỹ thuật lặp lại có khoảng cách (Spaced Repetition) đã được khoa học nhận thức chứng "
        "minh là phương pháp hiệu quả nhất để tối ưu hóa thời điểm ôn tập dựa trên độ khó "
        "và lịch sử ôn tập của mỗi người.")
    add_body(doc,
        "Bên cạnh đó, sự bùng nổ của các Mô hình Ngôn ngữ Lớn (LLM) như GPT-4, LLaMA, Gemini "
        "đã tạo ra cơ hội xây dựng các trợ lý AI ngôn ngữ thông minh, có khả năng cung cấp "
        "phản hồi chi tiết, cá nhân hóa và tức thời — điều mà các gia sư truyền thống không "
        "thể đáp ứng một cách có thể mở rộng.")

    add_heading(doc, "1.2. Khảo sát hiện trạng", level=2)
    add_body(doc,
        "Nhóm đã tiến hành khảo sát 6 nền tảng học ngôn ngữ tiêu biểu trong nước và quốc tế: "
        "Duolingo, Anki, Babbel, Rosetta Stone, Busuu và ELSA Speak. Qua phân tích chi tiết, "
        "nhóm nhận thấy mỗi nền tảng đều có thế mạnh nhất định nhưng chưa có nền tảng nào tích "
        "hợp đầy đủ các yếu tố cần thiết:")
    for t in [
        "Anki — mạnh về SRS (SM-2) nhưng giao diện cũ kỹ, không có AI tutor, không có "
        "gamification, hoàn toàn thiếu các module Reading/Writing/Listening tích hợp.",
        "Duolingo — giao diện đẹp, gamification mạnh, tuy nhiên thuật toán SRS đơn giản, không "
        "phù hợp người học nâng cao; chưa có AI writing feedback chi tiết, không có CMS mở.",
        "Babbel & Rosetta Stone — giáo trình chỉn chu nhưng thiếu cá nhân hóa SRS, không "
        "có tutor AI, giá thuê đắt và không hỗ trợ tiếng Việt.",
        "Busuu — có chức năng cộng đồng (peer review) nhưng phản hồi không tức thời và thiếu "
        "thuật toán SRS đúng nghĩa.",
        "ELSA Speak — chuyên biệt cho luyện phát âm; không phục vụ flashcard, reading, writing.",
        "Các sản phẩm AI Tutor mới (ChatGPT, Talkpal,...) — đối thoại tốt nhưng không lưu tiến "
        "trình SRS, không có hệ thống deck/card cá nhân hóa, không có analytics.",
        "Tất cả các nền tảng quốc tế trên đều không hỗ trợ giao diện tiếng Việt và không có "
        "module chuyên biệt cho người Việt học tiếng Trung (HSK) hoặc tiếng Nhật (JLPT).",
    ]:
        add_bullet(doc, t)
    add_body(doc, "Những ưu điểm cần học hỏi từ các nền tảng hiện có:")
    for t in [
        "Gamification (streak, badge, XP) giúp duy trì động lực rất hiệu quả.",
        "Hệ thống adaptive learning cá nhân hóa trải nghiệm người học.",
        "Tích hợp AI tutoring ngày càng được người dùng đón nhận tích cực.",
        "Giao diện đơn giản, dễ dùng trên nhiều thiết bị.",
    ]:
        add_bullet(doc, t)

    add_heading(doc, "1.3. Phát biểu bài toán", level=2)
    add_body(doc,
        "Bài toán đặt ra: Làm thế nào để xây dựng một nền tảng học ngôn ngữ thông minh, "
        "kết hợp được sức mạnh của thuật toán Spaced Repetition với khả năng của AI, đồng "
        "thời cung cấp trải nghiệm người dùng đủ hấp dẫn và cá nhân hóa để giúp người học "
        "duy trì động lực và đạt được kết quả học tập tốt nhất?")
    add_body(doc,
        "Mục tiêu cụ thể: Xây dựng hệ thống LinguaAI — một nền tảng tích hợp đầy đủ từ "
        "quản lý flashcard, ôn tập SRS, làm quiz, đến luyện kỹ năng viết/đọc/nói với AI — "
        "được triển khai trên kiến trúc microservices hiện đại, đảm bảo hiệu suất cao và "
        "khả năng mở rộng.")
    add_page_break(doc)

    # ══════════════════════════════════════════════════════════════════════════
    # CHƯƠNG 2
    # ══════════════════════════════════════════════════════════════════════════
    add_heading(doc, "CHƯƠNG 2. PHÂN TÍCH VÀ THIẾT KẾ HỆ THỐNG", level=1)
    add_heading(doc, "2.1. Xác định và mô hình hóa yêu cầu phần mềm", level=2)
    add_heading(doc, "2.1.1. Danh sách Actor", level=3)

    make_table(doc,
        headers=["STT", "Tên Actor", "Ý nghĩa / Ghi chú"],
        rows=[
            ["1", "Quản trị viên (Admin)",
             "Người quản lý hệ thống, có toàn quyền truy cập tới các chức năng quản trị: quản "
             "lý người dùng, quản lý nội dung CMS (bài học, bài đọc, từ vựng), cấu hình huy hiệu "
             "và xem thống kê toàn hệ thống. Tài khoản Admin chỉ tạo bằng phương thức Local."],
            ["2", "Người học (User / Learner)",
             "Người dùng đăng ký tài khoản (Local / Google OAuth / GitHub OAuth) để sử dụng các "
             "tính năng học ngôn ngữ: Flashcard, SRS, Quiz, các module AI, gamification "
             "(XP/streak/huy hiệu), bảng xếp hạng và quản lý thiết bị/MFA."],
            ["3", "Khách (Guest – chưa đăng nhập)",
             "Người dùng chưa có tài khoản. Chỉ truy cập được trang chủ giới thiệu, trang "
             "đăng ký, đăng nhập, quên mật khẩu và verify email; không có quyền vào bất kỳ "
             "trang dashboard nào."],
        ],
        col_widths_cm=[1.5, 4.0, 11.5],
        caption="Bảng 2.1.1 Danh sách Actor",
    )

    add_heading(doc, "2.1.2. Danh sách Use-case", level=3)
    add_body(doc,
        "Hệ thống có 16 use-case dành cho Quản trị viên và 35 use-case dành cho Người học, "
        "được nhóm theo cụm chức năng: xác thực & bảo mật, học tập cốt lõi (flashcard/SRS/quiz), "
        "các module AI, học theo ngôn ngữ chuyên biệt (Anh/Trung/Nhật), gamification, "
        "công cụ học và quản lý cá nhân.")
    make_table(doc,
        headers=["STT", "Tên Use-case", "Ý nghĩa / Ghi chú"],
        rows=[
            ["1",  "Đăng nhập Admin",       "Đăng nhập tài khoản Admin (Local + MFA bắt buộc)."],
            ["2",  "Dashboard tổng quan",   "Xem thống kê tổng: số user, số deck, lượt review, lượt AI/giờ,..."],
            ["3",  "Quản lý người dùng",    "Danh sách user, xem hồ sơ, vô hiệu hoá / kích hoạt lại, đổi role."],
            ["4",  "Khoá / mở khoá tài khoản", "Đặt is_active=false, thu hồi mọi refresh token và phiên đang hoạt động."],
            ["5",  "Xuất báo cáo Excel",    "Xuất danh sách người dùng / lịch sử học tập ra file .xlsx."],
            ["6",  "Quản lý CMS bài học",   "Thêm/sửa/xoá content_items: vocabulary list, reading passage, lesson, listening track."],
            ["7",  "Phân loại theo CEFR/JLPT/HSK", "Gán level (A1-C2 / N5-N1 / HSK1-6) và topic cho mỗi content item."],
            ["8",  "Xuất bản / Lưu nháp",   "Toggle published trên content_items để hiện hoặc ẩn nội dung."],
            ["9",  "Quản lý huy hiệu",      "CRUD bảng badges + cấu hình điều kiện đạt badge (JSON condition)."],
            ["10", "Cấu hình hệ thống",     "Cấu hình rate limit, tham số FSRS, prompt LLM mặc định."],
            ["11", "Xem Audit Log",         "Tra cứu audit_logs: ai làm gì, khi nào, từ IP nào (90 ngày gần nhất)."],
            ["12", "Xem Login History",     "Theo dõi lịch sử đăng nhập + thiết bị nghi ngờ."],
            ["13", "Quản lý quiz công khai", "Duyệt / xoá / sửa các quiz được creator đánh dấu public."],
            ["14", "Thống kê AI Usage",     "Số lượt gọi mỗi endpoint AI/giờ, model nào, độ trễ trung bình."],
            ["15", "Cấu hình thiết bị giới hạn", "Đặt số thiết bị tối đa (max_devices) cho mỗi tier user."],
            ["16", "Đăng xuất",             "Logout phiên Admin hiện tại hoặc tất cả thiết bị."],
        ],
        col_widths_cm=[1.5, 4.7, 10.8],
        caption="Bảng 2.1.2 Danh sách Use-case – Quản trị viên",
    )

    # ── User Use-cases — chia theo nhóm ─────────────────────────────────────
    add_body(doc, "Nhóm A — Xác thực & Bảo mật:")
    make_table(doc,
        headers=["STT", "Tên Use-case", "Ý nghĩa / Ghi chú"],
        rows=[
            ["1",  "Đăng ký tài khoản",      "Email + mật khẩu, gửi email xác thực; hoặc Google/GitHub OAuth."],
            ["2",  "Xác thực email",         "Click link verify-email kèm token để kích hoạt account."],
            ["3",  "Đăng nhập",              "Local hoặc OAuth; trả JWT (access 15 phút) + refresh (7 ngày, httpOnly)."],
            ["4",  "Quên / Đặt lại mật khẩu", "Yêu cầu link reset qua email, đổi mật khẩu mới."],
            ["5",  "Đổi mật khẩu",           "Đổi password khi đang đăng nhập (cần password cũ)."],
            ["6",  "Bật / Tắt MFA (TOTP)",   "Quét QR Google Authenticator, lưu 10 backup codes."],
            ["7",  "Verify MFA khi đăng nhập", "Sau khi nhập password, nhập 6 chữ số TOTP hoặc backup code."],
            ["8",  "Quản lý thiết bị",       "Liệt kê các thiết bị đang đăng nhập, đánh dấu thiết bị tin cậy, đăng xuất từ xa."],
            ["9",  "Câu hỏi bảo mật",        "Đặt 3 câu hỏi bảo mật (đáp án được hash) làm phương thức khôi phục."],
            ["10", "Xem lịch sử đăng nhập",  "90 ngày gần nhất: thời gian, IP, user-agent, device fingerprint."],
            ["11", "Đăng xuất",              "Logout 1 thiết bị / Logout-all tất cả thiết bị."],
        ],
        col_widths_cm=[1.5, 4.7, 10.8],
    )

    add_body(doc, "Nhóm B — Học tập cốt lõi (Flashcard / SRS / Quiz):")
    make_table(doc,
        headers=["STT", "Tên Use-case", "Ý nghĩa / Ghi chú"],
        rows=[
            ["12", "Quản lý Deck",            "CRUD bộ thẻ; chọn ngôn ngữ học (en/zh/ja) và level CEFR/JLPT/HSK."],
            ["13", "Quản lý Flashcard",       "CRUD thẻ; nhập front/back/IPA/ảnh/âm thanh/câu ví dụ."],
            ["14", "Ôn tập SRS",              "Lấy due-cards, đánh giá chất lượng (1-4), thuật toán FSRS-4.5 tính lại stability/difficulty."],
            ["15", "Speed Review",            "Chế độ ôn nhanh: 60 thẻ/lượt, có timer, dành cho các thẻ \"chắc nhớ\"."],
            ["16", "Difficult Words",         "Xem danh sách thẻ khó (retrievability < 70%) để ôn ưu tiên."],
            ["17", "Retention Dashboard",     "Bảng theo dõi tỷ lệ ghi nhớ + thẻ đang quên để ưu tiên ôn."],
            ["18", "Tạo Quiz thủ công",       "Soạn quiz MCQ / fill-in từ deck."],
            ["19", "Tạo Quiz bằng AI",        "Nhập topic + level → AI sinh tự động 10 câu hỏi đầy đủ."],
            ["20", "Làm Quiz có Adaptive",    "Câu tiếp theo tự điều chỉnh độ khó theo % đúng của user."],
            ["21", "Xem kết quả Quiz",        "Xem điểm, đáp án đúng, giải thích, lịch sử các attempt."],
        ],
        col_widths_cm=[1.5, 4.7, 10.8],
    )

    add_body(doc, "Nhóm C — Tính năng AI:")
    make_table(doc,
        headers=["STT", "Tên Use-case", "Ý nghĩa / Ghi chú"],
        rows=[
            ["22", "Luyện viết AI",          "Gửi đoạn văn → AI chấm theo 4 tiêu chí + sửa lỗi cụ thể."],
            ["23", "Sinh đoạn đọc AI",       "Chọn topic + level CEFR → AI sinh passage + vocab + comprehension Qs."],
            ["24", "Giải thích ngữ pháp AI", "Nhập câu/quy tắc → AI giải thích bằng tiếng mẹ đẻ kèm ví dụ."],
            ["25", "Chat AI Tutor",          "Hội thoại với AI bằng ngôn ngữ đích, có streaming response."],
            ["26", "Phân tích lỗi AI",       "Gửi danh sách lỗi user mắc → AI gợi ý chủ đề ôn tiếp theo."],
            ["27", "AI gợi ý từ vựng",       "Sinh danh sách flashcard từ một chủ đề/đoạn văn cho trước."],
        ],
        col_widths_cm=[1.5, 4.7, 10.8],
    )

    add_body(doc, "Nhóm D — Học theo ngôn ngữ chuyên biệt:")
    make_table(doc,
        headers=["STT", "Tên Use-case", "Ý nghĩa / Ghi chú"],
        rows=[
            ["28", "Chuyển ngôn ngữ học",     "Đổi giữa English / Tiếng Trung / Tiếng Nhật trên sidebar."],
            ["29", "Hub tiếng Nhật (JLPT)",   "Vocabulary N5-N1, Kanji, Grammar trợ từ/thể, Reading N5-N1, Việt→Nhật."],
            ["30", "Hub tiếng Trung (HSK)",   "Vocabulary HSK1-6, Pinyin, Grammar, Reading, Việt→Trung."],
            ["31", "Vocabulary chung",        "Danh sách bộ từ vựng có sẵn theo chủ đề."],
            ["32", "Listening",               "Bài nghe có audio + script + câu hỏi hiểu."],
            ["33", "Translation",             "Bài dịch Việt → ngôn ngữ đích, AI chấm độ chính xác."],
            ["34", "Speaking",                "Luyện phát âm qua TTS + (kế hoạch) STT đánh giá."],
        ],
        col_widths_cm=[1.5, 4.7, 10.8],
    )

    add_body(doc, "Nhóm E — Gamification & Social:")
    make_table(doc,
        headers=["STT", "Tên Use-case", "Ý nghĩa / Ghi chú"],
        rows=[
            ["35", "Daily Goal Tracking",     "Đặt và theo dõi mục tiêu hàng ngày (số thẻ ôn / số phút học)."],
            ["36", "Streak (chuỗi ngày học)", "Tự động đếm streak; reset khi bỏ lỡ ngày; cảnh báo trước nửa đêm."],
            ["37", "Daily Check-in",          "Điểm danh đầu ngày để nhận XP thưởng + giữ streak."],
            ["38", "Bảng huy hiệu (Badges)",  "Hiển thị badge đã đạt + điều kiện badge sắp đạt."],
            ["39", "Leaderboard",             "Xếp hạng theo XP / streak; lọc tuần, tháng, tất cả."],
            ["40", "Profile cá nhân",         "Đổi avatar, tên, ngôn ngữ học, ngôn ngữ mẹ đẻ, mục tiêu ngày."],
            ["41", "Pricing / Upgrade",       "Trang xem các gói trả phí (placeholder cho monetization)."],
            ["42", "Notifications",           "Thông báo trong app (thẻ đến hạn, streak risk, badge mới,...)."],
        ],
        col_widths_cm=[1.5, 4.7, 10.8],
        caption="Bảng 2.1.3 Danh sách Use-case – Người học",
    )

    add_heading(doc, "2.2. Sơ đồ Use-cases", level=2)
    add_heading(doc, "2.2.1. Sơ đồ Use-case tổng quát", level=3)
    add_body(doc,
        "Mọi actor đều phải đăng nhập để truy cập và sử dụng các tính năng của hệ thống. "
        "Người học chưa có tài khoản có thể đăng ký mới hoặc đăng nhập qua OAuth "
        "(Google, GitHub). Quản trị viên chỉ đăng nhập qua tài khoản Local.")

    add_heading(doc, "2.2.2. Sơ đồ Use-case chi tiết của Quản trị viên", level=3)

    add_heading(doc, "2.2.3. Sơ đồ Use-case chi tiết của Người học", level=3)

    add_heading(doc, "2.3. Sơ đồ Activity", level=2)
    act_items = [
        ("2.3.1. Đăng nhập / Đăng ký", "Hình 2.3.1",
         "Người học nhập email + mật khẩu → hệ thống xác thực → phát JWT access token + refresh token → "
         "chuyển Dashboard. Luồng OAuth: Chọn Google/GitHub → redirect OAuth → callback → tạo/cập nhật tài khoản → phát token."),
        ("2.3.2. Quản lý Deck và Flashcard", "Hình 2.3.2",
         "Người học tạo deck → thêm cards (front/back text, IPA, hình ảnh) → hệ thống khởi tạo "
         "user_card_progress với ease_factor = 2.5, interval = 0."),
        ("2.3.3. Ôn tập SRS", "Hình 2.3.3",
         "Hệ thống lấy danh sách cards đến hạn (next_review_date ≤ hôm nay) → hiển thị từng card → "
         "người học đánh giá chất lượng nhớ (0–5) → SM-2/FSRS tính interval mới → cập nhật next_review_date. "
         "Mỗi phiên ôn tập được lưu vào review_sessions."),
        ("2.3.4. Làm Quiz", "Hình 2.3.4",
         "Người học chọn deck → tạo quiz → hệ thống tạo câu hỏi MCQ từ cards → người học trả lời "
         "trong thời gian giới hạn → hệ thống chấm điểm và lưu quiz_attempts."),
        ("2.3.5. Luyện viết AI", "Hình 2.3.5",
         "Người học nhập bài viết → gửi đến AI microservice → LLM phân tích ngữ pháp, từ vựng, "
         "cấu trúc câu → trả về feedback chi tiết kèm điểm số → lưu writing_submission."),
        ("2.3.6. Luyện đọc AI", "Hình 2.3.6",
         "Người học chọn chủ đề và cấp độ → AI tạo đoạn đọc phù hợp kèm từ vựng và câu hỏi hiểu → "
         "người học đọc và trả lời → hệ thống lưu reading_passage."),
        ("2.3.7. AI Chat Tutor", "Hình 2.3.7",
         "Người học bắt đầu cuộc trò chuyện -> gửi tin nhắn -> AI xử lý ngữ cảnh đàm thoại "
         "(có streaming) -> phản hồi bằng ngôn ngữ đích -> lưu chat_messages theo conversation."),
        ("2.3.8. Bật MFA (Two-Factor Authentication)", "Hình 2.3.8",
         "Người học vào trang Bảo mật -> bấm Bật MFA -> hệ thống sinh TOTP secret + 10 backup "
         "codes -> hiển thị QR + manual key -> user quét bằng Google Authenticator -> nhập 6 chữ "
         "số TOTP để xác nhận -> secret được mã hoá AES-256-GCM và lưu vào mfa_secrets, backup "
         "codes hash bcrypt -> mfa_secrets.is_enabled = true -> ghi audit_log MFA_ENABLED."),
        ("2.3.9. Đăng nhập qua OAuth (Google / GitHub)", "Hình 2.3.9",
         "Người học bấm \"Đăng nhập với Google\" -> redirect tới /auth/oauth2/google -> Passport "
         "Google strategy chuyển hướng đến Google -> user xác thực ở Google -> Google redirect "
         "lại /auth/oauth2/callback/google kèm authorization code -> server đổi code lấy "
         "access_token + profile -> tìm hoặc tạo users + oauth_accounts (link provider_id) -> "
         "phát JWT + refresh token -> set httpOnly cookie -> redirect Dashboard."),
        ("2.3.10. Speed Review (ôn nhanh)", "Hình 2.3.10",
         "Người học bấm Speed Review -> SrsService lấy 60 thẻ ổn định nhất (repetition_count >= 3) "
         "-> hiển thị từng thẻ với timer 5s -> user chọn Đúng/Sai (mapping FSRS grade Good/Again) "
         "-> FSRS recalculate light-mode chỉ cập nhật quality_history -> cuối phiên cộng XP + "
         "lưu review_session."),
        ("2.3.11. Adaptive Quiz", "Hình 2.3.11",
         "Người học bắt đầu quiz -> backend trả câu đầu tiên ở difficulty = 3. Sau mỗi câu trả "
         "lời, client gọi POST /quiz/:id/adaptive-next với answeredIds + correctCount -> server "
         "tính correctRate -> nếu rate < 0.4 giảm difficulty, > 0.7 tăng difficulty -> chọn câu "
         "tiếp theo gần target difficulty nhất trong remaining pool -> trả về câu mới + sessionStats."),
    ]
    for title, fig_num, desc in act_items:
        add_heading(doc, title, level=3)
        add_body(doc, desc)

    add_heading(doc, "2.4. Sơ đồ Sequence", level=2)
    seq_items = [
        ("2.4.1. Đăng nhập", "Hình 2.4.1",
         "Client → POST /auth/login {email, password} → AuthService.validateUser() → bcrypt.compare() → "
         "JwtService.sign() → RefreshTokensRepo.save() → Response 200 {accessToken, refreshToken}."),
        ("2.4.2. Đăng ký tài khoản", "Hình 2.4.2",
         "Client → POST /auth/register {email, password, firstName, lastName} → UsersService.create() → "
         "bcrypt.hash(password) → PrismaService.users.create() → EmailService.sendVerification() → Response 201."),
        ("2.4.3. Tạo Deck và thêm Card", "Hình 2.4.3",
         "Client → POST /decks {title, language, level} → DecksService.create() → Response 201 {deck}.\n"
         "Client → POST /decks/:id/cards {frontText, backText,...} → CardsService.create() → "
         "khởi tạo user_card_progress → Response 201 {card}."),
        ("2.4.4. Ôn tập SRS với FSRS-4.5", "Hình 2.4.4",
         "Client -> GET /srs/due-cards?deckId=... -> SrsService.getDueCards() -> "
         "findMany(next_review_date <= now). Sau ôn tập: POST /srs/review {cardId, grade 1-4} -> "
         "FsrsAlgorithm.calculate(grade, prevStability, prevDifficulty, prevReps, daysSinceLast) "
         "-> tính nextStability, nextDifficulty, nextInterval -> upsert user_card_progress -> "
         "cập nhật next_review_date + quality_history -> cập nhật XP + streak. R = (1 + 0.2346t/S)^-0.5 "
         "= retrievability dùng để hiển thị Retention Dashboard."),
        ("2.4.5. Làm Quiz (Adaptive)", "Hình 2.4.5",
         "Client -> POST /quiz/generate-from-topic {topic, level} -> QuizService gọi AI "
         "/ai/content/generate-quiz-questions -> AI sinh 10 câu MCQ -> lưu quiz + quiz_questions. "
         "Khi làm: Client -> POST /quiz/:id/adaptive-next {answeredIds, correctCount} -> server "
         "tính correctRate -> chọn câu tiếp theo theo target difficulty -> trả về câu mới + "
         "sessionStats. Cuối: POST /quiz/:id/submit -> grade -> lưu quiz_attempts."),
        ("2.4.6. AI Writing Feedback", "Hình 2.4.6",
         "Client -> POST /writing/assess {text, language, target_level} -> WritingService -> "
         "gọi AI Microservice POST /api/v1/ai/writing/assess (kèm header X-API-Key, rate-limit "
         "20/phút) -> FastAPI sanitize input <user_input> XML tag -> Groq LLM với "
         "WRITING_SYSTEM prompt -> feedback JSON 4 tiêu chí -> "
         "writing_submissions.create() -> Response {feedback, score}."),
        ("2.4.7. AI Reading Passage", "Hình 2.4.7",
         "Client -> POST /reading/generate {topic, level, language} -> ReadingService -> "
         "POST /api/v1/ai/reading/generate (rate-limit) -> Groq tạo passage + "
         "vocabulary list + comprehension Qs -> reading_passages.create() -> Response."),
        ("2.4.8. AI Chat Tutor (Streaming)", "Hình 2.4.8",
         "Client -> POST /chat/conversations/:id/messages {content} -> ChatService.lưu user "
         "message + lấy 10 message gần nhất làm context -> POST /api/v1/ai/chat/stream với "
         "Server-Sent Events -> client subscribe SSE và render từng token theo thời gian thực "
         "-> kết thúc stream -> server tổng hợp full text và lưu chat_messages (assistant)."),
        ("2.4.9. Bật MFA (TOTP setup)", "Hình 2.4.9",
         "Client -> POST /mfa/setup -> MfaService.generateSecret() (otplib) -> trả {qrCode, "
         "manualKey, backupCodes[10]} -> user quét QR bằng Google Authenticator -> Client -> "
         "POST /mfa/setup/confirm {code} -> MfaService.verifyToken(code) -> nếu đúng: "
         "encrypt(secret) lưu mfa_secrets, hash backup codes, set is_enabled=true -> "
         "AuditLogService.log('MFA_ENABLED') -> Response {success: true}."),
        ("2.4.10. Verify MFA khi đăng nhập", "Hình 2.4.10",
         "Client -> POST /auth/login {email, password} -> nếu user có MFA: trả về "
         "{mfaRequired: true, tempToken} (200 nhưng chưa cấp JWT). Client -> "
         "POST /auth/verify-mfa {tempToken, code} -> verify TOTP hoặc backup code -> "
         "nếu đúng: phát accessToken + refreshToken + lưu device_fingerprint."),
        ("2.4.11. OAuth2 Callback (Google)", "Hình 2.4.11",
         "Client click \"Login Google\" -> redirect /auth/oauth2/google (Passport "
         "GoogleStrategy) -> redirect Google consent -> Google redirect "
         "/auth/oauth2/callback/google?code=xxx -> Passport đổi code lấy profile -> "
         "AuthService.handleOAuthLogin(profile) -> findOrCreate(users) + upsert(oauth_accounts) "
         "-> phát JWT -> set cookie + redirect /dashboard."),
        ("2.4.12. Quản lý thiết bị – Logout từ xa", "Hình 2.4.12",
         "Client -> GET /devices/sessions -> DeviceService trả danh sách user_devices + "
         "current device flag. User chọn Logout 1 thiết bị -> Client -> DELETE /devices/:deviceId "
         "-> revoke refresh_tokens(device_id=...) -> xóa user_devices entry -> ghi audit_log "
         "DEVICE_REMOVED -> Response 204."),
    ]
    for title, fig_num, desc in seq_items:
        add_heading(doc, title, level=3)
        add_body(doc, desc)

    add_heading(doc, "2.5. Thiết kế cơ sở dữ liệu", level=2)
    add_body(doc,
        "Hệ thống sử dụng PostgreSQL 16 với Prisma ORM 7.5, gồm tổng cộng 32 bảng được nhóm "
        "theo 5 nhóm chức năng: (1) Xác thực & Quản lý người dùng, (2) Bảo mật & Audit, "
        "(3) Học tập cốt lõi (Flashcard / SRS / Quiz), (4) Tính năng AI, (5) Gamification & CMS.")

    add_heading(doc, "2.5.0. Tổng quan các bảng dữ liệu", level=3)
    make_table(doc,
        headers=["Nhóm", "Tên bảng", "Mô tả ngắn"],
        rows=[
            # Nhóm 1
            ["Xác thực & User", "users",                "Thông tin người dùng + gamification (XP, streak, daily_goal, target_language, native_language)"],
            ["",                "roles",                "Vai trò: ADMIN / USER (enum)"],
            ["",                "user_roles",           "Bảng nối many-to-many giữa users và roles"],
            ["",                "oauth_accounts",       "Liên kết tài khoản OAuth Google/GitHub với user"],
            ["",                "verification_tokens",  "Token xác thực email + reset password (hashed)"],
            ["",                "password_history",     "Lịch sử password cũ để tránh tái sử dụng"],
            ["",                "refresh_tokens",       "JWT refresh tokens (httpOnly, rotation)"],
            # Nhóm 2
            ["Bảo mật",         "mfa_secrets",          "TOTP secret (mã hóa) + backup codes cho 2FA"],
            ["",                "device_fingerprints",  "Vân tay thiết bị (canvas, user-agent hash)"],
            ["",                "user_devices",         "Danh sách thiết bị đã đăng nhập + trusted flag"],
            ["",                "login_history",        "Lịch sử login: thời điểm, IP, action, kết quả"],
            ["",                "login_attempts",       "Đăng nhập thất bại (rate-limit + brute force detection)"],
            ["",                "audit_logs",           "Nhật ký toàn hệ thống cho compliance"],
            ["",                "security_questions",   "Câu hỏi bảo mật + answer_hash (bcrypt)"],
            # Nhóm 3
            ["Học tập",         "decks",                "Bộ thẻ flashcard, gắn với 1 ngôn ngữ + 1 level"],
            ["",                "cards",                "Thẻ flashcard: front/back/IPA/audio/image/example"],
            ["",                "user_card_progress",   "Tiến trình SRS từng thẻ (FSRS-4.5: stability, difficulty)"],
            ["",                "review_sessions",      "Phiên ôn tập (cards_reviewed, duration, accuracy)"],
            ["",                "quizzes",              "Bài quiz do user/AI tạo"],
            ["",                "quiz_questions",       "Câu hỏi của quiz (MCQ / fill-in / difficulty 1-5)"],
            ["",                "quiz_attempts",        "Lần làm quiz: điểm + đáp án từng câu (JSON)"],
            # Nhóm 4
            ["AI",              "writing_submissions",  "Bài viết user nộp + ai_feedback (JSON) + score"],
            ["",                "reading_passages",     "Đoạn đọc do AI tạo + vocabulary + comprehension Qs"],
            ["",                "chat_conversations",   "Cuộc hội thoại với AI Tutor"],
            ["",                "chat_messages",        "Tin nhắn user/assistant/system trong conversation"],
            # Nhóm 5
            ["Gamification",    "user_streaks",         "Bản ghi mỗi ngày: xp_earned, minutes_studied"],
            ["",                "badges",               "Định nghĩa huy hiệu + condition (JSON)"],
            ["",                "user_badges",          "Huy hiệu user đã đạt (composite PK)"],
            ["",                "notifications",        "Thông báo trong app + read/unread status"],
            ["CMS",             "content_items",        "Đơn vị nội dung CMS (lesson/passage/vocab/listening) – publish/draft"],
        ],
        col_widths_cm=[3.5, 4.5, 9.0],
        caption="Bảng 2.5.0 Tổng quan 32 bảng cơ sở dữ liệu",
    )

    # DB tables
    db_tables = [
        ("2.5.1. Bảng users", "Bảng 2.5.1 Bảng users",
         ["Tên trường", "Kiểu dữ liệu", "Ràng buộc", "Mô tả"],
         [
             ["id",                "UUID",         "PK",                   "Mã định danh người dùng"],
             ["email",             "VARCHAR",       "UNIQUE, NOT NULL",     "Địa chỉ email đăng nhập"],
             ["password",          "VARCHAR",       "NULLABLE",             "Mật khẩu (null nếu dùng OAuth)"],
             ["first_name",        "VARCHAR",       "NOT NULL",             "Tên người dùng"],
             ["last_name",         "VARCHAR",       "NOT NULL",             "Họ người dùng"],
             ["provider",          "ENUM",          "DEFAULT LOCAL",        "Phương thức đăng nhập (LOCAL/GOOGLE/GITHUB)"],
             ["email_verified",    "BOOLEAN",       "DEFAULT FALSE",        "Trạng thái xác thực email"],
             ["is_active",         "BOOLEAN",       "DEFAULT TRUE",         "Tài khoản có đang hoạt động"],
             ["streak_count",      "INT",           "DEFAULT 0",            "Số ngày học liên tiếp (streak)"],
             ["total_xp",          "INT",           "DEFAULT 0",            "Tổng điểm kinh nghiệm"],
             ["daily_goal",        "INT",           "DEFAULT 20",           "Mục tiêu thẻ ôn mỗi ngày"],
             ["preferred_language","VARCHAR(50)",   "DEFAULT 'english'",    "Ngôn ngữ đang học"],
             ["created_at",        "TIMESTAMP",     "DEFAULT NOW()",        "Thời gian tạo tài khoản"],
         ],
         [2.5, 2.8, 3.5, 8.2]),

        ("2.5.2. Bảng decks", "Bảng 2.5.2 Bảng decks",
         ["Tên trường", "Kiểu dữ liệu", "Ràng buộc", "Mô tả"],
         [
             ["id",          "UUID",         "PK",                  "Mã bộ thẻ"],
             ["title",       "VARCHAR(255)", "NOT NULL",            "Tiêu đề bộ thẻ"],
             ["description", "VARCHAR(1000)","DEFAULT ''",          "Mô tả bộ thẻ"],
             ["language",    "VARCHAR(50)",  "DEFAULT 'english'",   "Ngôn ngữ của bộ thẻ"],
             ["level",       "VARCHAR(10)",  "DEFAULT 'A1'",        "Cấp độ CEFR (A1/A2/B1/B2/C1/C2)"],
             ["is_public",   "BOOLEAN",      "DEFAULT FALSE",       "Bộ thẻ có công khai không"],
             ["creator_id",  "UUID",         "FK → users.id",       "Người tạo bộ thẻ"],
             ["card_count",  "INT",          "DEFAULT 0",           "Số lượng thẻ trong bộ"],
             ["created_at",  "TIMESTAMP",    "DEFAULT NOW()",       "Thời gian tạo"],
         ],
         [2.5, 3.0, 3.5, 8.0]),

        ("2.5.3. Bảng cards", "Bảng 2.5.3 Bảng cards",
         ["Tên trường", "Kiểu dữ liệu", "Ràng buộc", "Mô tả"],
         [
             ["id",                "UUID",         "PK",             "Mã thẻ flashcard"],
             ["deck_id",           "UUID",         "FK → decks.id",  "Bộ thẻ chứa thẻ này"],
             ["front_text",        "VARCHAR(500)", "NOT NULL",       "Nội dung mặt trước (từ/câu)"],
             ["back_text",         "VARCHAR(500)", "NOT NULL",       "Nội dung mặt sau (nghĩa/bản dịch)"],
             ["ipa_pronunciation", "VARCHAR(255)", "NULLABLE",       "Phát âm IPA"],
             ["audio_url",         "VARCHAR(500)", "NULLABLE",       "Đường dẫn file âm thanh"],
             ["example_sentence",  "VARCHAR(1000)","NULLABLE",       "Câu ví dụ sử dụng từ"],
             ["image_url",         "VARCHAR(500)", "NULLABLE",       "Hình ảnh minh họa"],
             ["created_at",        "TIMESTAMP",    "DEFAULT NOW()",  "Thời gian tạo thẻ"],
         ],
         [3.0, 3.0, 3.2, 7.8]),

        ("2.5.4. Bảng user_card_progress", "Bảng 2.5.4 Bảng user_card_progress",
         ["Tên trường", "Kiểu dữ liệu", "Ràng buộc", "Mô tả"],
         [
             ["id",               "UUID",      "PK",                  "Mã tiến trình"],
             ["user_id",          "UUID",      "FK → users.id",       "Người học"],
             ["card_id",          "UUID",      "FK → cards.id",       "Thẻ được theo dõi"],
             ["ease_factor",      "FLOAT",     "DEFAULT 2.5",         "Hệ số dễ dàng (SM-2 EF)"],
             ["difficulty",       "FLOAT",     "DEFAULT 5.0",         "Độ khó (FSRS D)"],
             ["interval_days",    "INT",       "DEFAULT 0",           "Khoảng cách ôn tập (ngày)"],
             ["repetition_count", "INT",       "DEFAULT 0",           "Số lần đã ôn tập thành công"],
             ["next_review_date", "TIMESTAMP", "DEFAULT NOW()",       "Ngày ôn tập tiếp theo"],
             ["quality_history",  "JSON",      "DEFAULT []",          "Lịch sử chất lượng nhớ (0-5)"],
         ],
         [3.5, 2.8, 3.2, 7.5]),

        ("2.5.5. Bảng quizzes và quiz_questions", "Bảng 2.5.5 Bảng quizzes",
         ["Tên trường", "Kiểu dữ liệu", "Ràng buộc", "Mô tả"],
         [
             ["id",                  "UUID",         "PK",                       "Mã quiz"],
             ["title",               "VARCHAR(255)", "NOT NULL",                 "Tiêu đề bài quiz"],
             ["deck_id",             "UUID",         "FK → decks.id (nullable)", "Bộ thẻ gắn với quiz"],
             ["creator_id",          "UUID",         "FK → users.id",            "Người tạo quiz"],
             ["time_limit_minutes",  "INT",          "DEFAULT 15",               "Thời gian giới hạn (phút)"],
             ["created_at",          "TIMESTAMP",    "DEFAULT NOW()",            "Thời gian tạo"],
         ],
         [3.0, 3.0, 3.5, 7.5]),

        ("2.5.6. Bảng writing_submissions", "Bảng 2.5.6 Bảng writing_submissions",
         ["Tên trường", "Kiểu dữ liệu", "Ràng buộc", "Mô tả"],
         [
             ["id",          "UUID",         "PK",            "Mã bài viết"],
             ["user_id",     "UUID",         "FK → users.id", "Người nộp bài"],
             ["prompt_text", "VARCHAR(2000)","NULLABLE",      "Đề bài / gợi ý viết từ AI"],
             ["user_text",   "TEXT",         "NOT NULL",      "Nội dung bài viết của người học"],
             ["ai_feedback", "JSON",         "NULLABLE",      "Phản hồi chi tiết từ AI (JSON)"],
             ["score",       "JSON",         "NULLABLE",      "Điểm số theo từng tiêu chí"],
             ["language",    "VARCHAR(50)",  "DEFAULT 'english'", "Ngôn ngữ bài viết"],
             ["created_at",  "TIMESTAMP",    "DEFAULT NOW()", "Thời gian nộp bài"],
         ],
         [3.0, 3.0, 3.2, 7.8]),

        ("2.5.7. Bảng chat_conversations và chat_messages", "Bảng 2.5.7 Bảng chat_conversations",
         ["Tên trường", "Kiểu dữ liệu", "Ràng buộc", "Mô tả"],
         [
             ["id",         "UUID",         "PK",                               "Mã cuộc trò chuyện"],
             ["user_id",    "UUID",         "FK → users.id",                    "Người dùng"],
             ["title",      "VARCHAR(255)", "DEFAULT 'New Conversation'",       "Tiêu đề hội thoại"],
             ["created_at", "TIMESTAMP",    "DEFAULT NOW()",                    "Thời gian tạo"],
         ],
         [3.0, 3.5, 4.0, 6.5]),

        ("2.5.8. Bảng refresh_tokens", "Bảng 2.5.8 Bảng refresh_tokens",
         ["Tên trường", "Kiểu dữ liệu", "Ràng buộc", "Mô tả"],
         [
             ["id",          "UUID",         "PK",                  "Mã token"],
             ["token",       "VARCHAR",      "UNIQUE",              "Refresh token (httpOnly cookie)"],
             ["user_id",     "UUID",         "FK → users.id",       "Chủ sở hữu token"],
             ["device_id",   "VARCHAR(255)", "NULLABLE",            "ID thiết bị gắn token"],
             ["is_revoked",  "BOOLEAN",      "DEFAULT FALSE",       "Token đã bị thu hồi chưa"],
             ["expires_at",  "TIMESTAMP",    "NOT NULL",            "Hết hạn (mặc định 7 ngày)"],
             ["created_at",  "TIMESTAMP",    "DEFAULT NOW()",       "Thời gian tạo"],
         ],
         [3.5, 3.0, 3.5, 7.0]),

        ("2.5.9. Bảng mfa_secrets", "Bảng 2.5.9 Bảng mfa_secrets (Two-Factor Authentication)",
         ["Tên trường", "Kiểu dữ liệu", "Ràng buộc", "Mô tả"],
         [
             ["id",                "UUID",         "PK",                "Mã bản ghi MFA"],
             ["user_id",           "UUID",         "UNIQUE, FK → users.id", "Người dùng (1-1)"],
             ["secret_encrypted",  "VARCHAR",      "NOT NULL",          "TOTP secret (mã hoá AES-256-GCM)"],
             ["backup_codes",      "JSON",         "DEFAULT []",        "10 backup codes hashed bcrypt"],
             ["is_enabled",        "BOOLEAN",      "DEFAULT FALSE",     "MFA đã bật chưa"],
             ["created_at",        "TIMESTAMP",    "DEFAULT NOW()",     "Thời gian khởi tạo MFA"],
         ],
         [3.5, 2.8, 3.5, 7.2]),

        ("2.5.10. Bảng oauth_accounts", "Bảng 2.5.10 Bảng oauth_accounts (Liên kết OAuth)",
         ["Tên trường", "Kiểu dữ liệu", "Ràng buộc", "Mô tả"],
         [
             ["id",            "UUID",         "PK",                "Mã liên kết"],
             ["user_id",       "UUID",         "FK → users.id",     "User trong hệ thống"],
             ["provider",      "VARCHAR(50)",  "NOT NULL",          "google / github"],
             ["provider_id",   "VARCHAR(255)", "NOT NULL",          "ID người dùng từ provider"],
             ["email",         "VARCHAR(255)", "NULLABLE",          "Email từ provider"],
             ["access_token",  "VARCHAR",      "NULLABLE",          "Access token (encrypted)"],
             ["created_at",    "TIMESTAMP",    "DEFAULT NOW()",     "Thời gian liên kết"],
         ],
         [3.0, 3.0, 3.2, 7.8]),

        ("2.5.11. Bảng audit_logs", "Bảng 2.5.11 Bảng audit_logs (Nhật ký bảo mật)",
         ["Tên trường", "Kiểu dữ liệu", "Ràng buộc", "Mô tả"],
         [
             ["id",          "UUID",         "PK",                  "Mã log"],
             ["user_id",     "UUID",         "FK → users.id (nullable)", "User thực hiện (null = system)"],
             ["action",      "VARCHAR(100)", "NOT NULL",            "Loại hành động (LOGIN, MFA_ENABLE,...)"],
             ["resource",    "VARCHAR(255)", "NULLABLE",            "Tài nguyên bị tác động"],
             ["ip_address",  "VARCHAR(45)",  "NULLABLE",            "IPv4 / IPv6"],
             ["user_agent",  "VARCHAR(500)", "NULLABLE",            "User-Agent của browser"],
             ["metadata",    "JSON",         "DEFAULT {}",          "Thông tin bổ sung (request body, kết quả)"],
             ["created_at",  "TIMESTAMP",    "DEFAULT NOW()",       "Thời gian xảy ra"],
         ],
         [3.0, 3.0, 3.5, 7.5]),

        ("2.5.12. Bảng user_streaks", "Bảng 2.5.12 Bảng user_streaks (Theo dõi học tập theo ngày)",
         ["Tên trường", "Kiểu dữ liệu", "Ràng buộc", "Mô tả"],
         [
             ["id",                "UUID",         "PK",                       "Mã bản ghi"],
             ["user_id",           "UUID",         "FK → users.id",            "Người học"],
             ["date",              "VARCHAR(10)",  "UNIQUE [user_id, date]",   "Ngày (YYYY-MM-DD)"],
             ["xp_earned",         "INT",          "DEFAULT 0",                "Tổng XP kiếm được trong ngày"],
             ["minutes_studied",   "INT",          "DEFAULT 0",                "Số phút học trong ngày"],
         ],
         [3.5, 3.0, 4.0, 6.5]),

        ("2.5.13. Bảng badges và user_badges", "Bảng 2.5.13 Bảng badges (Định nghĩa huy hiệu)",
         ["Tên trường", "Kiểu dữ liệu", "Ràng buộc", "Mô tả"],
         [
             ["id",          "UUID",         "PK",                "Mã huy hiệu"],
             ["name",        "VARCHAR(100)", "NOT NULL",          "Tên hiển thị (Streak Master, ...)"],
             ["description", "VARCHAR(500)", "DEFAULT ''",        "Mô tả tiêu chí đạt"],
             ["icon_url",    "VARCHAR(500)", "NULLABLE",          "URL icon huy hiệu"],
             ["condition",   "JSON",         "DEFAULT {}",        "Điều kiện đạt (vd: {streak_count: 7})"],
         ],
         [3.0, 3.0, 3.2, 7.8]),

        ("2.5.14. Bảng content_items (CMS)", "Bảng 2.5.14 Bảng content_items – Đơn vị nội dung CMS",
         ["Tên trường", "Kiểu dữ liệu", "Ràng buộc", "Mô tả"],
         [
             ["id",          "UUID",         "PK",                "Mã nội dung"],
             ["type",        "VARCHAR(50)",  "NOT NULL",          "lesson / passage / vocabulary / listening"],
             ["title",       "VARCHAR(255)", "NOT NULL",          "Tiêu đề tiếng Anh"],
             ["title_vi",    "VARCHAR(255)", "DEFAULT ''",        "Tiêu đề tiếng Việt"],
             ["level",       "VARCHAR(10)",  "DEFAULT 'A1'",      "CEFR / JLPT / HSK level"],
             ["category",    "VARCHAR(100)", "DEFAULT ''",        "Chủ đề (travel, food, business,...)"],
             ["content",     "TEXT",         "DEFAULT ''",        "Nội dung chính (markdown)"],
             ["data",        "JSON",         "DEFAULT {}",        "Metadata bổ sung (vocab list, audio info)"],
             ["questions",   "JSON",         "DEFAULT []",        "Comprehension questions"],
             ["audio_url",   "VARCHAR(500)", "DEFAULT ''",        "URL file âm thanh (cho listening)"],
             ["word_count",  "INT",          "DEFAULT 0",         "Số từ trong nội dung"],
             ["published",   "BOOLEAN",      "DEFAULT TRUE",      "Hiển thị / ẩn (draft)"],
             ["sort_order",  "INT",          "DEFAULT 0",         "Thứ tự hiển thị"],
             ["created_at",  "TIMESTAMP",    "DEFAULT NOW()",     "Thời gian tạo"],
         ],
         [3.0, 3.0, 3.0, 8.0]),

        ("2.5.15. Bảng device_fingerprints và user_devices", "Bảng 2.5.15 Bảng user_devices",
         ["Tên trường", "Kiểu dữ liệu", "Ràng buộc", "Mô tả"],
         [
             ["id",                "UUID",         "PK",                       "Mã thiết bị nội bộ"],
             ["user_id",           "UUID",         "FK → users.id",            "Người sở hữu"],
             ["device_id",         "VARCHAR(255)", "UNIQUE",                   "Fingerprint hash duy nhất"],
             ["device_name",       "VARCHAR(255)", "NULLABLE",                 "Tên thân thiện (iPhone của An)"],
             ["browser",           "VARCHAR(100)", "NULLABLE",                 "Chrome / Edge / Safari ..."],
             ["os",                "VARCHAR(100)", "NULLABLE",                 "Windows / macOS / iOS / Android"],
             ["is_trusted",        "BOOLEAN",      "DEFAULT FALSE",            "Thiết bị đã được mark trusted (skip MFA)"],
             ["last_used_at",      "TIMESTAMP",    "NULLABLE",                 "Lần đăng nhập gần nhất"],
             ["created_at",        "TIMESTAMP",    "DEFAULT NOW()",            "Thời gian thêm thiết bị"],
         ],
         [3.5, 3.0, 3.5, 7.0]),
    ]

    for title, caption, headers, rows, widths in db_tables:
        add_heading(doc, title, level=3)
        make_table(doc, headers=headers, rows=rows, col_widths_cm=widths, caption=caption)

    add_page_break(doc)

    # ══════════════════════════════════════════════════════════════════════════
    # CHƯƠNG 3
    # ══════════════════════════════════════════════════════════════════════════
    add_heading(doc, "CHƯƠNG 3. MÔ TẢ GIAO DIỆN", level=1)
    add_heading(doc, "3.1. Giao diện người học", level=2)

    screens = [
        ("3.1.1. Trang đăng nhập / Đăng ký", "Hình 3.1.1 – Màn hình đăng nhập", "Bảng 3.1.1 Mô tả màn hình trang đăng nhập / đăng ký",
         [["STT","Tên","Chức năng"],
          ["1","Email","Nhập địa chỉ email đã đăng ký"],
          ["2","Mật khẩu","Nhập mật khẩu tài khoản"],
          ["3","Đăng nhập Google","Đăng nhập qua tài khoản Google (OAuth 2.0)"],
          ["4","Đăng nhập GitHub","Đăng nhập qua tài khoản GitHub (OAuth 2.0)"],
          ["5","Quên mật khẩu","Yêu cầu đặt lại mật khẩu qua email xác nhận"],
          ["6","Đăng ký","Chuyển hướng đến trang tạo tài khoản mới"],
         ], [1.5, 4.0, 11.5]),

        ("3.1.2. Dashboard – Trang chủ người học", "Hình 3.1.2 – Màn hình Dashboard", "Bảng 3.1.2 Mô tả màn hình Dashboard",
         [["STT","Tên","Chức năng"],
          ["1","Streak hiện tại","Hiển thị số ngày học liên tiếp cùng biểu tượng lửa"],
          ["2","Tổng XP","Tổng điểm kinh nghiệm tích lũy"],
          ["3","Thẻ đến hạn ôn","Số thẻ cần ôn hôm nay theo lịch SRS"],
          ["4","Bắt đầu ôn tập","Nút bấm chuyển đến màn hình ôn tập SRS"],
          ["5","Bộ thẻ của tôi","Danh sách các deck của người học"],
          ["6","Tiến trình tuần","Biểu đồ hoạt động học tập trong 7 ngày qua"],
          ["7","Huy hiệu gần đây","Các badge mới đạt được gần đây"],
         ], [1.5, 4.0, 11.5]),

        ("3.1.3. Quản lý Deck (Bộ thẻ)", "Hình 3.1.3 – Màn hình quản lý Deck", "Bảng 3.1.3 Mô tả màn hình quản lý Deck",
         [["STT","Tên","Chức năng"],
          ["1","Tạo Deck mới","Mở form tạo bộ thẻ mới (tiêu đề, ngôn ngữ, cấp độ CEFR)"],
          ["2","Danh sách Deck","Hiển thị tất cả deck của người học kèm thống kê"],
          ["3","Số lượng thẻ","Hiển thị số thẻ và số thẻ đến hạn ôn trong deck"],
          ["4","Chỉnh sửa","Mở form chỉnh sửa thông tin deck"],
          ["5","Xóa Deck","Xóa deck và tất cả thẻ bên trong (có xác nhận)"],
          ["6","Mở Deck","Xem và quản lý các flashcard trong deck"],
         ], [1.5, 4.0, 11.5]),

        ("3.1.4. Màn hình ôn tập SRS Flashcard", "Hình 3.1.4 – Màn hình ôn tập SRS Flashcard", "Bảng 3.1.4 Mô tả màn hình ôn tập SRS Flashcard",
         [["STT","Tên","Chức năng"],
          ["1","Mặt trước thẻ","Hiển thị từ/câu cần học kèm nút phát âm IPA"],
          ["2","Lật thẻ","Lật sang mặt sau xem nghĩa, ví dụ, hình ảnh"],
          ["3","Lại (Again)","Đánh giá chất lượng nhớ = 0 (quên hoàn toàn, ôn lại ngay)"],
          ["4","Khó (Hard)","Đánh giá chất lượng nhớ = 1–2 (interval giảm)"],
          ["5","Ổn (Good)","Đánh giá chất lượng nhớ = 3–4 (interval bình thường)"],
          ["6","Dễ (Easy)","Đánh giá chất lượng nhớ = 5 (interval tăng mạnh)"],
          ["7","Tiến trình phiên","Thanh tiến độ: thẻ đã ôn / tổng thẻ cần ôn hôm nay"],
         ], [1.5, 4.0, 11.5]),

        ("3.1.5. Màn hình làm Quiz", "Hình 3.1.5 – Màn hình làm Quiz", "Bảng 3.1.5 Mô tả màn hình làm Quiz",
         [["STT","Tên","Chức năng"],
          ["1","Câu hỏi","Hiển thị câu hỏi trắc nghiệm (MCQ) hoặc điền từ"],
          ["2","Đáp án A/B/C/D","Các lựa chọn đáp án cho câu hỏi MCQ"],
          ["3","Đồng hồ đếm ngược","Hiển thị thời gian còn lại của bài quiz"],
          ["4","Thanh tiến độ","Câu hiện tại / tổng số câu trong bài"],
          ["5","Nộp bài","Xác nhận nộp bài và chuyển sang màn hình kết quả"],
          ["6","Giải thích","Hiển thị đáp án đúng và giải thích chi tiết sau khi nộp"],
         ], [1.5, 4.0, 11.5]),

        ("3.1.6. Màn hình luyện viết AI", "Hình 3.1.6 – Màn hình luyện viết AI", "Bảng 3.1.6 Mô tả màn hình luyện viết AI",
         [["STT","Tên","Chức năng"],
          ["1","Đề bài / Prompt","Hiển thị chủ đề hoặc gợi ý viết được AI tạo ra"],
          ["2","Khung nhập bài viết","Vùng soạn thảo bài viết của người học"],
          ["3","Nộp bài","Gửi bài viết đến AI microservice để phân tích"],
          ["4","Phản hồi AI","Nhận xét chi tiết về ngữ pháp, từ vựng, mạch văn"],
          ["5","Điểm số","Điểm tổng và điểm theo từng tiêu chí đánh giá"],
          ["6","Lịch sử bài viết","Xem các bài viết và phản hồi AI trước đó"],
         ], [1.5, 4.0, 11.5]),

        ("3.1.7. Màn hình luyện đọc AI", "Hình 3.1.7 – Màn hình luyện đọc AI", "Bảng 3.1.7 Mô tả màn hình luyện đọc AI",
         [["STT","Tên","Chức năng"],
          ["1","Chọn chủ đề & Cấp độ","Chọn topic và CEFR level cho đoạn đọc AI sẽ tạo"],
          ["2","Tạo bài đọc","Yêu cầu AI tạo đoạn văn theo thông số đã chọn"],
          ["3","Đoạn văn","Hiển thị đoạn đọc được tạo bởi Groq LLM"],
          ["4","Từ vựng nổi bật","Danh sách từ vựng quan trọng trong bài với định nghĩa"],
          ["5","Câu hỏi hiểu bài","Các câu hỏi comprehension để kiểm tra độ hiểu"],
          ["6","Xem đáp án","Hiển thị đáp án và giải thích chi tiết"],
         ], [1.5, 4.0, 11.5]),

        ("3.1.8. Màn hình AI Chat Tutor", "Hình 3.1.8 – Màn hình AI Chat Tutor", "Bảng 3.1.8 Mô tả màn hình AI Chat Tutor",
         [["STT","Tên","Chức năng"],
          ["1","Danh sách hội thoại","Hiển thị các cuộc hội thoại đã lưu với AI Tutor"],
          ["2","Tạo hội thoại mới","Bắt đầu cuộc trò chuyện mới với AI Tutor"],
          ["3","Khung nhắn tin","Vùng hiển thị lịch sử tin nhắn (user + AI)"],
          ["4","Ô nhập tin nhắn","Nhập tin nhắn bằng ngôn ngữ đang học"],
          ["5","Gửi","Gửi tin nhắn và nhận phản hồi từ AI (hỗ trợ streaming)"],
          ["6","Chế độ học","Chọn chủ đề/kịch bản hội thoại (mua sắm, du lịch, công việc,...)"],
         ], [1.5, 4.0, 11.5]),

        ("3.1.9. Màn hình Vocabulary", "Hình 3.1.9 – Màn hình từ vựng theo chủ đề", "Bảng 3.1.9 Mô tả màn hình Vocabulary",
         [["STT","Tên","Chức năng"],
          ["1","Bộ sưu tập chủ đề","Danh sách các bộ từ vựng theo topic (Travel, Food, Business,...)"],
          ["2","Bộ lọc level CEFR","Lọc theo cấp độ A1-C2"],
          ["3","Thẻ từ vựng","Hiển thị từ + IPA + nghĩa + ví dụ + phát âm TTS"],
          ["4","Thêm vào Deck","Lưu từ này vào một deck flashcard cá nhân để ôn SRS"],
          ["5","Đánh dấu đã thuộc","Mark từ là \"đã biết\" để loại khỏi gợi ý ôn tập"],
         ], [1.5, 4.0, 11.5]),

        ("3.1.10. Màn hình Listening", "Hình 3.1.10 – Màn hình luyện nghe", "Bảng 3.1.10 Mô tả màn hình Listening",
         [["STT","Tên","Chức năng"],
          ["1","Danh sách bài nghe","Bài nghe được phân theo level CEFR"],
          ["2","Audio player","Phát/tạm dừng/tua/tốc độ phát (0.5x-2x)"],
          ["3","Script hiện/ẩn","Toggle hiển thị script transcript của bài"],
          ["4","Câu hỏi hiểu","Câu hỏi MCQ kiểm tra độ hiểu nội dung"],
          ["5","Từ vựng nổi bật","Highlight các từ khó kèm popup nghĩa"],
          ["6","Kết quả & XP","Tính điểm + cộng XP khi hoàn thành"],
         ], [1.5, 4.0, 11.5]),

        ("3.1.11. Màn hình Translation", "Hình 3.1.11 – Màn hình luyện dịch", "Bảng 3.1.11 Mô tả màn hình Translation",
         [["STT","Tên","Chức năng"],
          ["1","Câu nguồn (Tiếng Việt)","Hiển thị câu cần dịch"],
          ["2","Khung nhập","Người học nhập bản dịch sang ngôn ngữ đích"],
          ["3","Submit","Gửi cho AI chấm độ chính xác"],
          ["4","Đáp án mẫu","Hiển thị bản dịch tham khảo của hệ thống"],
          ["5","Phân tích lỗi AI","AI chỉ ra điểm sai về ngữ pháp / từ vựng / cấu trúc"],
          ["6","Câu tiếp theo","Chuyển sang câu mới trong cùng chủ đề"],
         ], [1.5, 4.0, 11.5]),

        ("3.1.12. Màn hình Speed Review", "Hình 3.1.12 – Màn hình ôn nhanh", "Bảng 3.1.12 Mô tả màn hình Speed Review",
         [["STT","Tên","Chức năng"],
          ["1","Đồng hồ đếm ngược","Hiển thị thời gian còn lại (mặc định 5 phút / 60 thẻ)"],
          ["2","Thẻ hiện tại","Hiển thị mặt trước thẻ; tap để lật"],
          ["3","Đúng / Sai","Đánh giá nhanh 2 lựa chọn (skip thang Again/Hard/Good/Easy)"],
          ["4","Thanh tiến độ","Số thẻ đã làm / tổng thẻ"],
          ["5","Kết quả phiên","Số đúng, sai, độ chính xác và XP nhận được"],
         ], [1.5, 4.0, 11.5]),

        ("3.1.13. Màn hình Difficult Words", "Hình 3.1.13 – Màn hình từ khó cần ôn", "Bảng 3.1.13 Mô tả màn hình Difficult Words",
         [["STT","Tên","Chức năng"],
          ["1","Danh sách từ khó","Các thẻ có retrievability < 70% (FSRS dự đoán đang quên)"],
          ["2","Sắp xếp","Theo mức độ quên, deck, lần ôn cuối"],
          ["3","Bộ lọc deck","Lọc theo deck cụ thể"],
          ["4","Ôn lại","Bắt đầu phiên ôn chỉ gồm các thẻ đang ở trạng thái khó"],
          ["5","Xem chi tiết SRS","Hiện stability, difficulty, lịch sử quality"],
         ], [1.5, 4.0, 11.5]),

        ("3.1.14. Màn hình Goals & Streak", "Hình 3.1.14 – Màn hình mục tiêu và streak", "Bảng 3.1.14 Mô tả màn hình Goals",
         [["STT","Tên","Chức năng"],
          ["1","Streak hiện tại","Hiển thị số ngày liên tiếp + biểu tượng lửa"],
          ["2","Lịch streak","Calendar heat-map 90 ngày theo XP/ngày"],
          ["3","Mục tiêu hôm nay","Đặt thẻ ôn / phút học mỗi ngày + thanh tiến độ"],
          ["4","Daily Check-in","Nút điểm danh để giữ streak + nhận XP thưởng"],
          ["5","Lời nhắc","Cảnh báo nếu sắp mất streak (sau 22:00)"],
          ["6","Thành tích","Streak dài nhất, tổng ngày học, tổng XP"],
         ], [1.5, 4.0, 11.5]),

        ("3.1.15. Màn hình Leaderboard", "Hình 3.1.15 – Bảng xếp hạng", "Bảng 3.1.15 Mô tả màn hình Leaderboard",
         [["STT","Tên","Chức năng"],
          ["1","Tab thời gian","Tuần / Tháng / Tất cả thời gian"],
          ["2","Tab tiêu chí","Xếp theo XP / Streak / Số thẻ ôn"],
          ["3","Top 10","Avatar + tên + chỉ số người đứng đầu"],
          ["4","Vị trí của bạn","Hiển thị thứ hạng cá nhân (vd: Top 25%)"],
          ["5","Đẩy hạng","Gợi ý cần thêm bao nhiêu XP để lên hạng kế"],
         ], [1.5, 4.0, 11.5]),

        ("3.1.16. Màn hình Hub Tiếng Nhật / Tiếng Trung", "Hình 3.1.16 – Hub học ngôn ngữ chuyên biệt",
         "Bảng 3.1.16 Mô tả màn hình Hub ngôn ngữ chuyên biệt",
         [["STT","Tên","Chức năng"],
          ["1","Header ngôn ngữ","Cờ + tên ngôn ngữ + số bài học có sẵn"],
          ["2","Card Vocabulary","Vocabulary theo JLPT (N5-N1) hoặc HSK (1-6)"],
          ["3","Card Grammar","Trợ từ, thể động từ, mẫu câu tiếng Nhật / pinyin tiếng Trung"],
          ["4","Card Translation","Việt ↔ Nhật / Trung theo chủ đề"],
          ["5","Card Reading","Bài đọc phân theo level"],
          ["6","Tiến trình","Phần trăm hoàn thành mỗi cụm tính năng"],
         ], [1.5, 4.0, 11.5]),

        ("3.1.17. Màn hình MFA Setup & Device Management", "Hình 3.1.17 – Bảo mật tài khoản",
         "Bảng 3.1.17 Mô tả màn hình bảo mật cá nhân",
         [["STT","Tên","Chức năng"],
          ["1","QR Code","Quét bằng Google Authenticator / Authy / Microsoft Authenticator"],
          ["2","Manual key","Nhập tay TOTP secret nếu không quét được QR"],
          ["3","Confirm 6 chữ số","Xác nhận TOTP để kích hoạt MFA"],
          ["4","Backup codes","Lưu 10 mã dự phòng (1 lần dùng) để khôi phục"],
          ["5","Danh sách thiết bị","Liệt kê thiết bị đang đăng nhập + ngày dùng cuối"],
          ["6","Mark trusted","Đánh dấu thiết bị tin cậy (skip MFA lần sau)"],
          ["7","Logout từ xa","Đăng xuất 1 thiết bị / tất cả thiết bị khác"],
         ], [1.5, 4.0, 11.5]),
    ]

    for title, fig, cap, data, widths in screens:
        add_heading(doc, title, level=3)
        hdr = data[0]
        rows = data[1:]
        make_table(doc, headers=hdr, rows=rows, col_widths_cm=widths, caption=cap)

    add_heading(doc, "3.2. Giao diện quản trị viên", level=2)
    admin_screens = [
        ("3.2.1. Quản lý người dùng", "Hình 3.2.1 – Màn hình quản lý người dùng",
         "Bảng 3.2.1 Mô tả màn hình quản lý người dùng",
         [["STT","Tên","Chức năng"],
          ["1","Dashboard","Trang tổng quan Admin với các số liệu tóm tắt"],
          ["2","Quản lý người dùng","Danh sách tất cả tài khoản người dùng trong hệ thống"],
          ["3","Thanh tìm kiếm","Tìm kiếm người dùng theo email/tên"],
          ["4","Bộ lọc","Lọc theo trạng thái tài khoản, ngày đăng ký, role"],
          ["5","Xem chi tiết","Xem thông tin chi tiết và lịch sử học tập của người dùng"],
          ["6","Khóa/Mở khóa","Vô hiệu hóa hoặc kích hoạt lại tài khoản"],
          ["7","Xuất Excel","Xuất danh sách người dùng ra file Excel"],
         ]),
        ("3.2.2. Thống kê hệ thống", "Hình 3.2.2 – Màn hình thống kê hệ thống",
         "Bảng 3.2.2 Mô tả màn hình thống kê hệ thống",
         [["STT","Tên","Chức năng"],
          ["1","Tổng người dùng","Số lượng tài khoản đã đăng ký trên hệ thống"],
          ["2","Người dùng hoạt động","Số người có hoạt động học tập trong 30 ngày qua"],
          ["3","Tổng lượt ôn tập","Tổng số thẻ flashcard đã được ôn tập toàn hệ thống"],
          ["4","Biểu đồ đăng ký","Biểu đồ cột theo ngày/tuần/tháng"],
          ["5","Top languages","Ngôn ngữ học phổ biến nhất trên nền tảng"],
          ["6","Thống kê AI usage","Số lượt sử dụng tính năng AI (writing/reading/chat)"],
         ]),
        ("3.2.3. Quản lý nội dung CMS", "Hình 3.2.3 – Màn hình quản lý CMS",
         "Bảng 3.2.3 Mô tả màn hình quản lý nội dung CMS",
         [["STT","Tên","Chức năng"],
          ["1","Bảng content_items","Danh sách bài học, đoạn đọc, từ vựng, listening đã đăng"],
          ["2","Bộ lọc type","Lọc theo loại nội dung: lesson / passage / vocabulary / listening"],
          ["3","Bộ lọc level","Lọc theo CEFR / JLPT / HSK level"],
          ["4","Tạo nội dung mới","Form tạo bài: nhập title, type, level, category, content (markdown)"],
          ["5","Editor JSON","Soạn questions[], data{} bằng JSON editor có validation"],
          ["6","Upload audio","Tải file MP3/WAV cho bài listening"],
          ["7","Toggle Published","Bật/tắt hiển thị nội dung trên frontend"],
          ["8","Sort order","Kéo thả thay đổi thứ tự hiển thị trên trang user"],
          ["9","Xoá","Xoá nội dung kèm xác nhận an toàn"],
         ]),
        ("3.2.4. Audit Log & Bảo mật", "Hình 3.2.4 – Màn hình audit log",
         "Bảng 3.2.4 Mô tả màn hình audit log",
         [["STT","Tên","Chức năng"],
          ["1","Bảng audit_logs","Liệt kê các hành động bảo mật quan trọng (90 ngày gần nhất)"],
          ["2","Bộ lọc action","LOGIN_SUCCESS / LOGIN_FAILED / MFA_ENABLE / PASSWORD_CHANGE / ..."],
          ["3","Bộ lọc user/IP","Tra theo user_id, email hoặc địa chỉ IP cụ thể"],
          ["4","Khoảng thời gian","Date range picker theo ngày"],
          ["5","Xem chi tiết","Modal hiện metadata JSON của log entry"],
          ["6","Xuất CSV","Export bộ lọc hiện tại ra file CSV"],
         ]),
    ]
    for title, fig, cap, data in admin_screens:
        add_heading(doc, title, level=3)
        hdr = data[0]
        rows = data[1:]
        make_table(doc, headers=hdr, rows=rows,
                   col_widths_cm=[1.5, 4.0, 11.5], caption=cap)

    add_page_break(doc)

    # ══════════════════════════════════════════════════════════════════════════
    # CHƯƠNG 4
    # ══════════════════════════════════════════════════════════════════════════
    add_heading(doc, "CHƯƠNG 4. KẾT QUẢ DỰ ÁN", level=1)
    add_heading(doc, "4.1. Giới thiệu sản phẩm", level=2)
    add_body(doc,
        "LinguaAI là một nền tảng học ngôn ngữ thông minh toàn diện, cung cấp trải nghiệm "
        "học tập cá nhân hóa thông qua sự kết hợp giữa khoa học nhận thức và trí tuệ nhân tạo. "
        "Nền tảng được xây dựng trên kiến trúc microservices hiện đại với ba thành phần chính:")
    for bold_part, rest in [
        ("Backend API (NestJS 10.4): ", "Xử lý toàn bộ logic nghiệp vụ, quản lý xác thực (JWT + OAuth), điều phối giữa các module. Hỗ trợ WebSocket real-time và REST API cho toàn bộ tính năng học tập."),
        ("Frontend (Next.js 15.1): ", "Giao diện người dùng hiện đại với App Router, SSR, đa ngôn ngữ (en/vi/ja/ko/zh) và responsive design cho mọi thiết bị."),
        ("AI Microservice (FastAPI): ", "Xử lý tính năng AI: phân tích bài viết, tạo đoạn đọc hiểu, giải thích ngữ pháp và chatbot, sử dụng Groq Cloud LPU."),
    ]:
        add_bullet(doc, rest, bold_prefix=bold_part)

    add_body(doc, "Tính năng chính đã hoàn thành (51 tính năng, chia 7 nhóm):")
    add_bullet(doc, "Xác thực & Quản lý tài khoản (8):", bold_prefix="A. ")
    for t in [
        "Đăng ký + xác thực email qua link verify-email kèm token hashed.",
        "Đăng nhập Local (email + bcrypt) trả JWT 15 phút + refresh token 7 ngày (httpOnly cookie).",
        "Đăng nhập OAuth 2.0 Google + GitHub (Passport.js strategies) + tự động liên kết tài khoản.",
        "Refresh Token Rotation: token cũ revoke ngay khi cấp token mới.",
        "Quên mật khẩu / Reset password / Đổi password + lịch sử password chống tái sử dụng.",
        "MFA TOTP (Two-Factor Authentication) với QR code + 10 backup codes hashed.",
        "Quản lý thiết bị: device fingerprint, mark trusted, danh sách phiên đang hoạt động, logout từ xa.",
        "Câu hỏi bảo mật + Audit Logs + Login History (90 ngày) + Login Attempts brute-force detection.",
    ]:
        add_bullet(doc, "  – " + t)

    add_bullet(doc, "Học tập cốt lõi – Flashcard / SRS / Quiz (10):", bold_prefix="B. ")
    for t in [
        "CRUD Deck + Card (front/back/IPA/audio/image/example) gắn ngôn ngữ + level CEFR/JLPT/HSK.",
        "FSRS-4.5 (Free Spaced Repetition Scheduler) cài đặt đầy đủ với 17 weight parameters.",
        "Tính retrievability theo công thức R(t,S) = (1 + 0.2346·t/S)^(-0.5).",
        "Mỗi lần review tính lại stability, difficulty, interval theo grade 1-4 (Again/Hard/Good/Easy).",
        "Speed Review mode (60 thẻ / 5 phút) cho thẻ đã ổn định.",
        "Difficult Words list — tự động sinh từ retrievability < 70%.",
        "Retention Dashboard hiển thị thẻ đang quên + tỷ lệ ghi nhớ theo deck.",
        "SRS Forecast 30 ngày tới — số thẻ sẽ đến hạn mỗi ngày.",
        "Quiz Engine: tạo manual hoặc bằng AI từ topic, MCQ + fill-in, chấm tự động.",
        "Adaptive Quiz: câu kế tiếp tự điều chỉnh difficulty theo % đúng (3 mức rate).",
    ]:
        add_bullet(doc, "  – " + t)

    add_bullet(doc, "Tính năng AI (8 endpoint):", bold_prefix="C. ")
    for t in [
        "/ai/writing/assess — chấm bài viết theo 4 tiêu chí + sửa lỗi cụ thể.",
        "/ai/reading/generate — tạo đoạn đọc CEFR + vocab + comprehension Qs.",
        "/ai/grammar/explain — giải thích quy tắc ngữ pháp bằng tiếng mẹ đẻ.",
        "/ai/chat — đối thoại với Tutor; có /ai/chat/stream cho streaming response (SSE).",
        "/ai/content/generate-cards — sinh flashcard từ topic/đoạn văn cho trước.",
        "/ai/content/generate-quiz-questions — sinh trọn bộ câu hỏi quiz.",
        "/ai/errors/analyze — phân tích danh sách lỗi user mắc + gợi ý chủ đề ôn.",
        "/ai/nlp/analyze — phân tích NLP đoạn văn (POS, lemma, độ phức tạp).",
    ]:
        add_bullet(doc, "  – " + t)

    add_bullet(doc, "Học theo ngôn ngữ chuyên biệt (7 module):", bold_prefix="D. ")
    for t in [
        "Hub English — Flashcard, Vocabulary, Writing, Reading, Grammar, Listening, Speaking, Translation, Chat.",
        "Hub tiếng Nhật — Vocabulary JLPT N5-N1, Kanji, Grammar (trợ từ/thể), Reading, Translation Việt-Nhật.",
        "Hub tiếng Trung — Vocabulary HSK 1-6, Pinyin, Grammar, Reading, Translation Việt-Trung.",
        "Listening module — audio + script + comprehension questions.",
        "Translation module — Việt → ngôn ngữ đích, AI chấm độ chính xác.",
        "Speaking module — pipeline 5 phase: ghi âm MediaRecorder → WebSocket → Groq "
        "Whisper-large-v3 (STT) → Llama 3.3 70B streaming chấm 5 tiêu chí 0-100 "
        "(overall, pronunciation, fluency, grammar, vocabulary) + topic generator.",
        "Chuyển đổi ngôn ngữ học liền mạch trên sidebar (Zustand store, persisted).",
    ]:
        add_bullet(doc, "  – " + t)

    add_bullet(doc, "Gamification & Social (7):", bold_prefix="E. ")
    for t in [
        "XP system — cộng điểm theo từng hoạt động (review, quiz, AI feedback,...).",
        "Streak counter — đếm ngày học liên tiếp; reset nếu bỏ ngày; cảnh báo trước nửa đêm.",
        "Daily Goal tracker — đặt thẻ/phút mục tiêu mỗi ngày + progress bar.",
        "Daily Check-in — điểm danh đầu ngày để giữ streak + nhận XP thưởng.",
        "Badges system — định nghĩa qua JSON condition + tự động award khi đạt.",
        "Leaderboard — xếp hạng theo XP/streak; lọc tuần/tháng/all-time.",
        "Notifications — thông báo trong app (thẻ đến hạn, streak risk, badge mới,...).",
    ]:
        add_bullet(doc, "  – " + t)

    add_bullet(doc, "CMS & Quản trị (6):", bold_prefix="F. ")
    for t in [
        "Admin Dashboard với metric tổng quan toàn hệ thống.",
        "Quản lý người dùng: tìm kiếm, lọc, xem chi tiết, khoá/mở khoá, xuất Excel.",
        "CMS content_items: lesson, passage, vocabulary, listening (CRUD + draft/publish).",
        "Phân loại nội dung theo CEFR / JLPT / HSK level + category + sort_order.",
        "Audit log viewer + filter theo action/user/IP/date range.",
        "Cấu hình huy hiệu (badges) qua JSON condition.",
    ]:
        add_bullet(doc, "  – " + t)

    add_bullet(doc, "Hạ tầng & Bảo mật chéo (5):", bold_prefix="G. ")
    for t in [
        "Đa ngôn ngữ giao diện 5 thứ tiếng: English, Tiếng Việt, 日本語, 한국어, 中文.",
        "Rate limiting (NestJS Throttler + Redis-based RateLimiterService).",
        "CSRF protection + CAPTCHA service (Redis-backed).",
        "Health checks: /health/live (liveness) + /health/ready (Postgres + Redis).",
        "Containerization full stack: Docker + Docker Compose; Turborepo monorepo + pnpm workspaces.",
    ]:
        add_bullet(doc, "  – " + t)

    add_heading(doc, "4.2. Môi trường triển khai", level=2)
    make_table(doc,
        headers=["Thành phần", "Công nghệ / Phiên bản"],
        rows=[
            ["Hệ điều hành",         "Windows 10/11 (dev), Ubuntu 22.04 LTS (Production)"],
            ["Backend Framework",    "NestJS 10 (Node.js 20 LTS) + TypeScript 5"],
            ["Backend ORM",          "Prisma 7 + Prisma Client"],
            ["Backend Auth",         "Passport.js, @nestjs/jwt, bcrypt, otplib (TOTP)"],
            ["Backend Validation",   "class-validator, class-transformer, Joi schema for env"],
            ["Frontend Framework",   "Next.js 15.1 (App Router) + React 19 + TypeScript 5.7"],
            ["Frontend State",       "Zustand 5 (auth, language, learning-language stores)"],
            ["Frontend Styling",     "Tailwind CSS 4 + shadcn/ui + Lucide icons"],
            ["AI Service Framework", "Python 3.12 + FastAPI + Pydantic 2.9 + slowapi (rate limit)"],
            ["AI Models",            "Groq Cloud LPU (llama-3.3-70b-versatile)"],
            ["Database",             "PostgreSQL 16 (Docker container) – 32 bảng, ~50 indexes"],
            ["Cache & Queue",        "Redis 7 (cache, rate-limit, CSRF, CAPTCHA tokens)"],
            ["Email",                "Nodemailer (SMTP) + verification + reset templates"],
            ["Realtime",             "WebSocket (ws + @nestjs/platform-ws) cho Speaking module"],
            ["Containerization",     "Docker 25 + Docker Compose 2.27 (api / web / ai / postgres / redis)"],
            ["Build / Monorepo",     "Turborepo 2 + pnpm workspaces 9 (apps + packages/shared)"],
            ["Testing",              "Jest (backend), Vitest (frontend), Pytest (AI service)"],
            ["IDE",                  "Visual Studio Code + Cursor + GitHub Copilot"],
            ["Version Control",      "Git + GitHub + Conventional Commits"],
        ],
        col_widths_cm=[4.5, 12.5],
        caption="Bảng 4.2 Công nghệ và phiên bản các thành phần",
    )

    add_heading(doc, "4.3. Kết luận kết quả", level=2)
    for bold_part, rest in [
        ("Về mặt kỹ thuật: ", "Hệ thống được thiết kế và triển khai thành công trên kiến trúc microservices. Thuật toán SRS (SM-2 và FSRS) được cài đặt đúng theo tài liệu khoa học. AI microservice với Groq Cloud LPU hoạt động ổn định và cho phản hồi chất lượng."),
        ("Về mặt tính năng: ", "Hệ thống đáp ứng đầy đủ các yêu cầu ban đầu với tất cả tính năng học tập cốt lõi và AI. Giao diện thân thiện, đa ngôn ngữ và responsive."),
        ("Về mặt bảo mật: ", "Áp dụng các biện pháp bảo mật hiện đại: JWT rotation, rate limiting, input sanitization, device fingerprinting và audit logging đầy đủ."),
    ]:
        p = doc.add_paragraph()
        para_format(p, space_after=5)
        add_run_rgb(p, bold_part, bold=True, size=11, color=BLUE_MED)
        add_run_rgb(p, rest, size=11, color=GRAY_TEXT)

    add_page_break(doc)

    # ══════════════════════════════════════════════════════════════════════════
    # CHƯƠNG 5
    # ══════════════════════════════════════════════════════════════════════════
    add_heading(doc, "CHƯƠNG 5. KẾT LUẬN", level=1)
    add_heading(doc, "5.1. Bảng phân chia công việc", level=2)
    make_table(doc,
        headers=["STT", "MSSV", "Họ tên", "Vai trò", "Công việc chính", "% Hoàn thành"],
        rows=[
            ["1", "21520385", "Trần Ngọc Tố Như",  "Trưởng nhóm",
             "Backend domain Auth (JWT/OAuth/MFA/Devices), Users, SRS (FSRS-4.5 + SM-2), "
             "Decks, Cards. CSDL Prisma schema. Cấu hình Docker + Turborepo.\n"
             "Báo cáo: Đề cương, Chương 4, Chương 5.", "100%"],
            ["2", "21520203", "Lê Thùy Dương",  "Thành viên",
             "Frontend Next.js 15: Dashboard, Flashcard UI, SRS UI, Quiz UI, "
             "Vocabulary, Listening, Translation, Speed Review, Difficult Words, "
             "Goals, Leaderboard, MFA + Device Management UI. i18n 5 ngôn ngữ.\n"
             "Báo cáo: Chương 3 (giao diện người học), DM Hình.", "100%"],
            ["3", "21522170", "Trần Thanh Huy",  "Thành viên",
             "AI Microservice FastAPI: 8 endpoints (writing, reading, grammar, chat "
             "+ streaming SSE, content gen, errors, NLP). Tích hợp Groq Cloud LPU. "
             "Sanitize prompt với <user_input> XML.\n"
             "Báo cáo: Chương 2 (Sequence diagrams, ERD chi tiết).", "100%"],
            ["4", "21521998", "Mai Trần Khương Duy",  "Thành viên",
             "Backend domain Quiz (Adaptive), Writing, Reading, Chat, Grammar, "
             "Recommendations, Admin (CMS, audit log), Analytics. Hub Tiếng Trung "
             "+ Tiếng Nhật. Email service + Notifications.\n"
             "Báo cáo: Chương 1, Chương 2 (Activity diagrams), Chương 3 (giao diện admin).", "100%"],
        ],
        col_widths_cm=[1.2, 2.5, 3.0, 2.5, 6.3, 1.5],
        caption="Bảng 5.1.1 Bảng đánh giá phân chia công việc",
    )

    add_heading(doc, "5.2. Ưu điểm và nhược điểm", level=2)
    p = doc.add_paragraph()
    para_format(p, space_after=3, align=WD_ALIGN_PARAGRAPH.LEFT)
    add_run_rgb(p, "Ưu điểm:", bold=True, size=12, color=TEAL)
    for t in [
        "Tích hợp thành công thuật toán SRS thế hệ mới FSRS-4.5 (17 trọng số) bên cạnh SM-2 "
        "cho khả năng tương thích — đáp ứng cả người học mới lẫn nâng cao.",
        "Kiến trúc microservices rõ ràng (3 service: API + Web + AI), tách biệt qua REST + "
        "WebSocket + SSE — dễ scale và thay đổi từng thành phần độc lập.",
        "8 endpoint AI chuyên biệt với rate-limit Redis-backed; tích hợp Groq "
        "Cloud LPU (model llama-3.3-70b-versatile, độ trễ <500ms) mang lại phản hồi AI chất lượng cao với chi phí hợp lý.",
        "Bảo mật cấp doanh nghiệp: JWT rotation, MFA TOTP với backup codes, OAuth 2.0 đa "
        "provider, device fingerprinting, audit logs 90 ngày, login attempts brute-force "
        "detection, password history chống reuse.",
        "Hỗ trợ 3 hub học ngôn ngữ chuyên biệt (Anh / Trung HSK / Nhật JLPT) với module "
        "Vocabulary, Grammar, Reading, Translation riêng biệt — chưa có nền tảng tương tự "
        "hỗ trợ trọn gói cho người Việt.",
        "Giao diện đa ngôn ngữ 5 thứ tiếng + responsive (mobile-first Tailwind) + dark mode.",
        "Gamification đầy đủ: XP, streak, daily check-in, badges (JSON condition), "
        "leaderboard tuần/tháng/all-time — dùng động lực duy trì thói quen.",
        "CMS có cấu trúc rõ ràng (32 bảng, ~50 indexes) cho phép admin quản lý nội dung "
        "lesson/passage/vocabulary/listening đa cấp độ CEFR/JLPT/HSK qua giao diện chuyên biệt.",
        "Adaptive Quiz tự điều chỉnh độ khó câu hỏi tiếp theo theo % đúng — cá nhân hoá "
        "trải nghiệm làm bài mà không cần ML phức tạp.",
        "Monorepo Turborepo + pnpm workspaces giúp chia sẻ types/utils giữa 3 app; mọi "
        "thành phần đều container hoá Docker, sẵn sàng deploy lên môi trường thực tế.",
        "Đáp ứng đầy đủ yêu cầu ban đầu với 51 tính năng đã hoàn thành chia 7 nhóm, "
        "tiến độ đúng hạn (1 học kỳ).",
    ]:
        add_bullet(doc, t)

    p = doc.add_paragraph()
    para_format(p, space_before=8, space_after=3, align=WD_ALIGN_PARAGRAPH.LEFT)
    add_run_rgb(p, "Nhược điểm:", bold=True, size=12, color=RGBColor(0xC0, 0x50, 0x20))
    for t in [
        "Groq Cloud phụ thuộc vào kết nối Internet và có giới hạn quota miễn phí — khi hết "
        "quota, dịch vụ AI tạm thời không khả dụng. Cần có phương án fallback hoặc nâng cấp lên gói trả phí khi triển khai production.",
        "Module Speaking dù đã có STT (Groq Whisper-large-v3) + chấm điểm streaming bằng "
        "Llama 3.3 70B, nhưng điểm \"pronunciation\" được chấm từ transcript chứ chưa phân "
        "tích acoustic feature (phoneme, pitch, stress) như ELSA Speak — nên độ chính xác "
        "phần phát âm còn hạn chế. Cũng chưa lưu audio file để user nghe lại.",
        "Chưa có mobile native app (iOS/Android); chỉ dùng PWA Next.js — hạn chế tính năng "
        "background sync và push notification thực sự.",
        "Recommendations module hiện chỉ heuristic-based (gợi ý theo deck đã học, error "
        "history); chưa có ML model thực sự để xây dựng adaptive learning path toàn diện.",
        "Độ trễ gọi LLM có thể lên tới 3–5 giây cho response đầy đủ khi không dùng streaming — "
        "cần xử lý loading state tốt hơn.",
        "Chưa có tính năng community/social: chia sẻ deck công khai, học theo nhóm, "
        "comment trong bài viết.",
        "Test coverage còn thấp (~30% backend, <10% frontend) do tập trung vào tốc độ "
        "phát triển tính năng. Cần bổ sung E2E tests trước production.",
        "Chưa có CI/CD pipeline tự động — phải build và deploy thủ công qua Docker Compose.",
    ]:
        add_bullet(doc, t)

    add_heading(doc, "5.3. Hướng phát triển", level=2)
    add_heading(doc, "5.3.1. Về hệ thống", level=3)
    for bold_part, rest in [
        ("Pronunciation acoustic analysis: ",
         "Hiện đã có Whisper STT + LLM chấm; cần bổ sung Azure Speech Pronunciation "
         "Assessment (hoặc tự train acoustic model) để chấm phoneme-level theo tiêu "
         "chí ELSA Speak — phân tích pitch, stress, syllable timing chứ không chỉ "
         "judging từ transcript."),
        ("Mobile Native App: ",
         "Phát triển ứng dụng React Native dùng chung shared types từ packages/shared, "
         "cho phép push notification cảnh báo streak và offline review."),
        ("Adaptive Learning Engine: ",
         "Xây dựng ML model dự đoán deck/topic phù hợp dựa trên error history, "
         "retention rate và tốc độ học của user."),
        ("Cộng đồng & Social: ",
         "Public deck marketplace, học theo nhóm (study group), comment trên bài viết "
         "+ peer review giống Busuu, leaderboard nhóm."),
        ("Offline-first PWA: ",
         "Service Worker + IndexedDB cache để học flashcard không cần mạng; sync khi online."),
        ("CI/CD: ",
         "GitHub Actions: chạy lint + test + build tự động; triển khai lên Kubernetes "
         "(k8s) với Helm charts; auto-scaling theo load."),
        ("Observability: ",
         "Tích hợp OpenTelemetry + Grafana + Loki để theo dõi log, metrics, traces; "
         "Sentry cho lỗi runtime."),
        ("Mở rộng ngôn ngữ: ",
         "Thêm hub Tiếng Hàn (TOPIK), Tiếng Pháp (DELF), Tiếng Đức (Goethe-Zertifikat)."),
        ("Mở rộng AI: ",
         "Tích hợp GPT-4o, Claude 3.5, Gemini 1.5 làm tier premium; cache response "
         "phổ biến qua Redis để giảm chi phí."),
        ("Test & Quality: ",
         "Tăng test coverage backend lên 70%, frontend 40%, viết E2E test với Playwright "
         "cho 10 user flow quan trọng nhất."),
    ]:
        add_bullet(doc, rest, bold_prefix=bold_part)

    add_heading(doc, "5.3.2. Về con người", level=3)
    add_body(doc,
        "Nhóm nhận rõ được những kinh nghiệm quý báu từ dự án: việc làm việc trên monorepo "
        "lớn đòi hỏi kỷ luật cao về kiến trúc và quy ước code. Tích hợp AI vào ứng dụng "
        "thực tế phức tạp hơn nhiều so với PoC — cần xử lý streaming, error handling, prompt "
        "engineering cẩn thận. Hệ thống SRS đòi hỏi hiểu sâu về thuật toán và kiểm thử kỹ "
        "lưỡng. Những bài học này là nền tảng quan trọng cho sự phát triển nghề nghiệp của "
        "từng thành viên trong nhóm.")

    # ══════════════════════════════════════════════════════════════════════════
    # TÀI LIỆU THAM KHẢO
    # ══════════════════════════════════════════════════════════════════════════
    # No page break here: the references follow chapter 5 directly, and a
    # trailing break produces a blank page that shifts every cited page.
    build_references(doc)

    # Configure body section: Arabic numerals starting from 1
    setup_section_page_number(body_section, fmt="decimal", start=1,
                               header_text=REPORT_HEADER, show_footer_page=True)

    # Bind every PAGEREF field to the real heading/caption it points at.
    # The field values are then computed by Word/LibreOffice on open/export,
    # so page numbers can never drift from the generated document again.
    resolve_page_refs(doc)

    # ─── Save ──────────────────────────────────────────────────────────────────
    doc.save(OUTPUT)
    print(f"DOCX generated: {OUTPUT}")


if __name__ == "__main__":
    build()
