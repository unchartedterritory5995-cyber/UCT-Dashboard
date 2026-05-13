from api.services.pattern_engine.primitives.dcr import (
    compute_dcr, avg_dcr, dcr_signature, dcr_strength,
)


def _bar(c, h, l, o=None, v=1000):
    return {"t": 0, "o": o or c, "h": h, "l": l, "c": c, "v": v}


def test_compute_dcr_close_at_high():
    assert abs(compute_dcr(_bar(c=100, h=100, l=90)) - 1.0) < 0.01


def test_compute_dcr_close_at_low():
    assert abs(compute_dcr(_bar(c=90, h=100, l=90))) < 0.01


def test_compute_dcr_close_at_midpoint():
    assert abs(compute_dcr(_bar(c=95, h=100, l=90)) - 0.5) < 0.01


def test_compute_dcr_zero_range_returns_half():
    assert abs(compute_dcr(_bar(c=100, h=100, l=100)) - 0.5) < 0.01


def test_avg_dcr_all_strong_returns_high():
    bars = [_bar(c=100, h=100, l=90) for _ in range(10)]  # all close at high
    assert avg_dcr(bars) > 0.95


def test_avg_dcr_all_weak_returns_low():
    bars = [_bar(c=90, h=100, l=90) for _ in range(10)]  # all close at low
    assert avg_dcr(bars) < 0.05


def test_avg_dcr_handles_short_series():
    bars = [_bar(c=95, h=100, l=90) for _ in range(3)]
    assert 0.4 < avg_dcr(bars, lookback=10) < 0.6


def test_dcr_signature_accumulation():
    bars = [_bar(c=100, h=100, l=90) for _ in range(10)]
    assert dcr_signature(bars) == "accumulation"


def test_dcr_signature_distribution():
    bars = [_bar(c=90, h=100, l=90) for _ in range(10)]
    assert dcr_signature(bars) == "distribution"


def test_dcr_signature_neutral():
    bars = [_bar(c=95, h=100, l=90) for _ in range(10)]  # all mid-range
    assert dcr_signature(bars) == "neutral"


def test_dcr_strength_classification():
    assert dcr_strength(0.85) == "strong"
    assert dcr_strength(0.15) == "weak"
    assert dcr_strength(0.50) == "neutral"
