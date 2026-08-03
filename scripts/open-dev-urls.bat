@echo off
REM Delay then open dev URLs in the default browser (no extra console window).
setlocal
set /a "_PINGS=%~1+1"
ping -n %_PINGS% 127.0.0.1 >nul
shift
:openNext
if "%~1"=="" exit /b 0
start "" "%~1"
shift
goto openNext
