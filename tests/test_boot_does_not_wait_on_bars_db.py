"""The web boot must reach `yield` while ANOTHER connection holds bars.db's write lock.

INCIDENT 2026-10-02 (docs/incidents/2026-10-02-web-boot-bydate-index.md). A fresh R2
snapshot without `idx_ohlcv_daily_bydate` reached the web pod, every boot then ran a
31 GB `CREATE INDEX` that held bars.db's write transaction for ~13 min, and three
deploys in a row never reached "Application startup complete" inside Railway's
600 s healthcheck. 502 for ~1h47m.

WHAT THIS PINS. The lifespan thread (uvicorn's event loop, PID 1's main thread)
does no bars.db work at all. Every bars.db step of the boot -- `init_db`, the
four one-shot intraday/weekly heals (30-60 s busy timeouts each), the remote-bars
"skip the boot pull?" probe -- runs on a background thread, so a writer holding
the lock (a builder, an R2 merge, a reconciliation delete) can slow THOSE steps
and cannot hold the healthcheck hostage.

Two independent assertions, because each catches a regression the other misses:

1. TIME-BOXED: the real `api.main.lifespan` reaches its `yield` inside BUDGET_S
   with a write transaction held for the whole run, on the WORST-CASE volume
   (no heal flags, so all four heals want the lock; and the snapshot shape of
   the incident -- no by-date index). Measured before the fix: ~174 s (the heals
   alone wait 30+30+60+30 s). After: single-digit seconds.
2. STRUCTURAL: the lifespan thread never OPENS a connection to bars.db. A bounded
   wait that happens to fit the budget (init_db's 2 s busy timeout) is still a
   lock the event loop can be made to wait on -- and an open on the loop thread is
   also where a hot WAL's recovery would run, unbounded by any busy_timeout.

The lifespan runs on its own thread with its own event loop so the time box can
actually fire: a blocking call on the loop thread cannot be interrupted by
`asyncio.wait_for`, which is the very property under test.
"""
from __future__ import annotations

import asyncio
import os
import sqlite3
import threading
import time
import traceback

#: Generous against a normal boot (~8-10 s here; ~10 s in production on 2026-09-18,
#: "Waiting for application startup" 11:34:33.9 -> "complete" 11:34:43.8) and far
#: below the ~150 s the inline heals alone spend waiting on a held lock.
BUDGET_S = 60.0

_OHLCV = (
    "CREATE TABLE IF NOT EXISTS ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL, "
    "ts INTEGER NOT NULL, o REAL, h REAL, l REAL, c REAL, v INTEGER, "
    "PRIMARY KEY (ticker, tf, ts))"
)


def _incident_shaped_bars_db(path: str) -> None:
    """A bars.db shaped like the 2026-10-02 snapshot: schema, migrations recorded,
    the lookup index present, the BY-DATE index ABSENT."""
    from api.services import bars_sqlite

    c = sqlite3.connect(path)
    try:
        c.execute("PRAGMA journal_mode=WAL")
        c.execute(_OHLCV)
        c.executemany(
            "INSERT OR IGNORE INTO ohlcv VALUES (?,?,?,?,?,?,?,?)",
            [(f"T{i % 50}", "D", 20200101 + i, 1.0, 2.0, 0.5, 1.5, 100) for i in range(3000)],
        )
        for name, ddl in bars_sqlite.BARS_INDEX_DDL.items():
            if name != bars_sqlite.DAILY_BYDATE_INDEX:
                c.execute(ddl)
        c.execute("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER)")
        for name in bars_sqlite.MIGRATION_NAMES:
            c.execute("INSERT OR IGNORE INTO _migrations VALUES (?, 1)", (name,))
        c.commit()
    finally:
        c.close()


def test_lifespan_reaches_yield_while_a_writer_holds_bars_db(tmp_path, monkeypatch):
    from api.services import bars_sqlite

    db = str(tmp_path / "bars.db")
    _incident_shaped_bars_db(db)
    # Control: the fixture really is the incident shape (a fixture that already
    # carried the index could not distinguish anything about the build).
    _c = sqlite3.connect(db)
    try:
        assert _c.execute(
            "SELECT 1 FROM sqlite_master WHERE type='index' AND name=?",
            (bars_sqlite.DAILY_BYDATE_INDEX,),
        ).fetchone() is None
    finally:
        _c.close()

    monkeypatch.setenv("DATA_DIR", str(tmp_path))       # heal flags resolve here: ABSENT
    monkeypatch.setenv("USE_REMOTE_BARS", "1")          # production web mode (boot-pull probe)
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", db)
    bars_sqlite.bump_db_epoch()

    real_connect = sqlite3.connect
    opened_by: list[tuple[int, str, str]] = []
    target = os.path.normcase(os.path.abspath(db))

    def _spy(database, *a, **k):
        try:
            if os.path.normcase(os.path.abspath(str(database))) == target:
                where = "".join(traceback.format_stack(limit=6)[:-1])
                opened_by.append((threading.get_ident(), threading.current_thread().name, where))
        except Exception:  # noqa: BLE001 -- a spy must never change the product's behaviour
            pass
        return real_connect(database, *a, **k)

    monkeypatch.setattr(sqlite3, "connect", _spy)

    holder = real_connect(db, isolation_level=None, check_same_thread=False)
    holder.execute("BEGIN IMMEDIATE")
    holder.execute("INSERT INTO ohlcv VALUES ('ZZLOCK','D',20990101,1,1,1,1,1)")
    # Control: the lock is real -- a second writer is refused while it is held.
    probe = real_connect(db, timeout=0.2)
    try:
        try:
            probe.execute("BEGIN IMMEDIATE")
            raise AssertionError("the held write lock is not exclusive; this rail would prove nothing")
        except sqlite3.OperationalError:
            pass
    finally:
        probe.close()

    import api.main as main

    result: dict = {}

    def _run_lifespan():
        result["ident"] = threading.get_ident()

        async def _go():
            t0 = time.monotonic()
            async with main.lifespan(main.app):
                result["startup_s"] = time.monotonic() - t0

        try:
            asyncio.run(_go())
        except BaseException as e:  # noqa: BLE001 -- reported, never swallowed
            result["error"] = repr(e)

    th = threading.Thread(target=_run_lifespan, daemon=True, name="lifespan-under-test")
    th.start()
    try:
        th.join(BUDGET_S)
        assert "startup_s" in result, (
            f"lifespan did not reach `yield` within {BUDGET_S:.0f}s while another "
            f"connection held bars.db's write lock -- the boot is waiting on bars.db "
            f"(error={result.get('error')!r})"
        )
        loop_opens = [where for ident, _name, where in opened_by if ident == result["ident"]]
        assert not loop_opens, (
            "the lifespan thread (uvicorn's event loop) opened bars.db during boot; "
            "every bars.db step must run on a background thread so a held write lock "
            "cannot stall startup. Opened at:\n" + "\n---\n".join(loop_opens)
        )
        # Control: the spy SEES bars.db opens -- the background boot thread makes them.
        assert opened_by, "the spy recorded no bars.db opens at all; the structural half is blind"
    finally:
        holder.rollback()
        holder.close()
        th.join(60)
        for t in list(threading.enumerate()):
            if t.name == "bars-boot":
                t.join(60)
