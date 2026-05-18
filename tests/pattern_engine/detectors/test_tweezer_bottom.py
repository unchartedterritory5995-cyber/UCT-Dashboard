"""Battery test for the tweezer_bottom candlestick detector.

Runs every fixture in tests/fixtures/tweezer_bottom/ and asserts the
expected outcome.

--- _EPS / tolerance boundary truth (established by Python computation) ---

The tweezer_bottom detector uses _MATCH_TOL_PCT = 0.0015 (0.15% of matched_low)
and _EPS = 1e-9. The gate is:
    diff <= _MATCH_TOL + _EPS    where  _MATCH_TOL = _MATCH_TOL_PCT * matched_low

For the 'edge_exact_tolerance_must_fire' fixture (low_a=50.00, low_b=50.075):
    The IEEE 754 nearest double for 50.075 is 50.07500000000000284...
    (stores ABOVE the nominal 50.075 value).
    diff = abs(50.075 - 50.00) = 0.07500000000000284  (above 0.075 by ~2.84e-15)
    tol  = 0.0015 * 50.00     = 0.075                  (exact for this price)

    diff > tol by ~2.84e-15. WITHOUT _EPS the gate is:
        diff <= tol  →  0.075000...284 <= 0.075  →  FALSE → WRONGLY REJECTED.
    _EPS = 1e-9 >> 2.84e-15 makes the gate:
        diff <= tol + 1e-9  →  True → CORRECTLY ACCEPTED.

    Conclusion: _EPS IS LOAD-BEARING for this class of boundary values. It is
    not merely defensive — it is necessary. The gate would wrongly reject this
    exact-tolerance pair without it.

For the 'edge_just_over_tolerance_no_fire' fixture (low_a=50.00, low_b=50.10):
    diff = 0.10, tol ≈ 0.075. Gap = 0.025 >> _EPS (1e-9).
    No float ambiguity; gate correctly rejects.
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
    assert len(pos) >= 6, f"need >=6 positive fixtures, have {len(pos)}"
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

    _EPS truth (established by Python computation — see module docstring):
      For the exact-tolerance fixture (low_a=50.00, low_b=50.075):
        - 50.075 stores as IEEE 754 nearest double ≈ 50.07500000000000284...
          (ABOVE nominal, NOT below it).
        - diff = abs(50.075 - 50.00) = 0.07500000000000284  (> 0.075 by ~2.84e-15)
        - tol  = 0.0015 * 50.00 = 0.075
        - diff > tol → WITHOUT _EPS this pair is WRONGLY REJECTED.
        - _EPS = 1e-9 >> 2.84e-15 → gate passes correctly.
        _EPS IS LOAD-BEARING here, not merely defensive.

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
        f"Exact tolerance boundary: diff == nominal tol MUST fire (gate: diff <= tol + _EPS). "
        f"Got 0 detections. "
        f"IEEE 754: 50.075 stores ABOVE nominal so diff > tol by ~2.84e-15; "
        f"_EPS=1e-9 is load-bearing here — without it this pair would be wrongly rejected."
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

    # Verify the exact-tolerance boundary arithmetic explicitly
    exact_bars = exact_fix.bars
    low_a_exact = exact_bars[-2]["l"]
    low_b_exact = exact_bars[-1]["l"]
    diff_exact = abs(low_a_exact - low_b_exact)
    tol_exact = _MATCH_TOL_PCT * min(low_a_exact, low_b_exact)
    # _EPS must be the deciding factor: diff > tol but diff <= tol + _EPS
    assert diff_exact > tol_exact, (
        f"Exact-tolerance fixture: diff ({diff_exact:.20f}) should be > tol "
        f"({tol_exact:.20f}) — _EPS must be load-bearing"
    )
    assert diff_exact <= tol_exact + _EPS, (
        f"Exact-tolerance fixture: diff ({diff_exact:.20f}) should be <= "
        f"tol + _EPS ({tol_exact + _EPS:.20f})"
    )
    gap_exact = diff_exact - tol_exact
    assert 0 < gap_exact < _EPS, (
        f"Exact-tolerance gap ({gap_exact:.4e}) must satisfy 0 < gap < _EPS ({_EPS:.2e}): "
        f"confirms _EPS is load-bearing"
    )

    # Verify the over-tolerance gap is far above _EPS
    over_bars = over_fix.bars
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


# ---------------------------------------------------------------------------
# Reversal-context gate regression test
# ---------------------------------------------------------------------------

def test_no_reversal_context_never_fires():
    """Anti-fixture-masking guard for the reversal-context hard gate.

    Builds the adversarial construction in code (not from a fixture) and asserts
    0 detections regardless of how strong the geometry/volume is. This is exactly
    the construction the spec reviewer proved would fire at confidence=78.5 before
    the gate was added:

      geom=100 (diff=0, full reversal handoff), vol=100 (2× avg),
      ctx=30 (base only — clean Stage-2 uptrend, no swing low, not below 50SMA,
      decline < 5%), hist=50
      → 0.40*100 + 0.25*100 + 0.20*30 + 0.15*50 = 78.5 BEFORE gate

    After the gate: has_reversal_context = False → pair discarded → 0 detections.

    Also asserts the paired positive control (same geometry + volume but with a
    genuine swing low after >5% decline) DOES fire strongly — proves the gate
    is context-selective, not a blanket suppressor.
    """
    # ── Part 1: Strong geometry + clean uptrend → 0 detections ─────────────
    # 50-bar uptrend 60→100, pair at the top (price ~99-100)
    T0 = 1700000000
    DT = 86400
    bars_up = []
    t = T0
    n = 50
    start_p, end_p = 60.0, 100.0
    step = (end_p - start_p) / (n - 1)
    for i in range(n):
        mid = start_p + step * i
        bars_up.append({
            "t": t, "o": mid - 0.10, "h": mid + 0.15,
            "l": mid - 0.15, "c": mid + 0.10, "v": 1000.0,
        })
        t += DT
    # Bar A: bearish, low=99.00
    bars_up.append({"t": t, "o": 99.80, "h": 100.10, "l": 99.00, "c": 99.40, "v": 1000.0})
    t += DT
    # Bar B: bullish, diff=0 (perfect tight lows), 2× volume
    bars_up.append({"t": t, "o": 99.40, "h": 100.50, "l": 99.00, "c": 100.30, "v": 2000.0})

    uptrend_ctx = {
        "trend_stage": 2,
        "rs_trend": "up",
        "ma_alignment": "stacked_bullish",
        "volume_signature": "neutral",
        "regime": "bullish",
        "nearest_resistance": None,
        "nearest_support": None,
        "days_to_earnings": None,
        "sector_strength_rank": None,
    }

    # Anti-masking assertion: must return 0 detections because the reversal-
    # context gate rejects the pair (not because geometry was weakened).
    # BEFORE the gate was added this would fire at confidence=78.5.
    result_up = detect_tweezer_bottom(bars_up, uptrend_ctx)
    assert result_up == [], (
        "REGRESSION: strong-geometry clean-uptrend tweezer must return 0 detections "
        "(reversal-context gate). "
        f"Got {len(result_up)} detection(s) with confidence "
        f"{[d['confidence'] for d in result_up]}. "
        "Before the gate this fires at 78.5 — the gate must block it."
    )

    # ── Part 2: Identical geometry + reversal context → DOES fire ───────────
    # 20-bar downtrend 65→50, pair at the bottom — genuine swing low + >5% decline
    bars_dn = []
    t2 = T0
    n_dn = 20
    start_dn, end_dn = 65.0, 50.0
    step_dn = (end_dn - start_dn) / (n_dn - 1)
    for i in range(n_dn):
        mid = start_dn + step_dn * i
        bars_dn.append({
            "t": t2, "o": mid + 0.10, "h": mid + 0.15,
            "l": mid - 0.15, "c": mid - 0.10, "v": 1000.0,
        })
        t2 += DT
    # Bar A: bearish, low=48.00
    bars_dn.append({"t": t2, "o": 49.80, "h": 50.10, "l": 48.00, "c": 49.20, "v": 1000.0})
    t2 += DT
    # Bar B: bullish, diff=0 (perfect tight lows), 2× volume
    bars_dn.append({"t": t2, "o": 49.20, "h": 51.50, "l": 48.00, "c": 51.20, "v": 2000.0})

    downtrend_ctx = {
        "trend_stage": 4,
        "rs_trend": "down",
        "ma_alignment": "stacked_bearish",
        "volume_signature": "neutral",
        "regime": "bearish",
        "nearest_resistance": 65.0,
        "nearest_support": None,
        "days_to_earnings": None,
        "sector_strength_rank": None,
    }

    result_dn = detect_tweezer_bottom(bars_dn, downtrend_ctx)
    assert len(result_dn) >= 1, (
        "Paired positive control (identical geometry + reversal context) must fire. "
        "Got 0 detections. The reversal-context gate must be context-selective, "
        "not a blanket suppressor."
    )
    # Should fire strongly (context is rich: swing low + >5% decline)
    assert result_dn[0]["confidence"] >= 80.0, (
        f"Paired control with strong geometry + reversal context should fire with "
        f"confidence >= 80.0, got {result_dn[0]['confidence']}"
    )
