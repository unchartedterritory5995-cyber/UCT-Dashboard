"""Battery test for the death_cross detector. Runs every fixture in
tests/fixtures/death_cross/ and asserts the expected outcome.

Mirrors the structure of test_golden_cross.py (and test_hammer.py).
"""
import pytest

from api.services.pattern_engine.detectors.classical.death_cross import (
    detect_death_cross,
    _EPS,
    _sma,
)
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


FIXTURES = load_all_fixtures("death_cross", include_internal=False)


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f.name)
def test_death_cross_fixture(fixture):
    ctx = (
        fixture.context
        if fixture.context is not None
        else build_context(fixture.bars, sym="TEST")
    )
    detections = detect_death_cross(fixture.bars, ctx)

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
    fixtures = load_all_fixtures("death_cross", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    neg = [f for f in fixtures if f.category == "negative"]
    edge = [f for f in fixtures if f.category == "edge"]
    assert len(pos) >= 5, f"need >=5 positive fixtures, have {len(pos)}"
    assert len(neg) >= 8, f"need >=8 negative fixtures, have {len(neg)}"
    assert len(edge) >= 3, f"need >=3 edge fixtures, have {len(edge)}"


def test_narrative_richness():
    """Each body field must be >=700 chars; headline >=90 chars."""
    fixtures = load_all_fixtures("death_cross", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos, "no positive fixtures found"
    fixture = pos[0]
    ctx = (
        fixture.context
        if fixture.context is not None
        else build_context(fixture.bars, sym="TEST")
    )
    detections = detect_death_cross(fixture.bars, ctx)
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
    fixtures = load_all_fixtures("death_cross", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos, "no positive fixtures found"
    fixture = pos[0]
    ctx = (
        fixture.context
        if fixture.context is not None
        else build_context(fixture.bars, sym="TEST")
    )
    detections = detect_death_cross(fixture.bars, ctx)
    assert detections, f"positive fixture {fixture.name!r} did not fire"
    d = detections[0]
    extras = d["geometry"]["extras"]
    required_keys = (
        "ma50_current",
        "ma200_current",
        "ma200_slope_20bars",
        "days_since_cross",
        "volume_ratio",
        "low_52w",
        "atr14",
    )
    for key in required_keys:
        assert key in extras, f"missing geometry.extras.{key}"
    # In a death cross ma50 must be below ma200
    assert extras["ma50_current"] < extras["ma200_current"], (
        "ma50_current must be below ma200_current in a death cross"
    )
    assert extras["days_since_cross"] <= 4, (
        f"days_since_cross={extras['days_since_cross']} should be <=4 for a fresh cross "
        f"(dc_clean_fresh_cross uses cross_age=2 → age=1 from last bar)"
    )
    assert d["direction"] == "bearish"
    assert d["category"] == "classical"


def test_levels_are_bearish_setup():
    """Levels must satisfy: entry < cross-bar close (approx), stop > entry, target < entry."""
    fixtures = load_all_fixtures("death_cross", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos, "no positive fixtures found"
    fixture = pos[0]
    ctx = (
        fixture.context
        if fixture.context is not None
        else build_context(fixture.bars, sym="TEST")
    )
    detections = detect_death_cross(fixture.bars, ctx)
    assert detections, f"positive fixture {fixture.name!r} did not fire"
    d = detections[0]
    levels = d["levels"]
    last_close = fixture.bars[-1]["c"]
    # Entry is slightly below current close (short entry = close * 0.999)
    assert levels["entry"] < last_close * 1.001, (
        f"entry {levels['entry']} should be at or below close {last_close}"
    )
    # Stop is above entry (stop = ma50 + ATR, structural cover level)
    assert levels["stop"] > levels["entry"], (
        f"stop {levels['stop']} should be above entry {levels['entry']}"
    )
    # Target is below entry (bearish setup — 52w low or entry*0.80)
    assert levels["target_primary"] < levels["entry"], (
        f"target {levels['target_primary']} should be below entry {levels['entry']}"
    )


# ---------------------------------------------------------------------------
# Slope-gate _EPS unit tests — TRUE BOUNDARY COVERAGE
#
# _EPS = 1e-9 is a DEFENSIVE epsilon in the gate `ma200_slope <= 0.005 + _EPS`.
# It is NOT load-bearing for current inputs.
#
# The two boundary fixtures (dc_edge_slope_gate_boundary_pass / _fail) are built
# by _build_slope_boundary_series() in _generate.py using the exclusive-zone
# technique: bars[cross_idx-219..cross_idx-200] are modified to land ma200_slope
# at exactly the requested target without disturbing the cross detection or
# ma50_declining gate.
#
# Verified arithmetic (rounded 4-dp prices, IEEE 754 float64):
#   dc_edge_slope_gate_boundary_pass  (target=+0.004999):
#     actual_slope ≈ +0.004998978  |actual - 0.005| ≈ 1e-6
#     plain gate  (<= +0.005)      → True  (_EPS not needed here)
#     EPS gate    (<= +0.005+1e-9) → True  (trivially)
#     → _EPS is DEFENSIVE, not load-bearing
#
#   dc_edge_slope_gate_boundary_fail  (target=+0.005001):
#     actual_slope ≈ +0.005001028  |actual - 0.005| ≈ 1e-6
#     plain gate  (<= +0.005)      → False (gate correctly rejects)
#     EPS gate    (<= +0.005+1e-9) → False (gate also rejects)
#
# The arithmetic granularity (~1e-6) is far larger than _EPS=1e-9; the plain gate
# already handles both cases correctly. _EPS is belt-and-suspenders for non-integer
# series on other hardware or future threshold changes.
# ---------------------------------------------------------------------------


def _load_fixture_bars(fixture_name: str) -> list:
    """Load bars from a named death_cross JSON fixture file."""
    import json, os
    path = os.path.join(
        os.path.dirname(__file__), "..", "..", "fixtures", "death_cross",
        f"{fixture_name}.json"
    )
    with open(path) as f:
        return json.load(f)["bars"]


def _find_cross_idx(bars: list) -> int:
    """Locate the death-cross bar index by scanning backwards from last bar."""
    n = len(bars)
    last_idx = n - 1
    for i in range(last_idx, max(last_idx - 5, 199), -1):
        ma50_i = _sma(bars, i, 50)
        ma50_prev = _sma(bars, i - 1, 50)
        ma200_i = _sma(bars, i, 200)
        ma200_prev = _sma(bars, i - 1, 200)
        if any(v is None for v in (ma50_i, ma50_prev, ma200_i, ma200_prev)):
            continue
        if ma50_prev >= ma200_prev and ma50_i < ma200_i:
            return i
    return None


_GOOD_CTX = {
    "trend_stage": 4, "rs_trend": "down", "ma_alignment": "stacked_bearish",
    "volume_signature": "expanding", "regime": "bearish",
    "dcr_signature": "distribution", "recent_dcr_avg": 0.28,
    "nearest_resistance": None, "nearest_support": None,
    "days_to_earnings": None, "sector_strength_rank": None,
}


def test_slope_gate_boundary_pass():
    """200SMA slope ≈ +0.004999 FIRES — just inside the <= +0.005 gate.

    The synthetic boundary-pass fixture targets slope=+0.004999, which rounds
    to actual_slope ≈ +0.004998978 after 4-dp price rounding.  The slope is
    within 0.0001 of +0.005 (strict boundary proximity proof) and strictly
    below +0.005 (plain gate already accepts; _EPS not load-bearing here).
    """
    bars = _load_fixture_bars("dc_edge_slope_gate_boundary_pass")
    detections = detect_death_cross(bars, _GOOD_CTX)

    cross_idx = _find_cross_idx(bars)
    assert cross_idx is not None, "No death cross found in boundary_pass fixture"

    ss = max(0, cross_idx - 20)
    ma200_cross = _sma(bars, cross_idx, 200)
    ma200_ss = _sma(bars, ss, 200)
    actual_slope = (ma200_cross - ma200_ss) / ma200_ss

    # Strict proximity proof: slope must be within 0.0001 of +0.005
    assert abs(actual_slope - 0.005) < 0.0001, (
        f"Boundary-pass fixture slope {actual_slope!r} is not within 0.0001 of +0.005; "
        f"|actual - 0.005| = {abs(actual_slope - 0.005):.6e}"
    )
    # Plain gate check
    assert actual_slope <= 0.005, (
        f"Plain gate (<= +0.005) should pass for just-inside slope; got {actual_slope!r}"
    )
    # EPS-guarded gate (trivially also passes)
    assert actual_slope <= 0.005 + _EPS, (
        f"EPS-guarded gate (<= +0.005 + {_EPS}) should pass; got {actual_slope!r}"
    )
    # Detector must fire (slope inside gate, all other death-cross conditions satisfied)
    assert len(detections) >= 1, (
        f"Just-inside slope {actual_slope!r} (<= +0.005) — detector must fire. "
        f"Got 0 detections."
    )


def test_slope_gate_boundary_fail():
    """200SMA slope ≈ +0.005001 does NOT fire — just outside the <= +0.005 gate.

    The synthetic boundary-fail fixture targets slope=+0.005001, which rounds
    to actual_slope ≈ +0.005001028 after 4-dp price rounding.  The slope is
    within 0.0001 of +0.005 (strict boundary proximity proof) and strictly
    above +0.005 (both the plain gate and _EPS gate reject; this test proves
    the slope gate — not any other condition — is solely responsible for rejection
    because every other death-cross gate is satisfied in the fixture).
    """
    bars = _load_fixture_bars("dc_edge_slope_gate_boundary_fail")
    detections = detect_death_cross(bars, _GOOD_CTX)

    cross_idx = _find_cross_idx(bars)
    assert cross_idx is not None, (
        "No death cross found in boundary_fail fixture — "
        "every condition except the slope gate should be satisfied"
    )

    ss = max(0, cross_idx - 20)
    ma200_cross = _sma(bars, cross_idx, 200)
    ma200_ss = _sma(bars, ss, 200)
    actual_slope = (ma200_cross - ma200_ss) / ma200_ss

    # Strict proximity proof: slope must be within 0.0001 of +0.005
    assert abs(actual_slope - 0.005) < 0.0001, (
        f"Boundary-fail fixture slope {actual_slope!r} is not within 0.0001 of +0.005; "
        f"|actual - 0.005| = {abs(actual_slope - 0.005):.6e}"
    )
    # Plain gate must REJECT (slope is above +0.005)
    assert actual_slope > 0.005, (
        f"Plain gate should REJECT: slope {actual_slope!r} should be > +0.005"
    )
    # EPS-guarded gate must also reject (residue ~1e-6 >> _EPS=1e-9)
    assert actual_slope > 0.005 + _EPS, (
        f"EPS gate should also REJECT: slope {actual_slope!r} should be > +0.005 + {_EPS}"
    )
    # Detector must NOT fire (slope gate rejects; all other conditions satisfied)
    assert len(detections) == 0, (
        f"Just-outside slope {actual_slope!r} (> +0.005) — slope gate must reject. "
        f"Got {len(detections)} detection(s) with confidence "
        f"{[d['confidence'] for d in detections]}."
    )
