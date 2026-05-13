"""Battery test for the volume_profile_nodes structure detector.

Unlike single-Detection detectors, volume_profile_nodes emits ONE
Detection PER active HVN/LVN - so a chart with three HVNs and two LVNs
returns five Detections in a single call.
"""
import json
import os

import pytest

from api.services.pattern_engine.detectors.structure.volume_profile_nodes import (
    detect_volume_profile_nodes,
)
from api.services.pattern_engine.primitives.context import build_context


_FIXTURE_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..", "fixtures", "volume_profile_nodes",
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
def test_volume_profile_nodes_fixture(fixture):
    bars = fixture["bars"]
    ctx = fixture.get("context") or build_context(bars, sym="TEST")
    expected = fixture["expected"]

    detections = detect_volume_profile_nodes(bars, ctx)
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
            assert d["direction"] == "neutral"
            assert d["pattern_id"] == "volume_profile_nodes"
            assert d["geometry"]["shape"] == "horizontal_line"
            assert d["geometry"]["extras"]["node_type"] in ("HVN", "LVN")
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
    detections = detect_volume_profile_nodes(bars, ctx)
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
    """Detection geometry.extras must include the substantive fields callers expect."""
    pos = [f for f in FIXTURES if f["category"] == "positive"]
    assert pos
    for fixture in pos:
        bars = fixture["bars"]
        ctx = fixture.get("context") or build_context(bars, sym="TEST")
        detections = detect_volume_profile_nodes(bars, ctx)
        if not detections:
            continue
        for d in detections:
            extras = d["geometry"]["extras"]
            required = (
                "node_type", "volume_ratio", "price_min", "price_max",
                "price_mid", "bucket_volume", "percent_of_total_volume",
                "window_bars", "current_close",
            )
            for key in required:
                assert key in extras, f"missing geometry.extras.{key}"

            anchors = d["geometry"]["anchors"]
            assert len(anchors) == 2
            for a in anchors:
                assert "t" in a and "price" in a
                # Anchor price equals price_mid (small fp drift allowed)
                assert abs(a["price"] - extras["price_mid"]) < 0.01


def test_multi_detection_emission():
    """multiple_hvns fixture must emit >= 2 Detections (multi-emit verification)."""
    matching = [f for f in FIXTURES if f["name"] == "multiple_hvns"]
    assert matching, "multiple_hvns fixture missing"
    fixture = matching[0]
    ctx = fixture.get("context") or build_context(fixture["bars"], sym="TEST")
    detections = detect_volume_profile_nodes(fixture["bars"], ctx)
    assert len(detections) >= 2, (
        f"multiple_hvns should emit >= 2 Detections, got {len(detections)}"
    )


def test_hvn_levels_have_entry_stop():
    """HVN nodes must have entry > price_min and stop < price_min."""
    pos = [f for f in FIXTURES if f["category"] == "positive"]
    assert pos
    for fixture in pos:
        ctx = fixture.get("context") or build_context(fixture["bars"], sym="TEST")
        detections = detect_volume_profile_nodes(fixture["bars"], ctx)
        for d in detections:
            extras = d["geometry"]["extras"]
            if extras["node_type"] != "HVN":
                continue
            levels = d["levels"]
            assert levels["entry"] is not None, "HVN should have an entry"
            assert levels["stop"] is not None, "HVN should have a stop"
            assert float(levels["entry"]) > float(extras["price_min"]), (
                "HVN entry should be above price_min"
            )
            assert float(levels["stop"]) < float(extras["price_min"]), (
                "HVN stop should be below price_min"
            )
