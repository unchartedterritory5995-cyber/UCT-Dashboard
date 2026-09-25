"""Rails for tools/notebook_perf_harness.py -- the sandbox lifecycle half (wave 7, lane I, fix
round 1, finding I-1) and the --dry-run self-test (M-6).

I-1: the harness used to TerminateProcess the sandbox launcher the moment measuring ended, so the
launcher's `finally` never wrote its shutdown checkpoint and the integrity log held only the
pre-boot line -- which the harness never read. These rails boot a STAND-IN launcher that behaves
like the real one where it matters: it serves /api/health through REAL uvicorn (whose signal
capture restores SIG_DFL and re-raises the signal it caught), and it writes its shutdown
checkpoint ONLY in a `finally`, so only a graceful stop produces one. A hard kill, or launching it
without the harness's SIGBREAK shim, leaves no shutdown line and these rails go red.

No browser here: `run_live` is replaced with canned samples. The real Playwright run is local-only.
"""
from __future__ import annotations

import ast
import contextlib
import json
import os
import socket
import sys
import threading
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "scripts"))

import data_root_snapshot as drs  # noqa: E402  (the launcher's own log writer)
import sandbox_identity as sid  # noqa: E402  (the launcher's own identity marker, M-3)
from tools import notebook_perf_harness as h  # noqa: E402

ALL = [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN]


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def _fake_launcher(tmp_path: Path) -> Path:
    """A launcher stand-in: pre-boot line + the path print, real uvicorn, a +15s line shortly
    after start (FAKE_LAUNCHER_POST_BOOT_DELAY seconds), and the shutdown line written ONLY in
    `finally`. FAKE_LAUNCHER_DIRTY=1 makes the shutdown checkpoint report a changed file."""
    src = f'''
import argparse, os, sys, threading, time
sys.path.insert(0, {str(REPO / "scripts")!r})
import data_root_snapshot as drs
ap = argparse.ArgumentParser()
ap.add_argument("--data-dir"); ap.add_argument("--port", type=int); ap.add_argument("--host")
a = ap.parse_args()
os.makedirs(a.data_dir, exist_ok=True)
log = os.path.join(a.data_dir, "integrity.md")
drs.append_log(log, {h.PRE_BOOT!r}, "FAKE", 1, [])
print("  [pre-boot] integrity log: " + log)

async def app(scope, receive, send):
    if scope["type"] == "lifespan":
        while True:
            m = await receive()
            if m["type"] == "lifespan.startup":
                await send({{"type": "lifespan.startup.complete"}})
            elif m["type"] == "lifespan.shutdown":
                await send({{"type": "lifespan.shutdown.complete"}})
                return
    await send({{"type": "http.response.start", "status": 200, "headers": [(b"content-type", b"text/plain")]}})
    await send({{"type": "http.response.body", "body": b"ok"}})

def later():
    time.sleep(float(os.environ.get("FAKE_LAUNCHER_POST_BOOT_DELAY", "0.5")))
    drs.append_log(log, {h.POST_BOOT!r}, "FAKE", 1, [])
threading.Thread(target=later, daemon=True).start()

import uvicorn
try:
    uvicorn.run(app, host=a.host, port=a.port, log_level="warning")
finally:
    dirty = os.environ.get("FAKE_LAUNCHER_DIRTY") == "1"
    drs.append_log(log, {h.SHUTDOWN!r}, "FAKE", 1, [("CHANGED", "auth.db", "sha differs")] if dirty else [])
'''
    p = tmp_path / "fake_launcher.py"
    p.write_text(src, encoding="utf-8")
    return p


def _canned_live(base, sizes, opens, chars):
    return ({n: [100.0] * 20 for n in sizes}, {n: [3.0] * 60 for n in sizes},
            {n: 60 for n in sizes}, [])


# ── the pure halves ───────────────────────────────────────────────────────────────────────

def test_dry_run_passes(capsys):
    assert h.main(["--dry-run"]) == 0
    out = capsys.readouterr().out
    assert "DRY RUN:" in out and "| note_open |" in out


def test_the_checkpoint_labels_are_the_launchers_own_literals():
    tree = ast.parse((REPO / "scripts" / "hub_sandbox_boot.py").read_text(encoding="utf-8"))
    strings = {n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)}
    assert "--data-dir" in strings, "control: the walk must see the launcher's own argument names"
    for label in (h.PRE_BOOT, h.POST_BOOT, h.PREWARM, h.SHUTDOWN):
        assert label in strings, f"{label!r} is not a label scripts/hub_sandbox_boot.py writes"


