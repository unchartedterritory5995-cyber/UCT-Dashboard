"""Battery test for the golden_cross detector. Runs every fixture in
tests/fixtures/golden_cross/ and asserts the expected outcome.

Mirrors the structure of test_hammer.py.
"""
import pytest

from api.services.pattern_engine.detectors.classical.golden_cross import (
    detect_golden_cross,
    _EPS,
    _sma,
)
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


FIXTURES = load_all_fixtures("golden_cross", include_internal=False)


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f.name)
def test_golden_cross_fixture(fixture):
    ctx = (
        fixture.context
        if fixture.context is not None
        else build_context(fixture.bars, sym="TEST")
    )
    detections = detect_golden_cross(fixture.bars, ctx)

    if fixture.expected_fires:
        assert len(detections) >= 1, (
            f"Fixture {fixture.name!r} expected to fire but produced 0 detections."
        )
        d = max(detections, key=lambda x: x["confidence"])
        assert fixture.min_confidence <= d["confidence"] <= fixture.max_confidence, (
            f"Fixture {fixture.name!r}: confidence {d['confidence']:.1f} not in "
            f"expected band [{fixture.min_confidence}, {fixture.max_confidence}]"
        )
        if fixture.expected_geometry_shape:
            assert d["geometry"]["shape"] == fixture.expected_geometry_shape
    else:
        assert len(detections) == 0, (
            f"Fixture {fixture.name!r} expected NOT to fire, but got "
            f"{len(detections)} detection(s)."
        )


