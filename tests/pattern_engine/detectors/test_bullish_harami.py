"""Battery test for the bullish-harami candlestick detector."""
import pytest

from api.services.pattern_engine.detectors.candlestick.bullish_harami import detect_bullish_harami
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


FIXTURES = load_all_fixtures("bullish_harami", include_internal=False)


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f.name)
def test_bullish_harami_fixture(fixture):
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_bullish_harami(fixture.bars, ctx)

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
    fixtures = load_all_fixtures("bullish_harami", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    neg = [f for f in fixtures if f.category == "negative"]
    edge = [f for f in fixtures if f.category == "edge"]
    assert len(pos) >= 5, f"need >=5 positive fixtures, have {len(pos)}"
    assert len(neg) >= 8, f"need >=8 negative fixtures, have {len(neg)}"
    assert len(edge) >= 2, f"need >=2 edge fixtures, have {len(edge)}"


def test_narrative_richness():
    """Each body field must be >=700 chars, headline >=90 chars."""
    fixtures = load_all_fixtures("bullish_harami", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_bullish_harami(fixture.bars, ctx)
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
    fixtures = load_all_fixtures("bullish_harami", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    fixture = pos[0]
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_bullish_harami(fixture.bars, ctx)
    assert detections
    d = detections[0]
    extras = d["geometry"]["extras"]
    required = (
        "prev_bar_body_pct", "curr_bar_body_pct", "body_ratio", "inside_pct",
        "curr_bar_dcr", "volume_ratio", "at_swing_low",
    )
    for key in required:
        assert key in extras, f"missing geometry.extras.{key}"
    assert extras["body_ratio"] <= 0.50
    assert extras["prev_bar_body_pct"] >= 0.50
    assert d["direction"] == "bullish"
    assert d["category"] == "candlestick"


def test_levels_are_bullish_setup():
    fixtures = load_all_fixtures("bullish_harami", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    assert pos
    f = pos[0]
    ctx = f.context if f.context is not None else build_context(f.bars, sym="TEST")
    d = detect_bullish_harami(f.bars, ctx)[0]
    levels = d["levels"]
    last_bar = f.bars[-1]
    prev_bar = f.bars[-2]
    # Entry is just above prev bar open (the long red bar's open)
    assert levels["entry"] > prev_bar["o"] * 0.999
    # Stop is below prev bar low
    assert levels["stop"] < prev_bar["l"]
    assert levels["target_primary"] > levels["entry"]


# ---------------------------------------------------------------------------
# Reversal-context gate regression test
# ---------------------------------------------------------------------------

def test_no_reversal_context_never_fires():
    """Anti-fixture-masking guard for the reversal-context hard gate.

    Part 1 — strongest-geometry bullish harami in a clean mid-uptrend:
      Bar N-1 long red (body_pct 80%), bar N tiny green inside bar (ratio 0.10),
      perfectly centered. 50-bar uptrend with no swing low, price above rising
      SMA, <5% recent decline. Before the gate this would fire at high confidence.
      After: 0 detections.

    Part 2 — identical geometry WITH genuine reversal context (swing low after
      >5% decline). Must fire — proves the gate is context-selective.
    """
    T0 = 1700000000
    DT = 86400

    # ── Part 1: Strong harami geometry in clean uptrend → 0 detections ──────
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
    # Bar N-1: long red, body = 2.00, range = 2.50 → body_pct = 0.80
    bars_up.append({"t": t, "o": 101.00, "h": 101.25, "l": 98.75, "c": 99.00, "v": 1500.0})
    t += DT
    # Bar N: tiny green inside bar, body = 0.20 (10% of N-1's body), centered
    bars_up.append({"t": t, "o": 99.90, "h": 100.10, "l": 99.80, "c": 100.10, "v": 600.0})

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

    result_up = detect_bullish_harami(bars_up, uptrend_ctx)
    assert result_up == [], (
        "REGRESSION: strong-geometry bullish harami in clean uptrend must return 0 "
        "detections (reversal-context gate). "
        f"Got {len(result_up)} detection(s) with confidence "
        f"{[d['confidence'] for d in result_up]}. "
        "Before the gate this fires purely on geometry — the gate must block it."
    )

    # ── Part 2: Identical harami anatomy + reversal context → DOES fire ──────
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
    # Same harami pair at the bottom of the downtrend
    bars_dn.append({"t": t2, "o": 50.00, "h": 50.25, "l": 47.75, "c": 48.00, "v": 1500.0})
    t2 += DT
    bars_dn.append({"t": t2, "o": 48.90, "h": 49.10, "l": 48.80, "c": 49.10, "v": 600.0})

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

    result_dn = detect_bullish_harami(bars_dn, downtrend_ctx)
    assert len(result_dn) >= 1, (
        "Paired positive control (identical harami anatomy + reversal context) must fire. "
        "Got 0 detections. The reversal-context gate must be context-selective, "
        "not a blanket suppressor."
    )
    assert result_dn[0]["confidence"] >= 60.0, (
        f"Paired control with strong harami geometry + reversal context should fire with "
        f"confidence >= 60.0, got {result_dn[0]['confidence']}"
    )
