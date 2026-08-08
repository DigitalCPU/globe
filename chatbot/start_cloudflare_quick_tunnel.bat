@echo off
setlocal
cd /d "%~dp0"
".venv\Scripts\python.exe" launch_cloudflare_quick_tunnel.py
