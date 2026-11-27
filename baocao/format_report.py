import docx
from docx.shared import Inches, Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
import sys
import os
import argparse
from pathlib import Path

# Set standard output to UTF-8 to prevent encoding crashes on Windows
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# Colors
BLUE_DARK   = RGBColor(0x1F, 0x49, 0x7D)   # #1F497D
GRAY_TEXT   = RGBColor(0x40, 0x40, 0x40)
BLACK       = RGBColor(0x00, 0x00, 0x00)
WHITE       = RGBColor(0xFF, 0xFF, 0xFF)

BLUE_D_HEX = "1F497D"
ALT_ROW_HEX = "EBF3FB"
WHITE_HEX  = "FFFFFF"
BORDER_HEX = "B8CCE4"

def set_cell_bg(cell, hex_color: str):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_color)
    tcPr.append(shd)

def set_cell_border(cell, **kwargs):
    """Set cell borders. kwargs: top, bottom, left, right -> dict with sz, val, color"""
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    tcBorders = tcPr.find(qn('w:tcBorders'))
    if tcBorders is None:
        tcBorders = OxmlElement("w:tcBorders")
        tcPr.append(tcBorders)
    for edge, data in kwargs.items():
        # remove old if exists
        old = tcBorders.find(qn(f"w:{edge}"))
        if old is not None:
            tcBorders.remove(old)
        border = OxmlElement(f"w:{edge}")
        border.set(qn("w:val"),   data.get("val", "single"))
        border.set(qn("w:sz"),    data.get("sz", "4"))
        border.set(qn("w:space"), "0")
        border.set(qn("w:color"), data.get("color", "auto"))
        tcBorders.append(border)

def set_cell_margins(cell, top=120, bottom=120, left=160, right=160):
    """Set cell margins in dxa (1 pt = 20 dxa)"""
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    tcMar = OxmlElement('w:tcMar')
    for m, val in [('top', top), ('bottom', bottom), ('left', left), ('right', right)]:
        node = OxmlElement(f'w:{m}')
        node.set(qn('w:w'), str(val))
        node.set(qn('w:type'), 'dxa')
        tcMar.append(node)
    tcPr.append(tcMar)

def insert_section_break_before(doc, paragraph):
    p_prev = None
    for p in doc.paragraphs:
        if p._p == paragraph._p:
            break
        p_prev = p
        
    if p_prev is not None:
        pPr = p_prev._p.get_or_add_pPr()
        sectPr = pPr.find(qn('w:sectPr'))
        if sectPr is None:
            sectPr = OxmlElement('w:sectPr')
            type_el = OxmlElement('w:type')
            type_el.set(qn('w:val'), 'nextPage')
            sectPr.append(type_el)
            pPr.append(sectPr)
            return True
    return False

def _add_field(paragraph, instr_text):
    run = paragraph.add_run()
    fld_char_begin = OxmlElement("w:fldChar"); fld_char_begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText"); instr.set(qn("xml:space"), "preserve"); instr.text = instr_text
    fld_char_sep   = OxmlElement("w:fldChar"); fld_char_sep.set(qn("w:fldCharType"), "separate")
    fld_char_end   = OxmlElement("w:fldChar"); fld_char_end.set(qn("w:fldCharType"), "end")
    run._r.append(fld_char_begin); run._r.append(instr)
    run._r.append(fld_char_sep);   run._r.append(fld_char_end)
    return run

