@echo off
title Install Dependencies - Benny's Hub
echo Installing dependencies for Benny's Hub...
echo.

REM Ensure Node.js is in PATH
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
echo Dependencies installed successfully!
echo You can now run start_hub.bat
pause
