"""Rails for `scripts/sandbox_identity.py` -- the hub sandbox launcher's identity marker (wave 7
whole-branch fix, tooling review M-3).

A PORT ASSIGNMENT IS NOT A SERVER IDENTITY (CLAUDE.md). `--base` tools wrote through whatever
answered a port; the launcher now writes a per-run nonce into its integrity log and serves it,
and a `--base` client writes nothing until it reads the SAME nonce in both places. What is
pinned here:

* the marker is served by the ASGI wrapper and EVERY other scope reaches the app untouched
  (the lifespan too -- a wrapper that swallowed it would boot an app with no startup);
* the log half reads exactly one identity, and refuses none or two;
* `verify` refuses a live server without the marker (a stale backend's JSON 404, and the web
  app's own SPA fallback, which answers any unknown GET with a 200 page), and another sandbox;
* the LAUNCHER is wired: it serves `wrap_app(...)` and writes `log_extra(...)` on its pre-boot
  line -- read from its AST, with a control proving the reader can say no.
The harness's own refusal (`--base` against a server that answers /api/health but not the
marker) is railed in tests/test_notebook_perf_harness.py.
"""
from __future__ import annotations

import ast
import asyncio
import contextlib
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts"))

import data_root_snapshot as drs  # noqa: E402
import sandbox_identity as sid  # noqa: E402

LAUNCHER = REPO / "scripts" / "hub_sandbox_boot.py"


def _drive(app, scope: dict) -> list[dict]:
    sent: list[dict] = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(msg):
        sent.append(msg)

    asyncio.run(app(scope, receive, send))
    return sent


def test_the_wrapper_answers_the_marker_and_hands_everything_else_to_the_app():
    seen: list[str] = []

    async def inner(scope, receive, send):
        seen.append(f"{scope['type']} {scope.get('path', '')}")
        await send({"type": "inner-ran"})

    body = sid.payload("ab" * 16, data_dir="D", integrity_log="L", pid=7, started_at="T")
    app = sid.wrap_app(inner, body)
    got = _drive(app, {"type": "http", "method": "GET", "path": sid.IDENTITY_PATH})
    assert got[0]["status"] == 200 and json.loads(got[1]["body"]) == body
    assert (b"cache-control", b"no-store") in got[0]["headers"]
    head = _drive(app, {"type": "http", "method": "HEAD", "path": sid.IDENTITY_PATH})
    assert head[0]["status"] == 200 and head[1]["body"] == b""
    assert seen == [], "the app saw the marker request"
    for scope in ({"type": "http", "method": "GET", "path": "/api/health"},
                  {"type": "http", "method": "POST", "path": "/api/auth/signup"},
                  {"type": "lifespan"}):
        assert _drive(app, scope) == [{"type": "inner-ran"}], scope
    assert seen == ["http /api/health", "http /api/auth/signup", "lifespan "]


def test_the_log_half_reads_exactly_one_identity(tmp_path):
    nonce = sid.mint()
    assert len(nonce) == 32 and nonce != sid.mint()
    log = tmp_path / "run.md"
    assert sid.identity_from_log(log)[0] is None and "does not exist" in sid.identity_from_log(log)[1]
    drs.append_log(str(log), "pre-boot (baseline)", "R", 1, [], extra="sandbox = x")   # an old launcher
    got, why = sid.identity_from_log(log)
    assert got is None and "names no sandbox identity" in why
    drs.append_log(str(log), "pre-boot (baseline)", "R", 1, [], extra=sid.log_extra("x", nonce))
    assert sid.identity_from_log(log) == (nonce, "")
    drs.append_log(str(log), "pre-boot (baseline)", "R", 1, [], extra=sid.log_extra("x", sid.mint()))
    got, why = sid.identity_from_log(log)
    assert got is None and "2 different identities" in why


@contextlib.contextmanager
def _server(routes: dict[str, tuple[int, str, bytes]]):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            code, ctype, out = routes.get(self.path, (404, "application/json", b'{"detail": "Not Found"}'))
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)

        def log_message(self, *a):
            pass

    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{srv.server_address[1]}"
    finally:
        srv.shutdown()
        srv.server_close()


def _marker(nonce: str) -> tuple[int, str, bytes]:
    body = sid.payload(nonce, data_dir="D", integrity_log="its-own.md", pid=1, started_at="T")
    return 200, "application/json", json.dumps(body).encode("utf-8")


def test_verify_proves_the_right_sandbox_and_refuses_everything_else(tmp_path):
    nonce = sid.mint()
    log = tmp_path / "run.md"
    drs.append_log(str(log), "pre-boot (baseline)", "R", 1, [], extra=sid.log_extra("x", nonce))
    health = (200, "application/json", b'{"status": "ok"}')

    with _server({"/api/health": health, sid.IDENTITY_PATH: _marker(nonce)}) as base:
        v = sid.verify(base, log)
        assert v.ok and v.nonce == nonce and "proved it is the sandbox" in v.sentence, v
        assert not sid.verify(base, tmp_path / "other.md").ok          # the log half is required
    with _server({"/api/health": health}) as base:                        # a stale backend: JSON 404
        v = sid.verify(base, log)
        assert not v.ok and "HTTP 404" in v.sentence and "Nothing was written" in v.sentence, v
    spa = (200, "text/html", b"<!doctype html><div id=root></div>")        # the web app's SPA fallback
    with _server({"/api/health": health, sid.IDENTITY_PATH: spa}) as base:
        v = sid.verify(base, log)
        assert not v.ok and "not JSON" in v.sentence, v
    with _server({sid.IDENTITY_PATH: (200, "application/json", b'{"kind": "something-else"}')}) as base:
        assert "without the hub sandbox marker" in sid.verify(base, log).sentence
    with _server({sid.IDENTITY_PATH: _marker(sid.mint())}) as base:       # another sandbox
        v = sid.verify(base, log)
        assert not v.ok and "not the one that writes" in v.sentence, v
    v = sid.verify("http://127.0.0.1:1", log, timeout=1.0)                 # nothing listening
    assert not v.ok and "failed" in v.sentence, v


def _launcher_wiring(src: str) -> tuple[bool, bool]:
    """(serves the wrapped app, writes the identity on its pre-boot line), read from the AST."""
    wrapped = logged = False
    for node in ast.walk(ast.parse(src)):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
            continue
        if node.func.attr == "run" and isinstance(node.func.value, ast.Name) and node.func.value.id == "uvicorn":
            first = node.args[0] if node.args else None
            wrapped = wrapped or (isinstance(first, ast.Call) and isinstance(first.func, ast.Attribute)
                                  and first.func.attr == "wrap_app")
        if node.func.attr == "append_log" and node.args and isinstance(node.args[1], ast.Constant) \
                and node.args[1].value == "pre-boot (baseline)":
            extra = {k.arg: k.value for k in node.keywords}.get("extra")
            logged = logged or (isinstance(extra, ast.Call) and isinstance(extra.func, ast.Attribute)
                                and extra.func.attr == "log_extra")
    return wrapped, logged


def test_the_launcher_serves_the_marker_and_logs_its_identity():
    assert _launcher_wiring(LAUNCHER.read_text(encoding="utf-8")) == (True, True)
    # control: the launcher as it was before M-3 reads as unwired, on both halves
    before = ('drs.append_log(log_file, "pre-boot (baseline)", drs.DEFAULT_ROOT, 1, [], extra=f"sandbox = {s}")\n'
              'uvicorn.run("api.main:app", host=h, port=p, log_level="info")\n')
    assert _launcher_wiring(before) == (False, False)
