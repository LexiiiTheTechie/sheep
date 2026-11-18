#!/usr/bin/env python3
"""Minimal stand-in for engine/server.py.

Used to exercise the Sheep shell end to end without installing the full
TextGen requirements. It speaks just enough of the Gradio contract:

  * prints the "Running on local URL:" line the supervisor waits for,
  * serves a page on 127.0.0.1:<port>,
  * reports what the webview did back to stdout (visible in the terminal and
    in cache/sheep-shell.log).

Run it with:

  SHEEP_PYTHON=$(command -v python3) \
  SHEEP_SERVER=$PWD/src-tauri/dev/stub_server.py \
  ./src-tauri/target/debug/sheep
"""
from __future__ import annotations

import argparse
import json
import signal
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>TextGen (stub)</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         background:#0f1216; color:#e8eaf0;
         font:14px/1.6 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif; }
  .card { width:min(560px,86vw); padding:28px; border-radius:14px;
          background:#171b21; border:1px solid #262c34; }
  h1 { margin:0 0 6px; font-size:18px; }
  .ok { color:#8ee6a8; font-weight:600; letter-spacing:.3px; }
  p { margin:8px 0; color:#9aa2af; }
  code { color:#d8c39a; }
  button { margin-top:14px; padding:8px 14px; border-radius:8px; cursor:pointer;
           background:#232a33; color:#e8eaf0; border:1px solid #313946; }
  #out { color:#c9d0db; word-break:break-all; }
  a { color:#9fc6ff; }
</style></head>
<body><div class="card">
  <div class="ok">SHEEP STUB ENGINE OK</div>
  <h1>TextGen webview smoke test</h1>
  <p>Bridge: <code id="bridge">checking…</code></p>
  <p>Renderer: <code id="ua">…</code></p>
  <button id="pick">Pick a folder (electronAPI)</button>
  <p id="out">—</p>
  <p><a href="https://example.com" target="_blank">External link test</a></p>
</div>
<script>
  const bridge = typeof window.electronAPI;
  document.getElementById("bridge").textContent = bridge;
  document.getElementById("ua").textContent = navigator.userAgent;

  (async () => {
    let ipc = "unavailable";
    try {
      const invoke =
        (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) ||
        (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke);
      if (invoke) ipc = await invoke("ping", {});
    } catch (error) {
      ipc = "error: " + error;
    }
    document.getElementById("bridge").textContent = bridge + " / ipc=" + ipc;
    fetch("/report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bridge: bridge, ipc: ipc, ua: navigator.userAgent, href: location.href })
    }).catch(() => {});
  })();

  document.getElementById("pick").addEventListener("click", async () => {
    const value = await window.electronAPI.pickDirectory();
    document.getElementById("out").textContent = JSON.stringify(value);
    fetch("/report", { method: "POST", body: JSON.stringify({ picked: value }) }).catch(() => {});
  });
</script>
</body></html>
"""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        log(f"STUB GET {self.path}")
        body = PAGE.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("content-length") or 0)
        payload = self.rfile.read(length).decode("utf-8", "replace")
        log(f"STUB REPORT {payload}")
        self.send_response(204)
        self.end_headers()

    def log_message(self, *_args) -> None:
        pass


def log(message: str) -> None:
    sys.stdout.write(message + "\n")
    sys.stdout.flush()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--listen-port", type=int, default=7860)
    parser.add_argument("--api", action="store_true")
    parser.add_argument("--portable", action="store_true")
    args, _unknown = parser.parse_known_args()

    server = ThreadingHTTPServer(("127.0.0.1", args.listen_port), Handler)

    def stop(_signum, _frame):
        log("STUB received signal, shutting down")
        server.shutdown()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    log(f"STUB args: port={args.listen_port} api={args.api} portable={args.portable}")
    log(f"Running on local URL:  http://127.0.0.1:{args.listen_port}")
    try:
        server.serve_forever()
    finally:
        server.server_close()
        log("STUB exited")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
