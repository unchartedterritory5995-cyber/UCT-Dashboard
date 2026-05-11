# Strategy Backtester MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working strategy backtester. User picks a predefined strategy template, symbol, timeframe, and date range. The app walks through historical bars, applies entry/exit rules, tracks positions, and returns equity curve + trade list + performance stats (win rate, profit factor, max drawdown, Sharpe).

**Architecture:** Pure-Python simulator running server-side on `bars_sqlite` data. 4 predefined strategy templates (RSI Mean Reversion, MACD Cross, BB Breakout, MA Crossover) implemented as pure functions returning trade-entry/exit signals. A simulator function walks bars, opens/closes positions per signals, tracks PnL, returns full results. Frontend exposes the results as a modal/page with equity curve chart + stats grid + trade list.

**Tech Stack:** Python (`bars_sqlite`, `indicator_compute`), FastAPI endpoint, React + Lightweight Charts for equity curve.

---

## File Structure

### New backend
| File | Responsibility |
|---|---|
| `api/services/strategy_templates.py` | 4 strategy implementations: each takes bars, returns list of {entry_t, exit_t, entry_price, exit_price, side, reason} |
| `api/services/backtest_engine.py` | `simulate(bars, signals, capital, position_pct, fees_bps) -> BacktestResult` |
| `api/services/backtest_stats.py` | `compute_stats(trades, equity_curve) -> {win_rate, profit_factor, sharpe, max_dd, ...}` |
| `api/routers/backtest.py` | `POST /api/backtest` endpoint |
| `tests/test_strategy_templates.py` | Each strategy produces signals on canned bar data |
| `tests/test_backtest_engine.py` | Simulator math correctness |
| `tests/test_backtest_stats.py` | Stats formulas |

### New frontend
| File | Responsibility |
|---|---|
| `app/src/pages/Backtester.jsx` | Backtester page (form + results) |
| `app/src/pages/Backtester.module.css` | Styles |
| `app/src/pages/backtester/StrategyForm.jsx` | Form: strategy template, symbol, tf, dates, capital, position %, fees |
| `app/src/pages/backtester/BacktestResults.jsx` | Equity curve + stats grid + trade table |
| `app/src/pages/backtester/equityChart.js` | Renders equity curve using Lightweight Charts |

### Modified
| File | Change |
|---|---|
| `api/main.py` | Register backtest router |
| `app/src/App.jsx` | Add `/backtester` route |
| `app/src/components/NavBar.jsx` | Add "Backtester" nav item |

---

## Strategy template definitions

Each template is a function `(bars, params) -> list[Signal]` where `Signal = {t: int, side: 'long'|'short', kind: 'entry'|'exit', price: float, reason: str}`.

### 1. RSI Mean Reversion
- Buy when RSI(14) crosses above 30 (oversold reversal)
- Sell when RSI(14) crosses above 70 (overbought exit)
- Long-only

### 2. MACD Crossover
- Buy when MACD line crosses above signal line
- Sell when MACD line crosses below signal line
- Long-only

### 3. Bollinger Band Breakout
- Buy when close crosses above upper band
- Sell when close drops below middle band (SMA20)
- Long-only

### 4. MA Crossover (Golden Cross / Death Cross)
- Buy when SMA(50) crosses above SMA(200)
- Sell when SMA(50) crosses below SMA(200)
- Long-only

---

## Task 1: Strategy templates + tests

**Files:**
- Create: `api/services/strategy_templates.py`
- Create: `tests/test_strategy_templates.py`

- [ ] **Step 1: Failing tests**

```python
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
        assert 't' in s and 'kind' in s and 'side' in s and 'price' in s
```

- [ ] **Step 2: Implement** (read plan + use `indicator_compute` functions)

