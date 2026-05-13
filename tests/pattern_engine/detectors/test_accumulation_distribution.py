"""Battery test for the accumulation_distribution structure detector.

ALWAYS emits exactly ONE Detection (when len(bars) >= 30 and
sum_volume > 0). Phase classification: accumulation / distribution / neutral.
"""
import json
import os

import pytest

from api.services.pattern_engine.detectors.structure.accumulation_distribution import (
    detect_accumulation_distribution,
)
from api.services.pattern_engine.primitives.context import build_context


_FIXTURE_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..", "fixtures", "accumulation_distribution",
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
def test_accumulation_distribution_fixture(fixture):
    bars = fixture["bars"]
    ctx = fixture.get("context") or build_context(bars, sym="TEST")
    expected = fixture["expected"]

    detections = detect_accumulation_distribution(bars, ctx)
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
            assert d["pattern_id"] == "accumulation_distribution"
            assert d["geometry"]["shape"] == "candle_mark"
            extras = d["geometry"]["extras"]
            assert extras["phase"] in ("accumulation", "distribution", "neutral")

        expected_phase = expected.get("expected_phase")
        if expected_phase is not None:
            d = detections[0]
            actual_phase = d["geometry"]["extras"]["phase"]
            assert actual_phase == expected_phase, (
                f"Fixture {name!r}: expected phase={expected_phase}, got "
                f"{actual_phase} (ad_score="
                f"{d['geometry']['extras']['ad_score']})"
            )

        expected_div = expected.get("expected_divergence")
        if expected_div is not None:
            d = detections[0]
            actual_div = d["geometry"]["extras"]["divergence_type"]
            assert actual_div == expected_div, (
                f"Fixture {name!r}: expected divergence={expected_div}, got "
                f"{actual_div}"
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
    detections = detect_accumulation_distribution(bars, ctx)
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
    """Detection geometry.extras must include the substantive fields."""
    pos = [f for f in FIXTURES if f["category"] == "positive"]
    assert pos
    for fixture in pos:
        bars = fixture["bars"]
        ctx = fixture.get("context") or build_context(bars, sym="TEST")
        detections = detect_accumulation_distribution(bars, ctx)
        assert detections, f"{fixture['name']} did not fire"
        for d in detections:
            extras = d["geometry"]["extras"]
            required = (
                "ad_score", "phase", "divergence_type",
                "money_flow_30bar_sum", "volume_30bar_sum",
                "bullish_bars", "bearish_bars",
                "price_change_pct_30bar", "window_bars",
                "current_close",
            )
            for key in required:
                assert key in extras, f"missing geometry.extras.{key}"


def test_phase_directional_alignment():
    """Phase classification must align with direction field."""
    for fixture in FIXTURES:
        bars = fixture["bars"]
        ctx = fixture.get("context") or build_context(bars, sym="TEST")
        detections = detect_accumulation_distribution(bars, ctx)
        if not detections:
            continue
        d = detections[0]
        phase = d["geometry"]["extras"]["phase"]
        direction = d["direction"]
        if phase == "accumulation":
            assert direction == "bullish", (
                f"{fixture['name']}: accumulation should be bullish, got "
                f"{direction}"
            )
        elif phase == "distribution":
            assert direction == "bearish", (
                f"{fixture['name']}: distribution should be bearish, got "
                f"{direction}"
            )
        else:
            assert direction == "neutral", (
                f"{fixture['name']}: neutral phase should be neutral "
                f"direction, got {direction}"
            )
