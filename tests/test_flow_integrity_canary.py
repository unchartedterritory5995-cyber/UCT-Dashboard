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
    C._state.update(last_ok_at=None, last_ok_rows=None, tripped=False)
    yield


def _make_db(path, rows=25):
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE flow (id INTEGER PRIMARY KEY, Symbol TEXT)")
    con.executemany("INSERT INTO flow (Symbol) VALUES (?)", [("NVDA",)] * rows)
    con.commit()
    con.close()


def test_healthy_db_reports_ok_with_row_count(tmp_path, monkeypatch):
    db = tmp_path / "flow.db"
    _make_db(str(db), rows=11)
    monkeypatch.setattr(C, "DB_PATH", str(db))
    r = C.check_once()
    assert r["ok"] is True
    assert r["rows"] == 11
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
        first = len([r for r in caplog.records if "INTEGRITY FAILED" in r.getMessage()])
        C.run_tick()
        C.run_tick()
        total = len([r for r in caplog.records if "INTEGRITY FAILED" in r.getMessage()])
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
    assert any("ok again" in r.getMessage() for r in caplog.records)


def test_canary_opens_read_only(tmp_path, monkeypatch):
    """A canary that can itself damage the database is worse than none."""
    import inspect
    src = inspect.getsource(C.check_once)
    assert "mode=ro" in src, "must open read-only"


def test_status_shape(tmp_path, monkeypatch):
    db = tmp_path / "flow.db"
    _make_db(str(db))
    monkeypatch.setattr(C, "DB_PATH", str(db))
    C.run_tick()
    s = C.status()
    assert s["tripped"] is False and s["last_ok_rows"] == 25
