"""L1 (2026-10-05 audit): `/api/live/massive/ticker-flow` must not cost one GIL round-trip per row.

⚰️ THE INCIDENT. In market hours the Terminal's per-ticker flow panel (FLOW → research FlowTab,
`days=5`) gave no answer in 90 s for NVDA and AAPL (the gateway answered 502) and took 11.6 s for
SOFI, while `/api/health` answered in 0.3 s. The SQL was never the problem: every query runs on an
index (`idx_flow_created_symbol` / `idx_flow_symbol_created`, read with EXPLAIN QUERY PLAN on a
2.4M-row synthetic tape). The cost is CPython's `sqlite3` releasing the GIL around EVERY
`sqlite3_step`, i.e. once per row. flow-worker runs the OPRA consumer threads in the same process
as uvicorn, and with a CPU-busy thread beside it each re-acquire waits up to the 5 ms switch
interval. Measured locally with one busy thread: 4,004 rows = 0.04 s idle, 29.15 s busy. A
ticker's 5-day read is tens of thousands of rows (the ask ledger alone is every sided print), so
the wait scaled with the ticker's size: the big names were the ones that timed out.

The fix (`api/sqlite_one_step.py`) has SQLite build each result as one JSON value inside a single
step. These tests pin: the number of rows that cross the sqlite boundary is bounded no matter how
big the ticker is; the answer is byte-identical to the per-row path; and, as the incident model,
the whole computation finishes quickly with a busy thread beside it.
"""
from __future__ import annotations

import datetime as dt
import sqlite3
import sys
import threading
import time
import types

import pytest

from api import live_massive_router as lmr
from api.flow_db import FlowDB
from api.sqlite_one_step import fetch_rows_one_step

TICKER = "CNVYX"          # not a real name: keeps the module-level 60 s card cache out of it
DAYS = 5
PER_DAY = 1200            # sided prints per day for the ticker -> 6,000 rows in the window


def _fake_row_to_alert(row, require_direction=True, agg_ask_premium=0.0, agg_ask_volume=0.0):
    return {
        "ticker": row["Symbol"], "cp": "C" if row["CallPut"] == "CALL" else "P",
        "strike": float(row["Strike"]), "exp": row["ExpirationDate"], "source": row["source"],
        "_mktCap": int(row["MktCap"]), "spot": float(row["Spot"]), "dte": int(row["Dte"]),
        "moneynessPct": 1.0, "moneynessLabel": "OTM",
        "alertPremium": float(row["Premium"]), "tradeSize": int(row["Volume"]),
        "_tierKey": "bullish", "_direction": "Bull", "_side": row["Side"], "_type": row["Type"],
        "grade": "C", "priorOI": int(row["OI"]), "timestamp": int(row["id"]) * 60,
        "averageFillPrice": float(row["Price"]),
        "aggAskPremium": agg_ask_premium, "aggAskVolume": agg_ask_volume,
    }


def _mdy(d):
    return f"{d.month}/{d.day}/{d.year}"


