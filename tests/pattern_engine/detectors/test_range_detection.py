"""Battery test for the range_detection structure detector.

range_detection emits 0 or 1 Detection. The fixture `expected` block:
  {
    "fires": bool,
    "min_count": int (0 or 1),
    "max_count": int (0 or 1),
    "min_confidence": float (when fires),
    "max_confidence": float (when fires),
    "expected_duration_min": int (optional),
    "expected_depth_max_pct": float (optional),
  }
"""
import json
import os

import pytest

from api.services.pattern_engine.detectors.structure.range_detection import (
    detect_range_detection,
)
from api.services.pattern_engine.primitives.context import build_context


_FIXTURE_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..", "fixtures", "range_detection",
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
def test_range_detection_fixture(fixture):
    bars = fixture["bars"]
    ctx = fixture.get("context") or build_context(bars, sym="TEST")
    expected = fixture["expected"]

    detections = detect_range_detection(bars, ctx)
    n = len(detections)
    name = fixture["name"]

    min_count = int(expected.get("min_count", 0))
    max_count = int(expected.get("max_count", 0))

    if expected.get("fires", False):
        assert n >= min_count, (
            f"Fixture {name!r}: expected >= {min_count} detections, got {n}"
        )
        assert n <= max_count, (
            f"Fixture {name!r}: expected <= {max_count} detections, got {n}"
        )
        min_conf = float(expected.get("min_confidence", 0.0))
        max_conf = float(expected.get("max_confidence", 100.0))
        for d in detections:
            assert min_conf <= d["confidence"] <= max_conf, (
                f"Fixture {name!r}: confidence {d['confidence']:.1f} not in "
                f"band [{min_conf}, {max_conf}]"
            )
            assert d["category"] == "structure"
            assert d["pattern_id"] == "range_detection"
            assert d["direction"] == "neutral"
            assert d["geometry"]["shape"] == "rectangle"
            extras = d["geometry"]["extras"]
            for key in ("range_high", "range_low", "range_mid", "depth_pct",
                       "duration_bars", "high_touches", "low_touches"):
                assert key in extras, f"missing geometry.extras.{key}"

            # Duration check
            min_dur = expected.get("expected_duration_min")
            if min_dur is not None:
                assert extras["duration_bars"] >= min_dur, (
                    f"Fixture {name!r}: duration {extras['duration_bars']} "
                    f"< expected min {min_dur}"
                )
            # Depth check
            max_depth = expected.get("expected_depth_max_pct")
            if max_depth is not None:
                assert extras["depth_pct"] <= max_depth, (
                    f"Fixture {name!r}: depth {extras['depth_pct']:.2f}% "
                    f"> expected max {max_depth:.2f}%"
                )
            # Touch validation - at least 2 on each side
            assert extras["high_touches"] >= 2, (
                f"Fixture {name!r}: high_touches {extras['high_touches']} < 2"
            )
            assert extras["low_touches"] >= 2, (
                f"Fixture {name!r}: low_touches {extras['low_touches']} < 2"
            )
    else:
        assert n == 0, (
            f"Fixture {name!r}: expected NO detections, got {n}"
        )


def test_fixture_battery_has_minimum_coverage():
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
    detections = detect_range_detection(bars, ctx)
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


def test_levels_present_when_fires():
    """When range fires, entry/stop/target_primary/target_secondary all set."""
    for fixture in FIXTURES:
        if not fixture["expected"].get("fires", False):
            continue
        bars = fixture["bars"]
        ctx = fixture.get("context") or build_context(bars, sym="TEST")
        detections = detect_range_detection(bars, ctx)
        assert detections, f"{fixture['name']} did not fire"
        d = detections[0]
        levels = d["levels"]
        assert levels["entry"] is not None
        assert levels["stop"] is not None
        assert levels["target_primary"] is not None
        assert levels["target_secondary"] is not None
        # midpoint stop must sit between target_secondary and target_primary
        assert levels["target_secondary"] < levels["stop"] < levels["target_primary"]


def test_anchors_form_rectangle():
    """Rectangle geometry must have 4 corner anchors (high/low x start/end)."""
    for fixture in FIXTURES:
        if not fixture["expected"].get("fires", False):
            continue
        bars = fixture["bars"]
        ctx = fixture.get("context") or build_context(bars, sym="TEST")
        detections = detect_range_detection(bars, ctx)
        if not detections:
            continue
        d = detections[0]
        anchors = d["geometry"]["anchors"]
        assert len(anchors) == 4, (
            f"{fixture['name']}: expected 4 anchors, got {len(anchors)}"
        )
        # All anchors should have t + price
        for a in anchors:
            assert "t" in a and "price" in a
