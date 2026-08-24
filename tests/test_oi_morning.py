"""Tests for the Morning OI Update card (api/oi_morning.py)."""
import sqlite3

import api.oi_morning as oim
from api import oi_snapshots


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
    monkeypatch.setattr(oim, "_oi_deltas", lambda keys: {
        kA: (1000, 11000, "2026-08-22"),
        kB: (200, 3000, "2026-08-22"),
        kC: (5000, 5100, "2026-08-22"),
        kM: (100, 99999, "2026-08-22"),
        kE: (100, 99999, "2026-08-22"),
    })

    rows, window = oim.build_rows(days=1, top_n=10, min_delta=500)
    assert [r["sym"] for r in rows] == ["AAA", "BBB"]   # CCC<500; MLX pure-ML; EXP expired
    assert window == ["8/21/2026"]

    aaa = rows[0]
    assert aaa["delta"] == 10000 and aaa["firstOI"] == 1000 and aaa["lastOI"] == 11000
    assert aaa["flow"] == "S+B" and aaa["state"] == "BUILDING"
    assert rows[1]["flow"] == "SWP" and rows[1]["cp"] == "P" and rows[1]["delta"] == 2800


def test_brand_new_position_uses_zero_baseline(tmp_path, monkeypatch):
    """No prior snapshot → First OI 0, ΔOI = full last OI, State NEW."""
    db = tmp_path / "flow.db"
    _seed_flow(str(db), [_row("NEWP", "SWEEP", "CALL", 60, _FUT, 500000, 1000, 0)])
    monkeypatch.setattr(oim, "_flow_db_path", lambda: str(db))
    kN = oi_snapshots.make_key("NEWP", "C", 60, _FUT)
    monkeypatch.setattr(oim, "_oi_deltas", lambda keys: {kN: (0, 27800, "2026-08-22")})
    rows, _ = oim.build_rows(days=1, top_n=10, min_delta=500)
    assert len(rows) == 1
    assert rows[0]["firstOI"] == 0 and rows[0]["delta"] == 27800 and rows[0]["state"] == "NEW"


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
    monkeypatch.setattr(oim, "_oi_deltas", lambda keys: {
        kA: (1000, 20000, "2026-08-22"), kS: (100, 99999, "2026-08-22"), kQ: (100, 99999, "2026-08-22")})
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
    monkeypatch.setattr(oim, "_oi_deltas", lambda keys: {})   # none priced
    rows, _ = oim.build_rows(days=1, top_n=10, min_delta=500)
    assert rows == []


def test_render_returns_png(tmp_path, monkeypatch):
    db = tmp_path / "flow.db"
    _seed_flow(str(db), [_row("AAA", "SWEEP", "CALL", 100, _FUT, 500000, 1000, 1000)])
    monkeypatch.setattr(oim, "_flow_db_path", lambda: str(db))
    kA = oi_snapshots.make_key("AAA", "C", 100, _FUT)
    monkeypatch.setattr(oim, "_oi_deltas", lambda keys: {kA: (1000, 11000, "2026-08-22")})
    rows, window = oim.build_rows(days=1, top_n=10, min_delta=500)
    assert oim.render_card(rows, window)[:8] == b"\x89PNG\r\n\x1a\n"
    assert oim.render_card([], ["8/21/2026"])[:8] == b"\x89PNG\r\n\x1a\n"   # empty renders too
