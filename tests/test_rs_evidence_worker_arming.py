"""Unit 2b-02: the UCT RS evidence job is ARMED on the worker, dark behind a flag.

Engineering map docs/superpowers/plans/2026-11-06-uct-rs-phase2-engineering-map.md
section 3 row 2b-02: `_start_rs_evidence_pass` daemon thread -> sleep -> subprocess,
`rs_evidence` health key, `RS_EVIDENCE_ENABLED` ledger (worker, dark).

The idiom is the sibling arming tests' (tests/test_alert_destination.py's WIRE
tests): import `api.worker_main`, patch `threading` with a capturing shim, call the
start function and inspect the thread it made WITHOUT running it. The subprocess
runner is exercised directly with `subprocess.run` patched, so nothing here spawns
a process, sleeps or touches a volume.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from api import worker_main as wm

REPO = Path(__file__).resolve().parents[1]
ET = ZoneInfo("America/New_York")


# ── the capturing thread shim (tests/test_alert_destination.py's shape) ─────────
class _CapturingThread:
    made: list["_CapturingThread"] = []

    def __init__(self, target=None, args=(), name=None, daemon=None):   # noqa: ARG002
        self.target, self.args, self.name, self.daemon = target, args, name, daemon
        _CapturingThread.made.append(self)

    def start(self):
        return None

    def is_alive(self):
        return False


class _CapturingShim:
    Thread = _CapturingThread
    Lock = wm.threading.Lock


def _closure_of(fn) -> dict:
    out = {}
    for name, cell in zip(fn.__code__.co_freevars, fn.__closure__ or ()):
        out[name] = cell.cell_contents
    return out


@pytest.fixture
def capture(monkeypatch):
    """Threads are captured, never started; the flag family starts UNSET."""
    _CapturingThread.made.clear()
    monkeypatch.setattr(wm, "threading", _CapturingShim)
    for var in ("RS_EVIDENCE_ENABLED", "RS_EVIDENCE_SESSIONS", "RS_EVIDENCE_RUN_ON_BOOT"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("DATA_DIR", os.path.join("T:", os.sep, "fake-volume"))
    yield _CapturingThread.made
    _CapturingThread.made.clear()


@pytest.fixture
def fresh_state(monkeypatch):
    """Each test sees an all-None health key; the module's dict is never shared."""
    state = {k: None for k in wm._RS_EVIDENCE_HEALTH_KEYS}
    monkeypatch.setattr(wm, "_rs_evidence_state", state)
    return state


EXPECTED_ARGV = [sys.executable, "-m", "api.services.rs_evidence",
                 "--db", os.path.join("T:", os.sep, "fake-volume", "rs_evidence.db"),
                 "--sessions", "5",
                 "--publish", "--dest", "rs/evidence.json"]


# ── arming ──────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("value", [None, "0", "", "true", "yes", " 1"])
def test_unset_or_anything_but_literal_1_starts_NO_thread(capture, monkeypatch, value):
    if value is not None:
        monkeypatch.setenv("RS_EVIDENCE_ENABLED", value)
    wm._start_rs_evidence_pass()
    assert capture == []


def test_flag_1_starts_exactly_one_daemon_thread_with_the_pass_loop(capture, monkeypatch):
    monkeypatch.setenv("RS_EVIDENCE_ENABLED", "1")
    wm._start_rs_evidence_pass()
    assert len(capture) == 1
    t = capture[0]
    assert t.daemon is True and t.name == "rs_evidence"
    assert t.target.__name__ == "loop" and t.target.__qualname__.startswith("_start_rs_evidence_pass.")
    closure = _closure_of(t.target)
    assert "cmd" in closure and "run_on_boot" in closure, sorted(closure)
    assert closure["cmd"] == EXPECTED_ARGV
    assert closure["run_on_boot"] is False


