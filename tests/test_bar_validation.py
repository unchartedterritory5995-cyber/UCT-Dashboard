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
