"""R72 (D-21) — busy-wait time separated from statement time, per SQLite touch.

``sqlite3.Connection.set_busy_handler`` — the historically-standard way to
observe "how long did the busy-retry loop run, separately from the query" —
is CONFIRMED REMOVED on this box's Python (3.14 / sqlite3 3.50.4). So
``live_tier._timed_touch`` runs its own retry loop against a connection opened
with ``busy_timeout_ms=0`` (SQLite raises immediately on contention instead of
blocking internally), and this is the rail that proves the split is real:

RAIL: a synthetic busy database — a write lock held open in a SECOND
connection, entirely outside this module's own ``_WRITE_LOCK`` — must show up
in ``busy_wait_ms``, not ``statement_ms``. If a future edit summed the two
into one timer, this test goes RED (mutation-proved below, not merely
asserted).
"""
import sqlite3
import threading
import time

import pytest

from api.services.screener import live_tier, snapshot_db


@pytest.fixture
def live_db(monkeypatch, tmp_path):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    snapshot_db.init_db()
    return snapshot_db.get_db_path()


def _overlay_row(ticker="AAA"):
    """A minimal, schema-complete row for `screener_live` — every
    `LIVE_META_COLUMNS` entry is NOT NULL, so a real write (not just a
    ticker) is what the timing wraps."""
    return {
        "ticker": ticker,
        "live_session_ymd": 20260824,
        "live_asof": 1.0,
        "anchor_bars_asof": "20260821",
        "src_price": 100.0,
        "anchor_price": 100.0,
        "live_cols": 0,
    }


def _hold_write_lock(db_path: str, hold_s: float, ready: threading.Event) -> None:
    """A writer this module does not control and does not know about —
    exactly the shape of contention R72 exists to attribute."""
    conn = sqlite3.connect(db_path, timeout=30)
    conn.execute("BEGIN IMMEDIATE")
    conn.execute("PRAGMA user_version")  # force the write lock to actually be taken
    ready.set()
    time.sleep(hold_s)
    conn.rollback()
    conn.close()


def test_busy_wait_absorbs_a_held_write_lock_never_the_statement_timer(live_db):
    ready = threading.Event()
    holder = threading.Thread(
        target=_hold_write_lock, args=(live_db, 0.3, ready), daemon=True)
    holder.start()
    assert ready.wait(timeout=2), "holder thread never took the write lock"

    _, statement_ms, busy_wait_ms = live_tier._timed_touch(
        snapshot_db.upsert_live_rows, [_overlay_row()])
    holder.join(timeout=2)

    assert busy_wait_ms >= 200, (
        f"busy_wait_ms={busy_wait_ms} did not absorb the ~300ms held lock")
    assert statement_ms < 100, (
        f"statement_ms={statement_ms} should be the bare write cost, "
        f"not inflated by the wait")


def test_no_contention_leaves_busy_wait_at_zero_and_statement_nonnegative(live_db):
    _, statement_ms, busy_wait_ms = live_tier._timed_touch(
        snapshot_db.upsert_live_rows, [_overlay_row()])
    assert busy_wait_ms == 0.0
    assert statement_ms >= 0.0


def test_prune_and_anchor_read_are_timed_through_the_same_helper(live_db):
    """`_timed_touch` is generic over the callable — prove it works for the
    other two touches too, not just `upsert_live_rows`, so a future caller
    cannot silently skip instrumenting one of the three."""
    count, statement_ms, busy_wait_ms = live_tier._timed_touch(
        snapshot_db.prune_live_rows, 20260101)
    assert count == 0
    assert busy_wait_ms == 0.0
    assert statement_ms >= 0.0

    rows, statement_ms, busy_wait_ms = live_tier._timed_touch(
        live_tier._read_anchor_rows)
    assert rows == []
    assert busy_wait_ms == 0.0
    assert statement_ms >= 0.0


def test_a_touch_that_never_clears_still_raises_database_is_locked(live_db, monkeypatch):
    """Preserve the PRIOR failure mode: `run_sweep` already handles
    `sqlite3.OperationalError` from a touch (see its `except` clause). The
    retry must give up and re-raise, not hang or swallow it."""
    monkeypatch.setattr(live_tier, "_TOUCH_MAX_WAIT_MS", 60)
    monkeypatch.setattr(live_tier, "_TOUCH_RETRY_SLEEP_S", 0.02)

    ready = threading.Event()
    release = threading.Event()
    holder = threading.Thread(
        target=lambda: (_hold_write_lock_until(live_db, ready, release)),
        daemon=True)
    holder.start()
    assert ready.wait(timeout=2)
    try:
        with pytest.raises(sqlite3.OperationalError, match="locked"):
            live_tier._timed_touch(snapshot_db.upsert_live_rows, [_overlay_row()])
    finally:
        release.set()
        holder.join(timeout=2)


def _hold_write_lock_until(db_path: str, ready: threading.Event, release: threading.Event) -> None:
    conn = sqlite3.connect(db_path, timeout=30)
    conn.execute("BEGIN IMMEDIATE")
    conn.execute("PRAGMA user_version")
    ready.set()
    release.wait(timeout=5)
    conn.rollback()
    conn.close()
