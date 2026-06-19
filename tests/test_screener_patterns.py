from api.services.screener import patterns


def _s(closes):
    return [{"o": c, "h": c * 1.01, "l": c * 0.99, "c": c, "v": 1_000_000}
            for c in closes]


def test_breakout_52w_flagged():
    bars = _s([float(i) for i in range(1, 260)])  # new high today
    keys, conf = patterns.detect_patterns(bars)
    assert "breakout_52w" in keys
    assert 0 <= conf <= 1


def test_golden_cross_flagged():
    # 200 flat then a single up-tick: sma50 crosses sma200 on the last bar
    bars = _s([100.0] * 200 + [101.0])
    keys, _ = patterns.detect_patterns(bars)
    assert "golden_cross" in keys


def test_empty_bars_safe():
    assert patterns.detect_patterns([]) == ("", 0.0)
    assert patterns.detect_patterns(_s([1, 2, 3])) == ("", 0.0)
