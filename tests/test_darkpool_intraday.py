"""
Tests for the intraday dark-pool live-preview path (2026-07-27).

Covers the load-bearing invariants of Approach A:
  * darkpool_today insert / dedup / signature / clear / stats
  * ISOLATION: a live insert into darkpool_today must NOT move the historical
    darkpool_trades signature (that's what keeps the 90d/all window caches from
    rebuilding on every poll) — while it DOES move the today signature.
  * aggregate_today() / get_today_aggregated() produce the dpData shape and
    cache by the preview signature.
  * run_intraday() incremental cursor: overlapping cycles re-window and dedup,
    so a second cycle over the same tape inserts nothing new.
"""

import os
import io
import csv
import tempfile

# Point the DB at a temp volume BEFORE importing the darkpool modules (their
# module-level init_db() runs on import).
os.environ.setdefault("RAILWAY_VOLUME_MOUNT_PATH",
                      tempfile.mkdtemp(prefix="dp_intraday_"))

import pytest

from api import darkpool_db
from api import darkpool_aggregator
from api import darkpool_intraday_ingest as intraday


DP_COLUMNS = darkpool_db.CSV_COLUMNS


def _csv(rows):
    """Build a BBS-schema CSV string from a list of partial dicts."""
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=DP_COLUMNS)
    w.writeheader()
    for r in rows:
        w.writerow({c: r.get(c, "") for c in DP_COLUMNS})
    return buf.getvalue()


def _print_row(ticker="AAPL", ts="10:00:00 AM", price=100.0, notional=6_000_000,
               date="7/27/2026", message="DARK BLOCK  $6.0M"):
    return {
        "Date": date, "Timestamp": ts, "Ticker": ticker, "Volume": 60000,
        "Price": price, "Notional": notional, "Message": message, "Type": "Block",
    }


@pytest.fixture
def dp(tmp_path, monkeypatch):
    """Isolate every darkpool DB access to a per-test SQLite file."""
    db_path = str(tmp_path / "darkpool.db")
    monkeypatch.setattr(darkpool_db, "DB_DIR", str(tmp_path))
    monkeypatch.setattr(darkpool_db, "DB_PATH", db_path)
    monkeypatch.setattr(darkpool_aggregator, "DB_PATH", db_path)
    darkpool_db.init_db()
    # Reset intraday session state + the in-memory today cache between tests.
    intraday._session_date = None
    intraday._cursor_ns = None
    intraday._universe = []
    darkpool_aggregator.invalidate_today_cache()
    return db_path


# ── DB layer ─────────────────────────────────────────────────────────────

def test_insert_dedup_signature_and_clear(dp):
    sig0 = darkpool_db.today_rows_signature()
    assert sig0 == "0-0"

    res1 = darkpool_db.insert_today_rows(_csv([_print_row()]))
    assert res1["inserted"] == 1
    assert darkpool_db.today_rows_signature() != sig0

    # Re-inserting the identical print dedups (same UNIQUE key).
    res2 = darkpool_db.insert_today_rows(_csv([_print_row()]))
    assert res2["inserted"] == 0
    assert res2["duplicates"] == 1

    stats = darkpool_db.get_today_stats()
    assert stats["total_rows"] == 1
    assert stats["tickers"] == 1
    assert stats["last_timestamp"] == "10:00:00 AM"

    removed = darkpool_db.clear_today()
    assert removed == 1
    assert darkpool_db.get_today_stats()["total_rows"] == 0
    assert darkpool_db.today_rows_signature() == "0-0"


def test_intraday_insert_does_not_move_historical_signature(dp):
    """The core isolation guarantee: live preview inserts never touch the
    darkpool_trades signature, so the historical window caches stay valid."""
    # Seed one historical row so the signature is non-trivial.
    darkpool_db.insert_csv_rows(_csv([_print_row(ticker="SPY", date="7/24/2026")]))

    hist_before = darkpool_aggregator._db_signature()
    today_before = darkpool_db.today_rows_signature()

    darkpool_db.insert_today_rows(_csv([
        _print_row(ticker="AAPL"),
        _print_row(ticker="NVDA", ts="10:05:00 AM"),
    ]))

    assert darkpool_aggregator._db_signature() == hist_before   # historical UNMOVED
    assert darkpool_db.today_rows_signature() != today_before   # preview moved


# ── Aggregate ────────────────────────────────────────────────────────────

