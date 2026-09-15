"""The H1 page-cache experiment: OFF must change nothing, ON must actually apply.

⛔ THE FLAG IS AN EXPERIMENT, SO ITS OFF STATE IS THE LOAD-BEARING ONE. A flag that
quietly applies its change when it is off is worse than no flag: the A/B window would
measure the same thing twice and report "no difference" as evidence that the change
does nothing.

⛔ AND THE RAILS READ THE CONNECTION, NOT THE CODE. `PRAGMA mmap_size` is silently
capped by SQLITE_MAX_MMAP_SIZE at compile time and can come back smaller than asked
for — asserting that we *called* it would pass on a build where it does nothing.
"""
from __future__ import annotations

import sqlite3

import pytest

from api.services import breadth_daily_ohlc as ohlc


@pytest.fixture
def db(tmp_path, monkeypatch):
    p = tmp_path / "ohlc.db"
    monkeypatch.setenv("BREADTH_OHLC_DB", str(p))
    ohlc._INIT_DONE = False
    ohlc._ensure_init()
    return str(p)


def _pragmas(c):
    return {
        "mmap_size": c.execute("PRAGMA mmap_size").fetchone()[0],
        "cache_size": c.execute("PRAGMA cache_size").fetchone()[0],
        "journal_mode": c.execute("PRAGMA journal_mode").fetchone()[0],
    }


def test_with_the_flag_off_the_connection_is_exactly_as_it_always_was(db, monkeypatch):
    monkeypatch.delenv("BREADTH_OHLC_PAGECACHE", raising=False)
    c = ohlc._conn()
    try:
        p = _pragmas(c)
    finally:
        c.close()
    assert p["mmap_size"] == 0, f"mmap_size was set with the flag OFF: {p['mmap_size']}"
    assert p["cache_size"] == -2000, f"cache_size was changed with the flag OFF: {p['cache_size']}"
    assert p["journal_mode"] == "wal", p["journal_mode"]


@pytest.mark.parametrize("val", ["1", "true", "YES", "on"])
def test_with_the_flag_on_both_pragmas_are_actually_in_effect(db, monkeypatch, val):
    monkeypatch.setenv("BREADTH_OHLC_PAGECACHE", val)
    c = ohlc._conn()
    try:
        p = _pragmas(c)
    finally:
        c.close()
    # ⛔ Read back, never assumed: mmap_size can be capped below what was requested.
    assert p["mmap_size"] > 0, "mmap_size did not take effect"
    assert p["cache_size"] == ohlc._CACHE_KIB, p["cache_size"]
    assert p["journal_mode"] == "wal", "the experiment must not disturb WAL"


@pytest.mark.parametrize("val", ["", "0", "false", "off", "no", "maybe"])
def test_anything_that_is_not_an_affirmative_leaves_it_off(db, monkeypatch, val):
    """⛔ The failure direction is OFF. A typo in the Railway variable must not turn an
    unmeasured experiment on in production."""
    monkeypatch.setenv("BREADTH_OHLC_PAGECACHE", val)
    c = ohlc._conn()
    try:
        assert c.execute("PRAGMA mmap_size").fetchone()[0] == 0, f"{val!r} turned it ON"
    finally:
        c.close()


def test_the_mmap_size_is_at_least_the_file_it_has_to_map(db, monkeypatch):
    """A mmap_size below the file size maps only part of it, which would make a
    partial result look like a negative one."""
    assert ohlc._MMAP_BYTES >= 41_861_120, (
        f"{ohlc._MMAP_BYTES} is under the 41.9 MB the production file already occupies")


def test_the_flag_changes_no_query_result(db, monkeypatch):
    """⛔ THE ONLY THING THAT MUST NEVER DIFFER. Same rows, same order, both ways."""
    with sqlite3.connect(db) as w:
        for i in range(50):
            w.execute("INSERT OR REPLACE INTO breadth_reconstructed_daily(date, metrics) "
                      "VALUES (?,?)", (f"2026-01-{i + 1:02d}", '{"x":%d}' % i))
        w.commit()
    dates = [f"2026-01-{i + 1:02d}" for i in range(50)]

    monkeypatch.delenv("BREADTH_OHLC_PAGECACHE", raising=False)
    off, off_miss = ohlc.reconstructed_for_dates(dates)
    monkeypatch.setenv("BREADTH_OHLC_PAGECACHE", "1")
    on, on_miss = ohlc.reconstructed_for_dates(dates)

    assert off_miss == on_miss == 0
    assert len(off) == 50, f"vacuous: {len(off)} rows — the comparison would pass over nothing"
    assert off == on
    assert list(off.keys()) == list(on.keys()), "row ORDER differs"


def test_the_counters_move_on_a_real_read(db, monkeypatch):
    """⛔ NON-VACUITY FOR THE COUNTERS THEMSELVES, and it can fail on this OS: these
    four are pure Python bookkeeping, unlike `/proc/self/io`, so a Windows run is a
    real test of them rather than an `unreadable`."""
    from api.services import breadth_timing as bt

    with sqlite3.connect(db) as w:
        for i in range(500):
            w.execute("INSERT OR REPLACE INTO breadth_reconstructed_daily(date, metrics) "
                      "VALUES (?,?)", (f"2020-{1 + i // 28:02d}-{1 + i % 28:02d}", '{"x":1}'))
        w.commit()
    dates = sorted({f"2020-{1 + i // 28:02d}-{1 + i % 28:02d}" for i in range(500)})

    bt._ctx.set(None)
    bt.begin(span=len(dates))
    got, _ = ohlc.reconstructed_for_dates(dates)
    rec = bt.get() or {}

    assert len(got) > 100, f"vacuous read: {len(got)} rows"
    assert rec.get("rf_rows") == len(got), (rec.get("rf_rows"), len(got))
    assert rec.get("rf_bytes", 0) > 0
    # 400 per chunk, so >400 distinct dates must produce more than one statement.
    assert rec.get("rf_stmts", 0) >= 2, (
        f"{len(dates)} dates at 400/chunk should be >= 2 statements, got {rec.get('rf_stmts')}")
    assert rec.get("rf_stmt_max") >= rec.get("rf_stmt_min"), rec
    assert rec.get("rf_conn_reused") == 0, "this module opens a connection per call"


def test_the_pagecache_flag_is_recorded_on_the_request(db, monkeypatch):
    """The A/B window is worthless if a sample cannot say which arm it is from."""
    from api.services import breadth_timing as bt
    with sqlite3.connect(db) as w:
        w.execute("INSERT OR REPLACE INTO breadth_reconstructed_daily(date, metrics) "
                  "VALUES ('2026-02-02','{}')")
        w.commit()
    for val, expect in (("1", 1), ("", 0)):
        monkeypatch.setenv("BREADTH_OHLC_PAGECACHE", val)
        bt._ctx.set(None)
        bt.begin(span=1)
        ohlc.reconstructed_for_dates(["2026-02-02"])
        assert (bt.get() or {}).get("rf_pagecache") == expect, (val, bt.get())
