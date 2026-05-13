"""Battery test for the evening-star candlestick detector."""
import pytest

from api.services.pattern_engine.detectors.candlestick.evening_star import detect_evening_star
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


FIXTURES = load_all_fixtures("evening_star", include_internal=False)


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f.name)
def test_evening_star_fixture(fixture):
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_evening_star(fixture.bars, ctx)

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
        if detections:
            for d in detections:
                assert d["confidence"] < 50.0, (
                    f"Fixture {fixture.name!r} expected NOT to fire, but got "
                    f"confidence {d['confidence']:.1f}"
                )


def test_fixture_battery_has_minimum_coverage():
    fixtures = load_all_fixtures("evening_star", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    neg = [f for f in fixtures if f.category == "negative"]
    edge = [f for f in fixtures if f.category == "edge"]
    assert len(pos) >= 5, f"need >=5 positive fixtures, have {len(pos)}"
    assert len(neg) >= 8, f"need >=8 negative fixtures, have {len(neg)}"
    assert len(edge) >= 2, f"need >=2 edge fixtures, have {len(edge)}"


def test_narrative_richness():
    """Each body field must be >=700 chars, headline >=90 chars."""
    fixtures = load_all_fixtures("evening_star", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_evening_star(fixture.bars, ctx)
    assert detections, f"positive fixture {fixture.name} did not fire"
    d = detections[0]
    narrative = d["narrative"]
    assert len(narrative["headline"]) >= 90, (
        f"headline too short ({len(narrative['headline'])} chars): {narrative['headline']!r}"
    )
    for field in ("what_it_is", "why_it_matters", "what_to_watch_for", "failure_signal"):
        text = narrative[field]
        assert len(text) >= 700, (
            f"narrative.{field} too short ({len(text)} chars): {text[:120]!r}..."
        )


def test_geometry_extras_richness():
    fixtures = load_all_fixtures("evening_star", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_evening_star(fixture.bars, ctx)
    assert detections
    d = detections[0]
    extras = d["geometry"]["extras"]
    required = (
        "b1_body_pct", "b2_body_pct", "b3_body_pct", "star_ratio",
        "midpoint_penetration", "gap_pct", "b1_dcr", "b2_dcr", "b3_dcr",
        "star_vol_ratio", "confirm_vol_ratio", "at_swing_high",
    )
    for key in required:
        assert key in extras, f"missing geometry.extras.{key}"
    assert extras["star_ratio"] <= 0.30
    assert extras["b1_body_pct"] >= 0.40
    assert extras["b3_body_pct"] >= 0.40
    assert extras["midpoint_penetration"] > 0.0
    assert d["direction"] == "bearish"
    assert d["category"] == "candlestick"
    assert len(d["geometry"]["anchors"]) == 3


def test_levels_are_bearish_setup():
    fixtures = load_all_fixtures("evening_star", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    f = pos[0]
    ctx = f.context if f.context is not None else build_context(f.bars, sym="TEST")
    d = detect_evening_star(f.bars, ctx)[0]
    levels = d["levels"]
    bar3 = f.bars[-1]
    # Entry just below bar 3 low
    assert levels["entry"] < bar3["l"] * 1.001
    # Stop above the 3-bar pattern high
    pattern_high = max(f.bars[-3]["h"], f.bars[-2]["h"], f.bars[-1]["h"])
    assert levels["stop"] > pattern_high
    assert levels["target_primary"] < levels["entry"]
