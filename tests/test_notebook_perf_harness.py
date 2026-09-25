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
import json
import os
import socket
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "scripts"))

import data_root_snapshot as drs  # noqa: E402  (the launcher's own log writer)
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
