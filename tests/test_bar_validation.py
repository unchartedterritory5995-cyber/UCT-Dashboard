from api.services.bar_validation import validate_bar


def test_valid_bar_passes():
    bar = {"t": 1715080800, "o": 700.0, "h": 705.0, "l": 698.0, "c": 702.5, "v": 1500000}
    ok, reasons = validate_bar(bar)
    assert ok is True
    assert reasons == []


def test_high_below_low_fails():
    bar = {"t": 1715080800, "o": 700.0, "h": 698.0, "l": 705.0, "c": 702.5, "v": 1500000}
    ok, reasons = validate_bar(bar)
    assert ok is False
    assert any("H<L" in r or "h<l" in r.lower() for r in reasons)


def test_high_below_open_fails():
    bar = {"t": 1715080800, "o": 705.0, "h": 700.0, "l": 695.0, "c": 698.0, "v": 1500000}
    ok, reasons = validate_bar(bar)
    assert ok is False
    assert any("h<o" in r.lower() or "high<open" in r.lower() for r in reasons)


def test_negative_volume_fails():
    bar = {"t": 1715080800, "o": 700.0, "h": 705.0, "l": 698.0, "c": 702.5, "v": -1}
    ok, reasons = validate_bar(bar)
    assert ok is False
    assert any("volume" in r.lower() for r in reasons)


def test_zero_price_fails():
    bar = {"t": 1715080800, "o": 0.0, "h": 0.0, "l": 0.0, "c": 0.0, "v": 0}
    ok, reasons = validate_bar(bar)
    assert ok is False
    assert any("price" in r.lower() or "zero" in r.lower() for r in reasons)


def test_qqq_6_55_phantom_rejected():
    """The actual bug: QQQ 30min showing 6.55 OHLC when prior close was ~$694."""
    bar = {"t": 1715080800, "o": 6.55, "h": 6.55, "l": 6.55, "c": 6.55, "v": 56}
    ok, reasons = validate_bar(bar, prior_close=694.0)
    assert ok is False
    assert any("deviation" in r.lower() or "prior" in r.lower() for r in reasons)


def test_normal_move_passes():
    """+2% move from prior close is fine."""
    bar = {"t": 1715080800, "o": 700.0, "h": 705.0, "l": 698.0, "c": 702.5, "v": 1500000}
    ok, reasons = validate_bar(bar, prior_close=694.0)
    assert ok is True


def test_split_adjusted_close_passes():
    """50% drop with no split context is rejected, but if the bar IS at split-adjusted price within 5%, accept."""
    # NVDA 10:1 split — prior close 1000, new opens at 100 (exactly split-adjusted)
    bar = {"t": 1715080800, "o": 100.0, "h": 102.0, "l": 99.5, "c": 101.0, "v": 50000000}
    ok, reasons = validate_bar(bar, prior_close=1000.0, split_ratios=[10.0])
    assert ok is True


def test_low_volume_with_big_move_rejected():
    """Implausibly low volume + big price move = bad data."""
    # The QQQ 6.55 had V=56 with implied 99% move
    bar = {"t": 1715080800, "o": 6.55, "h": 6.55, "l": 6.55, "c": 6.55, "v": 56}
    ok, reasons = validate_bar(bar, prior_close=694.0)
    assert ok is False
    assert any("volume" in r.lower() for r in reasons)


from api.services.bar_validation import validate_series


def _bar(t, o=100, h=101, l=99, c=100.5, v=10000):
    return {"t": t, "o": o, "h": h, "l": l, "c": c, "v": v}


def test_monotonic_time_ok():
    bars = [_bar(1000), _bar(2000), _bar(3000)]
    issues = validate_series(bars, tf="5")
    assert issues == []


def test_duplicate_timestamps_flagged():
    bars = [_bar(1000), _bar(2000), _bar(2000), _bar(3000)]
    issues = validate_series(bars, tf="5")
    assert any("duplicate" in i["reason"].lower() for i in issues)


def test_out_of_order_timestamps_flagged():
    bars = [_bar(1000), _bar(3000), _bar(2000)]
    issues = validate_series(bars, tf="5")
    assert any("order" in i["reason"].lower() for i in issues)


def test_intraday_gap_during_rth_flagged():
    """5-min bars with a 30-min gap during RTH should flag."""
    # 9:35 ET = 1715085300, 10:05 ET = 1715087100 (30 min gap, expected 5 min for tf=5)
    bars = [_bar(1715085300), _bar(1715087100)]
    issues = validate_series(bars, tf="5")
    assert any("gap" in i["reason"].lower() for i in issues)
