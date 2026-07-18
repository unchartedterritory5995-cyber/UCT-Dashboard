import importlib
from api.services import groups_gates as g


def test_env_float_defaults_on_bad_value(monkeypatch):
    monkeypatch.setenv("X_BAD", "not-a-number")
    assert g._env_float("X_BAD", 4.0) == 4.0
    monkeypatch.setenv("X_OK", "12.5")
    assert g._env_float("X_OK", 4.0) == 12.5
    monkeypatch.delenv("X_MISSING", raising=False)
    assert g._env_float("X_MISSING", 7.0) == 7.0


def test_gates_enabled_default_off(monkeypatch):
    monkeypatch.delenv("GROUPS_SWING_GATES_ENABLED", raising=False)
    assert g.gates_enabled() is False
    monkeypatch.setenv("GROUPS_SWING_GATES_ENABLED", "1")
    assert g.gates_enabled() is True
    monkeypatch.setenv("GROUPS_SWING_GATES_ENABLED", "0")
    assert g.gates_enabled() is False


def test_gate_bands_liquidity_tiers(monkeypatch):
    monkeypatch.setattr(g, "PX_MIN", 5.0)
    monkeypatch.setattr(g, "DVOL_MIN", 20_000_000.0)
    monkeypatch.setattr(g, "RS_MIN", 70.0)
    monkeypatch.setattr(g, "ADR_MIN", 4.0)
    # confirmed liquid + full momentum
    assert g.gate_bands({"price": 50, "dollar_vol": 5e8, "rs_rank": 88, "adr_pct": 6}) == (0, 2)
    # confirmed liquid, no momentum
    assert g.gate_bands({"price": 50, "dollar_vol": 5e8, "rs_rank": 30, "adr_pct": 2}) == (0, 0)
    # missing price -> unconfirmed (band 1), even with great momentum (IPO case)
    assert g.gate_bands({"price": None, "dollar_vol": None, "rs_rank": 90, "adr_pct": 7}) == (1, 2)
    # confirmed illiquid: real data below floors -> band 2, momentum still computed
    assert g.gate_bands({"price": 2.0, "dollar_vol": 1e6, "rs_rank": 88, "adr_pct": 6}) == (2, 2)
    # missing momentum inputs count 0, not failure
    assert g.gate_bands({"price": 50, "dollar_vol": 5e8, "rs_rank": None, "adr_pct": None}) == (0, 0)
    # None / empty metrics -> unconfirmed, zero momentum
    assert g.gate_bands(None) == (1, 0)


def test_gate_score_composite(monkeypatch):
    monkeypatch.setattr(g, "PX_MIN", 5.0)
    monkeypatch.setattr(g, "DVOL_MIN", 20_000_000.0)
    monkeypatch.setattr(g, "RS_MIN", 70.0)
    monkeypatch.setattr(g, "ADR_MIN", 4.0)
    assert g.gate_score({"price": 50, "dollar_vol": 5e8, "rs_rank": 88, "adr_pct": 6}) == 4  # liq2 + mom2
    assert g.gate_score({"price": 2.0, "dollar_vol": 1e6, "rs_rank": 88, "adr_pct": 6}) == 2  # liq0 + mom2
    assert g.gate_score(None) == 1  # unconfirmed liq(1) + mom0


def test_pass_rates_counts_each_gate(monkeypatch):
    monkeypatch.setattr(g, "PX_MIN", 5.0)
    monkeypatch.setattr(g, "DVOL_MIN", 20_000_000.0)
    monkeypatch.setattr(g, "RS_MIN", 70.0)
    monkeypatch.setattr(g, "ADR_MIN", 4.0)
    pr = g.pass_rates({
        "A": {"price": 50, "dollar_vol": 5e8, "rs_rank": 88, "adr_pct": 6},   # all four pass
        "B": {"price": 2, "dollar_vol": 1e6, "rs_rank": 30, "adr_pct": 2},    # none pass
    })
    assert pr == {"rs": 1, "dvol": 1, "adr": 1, "px": 1, "n": 2}


def test_swing_metrics_live_price_and_rs_source(monkeypatch):
    # get_rows returns EOD close + avg vol + adr + a fresh built_at; screener's
    # own rs_rank must be IGNORED (rs comes from the rs_ranking cache dict).
    import time as _t
    fresh = int(_t.time())
    monkeypatch.setattr(g.snapshot_db, "get_rows", lambda tks: {
        "RKLB": {"price": 20.0, "avg_volume_30d": 10_000_000, "adr_pct": 6.0,
                 "rs_rank": 5, "built_at": fresh},   # screener rs_rank 5 = trap, must be ignored
    })
    g._ROWS_CACHE.clear()
    rs = {"RKLB": {"rs_rank": 88, "returns": {"1m": 3.0}}}
    today = {"RKLB": 10.0}                            # +10% intraday
    m = g.swing_metrics(["RKLB"], rs, today)["RKLB"]
    assert m["price"] == 22.0                         # 20 * 1.10 live
    assert m["dollar_vol"] == 22.0 * 10_000_000       # live price * avg vol
    assert m["adr_pct"] == 6.0
    assert m["rs_rank"] == 88                          # from rs dict, NOT screener's 5


def test_swing_metrics_missing_row_and_stale(monkeypatch):
    import time as _t
    old = int(_t.time()) - int(g._STALE_SECS) - 100
    monkeypatch.setattr(g.snapshot_db, "get_rows", lambda tks: {
        "STALE": {"price": 9.0, "avg_volume_30d": 1e6, "adr_pct": 5.0, "built_at": old},
    })
    g._ROWS_CACHE.clear()
    out = g.swing_metrics(["STALE", "NOROW"], rs={}, today={})
    # stale row -> all price/vol/adr None (treated as missing)
    assert out["STALE"] == {"rs_rank": None, "dollar_vol": None, "adr_pct": None, "price": None}
    # no row at all -> same
    assert out["NOROW"] == {"rs_rank": None, "dollar_vol": None, "adr_pct": None, "price": None}


def test_swing_metrics_never_raises_on_getrows_error(monkeypatch):
    def boom(tks):
        raise RuntimeError("db locked")
    monkeypatch.setattr(g.snapshot_db, "get_rows", boom)
    g._ROWS_CACHE.clear()
    out = g.swing_metrics(["AAA"], rs={"AAA": {"rs_rank": 90}}, today={})
    assert out["AAA"]["price"] is None and out["AAA"]["rs_rank"] == 90
