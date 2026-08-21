from api.services.screener import candles


def bar(o, h, l, c):
    return {"o": o, "h": h, "l": l, "c": c, "v": 1000}


def test_close_cv_numeric_and_bool_agree():
    tight = [bar(100, 101, 99, 100.0 + (i % 2) * 0.5) for i in range(12)]
    out = candles.multi_candle(tight)
    assert out["close_cv_pct"] is not None
    assert out["tight_consolidation"] == (out["close_cv_pct"] < 2.5)
    loose = [bar(100, 130, 90, 100.0 + i * 3) for i in range(12)]
    out = candles.multi_candle(loose)
    assert out["tight_consolidation"] is False
    assert out["close_cv_pct"] > 2.5


def test_avg_body_pct_5():
    # body 0.2 of a 1.0 range on every bar
    bars = [bar(100.0, 100.6, 99.6, 100.2) for _ in range(10)]
    out = candles.multi_candle(bars)
    assert out["avg_body_pct_5"] == 0.2


def test_short_history_stays_none():
    out = candles.multi_candle([bar(100, 101, 99, 100) for _ in range(3)])
    assert out["close_cv_pct"] is None
