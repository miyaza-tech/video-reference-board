@echo off
set APP_DIR=%~dp0..\work\video-reference-board
set APP_URL=http://127.0.0.1:5174/

start "Video Reference Board Server" cmd /k "cd /d "%APP_DIR%" && npm run dev -- --host 127.0.0.1 --port 5174 --strictPort"
timeout /t 3 /nobreak >nul
start "" "%APP_URL%"
