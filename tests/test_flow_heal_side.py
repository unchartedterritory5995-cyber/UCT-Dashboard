"""Healed rows must carry the side of THEIR OWN trade.

10/2/2026: AVGO 355C 11/6's $3.06M 10:56:53 sweep (1,891 lots @ $16.20, 18
venues, ask side per BBS) was stored as "BB": a 16-lot [236] sliver made the
heal's tick test call the whole window multi-leg (no patch), and the 60s greedy
matcher then gave the sweep's row the "BB" of a 7-lot @ $16.00 from 14s earlier.
"""
from datetime import datetime, timezone

import numpy as np

from api import flow_heal_enrich as fhe
from api import massive_processor as mp

T = "O:AVGO261106C00355000"
SEC = 1_000_000_000
MS = 1_000_000


def _ns(h, mi, s):
    return int(datetime(2026, 10, 2, h, mi, s, tzinfo=timezone.utc).timestamp() * 1e9)


def _avgo_trades():
    t_lot = _ns(14, 56, 39)            # 10:56:39 AM ET
    t_sweep = _ns(14, 56, 53)          # 10:56:53 AM ET
    trades = [mp.RawTrade(T, 16.00, 7, 303, (209,), t_lot)]
    for i, ex in enumerate(range(300, 318)):             # 18 venues, 1,875 lots
        trades.append(mp.RawTrade(T, 16.20, 104 + (3 if i < 3 else 0), ex, (209,),
                                  t_sweep + i * 100_000))
    trades.append(mp.RawTrade(T, 16.19, 16, 301, (236,), t_sweep + 98 * MS))  # ML sliver
    return trades


def _events(trades, **kw):
    agg = mp.TradeAggregator(min_premium=10_000, min_volume=50, **kw)
    for t in trades:
        agg.add_trade(t)
    agg.flush_all()
    return agg.drain()


def test_flat_file_event_carries_its_own_tick_side():
    evs = _events(_avgo_trades(), tick_side=True)
    sweep = [e for e in evs if e.total_size > 1000]
    assert len(sweep) == 1
    assert sweep[0].type_ == "SWEEP"          # 16-lot sliver < ML_MIN_SIZE_FRAC
    assert sweep[0].side == "A"               # $16.20 vs prior $16.00 = +1.2%
    assert sweep[0].side_method == "tick"


def test_tick_side_is_off_by_default():
    evs = _events(_avgo_trades())
    assert all(e.side == "" for e in evs)


def test_first_print_and_multileg_get_no_tick_side():
    t0 = _ns(15, 0, 0)
    first = _events([mp.RawTrade(T, 2.0, 100, 300, (209,), t0)], tick_side=True)
    assert first[0].side == ""                # no prior print on the contract
    ml = _events([mp.RawTrade(T, 2.0, 100, 300, (209,), t0),
                  mp.RawTrade(T, 2.5, 100, 301, (232,), t0 + 2 * SEC)], tick_side=True)
    assert ml[1].type_ == "ML/" and ml[1].side == ""


def test_tick_test_side_rules():
    assert mp.tick_test_side(1.10, (1.00, None, 0)) == "AA"
    assert mp.tick_test_side(1.02, (1.00, None, 0)) == "A"
    assert mp.tick_test_side(0.90, (1.00, None, 0)) == "BB"
    assert mp.tick_test_side(0.98, (1.00, None, 0)) == "B"
    assert mp.tick_test_side(1.001, (1.00, 1.10, 3)) == "B"     # flat: last fell
    assert mp.tick_test_side(1.001, (1.00, 0.90, 3)) == "A"     # flat: last rose
    assert mp.tick_test_side(1.001, (1.00, 0.90, 25)) == ""     # past walk-back
    assert mp.tick_test_side(1.00, None) == ""


def test_heal_tick_test_ml_is_size_weighted():
    tr = _avgo_trades()
    patches, stats = {}, {"events": 0, "sided": 0}
    fhe._tick_test_contract(
        T,
        np.array([t.ts_ns for t in tr], dtype=np.int64),
        np.array([t.price for t in tr], dtype=np.float64),
        np.array([t.size for t in tr], dtype=np.int64),
        np.array([t.conditions[0] for t in tr], dtype=np.int32),
        patches, stats)
    sides = {k.rsplit("|", 1)[-1]: v["side"] for k, v in patches.items()}
    assert sides.get("10:56:53 AM") == "A"    # was skipped as ML/ (no patch)


# ── Spot fill for healed rows (2026-10-03) ──────────────────────────────────

import sqlite3
from datetime import date


def test_spot_at_interpolates_within_minute_and_falls_back():
    bars = {10 * 60 + 18: (157.01, 157.24)}                 # SPCX 10:18 bar
    assert abs(fhe._spot_at(bars, (10 * 60 + 18) * 60 + 37) - 157.153) < 0.01
    assert fhe._spot_at(bars, (10 * 60 + 21) * 60) == 157.24   # 3 min later → last close
    assert fhe._spot_at(bars, (10 * 60 + 30) * 60) is None      # >5 min → unknown
    assert fhe._sec_of_day_str("1:15:29 PM") == 13 * 3600 + 15 * 60 + 29
    assert fhe._sec_of_day_str("12:00:05 AM") == 5


def test_fill_spot_day_only_fills_missing(tmp_path, monkeypatch):
    db = tmp_path / "flow.db"
    c = sqlite3.connect(db)
    c.execute("CREATE TABLE flow (id INTEGER PRIMARY KEY, CreatedDate TEXT, Symbol TEXT, "
              "CreatedTime TEXT, Spot TEXT)")
    c.executemany("INSERT INTO flow (CreatedDate, Symbol, CreatedTime, Spot) VALUES (?,?,?,?)", [
        ("10/2/2026", "SPCX", "10:18:37 AM", "0"),        # healed → fill
        ("10/2/2026", "SPCX", "10:18:40 AM", "156.90"),   # live spot → untouched
        ("10/2/2026", "SPXW", "10:18:37 AM", ""),         # index, no bar → left
    ])
    c.commit(); c.close()
    monkeypatch.setattr(fhe, "DB_PATH", str(db))
    monkeypatch.setattr(fhe, "_load_minute_bars",
                        lambda target, syms: {"SPCX": {10 * 60 + 18: (157.01, 157.24)}})
    out = fhe.fill_spot_day(date(2026, 10, 2))
    assert out["rows_missing"] == 2 and out["filled"] == 1 and out["no_bar"] == 1
    spots = [r[0] for r in sqlite3.connect(db).execute("SELECT Spot FROM flow ORDER BY id")]
    assert spots == ["157.15", "156.90", ""]