def test_the_integrity_reader_reads_the_launchers_own_writer(tmp_path):
    log = str(tmp_path / "integrity.md")
    assert h.read_integrity(log, ALL)["status"] == "MISSING"
    drs.append_log(log, h.PRE_BOOT, r"C:\data", 61, [], extra="sandbox = x")
    drs.append_log(log, h.POST_BOOT, r"C:\data", 61, [])
    got = h.read_integrity(log, ALL)
    assert got["status"] == "INCOMPLETE" and "'shutdown'" in got["why"], got
    assert [c["label"] for c in got["checkpoints"]] == [h.PRE_BOOT, h.POST_BOOT]
    assert all(c["db_files"] == 61 for c in got["checkpoints"])
    drs.append_log(log, h.SHUTDOWN, r"C:\data", 61, [])
    assert h.read_integrity(log, ALL)["status"] == "CLEAN"
    drs.append_log(log, h.SHUTDOWN, r"C:\data", 61, [("CHANGED", "auth.db", "sha differs")])
    dirty = h.read_integrity(log, ALL)
    assert dirty["status"] == "NOT CLEAN" and not dirty["clean"] and "CHANGED" in dirty["why"], dirty


def test_base_mode_needs_the_running_sandboxes_integrity_log(capsys):
    assert h.main(["--base", "http://127.0.0.1:1"]) == 3
    assert "--integrity-log" in capsys.readouterr().out


# ── the lifecycle, against a stand-in launcher ────────────────────────────────────────────

def test_a_graceful_stop_leaves_the_shutdown_checkpoint(tmp_path, monkeypatch):
    monkeypatch.setattr(h, "BOOT_SCRIPT", _fake_launcher(tmp_path))
    port = _free_port()
    box = h.Sandbox(str(tmp_path / "data"), port, tmp_path / "launcher.log")
    box.start()
    try:
        assert box.wait_healthy(f"http://127.0.0.1:{port}", 60), \
            (tmp_path / "launcher.log").read_text(encoding="utf-8", errors="replace")
        assert box.wait_checkpoint(h.POST_BOOT, 30)
    finally:
        how = box.stop(grace_s=30)
    got = h.read_integrity(box.integrity_path(), ALL)
    assert got["status"] == "CLEAN", (how, got)
    assert how.startswith("graceful"), how