@pytest.fixture
def tape(tmp_path, monkeypatch):
    """Five past sessions, each with PER_DAY sided prints on TICKER spread over 20 contracts, plus
    another name's prints interleaved (so the ticker's rows are not one contiguous run)."""
    db = tmp_path / "flow.db"
    FlowDB(str(db))
    today = dt.datetime.now(lmr.ET).date()
    exp = today + dt.timedelta(days=60)
    rows, k = [], 0
    for back in range(1, DAYS + 1):
        day = _mdy(today - dt.timedelta(days=back))
        for i in range(PER_DAY):
            for sym in (TICKER, "OTHRX"):
                k += 1
                rows.append((
                    "stocks", day, "10:00:00", sym, "SWEEP" if i % 3 else "BLOCK", "100", "5.0",
                    ("A", "AA", "B", "BB")[i % 4], "CALL" if i % 2 else "PUT", str(100 + 5 * (i % 10)),
                    "110", str(20_000 + 37 * i), _mdy(exp), ("YELLOW", "MAGENTA", "WHITE")[i % 3],
                    "60", "5000000000", "100", f"k{k}"))
    conn = sqlite3.connect(str(db))
    conn.executemany(
        "INSERT INTO flow (source, CreatedDate, CreatedTime, Symbol, Type, Volume, Price, Side, "
        "CallPut, Strike, Spot, Premium, ExpirationDate, Color, Dte, MktCap, OI, dedup_key) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
    # The two indexes flow-worker creates at boot (flow_worker_main._ensure_flow_indexes).
    conn.execute("CREATE INDEX IF NOT EXISTS idx_flow_contract "
                 "ON flow(Symbol, CallPut, Strike, ExpirationDate)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_flow_created_symbol ON flow(CreatedDate, Symbol)")
    conn.commit()
    conn.close()
    monkeypatch.setattr(lmr, "DB_PATH", str(db))
    monkeypatch.setattr(lmr, "_THRESHOLDS_PATH", str(tmp_path / "no-such-thresholds.json"))
    monkeypatch.setattr(lmr, "_thresholds_cache", None)
    monkeypatch.setattr(lmr, "_has_dormant_data", lambda: False)
    monkeypatch.setattr(lmr, "_row_to_alert", _fake_row_to_alert)
    monkeypatch.delenv("FLOW_EXCLUDE_BLOCK_ONLY", raising=False)
    moi = types.SimpleNamespace(fetch_price_oi_for_contracts=lambda sym, top: {},
                                _canon_mdy=lambda s: str(s or "").strip())
    ois = types.SimpleNamespace(make_key=lambda *a: a, get_history=lambda k, n: [])
    monkeypatch.setitem(sys.modules, "api.massive_oi_snapshots", moi)
    monkeypatch.setitem(sys.modules, "api.oi_snapshots", ois)
    lmr._ticker_flow_cache.clear()
    yield str(db)
    lmr._ticker_flow_cache.clear()


# ── a sqlite3 stand-in that counts every row handed across the sqlite boundary ────────────────
class _Counter:
    rows = 0


class _CountingCursor(sqlite3.Cursor):
    def fetchall(self):
        out = super().fetchall()
        _Counter.rows += len(out)
        return out

    def fetchone(self):
        out = super().fetchone()
        if out is not None:
            _Counter.rows += 1
        return out

    def fetchmany(self, *a, **kw):
        out = super().fetchmany(*a, **kw)
        _Counter.rows += len(out)
        return out

    def __next__(self):
        out = super().__next__()
        _Counter.rows += 1
        return out


class _CountingConnection(sqlite3.Connection):
    def execute(self, *a, **kw):
        return self.cursor(_CountingCursor).execute(*a, **kw)


def _counting_sqlite3():
    mod = types.ModuleType("sqlite3_counting")
    mod.__dict__.update({k: getattr(sqlite3, k) for k in dir(sqlite3) if not k.startswith("__")})
    mod.connect = lambda *a, **kw: sqlite3.connect(*a, factory=_CountingConnection, **kw)
    return mod


def test_rows_crossing_the_sqlite_boundary_do_not_scale_with_the_ticker(tape, monkeypatch):
    monkeypatch.setattr(lmr, "sqlite3", _counting_sqlite3())
    lmr._flow_dates_all()                       # a running pod holds this 60 s cache already
    _Counter.rows = 0
    out = lmr._compute_ticker_flow(TICKER, str(DAYS))
    assert out["ok"] and out["contracts"], "control: the window must hold real contracts"
    assert out["window"]["active_days"] == DAYS, "control: every session of the window was read"
    # Control for the counter itself: a per-row read of the same window is thousands of rows.
    probe = lmr.sqlite3.connect(tape)
    _before = _Counter.rows
    n = len(probe.execute("SELECT id FROM flow WHERE Symbol=?", (TICKER,)).fetchall())
    probe.close()
    assert n == DAYS * PER_DAY and _Counter.rows - _before == n, "the counter must see a per-row read"
    # The fix: a handful of single-value steps per statement, never one per print.
    crossed = _before
    assert crossed <= 60, (
        f"{crossed} rows crossed the sqlite boundary for a {DAYS * PER_DAY}-print window; each one "
        "is a GIL release, and beside flow-worker's OPRA consumer each costs ~5 ms (L1)")


def test_the_answer_is_identical_to_the_per_row_path(tape, monkeypatch):
    fast = lmr._compute_ticker_flow(TICKER, str(DAYS))
    lmr._ticker_flow_cache.clear()

    def per_row(conn, sql, params=(), as_tuples=False):
        rows = conn.execute(sql, list(params)).fetchall()
        return [tuple(r) for r in rows] if as_tuples else rows
    monkeypatch.setattr(lmr, "fetch_rows_one_step", per_row)
    slow = lmr._compute_ticker_flow(TICKER, str(DAYS))
    assert fast["contracts"], "control: a non-empty answer, or equality proves nothing"
    assert fast == slow


def test_a_busy_thread_beside_it_does_not_starve_the_read(tape):
    """The incident model: a CPU-bound thread in the same process, as the OPRA consumer is."""
    lmr._flow_dates_all()
    stop = threading.Event()

    def consumer():
        x = 0
        while not stop.is_set():
            for i in range(1000):
                x += i * i
    t = threading.Thread(target=consumer, daemon=True)
    t.start()
    try:
        t0 = time.monotonic()
        out = lmr._compute_ticker_flow(TICKER, str(DAYS))
        took = time.monotonic() - t0
    finally:
        stop.set()
        t.join(5)
    assert out["contracts"]
    # Per-row stepping: ~10,000 rows × 2-5 ms ≈ 25-50 s. One step per statement: ~1-3 s.
    assert took < 10, f"ticker-flow took {took:.1f}s beside a busy thread (L1 convoy)"


# ── the helper on its own ─────────────────────────────────────────────────────────────────────
def test_helper_keeps_order_types_and_names(tmp_path):
    c = sqlite3.connect(str(tmp_path / "h.db"))
    c.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, s TEXT, r REAL, n TEXT)")
    c.executemany("INSERT INTO t (id, s, r, n) VALUES (?,?,?,?)",
                  [(1, "a", 1.5, None), (2, '{"x": 1}', -2.25, "é"), (3, "[1]", 0.0, "z")])
    got = fetch_rows_one_step(c, "SELECT id, s, r, n FROM t ORDER BY id DESC")
    assert got == [{"id": 3, "s": "[1]", "r": 0.0, "n": "z"},
                   {"id": 2, "s": '{"x": 1}', "r": -2.25, "n": "é"},
                   {"id": 1, "s": "a", "r": 1.5, "n": None}]
    agg = fetch_rows_one_step(c, "SELECT s, MAX(CASE WHEN r > 0 THEN 1 ELSE 0 END) FROM t "
                                 "WHERE id >= ? GROUP BY s ORDER BY s", [2], as_tuples=True)
    assert agg == [("[1]", 0), ('{"x": 1}', 0)]
    assert fetch_rows_one_step(c, "SELECT id FROM t WHERE id > 99") == []
    # Two columns sharing a name cannot be addressed by name: the plain path answers instead.
    dup = fetch_rows_one_step(c, "SELECT id, id FROM t WHERE id = 1", as_tuples=True)
    assert dup == [(1, 1)]
    c.close()
