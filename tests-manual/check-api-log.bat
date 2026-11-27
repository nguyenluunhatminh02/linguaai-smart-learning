@echo off
echo === Last 60 lines of _api.log ===
powershell -NoProfile -Command "Get-Content '%~dp0..\_api.log' -Tail 60"
echo.
echo === Lines containing 'speak' (case-insensitive) ===
powershell -NoProfile -Command "Select-String -Path '%~dp0..\_api.log' -Pattern 'speak' -AllMatches | Select-Object -Last 20 | ForEach-Object { $_.Line }"
echo.
echo === Lines containing 'error' or 'Error' ===
powershell -NoProfile -Command "Select-String -Path '%~dp0..\_api.log' -Pattern 'error|Error|ERROR' -AllMatches | Select-Object -Last 20 | ForEach-Object { $_.Line }"
