@echo off
set APP_DIR=%~dp0..\work\video-reference-board
rem Firebase Auth는 localhost만 기본 허용합니다. 127.0.0.1로 열면
rem "domain is not authorized for OAuth operations" 로 로그인이 막힙니다.
set APP_URL=http://localhost:5174/

start "Video Reference Board Server" cmd /k "cd /d "%APP_DIR%" && npm run dev -- --host localhost --port 5174 --strictPort"
timeout /t 3 /nobreak >nul
start "" "%APP_URL%"
