@echo off
title Ben's Messenger (new)
cd /d "%~dp0"

REM Ensure Node.js is in PATH
set "PATH=%PATH%;C:\Program Files\nodejs\"

REM Resolve workspace root (four levels up: new messenger -> tools -> apps -> bennyshub -> root)
set "ROOT=%~dp0..\..\..\.."
set "ELECTRON=%ROOT%\node_modules\.bin\electron.cmd"

if not exist "%ELECTRON%" (
    echo ERROR: Electron not found at "%ELECTRON%".
    echo Run 'npm install' in the workspace root first.
    pause
    exit /b 1
)

REM Launch the new messenger (main.js spawns backend.py itself)
"%ELECTRON%" "%~dp0main.js"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Failed to start Ben's Messenger.
    pause
)