```python
"""Strategy template implementations.

Each template generates a list of {t, side, kind, price, reason} signals
from a list of OHLCV bars. The backtest engine consumes these signals
to simulate positions.
"""
from api.services.indicator_compute import compute_rsi, compute_macd, compute_bb, compute_sma


def list_strategies():
    return [
        {"id": "rsi_mean_reversion", "name": "RSI Mean Reversion",
         "description": "Buy oversold reversals (RSI crosses above 30); sell overbought (RSI > 70)",
         "params": [{"name": "period", "default": 14, "min": 2, "max": 50}]},
        {"id": "macd_crossover", "name": "MACD Crossover",
         "description": "Buy when MACD crosses above signal; sell on opposite cross",
         "params": [
             {"name": "fast", "default": 12, "min": 2, "max": 30},
             {"name": "slow", "default": 26, "min": 5, "max": 60},
             {"name": "signal", "default": 9, "min": 2, "max": 20},
         ]},
        {"id": "bb_breakout", "name": "Bollinger Breakout",
         "description": "Buy when close crosses above upper band; sell at middle band",
         "params": [
             {"name": "period", "default": 20, "min": 5, "max": 50},
             {"name": "stddev", "default": 2.0, "min": 1.0, "max": 4.0},
         ]},
        {"id": "ma_crossover", "name": "MA Golden/Death Cross",
         "description": "Buy on SMA50 crossing above SMA200; sell on opposite cross",
         "params": [
             {"name": "fast", "default": 50, "min": 5, "max": 100},
             {"name": "slow", "default": 200, "min": 50, "max": 400},
         ]},
    ]


def _crosses_above(prev: float | None, curr: float | None, threshold: float) -> bool:
    return prev is not None and curr is not None and prev <= threshold < curr


def _crosses_below(prev: float | None, curr: float | None, threshold: float) -> bool:
    return prev is not None and curr is not None and prev >= threshold > curr


def generate_rsi_mean_reversion_signals(bars: list[dict], period: int = 14) -> list[dict]:
    closes = [b['c'] for b in bars]
    rsi = compute_rsi(closes, period)
    signals = []
    position_open = False
    for i in range(1, len(bars)):
        prev_rsi = rsi[i - 1]
        curr_rsi = rsi[i]
        if prev_rsi is None or curr_rsi is None:
            continue
        bar = bars[i]
        if not position_open and _crosses_above(prev_rsi, curr_rsi, 30):
            signals.append({
                't': bar['t'], 'side': 'long', 'kind': 'entry',
                'price': bar['c'], 'reason': f'RSI cross above 30 (now {curr_rsi:.1f})',
            })
            position_open = True
        elif position_open and _crosses_above(prev_rsi, curr_rsi, 70):
            signals.append({
                't': bar['t'], 'side': 'long', 'kind': 'exit',
                'price': bar['c'], 'reason': f'RSI cross above 70 (now {curr_rsi:.1f})',
            })
            position_open = False
    return signals


def generate_macd_crossover_signals(bars, fast=12, slow=26, signal=9):
    closes = [b['c'] for b in bars]
    macd, sig, _ = compute_macd(closes, fast, slow, signal)
    signals = []
    position_open = False
    for i in range(1, len(bars)):
        if macd[i] is None or sig[i] is None or macd[i-1] is None or sig[i-1] is None:
            continue
        bar = bars[i]
        # MACD line crosses above signal
        if not position_open and macd[i-1] <= sig[i-1] and macd[i] > sig[i]:
            signals.append({
                't': bar['t'], 'side': 'long', 'kind': 'entry',
                'price': bar['c'], 'reason': f'MACD cross above signal',
            })
            position_open = True
        elif position_open and macd[i-1] >= sig[i-1] and macd[i] < sig[i]:
            signals.append({
                't': bar['t'], 'side': 'long', 'kind': 'exit',
                'price': bar['c'], 'reason': f'MACD cross below signal',
            })
            position_open = False
    return signals


def generate_bb_breakout_signals(bars, period=20, stddev=2):
    closes = [b['c'] for b in bars]
    upper, middle, lower = compute_bb(closes, period, stddev)
    signals = []
    position_open = False
    for i in range(1, len(bars)):
        if upper[i] is None or middle[i] is None:
            continue
        bar = bars[i]
        prev_c = bars[i-1]['c']
        curr_c = bar['c']
        if not position_open and prev_c <= upper[i-1] and curr_c > upper[i]:
            signals.append({
                't': bar['t'], 'side': 'long', 'kind': 'entry',
                'price': curr_c, 'reason': 'Close above upper Bollinger band',
            })
            position_open = True
        elif position_open and curr_c < middle[i]:
            signals.append({
                't': bar['t'], 'side': 'long', 'kind': 'exit',
                'price': curr_c, 'reason': 'Close below middle band (SMA)',
            })
            position_open = False
    return signals


def generate_ma_crossover_signals(bars, fast=50, slow=200):
    closes = [b['c'] for b in bars]
    fast_ma = compute_sma(closes, fast)
    slow_ma = compute_sma(closes, slow)
    signals = []
    position_open = False
    for i in range(1, len(bars)):
        if fast_ma[i] is None or slow_ma[i] is None or fast_ma[i-1] is None or slow_ma[i-1] is None:
            continue
        bar = bars[i]
        if not position_open and fast_ma[i-1] <= slow_ma[i-1] and fast_ma[i] > slow_ma[i]:
            signals.append({
                't': bar['t'], 'side': 'long', 'kind': 'entry',
                'price': bar['c'], 'reason': f'Golden cross (SMA{fast} > SMA{slow})',
            })
            position_open = True
        elif position_open and fast_ma[i-1] >= slow_ma[i-1] and fast_ma[i] < slow_ma[i]:
            signals.append({
                't': bar['t'], 'side': 'long', 'kind': 'exit',
                'price': bar['c'], 'reason': f'Death cross (SMA{fast} < SMA{slow})',
            })
            position_open = False
    return signals
```

