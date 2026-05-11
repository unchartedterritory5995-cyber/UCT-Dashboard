from api.services.pattern_engine.primitives.volume import (
    volume_signature, contraction_score, accumulation_distribution,
)


def _bar(t, c, v, o=None):
    o = o if o is not None else c
    return {"t": t, "o": o, "h": c + 1, "l": c - 1, "c": c, "v": v}


def test_signature_contracting_when_recent_volume_lower():
    # First 20 bars high volume, last 10 bars dropping volume.
    bars = [_bar(i, 100, 10000) for i in range(20)] + [_bar(i + 20, 100, 3000) for i in range(10)]
    assert volume_signature(bars, lookback=10) == "contracting"


def test_signature_expanding_when_recent_volume_higher():
    bars = [_bar(i, 100, 3000) for i in range(20)] + [_bar(i + 20, 100, 10000) for i in range(10)]
    assert volume_signature(bars, lookback=10) == "expanding"


def test_signature_neutral_when_flat():
    bars = [_bar(i, 100, 5000) for i in range(30)]
    assert volume_signature(bars, lookback=10) == "neutral"


def test_contraction_score_higher_for_tighter_recent_volume():
    """A series where volume tightens at the end has a higher contraction score
    than one where volume is uniform."""
    tightening = [_bar(i, 100, 10000) for i in range(10)] + [_bar(i + 10, 100, 3000) for i in range(10)]
    uniform    = [_bar(i, 100, 6500) for i in range(20)]
    assert contraction_score(tightening, window=10) > contraction_score(uniform, window=10)


def test_contraction_score_zero_to_one_range():
    bars = [_bar(i, 100, 5000) for i in range(20)]
    score = contraction_score(bars, window=10)
    assert 0.0 <= score <= 1.0


def test_accumulation_distribution_positive_on_up_days_high_volume():
    """Up days (close > open) with rising volume → positive A/D."""
    bars = []
    price = 100
    for i in range(10):
        price += 1
        bars.append(_bar(i, price, 5000 + i * 100, o=price - 1))
    score = accumulation_distribution(bars, lookback=10)
    assert score > 0


def test_accumulation_distribution_negative_on_down_days():
    bars = []
    price = 110
    for i in range(10):
        price -= 1
        bars.append(_bar(i, price, 5000 + i * 100, o=price + 1))
    score = accumulation_distribution(bars, lookback=10)
    assert score < 0


def test_signature_returns_neutral_for_short_series():
    bars = [_bar(i, 100, 1000) for i in range(5)]
    assert volume_signature(bars, lookback=10) == "neutral"
