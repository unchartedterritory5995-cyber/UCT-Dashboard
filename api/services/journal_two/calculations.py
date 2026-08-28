"""
Journal 2.0 — server-side calculations.

Python mirror of app/src/lib/journal-2-0/calculations.js for the narrow
set of formulas needed server-side: closing a position persists
pnl_dollar, pnl_percent, r_multiple, hold_days, and result onto a
Trade row. Both implementations must agree on the §14.7 verification
data; test_calculations.py asserts this.

Spec §14.
"""

from datetime import datetime, timezone
from typing import Literal, Optional, TypedDict

EPSILON = 1e-9


class BreakevenRange(TypedDict):
    enabled: bool
    unit: Literal["$", "%"]
    value: float


def safe_divide(a: float, b: float) -> Optional[float]:
    """None for (near-)zero denominators."""
    return None if abs(b) < EPSILON else a / b


def trade_pnl_dollar(side: str, entry_price: float, exit_price: float, shares: float) -> float:
    if side == "Long":
        return (exit_price - entry_price) * shares
    return (entry_price - exit_price) * shares


def trade_pnl_percent(side: str, entry_price: float, exit_price: float) -> Optional[float]:
    if side == "Long":
        return safe_divide(exit_price - entry_price, entry_price)
    return safe_divide(entry_price - exit_price, entry_price)


def trade_r_multiple(
    side: str, entry_price: float, exit_price: float, original_stop: float
) -> Optional[float]:
    """Returns None when entry == originalStop (risk undefined)."""
    if side == "Long":
        return safe_divide(exit_price - entry_price, entry_price - original_stop)
    return safe_divide(entry_price - exit_price, original_stop - entry_price)


def hold_days(entry_date: str, exit_date: str) -> int:
    """Calendar days between entry and exit, UTC, floored.
    Both inputs are ISO 8601 strings."""
    entry = datetime.fromisoformat(entry_date.replace("Z", "+00:00")).astimezone(timezone.utc)
    exit_ = datetime.fromisoformat(exit_date.replace("Z", "+00:00")).astimezone(timezone.utc)
    delta = exit_ - entry
    return delta.days if delta.days >= 0 else 0


def trade_result(
    pnl_dollar: float,
    entry_price: float,
    shares: float,
    breakeven_range: BreakevenRange,
) -> Literal["Win", "Loss", "BE"]:
    """Win/Loss/BE per §14.5. BE at exactly 0 P&L when disabled
    (inclusive of zero, §14.5 edge case #12)."""
    if not breakeven_range["enabled"]:
        if pnl_dollar > 0:
            return "Win"
        if pnl_dollar < 0:
            return "Loss"
        return "BE"

    if breakeven_range["unit"] == "$":
        threshold = breakeven_range["value"]
    else:
        threshold = abs(entry_price * shares * breakeven_range["value"] / 100)

    if abs(pnl_dollar) <= threshold:
        return "BE"
    return "Win" if pnl_dollar > 0 else "Loss"


def compute_trade_derived(
    side: str,
    shares: float,
    entry_price: float,
    entry_date: str,
    exit_price: float,
    exit_date: str,
    original_stop: float,
    breakeven_range: BreakevenRange,
) -> dict:
    """All derived Trade fields in one call — used at position-close time.

    pnl_dollar is rounded to CENTS here — this is the STORAGE boundary (every
    j2_trades write flows through this dict), and money below a cent is float
    exhaust, not information: unrounded storage put artifacts like
    -3550.700000000006 in member rows and pushed rounding-order noise into
    every downstream sum (2026-08-27 fleet audit). The pure calculators above
    stay unrounded — they are the parity-railed authorities and the JS mirror
    must match them bit-for-bit, not share a rounding mode."""
    pnl_dollar = round(trade_pnl_dollar(side, entry_price, exit_price, shares), 2)
    pnl_percent = trade_pnl_percent(side, entry_price, exit_price) or 0.0
    r_mult = trade_r_multiple(side, entry_price, exit_price, original_stop)
    holds = hold_days(entry_date, exit_date)
    result = trade_result(pnl_dollar, entry_price, shares, breakeven_range)
    return {
        "pnl_dollar": pnl_dollar,
        "pnl_percent": pnl_percent,
        "r_multiple": r_mult,
        "hold_days": holds,
        "result": result,
    }
