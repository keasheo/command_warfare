@echo off
setlocal
cd /d "%~dp0"

echo Starting Command Warfare Play (HTTP + HTTPS)...
echo   Card API:     http://127.0.0.1:8787
echo   Play WS:      ws://127.0.0.1:8788
echo   Host HTTPS:   https://127.0.0.1:5174  (needs npm run cert:dev once)
echo   Guest HTTP:   http://LAN_IP:5175      (no cert warning — share this)
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

start /b cmd /c call "%~dp0scripts\open-dev-urls.bat" 4 "http://127.0.0.1:5175"

call npm run dev:play
set EXITCODE=%ERRORLEVEL%

echo.
if not "%EXITCODE%"=="0" (
  echo Command Warfare Play exited with code %EXITCODE%.
  pause
)
exit /b %EXITCODE%
