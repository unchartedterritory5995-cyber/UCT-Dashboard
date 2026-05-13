"""Battery test for the three-black-crows candlestick detector."""
import pytest

from api.services.pattern_engine.detectors.candlestick.three_black_crows import (
    detect_three_black_crows,
)
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


FIXTURES = load_all_fixtures("three_black_crows", include_internal=False)


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f.name)
def test_three_black_crows_fixture(fixture):
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_three_black_crows(fixture.bars, ctx)

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
    fixtures = load_all_fixtures("three_black_crows", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    neg = [f for f in fixtures if f.category == "negative"]
    edge = [f for f in fixtures if f.category == "edge"]
    assert len(pos) >= 5, f"need >=5 positive fixtures, have {len(pos)}"
    assert len(neg) >= 8, f"need >=8 negative fixtures, have {len(neg)}"
    assert len(edge) >= 2, f"need >=2 edge fixtures, have {len(edge)}"


def test_narrative_richness():
    """Each body field must be >=700 chars, headline >=90 chars."""
    fixtures = load_all_fixtures("three_black_crows", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_three_black_crows(fixture.bars, ctx)
    assert detections, f"positive fixture {fixture.name} did not fire"
    d = detections[0]
    narrative = d["narrative"]
    assert len(narrative["headline"]) >= 90, (
        f"headline too short ({len(narrative['headline'])} chars): {narrative['headline']!r}"
    )
    for field in ("what_it_is", "why_it_matters", "what_to_watch_for", "failure_signal"):
        text = narrative[field]
        assert len(text) >= 700, (
            f"narrative.{field} too short ({len(text)} chars): {text[:120]!r}..."
        )


def test_geometry_extras_richness():
    fixtures = load_all_fixtures("three_black_crows", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_three_black_crows(fixture.bars, ctx)
    assert detections
    d = detections[0]
    extras = d["geometry"]["extras"]
    required = (
        "body_pcts", "dcrs", "open_in_prior_body", "lower_wicks_pct",
        "decline_pcts", "volume_progression", "total_move_pct",
        "body_pct_avg", "at_swing_high", "climax_warning",
    )
    for key in required:
        assert key in extras, f"missing geometry.extras.{key}"
    assert len(extras["body_pcts"]) == 3
    assert len(extras["dcrs"]) == 3
    assert len(extras["lower_wicks_pct"]) == 3
    assert all(bp >= 0.60 for bp in extras["body_pcts"])
    assert all(d_ <= 0.30 for d_ in extras["dcrs"])
    assert all(lw <= 0.15 for lw in extras["lower_wicks_pct"])
    assert d["direction"] == "bearish"
    assert d["category"] == "candlestick"
    # 3 anchors for 3-bar pattern
    assert len(d["geometry"]["anchors"]) == 3


def test_levels_are_bearish_setup():
    fixtures = load_all_fixtures("three_black_crows", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    f = pos[0]
    ctx = f.context if f.context is not None else build_context(f.bars, sym="TEST")
    d = detect_three_black_crows(f.bars, ctx)[0]
    levels = d["levels"]
    bar3 = f.bars[-1]
    # Entry just below bar 3 low
    assert levels["entry"] < bar3["l"] * 1.001
    # Stop above the 3-bar body highs
    body_high = max(f.bars[-3]["h"], f.bars[-2]["h"])
    assert levels["stop"] > body_high
    # Target should be below entry for bearish trade
    assert levels["target_primary"] < levels["entry"]
    assert levels["risk_reward"] > 0.0
