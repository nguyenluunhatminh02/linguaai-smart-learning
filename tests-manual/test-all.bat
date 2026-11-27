@echo off
REM ============================================================
REM Test Writing module 1-click — chạy đầy đủ pipeline
REM   1. Đảm bảo Postgres + Redis đang chạy
REM   2. Start API + AI service ở background nếu chưa chạy
REM   3. Chờ healthcheck
REM   4. Register user test (nếu chưa có)
REM   5. Chạy test-writing.mjs
REM   6. Mở log
REM ============================================================

setlocal enabledelayedexpansion
cd /d "%~dp0\.."

set "ROOT=%cd%"
set "LOG_DIR=%ROOT%\tests-manual\logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

set "TEST_EMAIL=admin@example.com"
set "TEST_PASSWORD=Admin123!"

echo.
echo ============================================================
echo   LinguaAI — Writing Manual Test (1-click)
echo ============================================================
echo Root: %ROOT%
echo Log dir: %LOG_DIR%
echo.

REM ── Step 1: Check Postgres + Redis ─────────────────────────
echo [1/6] Checking Postgres + Redis...
docker ps --filter "name=postgres" --format "{{.Names}}" 2>nul | findstr /i postgres >nul
if errorlevel 1 (
  echo   ! Postgres NOT running. Starting via docker compose...
  docker compose -f docker\docker-compose.yml up -d postgres redis
  echo   ... waiting 8s for DB to be ready
  timeout /t 8 /nobreak >nul
) else (
  echo   ^> Postgres OK
)

REM ── Step 2: Check API server (port 3001) ──────────────────
echo.
echo [2/6] Checking API server on :3001...
curl -sS -m 3 -o nul -w "%%{http_code}" http://localhost:3001/api/health > "%LOG_DIR%\api_status.txt" 2>nul
set /p API_STATUS=<"%LOG_DIR%\api_status.txt"
if "%API_STATUS%"=="200" (
  echo   ^> API already running
) else (
  echo   ! API not running. Starting in new window...
  start "LinguaAI API" cmd /k "cd /d %ROOT% && pnpm dev:api"
  echo   ... waiting up to 60s for API ready
  set "READY=0"
  for /l %%i in (1,1,30) do (
    timeout /t 2 /nobreak >nul
    curl -sS -m 3 -o nul -w "%%{http_code}" http://localhost:3001/api/health > "%LOG_DIR%\api_status.txt" 2>nul
    set /p API_STATUS=<"%LOG_DIR%\api_status.txt"
    if "!API_STATUS!"=="200" (
      echo   ^> API ready after %%i checks
      set "READY=1"
      goto :api_ready
    )
  )
  :api_ready
  if "!READY!"=="0" (
    echo   X API failed to start within 60s. Aborting.
    pause
    exit /b 1
  )
)

REM ── Step 3: Check AI service (port 8000) ──────────────────
echo.
echo [3/6] Checking AI service on :8000...
curl -sS -m 3 -o nul -w "%%{http_code}" http://localhost:8000/health > "%LOG_DIR%\ai_status.txt" 2>nul
set /p AI_STATUS=<"%LOG_DIR%\ai_status.txt"
if "%AI_STATUS%"=="200" (
  echo   ^> AI service already running
) else (
  echo   ! AI service not running. Starting in new window...
  start "LinguaAI AI" cmd /k "cd /d %ROOT% && pnpm dev:ai"
  echo   ... waiting up to 60s for AI ready
  set "READY=0"
  for /l %%i in (1,1,30) do (
    timeout /t 2 /nobreak >nul
    curl -sS -m 3 -o nul -w "%%{http_code}" http://localhost:8000/health > "%LOG_DIR%\ai_status.txt" 2>nul
    set /p AI_STATUS=<"%LOG_DIR%\ai_status.txt"
    if "!AI_STATUS!"=="200" (
      echo   ^> AI ready after %%i checks
      set "READY=1"
      goto :ai_ready
    )
  )
  :ai_ready
  if "!READY!"=="0" (
    echo   X AI service failed to start within 60s. Aborting.
    pause
    exit /b 1
  )
)

REM ── Step 4: Register user (idempotent) ────────────────────
echo.
echo [4/6] Ensuring test user exists (%TEST_EMAIL%)...
curl -sS -m 10 -X POST http://localhost:3001/api/auth/register ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"%TEST_EMAIL%\",\"password\":\"%TEST_PASSWORD%\",\"username\":\"testuser\",\"displayName\":\"Test User\"}" ^
  > "%LOG_DIR%\register.json" 2>&1
findstr /i "exists already" "%LOG_DIR%\register.json" >nul && (
  echo   ^> User already exists
) || (
  echo   ^> User registered or response saved to register.json
)

REM ── Step 5: Run Writing test ──────────────────────────────
echo.
echo [5/6] Running test-writing.mjs...
echo ============================================================
node "%ROOT%\tests-manual\test-writing.mjs" > "%LOG_DIR%\writing.log" 2>&1
set "TEST_EXIT=%errorlevel%"

REM ── Step 6: Display log ───────────────────────────────────
echo.
echo [6/6] Test result (exit=%TEST_EXIT%):
echo ============================================================
type "%LOG_DIR%\writing.log"
echo ============================================================
echo.
echo Log saved to: %LOG_DIR%\writing.log
echo.
if "%TEST_EXIT%"=="0" (
  echo ^>^>^> ALL TESTS PASSED ^<^<^<
) else (
  echo ^>^>^> SOME TESTS FAILED — check log above ^<^<^<
)
echo.
pause
