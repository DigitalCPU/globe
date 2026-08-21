import argparse
import html
import json
import os
import queue
import re
import shlex
import subprocess
import sys
import threading
import time
from dataclasses import asdict, dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote_plus, unquote, urlparse
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET
from geocoder import LocalGeocoder


def app_root():
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


ROOT = app_root()
WEB_ROOT = ROOT.parent
CONFIG_PATH = ROOT / "backend_config.json"
DATA_DIR = ROOT / "data"
GEOCODER_DATA_PATH = ROOT / "geocoder" / "locations.json"
GEO_EVENTS_PATH = DATA_DIR / "geo_events.jsonl"
DEFAULT_MODEL_PATH = r"C:\Users\inter\Desktop\votronix\models\llm\qwen3-4b-instruct-2507-q5_k_m.gguf"
NEWS_TIMEOUT_SECONDS = 10
VOICE_STATUS_TIMEOUT_SECONDS = 3
VOICE_TTS_TIMEOUT_SECONDS = 120
LOCAL_GEOCODER = LocalGeocoder(GEOCODER_DATA_PATH)
TAG_RE = re.compile(r"<[^>]+>")


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
    votronix_url: str = "http://127.0.0.1:8765"
    voice_enabled: bool = True
    voice_provider: str = "system"
    voice_id: str = ""
    voice_autoplay: bool = False
    voice_timeout_seconds: int = VOICE_TTS_TIMEOUT_SECONDS


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
        self.voice_audio = None
        self.voice_audio_meta = {}
        self.voice_lock = threading.Lock()

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


def client_ip(handler):
    forwarded = handler.headers.get("CF-Connecting-IP") or handler.headers.get("X-Forwarded-For") or ""
    return forwarded.split(",", 1)[0].strip() or handler.client_address[0]


def save_geo_event(handler, payload):
    lat = float(payload.get("lat"))
    lon = float(payload.get("lon"))
    if lat < -90 or lat > 90 or lon < -180 or lon > 180:
        raise ValueError("lat/lon out of range.")

    accuracy = payload.get("accuracy")
    event = {
        "captured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "lat": round(lat, 6),
        "lon": round(lon, 6),
        "accuracy": float(accuracy) if accuracy is not None else None,
        "source": str(payload.get("source") or "globe"),
        "user_key": str(payload.get("user_key") or "")[:120],
        "user_agent": handler.headers.get("User-Agent", "")[:500],
        "ip": client_ip(handler),
    }
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with GEO_EVENTS_PATH.open("a", encoding="utf-8") as file:
        file.write(json.dumps(event, separators=(",", ":")) + "\n")
    return event


