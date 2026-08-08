@echo off
setlocal
cd /d "%~dp0"
".venv\Scripts\python.exe" backend.py --load-model --serve
