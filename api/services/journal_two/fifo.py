"""
FIFO reconstruction for broker raw-fill CSVs.

Broker exports (Schwab / IBKR / E*Trade) contain individual Buy/Sell
fills. This module walks them in chronological order and emits round-
trip Trade records suitable for j2_trades.

Per Phase 7 A1 decision: LONG-ONLY. Short positions (sell-to-open)
are flagged as errors and skipped. A user with short trades can use
the manual Add Trade flow, which is already side-aware.

Algorithm:
  For each symbol, maintain a FIFO queue of open lots:
    [{shares, price, date}, ...]
  On Buy:  push a new lot at the back.
  On Sell: pop from the front until the sell is fully filled,
           emitting one Trade record per (Sell, buy-lot) pair
           split. Average entry price across multiple buy-lots
           if the sell spans them.

Emitted trade shape matches what pre-matched adapter produces:
  { symbol, side, shares, entryPrice, entryDate, exitPrice, exitDate,
    originalStop: None, setup: None, notes: None }
Derived fields computed by bulk_insert_trades at confirm time.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Literal


@dataclass
class Fill:
    """A single buy-or-sell fill out of a broker CSV.
    Row is 1-indexed (counting the header), for error reporting."""
    row: int
    symbol: str
    action: Literal["Buy", "Sell"]
    shares: float    # positive number
    price: float
    date: str        # ISO 8601 UTC


@dataclass
class Lot:
    shares: float
    price: float
    date: str


def reconstruct_trades(fills: list[Fill]) -> dict:
    """Walk fills chronologically, emit one Trade per closed round-trip
    segment. Returns {trades: [...], errors: [...]}.

    Splits sells across multiple buy-lots when needed: if user bought
    100 @ $10 (day 1), bought 50 @ $11 (day 2), sold 120 @ $15 (day 3),
    we emit ONE trade at 120 shares with VWAP entry = (100*10 + 20*11)/120
    dated to the EARLIEST buy date. This matches how most traders
    think about their round-trips (one sell → one trade record).
    """
    # Sort by date, then row, so same-day fills keep their CSV order.
    sorted_fills = sorted(fills, key=lambda f: (f.date, f.row))

    # Per-symbol FIFO
    queues: dict[str, deque[Lot]] = {}
    # Track whether we've seen a buy for a symbol yet — sells with no
    # prior buys are shorts (not supported this phase).
    ever_bought: set[str] = set()

    trades: list[dict] = []
    errors: list[dict] = []

    for f in sorted_fills:
        if f.shares <= 0:
            errors.append({"row": f.row, "message": f"shares must be > 0 (got {f.shares})"})
            continue
        if f.price <= 0:
            errors.append({"row": f.row, "message": f"price must be > 0 (got {f.price})"})
            continue

        q = queues.setdefault(f.symbol, deque())

        if f.action == "Buy":
            q.append(Lot(shares=f.shares, price=f.price, date=f.date))
            ever_bought.add(f.symbol)
            continue

        # Sell
        if f.symbol not in ever_bought:
            errors.append({
                "row": f.row,
                "message": f"{f.symbol} sell with no prior buy — short-sell not supported in broker imports this phase (use manual Add Trade).",
            })
            continue

        remaining = f.shares
        # Collect consumed buy-lots for VWAP + earliest-date
        consumed: list[tuple[float, float, str]] = []  # (shares, price, date)

        while remaining > 1e-9 and q:
            lot = q[0]
            take = min(lot.shares, remaining)
            consumed.append((take, lot.price, lot.date))
            lot.shares -= take
            remaining -= take
            if lot.shares <= 1e-9:
                q.popleft()

        if remaining > 1e-9:
            # Oversell — this becomes a short. Flag as error, don't emit.
            errors.append({
                "row": f.row,
                "message": f"{f.symbol} sell of {f.shares} exceeds held {f.shares - remaining} shares — short-sell not supported in broker imports this phase.",
            })
            # Don't emit a partial trade; keep queue consistent (consumed
            # lots already popped above).
            continue

        total_shares = sum(s for s, _, _ in consumed)
        vwap = sum(s * p for s, p, _ in consumed) / total_shares if total_shares > 0 else 0.0
        earliest_date = min(d for _, _, d in consumed)

        trades.append({
            "symbol": f.symbol,
            "side": "Long",
            "shares": round(total_shares * 10000) / 10000,
            "entryPrice": round(vwap * 100) / 100,
            "entryDate": earliest_date,
            "exitPrice": f.price,
            "exitDate": f.date,
            "originalStop": None,  # bulk_insert defaults to entryPrice → rMultiple null
            "setup": None,
            "notes": None,
        })

    # Open positions (buys without matching sells) are NOT trades —
    # they're still-open Positions. We just don't emit a Trade for them.
    # (A future phase could auto-create j2_positions rows for them.)

    return {"trades": trades, "errors": errors}
