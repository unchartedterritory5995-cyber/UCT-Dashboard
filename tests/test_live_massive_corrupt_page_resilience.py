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


# ─────────────────────────────────────────────────────────────────────────────────
# THE MARKET READ (`_build_day_stats`) — wired 2026-11-10, a day too late
#
# ⚰️ This file's own header has said since 2026-11-09 that the corrupt page took
# "the curated feed, the Market Read, the by-contract panel AND the Discord
# auto-push scheduler" down. The fix was then applied to the feed and the ask
# ledger and NOT to the Market Read. So on 2026-11-10, when flow.db corrupted a
# third time, the two wired paths logged "retrying in bounded id windows" and kept
# serving while `_build_day_stats` raised `database disk image is malformed`
# straight out of the build — `[flow-prepare] build raised: ...` ~32x/minute, and
# the Options Flow day card returned nothing for SIX HOURS.
#
# The rows were readable the whole time: 48 of 48 sampled id windows were clean and
# only the write-head tail was damaged. **A listed victim without a rail is just a
# note.** These are the rails.
# ─────────────────────────────────────────────────────────────────────────────────
import inspect

from api import live_massive_router as lmr

_COLS = ("source,CreatedDate,CreatedTime,Symbol,Type,Volume,Price,Side,CallPut,Strike,"
         "Spot,Premium,ExpirationDate,Color,ImpliedVolatility,Dte,ER,StockEtf,Sector,"
         "Uoa,Weekly,MktCap,OI,dedup_key")


def _temp_flow_db(tmp_path, per_source=4, sources=("stocks", "indexes")):
    """A real flow.db with real rows — the fault is injected at the CONNECTION, so
    the data underneath has to be genuinely readable for the test to mean anything."""
    p = tmp_path / "flow.db"
    c = sqlite3.connect(str(p))
    c.execute(
        "CREATE TABLE flow (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL "
        "DEFAULT 'stocks', CreatedDate TEXT, CreatedTime TEXT, Symbol TEXT, Type TEXT, "
        "Volume TEXT, Price TEXT, Side TEXT, CallPut TEXT, Strike TEXT, Spot TEXT, "
        "Premium TEXT, ExpirationDate TEXT, Color TEXT, ImpliedVolatility TEXT, Dte TEXT, "
        "ER TEXT, StockEtf TEXT, Sector TEXT, Uoa TEXT, Weekly TEXT, MktCap TEXT, OI TEXT, "
        "dedup_key TEXT UNIQUE, created_at TIMESTAMP, ts_ns INTEGER)")
    k = 0
    for s in sources:
        for i in range(per_source):
            k += 1
            c.execute(
                "INSERT INTO flow (" + _COLS + ") VALUES "
                "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (s, "11/10/2026", "10:0%d:00 AM" % (i % 10), "NVDA", "SWEEP", "100", "1.0",
                 "A", "CALL", "185", "180", "5000000", "12/18/2026", "MAGENTA", "0.5",
                 "38", "N", "Stock", "Tech", "N", "N", "3000000000000", "500", "k%d" % k))
    c.commit()
    c.close()
    return p


class _CorruptHeadConn:
    """A real connection that raises SQLite's corrupt-page error for any UNBOUNDED
    read of `flow`, and answers normally once the read is bounded by an explicit id
    window. That is exactly how a damaged table page behaves (PR ca9c5eb2b1)."""

    def __init__(self, real):
        object.__setattr__(self, "_real", real)
        object.__setattr__(self, "unbounded", 0)
        object.__setattr__(self, "bounded", 0)

    def execute(self, sql, params=()):
        if "FROM flow" in sql and "MIN(id)" not in sql:
            if "id >=" in sql:
                object.__setattr__(self, "bounded", self.bounded + 1)
            else:
                object.__setattr__(self, "unbounded", self.unbounded + 1)
                raise _malformed()
        return object.__getattribute__(self, "_real").execute(sql, params)

    def __getattr__(self, n):
        return getattr(object.__getattribute__(self, "_real"), n)

    def __setattr__(self, n, v):
        setattr(object.__getattribute__(self, "_real"), n, v)


