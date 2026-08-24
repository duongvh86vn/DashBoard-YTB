@echo off
setlocal

cd /d "%~dp0"
title YouTube Home Monitor AI

echo Starting YouTube Home Monitor AI...
echo.

if not exist "%~dp0scripts\start-local.cmd" (
  echo ERROR: scripts\start-local.cmd was not found.
  echo Please make sure this file is inside the project root folder.
  echo.
  pause
  exit /b 1
)

call "%~dp0scripts\start-local.cmd" %*
set "START_EXIT_CODE=%ERRORLEVEL%"

if not "%START_EXIT_CODE%"=="0" (
  echo.
  echo Startup failed. Keep this window open and send a screenshot of the error.
  echo.
  pause
  exit /b %START_EXIT_CODE%
)

echo.
echo Service is ready: http://127.0.0.1:3000/login
echo This window will close automatically.
timeout /t 5 /nobreak >nul
exit /b 0
