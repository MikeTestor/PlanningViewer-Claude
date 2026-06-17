@echo off
:: Move to the folder where this .bat file lives (works with network paths too)
pushd "%~dp0"

:: Check if Node.js is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js is not installed on this computer.
    echo.
    echo Please download and install it from: https://nodejs.org
    echo Choose the "LTS" version, then run this file again.
    echo.
    pause
    popd
    exit /b
)

:: Start the server in a minimised window
echo Starting Planning Viewer...
start "Planning Viewer" /min node server.js

:: Wait for the server to be ready, then open the browser
timeout /t 2 /nobreak >nul
start "" http://0.0.0.0:3000

popd
