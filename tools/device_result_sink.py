"""Catch device-suite results over the tunnel, so the PHONE can show only the app.

⛔ WHY THIS EXISTS. The harness used to split the screen — app on top, a verdict
panel filling the bottom 46% — because a one-minute BrowserStack session had no
way to talk back and a screenshot was the only channel. That panel was a
workaround for the cap, not a feature, and it meant every device look was of a
half-height app. With real session length the phone can simply POST its results
here and render the app full-screen.

⛔ AND IT IS A SEPARATE PROCESS ON ITS OWN PORT, deliberately. Adding a collector
endpoint to `api/` would put test scaffolding into the product's routing table
for the sake of a harness. BrowserStack Local forwards ANY localhost port, so a
plain stdlib server on 8094 is reachable from the device as
`http://bs-local.com:8094/r` with nothing added to the app.

⛔ THE FALLBACK IS THE POINT. If this sink is not running, or the tunnel does not
forward it, the harness REVEALS ITS PANEL again rather than showing a clean app
and no results — a silent black hole is the one outcome worse than a split
screen. The page decides that from this endpoint's own answer.

Usage:  python tools/device_result_sink.py [--port 8094]
        (Ctrl-C to stop; results land in tools/review_feed_probe_out/device/)
"""
from __future__ import annotations

import argparse
import json
import pathlib
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

OUT = pathlib.Path(__file__).resolve().parent / "review_feed_probe_out" / "device"


def _summarise(payload: dict) -> str:
    s = payload.get("summary") or {}
    ua = str(payload.get("ua") or "")
    # The device model is the only part of a UA worth reading aloud here.
    dev = "iPhone" if "iPhone" in ua else ("iPad" if "iPad" in ua else "device")
    ios = ""
    if "OS " in ua:
        try:
            ios = ua.split("OS ", 1)[1].split(" ", 1)[0].replace("_", ".")
        except Exception:
            ios = ""
    vp = payload.get("viewport") or []
    head = (f"{dev} {ios} · {vp[0]}x{vp[1]} · {payload.get('elapsedMs')}ms"
            if len(vp) == 2 else f"{dev} {ios}")
    return (f"  {head}\n"
            f"  PASS {s.get('pass')} · FAIL {s.get('fail')} · BLOCKED {s.get('blocked')}"
            f" / {s.get('total')}")


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        # The harness page is served from :8093; this is :8094, so every POST is
        # cross-origin. `text/plain` keeps it a SIMPLE request (no preflight),
        # which is why the page sends JSON under that content type.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):  # noqa: N802
        # A liveness probe the harness can use before deciding to hide its panel.
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"sink-ok")

    def do_POST(self):  # noqa: N802
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(n).decode("utf-8", "replace")
            payload = json.loads(body)
        except Exception as e:  # noqa: BLE001
            self.send_response(400)
            self._cors()
            self.end_headers()
            print(f"[sink] bad payload: {e}")
            return

        OUT.mkdir(parents=True, exist_ok=True)
        run = str(payload.get("runId") or int(time.time()))
        suite = str(payload.get("suite") or "suite")
        path = OUT / f"{suite}-{run}.json"
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

        print(f"\n[sink] {suite}")
        print(_summarise(payload))
        for r in payload.get("results") or []:
            if r.get("state") != "PASS":
                print(f"     {r.get('state')} {r.get('id')}: {str(r.get('note'))[:110]}")
        print(f"  -> {path}", flush=True)

        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"stored")

    def log_message(self, *a):  # keep the console to results only
        pass


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8094)
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"[sink] listening on 127.0.0.1:{args.port} "
          f"(device reaches it as http://bs-local.com:{args.port}/r)")
    print(f"[sink] writing to {OUT}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
