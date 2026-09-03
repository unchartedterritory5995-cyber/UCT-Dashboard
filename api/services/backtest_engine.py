"""
Backtest simulator: consumes OHLCV bars + strategy signals, walks position
lifecycle bar-by-bar, returns equity curve, completed trades, final equity.

Pure function — no side effects, no logging, no external imports.

⛔⛔ THIS ENGINE IS LONG-ONLY, AND `side` WAS A DECORATIVE CONSTANT.

Every signal carried a `side`, every position and every trade record stored it
(below), and the P&L arithmetic never read it — `gross_pnl` is
`(exit - entry) * shares` and the mark-to-market is `(close - entry) * shares`,
both unconditionally long. A short would therefore have reported INVERTED P&L:
a short that made money would show as a loss, and an equity curve that fell
would rise.

⭐ It was harmless only by accident of the producer. `strategy_templates._signal`
hardcodes `"side": "long"` and that module's docstring says "All strategies are
long-only", so no caller has ever handed this engine anything else. That is the
whole safety argument, and it is one edit away from being false — a fifth
template emitting a short would have silently produced a backwards backtest,
with no exception, no log line and a plausible-looking equity curve.

⛔ SO THE FIELD IS NOW GUARDED RATHER THAN WIRED. Wiring a sign into the
arithmetic would ship short support nothing asks for and nothing exercises —
`lesson_an_unused_parameter_may_be_older_than_its_consumers`, where wiring one
long-dormant argument shipped a chord because the consumers all assumed the old
meaning. Short P&L is also not the sign flip it looks like: proceeds credit cash
at entry, `shares = pos_size / price` is not a margin model, and `cost_basis`
stops being what the position cost. Implementing that here, unreached and
unexercised, is how a surface gets built, tested, green and wrong.

The engine instead REFUSES a side it cannot compute. The guard is at the entry
boundary — the one place a side enters the simulation — so `_close_position`
reads a value that has already been checked.
"""

#: The sides the arithmetic below actually implements. ONE AUTHORITY: the guard
#: and this module's contract read the same tuple, so adding short support means
#: changing the arithmetic and this constant together, and a rail notices if only
#: one of them moves.
SUPPORTED_SIDES = ("long",)


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
                    side = s.get("side", "long")
                    if side not in SUPPORTED_SIDES:
                        # ⛔ REFUSE, NEVER COERCE. Treating this as long is what
                        # the engine did before, and it produced a backwards
                        # equity curve that looked entirely plausible.
                        raise ValueError(
                            f"backtest_engine is long-only and cannot price a "
                            f"{side!r} position (entry signal at t={t}). The P&L "
                            f"arithmetic is unconditionally long, so simulating "
                            f"this would report inverted profit and loss. Add the "
                            f"side to SUPPORTED_SIDES only together with the "
                            f"arithmetic that prices it."
                        )
                    pos_size = equity * position_pct / 100.0
                    shares = pos_size / s["price"]
                    position = {
                        "entry_t": t,
                        "entry_price": float(s["price"]),
                        "shares": shares,
                        "side": side,
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
            # LONG-ONLY (see module docstring). `side` is not consulted here;
            # the entry guard is what keeps that from being a wrong number.
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

    # LONG-ONLY (see module docstring). `side` is stored on the record below but
    # takes no part in this line; the entry guard is what keeps that honest.
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
