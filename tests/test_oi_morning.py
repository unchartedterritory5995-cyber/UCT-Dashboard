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
def _row(sym, typ, cp, strike, exp, prem, vol, oi, dt="8/21/2026", tm="10:00:00"):
    return ("stocks", dt, tm, sym, typ, str(vol), "A", cp, str(strike), "50",
            str(prem), exp, "WHITE", "60", "STOCK", "5e9", str(oi))


def test_build_rows_ranks_by_delta_oi(tmp_path, monkeypatch):
    db = tmp_path / "flow.db"
    _seed_flow(str(db), [
        _row("AAA", "SWEEP", "CALL", 100, "1/16/2026", 500000, 1000, 1000),
        _row("AAA", "BLOCK", "CALL", 100, "1/16/2026", 250000, 500, 1000, tm="10:05:00"),  # same → S+B
        _row("BBB", "SWEEP", "PUT", 50, "9/18/2026", 300000, 2000, 200),
        _row("CCC", "BLOCK", "CALL", 20, "10/16/2026", 80000, 100, 5000),  # ΔOI=100 → filtered
    ])
    monkeypatch.setattr(oim, "_flow_db_path", lambda: str(db))

    kA = oi_snapshots.make_key("AAA", "C", 100, "1/16/2026")
    kB = oi_snapshots.make_key("BBB", "P", 50, "9/18/2026")
    kC = oi_snapshots.make_key("CCC", "C", 20, "10/16/2026")
    monkeypatch.setattr(oi_snapshots, "get_latest_oi_batch",
                        lambda keys: {kA: (11000, "2026-08-22"),
                                      kB: (3000, "2026-08-22"),
                                      kC: (5100, "2026-08-22")})
    monkeypatch.setattr(oi_snapshots, "get_history",
                        lambda ck, days=10: [{"oi": 100}, {"oi": 9000}])  # BUILDING

    rows, window = oim.build_rows(days=1, top_n=10, min_delta=500)
    assert [r["sym"] for r in rows] == ["AAA", "BBB"]   # CCC ΔOI=100<500; sorted by ΔOI desc
    assert window == ["8/21/2026"]

    aaa = rows[0]
    assert aaa["delta"] == 10000 and aaa["firstOI"] == 1000 and aaa["lastOI"] == 11000
    assert aaa["flow"] == "S+B"                          # sweep + block on one contract
    assert aaa["state"] == "BUILDING"
    bbb = rows[1]
    assert bbb["flow"] == "SWP" and bbb["cp"] == "P" and bbb["delta"] == 2800


def test_no_snapshot_contract_is_dropped(tmp_path, monkeypatch):
    """A contract with no fresh OI snapshot can't compute ΔOI → excluded."""
    db = tmp_path / "flow.db"
    _seed_flow(str(db), [_row("ZZZ", "SWEEP", "CALL", 100, "1/16/2026", 500000, 1000, 1000)])
    monkeypatch.setattr(oim, "_flow_db_path", lambda: str(db))
    monkeypatch.setattr(oi_snapshots, "get_latest_oi_batch", lambda keys: {})  # none priced
    monkeypatch.setattr(oi_snapshots, "get_history", lambda ck, days=10: [])
    rows, _ = oim.build_rows(days=1, top_n=10, min_delta=500)
    assert rows == []


def test_render_returns_png(tmp_path, monkeypatch):
    db = tmp_path / "flow.db"
    _seed_flow(str(db), [_row("AAA", "SWEEP", "CALL", 100, "1/16/2026", 500000, 1000, 1000)])
    monkeypatch.setattr(oim, "_flow_db_path", lambda: str(db))
    kA = oi_snapshots.make_key("AAA", "C", 100, "1/16/2026")
    monkeypatch.setattr(oi_snapshots, "get_latest_oi_batch", lambda keys: {kA: (11000, "2026-08-22")})
    monkeypatch.setattr(oi_snapshots, "get_history", lambda ck, days=10: [{"oi": 100}, {"oi": 9000}])
    rows, window = oim.build_rows(days=1, top_n=10, min_delta=500)
    assert oim.render_card(rows, window)[:8] == b"\x89PNG\r\n\x1a\n"
    assert oim.render_card([], ["8/21/2026"])[:8] == b"\x89PNG\r\n\x1a\n"   # empty renders too
