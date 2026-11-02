@echo off
setlocal
cd /d "%~dp0"
set "PATH=%~dp0.paperclip-local\node-v24.22.2-win-x64;%PATH%"
set "CODEX_HOME=%~dp0.paperclip-local\codex"
"%~dp0.paperclip-local\node-v24.22.2-win-x64\node.exe" scripts\local\start.mjs
if errorlevel 1 pause
