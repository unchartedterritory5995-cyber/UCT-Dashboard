from api.services.screener import technicals


def _series(closes):
    return [{"o": c, "h": c * 1.01, "l": c * 0.99, "c": c, "v": 1_000_000}
            for c in closes]


def test_uptrend_above_mas_and_stack():
    bars = _series([float(i) for i in range(1, 260)])  # steadily rising
    out = technicals.compute_technicals(bars)
    assert out["above_50sma"] is True
    assert out["pct_vs_sma50"] > 0
    assert out["ma_stack"] == "full-bull"
    assert out["new_52w_high"] is True
    assert out["rsi14"] > 60


def test_change_pcts():
    bars = _series([100.0] * 25 + [110.0])
    out = technicals.compute_technicals(bars)
    assert round(out["chg_pct_1d"], 1) == 10.0
    assert out["price"] == 110.0


def test_empty_bars_safe():
    out = technicals.compute_technicals([])
    assert out["price"] is None
    assert out["new_52w_high"] is False
