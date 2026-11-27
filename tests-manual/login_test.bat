@echo off
setlocal
set "API=http://localhost:3001/api"
if defined API_URL set "API=%API_URL%"
set "EMAIL=admin@example.com"
if defined TEST_EMAIL set "EMAIL=%TEST_EMAIL%"
set "PASSWORD="
if defined TEST_PASSWORD set "PASSWORD=%TEST_PASSWORD%"
if not defined PASSWORD (
  echo TEST_PASSWORD is not set. Refusing to use a hard-coded credential.
  exit /b 1
)
set "RESULT=%TEMP%\linguaai-login-result.json"
curl -s -o "%RESULT%" -w "HTTP_STATUS=%%{http_code}\n" -X POST "%API%/auth/login" -H "Content-Type: application/json" -d "{\"email\":\"%EMAIL%\",\"password\":\"%PASSWORD%\"}"
if errorlevel 1 (
  echo Login request failed.
  exit /b 1
)
for /f "usebackq delims=" %%A in ("%RESULT%") do set "BODY=%%A"
del "%RESULT%" >nul 2>&1
if defined BODY (
  echo Response received ^(%BODY:~0,120%^ ...^). Token values intentionally not printed.
) else (
  echo Empty response from login endpoint.
)
endlocal
