@echo off
setlocal
cd /d "%~dp0"

set "WEB_SCHEME=http"
set "PLAY_SCHEME=http"
if exist "certs\localhost.pem" if exist "certs\localhost-key.pem" (
  set "WEB_SCHEME=https"
  set "PLAY_SCHEME=https"
)

echo Starting Command Warfare (full stack)...
echo   Card API:     http://127.0.0.1:8787
echo   Card editor:  %WEB_SCHEME%://127.0.0.1:5173
echo   Play WS:      ws://127.0.0.1:8788
echo   Play HTTP:    http://127.0.0.1:5175  (guests / no cert warning)
echo   Play HTTPS:   https://127.0.0.1:5174 (optional; needs cert:dev)
echo.
if "%WEB_SCHEME%"=="https" (
  echo Card editor uses HTTPS certs when present.
  echo Play guests should use http://LAN_IP:5175
  echo.
)
echo Ctrl+C stops all processes.
echo.

where npm >nul 2>&1
if errorlevel 1 (
  echo ERROR: npm was not found. Install Node.js and reopen this window.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo node_modules missing — running npm install...
  call npm install
  if errorlevel 1 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
  )
  echo.
)

REM Open browsers after a short delay so Vite can bind (background — no extra console).
start /b cmd /c call "%~dp0scripts\open-dev-urls.bat" 4 "%WEB_SCHEME%://127.0.0.1:5173" "http://127.0.0.1:5175"

call npm run dev:all
set EXITCODE=%ERRORLEVEL%

echo.
if not "%EXITCODE%"=="0" (
  echo Command Warfare exited with code %EXITCODE%.
  pause
)
exit /b %EXITCODE%
