import argparse
import json
import os
import queue
import shlex
import sys
import threading
import time
from dataclasses import asdict, dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


def app_root():
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


ROOT = app_root()
CONFIG_PATH = ROOT / "backend_config.json"
DEFAULT_MODEL_PATH = r"C:\Users\inter\Desktop\votronix\models\llm\qwen3-4b-instruct-2507-q5_k_m.gguf"


@dataclass
class BackendConfig:
    model_path: str = DEFAULT_MODEL_PATH
    host: str = "127.0.0.1"
    port: int = 8090
    access_token: str = ""
    allowed_origins: str = ""
    model_name: str = "qwen3-4b-instruct-2507-q5_k_m"
    n_ctx: int = 8192
    n_gpu_layers: int = -1
    temperature: float = 0.7
    max_tokens: int = 768
    system_prompt: str = "You are Qwen, a helpful assistant inside the DigitalCPU globe project."


class QwenEngine:
    def __init__(self, config: BackendConfig):
        self.config = config
        self.model = None
        self.ready = False
        self.error = ""
        self.lock = threading.Lock()

    def load(self):
        with self.lock:
            self.ready = False
            self.error = ""

            model_path = Path(self.config.model_path)
            if not model_path.exists():
                self.error = f"Model file not found: {model_path}"
                return False

            try:
                from llama_cpp import Llama
            except ImportError:
                self.error = "Missing dependency: llama-cpp-python. Install it before loading the GGUF model."
                return False

            try:
                self.model = Llama(
                    model_path=str(model_path),
                    n_ctx=self.config.n_ctx,
                    n_gpu_layers=self.config.n_gpu_layers,
                    verbose=False,
                )
                self.ready = True
                return True
            except Exception as exc:
                self.model = None
                self.error = f"Model load failed: {exc}"
                return False

    def unload(self):
        with self.lock:
            self.model = None
            self.ready = False
            self.error = ""

    def chat(self, messages, temperature=None, max_tokens=None):
        with self.lock:
            if not self.ready or self.model is None:
                raise RuntimeError(self.error or "Model is not loaded.")

            response = self.model.create_chat_completion(
                messages=messages,
                temperature=self.config.temperature if temperature is None else temperature,
                max_tokens=self.config.max_tokens if max_tokens is None else max_tokens,
            )

        return response["choices"][0]["message"]["content"]


class AppState:
    def __init__(self, config: BackendConfig):
        self.config = config
        self.engine = QwenEngine(config)
        self.server = None
        self.server_thread = None
        self.log = queue.Queue()

    def log_line(self, text):
        stamp = time.strftime("%H:%M:%S")
        line = f"[{stamp}] {text}"
        self.log.put(line)
        print(line)


def load_config():
    if not CONFIG_PATH.exists():
        return BackendConfig()

    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        return BackendConfig(**{**asdict(BackendConfig()), **data})
    except Exception:
        return BackendConfig()


def save_config(config: BackendConfig):
    CONFIG_PATH.write_text(json.dumps(asdict(config), indent=2), encoding="utf-8")


def allowed_origin(config: BackendConfig, origin: str):
    if not origin:
        return ""

    origins = [item.strip() for item in config.allowed_origins.split(",") if item.strip()]
    return origin if origin in origins else ""


def response_headers(handler, content_type="application/json; charset=utf-8"):
    config = handler.server.app_state.config
    headers = {"Content-Type": content_type}
    origin = allowed_origin(config, handler.headers.get("Origin", ""))
    if origin:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Vary"] = "Origin"
        headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return headers


def is_authorized(handler):
    config = handler.server.app_state.config
    if not config.access_token and config.host == "127.0.0.1":
        return True

    header = handler.headers.get("Authorization", "")
    return bool(config.access_token) and header == f"Bearer {config.access_token}"


def send_json(handler, status, payload):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    for key, value in response_headers(handler).items():
        handler.send_header(key, value)
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def read_json(handler):
    length = int(handler.headers.get("Content-Length", "0"))
    if length > 1024 * 1024:
        raise ValueError("Request body too large.")
    body = handler.rfile.read(length).decode("utf-8") if length else "{}"
    return json.loads(body)


def static_path(url_path):
    requested = unquote(urlparse(url_path).path)
    if requested == "/":
        requested = "/index.html"
    candidate = (ROOT / requested.lstrip("/")).resolve()
    if ROOT not in candidate.parents and candidate != ROOT:
        return None
    return candidate


class ChatHandler(BaseHTTPRequestHandler):
    server_version = "QwenWidgetBackend/0.1"

    def do_OPTIONS(self):
        self.send_response(204)
        for key, value in response_headers(self).items():
            self.send_header(key, value)
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/api/status"):
            state = self.server.app_state
            send_json(self, 200, {
                "ready": state.engine.ready,
                "error": state.engine.error,
                "model": state.config.model_name,
                "host": state.config.host,
                "port": state.config.port,
            })
            return

        file_path = static_path(self.path)
        if not file_path or not file_path.exists() or not file_path.is_file():
            self.send_error(404)
            return

        content_types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
        }
        body = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_types.get(file_path.suffix.lower(), "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if not self.path.startswith("/api/chat") and not self.path.startswith("/v1/chat/completions"):
            send_json(self, 404, {"error": "Unknown endpoint."})
            return

        if not is_authorized(self):
            send_json(self, 401, {"error": "Missing or invalid access token."})
            return

        state = self.server.app_state
        try:
            body = read_json(self)
            messages = body.get("messages")
            if not isinstance(messages, list):
                raise ValueError("messages must be a list.")

            reply = state.engine.chat(
                messages,
                temperature=body.get("temperature"),
                max_tokens=body.get("max_tokens"),
            )
            payload = {
                "reply": reply,
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": reply},
                        "finish_reason": "stop",
                    }
                ],
            }
            send_json(self, 200, payload)
        except Exception as exc:
            send_json(self, 500, {"error": str(exc)})

    def log_message(self, format_string, *args):
        self.server.app_state.log_line(format_string % args)