def test_fixture_battery_has_minimum_coverage():
    fixtures = load_all_fixtures("golden_cross", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    neg = [f for f in fixtures if f.category == "negative"]
    edge = [f for f in fixtures if f.category == "edge"]
    assert len(pos) >= 5, f"need >=5 positive fixtures, have {len(pos)}"
    assert len(neg) >= 8, f"need >=8 negative fixtures, have {len(neg)}"
    assert len(edge) >= 3, f"need >=3 edge fixtures, have {len(edge)}"


def test_narrative_richness():
    """Each body field must be >=700 chars; headline >=90 chars."""
    fixtures = load_all_fixtures("golden_cross", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos, "no positive fixtures found"
    fixture = pos[0]
    ctx = (
        fixture.context
        if fixture.context is not None
        else build_context(fixture.bars, sym="TEST")
    )
    detections = detect_golden_cross(fixture.bars, ctx)
    assert detections, f"positive fixture {fixture.name!r} did not fire"
    d = detections[0]
    narrative = d["narrative"]
    assert len(narrative["headline"]) >= 90, (
        f"headline too short ({len(narrative['headline'])} chars): "
        f"{narrative['headline']!r}"
    )
    for field in ("what_it_is", "why_it_matters", "what_to_watch_for", "failure_signal"):
        text = narrative[field]
        assert len(text) >= 700, (
            f"narrative.{field} too short ({len(text)} chars): {text[:120]!r}..."
        )


def test_geometry_extras_richness():
    """Geometry extras must contain the expected keys from the docstring."""
    fixtures = load_all_fixtures("golden_cross", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos, "no positive fixtures found"
    fixture = pos[0]
    ctx = (
        fixture.context
        if fixture.context is not None
        else build_context(fixture.bars, sym="TEST")
    )
    detections = detect_golden_cross(fixture.bars, ctx)
    assert detections, f"positive fixture {fixture.name!r} did not fire"
    d = detections[0]
    extras = d["geometry"]["extras"]
    required_keys = (
        "ma50_current",
        "ma200_current",
        "ma200_slope_20bars",
        "days_since_cross",
        "volume_ratio",
        "high_52w",
        "atr14",
    )
    for key in required_keys:
        assert key in extras, f"missing geometry.extras.{key}"
    assert extras["ma50_current"] > extras["ma200_current"], (
        "ma50_current must be above ma200_current in a golden cross"
    )
    assert extras["days_since_cross"] <= 4, (
        f"days_since_cross={extras['days_since_cross']} should be <=4 for a fresh cross "
        f"(gc_clean_fresh_cross uses cross_age=2 → age=1 from last bar)"
    )
    assert d["direction"] == "bullish"
    assert d["category"] == "classical"


def test_levels_are_bullish_setup():
    """Levels must satisfy: entry > close, stop < entry, target > entry."""
    fixtures = load_all_fixtures("golden_cross", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos, "no positive fixtures found"
    fixture = pos[0]
    ctx = (
        fixture.context
        if fixture.context is not None
        else build_context(fixture.bars, sym="TEST")
    )
    detections = detect_golden_cross(fixture.bars, ctx)
    assert detections, f"positive fixture {fixture.name!r} did not fire"
    d = detections[0]
    levels = d["levels"]
    last_close = fixture.bars[-1]["c"]
    # Entry is above current close (with a small buffer)
    assert levels["entry"] > last_close * 0.999, (
        f"entry {levels['entry']} should be above close {last_close}"
    )
    # Stop is below entry (stop = ma50 - ATR, a structural stop)
    assert levels["stop"] < levels["entry"], (
        f"stop {levels['stop']} should be below entry {levels['entry']}"
    )
    # Target is above entry (52w high or 20% from entry)
    assert levels["target_primary"] > levels["entry"], (
        f"target {levels['target_primary']} should be above entry {levels['entry']}"
    )


# ---------------------------------------------------------------------------
# Slope-gate _EPS unit tests
#
# _EPS = 1e-9 is a defensive epsilon in the gate `ma200_slope >= -0.005 - _EPS`.
# It is NOT load-bearing for current inputs — the SMA arithmetic on the
# synthetic boundary series produces slope = -0.004999...9e-17 > -0.005,
# which already passes the plain `>= -0.005` check.  _EPS is belt-and-
# suspenders against float residue on non-integer series / future refactors.
#
# Concretely: with target_slope=-0.005 and all-integer prices:
#   p_cross   = 8346.0                     (exact integer)
#   ma200[250]= 26666/200 = 133.33         (not exactly representable)
#   ma200[230]= 134.0                      (exact)
#   actual_slope = -0.004999...9e-17       (slightly ABOVE -0.005 in IEEE 754)
# => plain `>= -0.005` is True; `>= -0.005 - _EPS` also True — both paths pass.
#
# The fixtures gc_slope_gate_boundary_fail (negative, slope=-0.52%) and
# gc_edge_slope_gate_boundary_pass (edge, slope=-0.50%) validly exercise the
# gate rejecting clearly-too-negative slopes and accepting the boundary value;
# they do NOT specifically prove _EPS is load-bearing.
#
# test_slope_gate_boundary_pass_with_eps below runs the full detector on the
# boundary series and explicitly documents the honest slope arithmetic.
# test_eps_is_defensive documents the two-inequality proof of the defensive
# nature of _EPS (slope strictly above -0.005 in IEEE 754 arithmetic).
# test_slope_gate_boundary_fail_without_cross verifies the rejection side.
# ---------------------------------------------------------------------------


def _build_slope_boundary_bars(target_slope: float) -> list:
    """Construct a 252-bar synthetic series producing the given 200SMA slope.

    Uses the same engineered-series math as _slope_gate_boundary_fail /
    _slope_gate_boundary_pass in _generate.py (see module docstring there for
    the full derivation).

    Series layout (0-based indices):
      bars   0..30  : P_LOW=50.0      (31 bars, low-price prefix)
      bars  31..50  : P_HIGH_OLD=500  (20 bars, 'oldest_20' slope reference)
      bars  51..200 : P_MID=100.0     (150 bars)
      bars 201..230 : P_LOW_2=60.0    (30 bars, keeps ma50 < ma200 before cross)
      bars 231..249 : P_SW=80.0       (19 slope-window intermediate bars)
      bar  250      : P_CROSS         (cross bar, elevated volume; last sw bar)
      bar  251      : P_CROSS+0.5     (1 trailing bar)

    The cross transition happens at bar 250 (age=1 from last bar).
    Slope = (ma200[250] - ma200[230]) / ma200[230] = target_slope exactly.
    """
    T0, DT, BV = 1700000000, 86400, 200000.0

    def _bar(t, o, h, l, c, v=200000.0):
        return dict(t=int(t), o=float(o), h=float(h), l=float(l),
                    c=float(c), v=float(v))

    P_LOW, P_HIGH_OLD = 50.0, 500.0
    P_MID, P_LOW_2, P_SW = 100.0, 60.0, 80.0

    # ma200[230] = (20*P_HIGH_OLD + 150*P_MID + 30*P_LOW_2) / 200 = 134.0
    ma200_ss = (20 * P_HIGH_OLD + 150 * P_MID + 30 * P_LOW_2) / 200
    sum_oldest = 20 * P_HIGH_OLD   # = 10000.0
    sum_newest = sum_oldest + target_slope * 200 * ma200_ss
    p_cross = sum_newest - 19 * P_SW   # solve for the cross bar price

    bars, t = [], T0
    for c in [P_LOW] * 31 + [P_HIGH_OLD] * 20 + [P_MID] * 150 + [P_LOW_2] * 30 + [P_SW] * 19:
        s = max(c * 0.003, 0.01)
        bars.append(_bar(t, c - s * 0.4, c + s * 0.6, c - s * 0.6, c + s * 0.4, BV))
        t += DT
    # Cross bar (bar 250): elevated volume
    c = p_cross; s = max(c * 0.003, 0.01)
    bars.append(_bar(t, c - s * 0.4, c + s * 0.6, c - s * 0.6, c + s * 0.4, BV * 1.5))
    t += DT
    # Trailing bar (bar 251)
    c = p_cross + 0.5; s = max(c * 0.003, 0.01)
    bars.append(_bar(t, c - s * 0.4, c + s * 0.6, c - s * 0.6, c + s * 0.4, BV))
    return bars


_GOOD_CTX = {
    "trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
    "volume_signature": "expanding", "regime": "bullish",
    "dcr_signature": "accumulation", "recent_dcr_avg": 0.72,
    "nearest_resistance": None, "nearest_support": None,
    "days_to_earnings": None, "sector_strength_rank": 2,
}


def test_slope_gate_boundary_pass_with_eps():
    """200SMA slope ≈ -0.005 FIRES — boundary series passes the slope gate.

    The synthetic boundary series (target_slope=-0.005) produces integer prices
    (p_cross=8346.0), which means the IEEE 754 division yields a slope slightly
    ABOVE -0.005 (≈ -0.004999...9e-17).  The detector fires regardless of _EPS;
    this test verifies the boundary case fires and documents the honest arithmetic.
    """
    bars = _build_slope_boundary_bars(target_slope=-0.005)
    detections = detect_golden_cross(bars, _GOOD_CTX)

    # Compute the actual slope the detector sees
    n = len(bars)
    cross_idx = n - 2  # cross bar is second-to-last (1 trailing bar)
    ss = max(0, cross_idx - 20)
    ma200_cross = _sma(bars, cross_idx, 200)
    ma200_ss = _sma(bars, ss, 200)
    actual_slope = (ma200_cross - ma200_ss) / ma200_ss

    # Slope should be very close to -0.005
    assert abs(actual_slope - (-0.005)) < 1e-6, (
        f"Expected slope ≈ -0.005, got {actual_slope!r}"
    )
    # Both the plain gate and the _EPS-guarded gate pass — _EPS is not needed here
    assert actual_slope >= -0.005, (
        f"Plain gate (>= -0.005) should pass for this all-integer series; "
        f"got slope={actual_slope!r}"
    )
    assert actual_slope >= -0.005 - _EPS, (
        f"EPS-guarded gate (>= -0.005 - {_EPS}) should also pass; "
        f"got slope={actual_slope!r}"
    )
    assert len(detections) >= 1, (
        f"Boundary slope {actual_slope!r} should fire; got 0 detections."
    )


def test_eps_is_defensive():
    """_EPS is defensive: the boundary series slope already passes the plain gate.

    This is the honest proof of _EPS's nature:
      - actual_slope > -0.005  (plain gate passes — _EPS not needed)
      - actual_slope >= -0.005 - _EPS  (EPS-guarded gate also passes — trivially)

    The SMA formula on all-integer prices in the boundary series produces a slope
    that is strictly above -0.005 in IEEE 754 arithmetic (not below it), so _EPS
    adds no rescue here.  _EPS remains as belt-and-suspenders for non-integer price
    series or future threshold changes.
    """
    bars = _build_slope_boundary_bars(target_slope=-0.005)
    n = len(bars)
    cross_idx = n - 2
    ss = max(0, cross_idx - 20)
    ma200_cross = _sma(bars, cross_idx, 200)
    ma200_ss = _sma(bars, ss, 200)
    actual_slope = (ma200_cross - ma200_ss) / ma200_ss

    # The slope is strictly ABOVE -0.005 — plain gate already passes, _EPS not needed
    assert actual_slope > -0.005, (
        f"Expected slope > -0.005 (so _EPS is defensive, not load-bearing); "
        f"got {actual_slope!r}"
    )
    # Trivially, the EPS-guarded gate also passes
    assert actual_slope >= -0.005 - _EPS, (
        f"EPS-guarded gate must also pass; got {actual_slope!r}"
    )


def test_slope_gate_boundary_fail_without_cross():
    """200SMA slope = -0.0052 does NOT fire (just outside gate boundary).

    Pairs with test_slope_gate_boundary_pass_with_eps to confirm that the
    boundary is strict: -0.005 passes, -0.0052 does not.
    Every other golden-cross condition is satisfied in this series
    (cross found within 5 bars, ma50_rising, volume >= 0.5x);
    only the slope gate rejects the detection.
    """
    bars = _build_slope_boundary_bars(target_slope=-0.0052)
    detections = detect_golden_cross(bars, _GOOD_CTX)
    assert len(detections) == 0, (
        f"Slope -0.0052 is outside the -0.005 gate — detector must NOT fire. "
        f"Got {len(detections)} detection(s) with confidence "
        f"{[d['confidence'] for d in detections]}."
    )
