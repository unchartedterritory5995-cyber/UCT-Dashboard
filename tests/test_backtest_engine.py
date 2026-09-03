from api.services.backtest_engine import simulate


def test_simulate_single_trade():
    """Buy at 100, sell at 110: profit 10%."""
    bars = [{"t": 1, "o": 100, "h": 100, "l": 100, "c": 100, "v": 0},
            {"t": 2, "o": 105, "h": 105, "l": 105, "c": 105, "v": 0},
            {"t": 3, "o": 110, "h": 110, "l": 110, "c": 110, "v": 0}]
    signals = [
        {"t": 1, "side": "long", "kind": "entry", "price": 100, "reason": "test"},
        {"t": 3, "side": "long", "kind": "exit", "price": 110, "reason": "test"},
    ]
    result = simulate(bars, signals, capital=10000, position_pct=100, fees_bps=0)
    assert len(result['trades']) == 1
    assert abs(result['trades'][0]['pnl_pct'] - 10.0) < 0.01


def test_simulate_no_trades_returns_flat_curve():
    bars = [{"t": i, "c": 100} for i in range(10)]
    result = simulate(bars, [], capital=10000, position_pct=100, fees_bps=0)
    assert len(result['trades']) == 0
    assert result['equity_curve'][0]['equity'] == 10000
    assert result['equity_curve'][-1]['equity'] == 10000


def test_simulate_fees_reduce_pnl():
    bars = [{"t": 1, "c": 100}, {"t": 2, "c": 110}]
    signals = [
        {"t": 1, "side": "long", "kind": "entry", "price": 100, "reason": ""},
        {"t": 2, "side": "long", "kind": "exit", "price": 110, "reason": ""},
    ]
    no_fees = simulate(bars, signals, capital=10000, position_pct=100, fees_bps=0)
    with_fees = simulate(bars, signals, capital=10000, position_pct=100, fees_bps=10)
    assert with_fees['final_equity'] < no_fees['final_equity']


def test_simulate_position_sizing():
    """Position pct affects PnL magnitude."""
    bars = [{"t": 1, "c": 100}, {"t": 2, "c": 110}]
    signals = [
        {"t": 1, "side": "long", "kind": "entry", "price": 100, "reason": ""},
        {"t": 2, "side": "long", "kind": "exit", "price": 110, "reason": ""},
    ]
    full = simulate(bars, signals, capital=10000, position_pct=100, fees_bps=0)
    half = simulate(bars, signals, capital=10000, position_pct=50, fees_bps=0)
    assert abs(full['final_equity'] - 11000) < 1
    assert abs(half['final_equity'] - 10500) < 1


def test_equity_curve_has_one_point_per_bar():
    bars = [{"t": i, "c": 100 + i} for i in range(10)]
    result = simulate(bars, [], 10000, 100, 0)
    assert len(result['equity_curve']) == 10


def test_force_exit_at_end_of_backtest():
    """Open position with no exit signal — simulator forces exit at last close."""
    bars = [{"t": 1, "c": 100}, {"t": 2, "c": 110}, {"t": 3, "c": 120}]
    signals = [{"t": 1, "side": "long", "kind": "entry", "price": 100, "reason": "open"}]
    result = simulate(bars, signals, 10000, 100, 0)
    assert len(result['trades']) == 1
    assert result['trades'][0]['exit_t'] == 3
    assert result['trades'][0]['exit_price'] == 120
    assert 'forced exit' in result['trades'][0]['reason_exit'].lower()


def test_duplicate_entry_ignored():
    bars = [{"t": 1, "c": 100}, {"t": 2, "c": 110}]
    signals = [
        {"t": 1, "side": "long", "kind": "entry", "price": 100, "reason": "first"},
        {"t": 1, "side": "long", "kind": "entry", "price": 105, "reason": "dup"},
    ]
    result = simulate(bars, signals, 10000, 100, 0)
    # only one position should open at the first entry; force-exit at bar 2
    assert len(result['trades']) == 1
    assert result['trades'][0]['entry_price'] == 100


# ---------------------------------------------------------------------------
# ⛔⛔ `side` WAS STORED ON EVERY RECORD AND READ BY NO ARITHMETIC.
#
# It rode in on every signal, was copied onto the position and onto the closed
# trade, and took no part in either P&L line. A short would have reported
# inverted profit and loss with no exception and no log line — the equity curve
# would simply have run the wrong way, plausibly.
#
# ⭐ The only thing that made it harmless was the producer: `_signal` in
# `strategy_templates` hardcodes "long". That is an accident of one line in
# another module, which is not a safety property. These rails hold both halves.
# ---------------------------------------------------------------------------


