"""Tests for api.services.screener.darkpool_agg.read_darkpool_fields.

Env pin BEFORE importing api.darkpool_db -- its module-level init_db() runs
at import (canonical idiom: tests/test_signature_darkpool_levels.py:7-10).
Each test additionally isolates via the `dp_db` fixture (monkeypatches
DB_DIR/DB_PATH to a fresh tmp_path + re-inits), matching that same file's
per-test isolation -- so a row-count assertion in one test is never polluted
by inserts from another test in this module.

Every seed row is a DIRECT INSERT into darkpool_trades (K7): the ingest
helpers' timestamp builder uses strftime("%-I...."), which is Linux-only and
crashes on Windows, so tests never go through `_print_to_row`.
"""
import math
import os
import tempfile

import pytest

os.environ.setdefault("RAILWAY_VOLUME_MOUNT_PATH",
                      tempfile.mkdtemp(prefix="dp_agg_"))

from api import darkpool_db  # noqa: E402
from api.services.screener import darkpool_agg  # noqa: E402
from api.services.signature import darkpool_levels  # noqa: E402


@pytest.fixture
def dp_db(tmp_path, monkeypatch):
    """Isolate every darkpool DB access in a test to a per-test SQLite file."""
    db_path = str(tmp_path / "darkpool.db")
    monkeypatch.setattr(darkpool_db, "DB_DIR", str(tmp_path))
    monkeypatch.setattr(darkpool_db, "DB_PATH", db_path)
    darkpool_db.init_db()
    return db_path


def _insert(rows):
    """rows: list of (date, timestamp, ticker, volume, price, notional, type)."""
    conn = darkpool_db.get_conn()
    try:
        conn.executemany(
            "INSERT INTO darkpool_trades "
            "(date, timestamp, ticker, volume, price, notional, type) "
            "VALUES (?,?,?,?,?,?,?)",
            rows,
        )
        conn.commit()
    finally:
        conn.close()


# ── Case 1: two sessions -- 1d = newest date only, 5d spans both ──────────

def test_1d_counts_only_newest_date_5d_spans_both_sessions(dp_db):
    _insert([
        ("8/20/2026", "9:31:00 AM", "AAPL", 1000, 190.0, 5_000_000, "Block"),
        ("8/20/2026", "9:32:00 AM", "AAPL", 1000, 190.5, 6_000_000, "Block"),
        ("8/21/2026", "9:31:00 AM", "AAPL", 1000, 191.0, 4_500_000, "Block"),
        ("8/21/2026", "9:32:00 AM", "AAPL", 1000, 191.2, 4_500_000, "Block"),
        ("8/21/2026", "9:33:00 AM", "AAPL", 1000, 191.4, 4_500_000, "Block"),
        # Present in the DB but NOT requested -- must never appear in `out`.
        ("8/21/2026", "9:34:00 AM", "MSFT", 1000, 410.0, 5_000_000, "Block"),
    ])

    out = darkpool_agg.read_darkpool_fields(["AAPL"])

    assert "MSFT" not in out
    row = out["AAPL"]
    assert row["dp_notional_1d"] == pytest.approx(13_500_000)
    assert row["dp_prints_1d"] == 3
    assert row["dp_notional_5d"] == pytest.approx(24_500_000)


# ── Case 2: lexicographic trap -- 9/9/2026 vs 10/1/2026 ────────────────────

def test_date_ordering_is_parse_sorted_not_lexicographic(dp_db):
    # "9/9/2026" > "10/1/2026" as a STRING (first char '9' > '1'), but
    # October is chronologically LATER than September.
    _insert([
        ("9/9/2026", "10:00:00 AM", "MSFT", 500, 400.0, 8_000_000, "Block"),
        ("10/1/2026", "10:00:00 AM", "MSFT", 500, 410.0, 9_000_000, "Block"),
    ])

    out = darkpool_agg.read_darkpool_fields(["MSFT"])
    row = out["MSFT"]

    # The lexicographic bug would pick 9/9/2026 (8M) as "newest" -- the
    # correct chronological newest session is 10/1/2026 (9M).
    assert row["dp_notional_1d"] == pytest.approx(9_000_000)
    assert row["dp_prints_1d"] == 1
    assert row["dp_notional_5d"] == pytest.approx(17_000_000)


# ── Case 3: outside the 5-newest-dates cut -- absent entirely ─────────────

