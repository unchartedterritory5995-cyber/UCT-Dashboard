from api.services import portfolio_heat as ph

def _camel_pos(sym, entry, stop, shares, side="long"):
    # The exact shape journal_two.positions._row_to_position returns.
    return {"symbol": sym, "side": side, "entryPrice": entry, "stopPrice": stop,
            "shares": shares, "entryEstimated": False, "brokerPrice": None}

def test_heat_reads_camelcase_positions():
    positions = [_camel_pos("NVDA", 100.0, 90.0, 100.0),   # risk = 100*10 = 1000
                 _camel_pos("AMD", 50.0, 45.0, 200.0)]      # risk = 200*5  = 1000
    out = ph.portfolio_heat("u1", "acct1", account_size=100_000.0,
                            positions_fn=lambda uid, aid: positions,
                            regime_fn=lambda: {"regime": "bull_trend", "exposure_rating": 100})
    # 2000 risk / 100k = 2.0% — NOT 0 (the bug returned 0 because every row was dropped)
    assert out["risk_heat_pct"] == 2.0
    assert len(out["per_position"]) == 2

def test_heat_surfaces_placeholder_stop_camelcase():
    positions = [_camel_pos("TSLA", 200.0, 200.0, 10.0)]   # stop==entry → placeholder
    out = ph.portfolio_heat("u1", "acct1", account_size=100_000.0,
                            positions_fn=lambda uid, aid: positions,
                            regime_fn=lambda: {"regime": "bull_trend", "exposure_rating": 100})
    assert out["placeholder_stops"] == ["TSLA"]
    assert out["risk_heat_pct"] == 0.0   # placeholder contributes no confident risk


def test_heat_is_dated_by_its_own_computation():
    """TERM-019: nothing in the heat is cached -- it is computed per request from the journal's
    rows as they stand -- so the computation instant is the as-of the panel header shows."""
    import datetime as _dt
    before = _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0)
    out = ph.portfolio_heat("u1", "acct1", account_size=100_000.0,
                            positions_fn=lambda uid, aid: [_camel_pos("NVDA", 100.0, 90.0, 10.0)],
                            regime_fn=lambda: {"regime": "bull_trend", "exposure_rating": 100},
                            cap_fn=lambda: 10.0)
    stamp = _dt.datetime.fromisoformat(out["as_of"])
    assert before <= stamp <= _dt.datetime.now(_dt.timezone.utc)
