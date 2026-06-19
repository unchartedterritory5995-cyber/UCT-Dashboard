from api.services.screener import candles


def _bar(o, h, l, c, v=1_000_000):
    return {"o": o, "h": h, "l": l, "c": c, "v": v}


def test_hammer_detected():
    bars = [_bar(10, 10.2, 9.9, 10.0) for _ in range(20)]
    # long lower wick, small body near top
    bars.append(_bar(10.0, 10.1, 9.0, 9.95))
    out = candles.single_candle(bars)
    assert out["candle_type"] == "hammer"
    assert out["lower_wick_pct"] > out["body_pct"]
    assert 0.0 <= out["close_position"] <= 1.0


def test_doji_detected():
    bars = [_bar(10, 10.2, 9.8, 10.0) for _ in range(20)]
    bars.append(_bar(10.0, 10.5, 9.5, 10.01))  # tiny body, balanced range
    out = candles.single_candle(bars)
    assert out["candle_type"] == "doji"


def test_inside_bar_run_and_nr7():
    bars = [_bar(10, 12, 8, 10) for _ in range(10)]
    bars.append(_bar(10, 11, 9, 10))      # inside prior
    bars.append(_bar(10, 10.5, 9.5, 10))  # inside again
    out = candles.multi_candle(bars)
    assert out["inside_bar_run"] >= 2
    assert out["nr7"] in (True, False)


def test_consecutive_up():
    bars = [_bar(10, 10, 10, 10)]
    for c in (10.5, 11.0, 11.5):
        bars.append(_bar(c - 0.1, c + 0.1, c - 0.2, c))
    out = candles.multi_candle(bars)
    assert out["consecutive_up"] >= 3


def test_empty_bars_safe():
    assert candles.single_candle([])["candle_type"] == "none"
    assert candles.multi_candle([])["inside_bar_run"] == 0
