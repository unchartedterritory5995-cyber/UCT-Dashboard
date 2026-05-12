"""Battery test for the Flat Base Breakout detector. Runs every fixture
in tests/fixtures/flat_base/ and asserts the expected outcome."""
import pytest

from api.services.pattern_engine.detectors.uct.flat_base import detect_flat_base
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


FIXTURES = load_all_fixtures("flat_base", include_internal=False)


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f.name)
def test_flat_base_fixture(fixture):
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_flat_base(fixture.bars, ctx)

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
    """Battery requires >=5 positive, >=8 negative, >=2 edge fixtures."""
    fixtures = load_all_fixtures("flat_base", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    neg = [f for f in fixtures if f.category == "negative"]
    edge = [f for f in fixtures if f.category == "edge"]
    assert len(pos) >= 5, f"need >=5 positive fixtures, have {len(pos)}"
    assert len(neg) >= 8, f"need >=8 negative fixtures, have {len(neg)}"
    assert len(edge) >= 2, f"need >=2 edge fixtures, have {len(edge)}"


def test_narrative_richness():
    """Sanity check that narrative fields contain substantial paragraph-length content."""
    fixtures = load_all_fixtures("flat_base", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos, "no positive fixtures found"

    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_flat_base(fixture.bars, ctx)
    assert detections, f"positive fixture {fixture.name} did not fire"
    d = detections[0]

    narrative = d["narrative"]
    for field in ("headline", "what_it_is", "why_it_matters",
                  "what_to_watch_for", "failure_signal"):
        assert field in narrative, f"missing narrative.{field}"
        text = narrative[field]
        if field == "headline":
            # headline is shorter (one sentence) — at least 80 chars
            assert len(text) >= 80, f"narrative.{field} too short ({len(text)} chars): {text!r}"
        else:
            # body fields must be paragraph-length (>=700 chars per directive)
            assert len(text) >= 700, (
                f"narrative.{field} too short ({len(text)} chars): {text[:100]!r}..."
            )


def test_geometry_extras_richness():
    """Detection geometry.extras must include the substantive fields callers expect."""
    fixtures = load_all_fixtures("flat_base", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_flat_base(fixture.bars, ctx)
    assert detections
    d = detections[0]

    extras = d["geometry"]["extras"]
    for key in ("base_bars", "base_depth_pct", "base_high", "base_low",
                "prior_advance_pct", "prior_advance_bars",
                "volume_contraction_pct", "first_half_vol_avg",
                "second_half_vol_avg", "base_slope_pct_per_bar"):
        assert key in extras, f"missing geometry.extras.{key}"

    # Sanity: base depth must respect the 12% threshold
    assert extras["base_depth_pct"] <= 12.0
    # Prior advance must respect the 25% threshold
    assert extras["prior_advance_pct"] >= 25.0
    # Base bars in [15, 35]
    assert 15 <= extras["base_bars"] <= 35
