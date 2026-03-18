@echo off
chcp 65001 >nul 2>&1
title GPT-SoVITS Training Panel

echo.
echo  ================================================
echo    GPT-SoVITS Training Panel
echo  ================================================
echo.

set PANEL_DIR=%~dp0
set PYTHON=%PANEL_DIR%runtime\python.exe
set SCRIPT=%PANEL_DIR%gptsovits_panel.py

if not exist "%PYTHON%" (
    echo [!] runtime\python.exe not found
    echo [!] Trying system python...
    set PYTHON=python
)

echo [i] Starting panel server on port 9877...
echo [i] Browser will open automatically.
echo.

"%PYTHON%" "%SCRIPT%" --port 9877

echo.
echo [!] Panel server stopped.
pause