def test_ticker_outside_5_newest_dates_is_absent_entirely(dp_db):
    dates = ["8/16/2026", "8/17/2026", "8/18/2026",
             "8/19/2026", "8/20/2026", "8/21/2026"]  # 6 distinct sessions
    rows = [(d, "10:00:00 AM", "SPY", 1000, 400.0, 5_000_000, "Block")
            for d in dates]
    # OLDCO only has a print on the 6th-oldest session -- outside the
    # 5-newest-dates window both dp_notional_1d and dp_notional_5d share.
    rows.append(("8/16/2026", "10:05:00 AM", "OLDCO", 500, 20.0, 4_500_000, "Block"))
    _insert(rows)

    out = darkpool_agg.read_darkpool_fields(["OLDCO", "SPY"])

    assert "OLDCO" not in out
    assert "SPY" in out
    assert out["SPY"]["dp_notional_5d"] == pytest.approx(5 * 5_000_000)


# ── Case 4: dp_level_dist_pct = min distance; absent when no levels ───────

def test_dp_level_dist_pct_is_min_distance_and_absent_without_levels(dp_db, monkeypatch):
    _insert([
        ("8/21/2026", "10:00:00 AM", "NVDA", 1000, 105.0, 5_000_000, "Block"),
    ])

    def fake_levels(sym):
        assert sym == "NVDA"
        return {
            "levels": [{"price": 100.0}, {"price": 110.0}, {"price": 130.0}],
            "datesCovered": 20,
        }

    monkeypatch.setattr(darkpool_levels, "fetch_dp_levels", fake_levels)

    out = darkpool_agg.read_darkpool_fields(["NVDA"], closes={"NVDA": 105.0})
    expected = min(abs(105.0 - p) / 105.0 * 100.0 for p in (100.0, 110.0, 130.0))
    assert math.isclose(out["NVDA"]["dp_level_dist_pct"], expected, rel_tol=1e-9)

    # Empty levels list -> absent, never a fabricated 0/None.
    monkeypatch.setattr(darkpool_levels, "fetch_dp_levels",
                         lambda sym: {"levels": [], "datesCovered": 20})
    out2 = darkpool_agg.read_darkpool_fields(["NVDA"], closes={"NVDA": 105.0})
    assert "NVDA" in out2  # aggregate row still emitted
    assert "dp_level_dist_pct" not in out2["NVDA"]

    # datesCovered == 0 -> also absent, even if `levels` were non-empty.
    monkeypatch.setattr(darkpool_levels, "fetch_dp_levels",
                         lambda sym: {"levels": [{"price": 100.0}], "datesCovered": 0})
    out3 = darkpool_agg.read_darkpool_fields(["NVDA"], closes={"NVDA": 105.0})
    assert "dp_level_dist_pct" not in out3["NVDA"]


# ── Case 5: closes=None -- aggregates still emitted, DPL absent for all ──

def test_closes_none_still_emits_aggregates_dpl_absent_for_all(dp_db):
    _insert([
        ("8/21/2026", "10:00:00 AM", "TSLA", 1000, 250.0, 6_000_000, "Block"),
    ])

    out = darkpool_agg.read_darkpool_fields(["TSLA"])  # closes defaults to None

    row = out["TSLA"]
    assert row["dp_notional_1d"] == pytest.approx(6_000_000)
    assert row["dp_notional_5d"] == pytest.approx(6_000_000)
    assert row["dp_prints_1d"] == 1
    assert "dp_level_dist_pct" not in row


# ── Case 6: empty db -- {} + census ────────────────────────────────────────

def test_empty_db_returns_empty_dict_and_records_census(dp_db):
    failures = {}
    out = darkpool_agg.read_darkpool_fields(["AAPL"], failures=failures)

    assert out == {}
    assert failures.get("darkpool_agg", {}).get("empty") == 1


# ── Case 7: READ-ONLY -- row count + sqlite_master unchanged after a full read

