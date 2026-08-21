"""
Journal 2.0 — MFE / MAE + exit-efficiency excursion math (Journal A+ Phase 2).

PURE math core. No I/O, no bars fetching, no DB. Takes a trade's params plus a
list of already-fetched OHLC bars and returns per-trade excursion metrics:

  - MFE (max favorable excursion) / MAE (max adverse excursion) — as price, R,
    and the bar timestamp at which each extreme first occurred.
  - exit_efficiency — how much of the available favorable move the exit captured.
  - missed_r — favorable R left on the table (mfe_r − r_at_exit).

Later tasks fetch the intraday bars and persist these numbers; this module only
computes them.

Load-bearing decisions (mirrored in the tests):
  - The window [entry_ts, exit_ts] is INCLUSIVE of both ends.
  - A bar's high AND low both count — intrabar path is unknown, so this is the
    standard bar-approximation.
  - MFE/MAE timestamps are the FIRST bar achieving the extreme (ties keep the
    earlier bar).
  - exit_efficiency uses PRICE move (stop-independent) so it stays defined even
    when R is None (stop == entry). It is None — never 0 — when there was no
    favorable excursion (available <= EPSILON); a genuine give-it-all-back exit
    (positive available, non-positive captured) clamps to 0.0.

PRICE→R conversion reuses `trade_r_multiple` from calculations.py so an
excursion's R shares the exact denominator as the trade's own R.
"""

from typing import Optional

from api.services.journal_two.calculations import EPSILON, trade_r_multiple


def _first_extreme(window: list, key: str, mode: str):
    """(value, ts) of the FIRST bar achieving the max/min of bar[key].

    Strict comparison means only a strictly better bar moves the pointer, so a
    later bar that merely ties the extreme leaves the earlier timestamp intact.
    """
    best_val = None
    best_ts = None
    for bar in window:
        v = bar[key]
        if (
            best_val is None
            or (mode == "max" and v > best_val)
            or (mode == "min" and v < best_val)
        ):
            best_val = v
            best_ts = bar["t"]
    return best_val, best_ts


def compute_excursion(
    side: str,
    entry_price: float,
    original_stop: float,
    entry_ts: int,
    exit_ts: int,
    bars: list,
    *,
    exit_price: float,
) -> Optional[dict]:
    """Compute MFE/MAE + exit-efficiency for one closed trade.

    Args:
        side: 'Long' or 'Short'.
        entry_price / original_stop / exit_price: trade prices.
        entry_ts / exit_ts: inclusive unix-second bounds of the holding window.
        bars: list of {"t": int_unix_seconds, "h": float, "l": float}; other
            keys ignored.

    Returns:
        dict with mfe_price, mae_price, mfe_ts, mae_ts, mfe_r, mae_r,
        exit_efficiency, missed_r — or None when NO bar falls in the window.
    """
    window = [b for b in bars if entry_ts <= b["t"] <= exit_ts]
    if not window:
        return None

    is_long = side == "Long"

    # Favorable = up for Long (max high), down for Short (min low).
    # Adverse   = down for Long (min low), up for Short (max high).
    if is_long:
        mfe_price, mfe_ts = _first_extreme(window, "h", "max")
        mae_price, mae_ts = _first_extreme(window, "l", "min")
    else:
        mfe_price, mfe_ts = _first_extreme(window, "l", "min")
        mae_price, mae_ts = _first_extreme(window, "h", "max")

    # Excursion prices → R via the trade's own risk denominator (None @ stop==entry).
    mfe_r = trade_r_multiple(side, entry_price, mfe_price, original_stop)
    mae_r = trade_r_multiple(side, entry_price, mae_price, original_stop)

    # exit_efficiency = captured favorable / available favorable, price-based.
    if is_long:
        captured = exit_price - entry_price
        available = mfe_price - entry_price
    else:
        captured = entry_price - exit_price
        available = entry_price - mfe_price

    if available <= EPSILON:
        # No favorable excursion → efficiency is undefined (never 0).
        exit_efficiency: Optional[float] = None
    else:
        # Clamp: negative captured (exit worse than entry) → 0.0 (gave it all
        # back); captured beyond mfe is impossible but clamp guards float noise.
        exit_efficiency = max(0.0, min(1.0, captured / available))

    # missed_r = favorable R left on the table; None if either R is None.
    r_at_exit = trade_r_multiple(side, entry_price, exit_price, original_stop)
    if mfe_r is None or r_at_exit is None:
        missed_r: Optional[float] = None
    else:
        missed_r = mfe_r - r_at_exit

    # true_r — the R-multiple against the risk the trade ACTUALLY took (its
    # MAE), STOP-FREE: broker-imported trades carry no stop (mfe_r/mae_r are
    # None on all 11,587 prod rows as of 2026-08-21), so this is the metric
    # that lights up R analytics for auto-synced members. Price-based like
    # exit_efficiency. A trade that never ticked against its entry has no
    # adverse denominator → None (never a fabricated number).
    if is_long:
        adverse = entry_price - mae_price
        captured_move = exit_price - entry_price
    else:
        adverse = mae_price - entry_price
        captured_move = entry_price - exit_price
    true_r: Optional[float] = (
        captured_move / adverse if adverse > EPSILON else None
    )

    return {
        "mfe_price": mfe_price,
        "mae_price": mae_price,
        "mfe_ts": mfe_ts,
        "mae_ts": mae_ts,
        "mfe_r": mfe_r,
        "mae_r": mae_r,
        "exit_efficiency": exit_efficiency,
        "missed_r": missed_r,
        "true_r": true_r,
    }
