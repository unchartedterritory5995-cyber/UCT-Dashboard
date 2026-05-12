"""Battery test for the stage_analysis structure detector.

stage_analysis ALWAYS emits exactly ONE Detection summarizing the current
Weinstein stage (1-4). The fixture `expected` block carries:

  - fires: bool (always true)
  - expected_stage: int (1-4) OR None (when expected_stage_in is used)
  - expected_stage_in: list[int] (alternative when borderline could be 2+ stages)
  - min_confidence, max_confidence: confidence band
  - expected_direction: "bullish"|"bearish"|"neutral" (optional)
  - expected_direction_in: list[str] (alternative for borderline cases)
"""
import json
import os

import pytest

from api.services.pattern_engine.detectors.structure.stage_analysis import (
    detect_stage_analysis,
)
from api.services.pattern_engine.primitives.context import build_context


_FIXTURE_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..", "fixtures", "stage_analysis",
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
def test_stage_analysis_fixture(fixture):
    bars = fixture["bars"]
    ctx = fixture.get("context") or build_context(bars, sym="TEST")
    expected = fixture["expected"]

    detections = detect_stage_analysis(bars, ctx)
    n = len(detections)
    name = fixture["name"]

    # ALWAYS emits exactly one detection
    assert n == 1, (
        f"Fixture {name!r}: expected exactly 1 detection, got {n}"
    )
    d = detections[0]

    # Confidence band
    min_conf = float(expected.get("min_confidence", 0.0))
    max_conf = float(expected.get("max_confidence", 100.0))
    assert min_conf <= d["confidence"] <= max_conf, (
        f"Fixture {name!r}: confidence {d['confidence']:.1f} not in "
        f"band [{min_conf}, {max_conf}]"
    )

    # Structural detector basics
    assert d["category"] == "structure"
    assert d["pattern_id"] == "stage_analysis"
    assert d["geometry"]["shape"] == "candle_mark"

    extras = d["geometry"]["extras"]
    assert "stage_number" in extras
    assert extras["stage_number"] in (1, 2, 3, 4)

    # Stage match
    expected_stage = expected.get("expected_stage")
    expected_stage_in = expected.get("expected_stage_in")
    if expected_stage is not None:
        assert extras["stage_number"] == expected_stage, (
            f"Fixture {name!r}: expected stage {expected_stage}, got "
            f"{extras['stage_number']}"
        )
    elif expected_stage_in:
        assert extras["stage_number"] in expected_stage_in, (
            f"Fixture {name!r}: expected stage in {expected_stage_in}, got "
            f"{extras['stage_number']}"
        )

    # Direction match
    expected_direction = expected.get("expected_direction")
    expected_direction_in = expected.get("expected_direction_in")
    if expected_direction is not None:
        assert d["direction"] == expected_direction, (
            f"Fixture {name!r}: expected direction {expected_direction!r}, "
            f"got {d['direction']!r}"
        )
    elif expected_direction_in:
        assert d["direction"] in expected_direction_in, (
            f"Fixture {name!r}: expected direction in "
            f"{expected_direction_in}, got {d['direction']!r}"
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
    """Every body field >= 700 chars with real detection values woven in.

    Tests across ALL 4 stage branches so that each stage-specific narrative
    branch is exercised.
    """
    seen_stages = set()
    for fixture in FIXTURES:
        bars = fixture["bars"]
        ctx = fixture.get("context") or build_context(bars, sym="TEST")
        detections = detect_stage_analysis(bars, ctx)
        assert detections, f"{fixture['name']} did not fire"
        d = detections[0]
        stage = d["geometry"]["extras"]["stage_number"]
        seen_stages.add(stage)

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

    # All 4 stage branches exercised by at least one fixture
    assert seen_stages == {1, 2, 3, 4}, (
        f"narrative branches not all exercised; saw stages={sorted(seen_stages)}"
    )


def test_geometry_extras_richness():
    """Detection geometry.extras must include the substantive fields callers expect."""
    pos = [f for f in FIXTURES if f["category"] == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.get("context") or build_context(fixture["bars"], sym="TEST")
    detections = detect_stage_analysis(fixture["bars"], ctx)
    assert detections
    d = detections[0]
    extras = d["geometry"]["extras"]
    required = (
        "stage_number", "stage_name", "sma_50", "sma_200", "ema_20",
        "sma_50_slope_pct_per_bar", "ma_alignment", "current_close",
        "distance_to_50sma_pct", "regime", "window_bars",
    )
    for key in required:
        assert key in extras, f"missing geometry.extras.{key}"
    # Anchors: 1 anchor (current bar mark)
    anchors = d["geometry"]["anchors"]
    assert len(anchors) == 1
    assert "t" in anchors[0] and "price" in anchors[0]


def test_always_emits_exactly_one_detection():
    """The detector contract: ALWAYS exactly one Detection per call."""
    for fixture in FIXTURES:
        bars = fixture["bars"]
        ctx = fixture.get("context") or build_context(bars, sym="TEST")
        detections = detect_stage_analysis(bars, ctx)
        assert len(detections) == 1, (
            f"Fixture {fixture['name']}: expected 1 detection, got "
            f"{len(detections)}"
        )


def test_levels_by_stage():
    """Stage-specific level expectations: Stage 1 -> no stop/target,
    Stage 2 -> entry+stop+target, Stage 3 -> no levels,
    Stage 4 -> entry+stop, no target."""
    for fixture in FIXTURES:
        bars = fixture["bars"]
        ctx = fixture.get("context") or build_context(bars, sym="TEST")
        detections = detect_stage_analysis(bars, ctx)
        assert detections
        d = detections[0]
        stage = d["geometry"]["extras"]["stage_number"]
        levels = d["levels"]

        if stage == 1:
            assert levels["stop"] is None, (
                f"Stage 1 in {fixture['name']} should have no stop, got "
                f"{levels['stop']}"
            )
            assert levels["target_primary"] is None
        elif stage == 3:
            assert levels["entry"] is None or levels["stop"] is None, (
                f"Stage 3 in {fixture['name']} should not have entry+stop, "
                f"got entry={levels['entry']}, stop={levels['stop']}"
            )
            assert levels["target_primary"] is None
        elif stage == 4:
            # Stage 4 may have entry+stop, no target
            assert levels["target_primary"] is None, (
                f"Stage 4 in {fixture['name']} should have no target, got "
                f"{levels['target_primary']}"
            )
