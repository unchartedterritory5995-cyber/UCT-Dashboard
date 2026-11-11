"""Rails for the flow.db corruption canary (2026-11-09).

flow.db corrupted twice in one day and BOTH times the onset minute had rolled
out of the logs before anyone looked — which is the whole reason the cause is
still open. This job exists to capture that minute. The properties that matter:
it must never raise, never write, shout exactly once on the first failure, and
re-arm after a repair.
"""
import os
import sqlite3

import pytest

from api import flow_integrity_canary as C


@pytest.fixture(autouse=True)
def _reset():
    C._state.update(last_ok_at=None, last_ok_max_id=None, tripped=False,
                last_full_at=None, last_full_ok=None, last_full_elapsed_s=None)
    yield


def _make_db(path, rows=25):
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE flow (id INTEGER PRIMARY KEY, Symbol TEXT)")
    con.executemany("INSERT INTO flow (Symbol) VALUES (?)", [("NVDA",)] * rows)
    con.commit()
    con.close()


def test_healthy_db_reports_ok_with_the_window_it_read(tmp_path, monkeypatch):
    db = tmp_path / "flow.db"
    _make_db(str(db), rows=11)
    monkeypatch.setattr(C, "DB_PATH", str(db))
    r = C.check_once()
    assert r["ok"] is True
    assert r["head_rows"] == 11
    assert r["max_id"] == 11
    assert r["detail"].strip().lower() == "ok"


def test_missing_file_does_not_raise(tmp_path, monkeypatch):
    monkeypatch.setattr(C, "DB_PATH", str(tmp_path / "nope.db"))
    r = C.check_once()          # must not raise
    assert r["ok"] is False


def test_garbage_file_is_reported_not_raised(tmp_path, monkeypatch):
    bad = tmp_path / "flow.db"
    bad.write_bytes(b"SQLite format 3\x00" + os.urandom(8192))
    monkeypatch.setattr(C, "DB_PATH", str(bad))
    r = C.check_once()
    assert r["ok"] is False
    assert r["detail"]


def test_run_tick_never_raises_on_a_broken_db(tmp_path, monkeypatch):
    bad = tmp_path / "flow.db"
    bad.write_bytes(b"not a database at all")
    monkeypatch.setattr(C, "DB_PATH", str(bad))
    C.run_tick()                # the worker must survive its own canary
    assert C._state["tripped"] is True


def test_shouts_once_then_stays_quiet(tmp_path, monkeypatch, caplog):
    bad = tmp_path / "flow.db"
    bad.write_bytes(b"not a database at all")
    monkeypatch.setattr(C, "DB_PATH", str(bad))
    with caplog.at_level("ERROR"):
        C.run_tick()
        first = len([r for r in caplog.records if "READ FAILED" in r.getMessage()])
        C.run_tick()
        C.run_tick()
        total = len([r for r in caplog.records if "READ FAILED" in r.getMessage()])
    assert first == 1, "must shout on the first failure"
    assert total == 1, "a broken db must not flood the log it exists to make readable"


def test_rearms_after_a_repair(tmp_path, monkeypatch, caplog):
    db = tmp_path / "flow.db"
    db.write_bytes(b"not a database at all")
    monkeypatch.setattr(C, "DB_PATH", str(db))
    C.run_tick()
    assert C._state["tripped"] is True
    # operator rotates/restores
    db.unlink()
    _make_db(str(db), rows=5)
    with caplog.at_level("WARNING"):
        C.run_tick()
    assert C._state["tripped"] is False, "must re-arm so the NEXT onset is caught too"
    assert any("clean again" in r.getMessage() for r in caplog.records)


def test_canary_opens_read_only(tmp_path, monkeypatch):
    """A canary that can itself damage the database is worse than none."""
    import inspect
    src = inspect.getsource(C._connect) + inspect.getsource(C.check_once)
    assert "mode=ro" in src, "must open read-only"


