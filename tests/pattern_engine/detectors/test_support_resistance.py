"""Battery test for the support_resistance structure detector.

Unlike single-Detection detectors, support_resistance emits ONE Detection
PER active level - so a chart with 3 S/R levels returns 3 Detections in a
single call. The fixture `expected` block accordingly carries:

  - fires: bool
  - min_count, max_count: range of expected Detections
  - min_confidence, max_confidence: per-Detection confidence band
  - expected_levels: optional list of {approx_price, type, tolerance_pct}

The test asserts:
  * count in [min_count, max_count]
  * every emitted Detection's confidence in [min_confidence, max_confidence]
  * every expected_level is matched by at least one emitted Detection within
    its tolerance_pct of the level price and of the same type
"""
import json
import os

import pytest

from api.services.pattern_engine.detectors.structure.support_resistance import (
    detect_support_resistance,
)
from api.services.pattern_engine.primitives.context import build_context


_FIXTURE_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..", "fixtures", "support_resistance",
)


def _load_fixtures():
    """Load all .json fixtures (excluding internal `_` files)."""
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
def test_support_resistance_fixture(fixture):
    bars = fixture["bars"]
    ctx = fixture.get("context") or build_context(bars, sym="TEST")
    expected = fixture["expected"]

    detections = detect_support_resistance(bars, ctx)
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
        # Per-Detection confidence band
        min_conf = float(expected.get("min_confidence", 0.0))
        max_conf = float(expected.get("max_confidence", 100.0))
        for d in detections:
            assert min_conf <= d["confidence"] <= max_conf, (
                f"Fixture {name!r}: confidence {d['confidence']:.1f} not in "
                f"band [{min_conf}, {max_conf}]"
            )
            # Structural detector basics
            assert d["category"] == "structure"
            assert d["direction"] == "neutral"
            assert d["pattern_id"] == "support_resistance"
            assert d["geometry"]["shape"] == "horizontal_line"

        # Expected levels matching
        for el in expected.get("expected_levels", []):
            approx_price = float(el["approx_price"])
            level_type = el["type"]
            tol_pct = float(el.get("tolerance_pct", 1.5))
            matched = False
            for d in detections:
                extras = d["geometry"]["extras"]
                d_price = float(extras["level_price"])
                d_type = str(extras["level_type"])
                if d_type != level_type:
                    continue
                if approx_price <= 0:
                    continue
                if abs(d_price - approx_price) / approx_price * 100.0 <= tol_pct:
                    matched = True
                    break
            assert matched, (
                f"Fixture {name!r}: expected_level "
                f"(price~={approx_price}, type={level_type}, tol={tol_pct}%) "
                f"not matched by any emitted Detection. "
                f"Emitted: "
                f"{[(d['geometry']['extras']['level_price'], d['geometry']['extras']['level_type']) for d in detections]}"
            )
    else:
        assert n == 0, (
            f"Fixture {name!r}: expected NO detections, got {n}: "
            f"{[(d['geometry']['extras']['level_price'], d['geometry']['extras']['level_type']) for d in detections]}"
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
    detections = detect_support_resistance(bars, ctx)
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
    fixture = pos[0]
    ctx = fixture.get("context") or build_context(fixture["bars"], sym="TEST")
    detections = detect_support_resistance(fixture["bars"], ctx)
    assert detections
    for d in detections:
        extras = d["geometry"]["extras"]
        required = (
            "level_type", "level_price", "touch_count",
            "high_count", "low_count", "age_bars", "avg_strength",
            "most_recent_touch_age_bars", "distance_from_current_pct",
            "cluster_band_pct", "window_bars",
        )
        for key in required:
            assert key in extras, f"missing geometry.extras.{key}"

        assert extras["touch_count"] >= 2
        assert extras["high_count"] + extras["low_count"] == extras["touch_count"]
        # Anchors: 2 anchors (oldest + most recent), both at level price
        anchors = d["geometry"]["anchors"]
        assert len(anchors) == 2
        for a in anchors:
            assert "t" in a and "price" in a
            # Anchor price equals the unrounded level price; extras stores
            # the rounded value, so we tolerate small floating-point drift.
            assert abs(a["price"] - extras["level_price"]) < 0.01


def test_levels_have_entry_stop_and_optional_target():
    """Per-level Detection: entry above support / below resistance, stop beyond level."""
    pos = [f for f in FIXTURES if f["category"] == "positive"]
    assert pos
    for fixture in pos:
        ctx = fixture.get("context") or build_context(fixture["bars"], sym="TEST")
        detections = detect_support_resistance(fixture["bars"], ctx)
        assert detections, f"{fixture['name']} did not fire"
        for d in detections:
            extras = d["geometry"]["extras"]
            level_price = float(extras["level_price"])
            level_type = extras["level_type"]
            levels = d["levels"]
            entry = float(levels["entry"])
            stop = float(levels["stop"])
            target = levels["target_primary"]

            if level_type == "support":
                assert entry > level_price, (
                    f"support entry {entry} should be > level {level_price}"
                )
                assert stop < level_price, (
                    f"support stop {stop} should be < level {level_price}"
                )
                if target is not None:
                    assert float(target) > level_price, (
                        "support target should be above the level (a resistance)"
                    )
            else:  # resistance
                assert entry < level_price, (
                    f"resistance entry {entry} should be < level {level_price}"
                )
                assert stop > level_price, (
                    f"resistance stop {stop} should be > level {level_price}"
                )
                if target is not None:
                    assert float(target) < level_price, (
                        "resistance target should be below the level (a support)"
                    )


def test_multi_detection_emission():
    """The clean_support_resistance fixture must emit >= 2 Detections."""
    matching = [f for f in FIXTURES if f["name"] == "clean_support_resistance"]
    assert matching, "clean_support_resistance fixture missing"
    fixture = matching[0]
    ctx = fixture.get("context") or build_context(fixture["bars"], sym="TEST")
    detections = detect_support_resistance(fixture["bars"], ctx)
    assert len(detections) >= 2, (
        f"clean_support_resistance should emit >= 2 Detections, got {len(detections)}"
    )
    # Should have at least one support and at least one resistance
    types = {d["geometry"]["extras"]["level_type"] for d in detections}
    assert "support" in types, f"missing support level in {types}"
    assert "resistance" in types, f"missing resistance level in {types}"
