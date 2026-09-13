"""Wave Q1 — a local probe server that can PROVE it is the one answering.

⚰️ WHY THIS EXISTS
------------------
Port 8099 had FOUR listeners. Three were Wave Q throwaway `python -m
http.server` processes; the fourth was `scripts/hub_sandbox_boot.py` on
`0.0.0.0:8099`, running since 00:02 and belonging to another workstream.
Windows permitted every one of those binds without an obvious failure, and the
local probe fetches came back empty or wrong — indistinguishable, from the
outside, from a browser that could not run the probe.

That is the same failure class CLAUDE.md already records against port 8077: a
concurrent server, no error, and a whole run of evidence that looked valid and
was not.

⛔⛔ THE LESSON IS NOT ABOUT A PORT NUMBER. **A PORT ASSIGNMENT IS NOT A SERVER
IDENTITY.** `bind()` succeeding proves nothing on Windows — a second listener on
127.0.0.1 is allowed while another process holds 0.0.0.0, and which socket
answers a given connection is not something the binder gets to decide. The only
thing that establishes identity is asking the server who it is and recognising
the answer.

So every harness run mints a NONCE before it binds anything, and nothing is
measured until that exact nonce comes back from the URL the browser will use.

WHAT THIS SERVES
----------------
  /                             app/public/q1-probe.html
  /q1-probe.html                the same file
  /__uct_probe_identity         {kind, run_id, nonce, pid, started_at, root}
  /__uct_probe_slow_identity    the same payload after ?ms= (bounded)

The slow endpoint exists so a runner can prove it distinguishes A SLOW SERVER
from A WRONG SERVER from A BROWSER THAT CANNOT DO THE WORK. Collapsing those
three is how "probe did not finish" got read as a browser limitation once
already.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import secrets
import socket
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

KIND = "wave-q1-browser-probe"
IDENTITY_PATH = "/__uct_probe_identity"
SLOW_IDENTITY_PATH = "/__uct_probe_slow_identity"
MAX_SLOW_MS = 30_000

REPO = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_ROOT = REPO / "app" / "public"


# ── port ownership ──────────────────────────────────────────────────────────
def port_has_a_listener(port: int, host: str = "127.0.0.1", timeout: float = 0.6) -> bool:
    """Is somebody already answering here?

    ⛔ This CONNECTS; it does not try to bind. On Windows a bind can succeed
    beside an existing listener, so a successful bind is not evidence the port
    is yours — but a successful connect is proof that it is not.
    """
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def free_port(host: str = "127.0.0.1") -> int:
    """Let the OS pick. ⛔ Still not sufficient on its own — an ephemeral port
    narrows the odds of a collision and proves nothing about who answers."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((host, 0))
        return s.getsockname()[1]


class PortAlreadyOwned(RuntimeError):
    """Raised instead of binding beside a stranger. ⛔ The harness NEVER kills
    the incumbent: it may be another workstream's sandbox, and a port is not a
    thing we are entitled to take."""


# ── the server ──────────────────────────────────────────────────────────────
class _Handler(BaseHTTPRequestHandler):
    server_version = "UCTQ1Probe/1.0"

    def log_message(self, *_args):        # quiet; the runner owns the output
        pass

    def _json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):                     # noqa: N802 (stdlib naming)
        path, _, query = self.path.partition("?")
        ident = self.server.identity            # type: ignore[attr-defined]

        if path == IDENTITY_PATH:
            self._json(ident)
            return

        if path == SLOW_IDENTITY_PATH:
            ms = 0
            for part in query.split("&"):
                if part.startswith("ms="):
                    try:
                        ms = int(part[3:])
                    except ValueError:
                        ms = 0
            time.sleep(min(max(ms, 0), MAX_SLOW_MS) / 1000.0)
            self._json({**ident, "delayedMs": ms})
            return

        rel = "q1-probe.html" if path in ("/", "") else path.lstrip("/")
        target = (self.server.root / rel).resolve()   # type: ignore[attr-defined]
        root = self.server.root.resolve()             # type: ignore[attr-defined]
        if root not in target.parents and target != root:
            self._json({"error": "outside the served root"}, status=403)
            return
        if not target.is_file():
            self._json({"error": "not found", "path": rel}, status=404)
            return
        body = target.read_bytes()
        ctype = "text/html; charset=utf-8" if target.suffix == ".html" else "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