def test_full_read_never_mutates_darkpool_trades_or_schema(dp_db, monkeypatch):
    _insert([
        ("8/20/2026", "9:31:00 AM", "AAPL", 1000, 190.0, 5_000_000, "Block"),
        ("8/21/2026", "9:31:00 AM", "AAPL", 1000, 191.0, 6_000_000, "Block"),
    ])

    conn = darkpool_db.get_conn()
    try:
        before_count = conn.execute(
            "SELECT COUNT(*) AS c FROM darkpool_trades").fetchone()["c"]
        before_tables = {r["name"] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        conn.close()

    monkeypatch.setattr(
        darkpool_levels, "fetch_dp_levels",
        lambda sym: {"levels": [{"price": 191.0}], "datesCovered": 5})

    # Exercise the whole path, including the DPL branch.
    darkpool_agg.read_darkpool_fields(["AAPL"], closes={"AAPL": 191.0})

    conn = darkpool_db.get_conn()
    try:
        after_count = conn.execute(
            "SELECT COUNT(*) AS c FROM darkpool_trades").fetchone()["c"]
        after_tables = {r["name"] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        conn.close()

    assert after_count == before_count
    assert after_tables == before_tables


def test_in_5d_window_but_not_newest_session_omits_the_1d_keys(dp_db):
    """The A3-review pin: a ticker with qualifying prints inside the 5-newest-
    dates window but NOT on the single newest session carries dp_notional_5d
    with the 1d keys ABSENT — never a fabricated $0/0-print newest session
    (the exact `agg1.get(t, (0, 0))` refactor this rail exists to catch)."""
    from api.services.screener import darkpool_agg

    _insert([
        ("8/20/2026", "9:31:00 AM", "AAPL", 10000, 190.0, 5_000_000.0, "Block"),
        ("8/21/2026", "9:32:00 AM", "MSFT", 20000, 500.0, 12_000_000.0, "Block"),
    ])

    out = darkpool_agg.read_darkpool_fields(["AAPL", "MSFT"])
    # AAPL is inside the 5-date window (8/20) but absent from the newest
    # session (8/21): 5d present, 1d keys OMITTED.
    assert out["AAPL"]["dp_notional_5d"] == 5_000_000.0
    assert "dp_notional_1d" not in out["AAPL"]
    assert "dp_prints_1d" not in out["AAPL"]
    # MSFT prints on the newest session: all three present.
    assert out["MSFT"]["dp_notional_1d"] == 12_000_000.0
    assert out["MSFT"]["dp_prints_1d"] == 1


# ── Dual-class: the store keys by DOT, the screener asks by HYPHEN ──────────
#
# 🔴 THE DEFECT. Block prints for class shares are stored `BRK.B`-style, while
# `cap_universe` — and therefore `targets` — uses `BRK-B`. The membership test
# never matched, so every dual-class name was dropped SILENTLY and completely:
# not a wrong number, an absent one, which a member reads as "no block
# activity" rather than "we did not look". Measured against the real store on
# 2026-08-23: 7 of the 14 dual-class tickers in cap_universe carry data, the
# hyphen form returns exactly ZERO prints for every one, and the loss is
# **574 prints / $11.10B of notional**, with BRK-B alone at $9.88B.
#
# ⚠️ The options side is NOT the same bug and is deliberately not "fixed": the
# opt-flow artifact contains no dual-class ticker in EITHER convention (907
# tickers, zero dotted, zero hyphenated), so its absence is genuine upstream
# absence. A tolerant lookup there would be a repair aimed at a phantom.

def test_a_dual_class_ticker_is_found_though_the_store_keys_it_with_a_dot(dp_db):
    _insert([
        ("2026-08-21", "2026-08-21 15:30:00", "BRK.B", 1000, 500.0, 500000.0, "block"),
        ("2026-08-21", "2026-08-21 15:31:00", "AAPL",  1000, 200.0, 200000.0, "block"),
    ])
    out = darkpool_agg.read_darkpool_fields(["BRK-B", "AAPL"])

    assert "BRK-B" in out, (
        "the dual-class name was dropped — the store's 'BRK.B' never matched "
        f"the requested 'BRK-B'. got keys: {sorted(out)}")
    assert out["BRK-B"]["dp_notional_1d"] == 500000.0
    assert out["BRK-B"]["dp_prints_1d"] == 1
    # ⭐ Keyed by the form the CALLER asked for. The snapshot row is keyed by
    # the hyphen form, so emitting 'BRK.B' would land the values on a ticker
    # that does not exist in the universe — invisible in a different way.
    assert "BRK.B" not in out, (
        "emitted under the store's key instead of the caller's; the snapshot "
        "would never join it")
    # Control: an ordinary ticker is unaffected by the aliasing.
    assert out["AAPL"]["dp_notional_1d"] == 200000.0


def test_the_alias_never_invents_a_ticker_nobody_asked_for(dp_db):
    """The reverse map is built only over the requested targets, so a dotted
    row whose hyphen form was NOT requested stays out of the result."""
    _insert([
        ("2026-08-21", "2026-08-21 15:30:00", "BF.B", 100, 50.0, 5000.0, "block"),
    ])
    out = darkpool_agg.read_darkpool_fields(["AAPL"])
    assert out == {} or ("BF-B" not in out and "BF.B" not in out), (
        f"a ticker outside `targets` leaked into the result: {sorted(out)}")
