"""Battery test for the golden_cross detector. Runs every fixture in
tests/fixtures/golden_cross/ and asserts the expected outcome.

Mirrors the structure of test_hammer.py.
"""
import pytest

from api.services.pattern_engine.detectors.classical.golden_cross import detect_golden_cross
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
        if detections:
            for d in detections:
                assert d["confidence"] < 50.0, (
                    f"Fixture {fixture.name!r} expected NOT to fire, but got "
                    f"confidence {d['confidence']:.1f}"
                )


def test_fixture_battery_has_minimum_coverage():
    fixtures = load_all_fixtures("golden_cross", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    neg = [f for f in fixtures if f.category == "negative"]
    edge = [f for f in fixtures if f.category == "edge"]
    assert len(pos) >= 5, f"need >=5 positive fixtures, have {len(pos)}"
    assert len(neg) >= 8, f"need >=8 negative fixtures, have {len(neg)}"
    assert len(edge) >= 2, f"need >=2 edge fixtures, have {len(edge)}"


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
    assert extras["days_since_cross"] <= 5, (
        f"days_since_cross={extras['days_since_cross']} should be <=5 for a fresh cross"
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