class ProbeServer:
    """A probe server that knows its own name and refuses to squat."""

    def __init__(self, root: pathlib.Path | None = None, port: int | None = None,
                 nonce: str | None = None, host: str = "127.0.0.1"):
        self.root = pathlib.Path(root or DEFAULT_ROOT)
        self.host = host
        self.requested_port = port
        # ⛔ Minted BEFORE anything binds, so the check below can only pass if
        # the process answering is the one this call started.
        self.nonce = nonce or secrets.token_hex(8)
        self.run_id = f"q1-{int(time.time())}-{self.nonce[:6]}"
        self._httpd: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None
        self.port: int | None = None

    @property
    def identity(self) -> dict:
        return {
            "kind": KIND,
            "run_id": self.run_id,
            "nonce": self.nonce,
            "pid": os.getpid(),
            "started_at": getattr(self, "_started_at", None),
            "root": str(self.root),
        }

    @property
    def url(self) -> str:
        return f"http://{self.host}:{self.port}"

    def start(self) -> str:
        port = self.requested_port if self.requested_port else free_port(self.host)

        # 1 · PRE-BIND OWNERSHIP. Somebody already here? Then this is not our
        # port, and we do not take it from them.
        if port_has_a_listener(port, self.host):
            raise PortAlreadyOwned(
                f"{self.host}:{port} already has a listener. Refusing to bind beside it — "
                "on Windows that succeeds silently and the browser may reach the other one. "
                "Choose another port; do NOT kill the incumbent, it may not be yours."
            )

        self._started_at = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        httpd = ThreadingHTTPServer((self.host, port), _Handler)
        httpd.root = self.root                       # type: ignore[attr-defined]
        httpd.identity = self.identity               # type: ignore[attr-defined]
        httpd.daemon_threads = True
        self._httpd = httpd
        self.port = httpd.server_address[1]
        self._thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        self._thread.start()

        # 2 · POST-BIND IDENTITY. ⛔ A 200 is not enough; the NONCE must match.
        ok, reason, _ = verify_identity(self.url, self.nonce, timeout=5.0)
        if not ok:
            self.stop()
            raise RuntimeError(f"probe server started but could not prove it was the one answering: {reason}")
        return self.url

    def stop(self) -> None:
        if self._httpd is not None:
            self._httpd.shutdown()
            self._httpd.server_close()
            self._httpd = None

    def __enter__(self) -> "ProbeServer":
        self.start()
        return self

    def __exit__(self, *_exc) -> None:
        self.stop()


# ── the check every caller must make ────────────────────────────────────────
def verify_identity(base_url: str, expected_nonce: str, timeout: float = 5.0,
                    path: str = IDENTITY_PATH) -> tuple[bool, str, dict | None]:
    """Ask the URL who it is and require the answer we are expecting.

    Returns `(ok, reason, payload)`. ⛔ `reason` is a CLASSIFICATION, not prose:
    the whole point is that "slow", "wrong server" and "nothing there" never
    collapse into one another.
    """
    url = base_url.rstrip("/") + path
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except (TimeoutError, socket.timeout):
        return False, "TRANSPORT_TIMEOUT", None
    except urllib.error.URLError as e:
        if isinstance(getattr(e, "reason", None), (TimeoutError, socket.timeout)):
            return False, "TRANSPORT_TIMEOUT", None
        return False, "SERVER_UNREACHABLE", None
    except OSError:
        return False, "SERVER_UNREACHABLE", None
    except json.JSONDecodeError:
        return False, "SERVER_IDENTITY_MISMATCH", None

    if payload.get("kind") != KIND or payload.get("nonce") != expected_nonce:
        return False, "SERVER_IDENTITY_MISMATCH", payload
    return True, "OK", payload


def main() -> int:
    ap = argparse.ArgumentParser(description="Serve the Wave Q1 browser probe with a verifiable identity.")
    ap.add_argument("--port", type=int, default=None, help="default: an OS-assigned free port")
    ap.add_argument("--root", default=str(DEFAULT_ROOT))
    ap.add_argument("--seconds", type=int, default=0, help="serve for N seconds then exit (0 = until Ctrl-C)")
    args = ap.parse_args()

    server = ProbeServer(root=pathlib.Path(args.root), port=args.port)
    try:
        url = server.start()
    except PortAlreadyOwned as e:
        print(f"[q1-probe-server] REFUSED: {e}")
        return 2
    print(json.dumps({"url": f"{url}/q1-probe.html", "identity": server.identity}, indent=1))
    try:
        if args.seconds:
            time.sleep(args.seconds)
        else:
            while True:
                time.sleep(3600)
    except KeyboardInterrupt:
        pass
    finally:
        server.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
