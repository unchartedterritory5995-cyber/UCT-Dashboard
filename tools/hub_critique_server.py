"""A ~50 MB static harness for the R8 critique — the built SPA plus the four API answers the hub
actually needs, and nothing else.

⛔⛔ WHY THIS EXISTS RATHER THAN THE SANDBOX. `scripts/hub_sandbox_boot.py` boots the whole
FastAPI app (~1 GB) and arms the shared-data-root guards, which is exactly right for a device
certification run. For photographing a control's MATERIAL it is the wrong instrument twice over:

  1. It costs a gigabyte on a box that is already contended.
  2. Its snapshot rail aborts the run whenever ANYTHING changes under `C:\\data` — including
     another session's writes, which it cannot attribute (see `resource-manifest.md` §7 and §9).
     On a shared box that makes a long browser session impossible for reasons unrelated to the hub.

**This server never reads or writes the shared data root. There is no database, no scheduler, no
env pin, and nothing to leak** — which is also why it needs no guard.

⛔ WHAT IT CANNOT TELL YOU, STATED SO NO SCREENSHOT OVERSTATES ITSELF. The data tiles behind the
hub will be empty or error, because every other `/api/*` call returns an empty document. The design
bar says this control "sits over dense, moving data", so **a blur judged over a blank page is
judged over the easiest backdrop it will ever have**. Material, radii, shadow, hierarchy, motion
and layout are all fair game; "does the glass hold up over a live chart" is NOT, and is answered
only on the sandbox or a device. `--backdrop` paints a dense synthetic field behind the app to make
the blur at least non-trivial, and it is synthetic BY CONSTRUCTION so it can never be mistaken for
product data.
"""
from __future__ import annotations

import argparse
import json
import socket
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DIST = Path(__file__).resolve().parents[1] / "app" / "dist"

# The admin the hub needs. ⛔ Synthetic, local-only, and never a real address.
USER = {
    "id": "critique-harness-0000",
    "email": "critique@harness.invalid",
    "display_name": "Critique Harness",
    "role": "admin",
    "email_verified": True,
}

# `useHubSettings` reads this blob. `enabled: true` is what puts the hub on screen;
# `traceGestures` stays OFF so the smoothness capture's rAF loop does not run during a screenshot.
PREFS = {
    "joystick_hub": json.dumps({"enabled": True, "handedness": "right", "surface": "simplified"}),
}

BACKDROP = """
<style id="critique-backdrop">
  /* ⛔ SYNTHETIC BY CONSTRUCTION — a moire of ruled lines and blocks, obviously not product data.
     It exists so `backdrop-filter` has something to refract. Judging a blur over a blank page
     flatters it. */
  html::before {
    content: ''; position: fixed; inset: 0; z-index: 0; pointer-events: none;
    background:
      repeating-linear-gradient(90deg, rgba(120,140,170,.20) 0 2px, transparent 2px 9px),
      repeating-linear-gradient(0deg,  rgba(120,140,170,.14) 0 2px, transparent 2px 14px),
      repeating-linear-gradient(45deg, rgba(200,120,90,.16) 0 10px, transparent 10px 26px),
      linear-gradient(160deg, #10141c 0%, #1d2430 45%, #0d1117 100%);
  }
</style>
"""


class Handler(BaseHTTPRequestHandler):
    backdrop = False

    def log_message(self, *a):  # quiet
        pass

    def _send(self, code, body: bytes, ctype: str):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj).encode(), "application/json")

    def do_POST(self):
        # Preference writes succeed and are discarded — the harness is stateless on purpose, so
        # every capture starts from the same surface rather than from whatever the last run left.
        self._json({"ok": True})

    def do_GET(self):
        path = self.path.split("?", 1)[0]

        if path == "/api/auth/me":
            return self._json({"user": USER, "plan": "pro", "isPaid": True,
                               "hub_preview_enabled": True})
        if path == "/api/auth/preferences":
            return self._json(PREFS)
        if path == "/__harness":
            # Identity, so a capture can prove WHICH server it photographed.
            return self._json({"harness": "hub_critique_server", "dist": str(DIST),
                               "index_bytes": (DIST / "index.html").stat().st_size})
        if path.startswith("/api/"):
            # Everything else answers empty rather than 404, so the SPA renders its own
            # empty-states instead of an error boundary that would cover the hub.
            return self._json({})

        rel = path.lstrip("/")
        target = (DIST / rel) if rel else (DIST / "index.html")
        if target.is_file():
            ctype = {
                ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
                ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
                ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2",
                ".ico": "image/x-icon", ".map": "application/json",
            }.get(target.suffix, "application/octet-stream")
            return self._send(200, target.read_bytes(), ctype)

        # SPA fallback — every client route serves index.html.
        html = (DIST / "index.html").read_text(encoding="utf-8")
        if Handler.backdrop:
            html = html.replace("</head>", BACKDROP + "</head>", 1)
        return self._send(200, html.encode("utf-8"), "text/html")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8131)
    ap.add_argument("--backdrop", action="store_true",
                    help="paint a synthetic dense field behind the app so the blur is non-trivial")
    args = ap.parse_args()

    if not (DIST / "index.html").is_file():
        print(f"  ! no build at {DIST} — run `npm run build` in app/ first", file=sys.stderr)
        return 1

    # ⛔ A PORT ASSIGNMENT IS NOT A SERVER IDENTITY. Refuse a busy port outright rather than
    # binding beside somebody else — Windows permits a second listener and then nobody can say
    # which socket answered. `/__harness` is how a caller confirms it reached THIS server.
    probe = socket.socket()
    probe.settimeout(1.0)
    try:
        probe.connect(("127.0.0.1", args.port))
        print(f"  ! port {args.port} already has a listener — refusing to bind beside it",
              file=sys.stderr)
        return 2
    except Exception:
        pass
    finally:
        probe.close()

    Handler.backdrop = args.backdrop
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"  harness serving {DIST}")
    print(f"  http://127.0.0.1:{args.port}   backdrop={'on' if args.backdrop else 'off'}")
    print("  no database, no scheduler, no shared-root access")
    srv.serve_forever()


if __name__ == "__main__":
    sys.exit(main())
