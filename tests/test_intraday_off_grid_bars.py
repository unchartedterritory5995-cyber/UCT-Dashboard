"""W-J — off-grid intraday rows (2026-11-10).

Prod served post-market rows stamped mid-bucket with seconds (SPY 5m 16:35:50 next
to 16:35:00, AMD 15m 16:15:31 …), each drawn as an extra candle. Producer: Yahoo's
separate live row (stamped at the last trade) via the yfinance fallback, written
add-only beside the Massive grid row. Synthetic stores / fake providers only; every
price is an invented round number.
"""
from __future__ import annotations

import datetime as _dt
import sqlite3
from zoneinfo import ZoneInfo

import pytest

from api.services import bars_fetch, bars_sqlite, data_sync, intraday_grid

ET = ZoneInfo("America/New_York")


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    bars_sqlite.bump_db_epoch()
    bars_sqlite.init_db()
    yield
    bars_sqlite.bump_db_epoch()


def _et(y, m, d, hh, mm, ss=0):
    return int(_dt.datetime(y, m, d, hh, mm, ss, tzinfo=ET).timestamp())


def _bar(t, o=10.0, h=11.0, l=9.0, c=10.0, v=100):
    return {"t": t, "o": o, "h": h, "l": l, "c": c, "v": v}


def _stored(ticker, tf):
    return bars_sqlite.get_bars(ticker, tf, 100000)


# ── the grid ─────────────────────────────────────────────────────────────────

def test_alignment_rules_per_timeframe():
    b = _et(2026, 11, 6, 16, 35)
    assert intraday_grid.is_aligned("5", b)
    assert not intraday_grid.is_aligned("5", b + 50)            # the SPY 16:35:50 row
    assert not intraday_grid.is_aligned("1", _et(2026, 11, 6, 16, 40, 33))
    assert intraday_grid.is_aligned("15", _et(2026, 11, 3, 16, 15))
    assert not intraday_grid.is_aligned("15", _et(2026, 11, 3, 16, 15, 31))
    assert not intraday_grid.is_aligned("5", _et(2026, 11, 3, 16, 17))   # minute-aligned, wrong bucket
    # 60m: session grid (09:30, 10:30 …) and ET clock hours are both bucket starts …
    assert intraday_grid.is_aligned("60", _et(2026, 11, 5, 9, 30))
    assert intraday_grid.is_aligned("60", _et(2026, 11, 5, 15, 30))
    assert intraday_grid.is_aligned("60", _et(2026, 11, 5, 17, 0))
    # … a :30 outside the regular session and anything with seconds are not.
    assert not intraday_grid.is_aligned("60", _et(2026, 11, 5, 17, 30))
    assert not intraday_grid.is_aligned("60", _et(2026, 11, 5, 17, 0, 41))
    assert intraday_grid.bucket_start("60", _et(2026, 11, 5, 10, 45)) == _et(2026, 11, 5, 10, 30)
    assert intraday_grid.bucket_start("5", b + 50) == b
    # Date keys and custom tfs are not judged.
    assert intraday_grid.is_aligned("D", 20261106)
    assert intraday_grid.is_aligned("2", b + 50)


def test_fold_drops_beside_a_twin_and_snaps_a_lone_row():
    b = _et(2026, 11, 6, 16, 35)
    bars = [_bar(b - 300), _bar(b, o=10, h=11, l=9, c=10, v=100),
            _bar(b + 50, o=10.5, h=12, l=8, c=11, v=7),            # twin exists → dropped
            _bar(b + 300 + 41, o=10, h=10, l=10, c=10, v=3)]        # no twin → snapped
    out, snapped, n = intraday_grid.fold("5", bars)
    assert n == 2
    assert [x["t"] for x in out] == [b - 300, b]
    # The twin (a full-bucket aggregate) is untouched: no double-counted volume,
    # no other vendor's close or wick (review #1062 MED 1).
    assert out[1] == {"t": b, "o": 10, "h": 11, "l": 9, "c": 10, "v": 100}
    # Only the fetch door, inside ONE provider payload, merges (yfinance's own fold).
    merged, _s, _n = intraday_grid.fold("5", bars, twin="merge")
    assert merged[1] == {"t": b, "o": 10, "h": 12, "l": 8, "c": 11, "v": 107}
    assert snapped == [{"t": b + 300, "o": 10, "h": 10, "l": 10, "c": 10, "v": 3}]
    clean = [_bar(b), _bar(b + 300)]
    assert intraday_grid.fold("5", clean)[0] is clean          # fast path: no copy


# ── 1. the producer: yfinance's separate live row ────────────────────────────

