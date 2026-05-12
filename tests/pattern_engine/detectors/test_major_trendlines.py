"""Battery test for the major_trendlines structure detector.

Unlike single-Detection trade-setup detectors, major_trendlines may emit
0, 1, or 2 Detections per call (one rising-support, one falling-resistance,
or a horizontal). The fixture `expected` block:

  - fires: bool
  - expected_count: int (when fires=true)
  - expected_types: list of trendline_type strings expected
  - min_confidence, max_confidence: per-Detection confidence band
"""
import json
import os

import pytest

from api.services.pattern_engine.detectors.structure.major_trendlines import (
    detect_major_trendlines,
)
from api.services.pattern_engine.primitives.context import build_context


_FIXTURE_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..", "fixtures", "major_trendlines",
)


def _load_fixtures():
    out = []
    if not os.path.isdir(_FIXTURE_DIR):
        return out
    for name in sorted(os.listdir(_FIXTURE_DIR)):
        if not name.endswith(".json"):
            continue
        if name.startswith("_"):
            continue
        path = os.path.join(_FIXTURE_DIR, name)
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        data["_filename"] = name
        out.append(data)
    return out


FIXTURES = _load_fixtures()


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f["name"])
def test_major_trendlines_fixture(fixture):
    bars = fixture["bars"]
    ctx = fixture.get("context") or build_context(bars, sym="TEST")
    expected = fixture["expected"]

    detections = detect_major_trendlines(bars, ctx)
    n = len(detections)
    name = fixture["name"]

    if expected.get("fires", False):
        expected_count = int(expected.get("expected_count", 1))
        assert n == expected_count, (
            f"Fixture {name!r}: expected exactly {expected_count} detections, "
            f"got {n}: "
            f"{[d['geometry']['extras']['line_type'] for d in detections]}"
        )
        # Confidence band
        min_conf = float(expected.get("min_confidence", 0.0))
        max_conf = float(expected.get("max_confidence", 100.0))
        for d in detections:
            assert min_conf <= d["confidence"] <= max_conf, (
                f"Fixture {name!r}: confidence {d['confidence']:.1f} not in "
                f"band [{min_conf}, {max_conf}]"
            )
            assert d["category"] == "structure"
            assert d["pattern_id"] == "major_trendlines"
            assert d["geometry"]["shape"] == "trendline_pair"
            extras = d["geometry"]["extras"]
            assert extras["touches"] >= 3
            assert extras["r_squared"] >= 0.7

        # Expected types are present
        emitted_types = [d["geometry"]["extras"]["line_type"] for d in detections]
        for et in expected.get("expected_types", []):
            assert et in emitted_types, (
                f"Fixture {name!r}: expected type {et!r} not in emitted "
                f"types {emitted_types}"
            )
    else:
        assert n == 0, (
            f"Fixture {name!r}: expected NO detections, got {n}: "
            f"{[d['geometry']['extras']['line_type'] for d in detections]}"
        )


def test_fixture_battery_has_minimum_coverage():
    """Battery requires >=5 positive, >=8 negative, >=2 edge fixtures."""
    pos = [f for f in FIXTURES if f["category"] == "positive"]
    neg = [f for f in FIXTURES if f["category"] == "negative"]
    edge = [f for f in FIXTURES if f["category"] == "edge"]
    assert len(pos) >= 5, f"need >=5 positive fixtures, have {len(pos)}"
    assert len(neg) >= 8, f"need >=8 negative fixtures, have {len(neg)}"
    assert len(edge) >= 2, f"need >=2 edge fixtures, have {len(edge)}"


