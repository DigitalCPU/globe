import json
import shlex
import subprocess
import sys
import threading
import time
import webbrowser
from dataclasses import asdict
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import backend
import launch_cloudflare_quick_tunnel as mobile


def app_root():
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


ROOT = app_root()
CONTROL_CONFIG = ROOT / "control_panel_config.json"
MOBILE_LAUNCHER = ROOT / "start_cloudflare_quick_tunnel.bat"
BACKEND_SCRIPT = ROOT / "backend.py"
VENV_PYTHON = ROOT / ".venv" / "Scripts" / "python.exe"
RELAY_CONFIG = ROOT / "relay_config.json"

LLM_SETTING_KEYS = {
    "model_path",
    "model_name",
    "n_ctx",
    "n_gpu_layers",
    "temperature",
    "max_tokens",
    "system_prompt",
}


class ControlPanel:
    def __init__(self):
        self.config = mobile.ensure_config()
        self.state = backend.AppState(self.config)
        self.backend_process = None
        self.mobile_process = None
        self.tunnel_process = None
        self.tunnel_thread = None
        self.tunnel_url = ""
        self.mobile_ready = False

    def log(self, message):
        print(f"[{time.strftime('%H:%M:%S')}] {message}")

    def save(self):
        backend.save_config(self.config)
        CONTROL_CONFIG.write_text(
            json.dumps(
                {
                    "mobile_launcher": str(MOBILE_LAUNCHER),
                    "stable_relay": mobile.STABLE_RELAY,
                    "netlify_site": mobile.PUBLIC_GLOBE,
                    "current_tunnel": self.tunnel_url,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        self.log("Settings saved.")

    def show(self):
        data = asdict(self.config)
        if data["access_token"]:
            data["access_token"] = "(set)"
        print(json.dumps(data, indent=2))
        print(f"backend_python: {self.backend_python()}")
        print(f"backend_process: {'running' if self.backend_running() else 'stopped'}")
        print(f"local_api: {'ready' if self.local_ready(log_result=False) else 'not ready'}")
        print(f"cloudflare_tunnel: {'running' if self.tunnel_running() else 'stopped'}")
        print(f"mobile_ready: {self.mobile_ready}")
        print(f"current_tunnel: {self.tunnel_url or '-'}")
        print(f"stable_relay: {mobile.STABLE_RELAY}/api/chat")

    def settings(self):
        model_path = Path(self.config.model_path)
        print("LLM settings")
        print(f"  model_path: {self.config.model_path}")
        print(f"  model_exists: {model_path.exists()}")
        print(f"  model_name: {self.config.model_name}")
        print(f"  context_tokens: {self.config.n_ctx}")
        print(f"  max_response_tokens: {self.config.max_tokens}")
        print(f"  temperature: {self.config.temperature}")
        print(f"  gpu_offload_layers: {self.config.n_gpu_layers}")
        print("  gpu_mode: auto/all layers" if self.config.n_gpu_layers < 0 else "  gpu_mode: manual")

    def mobile_running(self):
        return bool(self.mobile_process and self.mobile_process.poll() is None)

    def backend_python(self):
        return VENV_PYTHON if VENV_PYTHON.exists() else Path(sys.executable)

    def backend_running(self):
        return bool(self.backend_process and self.backend_process.poll() is None)

    def tunnel_running(self):
        return bool(self.tunnel_process and self.tunnel_process.poll() is None)

    def start_backend(self, load_model=False):
        if self.backend_running():
            self.log("Qwen backend is already running.")
            return True
        if not BACKEND_SCRIPT.exists():
            self.log(f"Missing backend script: {BACKEND_SCRIPT}")
            return False

        python_path = self.backend_python()
        command = [
            str(python_path),
            str(BACKEND_SCRIPT),
            "--serve",
            "--no-console",
        ]
        if load_model:
            command.insert(2, "--load-model")

        self.log(f"Starting Qwen backend with {python_path}...")
        self.backend_process = subprocess.Popen(
            command,
            cwd=str(ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        threading.Thread(target=self.watch_backend_output, daemon=True).start()
        return True

    def watch_backend_output(self):
        while self.backend_running():
            if self.backend_process.stdout is None:
                return
            line = self.backend_process.stdout.readline()
            if line:
                print(line.rstrip())

    def load_model(self):
        if not self.start_backend(load_model=True):
            return
        self.log("Waiting for Qwen model/API readiness...")
        deadline = time.time() + 90
        while time.time() < deadline:
            if self.local_ready(log_result=False):
                self.log("Model loaded and local API is ready.")
                return
            if not self.backend_running():
                self.log("Qwen backend stopped before becoming ready.")
                return
            time.sleep(2)
        self.log("Qwen backend started, but model readiness timed out.")

    def start_api(self):
        self.start_backend(load_model=False)

    def stop_api(self):
        if self.backend_running():
            self.log("Stopping Qwen backend...")
            self.backend_process.terminate()
            try:
                self.backend_process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.backend_process.kill()
            self.backend_process = None
        else:
            self.log("Qwen backend is not running.")

    def start_tunnel(self):
        if self.tunnel_running():
            self.log("Cloudflare tunnel is already running.")
            return
        if not mobile.CLOUDFLARED.exists():
            self.log(f"Missing cloudflared: {mobile.CLOUDFLARED}")
            return
        if not self.local_ready(log_result=False):
            self.log("Start local API before starting Cloudflare tunnel.")
            return

        self.tunnel_url = ""
        self.mobile_ready = False
        command = [
            str(mobile.CLOUDFLARED),
            "tunnel",
            "--url",
            f"http://127.0.0.1:{self.config.port}",
        ]
        self.log("Starting Cloudflare tunnel...")
        self.tunnel_process = subprocess.Popen(
            command,
            cwd=str(ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        self.tunnel_thread = threading.Thread(target=self.watch_tunnel_output, daemon=True)
        self.tunnel_thread.start()

    def watch_tunnel_output(self):
        while self.tunnel_running():
            if self.tunnel_process.stdout is None:
                return
            line = self.tunnel_process.stdout.readline()
            if not line:
                continue
            line = line.rstrip()
            print(line)
            match = mobile.TUNNEL_RE.search(line)
            if match and not self.tunnel_url:
                self.tunnel_url = match.group(0)
                self.publish_relay()

    def publish_relay(self):
        if not self.tunnel_url:
            self.log("No Cloudflare tunnel URL has been detected yet.")
            return False

        tunnel_endpoint = f"{self.tunnel_url}/api/chat"
        stable_endpoint = f"{mobile.STABLE_RELAY}/api/chat"
        self.log("Publishing tunnel to stable relay...")
        relay_result = mobile.publish_tunnel(tunnel_endpoint)
        self.mobile_ready = bool(relay_result and relay_result.get("ok"))
        mobile.LAST_TUNNEL.write_text(
            json.dumps(
                {
                    "endpoint": stable_endpoint,
                    "current_tunnel_endpoint": tunnel_endpoint,
                    "stable_relay_updated": self.mobile_ready,
                    "access_token": "",
                    "model": self.config.model_name,
                    "allowed_origins": self.config.allowed_origins,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        if self.mobile_ready:
            self.log(f"Mobile ready: {stable_endpoint}")
        else:
            self.log("Stable relay update failed.")
        return self.mobile_ready

    def start_mobile(self):
        if not self.local_ready(log_result=False):
            self.load_model()
        self.start_api()
        self.start_tunnel()

    def start_mobile_window(self):
        if self.mobile_running():
            self.log("Fallback mobile launcher is already running.")
            return
        if not MOBILE_LAUNCHER.exists():
            self.log(f"Missing launcher: {MOBILE_LAUNCHER}")
            return
        self.log("Starting fallback mobile launcher in a new window...")
        self.mobile_process = subprocess.Popen(
            ["cmd", "/c", "start", "Qwen Mobile Access", str(MOBILE_LAUNCHER)],
            cwd=str(ROOT),
            shell=False,
        )
        self.log("Fallback launcher requested. Keep its window open.")

    def start_all(self):
        self.save()
        self.start_mobile()
        self.open_site()

    def quick_launch(self):
        self.log("Applying standard quick-launch settings...")
        self.config.temperature = 0.7
        self.config.max_tokens = 768
        self.config.n_ctx = 8192
        self.config.n_gpu_layers = 12
        self.save()
        self.log("Starting mobile access with standard model operation settings...")
        self.start_mobile()
        self.open_site()

    def restart_all(self):
        self.stop_all()
        time.sleep(1)
        self.start_all()

    def stop_all(self):
        if self.tunnel_running():
            self.log("Stopping Cloudflare tunnel...")
            self.tunnel_process.terminate()
            try:
                self.tunnel_process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.tunnel_process.kill()
        self.mobile_ready = False
        self.stop_api()
        self.log("Mobile access stopped.")

    def open_site(self):
        webbrowser.open(mobile.PUBLIC_GLOBE)
        self.log(f"Opened {mobile.PUBLIC_GLOBE}")

    def request_json(self, url, method="GET", payload=None, timeout=20):
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        request = Request(
            url,
            data=body,
            method=method,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "DigitalCPU-Globe-ControlPanel/1.0",
            },
        )
        try:
            with urlopen(request, timeout=timeout) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            try:
                data = json.loads(error.read().decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                data = {"error": str(error)}
            return error.code, data
        except (URLError, TimeoutError) as error:
            return 0, {"error": str(error)}

    def relay_admin_secret(self):
        data = json.loads(RELAY_CONFIG.read_text(encoding="utf-8-sig"))
        secret = str(data.get("update_secret") or "").strip()
        if not secret:
            raise RuntimeError(f"Missing update_secret in {RELAY_CONFIG}")
        return secret

    def request_relay_admin(self, path, timeout=30):
        request = Request(
            f"{mobile.STABLE_RELAY}{path}",
            method="GET",
            headers={
                "Content-Type": "application/json",
                "User-Agent": "DigitalCPU-Globe-ControlPanel/1.0",
                "X-Admin-Secret": self.relay_admin_secret(),
            },
        )
        try:
            with urlopen(request, timeout=timeout) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            try:
                data = json.loads(error.read().decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                data = {"error": str(error)}
            return error.code, data
        except (URLError, TimeoutError) as error:
            return 0, {"error": str(error)}

    def cloud_users(self):
        status, data = self.request_relay_admin("/api/admin/users")
        if status != 200:
            self.log(f"Cloud users failed: status={status} {data}")
            return
        users = data.get("users", [])
        print(f"Cloud users: {len(users)}")
        for user in users:
            print(
                f"{user.get('user_key')}  "
                f"chats={user.get('conversations')}  "
                f"first={user.get('first_seen')}  "
                f"last={user.get('last_seen')}"
            )

    def cloud_chats(self):
        status, data = self.request_relay_admin("/api/admin/conversations")
        if status != 200:
            self.log(f"Cloud chats failed: status={status} {data}")
            return
        conversations = data.get("conversations", [])
        print(f"Cloud conversations: {len(conversations)}")
        for chat in conversations:
            print(
                f"{chat.get('id')}  "
                f"{chat.get('updated_at')}  "
                f"{chat.get('user_key')}  "
                f"{chat.get('title')}"
            )

    def cloud_chat(self, chat_id):
        status, data = self.request_relay_admin(f"/api/admin/conversations/{chat_id}", timeout=60)
        if status != 200:
            self.log(f"Cloud chat failed: status={status} {data}")
            return
        conversation = data.get("conversation", {})
        print(json.dumps(conversation, indent=2))
        for message in data.get("messages", []):
            role = message.get("role", "?")
            created_at = message.get("created_at", "")
            content = str(message.get("content", ""))
            print(f"\n[{role}] {created_at}\n{content}")

    def cloud_files(self):
        status, data = self.request_relay_admin("/api/admin/files")
        if status != 200:
            self.log(f"Cloud files failed: status={status} {data}")
            return
        files = data.get("files", [])
        print(f"Cloud files: {len(files)}")
        for item in files:
            print(
                f"{item.get('id')}  "
                f"{item.get('created_at')}  "
                f"{item.get('user_key')}  "
                f"{item.get('size')} bytes  "
                f"{item.get('name')}"
            )

    def check_local(self):
        return self.local_ready(log_result=True)

    def local_ready(self, log_result=True):
        url = f"http://127.0.0.1:{self.config.port}/api/status"
        status, data = self.request_json(url, timeout=8)
        ready = status == 200 and bool(data.get("ready"))
        if log_result:
            self.log(f"Local API {'ready' if ready else 'not ready'}: status={status} {data}")
        return ready

    def check_relay(self):
        url = f"{mobile.STABLE_RELAY}/api/status"
        status, data = self.request_json(url, timeout=20)
        ready = status == 200 and bool(data.get("ready"))
        self.mobile_ready = ready
        self.log(f"Stable relay {'ready' if ready else 'not ready'}: status={status} {data}")
        return ready

    def check_chat(self):
        payload = {
            "model": self.config.model_name,
            "messages": [{"role": "user", "content": "Reply with only: mobile ready"}],
            "max_tokens": 12,
        }
        status, data = self.request_json(f"{mobile.STABLE_RELAY}/api/chat", method="POST", payload=payload, timeout=60)
        reply = str(data.get("reply", "")).strip()
        ok = status == 200 and "mobile ready" in reply.lower()
        self.log(f"Relay chat {'ready' if ok else 'not ready'}: status={status} reply={reply or data}")
        return ok

    def check_mobile(self):
        local_ok = self.check_local()
        relay_ok = self.check_relay()
        chat_ok = self.check_chat() if relay_ok else False
        self.mobile_ready = local_ok and relay_ok and chat_ok
        self.log(f"Mobile access {'READY' if self.mobile_ready else 'NOT READY'}")
        return self.mobile_ready

    def set_value(self, key, value):
        backend.set_config_value(self.config, key, value)
        self.log(f"Set {key}.")

    def set_llm_value(self, key, value):
        if key not in LLM_SETTING_KEYS:
            raise KeyError(f"Unknown LLM setting: {key}")
        if self.backend_running() or self.local_ready(log_result=False):
            self.log("Model is already loaded. Stop/restart later for this setting to take effect.")
        backend.set_config_value(self.config, key, value)
        self.save()

    def set_model(self, value):
        model_path = Path(value.strip('"'))
        if not model_path.exists():
            raise FileNotFoundError(f"Model file not found: {model_path}")
        self.set_llm_value("model_path", str(model_path))

    def set_temperature(self, value):
        temperature = float(value)
        if temperature < 0 or temperature > 2:
            raise ValueError("temperature must be between 0 and 2")
        self.set_llm_value("temperature", str(temperature))

    def set_tokens(self, value):
        max_tokens = int(value)
        if max_tokens < 1 or max_tokens > 8192:
            raise ValueError("max_tokens must be between 1 and 8192")
        self.set_llm_value("max_tokens", str(max_tokens))

    def set_context(self, value):
        n_ctx = int(value)
        if n_ctx < 512 or n_ctx > 131072:
            raise ValueError("n_ctx must be between 512 and 131072")
        self.set_llm_value("n_ctx", str(n_ctx))

    def set_gpu_layers(self, value):
        n_gpu_layers = int(value)
        if n_gpu_layers < -1 or n_gpu_layers > 999:
            raise ValueError("n_gpu_layers must be -1 for auto/all, 0 for CPU, or a positive layer count")
        self.set_llm_value("n_gpu_layers", str(n_gpu_layers))

    def apply_preset(self, preset):
        preset = preset.lower()
        if preset == "balanced":
            self.config.temperature = 0.7
            self.config.max_tokens = 768
            self.config.n_ctx = 8192
            self.config.n_gpu_layers = 12
        elif preset == "cpu":
            self.config.temperature = 0.7
            self.config.max_tokens = 512
            self.config.n_ctx = 4096
            self.config.n_gpu_layers = 0
        elif preset == "long":
            self.config.temperature = 0.7
            self.config.max_tokens = 1024
            self.config.n_ctx = 16384
            self.config.n_gpu_layers = -1
        else:
            raise ValueError("preset must be balanced, cpu, or long")
        self.save()
        self.log(f"Applied {preset} preset.")


def print_help():
    print(
        """
Commands:
  help                         Show commands
  show                         Show model/network settings and status
  settings                     Show focused LLM settings
  save                         Save current settings
  preset <balanced|cpu|long>    Apply a known LLM settings preset
  set-model <path>              Set GGUF model path
  set-temp <0..2>               Set generation temperature
  set-tokens <count>            Set max response tokens
  set-context <count>           Set context size
  set-gpu-layers <-1|0|count>   Set GPU offload layers (-1 auto/all, 0 CPU)
  load-model                   Start Qwen backend with model loaded
  start-api                    Start local API backend
  stop-api                     Stop local API backend started by this panel
  start-tunnel                 Start Cloudflare tunnel from this panel
  publish-relay                Publish detected tunnel to stable Cloudflare relay
  quick-launch                 Apply standard settings and start mobile access
  start-mobile                 Run model/API/tunnel sequence from this panel
  start-mobile-window          Fallback: start old launcher in a new window
  start-all                    Save settings, run mobile sequence, open Netlify
  restart-all                  Stop then start the full mobile sequence
  stop-all                     Stop tunnel/API started by this panel
  check-local                  Check local Qwen API
  check-relay                  Check stable Cloudflare relay
  check-chat                   Send a test prompt through the relay
  check-mobile                 Run all readiness checks
  cloud-users                  Admin: list Cloudflare D1 cloud users
  cloud-chats                  Admin: list all Cloudflare D1 conversations
  cloud-chat <id>              Admin: print one cloud conversation
  cloud-files                  Admin: list Cloudflare D1 text uploads
  open-site                    Open Netlify site
  set <key> <value>            Advanced: set any backend setting
  quit                         Exit control panel

Useful keys:
  model_path, model_name, n_ctx, n_gpu_layers, temperature, max_tokens, system_prompt
""".strip()
    )


def main():
    panel = ControlPanel()
    print("Qwen mobile access control panel. Type `help`.")
    print("Use `quick-launch` for standard settings plus mobile access.")
    while True:
        try:
            raw = input("control-panel> ").strip()
        except (KeyboardInterrupt, EOFError):
            print()
            raw = "quit"
        if not raw:
            continue
        try:
            parts = shlex.split(raw)
        except ValueError as error:
            print(f"Parse error: {error}")
            continue

        command = parts[0].lower()
        args = parts[1:]
        try:
            if command == "help":
                print_help()
            elif command == "show":
                panel.show()
            elif command == "settings":
                panel.settings()
            elif command == "save":
                panel.save()
            elif command == "preset":
                if len(args) != 1:
                    print("Usage: preset <balanced|cpu|long>")
                    continue
                panel.apply_preset(args[0])
            elif command == "set-model":
                if not args:
                    print("Usage: set-model <path>")
                    continue
                panel.set_model(" ".join(args))
            elif command == "set-temp":
                if len(args) != 1:
                    print("Usage: set-temp <0..2>")
                    continue
                panel.set_temperature(args[0])
            elif command == "set-tokens":
                if len(args) != 1:
                    print("Usage: set-tokens <count>")
                    continue
                panel.set_tokens(args[0])
            elif command == "set-context":
                if len(args) != 1:
                    print("Usage: set-context <count>")
                    continue
                panel.set_context(args[0])
            elif command == "set-gpu-layers":
                if len(args) != 1:
                    print("Usage: set-gpu-layers <-1|0|count>")
                    continue
                panel.set_gpu_layers(args[0])
            elif command == "load-model":
                panel.load_model()
            elif command == "start-api":
                panel.start_api()
            elif command == "stop-api":
                panel.stop_api()
            elif command == "start-tunnel":
                panel.start_tunnel()
            elif command == "publish-relay":
                panel.publish_relay()
            elif command == "quick-launch":
                panel.quick_launch()
            elif command == "start-mobile":
                panel.start_mobile()
            elif command == "start-mobile-window":
                panel.start_mobile_window()
            elif command == "start-all":
                panel.start_all()
            elif command == "restart-all":
                panel.restart_all()
            elif command == "stop-all":
                panel.stop_all()
            elif command == "check-local":
                panel.check_local()
            elif command == "check-relay":
                panel.check_relay()
            elif command == "check-chat":
                panel.check_chat()
            elif command == "check-mobile":
                panel.check_mobile()
            elif command == "cloud-users":
                panel.cloud_users()
            elif command == "cloud-chats":
                panel.cloud_chats()
            elif command == "cloud-chat":
                if len(args) != 1:
                    print("Usage: cloud-chat <id>")
                    continue
                panel.cloud_chat(args[0])
            elif command == "cloud-files":
                panel.cloud_files()
            elif command == "open-site":
                panel.open_site()
            elif command == "set":
                if len(args) < 2:
                    print("Usage: set <key> <value>")
                    continue
                panel.set_value(args[0], " ".join(args[1:]))
            elif command in ("quit", "exit"):
                panel.stop_api()
                break
            else:
                print(f"Unknown command: {command}")
        except Exception as error:
            print(f"Error: {error}")


if __name__ == "__main__":
    sys.exit(main())
