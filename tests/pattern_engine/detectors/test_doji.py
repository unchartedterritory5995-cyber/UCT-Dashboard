"""Battery test for the doji candlestick detector. Runs every fixture in
tests/fixtures/doji/ and asserts the expected outcome.

The doji is a single-bar pattern with 4 variants (standard/long_legged/
dragonfly/gravestone). The fixtures exercise:
  - Each of the 4 variants in its meaningful context (positive)
  - Anatomies that fail the body/wick gates (negative)
  - Boundary thresholds (edge)
"""
import pytest

from api.services.pattern_engine.detectors.candlestick.doji import detect_doji
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


FIXTURES = load_all_fixtures("doji", include_internal=False)


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f.name)
def test_doji_fixture(fixture):
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_doji(fixture.bars, ctx)

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
    fixtures = load_all_fixtures("doji", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    neg = [f for f in fixtures if f.category == "negative"]
    edge = [f for f in fixtures if f.category == "edge"]
    assert len(pos) >= 5, f"need >=5 positive fixtures, have {len(pos)}"
    assert len(neg) >= 8, f"need >=8 negative fixtures, have {len(neg)}"
    assert len(edge) >= 2, f"need >=2 edge fixtures, have {len(edge)}"


def test_narrative_richness():
    """Each body field must be >=700 chars, headline >=90 chars."""
    fixtures = load_all_fixtures("doji", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos, "no positive fixtures found"

    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_doji(fixture.bars, ctx)
    assert detections, f"positive fixture {fixture.name} did not fire"
    d = detections[0]

    narrative = d["narrative"]
    assert "headline" in narrative
    assert len(narrative["headline"]) >= 90, (
        f"headline too short ({len(narrative['headline'])} chars): {narrative['headline']!r}"
    )
    for field in ("what_it_is", "why_it_matters", "what_to_watch_for", "failure_signal"):
        assert field in narrative, f"missing narrative.{field}"
        text = narrative[field]
        assert len(text) >= 700, (
            f"narrative.{field} too short ({len(text)} chars): {text[:120]!r}..."
        )


def test_geometry_extras_richness():
    """Detection geometry.extras must include the variant and wick fields."""
    fixtures = load_all_fixtures("doji", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_doji(fixture.bars, ctx)
    assert detections
    d = detections[0]

    extras = d["geometry"]["extras"]
    required = (
        "variant", "body_pct", "body_to_range_ratio",
        "upper_wick_pct", "lower_wick_pct", "direction_bias",
        "at_swing_high", "at_swing_low",
    )
    for key in required:
        assert key in extras, f"missing geometry.extras.{key}"
    assert extras["variant"] in ("standard", "long_legged", "dragonfly", "gravestone")
    assert extras["direction_bias"] in ("bullish", "bearish", "neutral")


def test_dragonfly_variant_emits_bullish_bias():
    """A dragonfly doji at a swing low should emit bullish bias levels."""
    fixtures = load_all_fixtures("doji", include_internal=False)
    drag = [f for f in fixtures if "dragonfly" in f.name and f.category == "positive"]
    assert drag, "no dragonfly positive fixture"
    f = drag[0]
    ctx = f.context if f.context is not None else build_context(f.bars, sym="TEST")
    detections = detect_doji(f.bars, ctx)
    assert detections
    d = detections[0]
    assert d["geometry"]["extras"]["variant"] == "dragonfly"
    assert d["geometry"]["extras"]["direction_bias"] == "bullish"
    # Entry should be ABOVE the doji bar's high
    assert d["levels"]["entry"] > f.bars[-1]["h"] * 0.999
    assert d["levels"]["stop"] < f.bars[-1]["l"]


def test_gravestone_variant_emits_bearish_bias():
    """A gravestone doji at a swing high should emit bearish bias levels."""
    fixtures = load_all_fixtures("doji", include_internal=False)
    grav = [f for f in fixtures if "gravestone" in f.name and f.category == "positive"]
    assert grav, "no gravestone positive fixture"
    f = grav[0]
    ctx = f.context if f.context is not None else build_context(f.bars, sym="TEST")
    detections = detect_doji(f.bars, ctx)
    assert detections
    d = detections[0]
    assert d["geometry"]["extras"]["variant"] == "gravestone"
    assert d["geometry"]["extras"]["direction_bias"] == "bearish"
    # Entry should be BELOW the doji bar's low
    assert d["levels"]["entry"] < f.bars[-1]["l"] * 1.001
    assert d["levels"]["stop"] > f.bars[-1]["h"]
