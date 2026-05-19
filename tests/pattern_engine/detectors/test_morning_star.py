"""Battery test for the morning-star candlestick detector."""
import pytest

from api.services.pattern_engine.detectors.candlestick.morning_star import detect_morning_star
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


FIXTURES = load_all_fixtures("morning_star", include_internal=False)


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f.name)
def test_morning_star_fixture(fixture):
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_morning_star(fixture.bars, ctx)

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
    fixtures = load_all_fixtures("morning_star", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    neg = [f for f in fixtures if f.category == "negative"]
    edge = [f for f in fixtures if f.category == "edge"]
    assert len(pos) >= 5, f"need >=5 positive fixtures, have {len(pos)}"
    assert len(neg) >= 8, f"need >=8 negative fixtures, have {len(neg)}"
    assert len(edge) >= 2, f"need >=2 edge fixtures, have {len(edge)}"


def test_narrative_richness():
    """Each body field must be >=700 chars, headline >=90 chars."""
    fixtures = load_all_fixtures("morning_star", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_morning_star(fixture.bars, ctx)
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
    fixtures = load_all_fixtures("morning_star", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_morning_star(fixture.bars, ctx)
    assert detections
    d = detections[0]
    extras = d["geometry"]["extras"]
    required = (
        "b1_body_pct", "b2_body_pct", "b3_body_pct", "star_ratio",
        "midpoint_penetration", "gap_pct", "b1_dcr", "b2_dcr", "b3_dcr",
        "star_vol_ratio", "confirm_vol_ratio", "at_swing_low",
    )
    for key in required:
        assert key in extras, f"missing geometry.extras.{key}"
    assert extras["star_ratio"] <= 0.30
    assert extras["b1_body_pct"] >= 0.40
    assert extras["b3_body_pct"] >= 0.40
    assert extras["midpoint_penetration"] > 0.0
    assert d["direction"] == "bullish"
    assert d["category"] == "candlestick"
    # 3 anchors for 3-bar pattern
    assert len(d["geometry"]["anchors"]) == 3


def test_levels_are_bullish_setup():
    fixtures = load_all_fixtures("morning_star", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    f = pos[0]
    ctx = f.context if f.context is not None else build_context(f.bars, sym="TEST")
    d = detect_morning_star(f.bars, ctx)[0]
    levels = d["levels"]
    bar3 = f.bars[-1]
    # Entry just above bar 3 high
    assert levels["entry"] > bar3["h"] * 0.999
    # Stop below the 3-bar pattern low
    pattern_low = min(f.bars[-3]["l"], f.bars[-2]["l"], f.bars[-1]["l"])
    assert levels["stop"] < pattern_low
    assert levels["target_primary"] > levels["entry"]


# ---------------------------------------------------------------------------
# Reversal-context gate regression test
# ---------------------------------------------------------------------------

def test_no_reversal_context_never_fires():
    """Anti-fixture-masking guard for the reversal-context hard gate.

    Part 1 — strongest-geometry morning star in a clean mid-uptrend:
      Bar1: long red (body_pct 75%), bar2: tiny doji star (ratio 0.08),
      bar3: long green (body_pct 75%) closing deep past bar1 midpoint.
      50-bar uptrend with no swing low, price above rising SMA, <5% decline.
      Anchor = bar3 (index i). Before the gate this would fire at high confidence.
      After: 0 detections.

    Part 2 — identical geometry WITH genuine reversal context (swing low after
      >5% decline, anchor bar3 at bottom). Must fire — proves the gate is
      context-selective.
    """
    T0 = 1700000000
    DT = 86400

    # ── Part 1: Strong morning star geometry in clean uptrend → 0 detections ─
    bars_up = []
    t = T0
    n = 50
    start_p, end_p = 60.0, 100.0
    step = (end_p - start_p) / (n - 1)
    for k in range(n):
        mid = start_p + step * k
        bars_up.append({
            "t": t, "o": mid - 0.10, "h": mid + 0.15,
            "l": mid - 0.15, "c": mid + 0.10, "v": 1000.0,
        })
        t += DT
    # Bar1 (N-2): long red, body = 2.00 (75% of 2.60 range)
    bars_up.append({"t": t, "o": 101.80, "h": 102.10, "l": 99.50, "c": 99.80, "v": 1500.0})
    t += DT
    # Bar2 (N-1): tiny doji star, body = 0.10 (star_ratio ≈ 0.05 vs bar1)
    bars_up.append({"t": t, "o": 99.85, "h": 100.20, "l": 99.60, "c": 99.95, "v": 600.0})
    t += DT
    # Bar3 (N): long green closing well above bar1 midpoint (midpoint ≈ 100.80, close = 102.40)
    bars_up.append({"t": t, "o": 100.00, "h": 102.60, "l": 99.80, "c": 102.40, "v": 2000.0})

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

    result_up = detect_morning_star(bars_up, uptrend_ctx)
    assert result_up == [], (
        "REGRESSION: strong-geometry morning star in clean uptrend must return 0 "
        "detections (reversal-context gate). "
        f"Got {len(result_up)} detection(s) with confidence "
        f"{[d['confidence'] for d in result_up]}. "
        "Before the gate this fires purely on geometry — the gate must block it."
    )

    # ── Part 2: Identical 3-bar anatomy + reversal context → DOES fire ───────
    bars_dn = []
    t2 = T0
    n_dn = 20
    start_dn, end_dn = 65.0, 50.0
    step_dn = (end_dn - start_dn) / (n_dn - 1)
    for k in range(n_dn):
        mid = start_dn + step_dn * k
        bars_dn.append({
            "t": t2, "o": mid + 0.10, "h": mid + 0.15,
            "l": mid - 0.15, "c": mid - 0.10, "v": 1000.0,
        })
        t2 += DT
    # Bar1: long red at the bottom of the downtrend
    bars_dn.append({"t": t2, "o": 50.80, "h": 51.10, "l": 48.50, "c": 48.80, "v": 1500.0})
    t2 += DT
    # Bar2: tiny doji star (star_ratio ≈ 0.05)
    bars_dn.append({"t": t2, "o": 48.85, "h": 49.20, "l": 48.60, "c": 48.95, "v": 600.0})
    t2 += DT
    # Bar3: long green closing above bar1 midpoint (midpoint ≈ 49.80, close = 51.40)
    bars_dn.append({"t": t2, "o": 49.00, "h": 51.60, "l": 48.80, "c": 51.40, "v": 2000.0})

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

    result_dn = detect_morning_star(bars_dn, downtrend_ctx)
    assert len(result_dn) >= 1, (
        "Paired positive control (identical morning star anatomy + reversal context) must fire. "
        "Got 0 detections. The reversal-context gate must be context-selective, "
        "not a blanket suppressor."
    )
    assert result_dn[0]["confidence"] >= 70.0, (
        f"Paired control with strong morning star geometry + reversal context should fire with "
        f"confidence >= 70.0, got {result_dn[0]['confidence']}"
    )