@pytest.fixture
def corrupt_head(monkeypatch):
    """Patch sqlite3.connect so flow.db reads behave like a damaged write head."""
    made = []
    real_connect = sqlite3.connect

    def fake_connect(path, *a, **kw):
        conn = real_connect(path, *a, **kw)
        if str(path).endswith("flow.db"):
            conn = _CorruptHeadConn(conn)
            made.append(conn)
        return conn

    monkeypatch.setattr(lmr.sqlite3, "connect", fake_connect)
    return made


@pytest.fixture
def rf_spy(monkeypatch):
    """Record how many rows each _resilient_fetch call RETURNED, by label."""
    real = lmr._resilient_fetch
    seen = {}

    def spy(conn, run, *a, **kw):
        out = real(conn, run, *a, **kw)
        label = kw.get("label", "?")
        seen[label] = seen.get(label, 0) + len(out)
        return out

    monkeypatch.setattr(lmr, "_resilient_fetch", spy)
    return seen


def test_build_day_stats_survives_a_corrupt_unbounded_read(
        tmp_path, monkeypatch, corrupt_head, rf_spy):
    """⛔ MUTATION-PROOF. Against the pre-2026-11-10 body (a bare conn.execute of a
    UNION ALL) this raises `database disk image is malformed` and the endpoint 500s."""
    monkeypatch.setattr(lmr, "DB_PATH", str(_temp_flow_db(tmp_path)))
    monkeypatch.setattr(lmr, "_load_thresholds", lambda: {"etf_enabled": True})

    payload = lmr._build_day_stats("11/10/2026")        # must NOT raise

    assert isinstance(payload, dict)
    assert payload["query_date"] == "11/10/2026"
    # The fault was real: an unbounded attempt happened and failed.
    assert any(c.unbounded > 0 for c in corrupt_head), "the fault never fired"
    assert any(c.bounded > 0 for c in corrupt_head), "the bounded retry never ran"
    # And the rows were actually RECOVERED, not silently dropped.
    assert rf_spy.get("day-stats:stocks") == 4, rf_spy
    assert rf_spy.get("day-stats:indexes") == 4, rf_spy


def test_each_source_is_fetched_separately_so_one_bad_span_costs_only_that_source(
        tmp_path, monkeypatch, corrupt_head, rf_spy):
    """⭐ The per-source loop is the point: a UNION ALL has no single id range to
    bound, and a corrupt span anywhere in it would take BOTH partitions down."""
    monkeypatch.setattr(lmr, "DB_PATH", str(_temp_flow_db(tmp_path)))
    monkeypatch.setattr(lmr, "_load_thresholds", lambda: {"etf_enabled": True})

    lmr._build_day_stats("11/10/2026")

    assert "day-stats:stocks" in rf_spy and "day-stats:indexes" in rf_spy, rf_spy


def test_clean_db_needs_no_bounded_retry(tmp_path, monkeypatch, rf_spy):
    """POSITIVE CONTROL: on a healthy file the wiring must cost nothing extra — the
    unbounded query still answers and no windowing happens."""
    monkeypatch.setattr(lmr, "DB_PATH", str(_temp_flow_db(tmp_path)))
    monkeypatch.setattr(lmr, "_load_thresholds", lambda: {"etf_enabled": True})

    payload = lmr._build_day_stats("11/10/2026")

    assert payload["query_date"] == "11/10/2026"
    assert rf_spy.get("day-stats:stocks") == 4
    assert rf_spy.get("day-stats:indexes") == 4


def test_build_day_stats_source_routes_through_resilient_fetch():
    """Structural rail: pins the wiring so it cannot be refactored back into a bare
    UNION ALL that passes the behavioural tests only because nothing corrupted."""
    src = inspect.getsource(lmr._build_day_stats)
    assert "_resilient_fetch(" in src, (
        "_build_day_stats must read `flow` through _resilient_fetch — see this "
        "section's header for what happens when it does not")
    assert '" UNION ALL ".join' not in src, (
        "the UNION ALL flow read is back; _resilient_fetch cannot bound an id range "
        "across a union, so the corrupt-page retry would be unreachable again")
    assert "day-stats:" in src, "each source's fetch must carry its own log label"
