"""Battery test for the UCT Cup-with-Handle detector. Runs every fixture in
tests/fixtures/cup_handle_uct/ and asserts the expected outcome.

The UCT variant is O'Neil's CAN SLIM cup-handle with strict
institutional-quality filters: >=30% prior advance, tight 30-65 bar cup with
12-35% depth, tight 5-15 bar handle that does not undercut the cup mid-line,
on volume <=70% of cup average. Context gates: Stage 2 + stacked_bullish.
"""
import pytest

from api.services.pattern_engine.detectors.uct.cup_handle_uct import detect_cup_handle_uct
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


FIXTURES = load_all_fixtures("cup_handle_uct", include_internal=False)


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f.name)
def test_cup_handle_uct_fixture(fixture):
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_cup_handle_uct(fixture.bars, ctx)

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
        assert d["pattern_id"] == "cup_handle_uct"
        assert d["direction"] == "bullish"
    else:
        if detections:
            for d in detections:
                assert d["confidence"] < 50.0, (
                    f"Fixture {fixture.name!r} expected NOT to fire, but got "
                    f"confidence {d['confidence']:.1f}"
                )


def test_fixture_battery_has_minimum_coverage():
    """Battery requires >=5 positive, >=8 negative, >=2 edge fixtures."""
    fixtures = load_all_fixtures("cup_handle_uct", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    neg = [f for f in fixtures if f.category == "negative"]
    edge = [f for f in fixtures if f.category == "edge"]
    assert len(pos) >= 5, f"need >=5 positive fixtures, have {len(pos)}"
    assert len(neg) >= 8, f"need >=8 negative fixtures, have {len(neg)}"
    assert len(edge) >= 2, f"need >=2 edge fixtures, have {len(edge)}"


def test_narrative_richness():
    """Sanity check that narrative fields contain substantial paragraph-length content."""
    fixtures = load_all_fixtures("cup_handle_uct", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos, "no positive fixtures found"

    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_cup_handle_uct(fixture.bars, ctx)
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
                f"narrative.{field} too short ({len(text)} chars): {text[:100]!r}..."
            )


def test_geometry_extras_richness():
    """Detection geometry.extras must include the substantive fields callers expect."""
    fixtures = load_all_fixtures("cup_handle_uct", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_cup_handle_uct(fixture.bars, ctx)
    assert detections
    d = detections[0]

    extras = d["geometry"]["extras"]
    for key in ("cup_bars", "cup_depth_pct", "handle_bars", "handle_depth_pct",
                "rim_similarity_pct", "roundness_residual", "bottom_width_pct",
                "pre_cup_advance_pct", "pre_cup_bars",
                "handle_volume_ratio_to_cup", "cup_mid_line",
                "cup_avg_volume", "handle_avg_volume",
                "right_rim", "handle_low", "handle_high", "cup_bottom"):
        assert key in extras, f"missing geometry.extras.{key}"

    # Sanity: UCT-strict thresholds
    assert 30 <= extras["cup_bars"] <= 65, f"cup_bars out of UCT range: {extras['cup_bars']}"
    assert 12.0 <= extras["cup_depth_pct"] <= 35.0
    assert 5 <= extras["handle_bars"] <= 15
    assert extras["pre_cup_advance_pct"] >= 30.0
    assert extras["handle_volume_ratio_to_cup"] <= 0.70