def test_narrative_richness():
    """Every body field >= 700 chars with real detection values woven in."""
    pos = [f for f in FIXTURES if f["category"] == "positive"]
    assert pos, "no positive fixtures"

    fixture = pos[0]
    bars = fixture["bars"]
    ctx = fixture.get("context") or build_context(bars, sym="TEST")
    detections = detect_major_trendlines(bars, ctx)
    assert detections, f"positive fixture {fixture['name']} did not fire"
    d = detections[0]
    narrative = d["narrative"]
    for field in ("headline", "what_it_is", "why_it_matters",
                  "what_to_watch_for", "failure_signal"):
        assert field in narrative, f"missing narrative.{field}"
        text = narrative[field]
        if field == "headline":
            assert len(text) >= 50, (
                f"narrative.{field} too short ({len(text)} chars): {text!r}"
            )
        else:
            assert len(text) >= 700, (
                f"narrative.{field} too short ({len(text)} chars): "
                f"{text[:120]!r}..."
            )


def test_geometry_extras_richness():
    """Detection geometry.extras must carry trendline math fields."""
    pos = [f for f in FIXTURES if f["category"] == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.get("context") or build_context(fixture["bars"], sym="TEST")
    detections = detect_major_trendlines(fixture["bars"], ctx)
    assert detections
    for d in detections:
        extras = d["geometry"]["extras"]
        required = (
            "line_type", "slope_pct_per_bar", "r_squared", "touches",
            "validity", "span_bars", "current_line_value",
            "current_distance_pct_from_price", "window_bars",
        )
        for key in required:
            assert key in extras, f"missing geometry.extras.{key}"

        assert extras["touches"] >= 3
        assert 0.7 <= extras["r_squared"] <= 1.0
        # Anchors: p1, p2, current value (3 anchors)
        anchors = d["geometry"]["anchors"]
        assert len(anchors) == 3
        for a in anchors:
            assert "t" in a and "price" in a


def test_levels_have_entry_stop_and_optional_target():
    """Per-trendline levels: entry placed correctly relative to line."""
    pos = [f for f in FIXTURES if f["category"] == "positive"]
    assert pos
    for fixture in pos:
        ctx = fixture.get("context") or build_context(fixture["bars"], sym="TEST")
        detections = detect_major_trendlines(fixture["bars"], ctx)
        assert detections, f"{fixture['name']} did not fire"
        for d in detections:
            extras = d["geometry"]["extras"]
            line_type = extras["line_type"]
            line_val = float(extras["current_line_value"])
            levels = d["levels"]
            entry = float(levels["entry"])
            stop = levels["stop"]

            if line_type == "rising_support":
                assert entry > line_val, (
                    f"rising_support entry {entry} should be > line {line_val}"
                )
                if stop is not None:
                    assert float(stop) < line_val, (
                        f"rising_support stop {stop} should be < line {line_val}"
                    )
            elif line_type == "falling_resistance":
                assert entry < line_val, (
                    f"falling_resistance entry {entry} should be < line {line_val}"
                )
                if stop is not None:
                    assert float(stop) > line_val, (
                        f"falling_resistance stop {stop} should be > line {line_val}"
                    )


def test_multi_emit_both_trendlines():
    """The both_trendlines fixture must emit exactly 2 Detections (one rising,
    one falling)."""
    matching = [f for f in FIXTURES if f["name"] == "both_trendlines"]
    assert matching, "both_trendlines fixture missing"
    fixture = matching[0]
    ctx = fixture.get("context") or build_context(fixture["bars"], sym="TEST")
    detections = detect_major_trendlines(fixture["bars"], ctx)
    assert len(detections) == 2, (
        f"both_trendlines should emit exactly 2 Detections, got {len(detections)}"
    )
    types = {d["geometry"]["extras"]["line_type"] for d in detections}
    assert "rising_support" in types, f"missing rising_support in {types}"
    assert "falling_resistance" in types, f"missing falling_resistance in {types}"
    # Direction-per-detection check
    directions = {d["geometry"]["extras"]["line_type"]: d["direction"]
                  for d in detections}
    assert directions["rising_support"] == "bullish"
    assert directions["falling_resistance"] == "bearish"
