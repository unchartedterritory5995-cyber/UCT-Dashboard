import math

from api.services.pattern_engine.primitives.shape import (
    rim_equality, roundness, symmetry,
)


def _bar(i, price):
    return {"t": 1_600_000_000 + i * 86400, "o": price, "h": price,
            "l": price, "c": price, "v": 1_000_000}


def _v_shape(depth=0.30, half=20):
    """Sharp V: straight down, straight up, a single touch at the bottom."""
    prices = [100.0 * (1 - depth * (i / half)) for i in range(half)]
    prices += [100.0 * (1 - depth * (1 - i / half)) for i in range(half + 1)]
    return [_bar(i, p) for i, p in enumerate(prices)]


def _u_shape(depth=0.30, half=20):
    """Rounded cup: a SEMICIRCLE, which is what a cup actually looks like.

    ⚠️ Deliberately not a cosine. Analytically, the mean depth of a raised
    cosine and of a linear V are BOTH exactly half the span, so a mean-depth
    roundness measure scores them identically — a fixture pair that cannot
    distinguish the thing under test. The semicircle spends real time near
    its low, which is the property "U-shaped, not V-shaped" is describing.
    """
    prices = []
    n = 2 * half
    for i in range(n + 1):
        x = (i - half) / half              # -1 .. +1
        prices.append(100.0 * (1 - depth * math.sqrt(max(0.0, 1 - x * x))))
    return [_bar(i, p) for i, p in enumerate(prices)]


def test_a_sharp_v_scores_low_roundness():
    assert roundness(_v_shape(), 0, 40) < 0.35


def test_a_rounded_u_scores_high_roundness():
    assert roundness(_u_shape(), 0, 40) > 0.65


def test_u_is_rounder_than_v_at_identical_depth_and_width():
    assert roundness(_u_shape(), 0, 40) > roundness(_v_shape(), 0, 40)


def test_roundness_refuses_a_window_too_short_to_have_a_shape():
    assert roundness(_u_shape(), 0, 3) is None


def test_roundness_refuses_a_flat_window_rather_than_dividing_by_zero():
    flat = [_bar(i, 50.0) for i in range(40)]
    assert roundness(flat, 0, 39) is None


def test_roundness_refuses_an_out_of_range_window():
    assert roundness(_u_shape(), 0, 999) is None
    assert roundness(_u_shape(), -5, 40) is None


def test_identical_rims_score_one():
    assert rim_equality(100.0, 100.0) == 1.0


def test_rim_equality_decays_with_the_gap():
    near = rim_equality(100.0, 102.0)
    far = rim_equality(100.0, 120.0)
    assert 0.0 < far < near < 1.0


def test_rim_equality_refuses_non_positive_prices():
    assert rim_equality(0.0, 100.0) is None
    assert rim_equality(100.0, -3.0) is None


def test_rim_equality_is_symmetric_in_its_arguments():
    assert rim_equality(100.0, 112.0) == rim_equality(112.0, 100.0)


def test_a_centred_low_is_perfectly_symmetric():
    assert symmetry(_u_shape(), 0, 20, 40) == 1.0


def test_an_off_centre_low_scores_below_one():
    assert symmetry(_u_shape(), 0, 5, 40) < 0.6


def test_symmetry_refuses_an_out_of_order_window():
    assert symmetry(_u_shape(), 0, 40, 20) is None
    assert symmetry(_u_shape(), 20, 20, 40) is None


def test_every_refusal_is_none_and_never_a_default():
    """0.0 means 'measured, and it is a V'. None means 'not measurable'.
    Collapsing the two is the honest-None rule running backwards.
    """
    assert roundness([], 0, 40) is None
    assert rim_equality(None, 100.0) is None
    assert symmetry(_u_shape(), 0, 0, 40) is None
