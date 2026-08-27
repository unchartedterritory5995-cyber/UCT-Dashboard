"""Scatter/bubble widget service — the per-ticker metric bundle + universe resolver.

Pure-function tests: the live-field math, the daily+live+RS merge, and the
defensive universe resolution. No FastAPI, no network — the market snapshot, the
screener rows and the RS cache are all monkeypatched.
"""
from __future__ import annotations

from api.services import scatter


def test_metric_catalog_has_the_named_axes_and_marks_live():
    keys = {m["key"] for m in scatter.metric_catalog()}
    for k in ("chg_today", "gap", "from_open", "rvol", "rs_rank", "market_cap",
              "adr_pct", "chg_1m", "pct_vs_sma200", "dist_52w_high"):
        assert k in keys
    live = {m["key"] for m in scatter.metric_catalog() if m["live"]}
    assert "chg_today" in live and "rs_rank" not in live   # intraday vs nightly


def test_live_fields_compute_the_intraday_metrics_and_direction():
    s = {"last_price": 110.0, "prev_close": 100.0, "day_open": 105.0,
         "day_high": 112.0, "day_low": 104.0, "today_vol": 2_000_000}
    f = scatter._live_fields(s, avg_vol=1_000_000)
    assert f["chg_today"] == 10.0
    assert f["gap"] == 5.0
    assert f["from_open"] == 4.76
    assert f["range_pos"] == 75.0
    assert f["rvol"] == 2.0
    assert f["vol_today"] == 2_000_000
    assert f["dvol_today"] == 220_000_000
    assert f["price"] == 110.0
    assert f["dir"] == "up"


def test_live_fields_are_omitted_when_absent_pre_open():
    # Pre-open: no print, provider returns zeros → nothing computable, dir=down(flat).
    f = scatter._live_fields({"last_price": 0.0, "prev_close": 0.0, "today_vol": 0}, None)
    assert "chg_today" not in f and "price" not in f and "rvol" not in f


def test_bundle_merges_daily_screener_live_snapshot_and_rs(monkeypatch):
    monkeypatch.setattr("api.services.screener.snapshot_db.get_rows", lambda tks: {
        "AAPL": {"company": "Apple", "sector": "Technology", "industry": "Consumer El.",
                 "avg_volume_30d": 1_000_000, "market_cap": 3.0e12, "pe_ttm": 30.0,
                 "chg_pct_1m": 5.2, "adr_pct": 2.1, "rs_rank": None,
                 "dist_52w_high_pct": -3.0},
    })
    monkeypatch.setattr("api.services.rs_ranking.cached_rank_map",
                        lambda: {"AAPL": {"rs_rank": 88, "rs_score": 90.0}})
    monkeypatch.setattr(scatter, "_full_snapshot", lambda: {
        "AAPL": {"last_price": 110.0, "prev_close": 100.0, "day_open": 105.0,
                 "day_high": 112.0, "day_low": 104.0, "today_vol": 2_000_000},
    })
    out = scatter.bundle(["AAPL"])
    assert out["count"] == 1
    p = out["tickers"][0]
    assert p["sym"] == "AAPL" and p["name"] == "Apple" and p["sector"] == "Technology"
    assert p["dir"] == "up"
    m = p["m"]
    assert m["chg_today"] == 10.0 and m["rvol"] == 2.0          # live
    assert m["market_cap"] == 3.0e12 and m["chg_1m"] == 5.2     # daily
    assert m["adr_pct"] == 2.1 and m["dist_52w_high"] == -3.0
    assert m["rs_rank"] == 88                                   # RS cache beats NULL column
    assert "pe_ttm" in m


def test_bundle_drops_null_metrics_cleanly(monkeypatch):
    monkeypatch.setattr("api.services.screener.snapshot_db.get_rows", lambda tks: {
        "ZZZ": {"company": "Zed", "market_cap": None, "pe_ttm": "", "adr_pct": 3.3}})
    monkeypatch.setattr("api.services.rs_ranking.cached_rank_map", lambda: {})
    monkeypatch.setattr(scatter, "_full_snapshot", lambda: {})
    m = scatter.bundle(["ZZZ"])["tickers"][0]["m"]
    assert "market_cap" not in m and "pe_ttm" not in m and m["adr_pct"] == 3.3
    assert "rs_rank" not in m


def test_live_overlay_returns_per_symbol_live_fields(monkeypatch):
    monkeypatch.setattr(scatter, "_full_snapshot", lambda: {
        "AAA": {"last_price": 12.0, "prev_close": 10.0, "today_vol": 5},
        "BBB": {"last_price": 9.0, "prev_close": 10.0, "today_vol": 5},
    })
    pts = scatter.live_overlay(["AAA", "BBB", "MISS"])
    assert pts["AAA"]["chg_today"] == 20.0 and pts["AAA"]["dir"] == "up"
    assert pts["BBB"]["chg_today"] == -10.0 and pts["BBB"]["dir"] == "down"
    assert "MISS" not in pts


def test_resolve_universe_dedupes_uppercases_and_caps(monkeypatch):
    monkeypatch.setattr(scatter, "_cap_universe", lambda: ["aaa", "AAA", "bbb", "ccc"])
    assert scatter.resolve_universe("market", None, None) == ["AAA", "BBB", "CCC"]
    monkeypatch.setattr(scatter, "_MAX_TICKERS", 2)
    assert scatter.resolve_universe("market", None, None) == ["AAA", "BBB"]


def test_resolve_universe_index_reads_membership_flags(monkeypatch):
    monkeypatch.setattr(scatter, "_index_members",
                        lambda col: ["MSFT", "AAPL"] if col == "index_ndx" else [])
    assert scatter.resolve_universe("index", "ndx", None) == ["MSFT", "AAPL"]
    assert scatter.resolve_universe("index", "bogus", None) == []


def test_resolve_universe_is_defensive_on_unknown_or_broken_source():
    assert scatter.resolve_universe("nonsense", None, None) == []
    # watchlist without a user resolves to nothing rather than raising.
    assert scatter.resolve_universe("watchlist", "x", None) == []


def test_list_universes_always_has_the_static_groups():
    groups = {g["group"] for g in scatter.list_universes(None)}
    assert {"Indices", "My Lists", "Scanners", "Breadth", "Market"} <= groups
    idx = next(g for g in scatter.list_universes(None) if g["group"] == "Indices")
    assert any(it["value"] == "sp500" for it in idx["items"])
