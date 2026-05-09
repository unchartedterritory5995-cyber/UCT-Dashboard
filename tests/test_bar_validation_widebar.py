from api.services.bar_validation import validate_bar


def test_wide_bar_rejected():
    """A 35% range bar should fail the wide-bar gate."""
    bar = {"t": 1715080800, "o": 100.0, "h": 135.0, "l": 99.0, "c": 100.5, "v": 1000000}
    ok, reasons = validate_bar(bar)
    assert ok is False
    assert any("wide" in r.lower() or "range" in r.lower() for r in reasons)


def test_normal_volatility_bar_passes():
    """A 5% range bar is normal — must not fail wide-bar gate."""
    bar = {"t": 1715080800, "o": 100.0, "h": 102.5, "l": 97.5, "c": 101.0, "v": 1000000}
    ok, reasons = validate_bar(bar)
    assert ok is True


def test_wide_bar_gate_disabled_when_threshold_passed_zero():
    """Pass wide_bar_threshold=0 to disable the gate."""
    bar = {"t": 1715080800, "o": 100.0, "h": 135.0, "l": 99.0, "c": 100.5, "v": 1000000}
    ok, reasons = validate_bar(bar, wide_bar_threshold=0)
    assert ok is True
