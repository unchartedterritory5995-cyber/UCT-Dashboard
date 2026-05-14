"""Battery test for the can_slim_composite meta-detector.

can_slim_composite always emits exactly ONE Detection when bars >= 30 and 0
detections below that threshold.
"""
import pytest

from api.services.pattern_engine.detectors.uct.can_slim_composite import (
    detect_can_slim_composite,
)
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


FIXTURES = load_all_fixtures("can_slim_composite", include_internal=False)


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f.name)
def test_can_slim_composite_fixture(fixture):
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_can_slim_composite(fixture.bars, ctx)

    if fixture.expected_fires:
        assert len(detections) == 1, (
            f"Fixture {fixture.name!r}: expected 1 detection, got {len(detections)}"
        )
        d = detections[0]
        assert fixture.min_confidence <= d["confidence"] <= fixture.max_confidence
        if fixture.expected_geometry_shape:
            assert d["geometry"]["shape"] == fixture.expected_geometry_shape
        assert d["geometry"]["shape"] == "candle_mark"
        assert d["geometry"]["extras"]["grade"] in ("A", "B", "C", "D")
    else:
        assert len(detections) == 0, (
            f"Fixture {fixture.name!r}: expected 0 detections, got {len(detections)}"
        )


def test_fixture_battery_has_minimum_coverage():
    fixtures = load_all_fixtures("can_slim_composite", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    neg = [f for f in fixtures if f.category == "negative"]
    edge = [f for f in fixtures if f.category == "edge"]
    assert len(pos) >= 5
    assert len(neg) >= 2
    assert len(edge) >= 2


def test_narrative_richness():
    """Every grade branch emitted at least once should have rich narrative."""
    fixtures = load_all_fixtures("can_slim_composite", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    seen_grades = set()
    for fixture in pos:
        ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
        detections = detect_can_slim_composite(fixture.bars, ctx)
        assert detections
        d = detections[0]
        seen_grades.add(d["geometry"]["extras"]["grade"])
        narrative = d["narrative"]
        for field in ("headline", "what_it_is", "why_it_matters",
                      "what_to_watch_for", "failure_signal"):
            assert field in narrative
            text = narrative[field]
            if field == "headline":
                assert len(text) >= 50
            else:
                assert len(text) >= 700, (
                    f"narrative.{field} for {fixture.name} ({len(text)} chars)"
                )
    # Multiple grade branches exercised
    assert len(seen_grades) >= 2, f"only saw grades {seen_grades}"


def test_geometry_extras_richness():
    fixtures = load_all_fixtures("can_slim_composite", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_can_slim_composite(fixture.bars, ctx)
    assert detections
    extras = detections[0]["geometry"]["extras"]
    for key in ("composite_score", "grade", "c_score", "a_score", "n_score",
                "s_score", "l_score", "i_score", "m_score", "interpretation"):
        assert key in extras, f"missing geometry.extras.{key}"
