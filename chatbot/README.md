# Qwen Chat Widget

This folder contains a floating browser chat widget plus a local Python backend
for the Qwen GGUF model.

## Files

- `index.html` - demo page with the floating widget
- `styles.css` - widget styling
- `chat-widget.js` - frontend chat logic and settings
- `server.js` - optional static server and OpenAI-compatible relay
- `backend.py` - Python terminal backend for the local Qwen GGUF model
- `launch_globe_ai.py` - one-command launcher that starts the backend and opens the globe

## Python GGUF Backend

From this folder, the easiest start is:

```powershell
.\.venv\Scripts\python.exe launch_globe_ai.py
```

Or double-click:

```text
start_globe_ai.bat
```

This loads the model, starts the API at `http://127.0.0.1:8091`, and opens the
local globe page at `http://127.0.0.1:8019/index.html`.

The backend default model path is:

```text
C:\Users\inter\Desktop\votronix\models\llm\qwen3-4b-instruct-2507-q5_k_m.gguf
```

Useful terminal commands:

```text
help
show
load-model
start
chat hello
cloudflare
```

## One-Click Start

Use either old standalone widget launcher from this folder:

```powershell
.\start_chatbot.ps1
```

or double-click:

```text
start_chatbot.bat
```

All launchers use the project venv at:

```text
chatbot\.venv
```

The embedded globe widget default endpoint is:

```text
https://globe-qwen-relay.digitalcomputermail.workers.dev/api/chat
```

## Node Relay

`server.js` is still available if you already have another OpenAI-compatible Qwen server running.

## Control Panel / Future EXE

The terminal control panel is:

```powershell
.\start_control_panel.bat
```

Future `.exe` packaging files live in:

```text
packaging\
```

The future executable should keep `backend_config.json`, `relay_config.json`,
and `tools\cloudflared.exe` beside it.

## Public Access

For public access, keep the Python backend local and put it behind Cloudflare
Tunnel. A GitHub or Netlify page cannot reach `127.0.0.1` on your home PC from a
mobile phone, because `127.0.0.1` means the device currently viewing the page.

Quick test flow:

```powershell
.\.venv\Scripts\python.exe launch_cloudflare_quick_tunnel.py
```

or double-click:

```text
start_cloudflare_quick_tunnel.bat
```

This starts the Qwen backend, starts Cloudflare Tunnel, publishes the fresh
temporary tunnel URL to the stable Cloudflare Worker relay, opens the Netlify
globe, and prints:

```text
Stable widget endpoint: https://globe-qwen-relay.digitalcomputermail.workers.dev/api/chat
Current tunnel endpoint: https://random-name.trycloudflare.com/api/chat
Widget access token: not required
```

On mobile, open the Netlify site. You should not need to edit the widget
settings if the page has the latest code:

```text
Endpoint: https://globe-qwen-relay.digitalcomputermail.workers.dev/api/chat
Access token / API key: blank
```

The latest values are also saved locally in:

```text
last_tunnel.json
```

Manual tunnel command:

```powershell
cloudflared tunnel --url http://127.0.0.1:8091
```

Quick Tunnel URLs are temporary, but the widget uses the stable Worker relay.
The launcher updates the Worker whenever the laptop starts a new tunnel.

This no-token mode is easiest for testing. Close the tunnel window when you are
done so the public URL stops working.
