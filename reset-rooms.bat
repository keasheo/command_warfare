@echo off
REM CommandWarfare Play Server Room Reset
REM Reset all rooms or a specific room by code
REM Usage:  reset-rooms.bat          (resets all rooms)
REM         reset-rooms.bat ABC123   (resets only room ABC123)

setlocal

set "PLAY_SERVER=http://127.0.0.1:8788"

echo ===============================================
echo CommandWarfare Room Reset
echo ===============================================
echo.

REM Check if curl is available
where curl >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ERROR: curl not found in PATH
    echo Please install curl or use Windows 10/11 which includes it
    echo.
    pause
    exit /b 1
)

if "%1"=="" (
    echo Resetting ALL rooms...
    echo.
    curl -X POST "%PLAY_SERVER%/admin/reset-rooms" -H "Content-Type: application/json"
) else (
    set "ROOM_CODE=%~1"
    echo Resetting room: !ROOM_CODE!
    echo.
    curl -X POST "%PLAY_SERVER%/admin/reset-room/!ROOM_CODE!" -H "Content-Type: application/json"
)

echo.
echo.

if %ERRORLEVEL% neq 0 (
    echo ERROR: Failed to reset rooms (exit code %ERRORLEVEL%)
    echo Make sure the play server is running on %PLAY_SERVER%
    echo.
    pause
    exit /b %ERRORLEVEL%
)

echo ===============================================
echo Room reset complete!
echo ===============================================
echo.
pause
