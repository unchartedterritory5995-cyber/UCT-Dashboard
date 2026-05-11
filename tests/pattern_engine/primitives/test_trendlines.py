from api.services.pattern_engine.primitives.trendlines import (
    fit_trendline, fit_pair_parallel,
)


def _pivot(t, price, ptype="high"):
    return {"t": t, "price": price, "type": ptype, "strength": 50, "bar_index": t}


def test_fit_trendline_horizontal():
    """Three pivots at same price → horizontal trendline (slope ~0)."""
    pivots = [_pivot(0, 100), _pivot(10, 100), _pivot(20, 100)]
    tl = fit_trendline(pivots)
    assert abs(tl["slope"]) < 0.01
    assert tl["touches"] >= 2
    assert tl["r_squared"] > 0.95
    assert tl["validity"] > 0.5


def test_fit_trendline_ascending():
    """Pivots on a perfect ascending line have slope > 0 and r² ~1."""
    pivots = [_pivot(0, 100), _pivot(10, 110), _pivot(20, 120), _pivot(30, 130)]
    tl = fit_trendline(pivots)
    assert tl["slope"] > 0.5
    assert tl["r_squared"] > 0.99


def test_fit_trendline_returns_low_validity_for_noisy_pivots():
    """Scattered pivots have low r²."""
    pivots = [_pivot(0, 100), _pivot(10, 150), _pivot(20, 80), _pivot(30, 130)]
    tl = fit_trendline(pivots)
    assert tl["validity"] < 0.7


def test_fit_trendline_raises_with_too_few_pivots():
    """Need at least 2 pivots to fit a line."""
    import pytest
    with pytest.raises(ValueError):
        fit_trendline([_pivot(0, 100)])


def test_fit_pair_parallel_returns_parallel_lines():
    """Upper pivots above lower pivots; both ascending at same rate."""
    upper = [_pivot(0, 110, "high"), _pivot(10, 120, "high"), _pivot(20, 130, "high")]
    lower = [_pivot(0, 100, "low"),  _pivot(10, 110, "low"),  _pivot(20, 120, "low")]
    upper_line, lower_line = fit_pair_parallel(upper, lower)
    # Should be very close in slope (within 0.05)
    assert abs(upper_line["slope"] - lower_line["slope"]) < 0.05


def test_fit_pair_parallel_handles_converging_pivots():
    """Pivots that converge (wedge) — both lines fit, slopes differ."""
    upper = [_pivot(0, 120, "high"), _pivot(10, 118, "high"), _pivot(20, 115, "high")]  # falling
    lower = [_pivot(0, 100, "low"),  _pivot(10, 105, "low"),  _pivot(20, 110, "low")]   # rising
    upper_line, lower_line = fit_pair_parallel(upper, lower)
    assert upper_line["slope"] < 0
    assert lower_line["slope"] > 0
