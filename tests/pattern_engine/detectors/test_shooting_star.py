"""Battery test for the shooting_star candlestick detector."""
import pytest

from api.services.pattern_engine.detectors.candlestick.shooting_star import detect_shooting_star
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


FIXTURES = load_all_fixtures("shooting_star", include_internal=False)


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f.name)
def test_shooting_star_fixture(fixture):
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_shooting_star(fixture.bars, ctx)

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
    fixtures = load_all_fixtures("shooting_star", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    neg = [f for f in fixtures if f.category == "negative"]
    edge = [f for f in fixtures if f.category == "edge"]
    assert len(pos) >= 5, f"need >=5 positive fixtures, have {len(pos)}"
    assert len(neg) >= 8, f"need >=8 negative fixtures, have {len(neg)}"
    assert len(edge) >= 2, f"need >=2 edge fixtures, have {len(edge)}"


def test_narrative_richness():
    fixtures = load_all_fixtures("shooting_star", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_shooting_star(fixture.bars, ctx)
    assert detections, f"positive fixture {fixture.name} did not fire"
    d = detections[0]
    narrative = d["narrative"]
    assert len(narrative["headline"]) >= 90, (
        f"headline too short ({len(narrative['headline'])} chars)"
    )
    for field in ("what_it_is", "why_it_matters", "what_to_watch_for", "failure_signal"):
        text = narrative[field]
        assert len(text) >= 700, (
            f"narrative.{field} too short ({len(text)} chars): {text[:120]!r}..."
        )


def test_geometry_extras_richness():
    fixtures = load_all_fixtures("shooting_star", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_shooting_star(fixture.bars, ctx)
    assert detections
    d = detections[0]
    extras = d["geometry"]["extras"]
    required = (
        "body_pct", "body_to_range_ratio", "upper_wick_pct", "lower_wick_pct",
        "upper_wick_body_ratio", "is_green", "at_swing_high", "recent_advance_pct",
    )
    for key in required:
        assert key in extras, f"missing geometry.extras.{key}"
    assert extras["upper_wick_body_ratio"] >= 2.0
    assert d["direction"] == "bearish"
    assert d["category"] == "candlestick"


def test_levels_are_bearish_setup():
    fixtures = load_all_fixtures("shooting_star", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    f = pos[0]
    ctx = f.context if f.context is not None else build_context(f.bars, sym="TEST")
    d = detect_shooting_star(f.bars, ctx)[0]
    levels = d["levels"]
    last_bar = f.bars[-1]
    # Entry BELOW shooting star low
    assert levels["entry"] < last_bar["l"] * 1.001
    # Stop ABOVE shooting star high
    assert levels["stop"] > last_bar["h"]
    # Target BELOW entry (bearish)
    assert levels["target_primary"] < levels["entry"]