def fetch_json_url(url):
    request = Request(url, headers={
        "User-Agent": "DigitalCPU Globe/0.1 local timeline"
    })
    with urlopen(request, timeout=NEWS_TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8", errors="replace"))


def fetch_text_url(url):
    request = Request(url, headers={
        "User-Agent": "DigitalCPU Globe/0.1 local timeline"
    })
    with urlopen(request, timeout=NEWS_TIMEOUT_SECONDS) as response:
        return response.read().decode("utf-8", errors="replace")


def votronix_url(config: BackendConfig, path: str):
    base = config.votronix_url.rstrip("/")
    return f"{base}/{path.lstrip('/')}"


def fetch_votronix_json(config: BackendConfig, path: str, payload=None, timeout=None):
    data = None
    headers = {"User-Agent": "DigitalCPU Globe/0.1 voice bridge"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = Request(votronix_url(config, path), data=data, headers=headers)
    with urlopen(request, timeout=timeout or VOICE_STATUS_TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8", errors="replace"))


def fetch_votronix_bytes(config: BackendConfig, path: str, timeout=None):
    request = Request(
        votronix_url(config, path),
        headers={"User-Agent": "DigitalCPU Globe/0.1 voice bridge"},
    )
    with urlopen(request, timeout=timeout or VOICE_STATUS_TIMEOUT_SECONDS) as response:
        return response.read(), response.headers.get("Content-Type", "application/octet-stream")


def voice_error_message(exc):
    if isinstance(exc, HTTPError):
        try:
            body = exc.read().decode("utf-8", errors="replace")
        except Exception:
            body = ""
        return f"Votronix HTTP {exc.code}: {body or exc.reason}"
    if isinstance(exc, URLError):
        return f"Votronix is not reachable: {exc.reason}"
    return str(exc)


def gpu_status():
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=1.5,
            check=False,
        )
    except Exception:
        return {"ok": False, "label": "GPU --"}

    line = (result.stdout or "").strip().splitlines()
    if result.returncode != 0 or not line:
        return {"ok": False, "label": "GPU --"}

    parts = [part.strip() for part in line[0].split(",")]
    if len(parts) < 3:
        return {"ok": False, "label": "GPU --"}

    try:
        usage = int(float(parts[0]))
        memory_used = int(float(parts[1]))
        memory_total = int(float(parts[2]))
        temperature = int(float(parts[3])) if len(parts) > 3 and parts[3] else None
    except ValueError:
        return {"ok": False, "label": "GPU --"}

    label = f"GPU {usage}% {memory_used}/{memory_total} MB"
    if temperature is not None:
        label = f"{label} {temperature}C"
    return {
        "ok": True,
        "usage_percent": usage,
        "memory_used_mb": memory_used,
        "memory_total_mb": memory_total,
        "temperature_c": temperature,
        "label": label,
    }


def voice_status(state: AppState):
    config = state.config
    payload = {
        "ok": True,
        "voice_enabled": config.voice_enabled,
        "votronix_running": False,
        "votronix_url": config.votronix_url,
        "tts_ready": False,
        "stt_ready": False,
        "default_tts_provider": config.voice_provider,
        "default_voice_id": config.voice_id,
        "voice_autoplay": config.voice_autoplay,
        "gpu": gpu_status(),
        "error": "",
    }
    if not config.voice_enabled:
        payload["error"] = "Voice bridge is disabled."
        return payload
    try:
        status = fetch_votronix_json(config, "/api/status", timeout=VOICE_STATUS_TIMEOUT_SECONDS)
        payload.update({
            "votronix_running": bool(status.get("ok", True)),
            "tts_ready": True,
            "stt_ready": True,
            "votronix_status": status,
        })
    except Exception as exc:
        payload["error"] = voice_error_message(exc)
    return payload


def voice_providers(config: BackendConfig):
    providers = fetch_votronix_json(config, "/api/providers", timeout=VOICE_STATUS_TIMEOUT_SECONDS)
    return {
        "ok": bool(providers.get("ok", True)),
        "tts": providers.get("tts", []),
        "stt": providers.get("stt", []),
        "ai": providers.get("ai", []),
    }


def normalize_voice(voice):
    voice_id = str(voice.get("voice_id") or voice.get("id") or "")
    return {
        "id": voice_id,
        "voice_id": voice_id,
        "name": str(voice.get("name") or voice_id or "Unnamed voice"),
        "language": voice.get("language"),
    }


def voice_list(config: BackendConfig, provider_id: str):
    response = fetch_votronix_json(
        config,
        f"/api/tts/voices?provider_id={quote_plus(provider_id)}",
        timeout=VOICE_STATUS_TIMEOUT_SECONDS,
    )
    voices = [normalize_voice(voice) for voice in response.get("voices", []) if isinstance(voice, dict)]
    return {
        "ok": bool(response.get("ok", True)),
        "provider_id": response.get("provider_id") or provider_id,
        "voices": voices,
    }


def active_voice(config: BackendConfig):
    response = fetch_votronix_json(config, "/api/globe/active-voice", timeout=VOICE_STATUS_TIMEOUT_SECONDS)
    return {
        "ok": bool(response.get("ok", True)),
        "active": bool(response.get("active")),
        "provider_id": str(response.get("provider_id") or ""),
        "voice_id": str(response.get("voice_id") or ""),
        "name": str(response.get("name") or ""),
        "updated_at": str(response.get("updated_at") or ""),
    }


def synthesize_voice(state: AppState, payload):
    config = state.config
    if not config.voice_enabled:
        raise RuntimeError("Voice bridge is disabled.")

    text = str(payload.get("text") or "").strip()
    if not text:
        raise ValueError("text is required.")
    if len(text) > 8000:
        raise ValueError("text is too long.")

    use_active_voice = bool(payload.get("use_active_voice", True))
    provider_id = str(payload.get("provider_id") or ("" if use_active_voice else config.voice_provider) or "system")
    voice_id = str(payload.get("voice_id") or ("" if use_active_voice else config.voice_id) or "")
    request_payload = {
        "text": text,
        "provider_id": provider_id if payload.get("provider_id") or not use_active_voice else None,
        "voice_id": voice_id or None,
        "language": str(payload.get("language") or "en"),
        "use_active_voice": use_active_voice,
    }
    request_payload = {key: value for key, value in request_payload.items() if value is not None}
    timeout = max(1, int(payload.get("timeout_seconds") or config.voice_timeout_seconds or VOICE_TTS_TIMEOUT_SECONDS))

    synth = fetch_votronix_json(config, "/api/tts/synthesize", payload=request_payload, timeout=timeout)
    audio, content_type = fetch_votronix_bytes(config, "/api/audio/processed.wav", timeout=VOICE_STATUS_TIMEOUT_SECONDS)
    with state.voice_lock:
        state.voice_audio = audio
        state.voice_audio_meta = {
            "provider_id": synth.get("provider_id") or provider_id,
            "voice_id": synth.get("voice_id") or voice_id,
            "content_type": content_type or "audio/wav",
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "text_length": len(text),
        }
    return {
        "ok": True,
        "provider_id": state.voice_audio_meta["provider_id"],
        "voice_id": state.voice_audio_meta["voice_id"],
        "audio_url": "/api/voice/last.wav",
        "duration_seconds": None,
        "votronix": synth,
    }


def send_voice_audio(handler):
    state = handler.server.app_state
    with state.voice_lock:
        audio = state.voice_audio
        meta = dict(state.voice_audio_meta)
    if not audio:
        send_json(handler, 404, {"ok": False, "error": "No voice audio has been generated yet."})
        return

    handler.send_response(200)
    for key, value in response_headers(handler, meta.get("content_type") or "audio/wav").items():
        handler.send_header(key, value)
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(audio)))
    handler.end_headers()
    handler.wfile.write(audio)


