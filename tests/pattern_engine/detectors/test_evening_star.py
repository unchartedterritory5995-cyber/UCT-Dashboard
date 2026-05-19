"""Battery test for the evening-star candlestick detector."""
import pytest

from api.services.pattern_engine.detectors.candlestick.evening_star import detect_evening_star
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


# ---------------------------------------------------------------------------
# Reversal-context gate regression test
# ---------------------------------------------------------------------------

def test_no_reversal_context_never_fires():
    """Anti-fixture-masking guard for the reversal-context hard gate.

    Builds the adversarial construction in code (not from a fixture) and asserts
    0 detections regardless of how strong the geometry is. Constructs the
    strongest-possible Evening Star in a clean mid-downtrend (no swing high,
    close below 50SMA, <5% recent advance). Demonstrates that the gate blocks
    context-free candidates.

    Also asserts the paired positive control (same strong geometry in a genuine
    topping context: real swing high after >5% advance) DOES fire — proves the gate
    is context-selective, not a blanket suppressor.

    Anchor = bar3 (the completion bar). The advance window is bars[i-14:i+1]
    ending at bar3.
    """
    T0 = 1700000000
    DT = 86400

    # ── Part 1: Strongest geometry + clean downtrend -> 0 detections ──────
    # 60-bar downtrend 100->40. The 3-bar evening-star is placed at bars 57-59,
    # mid-fall so the 10-bar window high is well above bar3's high (not a swing
    # high), close is far below 50SMA, and the 15-bar advance anchor at bar3 is
    # <5% (monotone descent means the recent low ≈ bar3's own low).
    bars_dn = []
    t = T0
    n_dn = 60
    start_dn, end_dn = 100.0, 40.0
    step_dn = (end_dn - start_dn) / (n_dn - 1)
    for idx in range(n_dn - 3):
        mid = start_dn + step_dn * idx
        bars_dn.append({
            "t": t, "o": mid + 0.10, "h": mid + 0.20,
            "l": mid - 0.20, "c": mid - 0.10, "v": 1000.0,
        })
        t += DT
    # Price at bar 57 ≈ 42.54, bar 58 ≈ 41.52, bar 59 ≈ 40.51
    mid57 = start_dn + step_dn * (n_dn - 3)
    # bar1 (N-2): LONG GREEN; h=mid57+0.60 stays BELOW preceding bar highs (~43.25)
    # so bar_high = max(b1_h, b2_h, b3_h) never reaches the 10-bar window ceiling.
    bars_dn.append({"t": t, "o": mid57 - 0.50, "h": mid57 + 0.60, "l": mid57 - 0.60, "c": mid57 + 0.50, "v": 2000.0})
    t += DT
    # bar2 (N-1): STAR; body_pct=0.10 (doji), star_ratio=0.10/1.00=0.10 (well below _MAX=0.30)
    # h=mid57+0.80 — still below preceding bars' highs
    bars_dn.append({"t": t, "o": mid57 + 0.55, "h": mid57 + 0.80, "l": mid57 + 0.30, "c": mid57 + 0.60, "v": 800.0})
    t += DT
    # bar3 (N): LONG RED; close=mid57-0.60 below b1_midpoint=(mid57-0.50+mid57+0.50)/2=mid57
    # h=mid57+0.65 still below preceding bars' highs — no swing high detected
    bars_dn.append({"t": t, "o": mid57 + 0.55, "h": mid57 + 0.65, "l": mid57 - 0.80, "c": mid57 - 0.60, "v": 2500.0})

    downtrend_ctx = {
        "trend_stage": 4,
        "rs_trend": "down",
        "ma_alignment": "stacked_bearish",
        "volume_signature": "neutral",
        "regime": "bearish",
        "nearest_resistance": None,
        "nearest_support": None,
        "days_to_earnings": None,
        "sector_strength_rank": None,
        "dcr_signature": "distribution",
        "recent_dcr_avg": 0.3,
    }

    result_dn = detect_evening_star(bars_dn, downtrend_ctx)
    assert result_dn == [], (
        "REGRESSION: strong-geometry clean-downtrend evening star must return 0 detections "
        "(reversal-context gate). "
        f"Got {len(result_dn)} detection(s) with confidence "
        f"{[d['confidence'] for d in result_dn]}. "
        "The reversal-context gate must block an evening star in a mid-downtrend with no "
        "swing high, below 50SMA, and <5% recent advance."
    )

    # ── Part 2: Identical geometry + topping context -> DOES fire ─────────
    # 20-bar uptrend 35->52, evening-star sequence at the top — genuine swing high + >5% advance.
    bars_up = []
    t2 = T0
    n_up = 20
    start_up, end_up = 35.0, 52.0
    step_up = (end_up - start_up) / (n_up - 1)
    for i in range(n_up):
        mid = start_up + step_up * i
        bars_up.append({
            "t": t2, "o": mid - 0.10, "h": mid + 0.20,
            "l": mid - 0.20, "c": mid + 0.10, "v": 1000.0,
        })
        t2 += DT
    # bar1: LONG GREEN at top; open=50.00, close=52.00, body=2.00
    bars_up.append({"t": t2, "o": 50.00, "h": 52.25, "l": 49.75, "c": 52.00, "v": 2000.0})
    t2 += DT
    # bar2: STAR (doji); gapped up, small body
    bars_up.append({"t": t2, "o": 52.20, "h": 52.50, "l": 51.90, "c": 52.10, "v": 800.0})
    t2 += DT
    # bar3: LONG RED; close=50.50 (below bar1 midpoint=51.00), body=1.50
    bars_up.append({"t": t2, "o": 52.00, "h": 52.10, "l": 50.30, "c": 50.50, "v": 2500.0})

    uptrend_ctx = {
        "trend_stage": 2,
        "rs_trend": "up",
        "ma_alignment": "stacked_bullish",
        "volume_signature": "neutral",
        "regime": "bullish",
        "nearest_resistance": None,
        "nearest_support": 35.0,
        "days_to_earnings": None,
        "sector_strength_rank": None,
        "dcr_signature": "accumulation",
        "recent_dcr_avg": 0.65,
    }

    result_up = detect_evening_star(bars_up, uptrend_ctx)
    assert len(result_up) >= 1, (
        "Paired positive control (identical strong geometry + topping context) must fire. "
        "Got 0 detections. The reversal-context gate must be context-selective, "
        "not a blanket suppressor."
    )


