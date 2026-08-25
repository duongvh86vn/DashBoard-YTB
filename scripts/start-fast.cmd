@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-fast.ps1" %*
exit /b %ERRORLEVEL%
