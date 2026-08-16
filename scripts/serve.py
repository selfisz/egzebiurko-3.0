#!/usr/bin/env python3
"""Lokalny serwer Egzebiurko 3.0 (bez instalacji)."""
from __future__ import annotations

import argparse
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:
        print(f"[egzebiurko] {self.address_string()} - {fmt % args}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Serwer lokalny Egzebiurko 3.0")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[egzebiurko] http://{args.host}:{args.port}/")
    print(f"[egzebiurko] katalog: {ROOT}")
    print("[egzebiurko] Ctrl+C — stop")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
