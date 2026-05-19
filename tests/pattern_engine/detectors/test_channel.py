"""Battery test for the channel detector."""
import pytest

from api.services.pattern_engine.detectors.classical.channel import (
    detect_channel,
)
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


FIXTURES = load_all_fixtures("channel", include_internal=False)


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f.name)
def test_channel_fixture(fixture):
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_channel(fixture.bars, ctx)

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
        assert d["pattern_id"] == "channel"
        assert d["direction"] in ("bullish", "bearish", "neutral")
    else:
        if detections:
            for d in detections:
                assert d["confidence"] < 50.0, (
                    f"Fixture {fixture.name!r} expected NOT to fire, but got "
                    f"confidence {d['confidence']:.1f}"
                )


def test_fixture_battery_has_minimum_coverage():
    fixtures = load_all_fixtures("channel", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    neg = [f for f in fixtures if f.category == "negative"]
    edge = [f for f in fixtures if f.category == "edge"]
    assert len(pos) >= 5, f"need >=5 positive fixtures, have {len(pos)}"
    assert len(neg) >= 8, f"need >=8 negative fixtures, have {len(neg)}"
    assert len(edge) >= 2, f"need >=2 edge fixtures, have {len(edge)}"


def test_narrative_richness():
    fixtures = load_all_fixtures("channel", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos, "no positive fixtures found"

    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_channel(fixture.bars, ctx)
    assert detections, f"positive fixture {fixture.name} did not fire"
    d = max(detections, key=lambda x: x["confidence"])

    narrative = d["narrative"]
    assert "headline" in narrative
    assert len(narrative["headline"]) >= 90, (
        f"narrative.headline too short ({len(narrative['headline'])} chars)"
    )
    for field in ("what_it_is", "why_it_matters", "what_to_watch_for", "failure_signal"):
        assert field in narrative, f"missing narrative.{field}"
        text = narrative[field]
        assert len(text) >= 700, (
            f"narrative.{field} too short ({len(text)} chars): {text[:120]!r}..."
        )


# ---------------------------------------------------------------------------
# Confidence-formula pin
# ---------------------------------------------------------------------------

def test_confidence_formula_pin():
    """Pins the canonical 4-weight confidence formula for channel.

    Formula: round(0.40*geometry_score + 0.25*volume_score
                   + 0.20*context_score + 0.15*historical_score, 2)

    Uses the 'clean_ascending' fixture (deterministic positive case).
    Any future formula drift causes this test to fail loudly.
    """
    fixtures = load_all_fixtures("channel", include_internal=False)
    fixture = next((f for f in fixtures if f.name == "clean_ascending"), None)
    assert fixture is not None, "missing clean_ascending fixture"

    ctx = (
        fixture.context
        if fixture.context is not None
        else build_context(fixture.bars, sym="TEST")
    )
    detections = detect_channel(fixture.bars, ctx)
    assert detections, "clean_ascending must fire for the formula-pin test"
    d = detections[0]

    qc = d["quality_components"]
    expected = round(
        0.40 * qc["geometry_score"]
        + 0.25 * qc["volume_score"]
        + 0.20 * qc["context_score"]
        + 0.15 * qc["historical_score"],
        2,
    )
    assert d["confidence"] == expected, (
        f"confidence {d['confidence']} != recomputed {expected} "
        f"(geom={qc['geometry_score']}, vol={qc['volume_score']}, "
        f"ctx={qc['context_score']}, hist={qc['historical_score']}). "
        "Check formula weights in detect_channel."
    )
    assert qc["historical_score"] == 50.0, (
        f"historical_score must be 50.0 cold-start prior; got {qc['historical_score']}"
    )