def server_can_start(config: BackendConfig):
    if config.host != "127.0.0.1" and not config.access_token:
        return False, "Public host requires access_token. Set token before start."
    return True, ""


def start_server(state: AppState):
    if state.server:
        state.log_line("Server is already running.")
        return

    ok, reason = server_can_start(state.config)
    if not ok:
        state.log_line(reason)
        return

    server = ThreadingHTTPServer((state.config.host, state.config.port), ChatHandler)
    server.app_state = state
    state.server = server
    state.server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    state.server_thread.start()
    state.log_line(f"Server running at http://{state.config.host}:{state.config.port}")


def stop_server(state: AppState):
    if not state.server:
        state.log_line("Server is not running.")
        return

    state.server.shutdown()
    state.server.server_close()
    state.server = None
    state.server_thread = None
    state.log_line("Server stopped.")


def print_help():
    print("""
Commands:
  help                         Show this command list
  show                         Show current settings and model state
  save                         Save settings to backend_config.json
  load-model                   Load or reload the GGUF model
  unload-model                 Unload the model from memory
  start                        Start the web/API server
  stop                         Stop the web/API server
  chat <message>               Send a terminal chat message
  set <key> <value>            Set a config value
  cloudflare                   Show Cloudflare tunnel setup notes
  install                      Show llama-cpp-python install command
  quit                         Stop server and exit

Set keys:
  model_path, host, port, access_token, allowed_origins, model_name,
  n_ctx, n_gpu_layers, temperature, max_tokens, system_prompt
""".strip())


def show_state(state: AppState):
    data = asdict(state.config)
    if data["access_token"]:
        data["access_token"] = "(set)"
    print(json.dumps(data, indent=2))
    print(f"model_ready: {state.engine.ready}")
    print(f"model_error: {state.engine.error or '-'}")
    print(f"server: {'running' if state.server else 'stopped'}")


def set_config_value(config: BackendConfig, key: str, value: str):
    if not hasattr(config, key):
        raise KeyError(f"Unknown setting: {key}")

    current = getattr(config, key)
    if isinstance(current, int):
        value = int(value)
    elif isinstance(current, float):
        value = float(value)
    setattr(config, key, value)


def terminal_chat(state: AppState, text: str):
    messages = [
        {"role": "system", "content": state.config.system_prompt},
        {"role": "user", "content": text},
    ]
    print("Qwen: ", end="", flush=True)
    try:
      reply = state.engine.chat(messages)
      print(reply)
    except Exception as exc:
      print(f"error: {exc}")


def print_cloudflare_notes(state: AppState):
    print(f"""
Cloudflare-ready setup:
  1. Set an access token:
     set access_token choose-a-long-random-token

  2. Allow your public site origin:
     set allowed_origins https://your-domain.example

  3. Switch server host:
     set host 127.0.0.1
     save
     start

  4. In another terminal, run a Cloudflare Tunnel to this local backend:
     cloudflared tunnel --url http://127.0.0.1:{state.config.port}

  5. In the widget settings, use the tunnel URL plus /api/chat and the same token.

Avoid HOST=0.0.0.0 unless you also set access_token and firewall rules.
""".strip())


def print_install_notes():
    print("""
Install llama-cpp-python for GGUF loading:
  python -m pip install llama-cpp-python

If GPU acceleration is needed, install the CUDA/Metal-specific build that matches
your machine. The backend will run after `import llama_cpp` works.
""".strip())


def run_console(state: AppState):
    print("Qwen chatbot backend terminal. Type `help`.")
    while True:
        try:
            raw = input("qwen-backend> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            raw = "quit"

        if not raw:
            continue

        try:
            parts = shlex.split(raw)
        except ValueError as exc:
            print(f"Parse error: {exc}")
            continue

        command = parts[0].lower()
        args = parts[1:]

        try:
            if command == "help":
                print_help()
            elif command == "show":
                show_state(state)
            elif command == "save":
                save_config(state.config)
                print(f"Saved {CONFIG_PATH}")
            elif command == "load-model":
                print("Loading model...")
                ok = state.engine.load()
                print("Model loaded." if ok else state.engine.error)
            elif command == "unload-model":
                state.engine.unload()
                print("Model unloaded.")
            elif command == "start":
                start_server(state)
            elif command == "stop":
                stop_server(state)
            elif command == "chat":
                terminal_chat(state, " ".join(args))
            elif command == "set":
                if len(args) < 2:
                    print("Usage: set <key> <value>")
                    continue
                set_config_value(state.config, args[0], " ".join(args[1:]))
                print(f"Set {args[0]}.")
            elif command == "cloudflare":
                print_cloudflare_notes(state)
            elif command == "install":
                print_install_notes()
            elif command in ("quit", "exit"):
                stop_server(state)
                break
            else:
                print(f"Unknown command: {command}")
        except Exception as exc:
            print(f"Error: {exc}")


def main():
    parser = argparse.ArgumentParser(description="Qwen GGUF chatbot backend.")
    parser.add_argument("--serve", action="store_true", help="Start server immediately.")
    parser.add_argument("--load-model", action="store_true", help="Load model on startup.")
    parser.add_argument("--no-console", action="store_true", help="Do not start terminal console.")
    args = parser.parse_args()

    config = load_config()
    state = AppState(config)

    if args.load_model:
        state.engine.load()
    if args.serve:
        start_server(state)
    if not args.no_console:
        run_console(state)
    elif args.serve:
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            stop_server(state)


if __name__ == "__main__":
    main()
