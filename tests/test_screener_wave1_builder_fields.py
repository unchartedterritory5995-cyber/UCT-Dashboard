def test_rs_fields_carries_period_returns():
    from api.services.screener.snapshot_builder import rs_fields
    out = rs_fields({"rs_rank": 91, "rs_score": 44.2,
                     "returns": {"1w": 2.0, "1m": 8.0, "3m": 30.5, "6m": 55.1}})
    assert out["chg_pct_3m"] == 30.5
    assert out["chg_pct_6m"] == 55.1
    assert rs_fields({"rs_rank": 50}).get("chg_pct_3m") is None


def test_dollar_vol_derivation():
    from api.services.screener import snapshot_builder
    bars = [{"o": 100, "h": 101, "l": 99, "c": 100, "v": 2_000_000}] * 40
    row = snapshot_builder.build_row("T", bars, None, None)
    assert row["dollar_vol_30d"] == row["price"] * row["avg_volume_30d"]
    row = snapshot_builder.build_row("T", [], None, None)
    assert row["dollar_vol_30d"] is None
