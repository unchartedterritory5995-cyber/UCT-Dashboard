"""
Backtest performance statistics.

Pure function — no side effects, no logging, no external imports beyond math.
"""
import math


def _max_dd(equity_curve: list[dict]) -> float:
    """Walk equity curve linearly, return max peak-to-trough drawdown as %."""
    if not equity_curve:
        return 0.0
    peak = equity_curve[0]['equity']
    max_dd = 0.0
    for point in equity_curve:
        eq = point['equity']
        if eq > peak:
            peak = eq
        if peak > 0:
            dd = (peak - eq) / peak * 100
            if dd > max_dd:
                max_dd = dd
    return max_dd


def _sharpe(equity_curve: list[dict]) -> float:
    """
    Annualized Sharpe (252 periods).
    Computes per-bar return (curr - prev) / prev, mean/std, × sqrt(252).
    Returns 0.0 if <2 returns or std == 0.
    """
    equities = [p['equity'] for p in equity_curve]
    if len(equities) < 2:
        return 0.0

    returns = []
    for i in range(1, len(equities)):
        prev = equities[i - 1]
        if prev != 0:
            returns.append((equities[i] - prev) / prev)

    n = len(returns)
    if n < 1:
        return 0.0

    mean = sum(returns) / n

    if n < 2:
        return 0.0

    variance = sum((r - mean) ** 2 for r in returns) / (n - 1)
    std = math.sqrt(variance)

    if std == 0:
        return 0.0

    return round(mean / std * math.sqrt(252), 4)


def compute_stats(trades: list[dict], equity_curve: list[dict]) -> dict:
    """
    Compute performance statistics from completed trades and equity curve.

    Args:
        trades:       List of trade dicts, each with at least 'pnl_pct' and 'pnl_$'.
        equity_curve: List of {'t': ..., 'equity': float} dicts in chronological order.

    Returns:
        Dict with n_trades, win_rate, avg_pnl_pct, avg_win_pct, avg_loss_pct,
        profit_factor, max_drawdown_pct, sharpe, best_trade_pct, worst_trade_pct.
    """
    n = len(trades)

    # max_drawdown always computed from equity curve
    max_drawdown = round(_max_dd(equity_curve), 4)
    sharpe = _sharpe(equity_curve)

    if n == 0:
        return {
            'n_trades': 0,
            'win_rate': 0.0,
            'avg_pnl_pct': 0.0,
            'avg_win_pct': 0.0,
            'avg_loss_pct': 0.0,
            'profit_factor': 0.0,
            'max_drawdown_pct': max_drawdown,
            'sharpe': sharpe,
            'best_trade_pct': 0.0,
            'worst_trade_pct': 0.0,
        }

    pnl_pcts = [t['pnl_pct'] for t in trades]
    pnl_dollars = [t['pnl_$'] for t in trades]

    wins = [t for t in trades if t['pnl_pct'] > 0]
    losses = [t for t in trades if t['pnl_pct'] <= 0]

    win_rate = round(len(wins) / n * 100, 2)
    avg_pnl_pct = round(sum(pnl_pcts) / n, 4)

    avg_win_pct = round(sum(t['pnl_pct'] for t in wins) / len(wins), 4) if wins else 0.0
    avg_loss_pct = round(sum(t['pnl_pct'] for t in losses) / len(losses), 4) if losses else 0.0

    gross_wins = sum(d for d in pnl_dollars if d > 0)
    gross_losses = abs(sum(d for d in pnl_dollars if d < 0))

    if gross_losses == 0:
        profit_factor = 999.0 if gross_wins > 0 else 0.0
    else:
        profit_factor = round(gross_wins / gross_losses, 4)

    best_trade_pct = round(max(pnl_pcts), 4)
    worst_trade_pct = round(min(pnl_pcts), 4)

    return {
        'n_trades': n,
        'win_rate': win_rate,
        'avg_pnl_pct': avg_pnl_pct,
        'avg_win_pct': avg_win_pct,
        'avg_loss_pct': avg_loss_pct,
        'profit_factor': profit_factor,
        'max_drawdown_pct': max_drawdown,
        'sharpe': sharpe,
        'best_trade_pct': best_trade_pct,
        'worst_trade_pct': worst_trade_pct,
    }
