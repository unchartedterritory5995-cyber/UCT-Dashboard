"""
Backtest simulator: consumes OHLCV bars + strategy signals, walks position
lifecycle bar-by-bar, returns equity curve, completed trades, final equity.

Pure function — no side effects, no logging, no external imports.
"""


def simulate(
    bars: list[dict],
    signals: list[dict],
    capital: float = 10000,
    position_pct: float = 100,
    fees_bps: float = 10,
) -> dict:
    """
    Walk bars chronologically, processing signals at each bar timestamp.

    Args:
        bars:         List of OHLCV dicts with at least {'t': int, 'c': float}.
        signals:      List of signal dicts from strategy_templates:
                      {'t': int, 'side': 'long', 'kind': 'entry'|'exit',
                       'price': float, 'reason': str}
        capital:      Starting cash in dollars.
        position_pct: Fraction of current equity to deploy per trade (0-100).
        fees_bps:     Round-trip commission in basis points (10 bps = 0.10%).

    Returns:
        {
            'final_equity': float,
            'total_return_pct': float,
            'equity_curve': list[{'t': int, 'equity': float}],
            'trades': list[dict],
            'n_bars': int,
        }
    """
    # Index signals by bar timestamp for O(1) lookup
    sig_by_t: dict[int, list[dict]] = {}
    for s in signals:
        sig_by_t.setdefault(s["t"], []).append(s)

    equity = float(capital)
    position = None   # None when flat; dict when open
    equity_curve = []
    trades = []

    for bar in bars:
        t = bar["t"]
        close = bar["c"]

        # --- Process signals at this bar ---
        for s in sig_by_t.get(t, []):
            if s["kind"] == "entry":
                if position is None:
                    pos_size = equity * position_pct / 100.0
                    shares = pos_size / s["price"]
                    position = {
                        "entry_t": t,
                        "entry_price": float(s["price"]),
                        "shares": shares,
                        "side": s.get("side", "long"),
                        "reason_entry": s.get("reason", ""),
                    }
                # else: position already open — silently ignore

            elif s["kind"] == "exit":
                if position is not None:
                    trade = _close_position(
                        position=position,
                        exit_t=t,
                        exit_price=float(s["price"]),
                        reason_exit=s.get("reason", ""),
                        fees_bps=fees_bps,
                    )
                    equity += trade["pnl_$"]
                    trades.append(trade)
                    position = None
                # else: no open position — silently ignore

        # --- Mark-to-market equity for curve ---
        if position is None:
            mtm_equity = equity
        else:
            open_pnl = (close - position["entry_price"]) * position["shares"]
            mtm_equity = equity + open_pnl

        equity_curve.append({"t": t, "equity": round(mtm_equity, 2)})

    # --- Force-exit any open position at last bar's close ---
    if position is not None and bars:
        last_bar = bars[-1]
        trade = _close_position(
            position=position,
            exit_t=last_bar["t"],
            exit_price=float(last_bar["c"]),
            reason_exit="End of backtest period (forced exit)",
            fees_bps=fees_bps,
        )
        equity += trade["pnl_$"]
        trades.append(trade)
        # Update final equity_curve point to reflect realized equity
        if equity_curve:
            equity_curve[-1]["equity"] = round(equity, 2)

    return {
        "final_equity": round(equity, 2),
        "total_return_pct": round((equity - capital) / capital * 100, 4),
        "equity_curve": equity_curve,
        "trades": trades,
        "n_bars": len(bars),
    }


def _close_position(
    position: dict,
    exit_t: int,
    exit_price: float,
    reason_exit: str,
    fees_bps: float,
) -> dict:
    """Compute trade record for a closed position."""
    entry_price = position["entry_price"]
    shares = position["shares"]

    gross_pnl = (exit_price - entry_price) * shares
    fees = (entry_price + exit_price) * shares * (fees_bps / 10000.0)
    net_pnl = gross_pnl - fees

    cost_basis = entry_price * shares
    pnl_pct = (net_pnl / cost_basis * 100) if cost_basis else 0.0

    return {
        "entry_t": position["entry_t"],
        "entry_price": entry_price,
        "exit_t": exit_t,
        "exit_price": exit_price,
        "side": position.get("side", "long"),
        "shares": shares,
        "pnl_$": round(net_pnl, 2),
        "pnl_pct": round(pnl_pct, 4),
        "reason_entry": position.get("reason_entry", ""),
        "reason_exit": reason_exit,
    }
