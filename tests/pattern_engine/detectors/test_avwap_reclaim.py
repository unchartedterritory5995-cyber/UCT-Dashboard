"""Battery test for the AVWAP Reclaim detector."""
import pytest

from api.services.pattern_engine.detectors.uct.avwap_reclaim import detect_avwap_reclaim
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


FIXTURES = load_all_fixtures("avwap_reclaim", include_internal=False)


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f.name)
def test_avwap_reclaim_fixture(fixture):
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_avwap_reclaim(fixture.bars, ctx)

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
    fixtures = load_all_fixtures("avwap_reclaim", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    neg = [f for f in fixtures if f.category == "negative"]
    edge = [f for f in fixtures if f.category == "edge"]
    assert len(pos) >= 5
    assert len(neg) >= 8
    assert len(edge) >= 2


def test_narrative_richness():
    fixtures = load_all_fixtures("avwap_reclaim", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_avwap_reclaim(fixture.bars, ctx)
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
    fixtures = load_all_fixtures("avwap_reclaim", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_avwap_reclaim(fixture.bars, ctx)
    assert detections
    extras = detections[0]["geometry"]["extras"]
    for key in ("anchor_t", "anchor_price", "anchor_type", "avwap_current",
                "bars_below_avwap", "reclaim_volume_ratio"):
        assert key in extras, f"missing geometry.extras.{key}"
    assert extras["anchor_type"] in ("swing_low", "gap_up", "52w_high")
    assert extras["bars_below_avwap"] >= 5
    assert extras["reclaim_volume_ratio"] >= 1.5
