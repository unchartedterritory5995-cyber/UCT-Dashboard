"""Battery test for the kell_cycle stage-classifier detector.

kell_cycle always emits exactly ONE Detection (per call) classifying the
current chart into one of 5 Kell stages. Fixture battery tests focus on:
  - Emit structure (one detection, correct geometry shape, extras present)
  - Narrative richness across all 5 stage branches
  - Negative fixtures (too few bars) must NOT fire.
"""
import pytest

from api.services.pattern_engine.detectors.uct.kell_cycle import detect_kell_cycle
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


FIXTURES = load_all_fixtures("kell_cycle", include_internal=False)


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f.name)
def test_kell_cycle_fixture(fixture):
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_kell_cycle(fixture.bars, ctx)

    if fixture.expected_fires:
        assert len(detections) == 1, (
            f"Fixture {fixture.name!r} expected to fire but produced "
            f"{len(detections)} detections."
        )
        d = detections[0]
        assert fixture.min_confidence <= d["confidence"] <= fixture.max_confidence, (
            f"Fixture {fixture.name!r}: confidence {d['confidence']:.1f} not in "
            f"expected band [{fixture.min_confidence}, {fixture.max_confidence}]"
        )
        if fixture.expected_geometry_shape:
            assert d["geometry"]["shape"] == fixture.expected_geometry_shape
        # Always emits candle_mark with kell_stage extra
        assert d["geometry"]["shape"] == "candle_mark"
        assert d["geometry"]["extras"]["kell_stage"] in (1, 2, 3, 4, 5)
    else:
        assert len(detections) == 0, (
            f"Fixture {fixture.name!r} expected NOT to fire but produced "
            f"{len(detections)} detections."
        )


def test_fixture_battery_has_minimum_coverage():
    """Battery requires >=5 positive, >=2 negative, >=2 edge fixtures."""
    fixtures = load_all_fixtures("kell_cycle", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    neg = [f for f in fixtures if f.category == "negative"]
    edge = [f for f in fixtures if f.category == "edge"]
    assert len(pos) >= 5, f"need >=5 positive fixtures, have {len(pos)}"
    assert len(neg) >= 2, f"need >=2 negative fixtures, have {len(neg)}"
    assert len(edge) >= 2, f"need >=2 edge fixtures, have {len(edge)}"


def test_narrative_richness():
    """Every body field >= 700 chars across the fixture battery."""
    fixtures = load_all_fixtures("kell_cycle", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    for fixture in pos:
        ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
        detections = detect_kell_cycle(fixture.bars, ctx)
        assert detections, f"positive fixture {fixture.name} did not fire"
        d = detections[0]
        narrative = d["narrative"]
        for field in ("headline", "what_it_is", "why_it_matters",
                      "what_to_watch_for", "failure_signal"):
            assert field in narrative, f"missing narrative.{field}"
            text = narrative[field]
            if field == "headline":
                assert len(text) >= 80, (
                    f"narrative.{field} for {fixture.name} too short ({len(text)} chars)"
                )
            else:
                assert len(text) >= 700, (
                    f"narrative.{field} for {fixture.name} too short "
                    f"({len(text)} chars): {text[:100]!r}"
                )


def test_geometry_extras_richness():
    """Detection geometry.extras must include the substantive fields callers expect."""
    fixtures = load_all_fixtures("kell_cycle", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_kell_cycle(fixture.bars, ctx)
    assert detections
    extras = detections[0]["geometry"]["extras"]
    for key in ("kell_stage", "stage_name", "recent_change_pct",
                "range_expansion_ratio", "is_parabolic", "is_consolidating",
                "prior_trend"):
        assert key in extras, f"missing geometry.extras.{key}"


# ---------------------------------------------------------------------------
# Confidence-formula pin
# ---------------------------------------------------------------------------

def test_confidence_formula_pin():
    """Pins the canonical 4-weight confidence formula for kell_cycle.

    Formula: round(0.40*geometry_score + 0.25*volume_score
                   + 0.20*context_score + 0.15*historical_score, 2)

    Uses the 'stage1_reversal' fixture (deterministic positive case).
    Any future formula drift causes this test to fail loudly.
    """
    fixtures = load_all_fixtures("kell_cycle", include_internal=False)
    fixture = next((f for f in fixtures if f.name == "stage1_reversal"), None)
    assert fixture is not None, "missing stage1_reversal fixture"

    ctx = (
        fixture.context
        if fixture.context is not None
        else build_context(fixture.bars, sym="TEST")
    )
    detections = detect_kell_cycle(fixture.bars, ctx)
    assert detections, "stage1_reversal must fire for the formula-pin test"
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
        "Check formula weights in detect_kell_cycle."
    )
    assert qc["historical_score"] == 50.0, (
        f"historical_score must be 50.0 cold-start prior; got {qc['historical_score']}"
    )
