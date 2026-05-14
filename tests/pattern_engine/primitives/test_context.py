from api.services.pattern_engine.primitives.context import build_context


def _bar(t, c, o=None, h=None, l=None, v=1000):
    o = o if o is not None else c
    h = h if h is not None else c + 1
    l = l if l is not None else c - 1
    return {"t": t, "o": o, "h": h, "l": l, "c": c, "v": v}


def test_build_context_returns_required_keys():
    bars = [_bar(i, 100 + i) for i in range(250)]
    ctx = build_context(bars, sym="AAPL")
    expected_keys = {
        "trend_stage", "rs_trend", "ma_alignment", "volume_signature",
        "regime", "nearest_resistance", "nearest_support",
        "days_to_earnings", "sector_strength_rank",
    }
    assert expected_keys.issubset(ctx.keys())


def test_strong_uptrend_classified_as_stage_2():
    """A sustained uptrend with rising 50 + 200 SMAs is Weinstein Stage 2."""
    bars = [_bar(i, 100 + i * 0.5) for i in range(300)]
    ctx = build_context(bars, sym="TEST")
    assert ctx["trend_stage"] == 2
    assert ctx["ma_alignment"] == "stacked_bullish"


def test_strong_downtrend_classified_as_stage_4():
    bars = [_bar(i, 200 - i * 0.4) for i in range(300)]
    ctx = build_context(bars, sym="TEST")
    assert ctx["trend_stage"] == 4
    assert ctx["ma_alignment"] == "stacked_bearish"


def test_volume_signature_propagated():
    """Bars with declining volume → context.volume_signature == 'contracting'."""
    bars = [_bar(i, 100, v=10000) for i in range(20)] + \
           [_bar(i + 20, 100, v=3000) for i in range(10)]
    ctx = build_context(bars, sym="TEST")
    assert ctx["volume_signature"] == "contracting"


def test_regime_hint_used():
    bars = [_bar(i, 100) for i in range(250)]
    ctx = build_context(bars, sym="TEST", regime_hint="bear")
    assert ctx["regime"] == "bear"


def test_handles_short_bars_gracefully():
    """Fewer than 200 bars → context still returns, with conservative defaults."""
    bars = [_bar(i, 100) for i in range(50)]
    ctx = build_context(bars, sym="TEST")
    # Should not crash; ma_alignment may be "mixed" without 200 SMA.
    assert ctx["ma_alignment"] in ("stacked_bullish", "mixed", "stacked_bearish")


def test_build_context_includes_dcr_fields():
    bars = [{"t": i, "o": 100, "h": 101, "l": 99, "c": 100.5, "v": 1000} for i in range(20)]
    ctx = build_context(bars, sym="TEST")
    assert "recent_dcr_avg" in ctx
    assert 0.0 <= ctx["recent_dcr_avg"] <= 1.0
    assert ctx["dcr_signature"] in ("accumulation", "distribution", "neutral")


def test_build_context_dcr_accumulation_signal():
    # Bars where close is near high consistently
    bars = [{"t": i, "o": 99, "h": 100, "l": 99, "c": 99.95, "v": 1000} for i in range(20)]
    ctx = build_context(bars, sym="TEST")
    assert ctx["dcr_signature"] == "accumulation"
    assert ctx["recent_dcr_avg"] > 0.7


def test_build_context_includes_can_slim_fields():
    """Phase 7.5: context now carries can_slim_grade + can_slim_score."""
    bars = [_bar(i, 100 + i * 0.5) for i in range(300)]
    ctx = build_context(bars, sym="TEST", regime_hint="bull")
    assert "can_slim_grade" in ctx
    assert "can_slim_score" in ctx
    assert ctx["can_slim_grade"] in ("A", "B", "C", "D")
    assert 0.0 <= ctx["can_slim_score"] <= 100.0


def test_build_context_strong_uptrend_can_slim_high():
    """A clean uptrend + bull regime should produce a B or A CAN SLIM grade."""
    bars = [_bar(i, 100 + i * 0.5, v=2_000_000) for i in range(300)]
    ctx = build_context(bars, sym="TEST", regime_hint="bull")
    assert ctx["can_slim_grade"] in ("A", "B")
    assert ctx["can_slim_score"] >= 60
