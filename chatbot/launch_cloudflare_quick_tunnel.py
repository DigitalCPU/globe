import json
import re
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

import backend


def app_root():
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


ROOT = app_root()
CLOUDFLARED = ROOT / "tools" / "cloudflared.exe"
LAST_TUNNEL = ROOT / "last_tunnel.json"
RELAY_CONFIG = ROOT / "relay_config.json"
PUBLIC_GLOBE = "https://livesatellite.netlify.app/"
STABLE_RELAY = "https://globe-qwen-relay.digitalcomputermail.workers.dev"
PUBLIC_ORIGINS = [
    "https://livesatellite.netlify.app",
    "https://digitalcpu.github.io",
    "http://127.0.0.1:8019",
    "http://localhost:8019",
]
TUNNEL_RE = re.compile(r"https://[-a-z0-9]+\.trycloudflare\.com", re.IGNORECASE)


def load_relay_config():
    if not RELAY_CONFIG.exists():
        return {"relay_url": STABLE_RELAY, "update_secret": ""}

    try:
        data = json.loads(RELAY_CONFIG.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError:
        data = {}
    return {
        "relay_url": str(data.get("relay_url") or STABLE_RELAY).rstrip("/"),
        "update_secret": str(data.get("update_secret") or ""),
    }


def ensure_config():
    config = backend.load_config()
    config.host = "127.0.0.1"
    config.port = 8091
    config.access_token = ""

    origins = {item.strip().rstrip("/") for item in config.allowed_origins.split(",") if item.strip()}
    origins.update(PUBLIC_ORIGINS)
    config.allowed_origins = ",".join(sorted(origins))
    backend.save_config(config)
    return config


def publish_tunnel(endpoint):
    relay = load_relay_config()
    if not relay["update_secret"]:
        print("Stable relay update skipped: relay_config.json is missing update_secret.")
        return None

    body = json.dumps({"endpoint": endpoint}).encode("utf-8")
    request = Request(
        f"{relay['relay_url']}/admin/tunnel?secret={quote(relay['update_secret'])}",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "User-Agent": "DigitalCPU-Globe-Launcher/1.0",
        },
    )
    try:
        with urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
        print(f"Stable relay update failed: {error}")
        return None


def pipe_cloudflared_output(process, found_url):
    while process.poll() is None:
        if process.stdout is None:
            return
        line = process.stdout.readline()
        if not line:
            continue
        print(line.rstrip())
        match = TUNNEL_RE.search(line)
        if match and not found_url["url"]:
            found_url["url"] = match.group(0)
        time.sleep(0.02)


def main():
    if not CLOUDFLARED.exists():
        raise SystemExit(f"cloudflared.exe not found: {CLOUDFLARED}")

    config = ensure_config()
    state = backend.AppState(config)

    state.log_line("Loading Qwen model...")
    if not state.engine.load():
        raise SystemExit(state.engine.error)
    backend.start_server(state)

    command = [
        str(CLOUDFLARED),
        "tunnel",
        "--url",
        f"http://127.0.0.1:{config.port}",
    ]
    process = subprocess.Popen(
        command,
        cwd=str(ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    found_url = {"url": ""}
    reader = threading.Thread(target=pipe_cloudflared_output, args=(process, found_url), daemon=True)
    reader.start()

    print()
    print("Waiting for Cloudflare to assign a public URL...")
    for _ in range(90):
        if found_url["url"]:
            tunnel_endpoint = f"{found_url['url']}/api/chat"
            stable_endpoint = f"{STABLE_RELAY}/api/chat"
            relay_result = publish_tunnel(tunnel_endpoint)
            LAST_TUNNEL.write_text(
                json.dumps(
                    {
                        "endpoint": stable_endpoint,
                        "current_tunnel_endpoint": tunnel_endpoint,
                        "stable_relay_updated": bool(relay_result and relay_result.get("ok")),
                        "access_token": "",
                        "model": config.model_name,
                        "allowed_origins": config.allowed_origins,
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
            print()
            print("Cloudflare tunnel is ready.")
            print(f"Stable widget endpoint: {stable_endpoint}")
            print(f"Current tunnel endpoint: {tunnel_endpoint}")
            print("Widget access token: not required")
            print(f"Saved details: {LAST_TUNNEL}")
            webbrowser.open(PUBLIC_GLOBE)
            break
        if process.poll() is not None:
            raise SystemExit(process.returncode or 1)
        time.sleep(1)
    else:
        print("Tunnel started, but no public URL was detected yet.")

    print()
    print("Keep this window open while using the public chatbot. Press Ctrl+C to stop.")
    try:
        while process.poll() is None:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        process.terminate()
        backend.stop_server(state)
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
        sys.exit(0)


if __name__ == "__main__":
    main()
