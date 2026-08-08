@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Missing .venv\Scripts\python.exe
  exit /b 1
)

".venv\Scripts\python.exe" -m PyInstaller --version >nul 2>nul
if errorlevel 1 (
  echo PyInstaller is not installed in this venv.
  echo Run: .venv\Scripts\python.exe -m pip install pyinstaller
  exit /b 1
)

".venv\Scripts\python.exe" -m PyInstaller "packaging\qwen_mobile_control.spec" --distpath "dist" --workpath "build"
if errorlevel 1 exit /b 1

echo.
echo Built: dist\QwenMobileControl.exe
echo Keep these files beside the exe for the current workflow:
echo   backend_config.json
echo   relay_config.json
echo   tools\cloudflared.exe
