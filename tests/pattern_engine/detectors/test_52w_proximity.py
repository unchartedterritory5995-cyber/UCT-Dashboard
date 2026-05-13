"""Battery test for the 52w_proximity structure detector.

52w_proximity ALWAYS emits exactly ONE Detection summarizing the chart's
position relative to the 52-week high/low. The fixture `expected` block:
  {
    "fires": bool (always true unless bars empty),
    "expected_classification": "near_high"|"near_low"|"mid_range" OR
       "expected_classification_in": [list]
    "expected_direction": "bullish"|"bearish"|"neutral" OR
       "expected_direction_in": [list]
    "min_confidence": float,
    "max_confidence": float,
  }
"""
import json
import os

import pytest

from api.services.pattern_engine.detectors.structure.proximity_52w import (
    detect_52w_proximity,
)
from api.services.pattern_engine.primitives.context import build_context


_FIXTURE_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..", "fixtures", "52w_proximity",
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
def test_52w_proximity_fixture(fixture):
    bars = fixture["bars"]
    ctx = fixture.get("context") or build_context(bars, sym="TEST")
    expected = fixture["expected"]

    detections = detect_52w_proximity(bars, ctx)
    n = len(detections)
    name = fixture["name"]

    # Always emits exactly 1 detection
    assert n == 1, f"Fixture {name!r}: expected 1 detection, got {n}"
    d = detections[0]

    # Confidence band
    min_conf = float(expected.get("min_confidence", 0.0))
    max_conf = float(expected.get("max_confidence", 100.0))
    assert min_conf <= d["confidence"] <= max_conf, (
        f"Fixture {name!r}: confidence {d['confidence']:.1f} not in "
        f"band [{min_conf}, {max_conf}]"
    )

    # Basics
    assert d["category"] == "structure"
    assert d["pattern_id"] == "52w_proximity"
    assert d["geometry"]["shape"] == "candle_mark"

    extras = d["geometry"]["extras"]
    assert "classification" in extras
    assert extras["classification"] in ("near_high", "near_low", "mid_range")

    # Classification match
    expected_cls = expected.get("expected_classification")
    expected_cls_in = expected.get("expected_classification_in")
    if expected_cls is not None:
        assert extras["classification"] == expected_cls, (
            f"Fixture {name!r}: expected classification {expected_cls}, "
            f"got {extras['classification']} (dist_high="
            f"{extras['distance_from_high_pct']:.2f}%, dist_low="
            f"{extras['distance_from_low_pct']:.2f}%)"
        )
    elif expected_cls_in:
        assert extras["classification"] in expected_cls_in, (
            f"Fixture {name!r}: expected classification in {expected_cls_in}, "
            f"got {extras['classification']}"
        )

    # Direction match
    expected_dir = expected.get("expected_direction")
    expected_dir_in = expected.get("expected_direction_in")
    if expected_dir is not None:
        assert d["direction"] == expected_dir, (
            f"Fixture {name!r}: expected direction {expected_dir}, "
            f"got {d['direction']}"
        )
    elif expected_dir_in:
        assert d["direction"] in expected_dir_in, (
            f"Fixture {name!r}: expected direction in {expected_dir_in}, "
            f"got {d['direction']}"
        )


def test_fixture_battery_has_minimum_coverage():
    pos = [f for f in FIXTURES if f["category"] == "positive"]
    neg = [f for f in FIXTURES if f["category"] == "negative"]
    edge = [f for f in FIXTURES if f["category"] == "edge"]
    assert len(pos) >= 5, f"need >=5 positive fixtures, have {len(pos)}"
    assert len(neg) >= 8, f"need >=8 negative fixtures, have {len(neg)}"
    assert len(edge) >= 2, f"need >=2 edge fixtures, have {len(edge)}"


