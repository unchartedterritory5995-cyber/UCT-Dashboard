"""Battery test for the hammer candlestick detector. Runs every fixture in
tests/fixtures/hammer/ and asserts the expected outcome.
"""
import pytest

from api.services.pattern_engine.detectors.candlestick.hammer import detect_hammer
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


FIXTURES = load_all_fixtures("hammer", include_internal=False)


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f.name)
def test_hammer_fixture(fixture):
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_hammer(fixture.bars, ctx)

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
    fixtures = load_all_fixtures("hammer", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    neg = [f for f in fixtures if f.category == "negative"]
    edge = [f for f in fixtures if f.category == "edge"]
    assert len(pos) >= 5, f"need >=5 positive fixtures, have {len(pos)}"
    assert len(neg) >= 8, f"need >=8 negative fixtures, have {len(neg)}"
    assert len(edge) >= 2, f"need >=2 edge fixtures, have {len(edge)}"


def test_narrative_richness():
    """Each body field must be >=700 chars, headline >=90 chars."""
    fixtures = load_all_fixtures("hammer", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_hammer(fixture.bars, ctx)
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
    fixtures = load_all_fixtures("hammer", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_hammer(fixture.bars, ctx)
    assert detections
    d = detections[0]
    extras = d["geometry"]["extras"]
    required = (
        "body_pct", "body_to_range_ratio", "upper_wick_pct", "lower_wick_pct",
        "lower_wick_body_ratio", "is_green", "at_swing_low",
    )
    for key in required:
        assert key in extras, f"missing geometry.extras.{key}"
    assert extras["lower_wick_body_ratio"] >= 2.0
    assert d["direction"] == "bullish"
    assert d["category"] == "candlestick"


def test_levels_are_bullish_setup():
    fixtures = load_all_fixtures("hammer", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    f = pos[0]
    ctx = f.context if f.context is not None else build_context(f.bars, sym="TEST")
    d = detect_hammer(f.bars, ctx)[0]
    levels = d["levels"]
    last_bar = f.bars[-1]
    # Entry above hammer high
    assert levels["entry"] > last_bar["h"] * 0.999
    # Stop below hammer low
    assert levels["stop"] < last_bar["l"]
    # Target above entry
    assert levels["target_primary"] > levels["entry"]


# ---------------------------------------------------------------------------
# Reversal-context gate regression test
# ---------------------------------------------------------------------------

def test_no_reversal_context_never_fires():
    """Anti-fixture-masking guard for the reversal-context hard gate.

    Builds the adversarial construction in code (not from a fixture) and asserts
    0 detections regardless of how strong the hammer geometry is.

    Part 1 — strong geometry in a clean mid-uptrend (no context):
      Perfect hammer anatomy (lower wick 4x body, minimal upper wick, small body)
      placed at the top of a 50-bar uptrend. No swing low, price well above the
      SMA (all bars rising), <5% recent decline. Before the gate this would fire
      at high confidence purely on geometry. After the gate: 0 detections.

    Part 2 — identical anatomy WITH genuine reversal context:
      Same hammer geometry placed at the bottom of a 20-bar downtrend (genuine
      swing low + >5% decline). Must fire strongly — proves the gate is
      context-selective, not a blanket suppressor.
    """
    T0 = 1700000000
    DT = 86400

    # ── Part 1: Strong hammer geometry in clean uptrend → 0 detections ──────
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
    # Perfect hammer: body=0.20 (o=100.20→c=100.40), lower_wick=1.20 (6x body),
    # upper_wick=0.05 (h=100.45 → 0.05 above close). Previously h=100.25 < c=100.40
    # was invalid OHLC and caused _try_extract to reject the bar before the gate ran.
    # With h=100.45 the geometry is valid: the gate (not the extractor) is what blocks it.
    bars_up.append({
        "t": t, "o": 100.20, "h": 100.45, "l": 99.00, "c": 100.40, "v": 2000.0,
    })

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

    result_up = detect_hammer(bars_up, uptrend_ctx)
    assert result_up == [], (
        "REGRESSION: strong-geometry hammer in clean uptrend must return 0 detections "
        "(reversal-context gate). "
        f"Got {len(result_up)} detection(s) with confidence "
        f"{[d['confidence'] for d in result_up]}. "
        "Before the gate this fires purely on geometry — the gate must block it."
    )

    # ── Part 2: Identical hammer anatomy + reversal context → DOES fire ──────
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
    # Same perfect hammer anatomy at the bottom of the downtrend
    bars_dn.append({
        "t": t2, "o": 49.20, "h": 49.25, "l": 48.00, "c": 49.40, "v": 2000.0,
    })

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

    result_dn = detect_hammer(bars_dn, downtrend_ctx)
    assert len(result_dn) >= 1, (
        "Paired positive control (identical hammer anatomy + reversal context) must fire. "
        "Got 0 detections. The reversal-context gate must be context-selective, "
        "not a blanket suppressor."
    )
    assert result_dn[0]["confidence"] >= 70.0, (
        f"Paired control with strong hammer anatomy + reversal context should fire with "
        f"confidence >= 70.0, got {result_dn[0]['confidence']}"
    )


# ---------------------------------------------------------------------------
# ADR-scaled decline threshold — regression test
# ---------------------------------------------------------------------------
#
# Independent blind-corpus evidence (lab/quality/blind_corpus/hammer,
# case_0022/NBR) found the decline branch of the reversal-context gate
# (dp >= _MIN_DECLINE_FOR_REVERSAL, a flat 5%) trivially satisfied by ordinary
# day-to-day chop in a high-ADR name, letting a hammer-shaped candle fire
# mid-uptrend on that branch alone — exactly the anti-pattern the gate's own
# docstring warns against. Fixed by requiring the decline to also clear 2x the
# stock's own trailing ADR when neither of the other two (stronger) context
# signals (at_swing_low / below_50sma) holds.

def test_high_adr_chop_alone_does_not_satisfy_decline_gate():
    """A high-ADR (volatile) name's ordinary chop can rack up a flat-5% 15-bar
    drawdown without ever being in a real downtrend — that alone must NOT
    satisfy the reversal-context gate once ADR-scaling is applied.
    """
    T0 = 1700000000
    DT = 86400

    # 39-bar choppy, mildly-rising name with a large daily range relative to
    # price (ADR ~3%, well above the 2.5% (=5%/2x) breakeven this test needs
    # to disprove). Bar count stays < 49 so `_below_sma50` is trivially False
    # (its own `i < 49: return False` guard) regardless of price level — the
    # test only needs to isolate the decline branch. One deliberately deep
    # "spike-low" bar sits inside the 10-bar swing-low lookback so the final
    # bar's low is provably NOT the window minimum (a candle whose low IS the
    # lowest in its own lookback trivially satisfies `_is_swing_low` by
    # construction, which would confound this test with a different gate
    # branch) — the final bar still clears the flat 5% decline floor against
    # the 15-bar high, purely via ordinary chop amplitude.
    bars = []
    t = T0
    base = 80.0
    n = 39
    for k in range(n):
        mid = base + k * 0.03  # gentle uptrend drift
        amp = 1.6  # +/- amplitude -> ~3.2 range on an ~81 base = ~4% single-bar range
        if k % 2 == 0:
            o, c, h, l = mid - 0.3, mid + amp * 0.5, mid + amp, mid - 0.4
        else:
            o, c, h, l = mid + 0.3, mid - amp * 0.5, mid + 0.4, mid - amp
        bars.append({"t": t, "o": o, "h": h, "l": l, "c": c, "v": 1_000_000.0})
        t += DT

    spike_idx = len(bars) - 6  # inside the 10-bar swing-low lookback, ahead of the final bar
    spike_mid = base + spike_idx * 0.03
    bars[spike_idx] = {
        "t": bars[spike_idx]["t"], "o": spike_mid, "h": spike_mid + 0.5,
        "l": spike_mid - 12.0, "c": spike_mid + 0.2, "v": 1_000_000.0,
    }

    # Final bar: perfect hammer anatomy, engineered so recent_decline_pct (15-bar
    # high to this bar's low) clears the flat 5% floor via ordinary chop alone.
    last_high_15 = max(b["h"] for b in bars[-14:])
    low_final = last_high_15 * 0.94  # ~6% drawdown from the 15-bar high
    bars.append({
        "t": t, "o": low_final + 0.30, "h": low_final + 0.35,
        "l": low_final, "c": low_final + 0.50, "v": 2_000_000.0,
    })

    ctx = {
        "trend_stage": 2, "rs_trend": "flat", "ma_alignment": "mixed",
        "volume_signature": "neutral", "regime": "neutral",
        "nearest_resistance": None, "nearest_support": None,
        "days_to_earnings": None, "sector_strength_rank": None,
    }

    from api.services.pattern_engine.detectors.candlestick.hammer import (
        _is_swing_low, _below_sma50, _recent_decline_pct, _adr_pct,
    )
    i = len(bars) - 1
    assert not _is_swing_low(bars, i), "test construction: must not be at a swing low"
    assert not _below_sma50(bars, i), "test construction: must not be below the 50-SMA"
    assert _recent_decline_pct(bars, i) >= 0.05, "test construction: must clear the flat 5% floor"
    assert _adr_pct(bars, i) >= 0.02, "test construction: must be a real high-ADR name"

    result = detect_hammer(bars, ctx)
    assert result == [], (
        "REGRESSION: a high-ADR name's ordinary chop satisfying only the flat "
        "5% decline floor (no swing low, no below-50sma) must NOT pass the "
        "reversal-context gate once the decline requirement is ADR-scaled. "
        f"Got {len(result)} detection(s)."
    )


def test_low_adr_flat_five_percent_decline_still_satisfies_gate():
    """A quiet, low-ADR name should still qualify on the flat 5% floor alone
    (2x its own tiny ADR is smaller than 5%, so the floor — not the ADR
    multiple — is the binding constraint, same as before this fix)."""
    T0 = 1700000000
    DT = 86400
    bars = []
    t = T0
    # Low-ADR (~1%) steady decline over 15 bars: 100 -> ~93 (7% decline),
    # comfortably clearing the flat 5% floor while ADR*2 (~2%) does not bind.
    for k in range(15):
        px = 100.0 - k * 0.5
        bars.append({
            "t": t, "o": px + 0.1, "h": px + 0.5, "l": px - 0.5, "c": px, "v": 500_000.0,
        })
        t += DT
    # Final bar: perfect hammer anatomy at the low.
    px = 93.0
    bars.append({
        "t": t, "o": px + 0.20, "h": px + 0.25, "l": px - 1.20, "c": px + 0.40, "v": 900_000.0,
    })

    ctx = {
        "trend_stage": 4, "rs_trend": "down", "ma_alignment": "stacked_bearish",
        "volume_signature": "neutral", "regime": "bearish",
        "nearest_resistance": None, "nearest_support": None,
        "days_to_earnings": None, "sector_strength_rank": None,
    }

    from api.services.pattern_engine.detectors.candlestick.hammer import (
        _adr_pct, _recent_decline_pct,
    )
    i = len(bars) - 1
    assert _adr_pct(bars, i) < 0.02, "test construction: must be a genuinely low-ADR name"
    assert _recent_decline_pct(bars, i) >= 0.05

    result = detect_hammer(bars, ctx)
    assert len(result) >= 1, (
        "A low-ADR name's real decline clearing the flat 5% floor must still "
        "satisfy the reversal-context gate (ADR-scaling must not raise the bar "
        "for names where 2x ADR is smaller than the flat floor)."
    )
