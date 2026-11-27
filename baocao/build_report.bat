@echo off
REM ──────────────────────────────────────────────────────────────────────────
REM   LinguaAI – Build báo cáo đồ án (DOCX + PDF)
REM ──────────────────────────────────────────────────────────────────────────
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo ====================================================================
echo  [1/3] Cài thư viện Python (python-docx, pywin32) nếu thiếu
echo ====================================================================
python -m pip install --quiet --upgrade python-docx pywin32 2>nul
if errorlevel 1 (
    echo [WARN] Không cài được python-docx hoặc pywin32. Bỏ qua.
)

echo.
echo ====================================================================
echo  [2/3] Sinh file DOCX  (generate_docx.py)
echo ====================================================================
python generate_docx.py
if errorlevel 1 (
    echo [ERROR] Sinh DOCX thất bại.
    exit /b 1
)

echo.
echo ====================================================================
echo  [3/3] Convert DOCX -^> PDF  (docx_to_pdf.py)
echo ====================================================================
python docx_to_pdf.py
if errorlevel 1 (
    echo.
    echo [WARN] Convert PDF thất bại. Bạn có thể mở DOCX trong Word và Save As PDF thủ công.
)

echo.
echo ====================================================================
echo  HOÀN TẤT.
echo  - DOCX:  %CD%\LinguaAI_BaoCao_DoAn.docx
echo  - PDF:   %CD%\LinguaAI_BaoCao_DoAn.pdf
echo ====================================================================
endlocal
