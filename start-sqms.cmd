@echo off
cd /d "%~dp0"
start "SQMS Dev Server" cmd /k npm run dev
timeout /t 6 /nobreak >nul
start "" http://localhost:5173
