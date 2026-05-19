"""Battery test for the liquid_leader_filter detector."""
import pytest

from api.services.pattern_engine.detectors.uct.liquid_leader_filter import (
    detect_liquid_leader_filter,
)
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


FIXTURES = load_all_fixtures("liquid_leader_filter", include_internal=False)


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f.name)
def test_liquid_leader_filter_fixture(fixture):
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_liquid_leader_filter(fixture.bars, ctx)

    if fixture.expected_fires:
        assert len(detections) == 1, (
            f"Fixture {fixture.name!r} expected to fire but produced "
            f"{len(detections)} detections."
        )
        d = detections[0]
        assert fixture.min_confidence <= d["confidence"] <= fixture.max_confidence
        if fixture.expected_geometry_shape:
            assert d["geometry"]["shape"] == fixture.expected_geometry_shape
    else:
        assert len(detections) == 0, (
            f"Fixture {fixture.name!r} expected NOT to fire."
        )


def test_fixture_battery_has_minimum_coverage():
    fixtures = load_all_fixtures("liquid_leader_filter", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    neg = [f for f in fixtures if f.category == "negative"]
    edge = [f for f in fixtures if f.category == "edge"]
    assert len(pos) >= 5
    assert len(neg) >= 8
    assert len(edge) >= 2


def test_narrative_richness():
    fixtures = load_all_fixtures("liquid_leader_filter", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_liquid_leader_filter(fixture.bars, ctx)
    assert detections
    d = detections[0]
    narrative = d["narrative"]
    for field in ("headline", "what_it_is", "why_it_matters",
                  "what_to_watch_for", "failure_signal"):
        assert field in narrative
        text = narrative[field]
        if field == "headline":
            assert len(text) >= 80
        else:
            assert len(text) >= 700, (
                f"narrative.{field} for {fixture.name} too short ({len(text)} chars)"
            )


def test_geometry_extras_richness():
    fixtures = load_all_fixtures("liquid_leader_filter", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_liquid_leader_filter(fixture.bars, ctx)
    assert detections
    extras = detections[0]["geometry"]["extras"]
    for key in ("within_52w_high_pct", "avg_volume_60d", "trend_stage",
                "ma_alignment", "rs_trend", "qualifies_as_leader",
                "high_52w"):
        assert key in extras, f"missing geometry.extras.{key}"
    assert extras["qualifies_as_leader"] is True
    assert extras["within_52w_high_pct"] <= 5.0
    assert extras["avg_volume_60d"] >= 500_000


# ---------------------------------------------------------------------------
# Confidence-formula pin
# ---------------------------------------------------------------------------

def test_confidence_formula_pin():
    """Pins the canonical 4-weight confidence formula for liquid_leader_filter.

    Formula: round(0.40*geometry_score + 0.25*volume_score
                   + 0.20*context_score + 0.15*historical_score, 2)

    Uses the 'clean_textbook' fixture (deterministic positive case).
    Any future formula drift causes this test to fail loudly.
    """
    fixtures = load_all_fixtures("liquid_leader_filter", include_internal=False)
    fixture = next((f for f in fixtures if f.name == "clean_textbook"), None)
    assert fixture is not None, "missing clean_textbook fixture"

    ctx = (
        fixture.context
        if fixture.context is not None
        else build_context(fixture.bars, sym="TEST")
    )
    detections = detect_liquid_leader_filter(fixture.bars, ctx)
    assert detections, "clean_textbook must fire for the formula-pin test"
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
        "Check formula weights in detect_liquid_leader_filter."
    )
    assert qc["historical_score"] == 50.0, (
        f"historical_score must be 50.0 cold-start prior; got {qc['historical_score']}"
    )