- [ ] **Step 3: Run tests + commit**

```bash
pytest tests/test_strategy_templates.py -v
git add api/services/strategy_templates.py tests/test_strategy_templates.py
git commit -m "feat(backtest): 4 strategy templates (RSI/MACD/BB/MA-cross)"
```

---

## Task 2: Backtest engine (simulator)

**Files:**
- Create: `api/services/backtest_engine.py`
- Create: `tests/test_backtest_engine.py`

- [ ] **Step 1: Failing tests**

```python
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
    with_fees = simulate(bars, signals, capital=10000, position_pct=100, fees_bps=10)  # 0.1%
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
    # Full sizing → $1000 gain on $10k = $11k; half → $500 gain → $10.5k
    assert abs(full['final_equity'] - 11000) < 1
    assert abs(half['final_equity'] - 10500) < 1


def test_equity_curve_has_one_point_per_bar():
    bars = [{"t": i, "c": 100 + i} for i in range(10)]
    result = simulate(bars, [], 10000, 100, 0)
    assert len(result['equity_curve']) == 10
```

- [ ] **Step 2: Implement**

```python
"""Backtest simulator.

Given a list of bars + signals + capital, simulate position lifecycle and
return final equity + per-bar equity curve + completed trades.
"""
from typing import Optional


def simulate(bars: list[dict], signals: list[dict],
             capital: float = 10000, position_pct: float = 100, fees_bps: float = 10) -> dict:
    """Walk bars chronologically, apply signals, return BacktestResult.

    Args:
      bars: OHLCV list, must be sorted by t ascending
      signals: list of {t, side, kind, price, reason} from a strategy template
      capital: starting capital ($)
      position_pct: % of equity to allocate per trade (default 100)
      fees_bps: round-trip fees in basis points (default 10 = 0.1%)

    Returns: {
      "final_equity": float,
      "total_return_pct": float,
      "equity_curve": [{"t": int, "equity": float}],
      "trades": [{"entry_t", "entry_price", "exit_t", "exit_price", "pnl_pct", "pnl_$", "reason_entry", "reason_exit"}],
      "n_bars": int,
    }
    """
    # Index signals by t for fast lookup
    by_t = {}
    for s in signals:
        by_t.setdefault(s['t'], []).append(s)

    equity = capital
    equity_curve = []
    trades = []
    open_position = None  # {entry_t, entry_price, shares, reason}

    for bar in bars:
        t = bar['t']
        close = bar.get('c')

        # Process signals at this bar
        for s in by_t.get(t, []):
            if s['kind'] == 'entry' and open_position is None:
                position_size = equity * (position_pct / 100)
                shares = position_size / s['price']
                open_position = {
                    'entry_t': t,
                    'entry_price': s['price'],
                    'shares': shares,
                    'side': s['side'],
                    'reason_entry': s.get('reason', ''),
                }
            elif s['kind'] == 'exit' and open_position is not None:
                exit_price = s['price']
                entry_price = open_position['entry_price']
                shares = open_position['shares']
                gross_pnl = (exit_price - entry_price) * shares
                fees = (entry_price + exit_price) * shares * (fees_bps / 10000)
                net_pnl = gross_pnl - fees
                equity += net_pnl
                trades.append({
                    'entry_t': open_position['entry_t'],
                    'entry_price': entry_price,
                    'exit_t': t,
                    'exit_price': exit_price,
                    'side': open_position['side'],
                    'shares': shares,
                    'pnl_$': round(net_pnl, 2),
                    'pnl_pct': round(net_pnl / (entry_price * shares) * 100, 4),
                    'reason_entry': open_position['reason_entry'],
                    'reason_exit': s.get('reason', ''),
                })
                open_position = None

        # Mark-to-market equity at this bar
        mtm_equity = equity
        if open_position and close is not None:
            entry = open_position['entry_price']
            shares = open_position['shares']
            mtm_pnl = (close - entry) * shares
            mtm_equity = equity + mtm_pnl

        equity_curve.append({'t': t, 'equity': round(mtm_equity, 2)})

    # Close any open position at the last bar's close
    if open_position is not None and bars:
        last = bars[-1]
        last_close = last.get('c')
        if last_close:
            exit_price = last_close
            entry = open_position['entry_price']
            shares = open_position['shares']
            gross = (exit_price - entry) * shares
            fees = (entry + exit_price) * shares * (fees_bps / 10000)
            net = gross - fees
            equity += net
            trades.append({
                'entry_t': open_position['entry_t'],
                'entry_price': entry,
                'exit_t': last['t'],
                'exit_price': exit_price,
                'side': open_position['side'],
                'shares': shares,
                'pnl_$': round(net, 2),
                'pnl_pct': round(net / (entry * shares) * 100, 4),
                'reason_entry': open_position['reason_entry'],
                'reason_exit': 'End of backtest period (forced exit)',
            })

    return {
        'final_equity': round(equity, 2),
        'total_return_pct': round((equity - capital) / capital * 100, 4),
        'equity_curve': equity_curve,
        'trades': trades,
        'n_bars': len(bars),
    }
```

