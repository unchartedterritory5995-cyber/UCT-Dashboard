"""Tests for the Morning OI Update card (api/oi_morning.py)."""
import sqlite3

import pytest

import api.oi_morning as oim
from api import oi_snapshots


@pytest.fixture(autouse=True)
def _no_snap_pin(monkeypatch):
    """Default: no OI snapshot present → flow-window pinning is a no-op, and nothing
    touches the real /data/oi_massive.db. Tests that exercise pinning override it."""
    monkeypatch.setattr(oim, "_latest_oi_snap", lambda: None)


def _seed_flow(path, rows):
    conn = sqlite3.connect(path)
    conn.execute("""CREATE TABLE flow(
        source TEXT, CreatedDate TEXT, CreatedTime TEXT, Symbol TEXT, Type TEXT,
        Volume TEXT, Side TEXT, CallPut TEXT, Strike TEXT, Spot TEXT, Premium TEXT,
        ExpirationDate TEXT, Color TEXT, Dte TEXT, StockEtf TEXT, MktCap TEXT, OI TEXT)""")
    conn.executemany("INSERT INTO flow VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
    conn.commit()
    conn.close()


# (source,date,time,sym,type,vol,side,cp,strike,spot,prem,exp,color,dte,stocketf,mktcap,oi)
def _row(sym, typ, cp, strike, exp, prem, vol, oi, dt="8/21/2026", tm="10:00:00",
         stocketf="STOCK", source="stocks"):
    return (source, dt, tm, sym, typ, str(vol), "A", cp, str(strike), "50",
            str(prem), exp, "WHITE", "60", stocketf, "5e9", str(oi))


_FUT = "1/15/2027"      # future expiry (kept)
_PAST = "1/16/2026"     # past expiry (expired → dropped)


def test_build_rows_ranks_by_delta_oi(tmp_path, monkeypatch):
    db = tmp_path / "flow.db"
    _seed_flow(str(db), [
        _row("AAA", "SWEEP", "CALL", 100, _FUT, 500000, 1000, 1000),
        _row("AAA", "BLOCK", "CALL", 100, _FUT, 250000, 500, 1000, tm="10:05:00"),  # → S+B
        _row("BBB", "SWEEP", "PUT", 50, _FUT, 300000, 2000, 200),
        _row("CCC", "BLOCK", "CALL", 20, _FUT, 80000, 100, 5000),   # ΔOI=100 → filtered
        _row("MLX", "ML/AB", "CALL", 30, _FUT, 900000, 5000, 100),  # pure ML → dropped
        _row("EXP", "SWEEP", "CALL", 10, _PAST, 900000, 5000, 100),  # expired → dropped
    ])
    monkeypatch.setattr(oim, "_flow_db_path", lambda: str(db))

    kA = oi_snapshots.make_key("AAA", "C", 100, _FUT)
    kB = oi_snapshots.make_key("BBB", "P", 50, _FUT)
    kC = oi_snapshots.make_key("CCC", "C", 20, _FUT)
    kM = oi_snapshots.make_key("MLX", "C", 30, _FUT)
    kE = oi_snapshots.make_key("EXP", "C", 10, _PAST)
    # (prior_oi, last_oi, last_date). MLX/EXP get big deltas to prove they're dropped
    # by rule, not by ΔOI.
    monkeypatch.setattr(oim, "_oi_deltas", lambda keys: ({
        kA: (1000, 11000), kB: (200, 3000), kC: (5000, 5100),
        kM: (100, 99999), kE: (100, 99999),
    }, "2026-08-22", "2026-08-21"))
    monkeypatch.setattr(oim, "_contract_window_volume", lambda *a: 20000)  # no real HTTP

    rows, window = oim.build_rows(days=1, top_n=10, min_delta=500)
    assert [r["sym"] for r in rows] == ["AAA", "BBB"]   # CCC<500; MLX pure-ML; EXP expired
    assert window == ["8/21/2026"]

    aaa = rows[0]
    assert aaa["delta"] == 10000 and aaa["firstOI"] == 1000 and aaa["lastOI"] == 11000
    assert aaa["flow"] == "S+B" and aaa["state"] == "BUILDING"
    # CARRY% = ΔOI / total volume: 10000/20000 = 50%
    assert aaa["volTotal"] == 20000 and aaa["carry"] == 50
    assert rows[1]["flow"] == "SWP" and rows[1]["cp"] == "P" and rows[1]["delta"] == 2800
    assert rows[1]["carry"] == 14   # round(2800/20000*100)


def test_carry_none_when_volume_unavailable(tmp_path, monkeypatch):
    db = tmp_path / "flow.db"
    _seed_flow(str(db), [_row("AAA", "SWEEP", "CALL", 100, _FUT, 500000, 1000, 1000)])
    monkeypatch.setattr(oim, "_flow_db_path", lambda: str(db))
    kA = oi_snapshots.make_key("AAA", "C", 100, _FUT)
    monkeypatch.setattr(oim, "_oi_deltas", lambda keys: ({kA: (1000, 11000)}, "2026-08-22", "2026-08-21"))
    monkeypatch.setattr(oim, "_contract_window_volume", lambda *a: 0)   # unknown volume
    rows, _ = oim.build_rows(days=1, top_n=10, min_delta=500)
    assert rows[0]["volTotal"] == 0 and rows[0]["carry"] is None


def test_brand_new_position_uses_zero_baseline(tmp_path, monkeypatch):
    """No prior snapshot → First OI 0, ΔOI = full last OI, State NEW."""
    db = tmp_path / "flow.db"
    _seed_flow(str(db), [_row("NEWP", "SWEEP", "CALL", 60, _FUT, 500000, 1000, 0)])
    monkeypatch.setattr(oim, "_flow_db_path", lambda: str(db))
    kN = oi_snapshots.make_key("NEWP", "C", 60, _FUT)
    monkeypatch.setattr(oim, "_oi_deltas", lambda keys: ({kN: (0, 27800)}, "2026-08-22", None))
    monkeypatch.setattr(oim, "_contract_window_volume", lambda *a: 30000)
    rows, _ = oim.build_rows(days=1, top_n=10, min_delta=500)
    assert len(rows) == 1
    assert rows[0]["firstOI"] == 0 and rows[0]["delta"] == 27800 and rows[0]["state"] == "NEW"
    # carry populates on NEW rows too: 27800 / 30000 = 93% (% of volume that became OI)
    assert rows[0]["carry"] == 93


def test_etf_and_index_sources_excluded(tmp_path, monkeypatch):
    """Default is single-names only: ETFs (StockEtf='ETF') and source='indexes' are
    dropped so the raw-ΔOI board isn't swamped by huge-OI ETFs."""
    db = tmp_path / "flow.db"
    _seed_flow(str(db), [
        _row("AAPL", "SWEEP", "CALL", 200, _FUT, 500000, 1000, 1000),                    # stock → kept
        _row("SPY", "SWEEP", "CALL", 500, _FUT, 900000, 5000, 100, stocketf="ETF"),       # ETF flag → dropped
        _row("QQQ", "SWEEP", "CALL", 500, _FUT, 900000, 5000, 100, source="indexes"),     # indexes → dropped
    ])
    monkeypatch.setattr(oim, "_flow_db_path", lambda: str(db))
    kA = oi_snapshots.make_key("AAPL", "C", 200, _FUT)
    kS = oi_snapshots.make_key("SPY", "C", 500, _FUT)
    kQ = oi_snapshots.make_key("QQQ", "C", 500, _FUT)
    monkeypatch.setattr(oim, "_oi_deltas", lambda keys: ({
        kA: (1000, 20000), kS: (100, 40000), kQ: (100, 40000)}, "2026-08-22", "2026-08-21"))
    monkeypatch.setattr(oim, "_contract_window_volume", lambda *a: 50000)  # ΔOI 39,900 ≤ vol → passes gate
    rows, _ = oim.build_rows(days=1, top_n=10, min_delta=500)   # default sources=('stocks',)
    assert [r["sym"] for r in rows] == ["AAPL"]

    # opt back in to ETFs/indexes via sources
    rows2, _ = oim.build_rows(days=1, top_n=10, min_delta=500, sources=("stocks", "indexes"))
    assert "QQQ" in [r["sym"] for r in rows2]        # indexes now included
    assert "SPY" not in [r["sym"] for r in rows2]    # StockEtf='ETF' still dropped by the safety net


def test_no_snapshot_contract_is_dropped(tmp_path, monkeypatch):
    """A contract with no fresh OI snapshot can't compute ΔOI → excluded."""
    db = tmp_path / "flow.db"
    _seed_flow(str(db), [_row("ZZZ", "SWEEP", "CALL", 100, _FUT, 500000, 1000, 1000)])
    monkeypatch.setattr(oim, "_flow_db_path", lambda: str(db))
    monkeypatch.setattr(oim, "_oi_deltas", lambda keys: ({}, None, None))   # none priced
    rows, _ = oim.build_rows(days=1, top_n=10, min_delta=500)
    assert rows == []


def test_render_returns_png(tmp_path, monkeypatch):
    db = tmp_path / "flow.db"
    _seed_flow(str(db), [_row("AAA", "SWEEP", "CALL", 100, _FUT, 500000, 1000, 1000)])
    monkeypatch.setattr(oim, "_flow_db_path", lambda: str(db))
    kA = oi_snapshots.make_key("AAA", "C", 100, _FUT)
    monkeypatch.setattr(oim, "_oi_deltas", lambda keys: ({kA: (1000, 11000)}, "2026-08-22", "2026-08-21"))
    monkeypatch.setattr(oim, "_contract_window_volume", lambda *a: 40000)
    rows, window = oim.build_rows(days=1, top_n=10, min_delta=500)
    assert oim.render_card(rows, window)[:8] == b"\x89PNG\r\n\x1a\n"
    assert oim.render_card([], ["8/21/2026"])[:8] == b"\x89PNG\r\n\x1a\n"   # empty renders too


def test_flow_window_pinned_to_session_before_snapshot(tmp_path, monkeypatch):
    """The flow window drops any session on/after the latest snapshot date, because
    the ΔOI measures the build during the session BEFORE it (OCC lags a day). A
    preview run after the flow session must still pair that session's flow with its
    own OI build, not the next day's."""
    db = tmp_path / "flow.db"
    _seed_flow(str(db), [
        _row("AAA", "SWEEP", "CALL", 100, _FUT, 500000, 1000, 1000, dt="9/3/2026"),
        _row("BBB", "SWEEP", "CALL", 50, _FUT, 500000, 1000, 1000, dt="9/4/2026"),  # excluded
    ])
    monkeypatch.setattr(oim, "_flow_db_path", lambda: str(db))
    monkeypatch.setattr(oim, "_latest_oi_snap", lambda: "2026-09-04")   # snapshot = 9/4
    kA = oi_snapshots.make_key("AAA", "C", 100, _FUT)
    kB = oi_snapshots.make_key("BBB", "C", 50, _FUT)
    seen = {}
    def _deltas(keys):
        seen["keys"] = list(keys)
        return ({kA: (1000, 11000)}, "2026-09-04", "2026-09-03")
    monkeypatch.setattr(oim, "_oi_deltas", _deltas)
    monkeypatch.setattr(oim, "_contract_window_volume", lambda *a: 20000)
    rows, window = oim.build_rows(days=1, top_n=10, min_delta=500)
    assert window == ["9/3/2026"]                 # 9/4 dropped (== snapshot date)
    assert kB not in seen["keys"]                 # the 9/4 contract never enters the join
    assert [r["sym"] for r in rows] == ["AAA"]


def test_impossible_build_dropped_and_carry_clamped(tmp_path, monkeypatch):
    """OI can't grow more than the session traded. A ΔOI far above the session volume
    (a prior=0 artifact) is DROPPED from the board; a small rounding overshoot within
    tolerance stays and clamps to 100%."""
    db = tmp_path / "flow.db"
    _seed_flow(str(db), [
        _row("CLMP", "SWEEP", "CALL", 100, _FUT, 500000, 1000, 1000),   # ΔOI 10500 / vol 10000 = 1.05x → kept, 100%
        _row("BADX", "SWEEP", "CALL", 20, _FUT, 500000, 1000, 1000),    # ΔOI 90000 / vol 10000 = 9x → dropped
    ])
    monkeypatch.setattr(oim, "_flow_db_path", lambda: str(db))
    kC = oi_snapshots.make_key("CLMP", "C", 100, _FUT)
    kX = oi_snapshots.make_key("BADX", "C", 20, _FUT)
    monkeypatch.setattr(oim, "_oi_deltas",
                        lambda keys: ({kC: (1000, 11500), kX: (1000, 91000)}, "2026-08-22", "2026-08-21"))
    monkeypatch.setattr(oim, "_contract_window_volume", lambda *a: 10000)
    rows, _ = oim.build_rows(days=1, top_n=10, min_delta=500)
    by = {r["sym"]: r for r in rows}
    assert "BADX" not in by                # ΔOI 9x the session volume → impossible, dropped
    assert by["CLMP"]["carry"] == 100      # 105% within tolerance → clamped


def test_gate_walks_past_drops_to_fill_top_n(tmp_path, monkeypatch):
    """A dropped impossible row doesn't cost a slot — the walk continues down the
    ranked list so a real lower-ΔOI build fills the board."""
    db = tmp_path / "flow.db"
    _seed_flow(str(db), [
        _row("BADX", "SWEEP", "CALL", 20, _FUT, 500000, 1000, 1000),    # biggest ΔOI but impossible
        _row("REAL", "SWEEP", "CALL", 50, _FUT, 500000, 1000, 1000),    # smaller ΔOI, physically fine
    ])
    monkeypatch.setattr(oim, "_flow_db_path", lambda: str(db))
    kX = oi_snapshots.make_key("BADX", "C", 20, _FUT)
    kR = oi_snapshots.make_key("REAL", "C", 50, _FUT)
    monkeypatch.setattr(oim, "_oi_deltas",
                        lambda keys: ({kX: (0, 90000), kR: (1000, 6000)}, "2026-08-22", "2026-08-21"))
    monkeypatch.setattr(oim, "_contract_window_volume", lambda *a: 10000)
    rows, _ = oim.build_rows(days=1, top_n=1, min_delta=500)   # only ONE slot
    assert [r["sym"] for r in rows] == ["REAL"]   # BADX dropped, REAL took the slot
