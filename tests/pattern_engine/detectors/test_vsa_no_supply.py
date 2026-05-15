"""Battery test for the VSA No Supply detector."""
import pytest

from api.services.pattern_engine.detectors.classical.vsa_no_supply import detect_vsa_no_supply
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


FIXTURES = load_all_fixtures("vsa_no_supply", include_internal=False)


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f.name)
def test_vsa_no_supply_fixture(fixture):
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_vsa_no_supply(fixture.bars, ctx)

    if fixture.expected_fires:
        assert len(detections) >= 1, (
            f"Fixture {fixture.name!r} expected to fire but produced 0 detections."
        )
        d = max(detections, key=lambda x: x["confidence"])
        assert fixture.min_confidence <= d["confidence"] <= fixture.max_confidence, (
            f"Fixture {fixture.name!r}: confidence {d['confidence']:.1f} not in "
            f"band [{fixture.min_confidence}, {fixture.max_confidence}]"
        )
        if fixture.expected_geometry_shape:
            assert d["geometry"]["shape"] == fixture.expected_geometry_shape
    else:
        if detections:
            for d in detections:
                assert d["confidence"] < 50.0


def test_fixture_battery_has_minimum_coverage():
    fixtures = load_all_fixtures("vsa_no_supply", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    neg = [f for f in fixtures if f.category == "negative"]
    edge = [f for f in fixtures if f.category == "edge"]
    assert len(pos) >= 5
    assert len(neg) >= 8
    assert len(edge) >= 2


def test_narrative_richness():
    fixtures = load_all_fixtures("vsa_no_supply", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_vsa_no_supply(fixture.bars, ctx)
    assert detections
    d = detections[0]
    narrative = d["narrative"]
    for field in ("headline", "what_it_is", "why_it_matters",
                  "what_to_watch_for", "failure_signal"):
        assert field in narrative
        text = narrative[field]
        if field == "headline":
            assert len(text) >= 90
        else:
            assert len(text) >= 700, (
                f"narrative.{field} for {fixture.name} too short ({len(text)} chars)"
            )


def test_geometry_extras_richness():
    fixtures = load_all_fixtures("vsa_no_supply", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_vsa_no_supply(fixture.bars, ctx)
    assert detections
    extras = detections[0]["geometry"]["extras"]
    for key in ("bar_range", "avg_range", "bar_volume", "prior_volume",
                "avg_volume", "is_down_bar", "range_ratio",
                "volume_ratio_to_avg"):
        assert key in extras, f"missing geometry.extras.{key}"
    assert extras["is_down_bar"] is True
    assert extras["range_ratio"] < 0.5
    assert extras["volume_ratio_to_avg"] < 1.0
