@echo off
setlocal
cd /d "%~dp0"
if not defined PAPERCLIP_LOCAL_DIR set "PAPERCLIP_LOCAL_DIR=%~dp0.paperclip-local"
set "PAPERCLIP_NODE=node"
if exist "%PAPERCLIP_LOCAL_DIR%\node-v24.22.2-win-x64\node.exe" set "PAPERCLIP_NODE=%PAPERCLIP_LOCAL_DIR%\node-v24.22.2-win-x64\node.exe"
"%PAPERCLIP_NODE%" scripts\local\start.mjs
if errorlevel 1 pause