def test_aggregate_today_shape_and_cache(dp):
    darkpool_db.insert_today_rows(_csv([
        _print_row(ticker="AAPL", notional=8_000_000),
        _print_row(ticker="NVDA", ts="11:00:00 AM", notional=5_000_000),
    ]))

    payload = darkpool_aggregator.get_today_aggregated()
    tickers = {it["t"] for it in payload["allItems"]}
    assert {"AAPL", "NVDA"} <= tickers
    assert payload["meta"]["totalTickers"] == 2

    # Cache hit: same object returned while the signature is unchanged.
    assert darkpool_aggregator.get_today_aggregated() is payload

    # A new print changes the signature → fresh payload with the new ticker.
    darkpool_db.insert_today_rows(_csv([_print_row(ticker="TSLA", ts="11:30:00 AM")]))
    payload2 = darkpool_aggregator.get_today_aggregated()
    assert payload2 is not payload
    assert "TSLA" in {it["t"] for it in payload2["allItems"]}


def test_today_aggregate_empty_when_no_rows(dp):
    payload = darkpool_aggregator.get_today_aggregated()
    assert payload["allItems"] == []
    assert payload["meta"]["totalTickers"] == 0


# ── Incremental poll cycle ───────────────────────────────────────────────

def _fake_get_factory():
    """A stand-in for the Massive REST _get that returns one qualifying
    off-exchange print per call (single page, no pagination)."""
    def _fake_get(url, timeout=60):
        return {"results": [{
            "exchange": 4, "price": 100.0, "size": 60000,
            "sip_timestamp": 1_800_000_000_000_000_000,
        }]}
    return _fake_get


def _fake_print_to_row(ticker, date, t):
    """Deterministic row builder for the cycle tests. Stands in for the reused
    _print_to_row, whose strftime('%-I:...') is Linux-only (fine on Railway,
    raises on Windows). Same t on every call → identical row → dedup path."""
    notional = float(t["price"]) * float(t["size"])
    return {
        "Date": date, "Timestamp": "10:00:00 AM", "Ticker": ticker,
        "Volume": int(t["size"]), "Price": t["price"], "Notional": notional,
        "Message": "DARK BLOCK  $%.1fM" % (notional / 1e6), "Type": "Block",
    }


# A fixed "now" well after any session start, so the live window [cursor, now]
# is always open regardless of the wall clock when the test runs.
_FIXED_NOW_NS = 2_000_000_000_000_000_000


def test_run_intraday_incremental_dedup(dp, monkeypatch):
    monkeypatch.setattr(intraday, "API_KEY", "test-key")
    # Signature-agnostic: `run_intraday` calls this with `base=` (the
    # always-covered majors), and a positional-only stub made the real call
    # raise INSIDE the try/except that degrades to an empty universe — so the
    # failure surfaced as "ok is False", never as a bad signature.
    monkeypatch.setattr(intraday, "resolve_universe", lambda *a, **kw: ["AAPL"])
    monkeypatch.setattr(intraday, "_get", _fake_get_factory())
    monkeypatch.setattr(intraday, "_print_to_row", _fake_print_to_row)
    monkeypatch.setattr(intraday, "_now_ns", lambda: _FIXED_NOW_NS)

    out1 = intraday.run_intraday()
    assert out1["ok"] is True
    assert out1["inserted"] == 1
    assert darkpool_db.get_today_stats()["total_rows"] == 1
    cursor_after_1 = intraday._cursor_ns
    assert cursor_after_1 is not None

    # Second cycle re-windows [cursor-overlap, now] and hits the SAME print →
    # dedup keeps the table at one row, and the cursor advances.
    out2 = intraday.run_intraday()
    assert out2["ok"] is True
    assert out2["inserted"] == 0
    assert darkpool_db.get_today_stats()["total_rows"] == 1
    assert intraday._cursor_ns >= cursor_after_1


def test_run_intraday_guards_missing_key(dp, monkeypatch):
    monkeypatch.setattr(intraday, "API_KEY", "")
    out = intraday.run_intraday()
    assert out["ok"] is False
    assert "MASSIVE_API_KEY" in out["error"]


def test_roll_session_clears_preview(dp, monkeypatch):
    monkeypatch.setattr(intraday, "API_KEY", "test-key")
    # Signature-agnostic: `run_intraday` calls this with `base=` (the
    # always-covered majors), and a positional-only stub made the real call
    # raise INSIDE the try/except that degrades to an empty universe — so the
    # failure surfaced as "ok is False", never as a bad signature.
    monkeypatch.setattr(intraday, "resolve_universe", lambda *a, **kw: ["AAPL"])
    monkeypatch.setattr(intraday, "_get", _fake_get_factory())
    monkeypatch.setattr(intraday, "_print_to_row", _fake_print_to_row)
    monkeypatch.setattr(intraday, "_now_ns", lambda: _FIXED_NOW_NS)
    intraday.run_intraday()
    assert darkpool_db.get_today_stats()["total_rows"] == 1

    n = intraday.roll_session()
    assert n == 1
    assert darkpool_db.get_today_stats()["total_rows"] == 0
    assert intraday._session_date is None
    assert intraday._cursor_ns is None
