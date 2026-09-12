"""`_resolve_dates` must cost O(trading days), not O(rows).

MEASURED ON PROD 2026-09-11 (flow-worker, /data/flow.db at 9.01 GB):

    SELECT DISTINCT CreatedDate FROM flow WHERE source='stocks'
        -> 172 dates in 1.3461 s   (plan: COVERING INDEX idx_flow_source_date_id)
    loose-index-scan equivalent
        -> 172 dates in 0.0050 s cold / 0.0007 s warm, IDENTICAL SET

That 1.35 s was ~47% of the 2.89 s CSV build and ~22% of a 6.2 s preparer roll,
and it was paid on EVERY 60 s version roll to choose ONE date (DEFAULT_VIEW is
days=1). SQLite has no loose index scan, so `DISTINCT` walks all 5,359,870 index
entries for the source to dedupe them.

⛔ A TTL CACHE IS THE WRONG SHAPE HERE, which is why
`test_a_brand_new_trading_day_is_visible_with_no_staleness_window` exists.
`get_available_dates` may cache for 60 s because a stale read only omits a new
day from a LIST. `_resolve_dates(days=1)` SELECTS THE DAY THE TAPE IS BUILT FROM
— omitting a new day there serves yesterday's entire tape at 09:30. The fix must
be exact, not merely fresh.
"""
from __future__ import annotations

import pytest

from api.flow_db import FlowDB


def _db(tmp_path, name, rows):
    """rows: list of (CreatedDate, count)."""
    db = FlowDB(str(tmp_path / name))
    with db._conn() as conn:
        payload = []
        for date, n in rows:
            payload.extend((date, "stocks") for _ in range(n))
        conn.executemany(
            "INSERT INTO flow (CreatedDate, source) VALUES (?, ?)", payload)
    return db


def _steps(db, source="stocks", days=None):
    """VM instructions SQLite executes to resolve the dates.

    A proxy for work done that does not depend on wall-clock timing, so it is
    stable in CI. The DISTINCT walk is row-proportional; a per-date seek is not.
    """
    count = {"n": 0}

    def tick():
        count["n"] += 1
        return 0

    with db._conn() as conn:
        conn.set_progress_handler(tick, 100)
        out = db._resolve_dates(conn, source, days)
        conn.set_progress_handler(None, 0)
    return out, count["n"]


# Deliberately NOT lexically ordered: "9/9/2026" > "12/1/2026" as strings, so a
# rewrite that walks the index in lexical order must still return the whole SET.
TRICKY = [("12/1/2026", 40), ("9/9/2026", 40), ("1/5/2027", 40), ("10/2/2026", 40)]


def test_fast_scan_returns_the_same_dates_as_the_distinct_walk(tmp_path, monkeypatch):
    db = _db(tmp_path, "equiv.db", TRICKY)

    monkeypatch.setenv("FLOW_FAST_DATE_SCAN", "0")
    old, _ = _steps(db)
    monkeypatch.setenv("FLOW_FAST_DATE_SCAN", "1")
    new, _ = _steps(db)

    assert new == old
    # and the newest-first contract survives, resolved by PARSED date
    assert new[0] == "1/5/2027"
    assert set(new) == {"12/1/2026", "9/9/2026", "1/5/2027", "10/2/2026"}


def test_fast_scan_cost_scales_with_dates_not_rows(tmp_path, monkeypatch):
    """THE POINT OF THE CHANGE. Same 3 dates, 40x the rows."""
    small = _db(tmp_path, "small.db", [("8/1/2026", 50), ("8/2/2026", 50), ("8/3/2026", 50)])
    big = _db(tmp_path, "big.db", [("8/1/2026", 2000), ("8/2/2026", 2000), ("8/3/2026", 2000)])

    monkeypatch.setenv("FLOW_FAST_DATE_SCAN", "1")
    small_dates, small_steps = _steps(small)
    big_dates, big_steps = _steps(big)

    assert small_dates == big_dates          # identical answer either way
    # 40x the rows must not cost 40x the work. Allow generous slack for fixed
    # overhead; the OLD path lands around 40x and fails this outright.
    assert big_steps < small_steps * 4, (
        f"date resolution is still row-proportional: "
        f"{small_steps} -> {big_steps} steps for 40x the rows")


def test_the_old_distinct_walk_is_row_proportional(tmp_path, monkeypatch):
    """CONTROL. Without this, the test above could pass because the probe is
    blind rather than because the scan got cheaper."""
    small = _db(tmp_path, "cs.db", [("8/1/2026", 50), ("8/2/2026", 50), ("8/3/2026", 50)])
    big = _db(tmp_path, "cb.db", [("8/1/2026", 2000), ("8/2/2026", 2000), ("8/3/2026", 2000)])

    monkeypatch.setenv("FLOW_FAST_DATE_SCAN", "0")
    _, small_steps = _steps(small)
    _, big_steps = _steps(big)

    assert big_steps > small_steps * 4, (
        "the control did not observe row-proportional cost, so the probe cannot "
        f"distinguish the two paths: {small_steps} -> {big_steps}")


def test_a_brand_new_trading_day_is_visible_with_no_staleness_window(tmp_path, monkeypatch):
    """09:29 -> 09:31 on a fresh day.

    At 09:29 the newest date is yesterday. The session's FIRST print lands and
    `days=1` must immediately resolve to TODAY — with no TTL to expire, no
    version bump to observe, and no warm-up call. A 60 s-cached date list fails
    here by serving yesterday's whole tape through the open.
    """
    monkeypatch.setenv("FLOW_FAST_DATE_SCAN", "1")
    db = _db(tmp_path, "open.db", [("9/10/2026", 500), ("9/11/2026", 500)])

    with db._conn() as conn:
        assert db._resolve_dates(conn, "stocks", 1) == ["9/11/2026"]

    # 09:30:00 — the first print of the new session
    with db._conn() as conn:
        conn.execute("INSERT INTO flow (CreatedDate, source) VALUES (?, ?)",
                     ("9/12/2026", "stocks"))

    with db._conn() as conn:
        assert db._resolve_dates(conn, "stocks", 1) == ["9/12/2026"], (
            "a new trading day was not visible immediately — the tape would be "
            "built from the PREVIOUS day")


def test_flag_off_selects_the_original_path(tmp_path, monkeypatch):
    """Rollback is a config change, not a redeploy."""
    db = _db(tmp_path, "flag.db", TRICKY)
    monkeypatch.delenv("FLOW_FAST_DATE_SCAN", raising=False)
    default, default_steps = _steps(db)
    monkeypatch.setenv("FLOW_FAST_DATE_SCAN", "0")
    off, off_steps = _steps(db)

    assert default == off            # default is OFF
    assert default_steps == off_steps
