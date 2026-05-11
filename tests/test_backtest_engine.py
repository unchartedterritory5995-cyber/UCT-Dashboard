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