def test_the_argv_is_built_exactly_and_the_sessions_knob_is_honoured(capture, monkeypatch):
    monkeypatch.setenv("RS_EVIDENCE_ENABLED", "1")
    monkeypatch.setenv("RS_EVIDENCE_SESSIONS", "12")
    wm._start_rs_evidence_pass()
    cmd = _closure_of(capture[0].target)["cmd"]
    assert cmd == EXPECTED_ARGV[:5] + ["--sessions", "12"] + EXPECTED_ARGV[7:]
    # --db comes from DATA_DIR, never a default of the job's; --dest is always given
    assert cmd[cmd.index("--db") + 1].endswith("rs_evidence.db")
    assert cmd[cmd.index("--dest") + 1] == wm.RS_EVIDENCE_ARTIFACT_KEY
    assert "--dry-run" not in cmd


def test_a_garbage_sessions_knob_falls_back_to_the_default_rather_than_refusing_boot(capture, monkeypatch):
    monkeypatch.setenv("RS_EVIDENCE_ENABLED", "1")
    monkeypatch.setenv("RS_EVIDENCE_SESSIONS", "lots")
    wm._start_rs_evidence_pass()
    assert _closure_of(capture[0].target)["cmd"] == EXPECTED_ARGV


def test_run_on_boot_is_read_into_the_loop(capture, monkeypatch):
    monkeypatch.setenv("RS_EVIDENCE_ENABLED", "1")
    monkeypatch.setenv("RS_EVIDENCE_RUN_ON_BOOT", "1")
    wm._start_rs_evidence_pass()
    assert _closure_of(capture[0].target)["run_on_boot"] is True


def test_the_artifact_key_is_the_job_packages_and_the_start_delay_clears_the_prewarm():
    from api.services.rs_evidence import ARTIFACT_KEY
    assert wm.RS_EVIDENCE_ARTIFACT_KEY == ARTIFACT_KEY == "rs/evidence.json"
    assert wm.RS_EVIDENCE_START_DELAY_S >= 45          # the combined pass's boot settle
    assert wm.RS_EVIDENCE_TIMEOUT_S == 2 * 3600
    assert wm.RS_EVIDENCE_FIRE_ET == (21, 30)
    assert wm.RS_EVIDENCE_DEFAULT_SESSIONS == 5


def test_main_registers_the_start_function_non_fatally_after_the_combined_pass():
    src = (REPO / "api" / "worker_main.py").read_text(encoding="utf-8")
    body = src[src.index("\ndef main("):]
    i_combined = body.index("_start_combined_pass()")
    i_rs = body.index("_start_rs_evidence_pass()")
    assert i_combined < i_rs
    assert "try:\n        _start_rs_evidence_pass()\n    except Exception" in body.replace("\r\n", "\n")


def test_the_weekly_backfill_is_NOT_scheduled():
    src = (REPO / "api" / "worker_main.py").read_text(encoding="utf-8")
    assert "1250" not in src.replace("--sessions 1250", "")          # mentioned only as the thing NOT scheduled
    assert "NOT scheduled" in src


# ── the subprocess runner ──────────────────────────────────────────────────────
class _Done:
    def __init__(self, rc, stdout="", stderr=""):
        self.returncode, self.stdout, self.stderr = rc, stdout, stderr


def test_the_subprocess_is_run_with_the_exact_argv_timeout_cwd_and_captured_output(fresh_state, monkeypatch):
    seen = {}

    def fake_run(cmd, **kw):
        seen["cmd"], seen["kw"] = list(cmd), kw
        return _Done(0, stdout="rs_evidence asof=2026-11-05 ...\n  rs_new_high ...\n"
                               'receipt {"asof": "2026-11-05", "ok": true}\n')

    monkeypatch.setattr(subprocess, "run", fake_run)
    out = wm._run_rs_evidence_once(EXPECTED_ARGV)
    assert seen["cmd"] == EXPECTED_ARGV
    assert seen["kw"]["timeout"] == wm.RS_EVIDENCE_TIMEOUT_S == 7200
    assert seen["kw"]["cwd"] == str(REPO) == wm._RS_EVIDENCE_CWD
    assert seen["kw"]["capture_output"] is True and seen["kw"]["text"] is True
    assert set(out) == set(wm._RS_EVIDENCE_HEALTH_KEYS)
    assert out["exit_code"] == 0 and out["error"] is None
    assert out["last_receipt_line"] == 'receipt {"asof": "2026-11-05", "ok": true}'
    assert json.loads(out["last_receipt_line"][len("receipt "):])["ok"] is True
    assert out["last_start"] and out["last_end"] and out["duration_s"] >= 0
    assert wm._rs_evidence_health() == out


