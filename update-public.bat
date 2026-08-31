@echo off
setlocal

cd /d "%~dp0"
title YouTube Home Monitor AI - Public update

echo Updating the PUBLIC website from phase/0-foundation...
echo.

if not exist "%~dp0scripts\public-stack.ps1" (
  echo ERROR: scripts\public-stack.ps1 was not found.
  echo Pull the latest phase/0-foundation branch once, then run this file again.
  echo.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\public-stack.ps1" -Mode Update %*
set "PUBLIC_EXIT_CODE=%ERRORLEVEL%"

if not "%PUBLIC_EXIT_CODE%"=="0" (
  echo.
  echo PUBLIC update failed. .env.public and named Docker volumes were not deleted.
  echo Review migration status and logs before attempting any rollback.
  echo Keep this window open and send a screenshot of the error.
  echo.
  pause
  exit /b %PUBLIC_EXIT_CODE%
)

echo.
echo PUBLIC update completed. This window will close automatically.
timeout /t 8 /nobreak >nul
exit /b 0
