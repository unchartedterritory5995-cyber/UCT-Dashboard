"""Battery test for the three-white-soldiers candlestick detector."""
import pytest

from api.services.pattern_engine.detectors.candlestick.three_white_soldiers import (
    detect_three_white_soldiers,
)
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


FIXTURES = load_all_fixtures("three_white_soldiers", include_internal=False)


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f.name)
def test_three_white_soldiers_fixture(fixture):
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_three_white_soldiers(fixture.bars, ctx)

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
    fixtures = load_all_fixtures("three_white_soldiers", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    neg = [f for f in fixtures if f.category == "negative"]
    edge = [f for f in fixtures if f.category == "edge"]
    assert len(pos) >= 5, f"need >=5 positive fixtures, have {len(pos)}"
    assert len(neg) >= 8, f"need >=8 negative fixtures, have {len(neg)}"
    assert len(edge) >= 2, f"need >=2 edge fixtures, have {len(edge)}"


def test_narrative_richness():
    """Each body field must be >=700 chars, headline >=90 chars."""
    fixtures = load_all_fixtures("three_white_soldiers", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_three_white_soldiers(fixture.bars, ctx)
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
    fixtures = load_all_fixtures("three_white_soldiers", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_three_white_soldiers(fixture.bars, ctx)
    assert detections
    d = detections[0]
    extras = d["geometry"]["extras"]
    required = (
        "body_pcts", "dcrs", "open_in_prior_body", "upper_wicks_pct",
        "advance_pcts", "volume_progression", "total_move_pct",
        "body_pct_avg", "at_swing_low", "climax_warning",
    )
    for key in required:
        assert key in extras, f"missing geometry.extras.{key}"
    assert len(extras["body_pcts"]) == 3
    assert len(extras["dcrs"]) == 3
    assert len(extras["upper_wicks_pct"]) == 3
    assert all(bp >= 0.60 for bp in extras["body_pcts"])
    assert all(d_ >= 0.70 for d_ in extras["dcrs"])
    assert all(uw <= 0.15 for uw in extras["upper_wicks_pct"])
    assert d["direction"] == "bullish"
    assert d["category"] == "candlestick"
    # 3 anchors for 3-bar pattern
    assert len(d["geometry"]["anchors"]) == 3


def test_levels_are_bullish_setup():
    fixtures = load_all_fixtures("three_white_soldiers", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    f = pos[0]
    ctx = f.context if f.context is not None else build_context(f.bars, sym="TEST")
    d = detect_three_white_soldiers(f.bars, ctx)[0]
    levels = d["levels"]
    bar3 = f.bars[-1]
    # Entry just above bar 3 high
    assert levels["entry"] > bar3["h"] * 0.999
    # Stop below the 3-bar body lows
    body_low = min(f.bars[-3]["l"], f.bars[-2]["l"])
    assert levels["stop"] < body_low
    assert levels["target_primary"] > levels["entry"]
    assert levels["risk_reward"] > 0.0


# ---------------------------------------------------------------------------
# Dual-gate behavioural tests (3 tests added for Phase 0 gate implementation)
# ---------------------------------------------------------------------------

def _make_bar(t: int, o: float, h: float, l: float, c: float, v: float = 1_000_000) -> dict:
    return {"t": t, "o": o, "h": h, "l": l, "c": c, "v": v}


def test_no_context_mid_trend_never_fires():
    """Strongest-geometry TWS planted mid clean Stage-2 uptrend must be suppressed.

    Conditions that MUST hold (validated via build_context):
      - trend_stage == 2   (57 rising bars + 7 flat → slope positive AND above long SMA)
      - is_swing_low == False   (pattern bars are at the top, not a swing low)
      - above_50sma == True     (price well above 50-bar SMA after long uptrend)
      - _recent_decline_pct < 0.03   (tiny soldiers → no meaningful pullback)
    All three reversal+continuation predicates False → gate fires → detections == [].
    """
    price = 100.0
    bars = []

    # 57 rising bars — price * 1.0045 per bar gives slow uptrend
    for k in range(57):
        p = price * (1.0045 ** k)
        bars.append(_make_bar(k, p, p * 1.002, p * 0.998, p * 1.001))

    # 7 flat bars at the top (prevents swing-low; avoids further gain to keep decline<3%)
    top = bars[-1]["c"]
    for k in range(7):
        t = 57 + k
        bars.append(_make_bar(t, top, top * 1.001, top * 0.999, top))

    # 3 small soldiers starting 1.5% ABOVE the flat bars.
    # This ensures soldier lows stay well above the flat bars' lows so that
    # the lookback window's low_min = flat bar lows and
    # (bar_low - low_min) / rng > 0.20 → is_swing_low = False.
    base = top * 1.015   # 1.5% step-up from flat zone
    rng = base * 0.006
    for k in range(3):
        t = 64 + k
        prev_c = bars[-1]["c"] if k > 0 else base
        b_l = prev_c * 0.9985   # tiny lower shadow, stays well above flat bars
        b_o = b_l + 0.25 * rng + 0.001   # float-safe nudge ensures body_pct > 0.60
        b_c = b_o + 0.62 * rng
        b_h = b_c + 0.13 * rng
        bars.append(_make_bar(t, b_o, b_h, b_l, b_c))

    ctx = build_context(bars, sym="PROBE")
    # Verify preconditions that make this a valid "should-block" scenario
    assert ctx["trend_stage"] == 2, f"Expected stage=2, got {ctx['trend_stage']}"
    result = detect_three_white_soldiers(bars, ctx)
    assert result == [], (
        f"Expected no detection mid-Stage-2 with no prior context, got {len(result)} detections"
    )


def test_continuation_breakout_still_fires():
    """TWS at Stage-1 base breakout must fire — proves dual gate preserves continuation.

    Use <50 bars so build_context returns trend_stage=1 (insufficient history for
    long SMA → falls back to stage 1). With stage=1, in_continuation_context=True
    regardless of other flags, so the gate passes.
    """
    # Build 25 flat/oscillating base bars (< 50 → build_context → stage=1)
    bars = []
    price = 50.0
    for k in range(25):
        # Slight up/down chop keeps it a base
        p = price * (1.001 if k % 2 == 0 else 0.999)
        bars.append(_make_bar(k, p, p * 1.005, p * 0.995, p))

    # 3 strong soldiers on top of the base
    base = bars[-1]["c"]
    rng = base * 0.020   # 2% range per bar — strong geometry
    for k in range(3):
        t = 25 + k
        prev_c = bars[-1]["c"]
        b_l = prev_c - 0.30 * rng
        b_o = b_l + 0.20 * rng + 0.001
        b_c = b_o + 0.70 * rng
        b_h = b_c + 0.10 * rng
        bars.append(_make_bar(t, b_o, b_h, b_l, b_c))

    ctx = build_context(bars, sym="PROBE")
    assert ctx["trend_stage"] == 1, f"Expected stage=1 (short series), got {ctx['trend_stage']}"
    result = detect_three_white_soldiers(bars, ctx)
    assert len(result) >= 1, (
        "Stage-1 base breakout TWS should fire (continuation gate passes) but got 0 detections"
    )


def test_reversal_context_still_fires():
    """TWS at genuine swing low after >5% decline must fire — proves reversal gate passes.

    25 rising bars followed by 12 declining bars creates:
      - _recent_decline_pct >= 0.05 from the peak → in_reversal_context=True
      - pattern bars are at the swing low → further confirms reversal context
    """
    bars = []
    # 25 rising bars up to ~130
    price = 100.0
    for k in range(25):
        p = price * (1.005 ** k)
        bars.append(_make_bar(k, p, p * 1.003, p * 0.997, p * 1.001))

    # 12 declining bars — ~8% pullback from peak
    peak = bars[-1]["c"]
    for k in range(12):
        p = peak * (0.993 ** (k + 1))
        bars.append(_make_bar(25 + k, p, p * 1.002, p * 0.998, p * 0.999))

    # 3 strong soldiers at the bottom
    bottom = bars[-1]["c"]
    rng = bottom * 0.020
    for k in range(3):
        t = 37 + k
        prev_c = bars[-1]["c"]
        b_l = prev_c - 0.30 * rng
        b_o = b_l + 0.20 * rng + 0.001
        b_c = b_o + 0.70 * rng
        b_h = b_c + 0.10 * rng
        bars.append(_make_bar(t, b_o, b_h, b_l, b_c))

    ctx = build_context(bars, sym="PROBE")
    result = detect_three_white_soldiers(bars, ctx)
    assert len(result) >= 1, (
        "Reversal TWS after >5% decline should fire but got 0 detections; "
        f"trend_stage={ctx['trend_stage']}"
    )
