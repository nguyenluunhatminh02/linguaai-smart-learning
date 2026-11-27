"""Extract text and structure from the template PDF."""
import sys
from pathlib import Path

PDF = Path(__file__).parent / "Nhom1_21520385_21520203_21521998_21522170.pdf"
OUT_TEXT = Path(__file__).parent / "_template_text.txt"

try:
    from pdfminer.high_level import extract_text
    t = extract_text(str(PDF))
    OUT_TEXT.write_text(t, encoding="utf-8")
    print(f"OK len={len(t)}")
except Exception as e:
    print("ERROR pdfminer:", e)
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(str(PDF))
        text = "\n".join(page.get_text() for page in doc)
        OUT_TEXT.write_text(text, encoding="utf-8")
        print(f"OK pymupdf len={len(text)}")
    except Exception as e2:
        print("ERROR pymupdf:", e2)
        sys.exit(1)