FIXTURES = load_all_fixtures("evening_star", include_internal=False)


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f.name)
def test_evening_star_fixture(fixture):
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_evening_star(fixture.bars, ctx)

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
    fixtures = load_all_fixtures("evening_star", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    neg = [f for f in fixtures if f.category == "negative"]
    edge = [f for f in fixtures if f.category == "edge"]
    assert len(pos) >= 5, f"need >=5 positive fixtures, have {len(pos)}"
    assert len(neg) >= 8, f"need >=8 negative fixtures, have {len(neg)}"
    assert len(edge) >= 2, f"need >=2 edge fixtures, have {len(edge)}"


def test_narrative_richness():
    """Each body field must be >=700 chars, headline >=90 chars."""
    fixtures = load_all_fixtures("evening_star", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_evening_star(fixture.bars, ctx)
    assert detections, f"positive fixture {fixture.name} did not fire"
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
    fixtures = load_all_fixtures("evening_star", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_evening_star(fixture.bars, ctx)
    assert detections
    d = detections[0]
    extras = d["geometry"]["extras"]
    required = (
        "b1_body_pct", "b2_body_pct", "b3_body_pct", "star_ratio",
        "midpoint_penetration", "gap_pct", "b1_dcr", "b2_dcr", "b3_dcr",
        "star_vol_ratio", "confirm_vol_ratio", "at_swing_high",
    )
    for key in required:
        assert key in extras, f"missing geometry.extras.{key}"
    assert extras["star_ratio"] <= 0.30
    assert extras["b1_body_pct"] >= 0.40
    assert extras["b3_body_pct"] >= 0.40
    assert extras["midpoint_penetration"] > 0.0
    assert d["direction"] == "bearish"
    assert d["category"] == "candlestick"
    assert len(d["geometry"]["anchors"]) == 3


def test_levels_are_bearish_setup():
    fixtures = load_all_fixtures("evening_star", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    f = pos[0]
    ctx = f.context if f.context is not None else build_context(f.bars, sym="TEST")
    d = detect_evening_star(f.bars, ctx)[0]
    levels = d["levels"]
    bar3 = f.bars[-1]
    # Entry just below bar 3 low
    assert levels["entry"] < bar3["l"] * 1.001
    # Stop above the 3-bar pattern high
    pattern_high = max(f.bars[-3]["h"], f.bars[-2]["h"], f.bars[-1]["h"])
    assert levels["stop"] > pattern_high
    assert levels["target_primary"] < levels["entry"]
