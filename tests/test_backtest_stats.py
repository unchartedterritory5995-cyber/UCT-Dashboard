from api.services.backtest_stats import compute_stats


def test_no_trades_returns_zero_stats():
    stats = compute_stats(trades=[], equity_curve=[{"t": 1, "equity": 10000}])
    assert stats['n_trades'] == 0
    assert stats['win_rate'] == 0


def test_all_winning_trades_100_pct_win_rate():
    trades = [{'pnl_pct': 5.0, 'pnl_$': 500} for _ in range(5)]
    curve = [{"t": i, "equity": 10000 + i*100} for i in range(6)]
    stats = compute_stats(trades, curve)
    assert stats['win_rate'] == 100.0
    assert stats['n_trades'] == 5


def test_mixed_trades_win_rate():
    trades = [{'pnl_pct': 5, 'pnl_$': 5}, {'pnl_pct': -2, 'pnl_$': -2},
              {'pnl_pct': 3, 'pnl_$': 3}, {'pnl_pct': -1, 'pnl_$': -1}]
    curve = [{"t": i, "equity": 10000} for i in range(5)]
    stats = compute_stats(trades, curve)
    assert stats['win_rate'] == 50.0


def test_profit_factor():
    trades = [{'pnl_$': 100, 'pnl_pct': 1}, {'pnl_$': 50, 'pnl_pct': 0.5},
              {'pnl_$': -75, 'pnl_pct': -0.75}]
    curve = [{"t": i, "equity": 10000} for i in range(4)]
    stats = compute_stats(trades, curve)
    assert abs(stats['profit_factor'] - 2.0) < 0.01


def test_profit_factor_no_losses_is_inf():
    trades = [{'pnl_$': 100, 'pnl_pct': 1}]
    curve = [{"t": i, "equity": 10000} for i in range(2)]
    stats = compute_stats(trades, curve)
    assert stats['profit_factor'] == float('inf')


def test_max_drawdown():
    curve = [
        {"t": 1, "equity": 10000},
        {"t": 2, "equity": 11000},
        {"t": 3, "equity": 9000},  # 18.18% drawdown from 11k
        {"t": 4, "equity": 10500},
    ]
    stats = compute_stats([], curve)
    assert abs(stats['max_drawdown_pct'] - 18.1818) < 0.01


def test_sharpe_zero_when_flat():
    curve = [{"t": i, "equity": 10000} for i in range(10)]
    stats = compute_stats([], curve)
    assert stats['sharpe'] == 0.0


def test_best_and_worst_trade():
    trades = [{'pnl_pct': 5, 'pnl_$': 5}, {'pnl_pct': -3, 'pnl_$': -3},
              {'pnl_pct': 12, 'pnl_$': 12}, {'pnl_pct': -8, 'pnl_$': -8}]
    curve = [{"t": i, "equity": 10000} for i in range(5)]
    stats = compute_stats(trades, curve)
    assert stats['best_trade_pct'] == 12
    assert stats['worst_trade_pct'] == -8
