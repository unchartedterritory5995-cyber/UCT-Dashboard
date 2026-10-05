"""The web-side by-date index build is bounded, deduped and never on a boot path.

Incident 2026-10-02 (docs/incidents/2026-10-02-web-boot-bydate-index.md): the
lifespan started `ensure_daily_bydate_index()` 90 s after every boot, with a
600 s busy_timeout, on a 31 GB store. Now the build waits at most a couple of
seconds for the write lock, a second concurrent call never queues, and the only
doors are the owner's admin trigger and a flag-gated overnight window.
"""
from __future__ import annotations

import ast
import datetime as dt
import sqlite3
import time
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

REPO = Path(__file__).resolve().parents[1]
ET = ZoneInfo("America/New_York")


@pytest.fixture
def bars_db(tmp_path, monkeypatch):
    from api.services import bars_sqlite
    db = tmp_path / "bars.db"
    c = sqlite3.connect(str(db))
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("CREATE TABLE ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL, ts INTEGER NOT NULL, "
              "o REAL, h REAL, l REAL, c REAL, v INTEGER, PRIMARY KEY (ticker, tf, ts))")
    c.executemany("INSERT INTO ohlcv VALUES (?,?,?,?,?,?,?,?)",
                  [("AAPL", "D", 20200101 + i, 1, 1, 1, 1, 1) for i in range(200)])
    c.commit()
    c.close()
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(db))
    bars_sqlite.bump_db_epoch()
    yield db
    bars_sqlite.bump_db_epoch()


def _has_bydate(db) -> bool:
    from api.services import bars_sqlite
    c = sqlite3.connect(str(db))
    try:
        return c.execute("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?",
                         (bars_sqlite.DAILY_BYDATE_INDEX,)).fetchone() is not None
    finally:
        c.close()


def test_a_held_write_lock_makes_the_build_step_aside_quickly(bars_db):
    from api.services import bars_sqlite
    holder = sqlite3.connect(str(bars_db), isolation_level=None)
    holder.execute("BEGIN IMMEDIATE")
    holder.execute("INSERT INTO ohlcv VALUES ('LOCK','D',20990101,1,1,1,1,1)")
    try:
        t0 = time.monotonic()
        ok = bars_sqlite.ensure_daily_bydate_index(trigger="test")
        took = time.monotonic() - t0
    finally:
        holder.rollback()
        holder.close()
    assert ok is False
    assert took < bars_sqlite.BYDATE_BUILD_BUSY_MS / 1000.0 + 3.0, (
        f"the build waited {took:.1f}s behind another writer; it must step aside"
    )
    assert bars_sqlite.bydate_build_state()["last_outcome"] == "busy"
    assert not _has_bydate(bars_db)


def test_without_a_competing_writer_the_build_completes(bars_db):
    from api.services import bars_sqlite
    assert bars_sqlite.ensure_daily_bydate_index(trigger="test") is True
    assert _has_bydate(bars_db)
    st = bars_sqlite.bydate_build_state()
    assert st["last_outcome"] == "built" and st["index_present"] is True
    # idempotent: a second call is a catalog check, not a build
    assert bars_sqlite.ensure_daily_bydate_index(trigger="test") is True
    assert bars_sqlite.bydate_build_state()["last_outcome"] == "already_present"


def test_a_second_concurrent_build_never_queues(bars_db):
    from api.services import bars_sqlite
    assert bars_sqlite._bydate_build_lock.acquire(blocking=False)
    try:
        t0 = time.monotonic()
        assert bars_sqlite.ensure_daily_bydate_index(trigger="test") is False
        assert time.monotonic() - t0 < 1.0
    finally:
        bars_sqlite._bydate_build_lock.release()


def test_the_scheduled_attempt_needs_flag_grace_and_window(monkeypatch):
    from api.services import bars_bydate_index as bbi
    inside = dt.datetime(2026, 10, 5, 3, 0, tzinfo=ET)      # 03:00 ET, in 02-05
    outside = dt.datetime(2026, 10, 5, 11, 0, tzinfo=ET)    # 11:00 ET, market hours
    late = bbi._PROCESS_STARTED + bbi.BOOT_GRACE_S + 1
    early = bbi._PROCESS_STARTED + 60

    monkeypatch.delenv(bbi.FLAG, raising=False)
    assert bbi.scheduled_attempt_due(inside, late) is False          # flag off: never
    assert bbi.start_scheduled_builder() is False

    monkeypatch.setenv(bbi.FLAG, "1")
    assert bbi.scheduled_attempt_due(inside, late) is True
    assert bbi.scheduled_attempt_due(inside, early) is False         # cold pod: never
    assert bbi.scheduled_attempt_due(outside, late) is False         # traffic hours: never

    monkeypatch.setenv(bbi.WINDOW_ENV, "10-12")
    assert bbi.scheduled_attempt_due(outside, late) is True
    monkeypatch.setenv(bbi.WINDOW_ENV, "garbage")
    assert bbi.window() == bbi.DEFAULT_WINDOW


def test_no_boot_or_request_path_starts_the_build():
    """`ensure_daily_bydate_index` is called only from its two sanctioned doors."""
    allowed = {"api/services/bars_bydate_index.py"}
    callers = set()
    for p in sorted((REPO / "api").rglob("*.py")):
        if p.name.startswith("test_") or p.name.endswith("_test.py"):
            continue
        try:
            tree = ast.parse(p.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError):
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                f = node.func
                name = f.attr if isinstance(f, ast.Attribute) else getattr(f, "id", None)
                if name == "ensure_daily_bydate_index":
                    callers.add(p.relative_to(REPO).as_posix())
    # Control: the sanctioned door is seen, so the census is not blind.
    assert "api/services/bars_bydate_index.py" in callers
    assert callers <= allowed, (
        f"ensure_daily_bydate_index is called from {sorted(callers - allowed)}; "
        "a CREATE INDEX on the 31 GB store must never start from a boot or request "
        "path (incident 2026-10-02) -- go through api/services/bars_bydate_index.py"
    )
