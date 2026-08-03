@echo off
setlocal
cd /d "%~dp0"

REM Same full-stack launcher as start-all.bat
call "%~dp0start-all.bat"
exit /b %ERRORLEVEL%