def test_status_shape(tmp_path, monkeypatch):
    db = tmp_path / "flow.db"
    _make_db(str(db))
    monkeypatch.setattr(C, "DB_PATH", str(db))
    C.run_tick()
    s = C.status()
    assert s["tripped"] is False and s["last_ok_max_id"] == 25


# ── the fast path must stay CHEAP — this is the whole design ──────────────────

def test_fast_path_never_runs_quick_check(tmp_path, monkeypatch):
    """⛔⛔ THE RAIL THAT MATTERS. The first version of this module ran
    `PRAGMA quick_check` plus `SELECT COUNT(*)` on EVERY tick at FLOW_CANARY_SEC=300.
    Measured 2026-11-09 against the live 10.7GB flow.db: `quick_check(1)` alone ran
    past **600 s** without finishing, because it verifies every page of every btree —
    the `(1)` bounds errors REPORTED, not bytes read.

    A 600 s+ probe on a 300 s interval with coalesce=True is not a 5-minute check, it
    is a permanent 10.7GB read loop beside the OPRA write path, on the very volume that
    corrupted twice that day. And a tick that never finishes never logs the onset it
    exists to capture.

    Behavioural, not a grep: `full_check` is replaced with a landmine, so a fast tick
    that reaches it fails by name.
    """
    db = tmp_path / "flow.db"
    _make_db(str(db), rows=50)
    monkeypatch.setattr(C, "DB_PATH", str(db))

    def _landmine():
        raise AssertionError(
            "run_tick() called full_check() — the fast path must never scan the "
            "whole file; see the module docstring for the 600s measurement")

    monkeypatch.setattr(C, "full_check", _landmine)
    C.run_tick()                     # must not raise
    assert C._state["tripped"] is False


def test_fast_path_reads_a_bounded_window_not_the_table(tmp_path, monkeypatch):
    """The cost must not grow with the table. A 10.7GB file is the normal case here."""
    db = tmp_path / "flow.db"
    _make_db(str(db), rows=500)
    monkeypatch.setattr(C, "DB_PATH", str(db))
    monkeypatch.setattr(C, "WINDOW_ROWS", 20)
    r = C.check_once()
    assert r["ok"] is True
    assert r["head_rows"] == 20, "must read WINDOW_ROWS, not the whole table"
    assert r["max_id"] == 500, "but must still see the real write head"


def test_an_empty_but_valid_table_is_healthy(tmp_path, monkeypatch):
    """A rotated/fresh db looks like this for its first seconds. Tripping here would
    cry corruption at exactly the moment an operator has just recovered the file."""
    db = tmp_path / "flow.db"
    _make_db(str(db), rows=0)
    monkeypatch.setattr(C, "DB_PATH", str(db))
    r = C.check_once()
    assert r["ok"] is True
    assert r["max_id"] is None
    C.run_tick()
    assert C._state["tripped"] is False


def test_full_check_still_detects_a_broken_file(tmp_path, monkeypatch):
    """Positive control for the slow path: moving quick_check off the tick must not
    mean nothing ever proves the whole file."""
    db = tmp_path / "flow.db"
    _make_db(str(db), rows=5)
    monkeypatch.setattr(C, "DB_PATH", str(db))
    assert C.full_check()["ok"] is True

    db.write_bytes(b"SQLite format 3\x00" + os.urandom(8192))
    out = C.full_check()
    assert out["ok"] is False and out["detail"]
    assert C._state["last_full_ok"] is False, "status must record the slow-path verdict"


def test_full_check_never_raises_on_a_missing_file(tmp_path, monkeypatch):
    monkeypatch.setattr(C, "DB_PATH", str(tmp_path / "gone.db"))
    assert C.full_check()["ok"] is False


def test_run_full_tick_never_raises(tmp_path, monkeypatch):
    db = tmp_path / "flow.db"
    db.write_bytes(b"not a database at all")
    monkeypatch.setattr(C, "DB_PATH", str(db))
    C.run_full_tick()   # the worker must survive its own canary, slow path included