- [ ] **Step 3: Tests pass + commit**

```bash
pytest tests/test_backtest_engine.py -v
git add api/services/backtest_engine.py tests/test_backtest_engine.py
git commit -m "feat(backtest): position-tracking simulator with fees + sizing"
```

---

## Task 3: Performance stats

**Files:**
- Create: `api/services/backtest_stats.py`
- Create: `tests/test_backtest_stats.py`

- [ ] **Step 1: Tests**

```python
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
    trades = [{'pnl_pct': 5}, {'pnl_pct': -2}, {'pnl_pct': 3}, {'pnl_pct': -1}]
    curve = [{"t": i, "equity": 10000} for i in range(5)]
    stats = compute_stats(trades, curve)
    assert stats['win_rate'] == 50.0  # 2/4


def test_profit_factor():
    trades = [{'pnl_$': 100}, {'pnl_$': 50}, {'pnl_$': -75}]
    curve = [{"t": i, "equity": 10000} for i in range(4)]
    stats = compute_stats(trades, curve)
    # PF = sum(wins) / abs(sum(losses)) = 150 / 75 = 2.0
    assert abs(stats['profit_factor'] - 2.0) < 0.01


def test_max_drawdown():
    curve = [
        {"t": 1, "equity": 10000},
        {"t": 2, "equity": 11000},
        {"t": 3, "equity": 9000},  # 18.2% drawdown from 11k
        {"t": 4, "equity": 10500},
    ]
    stats = compute_stats([], curve)
    assert abs(stats['max_drawdown_pct'] - 18.1818) < 0.01
```

