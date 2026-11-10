@echo off
title Refined - Media & Playlist Downloader Studio
cd /d "%~dp0"
echo =======================================================
echo    Starting Refined - Universal Media Studio...
echo =======================================================

set PYTHON_PATH="C:\Users\Hp\AppData\Local\Programs\Python\Python312\python.exe"

if exist %PYTHON_PATH% (
    %PYTHON_PATH% run.py
) else (
    python run.py
)

pause
