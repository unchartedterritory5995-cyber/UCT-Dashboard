"""Battery test for the marubozu candlestick detector.

Runs every fixture in tests/fixtures/marubozu/ and asserts the expected outcome.
Mirrors test_hammer.py structure exactly.
"""
import pytest

from api.services.pattern_engine.detectors.candlestick.marubozu import detect_marubozu
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


FIXTURES = load_all_fixtures("marubozu", include_internal=False)


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f.name)
def test_marubozu_fixture(fixture):
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_marubozu(fixture.bars, ctx)

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
    fixtures = load_all_fixtures("marubozu", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    neg = [f for f in fixtures if f.category == "negative"]
    edge = [f for f in fixtures if f.category == "edge"]
    assert len(pos) >= 5, f"need >=5 positive fixtures, have {len(pos)}"
    assert len(neg) >= 8, f"need >=8 negative fixtures, have {len(neg)}"
    assert len(edge) >= 2, f"need >=2 edge fixtures, have {len(edge)}"


def test_narrative_richness():
    """Headline must be >=90 chars; each body field must be >=700 chars."""
    fixtures = load_all_fixtures("marubozu", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos, "no positive fixtures found"
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_marubozu(fixture.bars, ctx)
    assert detections, f"positive fixture {fixture.name!r} did not fire"
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
    """Assert the docstring's extras keys are present and values are sane."""
    fixtures = load_all_fixtures("marubozu", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos, "no positive fixtures found"
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_marubozu(fixture.bars, ctx)
    assert detections, f"positive fixture {fixture.name!r} did not fire"
    d = detections[0]
    extras = d["geometry"]["extras"]

    # All keys required by the docstring
    for key in (
        "body_pct_of_range",
        "upper_wick_pct",
        "lower_wick_pct",
        "range_vs_avg",
        "volume_ratio",
        "dcr",
        "is_bullish",
    ):
        assert key in extras, f"missing geometry.extras.{key}"

    # Sanity: direction is valid
    assert d["direction"] in {"bullish", "bearish"}
    assert d["category"] == "candlestick"

    # Geometry shape
    assert d["geometry"]["shape"] == "candle_mark"


def test_levels_bullish_setup():
    """Bullish: entry > high * 0.999, stop <= low, target > entry."""
    fixtures = load_all_fixtures("marubozu", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    bull_fixtures = [f for f in pos if "bullish" in f.name or "uptrend" in f.name
                     or "volume" in f.name or "zero_wicks" in f.name]
    assert bull_fixtures, "no bullish positive fixture found by name filter"
    f = bull_fixtures[0]
    ctx = f.context if f.context is not None else build_context(f.bars, sym="TEST")
    detections = detect_marubozu(f.bars, ctx)
    assert detections, f"bullish fixture {f.name!r} did not fire"
    d = detections[0]
    assert d["direction"] == "bullish"
    levels = d["levels"]
    last_bar = f.bars[-1]
    # entry = high * 1.001 (above the bar high)
    assert levels["entry"] > last_bar["h"] * 0.999, (
        f"entry {levels['entry']} not above bar high {last_bar['h']}"
    )
    # stop = low (bar low)
    assert levels["stop"] <= last_bar["l"], (
        f"stop {levels['stop']} not <= bar low {last_bar['l']}"
    )
    # target > entry (positive R:R)
    assert levels["target_primary"] > levels["entry"], (
        f"target {levels['target_primary']} not > entry {levels['entry']}"
    )


def test_levels_bearish_setup():
    """Bearish: entry < low * 1.001, stop >= high, target < entry."""
    fixtures = load_all_fixtures("marubozu", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    bear_fixtures = [f for f in pos if "bearish" in f.name]
    assert bear_fixtures, "no bearish positive fixture found by name filter"
    f = bear_fixtures[0]
    ctx = f.context if f.context is not None else build_context(f.bars, sym="TEST")
    detections = detect_marubozu(f.bars, ctx)
    assert detections, f"bearish fixture {f.name!r} did not fire"
    d = detections[0]
    assert d["direction"] == "bearish"
    levels = d["levels"]
    last_bar = f.bars[-1]
    # entry = low * 0.999 (below bar low)
    assert levels["entry"] < last_bar["l"] * 1.001, (
        f"entry {levels['entry']} not below bar low {last_bar['l']}"
    )
    # stop = round(bar_high, 2) per detector spec — within 1 cent of bar high
    assert abs(levels["stop"] - last_bar["h"]) <= 0.01, (
        f"stop {levels['stop']} not within 1 cent of bar high {last_bar['h']}"
    )
    # target < entry (short sells go down)
    assert levels["target_primary"] < levels["entry"], (
        f"target {levels['target_primary']} not < entry {levels['entry']}"
    )
