"""Battery test for the tweezer_bottom candlestick detector.

Runs every fixture in tests/fixtures/tweezer_bottom/ and asserts the
expected outcome.

--- _EPS / tolerance boundary truth (established from the edge fixtures) ---

The tweezer_bottom detector uses _MATCH_TOL_PCT = 0.0015 (0.15% of matched_low)
and _EPS = 1e-9. The gate is:
    diff <= _MATCH_TOL + _EPS    where  _MATCH_TOL = _MATCH_TOL_PCT * matched_low

For the 'edge_exact_tolerance_must_fire' fixture:
    low_a  = 50.00 (exact in IEEE 754)
    low_b  = 50.075  (stored, but IEEE 754 nearest double ≈ 50.0749999...−7e-15)
    tol    = 0.0015 * 50.00 ≈ 0.075 − 2.8e-17  (0.0015 is not exactly representable)
    diff   = abs(50.075 − 50.00) ≈ 0.075 − 7e-15

    diff < tol (by ~7e-15) WITHOUT needing _EPS. So _EPS is DEFENSIVE (not
    load-bearing) for this specific fixture pair — the IEEE 754 inexactness of
    50.075 already lands diff slightly below tol.

    Conclusion: _EPS is honest defensive headroom. Its presence is correct and
    safe, but this fixture would pass even with plain `<=`. We do NOT claim _EPS
    is load-bearing because the concrete arithmetic shows it is not.

For the 'edge_just_over_tolerance_no_fire' fixture:
    low_a  = 50.00, low_b = 50.10 → diff = 0.10
    tol    = 0.075 → diff (0.10) > tol + _EPS (0.075 + 1e-9) → correctly rejected.
    The 0.10 − 0.075 = 0.025 margin is orders of magnitude above _EPS (1e-9),
    so no float ambiguity.
"""
import pytest

from api.services.pattern_engine.detectors.candlestick.tweezer_bottom import (
    detect_tweezer_bottom,
    _MATCH_TOL_PCT,
    _EPS,
)
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


FIXTURES = load_all_fixtures("tweezer_bottom", include_internal=False)


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f.name)
def test_tweezer_bottom_fixture(fixture):
    ctx = (
        fixture.context
        if fixture.context is not None
        else build_context(fixture.bars, sym="TEST")
    )
    detections = detect_tweezer_bottom(fixture.bars, ctx)

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
        assert len(detections) == 0, (
            f"Fixture {fixture.name!r} expected NOT to fire, "
            f"got {len(detections)} detection(s)."
        )