def _oscillating_bars(n: int = 420) -> list[dict]:
    """A price series that actually trips all four templates.

    ⛔ A flat series would make the producer rail below pass having generated no
    signals at all — the vacuity this repo keeps rediscovering. The sine period
    is short enough relative to `n` that the 50/200 SMA pair crosses more than
    once, so every generator has something to say.
    """
    import math
    out = []
    for i in range(n):
        p = 100.0 + 20.0 * math.sin(i * 2 * math.pi / 120.0) + i * 0.01
        out.append({"t": i + 1, "o": p, "h": p * 1.01, "l": p * 0.99, "c": p, "v": 1000})
    return out


def test_every_shipped_template_emits_a_side_this_engine_can_price():
    """⭐⭐ THE COUPLING, DERIVED — producer against engine, no typed list.

    The generators are found by name off the module, not enumerated here, so a
    fifth template goes through this check on the day it lands rather than the
    day someone remembers to add it. This is the assumption the whole long-only
    argument rests on, so it is measured rather than asserted.
    """
    import inspect

    from api.services import backtest_engine, strategy_templates

    bars = _oscillating_bars()
    generators = [
        fn for name, fn in inspect.getmembers(strategy_templates, inspect.isfunction)
        if name.startswith("generate_") and name.endswith("_signals")
    ]
    # ⛔ NON-VACUITY, BOTH WAYS: the generators were found, and they spoke.
    assert len(generators) >= 4, f"only found {len(generators)} signal generators"

    total = 0
    for fn in generators:
        signals = fn(bars)
        total += len(signals)
        for s in signals:
            assert s.get("side", "long") in backtest_engine.SUPPORTED_SIDES, (
                f"{fn.__name__} emits side {s.get('side')!r}, which "
                f"backtest_engine cannot price"
            )
    assert total > 0, "no template emitted a single signal; this rail proved nothing"


def test_an_unpriceable_side_is_refused_rather_than_silently_treated_as_long():
    """⭐ The refusal names the side and the bar, because 'invalid input' would
    leave the caller hunting for which signal in a 5,000-bar run was wrong."""
    import pytest

    bars = [{"t": 1, "c": 110}, {"t": 2, "c": 100}]
    signals = [{"t": 1, "side": "short", "kind": "entry", "price": 110, "reason": ""}]

    with pytest.raises(ValueError) as excinfo:
        simulate(bars, signals, 10000, 100, 0)
    message = str(excinfo.value)
    assert "short" in message
    assert "t=1" in message
    assert "long-only" in message


def test_a_long_entry_is_untouched_by_the_guard():
    """⛔ NON-VACUITY. Without this, a guard that refused every side would
    satisfy the test above."""
    bars = [{"t": 1, "c": 100}, {"t": 2, "c": 110}]
    signals = [
        {"t": 1, "side": "long", "kind": "entry", "price": 100, "reason": ""},
        {"t": 2, "side": "long", "kind": "exit", "price": 110, "reason": ""},
    ]
    result = simulate(bars, signals, 10000, 100, 0)
    assert len(result["trades"]) == 1
    assert result["trades"][0]["pnl_$"] > 0


def test_a_signal_with_no_side_at_all_still_simulates_as_long():
    """The default predates the guard and callers rely on it — a bare signal
    dict with no `side` key must keep working."""
    bars = [{"t": 1, "c": 100}, {"t": 2, "c": 110}]
    signals = [{"t": 1, "kind": "entry", "price": 100, "reason": ""},
               {"t": 2, "kind": "exit", "price": 110, "reason": ""}]
    result = simulate(bars, signals, 10000, 100, 0)
    assert len(result["trades"]) == 1
    assert result["trades"][0]["side"] == "long"


def test_the_arithmetic_really_is_long_only_which_is_WHY_the_guard_exists(monkeypatch):
    """⭐⭐ THE INVERSION, MEASURED — not claimed in a docstring.

    Widening `SUPPORTED_SIDES` alone (i.e. touching the guard without touching
    the arithmetic) reaches the P&L lines with a short. A short entered at 110
    and covered at 100 MADE ten dollars a share; this asserts the engine reports
    a LOSS, which is the defect the guard stands in front of.

    ⚠️ IF YOU IMPLEMENT SHORTS, THIS TEST IS YOUR CHECKLIST ITEM: it is meant to
    go red, and the fix is to assert a profit here, not to delete it. It exists
    so that widening the constant on its own can never be a quiet one-line
    change.
    """
    from api.services import backtest_engine

    monkeypatch.setattr(backtest_engine, "SUPPORTED_SIDES", ("long", "short"))

    bars = [{"t": 1, "c": 110}, {"t": 2, "c": 100}]
    signals = [
        {"t": 1, "side": "short", "kind": "entry", "price": 110, "reason": ""},
        {"t": 2, "side": "short", "kind": "exit", "price": 100, "reason": ""},
    ]
    result = backtest_engine.simulate(bars, signals, 10000, 100, 0)

    assert len(result["trades"]) == 1
    trade = result["trades"][0]
    assert trade["side"] == "short", "the record carries the side it was handed"
    # The profitable short is reported as a loss. That is the whole point.
    assert trade["pnl_$"] < 0
    assert result["final_equity"] < 10000