def setup_section_page_number(section, fmt="decimal", start=None, header_text=None, show_footer_page=True):
    sectPr = section._sectPr
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
    for p in list(header.paragraphs):
        for r in list(p.runs):
            r.text = ""
    h_p = header.paragraphs[0]
    h_p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    if header_text:
        run = h_p.add_run(header_text)
        run.font.name = "Times New Roman"
        run.font.size = Pt(9)
        run.font.italic = True
        run.font.color.rgb = RGBColor(0x70, 0x70, 0x70)
        
        # Bottom border for header
        pPr = h_p._p.get_or_add_pPr()
        # Remove old border if exists
        pBdr = pPr.find(qn("w:pBdr"))
        if pBdr is not None:
            pPr.remove(pBdr)
        pBdr = OxmlElement("w:pBdr")
        bottom = OxmlElement("w:bottom")
        bottom.set(qn("w:val"), "single")
        bottom.set(qn("w:sz"), "6")
        bottom.set(qn("w:space"), "1")
        bottom.set(qn("w:color"), BLUE_D_HEX)
        pBdr.append(bottom)
        pPr.append(pBdr)

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
        run.font.name = "Times New Roman"
        run.font.size = Pt(10)
        run.font.color.rgb = GRAY_TEXT
        _add_field(f_p, "PAGE")
        run = f_p.add_run(" / ")
        run.font.name = "Times New Roman"
        run.font.size = Pt(10)
        run.font.color.rgb = GRAY_TEXT
        _add_field(f_p, "NUMPAGES")
        for r in f_p.runs:
            r.font.name = "Times New Roman"
            r.font.size = Pt(10)
            r.font.color.rgb = GRAY_TEXT

