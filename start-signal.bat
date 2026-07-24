@echo off
title signal - local chat launcher
cd /d "%~dp0"

echo Starting local server...
start "signal-server" /min cmd /c "python -m http.server 8080"

timeout /t 2 /nobreak >nul

echo Opening signal-chat.html...
start "" "http://localhost:8080/signal-chat.html"

echo.
echo signal is running. Keep this window's server (minimized in taskbar) open while you use it.
echo Closing that minimized "signal-server" window will stop the app.
echo.
pause
