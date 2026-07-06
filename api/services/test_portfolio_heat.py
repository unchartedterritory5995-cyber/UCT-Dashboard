from api.services import portfolio_heat as ph


def _pos(sym, entry, stop, shares, side="long"):
    return {"symbol": sym, "entry_price": entry, "stop_price": stop, "shares": shares, "side": side}


def _fns(positions, regime="bull_trend", exposure=120, cap=10.0):
    return dict(
        positions_fn=lambda uid, aid: positions,
        regime_fn=lambda: {"regime": regime, "exposure_rating": exposure, "narration": "n"},
        cap_fn=lambda: cap,
        account_size=100000.0,
    )


def test_risk_heat_and_room():
    out = ph.portfolio_heat("u", **_fns([_pos("DECK", 105, 100, 100), _pos("NVDA", 130, 127, 100)]))
    assert out["ok"] is True
    assert out["risk_heat_pct"] == 0.8
    assert out["caps"]["aggregate_pct"] == 10.0
    assert out["room_to_add_pct"] == 9.2


def test_placeholder_stop_excluded_and_surfaced():
    out = ph.portfolio_heat("u", **_fns([_pos("DECK", 105, 100, 100), _pos("BRKR", 50, 50, 200)]))
    assert "BRKR" in out["placeholder_stops"]
    assert out["risk_heat_pct"] == 0.5
    br = next(p for p in out["per_position"] if p["symbol"] == "BRKR")
    assert br["placeholder_stop"] is True


def test_per_position_at_risk_fields():
    out = ph.portfolio_heat("u", **_fns([_pos("DECK", 105, 100, 100)]))
    p = out["per_position"][0]
    assert p["risk_pct"] == 0.5
    assert round(p["dist_to_stop_pct"], 1) == 4.8


def test_cap_failsoft_default_10():
    out = ph.portfolio_heat("u", **_fns([_pos("DECK", 105, 100, 100)], cap=None))
    assert out["caps"]["aggregate_pct"] == 10.0


def test_never_raises():
    def boom(*a, **k):
        raise RuntimeError("x")
    out = ph.portfolio_heat("u", positions_fn=boom, regime_fn=boom, cap_fn=boom, account_size=100000.0)
    assert out["ok"] in (True, False)


# ── Task 1b: by_sector concentration + brain cap ──────────────────────────────

def test_by_sector_concentration_flag(monkeypatch):
    monkeypatch.setattr(ph, "_sectors_for", lambda sym: {"Semiconductors"})
    out = ph.portfolio_heat("u", positions_fn=lambda uid, aid: [
        {"symbol": "NVDA", "entry_price": 130, "stop_price": 127, "shares": 100, "side": "long"},
        {"symbol": "AMD", "entry_price": 100, "stop_price": 97, "shares": 100, "side": "long"}],
        regime_fn=lambda: {"regime": "bull_trend", "exposure_rating": 120}, cap_fn=lambda: 10.0,
        account_size=100000.0)
    assert any(f["sector"] == "Semiconductors" for f in out["concentration_flags"])


def test_null_stop_is_placeholder_not_dropped():
    out = ph.portfolio_heat("u", **_fns([_pos("DECK", 105, 100, 100),
                                         {"symbol": "NUL", "entry_price": 50, "stop_price": None, "shares": 200}]))
    assert "NUL" in out["placeholder_stops"]          # surfaced, not dropped
    assert out["risk_heat_pct"] == 0.5                # only DECK counts
    assert any(p["symbol"] == "NUL" and p["placeholder_stop"] for p in out["per_position"])