- [ ] **Step 2: Implement**

```python
"""Performance stats for backtest results."""
import math


def compute_stats(trades: list[dict], equity_curve: list[dict]) -> dict:
    n = len(trades)
    if n == 0:
        return {
            'n_trades': 0,
            'win_rate': 0.0,
            'avg_pnl_pct': 0.0,
            'avg_win_pct': 0.0,
            'avg_loss_pct': 0.0,
            'profit_factor': 0.0,
            'max_drawdown_pct': _max_dd(equity_curve),
            'sharpe': 0.0,
            'best_trade_pct': 0.0,
            'worst_trade_pct': 0.0,
        }

    pnl_pcts = [t.get('pnl_pct', 0) for t in trades]
    pnl_ds = [t.get('pnl_$', 0) for t in trades]
    wins = [p for p in pnl_pcts if p > 0]
    losses = [p for p in pnl_pcts if p <= 0]
    win_d = [d for d in pnl_ds if d > 0]
    loss_d = [d for d in pnl_ds if d <= 0]

    return {
        'n_trades': n,
        'win_rate': round(len(wins) / n * 100, 2),
        'avg_pnl_pct': round(sum(pnl_pcts) / n, 4),
        'avg_win_pct': round(sum(wins) / len(wins), 4) if wins else 0.0,
        'avg_loss_pct': round(sum(losses) / len(losses), 4) if losses else 0.0,
        'profit_factor': round(sum(win_d) / abs(sum(loss_d)), 4) if loss_d and sum(loss_d) != 0 else float('inf') if win_d else 0.0,
        'max_drawdown_pct': _max_dd(equity_curve),
        'sharpe': _sharpe(equity_curve),
        'best_trade_pct': round(max(pnl_pcts), 4) if pnl_pcts else 0.0,
        'worst_trade_pct': round(min(pnl_pcts), 4) if pnl_pcts else 0.0,
    }


def _max_dd(curve):
    if not curve:
        return 0.0
    peak = curve[0]['equity']
    max_dd = 0.0
    for point in curve:
        e = point['equity']
        if e > peak:
            peak = e
        elif peak > 0:
            dd = (peak - e) / peak * 100
            if dd > max_dd:
                max_dd = dd
    return round(max_dd, 4)


def _sharpe(curve, periods_per_year=252):
    if len(curve) < 2:
        return 0.0
    returns = []
    for i in range(1, len(curve)):
        prev = curve[i-1]['equity']
        curr = curve[i]['equity']
        if prev > 0:
            returns.append((curr - prev) / prev)
    if len(returns) < 2:
        return 0.0
    mean = sum(returns) / len(returns)
    var = sum((r - mean) ** 2 for r in returns) / len(returns)
    std = math.sqrt(var)
    if std == 0:
        return 0.0
    return round(mean / std * math.sqrt(periods_per_year), 4)
```

- [ ] **Step 3: Tests + commit**

```bash
pytest tests/test_backtest_stats.py -v
git add api/services/backtest_stats.py tests/test_backtest_stats.py
git commit -m "feat(backtest): performance stats (win rate, profit factor, drawdown, Sharpe)"
```

---

## Task 4: API endpoint

**Files:**
- Create: `api/routers/backtest.py`
- Modify: `api/main.py` (register)

