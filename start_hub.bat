@echo off
title Benny's Hub - Electron
cd /d "%~dp0"

REM Ensure Node.js is in PATH (common issue on Surface/Windows)
set "PATH=%PATH%;C:\Program Files\nodejs\"

REM Minimize this window so it doesn't block inputs
if not defined MINIMIZED (
    set MINIMIZED=1
    start /min "" cmd /c "%~f0"
    exit /b
)

REM Wait a few seconds for Windows to finish loading other startup items
REM This helps ensure the app gets focus when it starts
timeout /t 5 /nobreak >nul

REM Start the Electron hub
call npm start
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Failed to start the application.
    echo Please ensure Node.js is installed and 'npm install' has been run.
    pause
)
pause