def test_the_harness_prints_the_integrity_verdict_first_and_leaves_no_stray_files(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(h, "BOOT_SCRIPT", _fake_launcher(tmp_path))
    monkeypatch.setattr(h, "run_live", _canned_live)
    # The canned run ends at once, BEFORE the stand-in's +15s line is due: the harness must wait
    # for that checkpoint rather than stop the launcher ahead of it.
    monkeypatch.setenv("FAKE_LAUNCHER_POST_BOOT_DELAY", "4")
    cwd = tmp_path / "cwd"
    cwd.mkdir()
    monkeypatch.chdir(cwd)
    rc = h.main(["--boot", "--data-dir", str(tmp_path / "data"), "--port", str(_free_port()),
                 "--sizes", "1000", "--md", "-"])
    lines = capsys.readouterr().out.splitlines()
    assert lines[0].startswith("SANDBOX INTEGRITY: CLEAN"), lines
    assert "shutdown CLEAN" in lines[0] and "stop: graceful" in lines[0], lines[0]
    assert any(line.startswith("| note_open |") for line in lines[1:]), lines
    assert rc == 0, lines
    assert list(cwd.iterdir()) == [], "the harness wrote into the current directory"


def test_a_dirty_checkpoint_withholds_every_timing(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(h, "BOOT_SCRIPT", _fake_launcher(tmp_path))
    monkeypatch.setattr(h, "run_live", _canned_live)
    monkeypatch.setenv("FAKE_LAUNCHER_DIRTY", "1")
    out_json = tmp_path / "run" / "editor.json"
    rc = h.main(["--boot", "--data-dir", str(tmp_path / "data"), "--port", str(_free_port()),
                 "--sizes", "1000", "--json", str(out_json), "--md", "-"])
    lines = capsys.readouterr().out.splitlines()
    assert lines[0].startswith("SANDBOX INTEGRITY: NOT CLEAN"), lines
    assert rc == 2
    assert not any("note_open" in line or "p95" in line for line in lines), lines
    assert "timings withheld" in lines[-1], lines
    rec = json.loads(out_json.read_text(encoding="utf-8"))
    assert rec["timings"] == "WITHHELD" and "raw" not in rec and "rows" not in rec, rec
    assert rec["integrity"]["status"] == "NOT CLEAN"
    assert (tmp_path / "run" / "editor.integrity.md").is_file()
    assert (tmp_path / "run" / "editor.sandbox.log").is_file()


# ── fix round 2: every non-CLEAN integrity status withholds, in both modes (N-1, N-4) ─────────

def _no_timing_rows(lines: list[str]) -> bool:
    return not any("| note_open |" in ln or "| typing_per_char |" in ln or "p95" in ln for ln in lines)


def _write_log(path: Path, labels: list[str], nonce: str | None = None) -> str:
    """The launcher's log, written by its own writer; the pre-boot line carries the run's
    identity exactly as `scripts/hub_sandbox_boot.py` writes it (M-3)."""
    for label in labels:
        extra = sid.log_extra("FAKE-SANDBOX", nonce) if (nonce and label == h.PRE_BOOT) else None
        drs.append_log(str(path), label, "FAKE", 1, [], extra=extra)
    return str(path)


@contextlib.contextmanager
def _fake_base(nonce: str | None, *, serve_identity: bool = True):
    """A server that answers `/api/health` 200 -- and, when `serve_identity`, the launcher's
    identity marker with `nonce`. Anything else is FastAPI's JSON 404."""
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    marker = json.dumps(sid.payload(nonce or "", data_dir="FAKE-SANDBOX", integrity_log="its-own.md",
                                    pid=0, started_at="t")).encode("utf-8")

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            if self.path == "/api/health":
                code, out = 200, b'{"status": "ok"}'
            elif self.path == sid.IDENTITY_PATH and serve_identity:
                code, out = 200, marker
            else:
                code, out = 404, b'{"detail": "Not Found"}'
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
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


def _live_that_must_not_run(calls: list):
    def live(base, sizes, opens, chars):
        calls.append(base)
        return _canned_live(base, sizes, opens, chars)
    return live


def test_a_missing_post_boot_checkpoint_withholds_every_timing(tmp_path, monkeypatch, capsys):
    """N-1, INCOMPLETE: the stand-in writes its +15 s line only after 30 s, the harness waits 1 s
    for it, stops the launcher (whose shutdown line IS written), and must still report nothing."""
    monkeypatch.setattr(h, "BOOT_SCRIPT", _fake_launcher(tmp_path))
    monkeypatch.setattr(h, "run_live", _canned_live)
    monkeypatch.setattr(h, "POST_BOOT_WAIT_S", 1.0)
    monkeypatch.setenv("FAKE_LAUNCHER_POST_BOOT_DELAY", "30")
    out_json = tmp_path / "run" / "editor.json"
    rc = h.main(["--boot", "--data-dir", str(tmp_path / "data"), "--port", str(_free_port()),
                 "--sizes", "1000", "--json", str(out_json), "--md", "-"])
    lines = capsys.readouterr().out.splitlines()
    assert lines[0].startswith("SANDBOX INTEGRITY: INCOMPLETE"), lines
    assert f"{h.SHUTDOWN} CLEAN" in lines[0] and repr(h.POST_BOOT) in lines[0], lines[0]
    assert rc == 2, lines
    assert _no_timing_rows(lines), lines
    rec = json.loads(out_json.read_text(encoding="utf-8"))
    assert rec["timings"] == "WITHHELD" and "raw" not in rec and "rows" not in rec, rec


def test_a_missing_integrity_log_is_refused_before_anything_is_written(tmp_path, monkeypatch, capsys):
    """N-1, MISSING, --base -- stricter since M-3: the integrity log is what NAMES the sandbox,
    so without it the server cannot be proven to be the sandbox, and the run is refused before
    its first write (exit 3, no timings, no record). The server here does serve a marker, so the
    log is the only half missing."""
    calls: list = []
    monkeypatch.setattr(h, "run_live", _live_that_must_not_run(calls))
    out_json = tmp_path / "run" / "editor.json"
    with _fake_base(sid.mint()) as base:
        rc = h.main(["--base", base, "--integrity-log", str(tmp_path / "nope.md"),
                     "--shutdown-wait", "0", "--sizes", "1000", "--json", str(out_json), "--md", "-"])
    lines = capsys.readouterr().out.splitlines()
    assert lines[0].startswith("REFUSED:") and "does not exist" in lines[0], lines
    assert rc == 3 and calls == [], (rc, calls)
    assert _no_timing_rows(lines) and not out_json.exists(), lines


def test_base_mode_withholds_until_its_sandbox_has_a_shutdown_checkpoint(tmp_path, monkeypatch, capsys):
    """N-4: a --base run whose sandbox has only pre-boot and +15 s is INCOMPLETE, like --boot."""
    monkeypatch.setattr(h, "run_live", _canned_live)
    nonce = sid.mint()
    log = _write_log(tmp_path / "integrity.md", [h.PRE_BOOT, h.POST_BOOT], nonce)
    with _fake_base(nonce) as base:
        rc = h.main(["--base", base, "--integrity-log", log, "--shutdown-wait", "0",
                     "--sizes", "1000", "--json", str(tmp_path / "run" / "editor.json"), "--md", "-"])
    lines = capsys.readouterr().out.splitlines()
    assert lines[0].startswith("SANDBOX INTEGRITY: INCOMPLETE") and "'shutdown'" in lines[0], lines
    assert rc == 2 and _no_timing_rows(lines), lines


def test_base_mode_waits_for_the_shutdown_checkpoint_then_reports(tmp_path, monkeypatch, capsys):
    """N-4, the other half: the shutdown line lands WHILE the harness waits, so the run reports."""
    import threading
    monkeypatch.setattr(h, "run_live", _canned_live)
    nonce = sid.mint()
    log = _write_log(tmp_path / "integrity.md", [h.PRE_BOOT, h.POST_BOOT], nonce)
    timer = threading.Timer(1.5, lambda: drs.append_log(log, h.SHUTDOWN, "FAKE", 1, []))
    timer.start()
    try:
        with _fake_base(nonce) as base:
            rc = h.main(["--base", base, "--integrity-log", log, "--shutdown-wait", "30",
                         "--sizes", "1000", "--json", str(tmp_path / "run" / "editor.json"), "--md", "-"])
    finally:
        timer.cancel()
    captured = capsys.readouterr()
    lines = captured.out.splitlines()
    assert lines[0].startswith("SANDBOX INTEGRITY: CLEAN") and f"{h.SHUTDOWN} CLEAN" in lines[0], lines
    assert "proved it is the sandbox that writes" in lines[0], lines[0]      # the identity, named
    assert any(ln.startswith("| note_open |") for ln in lines[1:]), lines
    assert rc == 0, lines
    assert "waiting up to 30 s for the shutdown checkpoint" in captured.err, captured.err


# ── wave 7 whole-branch fix, M-3: --base writes NOTHING until the server proves who it is ────

def test_base_mode_REFUSES_a_server_that_answers_health_but_not_the_identity(tmp_path, monkeypatch, capsys):
    """The review's scenario: a stale non-sandbox backend holds the port. It answers /api/health
    like any backend, and has no identity marker -- so the run must not sign up, comp or seed
    anything through it. The integrity log is a real sandbox's (its identity is there)."""
    import urllib.request
    calls: list = []
    monkeypatch.setattr(h, "run_live", _live_that_must_not_run(calls))
    nonce = sid.mint()
    log = _write_log(tmp_path / "integrity.md", [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN], nonce)
    out_json = tmp_path / "run" / "editor.json"
    with _fake_base(nonce, serve_identity=False) as base:
        with urllib.request.urlopen(base + "/api/health", timeout=5) as r:     # non-vacuity:
            assert r.status == 200                                            # it IS a live server
        rc = h.main(["--base", base, "--integrity-log", log, "--shutdown-wait", "0",
                     "--sizes", "1000", "--json", str(out_json), "--md", "-"])
    lines = capsys.readouterr().out.splitlines()
    assert rc == 3, lines
    assert calls == [], "the run wrote through a server that never proved it is the sandbox"
    assert lines[0].startswith("REFUSED:"), lines
    assert sid.IDENTITY_PATH in lines[0] and "HTTP 404" in lines[0] and "Nothing was written" in lines[0], lines[0]
    assert _no_timing_rows(lines) and not out_json.exists()


def test_base_mode_REFUSES_a_different_sandbox_than_the_logs(tmp_path, monkeypatch, capsys):
    """Two sandboxes on one box: the log names one, the port answers the other."""
    calls: list = []
    monkeypatch.setattr(h, "run_live", _live_that_must_not_run(calls))
    log = _write_log(tmp_path / "integrity.md", [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN], sid.mint())
    with _fake_base(sid.mint()) as base:
        rc = h.main(["--base", base, "--integrity-log", log, "--shutdown-wait", "0", "--sizes", "1000"])
    lines = capsys.readouterr().out.splitlines()
    assert rc == 3 and calls == [], (rc, calls)
    assert lines[0].startswith("REFUSED:") and "not the one that writes" in lines[0], lines[0]


# ── fix round 2: a run that could not start is NOT RUN, exit 3 (N-3) ────────────────────────

class _RefusingRequests:
    """A Playwright APIRequestContext stand-in whose every call answers HTTP 500."""

    class _R:
        status = 500

        def text(self):
            return "no"

    def post(self, *a, **k):
        return self._R()


def test_a_sign_in_failure_is_not_run_and_exits_3(tmp_path, monkeypatch, capsys):
    """The failure comes from the REAL `_signup_or_login` raise site, so a revert of that raise
    to SystemExit escapes main() and reds this rail, as does dropping main()'s own catch."""
    def live_that_cannot_sign_in(base, sizes, opens, chars):
        h._signup_or_login(_RefusingRequests(), base, h.PERF_EMAIL, h.PERF_PW, "w7perf")
        raise AssertionError("unreachable: the sign-in above must refuse")

    monkeypatch.setattr(h, "BOOT_SCRIPT", _fake_launcher(tmp_path))
    monkeypatch.setattr(h, "run_live", live_that_cannot_sign_in)
    out_json = tmp_path / "run" / "editor.json"
    rc = h.main(["--boot", "--data-dir", str(tmp_path / "data"), "--port", str(_free_port()),
                 "--sizes", "1000", "--json", str(out_json), "--md", "-"])
    lines = capsys.readouterr().out.splitlines()
    assert lines[0].startswith("SANDBOX INTEGRITY: NOT RUN (could not sign in w7perf@local.dev"), lines
    assert "stop: graceful" in lines[0] and f"{h.SHUTDOWN} CLEAN" in lines[0], lines[0]
    assert rc == 3, lines
    assert _no_timing_rows(lines), lines
    rec = json.loads(out_json.read_text(encoding="utf-8"))
    assert rec["timings"] == "WITHHELD" and "could not sign in" in rec["not_run"], rec


# ── fix round 2: a stop signal that cannot be delivered still stops the launcher ──────────

def test_an_undeliverable_stop_signal_falls_through_to_terminate(tmp_path, monkeypatch):
    monkeypatch.setattr(h, "BOOT_SCRIPT", _fake_launcher(tmp_path))
    port = _free_port()
    box = h.Sandbox(str(tmp_path / "data"), port, tmp_path / "launcher.log")
    box.start()
    try:
        assert box.wait_healthy(f"http://127.0.0.1:{port}", 60)

        def no_console(sig):
            raise OSError(6, "The handle is invalid")

        monkeypatch.setattr(box.proc, "send_signal", no_console)
        how = box.stop(grace_s=30)
    finally:
        if box.proc.poll() is None:  # the guard under test failed: never orphan the stand-in
            box.proc.kill()
            box.proc.wait()
    assert box.proc.poll() is not None, "the launcher is still running"
    assert how.startswith("FORCED") and "could not be delivered" in how and "OSError" in how, how
    assert h.read_integrity(box.integrity_path(), ALL)["status"] == "INCOMPLETE"


@pytest.mark.skipif(os.name != "nt", reason="the SIGBREAK re-raise is Windows-only")
def test_without_the_shim_the_launcher_dies_before_its_checkpoint(tmp_path, monkeypatch):
    """Control for the shim: launched bare, CTRL_BREAK reaches uvicorn, which re-raises it onto
    SIG_DFL and the process dies before its `finally`. If this ever passes WITH a shutdown line,
    the shim's reason to exist has changed and its comment must be re-measured."""
    fake = _fake_launcher(tmp_path)
    monkeypatch.setattr(h, "_SHIM", "import runpy, sys\nsys.argv = sys.argv[1:]\n"
                                    "runpy.run_path(sys.argv[0], run_name='__main__')\n")
    monkeypatch.setattr(h, "BOOT_SCRIPT", fake)
    port = _free_port()
    box = h.Sandbox(str(tmp_path / "data"), port, tmp_path / "launcher.log")
    box.start()
    try:
        assert box.wait_healthy(f"http://127.0.0.1:{port}", 60)
        assert box.wait_checkpoint(h.POST_BOOT, 30)
    finally:
        box.stop(grace_s=30)
    assert h.read_integrity(box.integrity_path(), ALL)["status"] == "INCOMPLETE"
