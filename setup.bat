@echo off
setlocal

cd /d "%~dp0"
title YouTube Home Monitor AI - First setup or repair

echo Preparing YouTube Home Monitor AI...
echo This full setup is only needed on the first install or when repairing local images.
echo.

if not exist "%~dp0scripts\start-local.cmd" (
  echo ERROR: scripts\start-local.cmd was not found.
  echo Please make sure this file is inside the project root folder.
  echo.
  pause
  exit /b 1
)

call "%~dp0scripts\start-local.cmd" -UsePrebuilt %*
set "SETUP_EXIT_CODE=%ERRORLEVEL%"

if not "%SETUP_EXIT_CODE%"=="0" (
  echo.
  echo Setup failed. Keep this window open and send a screenshot of the error.
  echo.
  pause
  exit /b %SETUP_EXIT_CODE%
)

echo.
echo Setup completed: http://127.0.0.1:3000/login
echo Future starts only require start.bat.
timeout /t 5 /nobreak >nul
exit /b 0