def test_exit_1_records_error_and_the_receipt_and_never_raises(fresh_state, monkeypatch):
    monkeypatch.setattr(subprocess, "run", lambda cmd, **kw: _Done(
        1, stdout='receipt {"ok": false, "error": "RuntimeError: no bars"}\n', stderr="boom\n"))
    out = wm._run_rs_evidence_once(EXPECTED_ARGV)
    assert out["exit_code"] == 1
    assert out["error"].startswith("exit 1:") and "boom" in out["error"]
    assert out["last_receipt_line"] == 'receipt {"ok": false, "error": "RuntimeError: no bars"}'


def test_exit_2_usage_is_an_error_too(fresh_state, monkeypatch):
    monkeypatch.setattr(subprocess, "run", lambda cmd, **kw: _Done(2, stderr="rs_evidence: --publish requires --dest\n"))
    out = wm._run_rs_evidence_once(EXPECTED_ARGV)
    assert out["exit_code"] == 2 and "--publish requires --dest" in out["error"]
    assert out["last_receipt_line"] is None


def test_a_timeout_is_recorded_not_raised(fresh_state, monkeypatch):
    def fake_run(cmd, **kw):
        raise subprocess.TimeoutExpired(cmd, kw["timeout"], output="partial progress\n")

    monkeypatch.setattr(subprocess, "run", fake_run)
    out = wm._run_rs_evidence_once(EXPECTED_ARGV, timeout_s=7)
    assert out["exit_code"] is None
    assert "timeout after 7s" in out["error"]
    assert out["last_end"] is not None and out["duration_s"] is not None
    assert out["last_receipt_line"] is None


def test_a_spawn_crash_is_recorded_not_raised(fresh_state, monkeypatch):
    def fake_run(cmd, **kw):
        raise OSError("No such file or directory: python")

    monkeypatch.setattr(subprocess, "run", fake_run)
    out = wm._run_rs_evidence_once(EXPECTED_ARGV)
    assert out["exit_code"] is None and out["error"].startswith("OSError:")


def test_the_health_key_is_all_None_before_any_pass(fresh_state):
    h = wm._rs_evidence_health()
    assert h == {"last_start": None, "last_end": None, "exit_code": None, "duration_s": None,
                 "last_receipt_line": None, "error": None}


def test_the_health_payload_exposes_the_key():
    src = (REPO / "api" / "worker_main.py").read_text(encoding="utf-8")
    payload = src[src.index("def _health_payload():"):src.index('@app.get("/internal/health")')]
    assert '"rs_evidence": _rs_evidence_health(),' in payload


def test_the_receipt_line_is_the_last_receipt_and_bytes_are_tolerated():
    assert wm._rs_evidence_receipt_line("x\nreceipt {\"a\": 1}\nnoise\nreceipt {\"a\": 2}\n") == 'receipt {"a": 2}'
    assert wm._rs_evidence_receipt_line(b'receipt {"b": 1}\n') == 'receipt {"b": 1}'
    assert wm._rs_evidence_receipt_line("") is None and wm._rs_evidence_receipt_line(None) is None


# ── the schedule helper: the next 21:30 ET, DST on both sides ───────────────────
def _et(y, m, d, hh, mm):
    return datetime(y, m, d, hh, mm, tzinfo=ET)


@pytest.mark.parametrize("now, expect", [
    # summer (EDT, UTC-4): before the fire -> today; at or after it -> tomorrow
    (_et(2026, 7, 15, 20, 0), _et(2026, 7, 15, 21, 30)),
    (_et(2026, 7, 15, 21, 30), _et(2026, 7, 16, 21, 30)),      # STRICTLY after
    (_et(2026, 7, 15, 22, 0), _et(2026, 7, 16, 21, 30)),
    # winter (EST, UTC-5)
    (_et(2026, 1, 15, 9, 0), _et(2026, 1, 15, 21, 30)),
    (_et(2026, 1, 15, 23, 59), _et(2026, 1, 16, 21, 30)),
])
def test_next_fire_is_the_next_2130_wall_clock_in_ET(now, expect):
    got = wm._rs_evidence_next_fire(now)
    assert got == expect and got.utcoffset() == expect.utcoffset()
    assert (got.hour, got.minute) == (21, 30)