def reverse_geocode(lat, lon):
    url = (
        "https://nominatim.openstreetmap.org/reverse"
        f"?format=jsonv2&lat={lat:.6f}&lon={lon:.6f}&zoom=10&addressdetails=1"
    )
    data = fetch_json_url(url)
    address = data.get("address") or {}
    city = address.get("city") or address.get("town") or address.get("village") or address.get("hamlet")
    county = address.get("county")
    state = address.get("state")
    country = address.get("country")
    place = ", ".join(item for item in [city or county, state or country] if item)
    query_place = city or county or state or country or data.get("display_name") or f"{lat:.2f}, {lon:.2f}"
    return {
        "place": place or query_place,
        "query_place": query_place,
        "city": city,
        "county": county,
        "state": state,
        "country": country,
    }


def google_news_query(location, mode):
    if location.get("worldwide"):
        today = time.strftime("%B %-d") if os.name != "nt" else time.strftime("%B %#d")
        return f'"{today}" news' if mode == "history" else "world news"

    today = time.strftime("%B %-d") if os.name != "nt" else time.strftime("%B %#d")
    place = location["query_place"]
    state = location.get("state") or ""
    if mode == "history":
        return f'"{place}" "{today}" (history OR archive OR anniversary OR happened)'
    if state and state not in place:
        return f'"{place}" "{state}"'
    return f'"{place}"'


def parse_google_news_rss(xml_text):
    root = ET.fromstring(xml_text)
    channel = root.find("channel")
    if channel is None:
        return []

    items = []
    seen = set()
    for node in channel.findall("item"):
        title = html.unescape((node.findtext("title") or "").strip())
        link = (node.findtext("link") or "").strip()
        published = (node.findtext("pubDate") or "").strip()
        description = html.unescape((node.findtext("description") or "").strip())
        description = " ".join(TAG_RE.sub(" ", description).split())[:500]
        source_node = node.find("source")
        source = html.unescape((source_node.text if source_node is not None and source_node.text else "").strip())
        if not title or title in seen:
            continue
        seen.add(title)
        items.append({
            "title": title,
            "link": link,
            "published": published,
            "source": source,
            "description": description,
        })
        if len(items) >= 12:
            break
    return items


def local_geocode(query, limit=8):
    matches = LOCAL_GEOCODER.search(query, limit=limit)
    return {
        "ok": True,
        "query": query,
        "items": matches,
        "source": "LocalGeocoder",
    }


def load_local_news(lat, lon, mode, location=None):
    if location is None:
        if lat < -90 or lat > 90 or lon < -180 or lon > 180:
            raise ValueError("lat/lon out of range.")
        location = reverse_geocode(lat, lon)

    if mode not in {"recent", "history"}:
        mode = "recent"

    query = google_news_query(location, mode)
    rss_url = (
        "https://news.google.com/rss/search"
        f"?q={quote_plus(query)}&hl=en-US&gl=US&ceid=US:en"
    )
    items = parse_google_news_rss(fetch_text_url(rss_url))
    return {
        "ok": True,
        "mode": mode,
        "place": location["place"],
        "query": query,
        "items": items,
        "source": "Google News RSS",
    }


