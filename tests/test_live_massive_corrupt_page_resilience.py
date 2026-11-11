"""Regression rails for the 2026-11-09 flow.db corrupt-page incident.

A damaged TABLE page in flow.db (~977 ids around 47750513-47751685, written
~10:21 ET) made SQLite raise "database disk image is malformed" on every scan
whose b-tree traversal crossed it. That took the curated feed, the Market Read,
the by-contract panel AND the Discord auto-push scheduler down for over an hour
while ingestion stayed perfectly healthy -- so flow.db looked fine and the
alerts simply stopped.

Neither obvious remedy worked: DELETE on the span fails (the delete must READ
the page it chokes on) and shrinking the scan LIMIT does not dodge it (LIMIT
20000 still failed, and the ask ledger has no LIMIT at all). What works is an
explicitly-bounded seek, which is what these helpers do.
"""
import sqlite3

import pytest

from api.live_massive_router import (
    _is_malformed_db,
    _fetch_id_window,
    _resilient_fetch,
)


def _malformed():
    return sqlite3.DatabaseError("database disk image is malformed")


class _FakeConn:
    """Stands in for the flow.db connection: only MIN/MAX(id) is asked of it."""

    def __init__(self, lo, hi):
        self._lo, self._hi = lo, hi
        self.bounds_calls = 0

    def execute(self, sql, params=()):
        assert "MIN(id)" in sql and "MAX(id)" in sql
        self.bounds_calls += 1
        return _FakeCur((self._lo, self._hi))


class _FakeCur:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


def _runner(bad_lo, bad_hi, rows_by_id):
    """A `run(id_clause, id_params)` that raises malformed for any window
    overlapping [bad_lo, bad_hi) -- exactly how SQLite behaves on a bad page."""

    def run(id_clause, id_params):
        if not id_clause:
            raise _malformed()          # the unbounded first attempt
        lo, hi = id_params
        if lo < bad_hi and bad_lo < hi:
            raise _malformed()
        return [rows_by_id[i] for i in sorted(rows_by_id, reverse=True) if lo <= i < hi]

    return run


# ── _is_malformed_db ────────────────────────────────────────────────────────

def test_is_malformed_db_matches_only_corruption():
    assert _is_malformed_db(_malformed())
    assert _is_malformed_db(sqlite3.DatabaseError("DATABASE DISK IMAGE IS MALFORMED"))


@pytest.mark.parametrize("exc", [
    sqlite3.OperationalError("database is locked"),
    sqlite3.DatabaseError("disk I/O error"),
    ValueError("nope"),
])
def test_other_errors_are_not_treated_as_corruption(exc):
    """A locked DB or an I/O fault must still propagate -- windowing around
    those would hide a real fault behind a half-empty feed."""
    assert not _is_malformed_db(exc)


def test_non_corruption_errors_propagate_from_resilient_fetch():
    conn = _FakeConn(0, 100)

    def run(id_clause, id_params):
        raise sqlite3.OperationalError("database is locked")

    with pytest.raises(sqlite3.OperationalError):
        _resilient_fetch(conn, run, "source='stocks'", "11/9/2026", "", ())


# ── the happy path stays byte-identical ─────────────────────────────────────

def test_clean_db_takes_the_unbounded_path_and_never_reads_bounds():
    conn = _FakeConn(0, 100)
    run = lambda id_clause, id_params: ["row-a", "row-b"]
    out = _resilient_fetch(conn, run, "source='stocks'", "11/9/2026", "", ())
    assert out == ["row-a", "row-b"]
    assert conn.bounds_calls == 0, "a healthy scan must not pay for the fallback"


# ── the fallback ────────────────────────────────────────────────────────────

def test_corrupt_span_is_skipped_and_loss_stays_local_to_it():
    """The contract is BOUNDED loss, not zero loss: the bisect stops at
    _FLOW_SCAN_MIN_WINDOW, so a defect costs its enclosing window. What must
    hold is that rows away from the damage all survive, nothing unreadable is
    invented, and the collateral is small -- in the real 2026-11-09 incident
    that was ~977 ids out of a 107k-row day."""
    from api.live_massive_router import _FLOW_SCAN_MIN_WINDOW as MINW

    rows = {i: f"r{i}" for i in range(1000, 2000)}
    bad_lo, bad_hi = 1500, 1600
    conn = _FakeConn(1000, 1999)
    out = _resilient_fetch(conn, _runner(bad_lo, bad_hi, rows),
                           "source='stocks'", "11/9/2026", "", ())
    got = set(out)

    # nothing unreadable was invented
    assert not any(f"r{i}" in got for i in range(bad_lo, bad_hi))

    # every readable row outside the damaged neighbourhood survived
    for i in range(1000, 2000):
        if i < bad_lo - MINW or i >= bad_hi + MINW:
            assert f"r{i}" in got, f"readable id {i} was dropped far from the defect"

    # and the collateral is bounded, not a whole-window wipe
    lost = 1000 - len(got) - (bad_hi - bad_lo)
    assert 0 <= lost <= 2 * MINW, f"lost {lost} readable ids to a {bad_hi - bad_lo}-id defect"


def test_fallback_preserves_descending_id_order():
    """The curated scan is ORDER BY id DESC and the feed renders newest-first."""
    rows = {i: i for i in range(1000, 2000)}
    conn = _FakeConn(1000, 1999)
    out = _resilient_fetch(conn, _runner(1500, 1600, rows),
                           "source='stocks'", "11/9/2026", "", ())
    assert out == sorted(out, reverse=True)


def test_bisect_loses_only_a_bounded_slice_not_the_whole_window():
    """The whole point: a 1-row defect must not cost the 25k-row window."""
    rows = {i: f"r{i}" for i in range(0, 30000)}
    skipped = []
    out = _fetch_id_window(_runner(20000, 20001, rows), 0, 30000, skipped)
    lost = sum(hi - lo for lo, hi in skipped)
    assert lost <= 256, f"bisect gave up {lost} ids for a 1-row defect"
    assert len(out) >= 30000 - 256


def test_limit_is_honoured_on_the_fallback_path():
    rows = {i: f"r{i}" for i in range(0, 5000)}
    conn = _FakeConn(0, 4999)
    out = _resilient_fetch(conn, _runner(2000, 2100, rows),
                           "source='stocks'", "11/9/2026", "", (), limit=10)
    assert len(out) == 10


def test_unreadable_bounds_degrade_to_empty_not_an_exception():
    """If even the index-only MIN/MAX is unreadable we return nothing rather
    than taking the whole feed down again."""

    class _DeadConn:
        def execute(self, sql, params=()):
            raise _malformed()

    out = _resilient_fetch(_DeadConn(), _runner(0, 1, {}),
                           "source='stocks'", "11/9/2026", "", ())
    assert out == []