def test_yfinance_live_row_is_folded_onto_the_grid(monkeypatch):
    import pandas as pd
    idx = pd.DatetimeIndex([pd.Timestamp("2026-11-06 16:25", tz=ET),
                            pd.Timestamp("2026-11-06 16:30", tz=ET),
                            pd.Timestamp("2026-11-06 16:35:50", tz=ET)])   # Yahoo's live row
    df = pd.DataFrame({"Open": [1.0, 1.0, 1.0], "High": [2.0, 2.0, 3.0],
                       "Low": [0.5, 0.5, 0.5], "Close": [1.5, 1.5, 1.5],
                       "Volume": [10, 10, 4]}, index=idx)
    monkeypatch.setattr("api.services.yfinance_pool.fetch_history", lambda sym, **kw: df)
    out = bars_fetch._fetch_intraday_yfinance("ABC", "5", 100)
    assert [b["t"] for b in out] == [_et(2026, 11, 6, 16, 25), _et(2026, 11, 6, 16, 30),
                                     _et(2026, 11, 6, 16, 35)]
    assert all(b["t"] % 300 == 0 for b in out)


def test_yfinance_live_row_with_a_bucket_row_folds_into_it(monkeypatch):
    import pandas as pd
    idx = pd.DatetimeIndex([pd.Timestamp("2026-11-03 16:15", tz=ET),
                            pd.Timestamp("2026-11-03 16:15:31", tz=ET)])
    df = pd.DataFrame({"Open": [1.0, 1.2], "High": [2.0, 2.5], "Low": [0.5, 0.4],
                       "Close": [1.5, 1.6], "Volume": [10, 5]}, index=idx)
    monkeypatch.setattr("api.services.yfinance_pool.fetch_history", lambda sym, **kw: df)
    out = bars_fetch._fetch_intraday_yfinance("ABC", "15", 100)
    assert len(out) == 1
    assert out[0]["t"] == _et(2026, 11, 3, 16, 15)
    assert (out[0]["h"], out[0]["l"], out[0]["c"], out[0]["v"]) == (2.5, 0.4, 1.6, 15)


# ── 2. the write door ────────────────────────────────────────────────────────

def test_put_bars_never_stores_an_off_grid_row(store):
    b = _et(2026, 11, 6, 16, 35)
    bars_sqlite.put_bars("SPY", "5", [_bar(b, v=100)])
    # The add-only fallback write that planted the prod row:
    n = bars_sqlite.put_bars("SPY", "5", [_bar(b + 50, h=50, v=7)], on_conflict="ignore")
    rows = _stored("SPY", "5")
    assert [r[0] for r in rows] == [b]
    assert rows[0][2] == 11.0 and rows[0][5] == 100     # stored row NOT replaced by a snap
    assert n == 1


def test_put_bars_snaps_a_lone_off_grid_row_into_its_empty_bucket(store):
    b = _et(2026, 11, 5, 17, 0)
    bars_sqlite.put_bars("NVDA", "5", [_bar(b - 300), _bar(b + 41, v=9)])
    assert [r[0] for r in _stored("NVDA", "5")] == [b - 300, b]


def test_put_bars_many_drops_a_stray_beside_its_bucket_row(store):
    b = _et(2026, 11, 6, 16, 35)
    bars_sqlite.put_bars_many("5", {"IWM": [_bar(b, v=100), _bar(b + 51, c=10.5, v=1)]})
    rows = _stored("IWM", "5")
    assert [r[0] for r in rows] == [b] and rows[0][4] == 10.0 and rows[0][5] == 100


def test_daily_writes_are_untouched(store):
    assert bars_sqlite.put_bars("SPY", "D", [_bar("2026-11-06")], date_tf=True) == 1
    assert _stored("SPY", "D")[0][0] == 20261106


# ── 3. the serve chokepoint + stored-row repair ──────────────────────────────

def _raw(rows):
    return [(r["t"], r["o"], r["h"], r["l"], r["c"], r["v"]) for r in rows]


def test_fmt_sqlite_bars_never_emits_a_misaligned_row(monkeypatch):
    monkeypatch.setenv("BARS_OFFGRID_REPAIR", "0")
    b = _et(2026, 11, 6, 16, 35)
    rows = _raw([_bar(b - 300), _bar(b, v=100), _bar(b + 50, h=12, v=7), _bar(b + 300)])
    out = bars_fetch._fmt_sqlite_bars(rows, "5", "SPY")
    assert [x["t"] for x in out] == [b - 300, b, b + 300]
    # Serve agrees with repair: the stored twin is served as stored (it is final).
    assert out[1]["h"] == 11.0 and out[1]["v"] == 100


def test_since_read_never_resends_an_older_bucket(monkeypatch):
    """A `since=` read whose window starts at the stray row must not emit its bucket
    (that would overwrite the client's complete 16:35 candle with the stray's values)."""
    monkeypatch.setenv("BARS_OFFGRID_REPAIR", "0")
    b = _et(2026, 11, 6, 16, 35)
    out = bars_fetch._fmt_sqlite_bars(_raw([_bar(b + 50), _bar(b + 300)]), "5", "SPY")
    assert [x["t"] for x in out] == [b + 300]