def static_path(url_path):
    requested = unquote(urlparse(url_path).path)
    if requested == "/":
        requested = "/index.html"
    relative = requested.lstrip("/")
    first_part = relative.split("/", 1)[0]
    allowed_web_roots = {"index.html", "css", "js", "fonts"}
    allowed_chatbot_files = {"chat-widget.js", "styles.css", "widget.html"}

    if first_part in allowed_web_roots:
        candidate = (WEB_ROOT / relative).resolve()
        if WEB_ROOT in candidate.parents or candidate == WEB_ROOT:
            return candidate

    if first_part == "chatbot":
        nested = relative.split("/", 1)[1] if "/" in relative else ""
        if nested in allowed_chatbot_files:
            candidate = (WEB_ROOT / relative).resolve()
            if WEB_ROOT in candidate.parents or candidate == WEB_ROOT:
                return candidate

    if relative in allowed_chatbot_files:
        candidate = (ROOT / relative).resolve()
        if ROOT in candidate.parents or candidate == ROOT:
            return candidate

    return None


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

        if self.path.startswith("/api/voice/status"):
            send_json(self, 200, voice_status(self.server.app_state))
            return

        if self.path.startswith("/api/voice/providers"):
            try:
                send_json(self, 200, voice_providers(self.server.app_state.config))
            except Exception as exc:
                send_json(self, 503, {"ok": False, "error": voice_error_message(exc)})
            return

        if self.path.startswith("/api/voice/voices"):
            try:
                query = parse_qs(urlparse(self.path).query)
                provider_id = (query.get("provider_id") or [self.server.app_state.config.voice_provider])[0]
                send_json(self, 200, voice_list(self.server.app_state.config, provider_id))
            except Exception as exc:
                send_json(self, 503, {"ok": False, "error": voice_error_message(exc)})
            return

        if self.path.startswith("/api/voice/active"):
            try:
                send_json(self, 200, active_voice(self.server.app_state.config))
            except Exception as exc:
                send_json(self, 503, {"ok": False, "error": voice_error_message(exc)})
            return

        if self.path.startswith("/api/voice/last.wav"):
            send_voice_audio(self)
            return

        if self.path.startswith("/api/news"):
            try:
                query = parse_qs(urlparse(self.path).query)
                mode = (query.get("mode") or ["recent"])[0]
                place_query = (query.get("q") or [""])[0].strip()
                if place_query:
                    matches = LOCAL_GEOCODER.search(place_query, limit=1)
                    if not matches:
                        raise ValueError(f"Location not found: {place_query}")
                    match = matches[0]
                    location = {
                        "place": match["name"],
                        "query_place": match["name"],
                        "state": match.get("state") or "",
                        "country": match.get("country") or "",
                        "worldwide": match.get("type") == "worldwide",
                    }
                    send_json(self, 200, load_local_news(match["lat"], match["lon"], mode, location=location))
                else:
                    lat = float((query.get("lat") or [""])[0])
                    lon = float((query.get("lon") or [""])[0])
                    send_json(self, 200, load_local_news(lat, lon, mode))
            except Exception as exc:
                send_json(self, 500, {"error": str(exc)})
            return

        if self.path.startswith("/api/geocode"):
            try:
                query = parse_qs(urlparse(self.path).query)
                text = (query.get("q") or [""])[0].strip()
                limit = int((query.get("limit") or ["8"])[0])
                send_json(self, 200, local_geocode(text, limit=max(1, min(limit, 20))))
            except Exception as exc:
                send_json(self, 400, {"error": str(exc)})
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
            ".ttf": "font/ttf",
            ".woff2": "font/woff2",
        }
        body = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_types.get(file_path.suffix.lower(), "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path.startswith("/api/geo"):
            try:
                event = save_geo_event(self, read_json(self))
                send_json(self, 200, {"ok": True, "event": event})
            except Exception as exc:
                send_json(self, 400, {"error": str(exc)})
            return

        if self.path.startswith("/api/voice/tts"):
            if not is_authorized(self):
                send_json(self, 401, {"error": "Missing or invalid access token."})
                return
            try:
                send_json(self, 200, synthesize_voice(self.server.app_state, read_json(self)))
            except Exception as exc:
                send_json(self, 500, {"ok": False, "error": voice_error_message(exc)})
            return

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
  n_ctx, n_gpu_layers, temperature, max_tokens, system_prompt,
  votronix_url, voice_enabled, voice_provider, voice_id, voice_autoplay,
  voice_timeout_seconds
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
    if isinstance(current, bool):
        value = value.strip().lower() in ("1", "true", "yes", "on", "enabled")
    elif isinstance(current, int):
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
