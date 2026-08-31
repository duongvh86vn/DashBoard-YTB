@echo off
setlocal

cd /d "%~dp0"
title YouTube Home Monitor AI - Public

echo Starting the PUBLIC website...
echo.

if not exist "%~dp0scripts\public-stack.ps1" (
  echo ERROR: scripts\public-stack.ps1 was not found.
  echo Pull the latest phase/0-foundation branch and try again.
  echo.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\public-stack.ps1" -Mode Start %*
set "PUBLIC_EXIT_CODE=%ERRORLEVEL%"

if not "%PUBLIC_EXIT_CODE%"=="0" (
  echo.
  echo PUBLIC startup failed. No database volume or Cloudflare setting was deleted.
  echo Keep this window open and send a screenshot of the error.
  echo.
  pause
  exit /b %PUBLIC_EXIT_CODE%
)

echo.
echo PUBLIC website is ready. This window will close automatically.
timeout /t 5 /nobreak >nul
exit /b 0
