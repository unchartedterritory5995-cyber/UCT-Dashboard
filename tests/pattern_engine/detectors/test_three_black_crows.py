"""Battery test for the three-black-crows candlestick detector."""
import pytest

from api.services.pattern_engine.detectors.candlestick.three_black_crows import (
    detect_three_black_crows,
)
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


FIXTURES = load_all_fixtures("three_black_crows", include_internal=False)


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f.name)
def test_three_black_crows_fixture(fixture):
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_three_black_crows(fixture.bars, ctx)

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
    fixtures = load_all_fixtures("three_black_crows", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    neg = [f for f in fixtures if f.category == "negative"]
    edge = [f for f in fixtures if f.category == "edge"]
    assert len(pos) >= 5, f"need >=5 positive fixtures, have {len(pos)}"
    assert len(neg) >= 8, f"need >=8 negative fixtures, have {len(neg)}"
    assert len(edge) >= 2, f"need >=2 edge fixtures, have {len(edge)}"


def test_narrative_richness():
    """Each body field must be >=700 chars, headline >=90 chars."""
    fixtures = load_all_fixtures("three_black_crows", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_three_black_crows(fixture.bars, ctx)
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
    fixtures = load_all_fixtures("three_black_crows", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_three_black_crows(fixture.bars, ctx)
    assert detections
    d = detections[0]
    extras = d["geometry"]["extras"]
    required = (
        "body_pcts", "dcrs", "open_in_prior_body", "lower_wicks_pct",
        "decline_pcts", "volume_progression", "total_move_pct",
        "body_pct_avg", "at_swing_high", "climax_warning",
    )
    for key in required:
        assert key in extras, f"missing geometry.extras.{key}"
    assert len(extras["body_pcts"]) == 3
    assert len(extras["dcrs"]) == 3
    assert len(extras["lower_wicks_pct"]) == 3
    assert all(bp >= 0.60 for bp in extras["body_pcts"])
    assert all(d_ <= 0.30 for d_ in extras["dcrs"])
    assert all(lw <= 0.15 for lw in extras["lower_wicks_pct"])
    assert d["direction"] == "bearish"
    assert d["category"] == "candlestick"
    # 3 anchors for 3-bar pattern
    assert len(d["geometry"]["anchors"]) == 3


def test_levels_are_bearish_setup():
    fixtures = load_all_fixtures("three_black_crows", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    f = pos[0]
    ctx = f.context if f.context is not None else build_context(f.bars, sym="TEST")
    d = detect_three_black_crows(f.bars, ctx)[0]
    levels = d["levels"]
    bar3 = f.bars[-1]
    # Entry just below bar 3 low
    assert levels["entry"] < bar3["l"] * 1.001
    # Stop above the 3-bar body highs
    body_high = max(f.bars[-3]["h"], f.bars[-2]["h"])
    assert levels["stop"] > body_high
    # Target should be below entry for bearish trade
    assert levels["target_primary"] < levels["entry"]
    assert levels["risk_reward"] > 0.0


# ---------------------------------------------------------------------------
# Dual-gate behavioural tests (3 tests added for Phase 0 gate implementation)
# ---------------------------------------------------------------------------

def _make_bar(t: int, o: float, h: float, l: float, c: float, v: float = 1_000_000) -> dict:
    return {"t": t, "o": o, "h": h, "l": l, "c": c, "v": v}


def test_no_context_mid_trend_never_fires():
    """Strongest-geometry TBC planted mid clean Stage-4 downtrend must be suppressed.

    Conditions that MUST hold (validated via build_context):
      - trend_stage == 4   (57 declining bars + 7 flat → slope negative AND below long SMA)
      - is_swing_high == False   (pattern bars are at the bottom, not a swing high)
      - above_50sma == False     (price well below 50-bar SMA after long downtrend)
      - _recent_advance_pct < 0.03   (tiny crows → no meaningful prior rally)
    All three reversal+continuation predicates False → gate fires → detections == [].
    """
    price = 100.0
    bars = []

    # 57 declining bars — price * 0.9955 per bar gives slow downtrend
    for k in range(57):
        p = price * (0.9955 ** k)
        bars.append(_make_bar(k, p, p * 1.002, p * 0.998, p * 0.999))

    # 7 flat bars at the bottom (prevents swing-high; avoids further fall to keep advance<3%)
    bottom = bars[-1]["c"]
    for k in range(7):
        t = 57 + k
        bars.append(_make_bar(t, bottom, bottom * 1.001, bottom * 0.999, bottom))

    # 3 small crows starting 1.5% BELOW the flat bars.
    # This ensures crow highs stay well below the flat bars' highs so that
    # the lookback window's high_max = flat bar highs and
    # (high_max - bar_high) / rng > 0.20 → is_swing_high = False.
    base = bottom * 0.985   # 1.5% step-down from flat zone
    rng = base * 0.006
    for k in range(3):
        t = 64 + k
        prev_c = bars[-1]["c"] if k > 0 else base
        b_h = prev_c * 1.0015   # tiny upper shadow, stays well below flat bars
        b_o = b_h - 0.13 * rng             # small upper wick from high to open
        b_c = b_o - 0.62 * rng             # body = 62% of rng (float-safe)
        b_l = b_c - 0.10 * rng             # lower wick = 10% of rng (satisfies <= 0.15)
        bars.append(_make_bar(t, b_o, b_h, b_l, b_c))

    ctx = build_context(bars, sym="PROBE")
    # Verify preconditions that make this a valid "should-block" scenario
    assert ctx["trend_stage"] == 4, f"Expected stage=4, got {ctx['trend_stage']}"
    result = detect_three_black_crows(bars, ctx)
    assert result == [], (
        f"Expected no detection mid-Stage-4 with no prior context, got {len(result)} detections"
    )


def test_continuation_breakout_still_fires():
    """TBC at Stage-3 distribution top must fire — proves dual gate preserves continuation.

    Build 55 rising bars + 7 flat at top + 3 strong crows, then inject trend_stage=3
    into the context dict. above_50=True from the prior rise → in_reversal_context=True
    (independent of the stage), so the gate passes cleanly. Injecting stage=3 also
    satisfies in_continuation_context=True for belt-and-suspenders.
    """
    bars = []
    price = 50.0

    # 55 rising bars
    for k in range(55):
        p = price * (1.004 ** k)
        bars.append(_make_bar(k, p, p * 1.003, p * 0.997, p * 1.001))

    # 7 flat bars at top
    top = bars[-1]["c"]
    for k in range(7):
        t = 55 + k
        bars.append(_make_bar(t, top, top * 1.001, top * 0.999, top))

    # 3 strong crows
    base = bars[-1]["c"]
    rng = base * 0.020
    for k in range(3):
        t = 62 + k
        prev_c = bars[-1]["c"]
        b_h = prev_c + 0.30 * rng
        b_o = b_h - 0.10 * rng + 0.001    # minimal upper wick
        b_c = b_o - 0.72 * rng             # strong body
        b_l = b_c - 0.08 * rng             # lower wick <= 0.10
        bars.append(_make_bar(t, b_o, b_h, b_l, b_c))

    ctx = build_context(bars, sym="PROBE")
    # Inject stage=3 so in_continuation_context is also True
    ctx = dict(ctx)
    ctx["trend_stage"] = 3

    result = detect_three_black_crows(bars, ctx)
    assert len(result) >= 1, (
        "Stage-3 distribution TBC should fire (continuation gate passes) but got 0 detections"
    )


def test_reversal_context_still_fires():
    """TBC at genuine swing high after >5% advance must fire — proves reversal gate passes.

    55 rising bars create:
      - _recent_advance_pct >= 0.05 from the 15-bar window low to pattern high → in_reversal_context=True
      - above_50sma=True from long uptrend → also in_reversal_context=True
    """
    bars = []
    price = 100.0

    # 55 rising bars to create a clear prior advance and put price above 50SMA
    for k in range(55):
        p = price * (1.005 ** k)
        bars.append(_make_bar(k, p, p * 1.003, p * 0.997, p * 1.001))

    # 3 strong crows at the top
    top = bars[-1]["c"]
    rng = top * 0.020
    for k in range(3):
        t = 55 + k
        prev_c = bars[-1]["c"]
        b_h = prev_c + 0.30 * rng
        b_o = b_h - 0.10 * rng + 0.001
        b_c = b_o - 0.72 * rng
        b_l = b_c - 0.08 * rng
        bars.append(_make_bar(t, b_o, b_h, b_l, b_c))

    ctx = build_context(bars, sym="PROBE")
    result = detect_three_black_crows(bars, ctx)
    assert len(result) >= 1, (
        "Reversal TBC after >5% advance should fire but got 0 detections; "
        f"trend_stage={ctx['trend_stage']}"
    )
