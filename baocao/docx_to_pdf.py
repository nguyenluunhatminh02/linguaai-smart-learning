"""
Convert LinguaAI_BaoCao_DoAn.docx -> LinguaAI_BaoCao_DoAn.pdf

Tries 3 conversion backends in order (whichever is installed):
  1. docx2pdf  (uses MS Word COM on Windows / Pages on macOS — best fidelity)
  2. Word COM via pywin32 (Windows only — best fidelity, also updates fields)
  3. LibreOffice headless (cross-platform fallback — requires `soffice` on PATH)

Run:
    python docx_to_pdf.py
"""
from __future__ import annotations
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DOCX = HERE / "LinguaAI_BaoCao_DoAn.docx"
PDF  = HERE / "LinguaAI_BaoCao_DoAn.pdf"


def update_fields_with_word(docx_path: Path) -> bool:
    """Open docx in MS Word, update all fields (TOC, PAGE), save, then convert.
    Returns True if conversion succeeded.
    """
    try:
        import win32com.client  # type: ignore
    except Exception:
        return False
    try:
        word = win32com.client.DispatchEx("Word.Application")
        word.Visible = False
        try:
            doc = word.Documents.Open(str(docx_path), ReadOnly=False)
            # Update all fields (including page numbers)
            try:
                doc.Fields.Update()
            except Exception:
                pass
            # Update TOC if present
            try:
                for toc in doc.TablesOfContents:
                    toc.Update()
            except Exception:
                pass
            doc.Save()
            # SaveAs PDF (wdFormatPDF = 17)
            doc.SaveAs(str(PDF), FileFormat=17)
            doc.Close(False)
            return True
        finally:
            word.Quit()
    except Exception as exc:
        print(f"[Word COM] failed: {exc}")
        return False


def convert_with_docx2pdf(docx_path: Path) -> bool:
    try:
        from docx2pdf import convert  # type: ignore
    except Exception:
        return False
    try:
        convert(str(docx_path), str(PDF))
        return PDF.exists()
    except Exception as exc:
        print(f"[docx2pdf] failed: {exc}")
        return False


def convert_with_libreoffice(docx_path: Path) -> bool:
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        return False
    try:
        subprocess.run(
            [soffice, "--headless", "--convert-to", "pdf",
             "--outdir", str(HERE), str(docx_path)],
            check=True,
        )
        return PDF.exists()
    except Exception as exc:
        print(f"[LibreOffice] failed: {exc}")
        return False


def main() -> int:
    if not DOCX.exists():
        print(f"ERROR: source DOCX not found at {DOCX}")
        print("Run `python generate_docx.py` first.")
        return 2

    print(f"Source: {DOCX}")
    print(f"Target: {PDF}")
    print()

    # Order: Word COM (best fidelity + updates fields) → docx2pdf → LibreOffice
    if update_fields_with_word(DOCX):
        print(f"[OK] Converted via Microsoft Word -> {PDF}")
        return 0
    if convert_with_docx2pdf(DOCX):
        print(f"[OK] Converted via docx2pdf -> {PDF}")
        return 0
    if convert_with_libreoffice(DOCX):
        print(f"[OK] Converted via LibreOffice -> {PDF}")
        return 0

    print("\nNo conversion backend available. Install one of the following:")
    print("  pip install pywin32        (Windows, recommended)")
    print("  pip install docx2pdf       (cross-platform via Word/Pages)")
    print("  -- or --")
    print("  Install LibreOffice and ensure `soffice` is on PATH")
    return 1


if __name__ == "__main__":
    sys.exit(main())
