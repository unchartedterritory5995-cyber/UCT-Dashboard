from api.services.pattern_engine.primitives.pivots import detect_pivots


def _bar(t, o, h, l, c, v=1000):
    return {"t": t, "o": o, "h": h, "l": l, "c": c, "v": v}


def test_no_pivots_in_monotonic_uptrend():
    """A pure uptrend has no swing highs (every bar is higher than both neighbors)
    nor swing lows. detect_pivots returns []."""
    bars = [_bar(i, 100 + i, 101 + i, 99 + i, 100 + i) for i in range(30)]
    pivots = detect_pivots(bars, window=3)
    assert pivots == []


def test_detects_single_swing_high():
    """A bar that strictly dominates its window on the high side is a swing high."""
    # 5 bars rising to a peak, then falling. Peak is bar 4.
    highs = [100, 102, 104, 106, 110, 108, 104, 102, 100, 99]
    bars = [_bar(i, h - 1, h, h - 2, h - 1) for i, h in enumerate(highs)]
    pivots = detect_pivots(bars, window=3)
    assert len(pivots) >= 1
    swing_high = next((p for p in pivots if p["type"] == "high"), None)
    assert swing_high is not None
    assert swing_high["bar_index"] == 4
    assert swing_high["price"] == 110


def test_detects_swing_high_and_low():
    """V-then-inverted-V should produce one low and one high."""
    pattern_highs = [105, 103, 101, 99, 100, 102, 104, 106, 108, 110, 108, 106, 104, 102, 100]
    pattern_lows  = [h - 2 for h in pattern_highs]
    bars = [_bar(i, pattern_highs[i] - 1, pattern_highs[i], pattern_lows[i], pattern_highs[i] - 1)
            for i in range(len(pattern_highs))]
    pivots = detect_pivots(bars, window=3)
    highs = [p for p in pivots if p["type"] == "high"]
    lows  = [p for p in pivots if p["type"] == "low"]
    assert len(highs) >= 1
    assert len(lows) >= 1


def test_strength_increases_with_dominance():
    """A pivot that dominates 5 bars on each side is stronger than one that only
    dominates 3. With window=5, the wider dominance gets a higher strength."""
    # peak with 5-bar dominance both sides
    highs = [100, 101, 102, 103, 104, 110, 104, 103, 102, 101, 100]
    bars = [_bar(i, h - 1, h, h - 2, h - 1) for i, h in enumerate(highs)]
    pivots5 = detect_pivots(bars, window=5)
    pivots3 = detect_pivots(bars, window=3)
    peak5 = next((p for p in pivots5 if p["type"] == "high"), None)
    peak3 = next((p for p in pivots3 if p["type"] == "high"), None)
    assert peak5 is not None and peak3 is not None
    # 5-window pivot demands more dominance, so its strength should be ≥ 3-window.
    assert peak5["strength"] >= peak3["strength"]


def test_returns_empty_for_short_bars():
    """If bars are shorter than 2*window+1, no pivots can be detected."""
    bars = [_bar(i, 100, 101, 99, 100) for i in range(4)]
    pivots = detect_pivots(bars, window=3)
    assert pivots == []


def test_pivots_sorted_by_bar_index():
    """Output should be sorted ascending by bar_index for deterministic downstream use."""
    highs = [100, 105, 100, 95, 100, 105, 100, 95, 100, 105, 100]
    bars = [_bar(i, h - 1, h, h - 2, h - 1) for i, h in enumerate(highs)]
    pivots = detect_pivots(bars, window=2)
    indices = [p["bar_index"] for p in pivots]
    assert indices == sorted(indices)