def test_next_fire_accepts_a_utc_now_and_answers_in_ET():
    now = datetime(2026, 7, 16, 1, 0, tzinfo=timezone.utc)            # 21:00 EDT on 2026-07-15
    got = wm._rs_evidence_next_fire(now)
    assert got == _et(2026, 7, 15, 21, 30) and got.tzinfo is ET
    assert got.astimezone(timezone.utc) == datetime(2026, 7, 16, 1, 30, tzinfo=timezone.utc)


def test_spring_forward_keeps_2130_on_the_clock_and_the_day_is_23_hours():
    # DST starts 2026-03-08 02:00 ET. The fire the evening before is EST, the next is EDT.
    before = wm._rs_evidence_next_fire(_et(2026, 3, 7, 12, 0))
    after = wm._rs_evidence_next_fire(before)
    assert before == _et(2026, 3, 7, 21, 30) and before.utcoffset() == timedelta(hours=-5)
    assert after == _et(2026, 3, 8, 21, 30) and after.utcoffset() == timedelta(hours=-4)
    # elapsed REAL time: same-tzinfo subtraction is wall-clock in Python, so compare in UTC
    assert after.astimezone(timezone.utc) - before.astimezone(timezone.utc) == timedelta(hours=23)


def test_fall_back_keeps_2130_on_the_clock_and_the_day_is_25_hours():
    # DST ends 2026-11-01 02:00 ET.
    before = wm._rs_evidence_next_fire(_et(2026, 10, 31, 12, 0))
    after = wm._rs_evidence_next_fire(before)
    assert before == _et(2026, 10, 31, 21, 30) and before.utcoffset() == timedelta(hours=-4)
    assert after == _et(2026, 11, 1, 21, 30) and after.utcoffset() == timedelta(hours=-5)
    assert after.astimezone(timezone.utc) - before.astimezone(timezone.utc) == timedelta(hours=25)


def test_sleep_until_chunks_and_returns_only_once_the_instant_has_passed():
    fire = datetime(2026, 7, 16, 1, 30, tzinfo=timezone.utc)
    clock = {"now": fire - timedelta(hours=5, seconds=30)}
    slept = []

    def fake_sleep(s):
        slept.append(s)
        clock["now"] = clock["now"] + timedelta(seconds=s)

    wm._rs_evidence_sleep_until(fire, sleep=fake_sleep, clock=lambda: clock["now"])
    assert slept == [3600.0, 3600.0, 3600.0, 3600.0, 3600.0, 30.0]
    assert clock["now"] >= fire
    # already past: no sleep at all
    slept.clear()
    wm._rs_evidence_sleep_until(fire, sleep=fake_sleep, clock=lambda: fire + timedelta(seconds=1))
    assert slept == []


# ── the ledger ─────────────────────────────────────────────────────────────────
def test_the_ledger_declares_the_gate_on_the_worker_with_the_facts_an_operator_needs():
    """Shipped dark (2b-02); the owner armed it on the worker 2026-11-07 and the
    ledger records that live state (Phase 3 unit 3-05)."""
    data = json.loads((REPO / "docs" / "feature_flags.json").read_text(encoding="utf-8"))
    e = data["flags"]["RS_EVIDENCE_ENABLED"]
    assert e["status"] == "armed" and e["since"] == "2026-11-07" and e["where"] == ["worker"]
    note = e["note"]
    for must in ("python -m api.services.rs_evidence", "--db <DATA_DIR>/rs_evidence.db", "--publish --dest rs/evidence.json",
                 "21:30 ET", "2 h timeout", "--dry-run --sessions 5", "no_bars", "NOT scheduled",
                 "railway variables --service worker --set RS_EVIDENCE_ENABLED=1", "Rollback"):
        assert must in note, must
