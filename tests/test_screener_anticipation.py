"""The Anticipation preset: the firm's TC2000 column as a screener starter.

TC2000 (Edit Column dialog), row for row:
    Price History > 3
    and (c/c5>=1.13 and c>3) or (c/c5>1.06 and c>50)  Is True
    and MinV3.1>600000  Is True
    and Price History above Avg 50
    and Capitalization > 250

Two things are pinned here: the one new nightly column the scan needs
(`min_volume_3d_prior`, TC2000's MINV3.1), and the starter run end to end over
real `screener_rows`, boundaries included.
"""
from __future__ import annotations

import importlib

import pytest

from api.services.screener import query
from api.services.screener import technicals as T


def _bar(v, c=100.0):
    return {"o": c, "h": c, "l": c, "c": c, "v": v}


# ── MINV3.1 ──────────────────────────────────────────────────────────────────

def test_min_volume_is_the_lowest_of_the_three_sessions_before_the_last():
    out = T.compute_technicals([_bar(v) for v in (5e6, 900e3, 650e3, 700e3, 10)])
    assert out["min_volume_3d_prior"] == 650e3


def test_a_heavy_last_session_cannot_lift_it():
    # ⭐ The `.1` in MINV3.1: today is left out, so a 20M-share day today does not
    # vouch for the three quiet days before it.
    out = T.compute_technicals([_bar(v) for v in (1e6, 100e3, 900e3, 900e3, 20e6)])
    assert out["min_volume_3d_prior"] == 100e3


@pytest.mark.parametrize("vols", [
    (900e3, None, 900e3, 1e6),        # a missing session is never read as zero
    (900e3, 900e3, 1e6),              # only two sessions before the last
])
def test_blank_without_three_whole_prior_sessions(vols):
    assert T.compute_technicals([_bar(v) for v in vols])["min_volume_3d_prior"] is None


# ── the starter, end to end ──────────────────────────────────────────────────

def _starter(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    import api.services.auth_db as adb
    importlib.reload(adb)
    adb.init_db()
    import api.services.screener.saved_screens as ss
    importlib.reload(ss)
    ss.init()
    return next(s for s in ss.starters() if s["id"] == "starter_anticipation")


#: A row that passes on the 13% branch. Each case below changes ONE field.
BASE = {"price": 20.0, "chg_pct_1w": 15.0, "min_volume_3d_prior": 700e3,
        "above_50sma": True, "market_cap": 300e6}

CASES = {
    "PASS_13PCT": ({}, True),
    "PASS_6PCT_OVER_50": ({"price": 80.0, "chg_pct_1w": 8.0}, True),
    "EDGE_EXACTLY_13": ({"chg_pct_1w": 13.0}, True),            # c/c5 >= 1.13
    "EDGE_EXACTLY_6": ({"price": 80.0, "chg_pct_1w": 6.0}, False),  # c/c5 > 1.06 is strict
    "SIX_PCT_UNDER_50": ({"price": 30.0, "chg_pct_1w": 8.0}, False),
    "PRICE_3": ({"price": 3.0}, False),                          # Price History > 3 is strict
    "THIN_VOLUME": ({"min_volume_3d_prior": 600e3}, False),     # MinV3.1 > 600000 is strict
    "BELOW_50DAY": ({"above_50sma": False}, False),
    "CAP_250M": ({"market_cap": 250e6}, False),                 # Capitalization > 250 (millions)
    "NO_VOLUME_YET": ({"min_volume_3d_prior": None}, False),
}


def test_the_starter_selects_exactly_what_the_tc2000_column_selects(tmp_path, monkeypatch):
    starter = _starter(tmp_path, monkeypatch)
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    monkeypatch.setenv("SCREENER_LOGIC_ENABLED", "1")
    from api.services.screener import snapshot_db
    snapshot_db.init_db()
    snapshot_db.upsert_rows([dict(BASE, **change, ticker=name) for name, (change, _) in CASES.items()])
    spec = dict(starter["spec"], sort={"key": "ticker", "dir": "asc"})
    with snapshot_db.connect() as conn:
        plan = query.build_scan_sql(spec, conn=conn)
        got = {r["ticker"] for r in conn.execute(plan["sql"], plan["params"]).fetchall()}
    want = {name for name, (_, passes) in CASES.items() if passes}
    assert got == want, {"missing": sorted(want - got), "extra": sorted(got - want)}


def test_with_grouped_logic_off_the_starter_is_refused_never_run_without_its_thrust(tmp_path, monkeypatch):
    starter = _starter(tmp_path, monkeypatch)
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    monkeypatch.setenv("SCREENER_LOGIC_ENABLED", "0")
    from api.services.screener import snapshot_db
    snapshot_db.init_db()
    with snapshot_db.connect() as conn, pytest.raises(ValueError, match="not switched on"):
        query.build_scan_sql(starter["spec"], conn=conn)
