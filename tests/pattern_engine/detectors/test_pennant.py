"""Battery test for the pennant detector. Runs every fixture in
tests/fixtures/pennant/ and asserts the expected outcome.

The pennant detector emits BOTH bullish and bearish detections — `pattern_id`
is always `"pennant"`, and the `direction` field on each Detection tags the
emission appropriately.
"""
import pytest

from api.services.pattern_engine.detectors.classical.pennant import detect_pennant
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


FIXTURES = load_all_fixtures("pennant", include_internal=False)


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f.name)
def test_pennant_fixture(fixture):
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_pennant(fixture.bars, ctx)

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
        assert d["pattern_id"] == "pennant"
        assert d["direction"] in ("bullish", "bearish")
    else:
        if detections:
            for d in detections:
                assert d["confidence"] < 50.0, (
                    f"Fixture {fixture.name!r} expected NOT to fire, but got "
                    f"confidence {d['confidence']:.1f}"
                )


def test_fixture_battery_has_minimum_coverage():
    """Phase 0 Gate 1 requires >=5 positive, >=8 negative, >=2 edge fixtures."""
    fixtures = load_all_fixtures("pennant", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    neg = [f for f in fixtures if f.category == "negative"]
    edge = [f for f in fixtures if f.category == "edge"]
    assert len(pos) >= 5, f"need >=5 positive fixtures, have {len(pos)}"
    assert len(neg) >= 8, f"need >=8 negative fixtures, have {len(neg)}"
    assert len(edge) >= 2, f"need >=2 edge fixtures, have {len(edge)}"


def test_narrative_richness():
    """Each narrative body field must contain Phase 2-depth paragraph content."""
    fixtures = load_all_fixtures("pennant", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos, "no positive fixtures found"

    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_pennant(fixture.bars, ctx)
    assert detections, f"positive fixture {fixture.name} did not fire"
    d = max(detections, key=lambda x: x["confidence"])

    narrative = d["narrative"]
    assert "headline" in narrative
    assert len(narrative["headline"]) >= 90, (
        f"narrative.headline too short ({len(narrative['headline'])} chars): "
        f"{narrative['headline']!r}"
    )
    for field in ("what_it_is", "why_it_matters", "what_to_watch_for", "failure_signal"):
        assert field in narrative, f"missing narrative.{field}"
        text = narrative[field]
        assert len(text) >= 700, (
            f"narrative.{field} too short ({len(text)} chars): {text[:120]!r}..."
        )
