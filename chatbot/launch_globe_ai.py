import argparse
import time
import webbrowser

import backend


DEFAULT_GLOBE_URL = "http://127.0.0.1:8019/index.html"
PUBLIC_GLOBE_URL = "https://digitalcpu.github.io/globe/"


def build_parser():
    parser = argparse.ArgumentParser(
        description="Launch the local Qwen backend and open the globe page."
    )
    parser.add_argument("--host", default="127.0.0.1", help="Backend host.")
    parser.add_argument("--port", type=int, default=8091, help="Backend port.")
    parser.add_argument(
        "--globe-url",
        default=DEFAULT_GLOBE_URL,
        help="Globe page to open after the backend starts.",
    )
    parser.add_argument(
        "--github",
        action="store_true",
        help="Open the GitHub Pages globe instead of the local globe server.",
    )
    parser.add_argument(
        "--allowed-origin",
        action="append",
        default=[],
        help="Allowed browser origin for CORS. May be used more than once.",
    )
    parser.add_argument(
        "--token",
        default="",
        help="Access token required for public/tunneled use.",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Start the backend without opening a browser.",
    )
    return parser


def main():
    args = build_parser().parse_args()
    config = backend.load_config()
    config.host = args.host
    config.port = args.port
    if args.token:
        config.access_token = args.token

    origins = {
        "http://127.0.0.1:8019",
        "http://localhost:8019",
        "https://digitalcpu.github.io",
        *[origin.strip().rstrip("/") for origin in args.allowed_origin if origin.strip()],
    }
    config.allowed_origins = ",".join(sorted(origins))
    backend.save_config(config)

    state = backend.AppState(config)
    state.log_line("Loading Qwen model...")
    if not state.engine.load():
        raise SystemExit(state.engine.error)

    backend.start_server(state)
    globe_url = PUBLIC_GLOBE_URL if args.github else args.globe_url
    if not args.no_browser:
        webbrowser.open(globe_url)
        state.log_line(f"Opened {globe_url}")

    state.log_line("Backend is ready. Press Ctrl+C to stop.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        backend.stop_server(state)


if __name__ == "__main__":
    main()
