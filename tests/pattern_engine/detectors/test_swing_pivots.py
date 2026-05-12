"""Battery test for the swing_pivots structure detector. Runs every fixture
in tests/fixtures/swing_pivots/ and asserts the expected outcome.

Unlike trade-setup detectors, swing_pivots ALWAYS fires when >=3 pivots are
present in the recent window. The battery exercises:
  - Varying pivot densities (positive)
  - Insufficient pivots / no pivots / pivots outside window (negative)
  - Boundary cases at exactly 3 pivots (edge)
"""
import pytest

from api.services.pattern_engine.detectors.structure.swing_pivots import detect_swing_pivots
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


FIXTURES = load_all_fixtures("swing_pivots", include_internal=False)


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f.name)
def test_swing_pivots_fixture(fixture):
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_swing_pivots(fixture.bars, ctx)

    if fixture.expected_fires:
        assert len(detections) == 1, (
            f"Fixture {fixture.name!r} expected exactly 1 detection, "
            f"got {len(detections)}."
        )
        d = detections[0]
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
    """Battery requires >=5 positive, >=8 negative, >=2 edge fixtures."""
    fixtures = load_all_fixtures("swing_pivots", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    neg = [f for f in fixtures if f.category == "negative"]
    edge = [f for f in fixtures if f.category == "edge"]
    assert len(pos) >= 5, f"need >=5 positive fixtures, have {len(pos)}"
    assert len(neg) >= 8, f"need >=8 negative fixtures, have {len(neg)}"
    assert len(edge) >= 2, f"need >=2 edge fixtures, have {len(edge)}"


def test_narrative_richness():
    """Sanity check that narrative fields contain substantial paragraph-length content.

    Per the rich-narrative directive, every body field (what_it_is,
    why_it_matters, what_to_watch_for, failure_signal) must be >=700 chars
    with real detection values woven in.
    """
    fixtures = load_all_fixtures("swing_pivots", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos, "no positive fixtures found"

    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_swing_pivots(fixture.bars, ctx)
    assert detections, f"positive fixture {fixture.name} did not fire"
    d = detections[0]

    narrative = d["narrative"]
    for field in ("headline", "what_it_is", "why_it_matters",
                  "what_to_watch_for", "failure_signal"):
        assert field in narrative, f"missing narrative.{field}"
        text = narrative[field]
        if field == "headline":
            assert len(text) >= 80, f"narrative.{field} too short ({len(text)} chars): {text!r}"
        else:
            assert len(text) >= 700, (
                f"narrative.{field} too short ({len(text)} chars): {text[:120]!r}..."
            )


def test_geometry_extras_richness():
    """Detection geometry.extras must include the substantive fields callers expect."""
    fixtures = load_all_fixtures("swing_pivots", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_swing_pivots(fixture.bars, ctx)
    assert detections
    d = detections[0]

    extras = d["geometry"]["extras"]
    required = (
        "pivot_count", "pivot_high_count", "pivot_low_count",
        "pivot_density_per_10_bars", "strongest_pivot_price",
        "strongest_pivot_strength", "strongest_pivot_type",
        "window_bars", "recent_pivots_count", "older_pivots_count",
    )
    for key in required:
        assert key in extras, f"missing geometry.extras.{key}"

    assert extras["pivot_count"] >= 3
    assert extras["pivot_high_count"] + extras["pivot_low_count"] == extras["pivot_count"]
    # Geometry anchors must match pivot count
    assert len(d["geometry"]["anchors"]) == extras["pivot_count"]


def test_anchors_match_pivot_count():
    """For every positive fixture, geometry.anchors length == pivot_count extras."""
    fixtures = load_all_fixtures("swing_pivots", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    for fixture in pos:
        ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
        detections = detect_swing_pivots(fixture.bars, ctx)
        assert detections, f"{fixture.name} did not fire"
        d = detections[0]
        anchors = d["geometry"]["anchors"]
        assert len(anchors) == d["geometry"]["extras"]["pivot_count"]
        # Each anchor has t and price keys
        for a in anchors:
            assert "t" in a and "price" in a


def test_levels_are_structural_not_trade():
    """Structure detector emits structural levels - no stop, no target, rr=0."""
    fixtures = load_all_fixtures("swing_pivots", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    d = detect_swing_pivots(fixture.bars, ctx)[0]

    levels = d["levels"]
    assert levels["stop"] is None
    assert levels["target_primary"] is None
    assert levels["risk_reward"] == 0.0
    assert "not a trade trigger" in levels["entry_condition"].lower()
    assert d["direction"] == "neutral"
    assert d["category"] == "structure"
