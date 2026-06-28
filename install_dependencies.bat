@echo off
title Install Dependencies - Benny's Hub
echo Installing dependencies for Benny's Hub...
echo.

REM ─── Node.js ───────────────────────────────────────────────────────────────
set "PATH=%PATH%;C:\Program Files\nodejs\"

if exist node_modules (
    echo Deleting existing node_modules to ensure clean install...
    rmdir /s /q node_modules
)

echo Running npm install...
call npm install

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: npm install failed.
    echo Please ensure Node.js is installed (https://nodejs.org/)
    pause
    exit /b
)

echo.
echo Node.js dependencies installed successfully!

REM ─── Python ────────────────────────────────────────────────────────────────
echo.
echo Installing Python dependencies...

python --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Python not found in PATH.
    echo Please ensure Python is installed (https://www.python.org/) and added to PATH.
    pause
    exit /b
)

python -m pip install --upgrade pip

python -m pip install -r requirements.txt

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: pip install failed. See output above for details.
    pause
    exit /b
)

echo.
echo All dependencies installed successfully!
echo You can now run start_hub.bat
pause