def format_docx(input_path, output_path):
    print(f"Loading DOCX from: {input_path}")
    doc = docx.Document(input_path)
    
    # ─── Find Targets for Section Breaks ─────────────────────────────────────
    p_camdoan = None
    p_decuong = None
    for p in doc.paragraphs:
        t = p.text.strip()
        if p.style.name.startswith('Heading') and t == "LỜI CAM ĐOAN":
            p_camdoan = p
        elif p.style.name.startswith('Heading') and t == "ĐỀ CƯƠNG CHI TIẾT":
            p_decuong = p

    print(f"Target 'LỜI CAM ĐOAN' found: {p_camdoan is not None}")
    print(f"Target 'ĐỀ CƯƠNG CHI TIẾT' found: {p_decuong is not None}")
    
    # ─── Split into 3 Sections ───────────────────────────────────────────────
    if p_camdoan:
        insert_section_break_before(doc, p_camdoan)
    if p_decuong:
        insert_section_break_before(doc, p_decuong)
        
    # Re-open or refresh document model to recognize sections
    doc.save(output_path)
    doc = docx.Document(output_path)
    print(f"Split document into {len(doc.sections)} sections.")
    
    # ─── Configure Margins ───────────────────────────────────────────────────
    for i, section in enumerate(doc.sections):
        section.page_width  = Cm(21)
        section.page_height = Cm(29.7)
        section.left_margin   = Cm(3.0)  # Standard left margin for binding
        section.right_margin  = Cm(2.0)  # Standard right margin
        section.top_margin    = Cm(2.5)  # Standard top margin
        section.bottom_margin = Cm(2.5)  # Standard bottom margin
        print(f"Section {i} margins set: Left=3.0cm, Right=2.0cm, Top/Bottom=2.5cm")
        
    # ─── Configure Headers & Footers ──────────────────────────────────────────
    REPORT_HEADER = "LinguaAI – Báo cáo đồ án môn học"
    
    # Section 1: Cover + Comments (No header/footer, no page numbers)
    sec0 = doc.sections[0]
    setup_section_page_number(sec0, fmt="decimal", start=1, header_text=None, show_footer_page=False)
    sec0.different_first_page_header_footer = True
    
    # Section 2: Front Matter (Roman numerals i, ii, iii...)
    if len(doc.sections) > 1:
        sec1 = doc.sections[1]
        setup_section_page_number(sec1, fmt="lowerRoman", start=1, header_text=REPORT_HEADER, show_footer_page=True)
        
    # Section 3: Main Body (Arabic numerals 1, 2, 3...)
    if len(doc.sections) > 2:
        sec2 = doc.sections[2]
        setup_section_page_number(sec2, fmt="decimal", start=1, header_text=REPORT_HEADER, show_footer_page=True)

    # ─── Adjust Normal Paragraph Format ──────────────────────────────────────
    print("Formatting paragraphs...")
    # Change Normal style defaults
    normal_style = doc.styles['Normal']
    normal_style.font.name = "Times New Roman"
    normal_style.font.size = Pt(13)
    normal_style.font.color.rgb = BLACK
    
    # Flag to skip first-line indents on cover page (Section 1)
    # We will determine cover page by iterating paragraphs until we pass 'NHẬN XÉT CỦA GIÁO VIÊN HƯỚNG DẪN'
    is_in_cover = True
    
    for p in doc.paragraphs:
        # Determine if we've left the cover/comments section
        if p.style.name.startswith('Heading') and p.text.strip() == "LỜI CAM ĐOAN":
            is_in_cover = False
            
        pf = p.paragraph_format
        
        # 1. Heading styles formatting
        if p.style.name.startswith('Heading'):
            pf.first_line_indent = Cm(0)
            pf.alignment = WD_ALIGN_PARAGRAPH.LEFT
            
            # Extract heading level
            h_level = 1
            if "1" in p.style.name: h_level = 1
            elif "2" in p.style.name: h_level = 2
            elif "3" in p.style.name: h_level = 3
            elif "4" in p.style.name: h_level = 4
            
            # Apply heading spacing and page breaks
            if h_level == 1:
                pf.space_before = Pt(18)
                pf.space_after = Pt(8)
                # Keep with next to avoid orphan headings
                pf.keep_with_next = True
                # Starting from LỜI CAM ĐOAN, all Heading 1s start on a new page
                if not is_in_cover and p.text.strip() != "LỜI CAM ĐOAN":
                    pf.page_break_before = True
            else:
                pf.space_before = Pt(12 if h_level == 2 else 6)
                pf.space_after = Pt(6)
                pf.keep_with_next = True
                
            # Apply Heading Run Fonts
            for r in p.runs:
                r.font.name = "Times New Roman"
                r.font.bold = True
                r.font.color.rgb = BLACK
                if h_level == 1: r.font.size = Pt(16)
                elif h_level == 2: r.font.size = Pt(14)
                else: r.font.size = Pt(13)
                
        # 2. Centered Paragraphs (captions, cover text)
        elif pf.alignment == WD_ALIGN_PARAGRAPH.CENTER or p.style.name == "Title" or p.style.name == "Subtitle":
            pf.first_line_indent = Cm(0)
            pf.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
            pf.line_spacing = 1.15 if is_in_cover else 1.5
            pf.space_after = Pt(6)
            for r in p.runs:
                r.font.name = "Times New Roman"
                if is_in_cover and p.style.name == "Title":
                    r.font.size = Pt(20)
                    r.font.bold = True
                    r.font.color.rgb = BLUE_DARK
                elif is_in_cover:
                    r.font.size = Pt(13)
                    
        # 3. Bullet points and list items
        elif p.style.name.startswith('List') or pf.left_indent is not None and pf.left_indent.cm > 0.4:
            pf.first_line_indent = Cm(0)
            pf.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
            pf.line_spacing = 1.5
            pf.space_after = Pt(4)
            for r in p.runs:
                r.font.name = "Times New Roman"
                r.font.size = Pt(11)  # bullet fonts slightly smaller
                r.font.color.rgb = GRAY_TEXT
                
        # 4. Normal body paragraphs
        else:
            pf.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
            pf.line_spacing = 1.5
            pf.space_before = Pt(0)
            pf.space_after = Pt(6)
            pf.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            
            # Apply first line indent only to body text in Section 2 and 3
            if not is_in_cover and p.text.strip():
                # Check for captions (exclude TOC/List of Tables dot leaders)
                t_stripped = p.text.strip()
                is_caption = (t_stripped.startswith("Hình ") or t_stripped.startswith("Bảng ")) and "..." not in t_stripped
                if not is_caption:
                    pf.first_line_indent = Cm(1.27)
                else:
                    pf.first_line_indent = Cm(0)
                    pf.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    
            for r in p.runs:
                r.font.name = "Times New Roman"
                # If it's a caption, style it
                t_stripped = p.text.strip()
                is_caption = (t_stripped.startswith("Hình ") or t_stripped.startswith("Bảng ")) and "..." not in t_stripped
                if not is_in_cover and is_caption:
                    r.font.size = Pt(10.5)
                    r.font.italic = True
                    r.font.color.rgb = GRAY_TEXT
                else:
                    r.font.size = Pt(13)
                    r.font.color.rgb = BLACK

    # ─── Format Tables ───────────────────────────────────────────────────────
    print(f"Formatting {len(doc.tables)} tables...")
    for ti, table in enumerate(doc.tables):
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        
        # Determine caption/title if any
        # Word tables should have proper styling
        for ri, row in enumerate(table.rows):
            is_header = (ri == 0)
            bg_color = BLUE_D_HEX if is_header else (ALT_ROW_HEX if ri % 2 == 1 else WHITE_HEX)
            
            for ci, cell in enumerate(row.cells):
                set_cell_bg(cell, bg_color)
                set_cell_margins(cell, top=120, bottom=120, left=160, right=160) # 6pt top/bottom, 8pt left/right
                
                # Borders
                border_data = {"val": "single", "sz": "4", "color": BORDER_HEX}
                set_cell_border(cell, top=border_data, bottom=border_data, left=border_data, right=border_data)
                
                # Format cell paragraphs
                for p in cell.paragraphs:
                    p.paragraph_format.first_line_indent = Cm(0)
                    p.paragraph_format.space_before = Pt(0)
                    p.paragraph_format.space_after = Pt(0)
                    p.paragraph_format.line_spacing = 1.15
                    
                    if is_header:
                        p.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
                        for r in p.runs:
                            r.font.name = "Times New Roman"
                            r.font.size = Pt(10)
                            r.font.bold = True
                            r.font.color.rgb = WHITE
                    else:
                        # STT (column 0): center aligned
                        p.paragraph_format.alignment = (
                            WD_ALIGN_PARAGRAPH.CENTER if ci == 0 else WD_ALIGN_PARAGRAPH.LEFT
                        )
                        for r in p.runs:
                            r.font.name = "Times New Roman"
                            r.font.size = Pt(10)
                            r.font.color.rgb = GRAY_TEXT

    # ─── Format Centered Image Paragraphs ────────────────────────────────────
    print("Formatting images...")
    for p in doc.paragraphs:
        # Check if paragraph contains drawing or pict
        has_img = False
        for r in p.runs:
            if r._r.xpath('.//w:drawing') or r._r.xpath('.//w:pict'):
                has_img = True
                break
        if has_img:
            p.paragraph_format.first_line_indent = Cm(0)
            p.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.space_before = Pt(12)
            p.paragraph_format.space_after = Pt(6)

    # Save final report
    doc.save(output_path)
    print(f"[OK] Academic format applied. Saved to: {output_path}")

if __name__ == "__main__":
    # Paths are relative to this script so the formatter runs on any machine.
    base_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(
        description="Apply the academic formatting pipeline to a LinguaAI report DOCX."
    )
    parser.add_argument(
        "src",
        nargs="?",
        type=Path,
        default=base_dir / "LinguaAI_BaoCao_DoAn.docx",
        help="Input DOCX (default: LinguaAI_BaoCao_DoAn.docx next to this script)",
    )
    parser.add_argument(
        "dst",
        nargs="?",
        type=Path,
        default=base_dir / "LinguaAI_BaoCao_DoAn_HoanChinh.docx",
        help="Output DOCX (default: LinguaAI_BaoCao_DoAn_HoanChinh.docx next to this script)",
    )
    args = parser.parse_args()
    if not args.src.is_file():
        parser.error(f"Input DOCX not found: {args.src}")
    format_docx(str(args.src), str(args.dst))
