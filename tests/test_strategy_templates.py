"""Tests for strategy_templates.py — 4 signal generators + list_strategies."""

from api.services.strategy_templates import (
    generate_rsi_mean_reversion_signals,
    generate_macd_crossover_signals,
    generate_bb_breakout_signals,
    generate_ma_crossover_signals,
    list_strategies,
)


def _bar(t, o, h, l, c, v=1000):
    return {"t": t, "o": o, "h": h, "l": l, "c": c, "v": v}


def test_list_strategies_returns_4_templates():
    strats = list_strategies()
    assert len(strats) == 4
    assert all('id' in s and 'name' in s and 'description' in s for s in strats)


def test_rsi_mean_reversion_buys_on_oversold_reversal():
    """Crafted downtrend + uptick should trigger RSI buy."""
    closes = list(range(110, 80, -1)) + list(range(80, 95))  # down to 80, back to 95
    bars = [_bar(i * 86400, c, c+1, c-1, c) for i, c in enumerate(closes)]
    signals = generate_rsi_mean_reversion_signals(bars, period=14)
    entries = [s for s in signals if s['kind'] == 'entry']
    assert len(entries) >= 1


def test_macd_crossover_generates_signals():
    """Sinusoidal price should produce alternating MACD crosses."""
    import math
    bars = [_bar(i * 86400, 100, 102, 98, 100 + 10*math.sin(i / 5))
            for i in range(80)]
    signals = generate_macd_crossover_signals(bars)
    entries = [s for s in signals if s['kind'] == 'entry']
    exits = [s for s in signals if s['kind'] == 'exit']
    assert len(entries) > 0
    assert len(exits) > 0


def test_bb_breakout_generates_signals():
    closes = [100 + (i % 7) * 0.5 for i in range(40)] + [110, 115, 120]
    bars = [_bar(i * 86400, c, c+0.5, c-0.5, c) for i, c in enumerate(closes)]
    signals = generate_bb_breakout_signals(bars)
    assert any(s['kind'] == 'entry' for s in signals)


def test_ma_crossover_generates_golden_cross():
    """Sustained uptrend should produce SMA50 crossing above SMA200."""
    closes = list(range(100, 350))
    bars = [_bar(i * 86400, c, c+0.5, c-0.5, c) for i, c in enumerate(closes)]
    signals = generate_ma_crossover_signals(bars)
    entries = [s for s in signals if s['kind'] == 'entry']
    assert len(entries) >= 1


def test_signals_have_required_fields():
    closes = [100, 105, 102, 98, 95, 100, 110, 105, 95, 90, 85, 90, 95, 100, 110, 120, 115, 110]
    bars = [_bar(i * 86400, c, c+1, c-1, c) for i, c in enumerate(closes)]
    signals = generate_rsi_mean_reversion_signals(bars)
    for s in signals:
        assert 't' in s and 'kind' in s and 'side' in s and 'price' in s and 'reason' in s
