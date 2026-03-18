@echo off
chcp 65001 >nul 2>&1
title Audio Annotation Tool

echo.
echo  ========================================
echo    GPT-SoVITS Audio Annotation Tool
echo  ========================================
echo.

set PYTHON=%~dp0runtime\python.exe
set SCRIPT=%~dp0audio_tool_server.py

if not exist "%PYTHON%" (
    echo [!] Python not found at: %PYTHON%
    echo [!] Trying system python...
    set PYTHON=python
)

if not "%~1"=="" (
    echo [OK] List file: %~1
    echo.
    "%PYTHON%" "%SCRIPT%" --list "%~1"
    goto theend
)

echo [i] How to use:
echo     Drag a .list file onto this bat file
echo     Or type the path below:
echo.
set /p LISTFILE=".list file path: "

if "%LISTFILE%"=="" (
    echo [!] No path entered!
    goto theend
)

echo.
"%PYTHON%" "%SCRIPT%" --list "%LISTFILE%"

:theend
echo.
pause