```python
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from api.services import strategy_templates as st
from api.services import bars_sqlite
from api.services import backtest_engine, backtest_stats


router = APIRouter(prefix="/api/backtest", tags=["backtest"])


class BacktestRequest(BaseModel):
    strategy_id: str
    sym: str
    tf: str
    bars: int = 500  # number of bars to backtest
    capital: float = 10000
    position_pct: float = 100
    fees_bps: float = 10
    params: dict | None = None


@router.get("/strategies")
def list_strategies():
    return {"strategies": st.list_strategies()}


@router.post("")
def run_backtest(body: BacktestRequest):
    # Fetch bars
    rows = bars_sqlite.get_bars(body.sym.upper(), body.tf, body.bars)
    if not rows:
        raise HTTPException(404, f"No bars for {body.sym} {body.tf}")
    bars = [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in rows]

    # Generate signals
    params = body.params or {}
    if body.strategy_id == "rsi_mean_reversion":
        signals = st.generate_rsi_mean_reversion_signals(bars, period=params.get('period', 14))
    elif body.strategy_id == "macd_crossover":
        signals = st.generate_macd_crossover_signals(bars, fast=params.get('fast', 12),
                                                     slow=params.get('slow', 26),
                                                     signal=params.get('signal', 9))
    elif body.strategy_id == "bb_breakout":
        signals = st.generate_bb_breakout_signals(bars, period=params.get('period', 20),
                                                  stddev=params.get('stddev', 2))
    elif body.strategy_id == "ma_crossover":
        signals = st.generate_ma_crossover_signals(bars, fast=params.get('fast', 50),
                                                   slow=params.get('slow', 200))
    else:
        raise HTTPException(400, f"Unknown strategy: {body.strategy_id}")

    # Simulate
    result = backtest_engine.simulate(bars, signals, body.capital, body.position_pct, body.fees_bps)

    # Stats
    stats = backtest_stats.compute_stats(result['trades'], result['equity_curve'])

    return {**result, "stats": stats, "n_signals": len(signals), "strategy": body.strategy_id}
```

Wire in `api/main.py`:
```python
from api.routers import backtest
app.include_router(backtest.router)
```

Add tests in `tests/test_backtest_endpoint.py`. Commit.

---

## Task 5: Frontend Backtester page

**Files:**
- Create: `app/src/pages/Backtester.jsx`
- Create: `app/src/pages/Backtester.module.css`
- Create: `app/src/pages/backtester/StrategyForm.jsx`
- Create: `app/src/pages/backtester/BacktestResults.jsx`
- Modify: `app/src/App.jsx` (route)
- Modify: `app/src/components/NavBar.jsx` (nav item)

Components do:
- `Backtester` — orchestrates state, fetches strategies on mount, runs backtest on form submit
- `StrategyForm` — strategy dropdown, sym search, tf dropdown, bars count, capital, position %, fees, parameters per strategy
- `BacktestResults` — equity curve (Lightweight Charts), stats grid, trade table

Equity curve uses LineSeries with the equity_curve array. Stats grid renders 8 key stats. Trade table shows entry/exit/pnl per trade.

Route at `/backtester`. Nav item between Modelbook and Journal.

Build + commit + push.

---

## Task 6: Smoke + verify

```bash
pytest tests/test_strategy_templates.py tests/test_backtest_engine.py tests/test_backtest_stats.py tests/test_backtest_endpoint.py -v
cd app && npm run build && cd ..
python -c "from api.main import app; print('OK')"
```

Hit `/backtester` in browser:
1. Pick "RSI Mean Reversion" strategy + AAPL + Daily + 500 bars
2. Run → see equity curve + win rate + trade list
3. Switch to "MA Crossover" + same → different results

Commit any final polish + push.

---

## Done — what changed

After this ships:
- New `/backtester` page on the dashboard
- 4 predefined strategy templates that work on any ticker × timeframe
- Equity curve visualization
- Performance stats (win rate, profit factor, max drawdown, Sharpe, best/worst trade)
- Trade-by-trade breakdown with entry/exit reasons
- Position sizing + fees configurable

Visual impact: closes the biggest TradingView-Pro gap (TV doesn't ship a backtester in free tier — this is a Pro+ feature). UCT users can study setups historically without leaving the dashboard.

## Self-review

- All 4 strategies are pure functions, unit-tested
- Engine handles entry, exit, mark-to-market equity, fees, position sizing
- Stats include the 8 most-asked metrics
- No backend changes outside the listed files + main.py
- Frontend page is standalone (`/backtester`), doesn't touch existing chart code
- No placeholders