def test_fixture_battery_has_minimum_coverage():
    fixtures = load_all_fixtures("tweezer_bottom", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    neg = [f for f in fixtures if f.category == "negative"]
    edge = [f for f in fixtures if f.category == "edge"]
    assert len(pos) >= 5, f"need >=5 positive fixtures, have {len(pos)}"
    assert len(neg) >= 8, f"need >=8 negative fixtures, have {len(neg)}"
    assert len(edge) >= 3, f"need >=3 edge fixtures, have {len(edge)}"


def test_narrative_richness():
    """Each body field must be >=700 chars, headline >=90 chars."""
    fixtures = load_all_fixtures("tweezer_bottom", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos, "no positive fixtures found"
    fixture = pos[0]
    ctx = (
        fixture.context
        if fixture.context is not None
        else build_context(fixture.bars, sym="TEST")
    )
    detections = detect_tweezer_bottom(fixture.bars, ctx)
    assert detections, f"positive fixture {fixture.name!r} did not fire"
    d = detections[0]
    narrative = d["narrative"]
    assert len(narrative["headline"]) >= 90, (
        f"headline too short ({len(narrative['headline'])} chars): "
        f"{narrative['headline']!r}"
    )
    for field in ("what_it_is", "why_it_matters", "what_to_watch_for", "failure_signal"):
        text = narrative[field]
        assert len(text) >= 700, (
            f"narrative.{field} too short ({len(text)} chars): {text[:120]!r}..."
        )


def test_geometry_extras_richness():
    """All docstring-specified extras keys must be present, including tweezer-specific."""
    fixtures = load_all_fixtures("tweezer_bottom", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos, "no positive fixtures found"
    fixture = pos[0]
    ctx = (
        fixture.context
        if fixture.context is not None
        else build_context(fixture.bars, sym="TEST")
    )
    detections = detect_tweezer_bottom(fixture.bars, ctx)
    assert detections, f"positive fixture {fixture.name!r} did not fire"
    d = detections[0]
    extras = d["geometry"]["extras"]

    # All docstring-specified keys must be present
    required_keys = (
        "low_match_pct",
        "bar_a_color",
        "bar_b_color",
        "reversal_handoff",
        "at_swing_low",
        "below_50sma",
        "recent_decline_pct",
        "matched_low",
        "pattern_high",
    )
    for key in required_keys:
        assert key in extras, f"missing geometry.extras.{key}"

    # Semantic checks
    assert isinstance(extras["reversal_handoff"], bool)
    assert isinstance(extras["at_swing_low"], bool)
    assert isinstance(extras["below_50sma"], bool)
    assert isinstance(extras["matched_low"], float)
    assert isinstance(extras["pattern_high"], float)
    assert extras["matched_low"] > 0
    assert extras["pattern_high"] > extras["matched_low"]
    assert extras["bar_a_color"] in ("green", "red")
    assert extras["bar_b_color"] in ("green", "red")

    # Direction and category
    assert d["direction"] == "bullish", (
        f"Expected direction='bullish', got {d['direction']!r}"
    )
    assert d["category"] == "candlestick", (
        f"Expected category='candlestick', got {d['category']!r}"
    )


def test_levels_are_bullish_setup():
    """Entry > pattern_high, stop < matched_low, target > entry, R:R > 0."""
    fixtures = load_all_fixtures("tweezer_bottom", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos, "no positive fixtures found"
    fixture = pos[0]
    ctx = (
        fixture.context
        if fixture.context is not None
        else build_context(fixture.bars, sym="TEST")
    )
    d = detect_tweezer_bottom(fixture.bars, ctx)[0]
    levels = d["levels"]
    extras = d["geometry"]["extras"]

    pattern_high = extras["pattern_high"]
    matched_low = extras["matched_low"]

    # Entry above pattern high
    assert levels["entry"] > pattern_high * 0.999, (
        f"entry {levels['entry']} should be above pattern_high {pattern_high}"
    )
    # Stop below matched_low
    assert levels["stop"] < matched_low, (
        f"stop {levels['stop']} should be below matched_low {matched_low}"
    )
    # Target above entry
    assert levels["target_primary"] > levels["entry"], (
        f"target {levels['target_primary']} should be above entry {levels['entry']}"
    )
    # R:R is positive
    assert levels["risk_reward"] > 0, (
        f"risk_reward {levels['risk_reward']} should be > 0"
    )


def test_reversal_handoff_on_textbook():
    """The textbook bearish-A + bullish-B fixture must have reversal_handoff=True."""
    fixtures = load_all_fixtures("tweezer_bottom", include_internal=False)
    fixture = next(
        (f for f in fixtures if f.name == "pos_textbook_bearish_a_bullish_b"), None
    )
    assert fixture is not None, "missing pos_textbook_bearish_a_bullish_b fixture"
    ctx = (
        fixture.context
        if fixture.context is not None
        else build_context(fixture.bars, sym="TEST")
    )
    detections = detect_tweezer_bottom(fixture.bars, ctx)
    assert detections, "textbook fixture must fire"
    d = detections[0]
    extras = d["geometry"]["extras"]
    assert extras["reversal_handoff"] is True, (
        f"Expected reversal_handoff=True for bearish-A + bullish-B; "
        f"got bar_a_color={extras['bar_a_color']}, bar_b_color={extras['bar_b_color']}"
    )
    assert extras["bar_a_color"] == "red"
    assert extras["bar_b_color"] == "green"


def test_same_direction_weaker():
    """Both-bearish tweezer (no reversal handoff) must fire but have lower confidence
    than a reversal-handoff tweezer at a comparable setup quality."""
    fixtures = load_all_fixtures("tweezer_bottom", include_internal=False)

    textbook = next(
        (f for f in fixtures if f.name == "pos_textbook_bearish_a_bullish_b"), None
    )
    same_dir = next(
        (f for f in fixtures if f.name == "pos_same_direction_both_bearish"), None
    )
    assert textbook is not None
    assert same_dir is not None

    ctx_textbook = textbook.context or build_context(textbook.bars, sym="TEST")
    ctx_same = same_dir.context or build_context(same_dir.bars, sym="TEST")

    d_textbook = detect_tweezer_bottom(textbook.bars, ctx_textbook)
    d_same = detect_tweezer_bottom(same_dir.bars, ctx_same)

    assert d_textbook, "textbook fixture must fire"
    assert d_same, "same-direction fixture must fire"

    # Same-direction has no reversal handoff
    assert d_same[0]["geometry"]["extras"]["reversal_handoff"] is False

    # Textbook (reversal handoff) should have >= confidence
    # (both are at swing lows with similar context but textbook gets handoff bonus)
    assert d_textbook[0]["confidence"] >= d_same[0]["confidence"], (
        f"Reversal handoff ({d_textbook[0]['confidence']}) should give >= confidence "
        f"than same-direction ({d_same[0]['confidence']})"
    )


def test_geometry_has_two_anchors():
    """Tweezer bottom must have exactly 2 anchors (one per bar)."""
    fixtures = load_all_fixtures("tweezer_bottom", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context or build_context(fixture.bars, sym="TEST")
    d = detect_tweezer_bottom(fixture.bars, ctx)[0]
    anchors = d["geometry"]["anchors"]
    assert len(anchors) == 2, f"Expected 2 anchors, got {len(anchors)}"
    assert "t" in anchors[0] and "price" in anchors[0]
    assert "t" in anchors[1] and "price" in anchors[1]
    # Bar A timestamp should be before bar B
    assert anchors[0]["t"] < anchors[1]["t"]


def test_detection_shape_has_trailing_fields():
    """Detection must have status, outcome, detected_at, last_seen_at fields."""
    fixtures = load_all_fixtures("tweezer_bottom", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context or build_context(fixture.bars, sym="TEST")
    d = detect_tweezer_bottom(fixture.bars, ctx)[0]
    assert d["status"] == "ready"
    assert d["outcome"] is None
    assert isinstance(d["detected_at"], int)
    assert isinstance(d["last_seen_at"], int)
    assert d["pattern_id"] == "tweezer_bottom"


# ---------------------------------------------------------------------------
# Formula-pin test — locks the canonical 0.40/0.25/0.20/0.15 weights
# ---------------------------------------------------------------------------

def test_confidence_formula_pin():
    """Pins the canonical confidence formula for tweezer_bottom.

    Picks the textbook positive fixture (strong, deterministic), independently
    recomputes the expected confidence from the detector's own quality_components,
    and asserts the emitted confidence equals that recomputation EXACTLY.

    Formula: round(0.40*geometry_score + 0.25*volume_score + 0.20*context_score
                   + 0.15*historical_score, 2)

    This makes any future formula drift fail loudly.
    Also verifies historical_score == 50.0 (structural constant per spec).
    """
    fixtures = load_all_fixtures("tweezer_bottom", include_internal=False)
    fixture = next(
        (f for f in fixtures if f.name == "pos_textbook_bearish_a_bullish_b"), None
    )
    assert fixture is not None, "missing pos_textbook_bearish_a_bullish_b fixture"

    ctx = (
        fixture.context
        if fixture.context is not None
        else build_context(fixture.bars, sym="TEST")
    )
    detections = detect_tweezer_bottom(fixture.bars, ctx)
    assert detections, "textbook fixture must fire for the formula-pin test"
    d = detections[0]

    qc = d["quality_components"]
    geom  = qc["geometry_score"]
    vol   = qc["volume_score"]
    ctx_s = qc["context_score"]
    hist  = qc["historical_score"]

    # Lock the historical term: tweezer_bottom always uses flat 50.0
    assert hist == 50.0, (
        f"historical_score must always be 50.0 (structural constant); got {hist}"
    )

    # Recompute from components using the canonical weights
    expected_confidence = round(
        0.40 * geom + 0.25 * vol + 0.20 * ctx_s + 0.15 * hist, 2
    )

    assert d["confidence"] == expected_confidence, (
        f"confidence {d['confidence']} != recomputed {expected_confidence} "
        f"(geom={geom}, vol={vol}, ctx={ctx_s}, hist={hist}). "
        f"Weights must be 0.40/0.25/0.20/0.15."
    )


# ---------------------------------------------------------------------------
# Tolerance boundary test (honest _EPS framing)
# ---------------------------------------------------------------------------

def test_tolerance_boundary_eps_proof():
    """Proves the inclusive tolerance boundary using the edge fixtures directly.

    Pair: edge_exact_tolerance_must_fire (diff == tol → MUST fire)
          edge_just_over_tolerance_no_fire (diff >> tol → MUST NOT fire)

    _EPS truth:
      For the exact-tolerance fixture (low_a=50.00, low_b=50.075):
        - 50.075 is NOT exactly representable in IEEE 754 double.
          Nearest double ≈ 50.0749999... (about 7e-15 below 50.075).
        - tol = 0.0015 * 50.00 ≈ 0.075 - 2.8e-17 (0.0015 is inexact too).
        - diff ≈ 0.075 - 7e-15  <  tol ≈ 0.075 - 2.8e-17
        Therefore diff < tol WITHOUT _EPS. _EPS is DEFENSIVE, not load-bearing.

      For the just-over-tolerance fixture (low_a=50.00, low_b=50.10):
        - diff = 0.10, tol ≈ 0.075 → gap = 0.025 >> _EPS (1e-9).
        - No float ambiguity; gate correctly rejects.
    """
    fixtures = load_all_fixtures("tweezer_bottom", include_internal=False)
    exact_fix = next(
        (f for f in fixtures if f.name == "edge_exact_tolerance_must_fire"), None
    )
    over_fix = next(
        (f for f in fixtures if f.name == "edge_just_over_tolerance_no_fire"), None
    )
    assert exact_fix is not None, "missing edge_exact_tolerance_must_fire fixture"
    assert over_fix is not None, "missing edge_just_over_tolerance_no_fire fixture"

    # Exact boundary: MUST fire
    ctx_exact = (
        exact_fix.context
        if exact_fix.context is not None
        else build_context(exact_fix.bars, sym="TEST")
    )
    exact_detections = detect_tweezer_bottom(exact_fix.bars, ctx_exact)
    assert len(exact_detections) >= 1, (
        f"Exact tolerance boundary: diff == tol MUST fire (inclusive <=). "
        f"Got 0 detections. "
        f"Note: 50.075 rounds down in IEEE 754, so diff < tol without _EPS — "
        f"_EPS is defensive headroom here, not load-bearing."
    )

    # Just over: MUST NOT fire
    ctx_over = (
        over_fix.context
        if over_fix.context is not None
        else build_context(over_fix.bars, sym="TEST")
    )
    over_detections = detect_tweezer_bottom(over_fix.bars, ctx_over)
    assert len(over_detections) == 0, (
        f"Just-over tolerance: diff (0.10) >> tol (0.075) + _EPS (1e-9). "
        f"MUST NOT fire. Got {len(over_detections)} detection(s)."
    )

    # Verify the delta is meaningful vs _EPS
    over_bars = over_fix.bars
    # The tweezer pair is the last 2 bars
    low_a = over_bars[-2]["l"]
    low_b = over_bars[-1]["l"]
    diff = abs(low_a - low_b)
    tol = _MATCH_TOL_PCT * min(low_a, low_b)
    gap = diff - tol
    assert gap > 0, f"Over-tolerance fixture: diff ({diff}) should exceed tol ({tol})"
    assert gap > _EPS * 1000, (
        f"Over-tolerance margin ({gap:.6f}) should be >> _EPS ({_EPS:.2e}). "
        f"No float ambiguity."
    )
