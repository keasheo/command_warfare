@echo off
REM Battle Sim Report Generator
REM Generates multi-tab Excel workbook with race performance analysis
REM Double-click to run, or use from command line with args
REM Lives in sim\ — always runs from the repository root

setlocal

REM Repo root is the parent of this bat's folder (sim\)
cd /d "%~dp0.."

echo ===============================================
echo CommandWarfare Sim Report Generator
echo ===============================================
echo.

REM Check if node is available
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ERROR: Node.js not found in PATH
    echo Please install Node.js or add it to your PATH
    echo.
    pause
    exit /b 1
)

REM Check if script exists
if not exist "scripts\simReport.mjs" (
    echo ERROR: scripts\simReport.mjs not found
    echo Expected to find it from the repository root
    echo.
    pause
    exit /b 1
)

REM Run the sim report with all passed arguments
REM If no args, defaults to running sim and generating xlsx
echo Running sim report...
echo.

if "%*"=="" (
    node scripts\simReport.mjs
) else (
    node scripts\simReport.mjs %*
)

if %ERRORLEVEL% neq 0 (
    echo.
    echo ERROR: Sim report failed with exit code %ERRORLEVEL%
    echo.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ===============================================
echo Report generation complete!
echo Default output: sim\2_sim-matchup-report.xlsx
echo ===============================================
echo.
echo Open the Excel file to view:
echo   - Overview tab: Race win rates and matchup matrix
echo   - Per-race tabs: Detailed stats for each race
echo.
pause
