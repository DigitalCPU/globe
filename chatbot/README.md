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
http://127.0.0.1:8091/api/chat
```

## Node Relay

`server.js` is still available if you already have another OpenAI-compatible Qwen server running.

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

This starts the Qwen backend, starts Cloudflare Tunnel, opens the GitHub Pages
globe, and prints:

```text
Widget endpoint: https://random-name.trycloudflare.com/api/chat
Widget access token: ...
```

On the widget settings panel, paste those values into:

```text
Endpoint
Access token / API key
```

The latest values are also saved locally in:

```text
last_tunnel.json
```

Manual tunnel command:

```powershell
cloudflared tunnel --url http://127.0.0.1:8091
```

Quick Tunnel URLs are temporary. For a permanent URL, create a named tunnel in
the Cloudflare dashboard and point it at `http://127.0.0.1:8091`.

Do not expose a public relay without an access token.