def test_narrative_richness():
    """Every body field >= 700 chars with real detection values woven in.

    Tests across ALL 3 classification branches (near_high, near_low,
    mid_range) so that each branch is exercised.
    """
    seen_classifications = set()
    for fixture in FIXTURES:
        bars = fixture["bars"]
        ctx = fixture.get("context") or build_context(bars, sym="TEST")
        detections = detect_52w_proximity(bars, ctx)
        assert detections, f"{fixture['name']} did not fire"
        d = detections[0]
        classification = d["geometry"]["extras"]["classification"]
        seen_classifications.add(classification)

        narrative = d["narrative"]
        for field in ("headline", "what_it_is", "why_it_matters",
                      "what_to_watch_for", "failure_signal"):
            assert field in narrative, f"missing narrative.{field}"
            text = narrative[field]
            if field == "headline":
                assert len(text) >= 50, (
                    f"narrative.{field} for {fixture['name']} too short "
                    f"({len(text)} chars): {text!r}"
                )
            else:
                assert len(text) >= 700, (
                    f"narrative.{field} for {fixture['name']} too short "
                    f"({len(text)} chars): {text[:120]!r}..."
                )

    # All 3 classification branches exercised
    assert seen_classifications == {"near_high", "near_low", "mid_range"}, (
        f"narrative branches not all exercised; saw "
        f"classifications={sorted(seen_classifications)}"
    )


def test_geometry_extras_richness():
    """Detection geometry.extras must include the substantive fields."""
    fixture = FIXTURES[0]
    bars = fixture["bars"]
    ctx = fixture.get("context") or build_context(bars, sym="TEST")
    detections = detect_52w_proximity(bars, ctx)
    assert detections
    d = detections[0]
    extras = d["geometry"]["extras"]
    required = (
        "high_52w", "low_52w", "current_close",
        "distance_from_high_pct", "distance_from_low_pct",
        "classification", "bars_since_52w_high", "bars_since_52w_low",
        "window_bars_used", "partial_window", "lookback_bars_target",
    )
    for key in required:
        assert key in extras, f"missing geometry.extras.{key}"


def test_always_emits_exactly_one_detection():
    """The detector contract: ALWAYS exactly one Detection per call."""
    for fixture in FIXTURES:
        bars = fixture["bars"]
        ctx = fixture.get("context") or build_context(bars, sym="TEST")
        detections = detect_52w_proximity(bars, ctx)
        assert len(detections) == 1, (
            f"Fixture {fixture['name']}: expected 1 detection, got "
            f"{len(detections)}"
        )


def test_levels_by_classification():
    """Classification-specific level expectations.

    near_high -> entry/stop/target set
    near_low -> entry/stop/target set
    mid_range -> all None
    """
    for fixture in FIXTURES:
        bars = fixture["bars"]
        ctx = fixture.get("context") or build_context(bars, sym="TEST")
        detections = detect_52w_proximity(bars, ctx)
        assert detections
        d = detections[0]
        classification = d["geometry"]["extras"]["classification"]
        levels = d["levels"]

        if classification == "mid_range":
            assert levels["entry"] is None, (
                f"{fixture['name']}: mid_range entry should be None, got "
                f"{levels['entry']}"
            )
            assert levels["stop"] is None
            assert levels["target_primary"] is None
        elif classification == "near_high":
            assert levels["entry"] is not None
            assert levels["stop"] is not None
            assert levels["target_primary"] is not None
            # target should be > entry (bullish bias)
            assert levels["target_primary"] > levels["entry"]
        elif classification == "near_low":
            assert levels["entry"] is not None
            assert levels["stop"] is not None
            assert levels["target_primary"] is not None
            # target should be < entry (bearish bias)
            assert levels["target_primary"] < levels["entry"]


def test_distance_calculations_correct():
    """Distance calculations must be internally consistent."""
    for fixture in FIXTURES:
        bars = fixture["bars"]
        ctx = fixture.get("context") or build_context(bars, sym="TEST")
        detections = detect_52w_proximity(bars, ctx)
        d = detections[0]
        extras = d["geometry"]["extras"]
        high = extras["high_52w"]
        low = extras["low_52w"]
        close = extras["current_close"]
        # Reconstruct expected distances within rounding tolerance
        exp_dh = (high - close) / high * 100.0
        exp_dl = (close - low) / low * 100.0
        assert abs(extras["distance_from_high_pct"] - exp_dh) < 0.01
        assert abs(extras["distance_from_low_pct"] - exp_dl) < 0.01