def test_repair_pair_is_bounded_and_idempotent(store):
    b = _et(2026, 11, 6, 16, 35)
    c = bars_sqlite._conn()
    c.executemany("INSERT INTO ohlcv(ticker,tf,ts,o,h,l,c,v) VALUES(?,?,?,?,?,?,?,?)", [
        ("SPY", "5", b, 10, 11, 9, 10, 100),
        ("SPY", "5", b + 50, 10, 11, 9, 10, 7),          # twin exists → deleted
        ("SPY", "5", b + 341, 10, 12, 9, 11, 3),         # no twin → snapped to b+300
        ("SPY", "60", _et(2026, 11, 6, 17, 30), 10, 11, 9, 10, 1),   # :30 post-market
        ("SPY", "60", _et(2026, 11, 6, 17, 0), 10, 11, 9, 10, 5),
    ])
    c.commit()
    r = intraday_grid.repair_pair("SPY", "5", 0)
    assert r == {"deleted": 2, "snapped": 1}
    assert [x[0] for x in _stored("SPY", "5")] == [b, b + 300]
    assert intraday_grid.repair_pair("SPY", "5", 0) == {"deleted": 0, "snapped": 0}
    res = intraday_grid.sweep(tickers=["SPY"])
    assert res["deleted"] == 1        # the 60m :30 row (its 17:00 bucket already exists)
    assert [x[0] for x in _stored("SPY", "60")] == [_et(2026, 11, 6, 17, 0)]
    assert intraday_grid.sweep(tickers=["SPY"])["deleted"] == 0


# ── 4. the snapshot merge door ───────────────────────────────────────────────

def _db(path, rows):
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL, "
              "ts INTEGER NOT NULL, o REAL, h REAL, l REAL, c REAL, v INTEGER, "
              "PRIMARY KEY (ticker, tf, ts))")
    c.executemany("INSERT INTO ohlcv VALUES (?,?,?,10,11,9,10,100)", rows)
    c.commit()
    c.close()


def test_merge_never_copies_an_off_grid_row(tmp_path):
    b = _et(2026, 11, 6, 16, 35)
    local, snap = str(tmp_path / "bars.db"), str(tmp_path / "delta.db")
    _db(local, [("SPY", "5", b - 300)])
    _db(snap, [("SPY", "5", b), ("SPY", "5", b + 50), ("SPY", "15", b + 51)])
    assert data_sync._merge_ohlcv_from(snap, local_db=local) == 1
    c = sqlite3.connect(local)
    try:
        assert sorted(c.execute("SELECT ts FROM ohlcv WHERE ticker='SPY'")) == [(b - 300,), (b,)]
    finally:
        c.close()


def test_a_read_that_meets_an_off_grid_row_queues_its_repair(store, monkeypatch):
    import time
    monkeypatch.setenv("BARS_OFFGRID_REPAIR_IN_TESTS", "1")
    b = _et(2026, 11, 3, 16, 15)
    c = bars_sqlite._conn()
    c.executemany("INSERT INTO ohlcv(ticker,tf,ts,o,h,l,c,v) VALUES(?,?,?,?,?,?,?,?)", [
        ("AMD", "15", b, 10, 11, 9, 10, 100), ("AMD", "15", b + 31, 10, 11, 9, 10, 2)])
    c.commit()
    out = bars_fetch._fmt_sqlite_bars(_stored("AMD", "15"), "15", "AMD")
    assert [x["t"] for x in out] == [b]
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline and len(_stored("AMD", "15")) != 1:
        time.sleep(0.05)
    assert [r[0] for r in _stored("AMD", "15")] == [b]


def test_sweep_survives_a_db_replacement_mid_walk(store, monkeypatch):
    """A snapshot install bumps the db epoch (closing the thread's cached connection)
    while the sweep walks the universe; it must keep going, not fail every later pair."""
    b = _et(2026, 11, 6, 16, 35)
    c = bars_sqlite._conn()
    c.executemany("INSERT INTO ohlcv(ticker,tf,ts,o,h,l,c,v) VALUES(?,?,?,?,?,?,?,?)", [
        ("AAA", "5", b, 10, 11, 9, 10, 100), ("AAA", "5", b + 50, 10, 11, 9, 10, 7),
        ("ZZZ", "5", b, 10, 11, 9, 10, 100), ("ZZZ", "5", b + 50, 10, 11, 9, 10, 7)])
    c.commit()
    real = intraday_grid.repair_pair

    def bump_after(tkr, tf, lo=0):
        res = real(tkr, tf, lo)
        bars_sqlite.bump_db_epoch()          # what a mid-walk install does
        return res
    monkeypatch.setattr(intraday_grid, "repair_pair", bump_after)
    res = intraday_grid.sweep()
    assert res["tickers"] == 2 and res["deleted"] == 2
    assert [r[0] for r in _stored("ZZZ", "5")] == [b]
