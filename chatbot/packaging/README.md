# Qwen Mobile Control EXE Packaging

This folder prepares the future Windows executable build for the chatbot control
panel.

## Build Later

From the `chatbot` folder:

```powershell
.\.venv\Scripts\python.exe -m pip install pyinstaller
.\build_control_panel_exe.bat
```

The expected output is:

```text
dist\QwenMobileControl.exe
```

## Runtime Files Beside The EXE

Keep these beside `QwenMobileControl.exe`:

```text
backend_config.json
relay_config.json
tools\cloudflared.exe
```

The GGUF model can stay at its current absolute path, or you can update
`backend_config.json` / the control panel setting later.

## Current State

The EXE target is console-first. A GUI wrapper can come later once the terminal
control panel behavior is stable.
