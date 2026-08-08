import json
import shlex
import subprocess
import sys
import threading
import time
import webbrowser
from dataclasses import asdict
from pathlib import Path

import backend
import launch_cloudflare_quick_tunnel as mobile


ROOT = Path(__file__).resolve().parent
CONTROL_CONFIG = ROOT / "control_panel_config.json"
MOBILE_LAUNCHER = ROOT / "start_cloudflare_quick_tunnel.bat"

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
        print(f"model_loaded: {self.state.engine.ready}")
        print(f"local_api: {'running' if self.state.server else 'stopped'}")
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

    def tunnel_running(self):
        return bool(self.tunnel_process and self.tunnel_process.poll() is None)

    def load_model(self):
        self.log("Loading Qwen model...")
        if self.state.engine.load():
            self.log("Model loaded.")
        else:
            self.log(self.state.engine.error)

    def start_api(self):
        backend.start_server(self.state)

    def stop_api(self):
        backend.stop_server(self.state)

    def start_tunnel(self):
        if self.tunnel_running():
            self.log("Cloudflare tunnel is already running.")
            return
        if not mobile.CLOUDFLARED.exists():
            self.log(f"Missing cloudflared: {mobile.CLOUDFLARED}")
            return
        if not self.state.server:
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
        if not self.state.engine.ready:
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

    def set_value(self, key, value):
        backend.set_config_value(self.config, key, value)
        self.log(f"Set {key}.")

    def set_llm_value(self, key, value):
        if key not in LLM_SETTING_KEYS:
            raise KeyError(f"Unknown LLM setting: {key}")
        if self.state.engine.ready:
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
            self.config.n_gpu_layers = -1
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
  load-model                   Load Qwen into this control panel process
  start-api                    Start local API in this control panel process
  stop-api                     Stop local API in this control panel process
  start-tunnel                 Start Cloudflare tunnel from this panel
  publish-relay                Publish detected tunnel to stable Cloudflare relay
  start-mobile                 Run model/API/tunnel sequence from this panel
  start-mobile-window          Fallback: start old launcher in a new window
  start-all                    Save settings, run mobile sequence, open Netlify
  stop-all                     Stop tunnel/API started by this panel
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
    print("Use `start-all` for the current working mobile launch flow.")
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
            elif command == "start-mobile":
                panel.start_mobile()
            elif command == "start-mobile-window":
                panel.start_mobile_window()
            elif command == "start-all":
                panel.start_all()
            elif command == "stop-all":
                panel.stop_all()
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
