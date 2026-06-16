"""
FIFO reconstruction for broker raw-fill streams (CSV exports + live broker
activity feeds). Walks individual Buy/Sell fills in chronological order and
emits round-trip Trade records suitable for j2_trades.

Two modes:

  allow_shorts=False (DEFAULT — CSV import, Phase 7 A1 "long only"):
    Sells with no prior buy, or sells exceeding the held long quantity,
    are flagged as errors and skipped. Behavior is unchanged from the
    original long-only implementation — the CSV import path depends on it.

  allow_shorts=True (broker sync, Phase 2 "everything day one"):
    Full signed-lot model. A sell beyond the long position opens a SHORT
    lot (sell-to-open); a buy against a short covers it (buy-to-cover) and
    emits a side='Short' round-trip. A fill that crosses zero closes the
    existing position AND opens the opposite side with the residual (a
    flip). Leftover open lots (long or short) are returned as
    `open_positions` for reconciliation against the broker's holdings
    endpoint.

Emitted trade shape (both modes):
  { symbol, side, shares, entryPrice, entryDate, exitPrice, exitDate,
    originalStop: None, setup: None, notes: None }
For a Short, entryPrice is the sell-to-open VWAP and exitPrice is the
buy-to-cover price — compute_trade_derived is side-aware, so P&L/R are
correct. Derived fields are computed by bulk_insert at confirm time.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Literal


@dataclass
class Fill:
    """A single buy-or-sell fill out of a broker CSV / activity feed.
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


_EPS = 1e-9


def _round_shares(x: float) -> float:
    return round(x * 10000) / 10000


def _round_price(x: float) -> float:
    return round(x * 100) / 100


def reconstruct_trades(fills: list[Fill], *, allow_shorts: bool = False) -> dict:
    """Walk fills chronologically, emit one Trade per closed round-trip
    segment. Returns {trades: [...], errors: [...], open_positions: [...]}.

    `allow_shorts=False` preserves the original long-only contract (sells
    without a prior buy, or overselling, are errors). `allow_shorts=True`
    enables the full signed-lot model (see module docstring)."""
    if allow_shorts:
        return _reconstruct_with_shorts(fills)
    return _reconstruct_long_only(fills)


# ── Long-only (CSV import; unchanged contract) ──────────────────────────────

def _reconstruct_long_only(fills: list[Fill]) -> dict:
    # Sort by date, then row, so same-day fills keep their CSV order.
    sorted_fills = sorted(fills, key=lambda f: (f.date, f.row))

    queues: dict[str, deque[Lot]] = {}
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
        consumed: list[tuple[float, float, str]] = []  # (shares, price, date)

        while remaining > _EPS and q:
            lot = q[0]
            take = min(lot.shares, remaining)
            consumed.append((take, lot.price, lot.date))
            lot.shares -= take
            remaining -= take
            if lot.shares <= _EPS:
                q.popleft()

        if remaining > _EPS:
            errors.append({
                "row": f.row,
                "message": f"{f.symbol} sell of {f.shares} exceeds held {f.shares - remaining} shares — short-sell not supported in broker imports this phase.",
            })
            continue

        trades.append(_make_trade(f.symbol, "Long", consumed, f.price, f.date))

    return {"trades": trades, "errors": errors, "open_positions": _open_from_queues(queues, "Long")}


# ── Signed-lot model (broker sync; supports shorts + flips) ──────────────────

def _reconstruct_with_shorts(fills: list[Fill]) -> dict:
    sorted_fills = sorted(fills, key=lambda f: (f.date, f.row))

    # Per-symbol state: a deque of open lots all on the same side.
    lots: dict[str, deque[Lot]] = {}
    side: dict[str, str | None] = {}  # 'long' | 'short' | None

    trades: list[dict] = []
    errors: list[dict] = []

    for f in sorted_fills:
        if f.shares <= 0:
            errors.append({"row": f.row, "message": f"shares must be > 0 (got {f.shares})"})
            continue
        if f.price <= 0:
            errors.append({"row": f.row, "message": f"price must be > 0 (got {f.price})"})
            continue

        sym = f.symbol
        q = lots.setdefault(sym, deque())
        side.setdefault(sym, None)
        is_buy = f.action == "Buy"
        remaining = f.shares

        while remaining > _EPS:
            cur = side[sym]
            if cur is None:
                # Flat → open in the fill's direction with all remaining.
                q.append(Lot(shares=remaining, price=f.price, date=f.date))
                side[sym] = "long" if is_buy else "short"
                remaining = 0
                break

            opening = (cur == "long" and is_buy) or (cur == "short" and not is_buy)
            if opening:
                q.append(Lot(shares=remaining, price=f.price, date=f.date))
                remaining = 0
                break

            # Closing the current side. Consume front lots up to `remaining`.
            consumed: list[tuple[float, float, str]] = []
            while remaining > _EPS and q:
                lot = q[0]
                take = min(lot.shares, remaining)
                consumed.append((take, lot.price, lot.date))
                lot.shares -= take
                remaining -= take
                if lot.shares <= _EPS:
                    q.popleft()

            if consumed:
                label = "Long" if cur == "long" else "Short"
                trades.append(_make_trade(sym, label, consumed, f.price, f.date))

            if not q:
                # Position fully closed. If fill still has size, the next
                # loop iteration opens the opposite side (a flip).
                side[sym] = None
            else:
                # Lots remain on the same side → the fill is exhausted.
                break

    return {
        "trades": trades,
        "errors": errors,
        "open_positions": _open_from_signed(lots, side),
    }


# ── Shared helpers ──────────────────────────────────────────────────────────

def _make_trade(symbol: str, side_label: str, consumed: list[tuple[float, float, str]],
                exit_price: float, exit_date: str) -> dict:
    """Aggregate consumed open-lots into one round-trip trade. `consumed`
    is [(shares, lot_price, lot_date), ...]; for a Long these are buy lots
    (entry side), for a Short these are sell-to-open lots (entry side)."""
    total = sum(s for s, _, _ in consumed)
    vwap = sum(s * p for s, p, _ in consumed) / total if total > 0 else 0.0
    earliest = min(d for _, _, d in consumed)
    return {
        "symbol": symbol,
        "side": side_label,
        "shares": _round_shares(total),
        "entryPrice": _round_price(vwap),
        "entryDate": earliest,
        "exitPrice": exit_price,
        "exitDate": exit_date,
        "originalStop": None,
        "setup": None,
        "notes": None,
    }


def _open_position_entry(symbol: str, side_label: str, lots_list: list[Lot]) -> dict:
    total = sum(l.shares for l in lots_list)
    vwap = sum(l.shares * l.price for l in lots_list) / total if total > 0 else 0.0
    earliest = min(l.date for l in lots_list)
    return {
        "symbol": symbol,
        "side": side_label,
        "shares": _round_shares(total),
        "entryPrice": _round_price(vwap),
        "entryDate": earliest,
    }


def _open_from_queues(queues: dict[str, deque[Lot]], side_label: str) -> list[dict]:
    out = []
    for sym, q in queues.items():
        live = [l for l in q if l.shares > _EPS]
        if live:
            out.append(_open_position_entry(sym, side_label, live))
    return out


def _open_from_signed(lots: dict[str, deque[Lot]], side: dict[str, str | None]) -> list[dict]:
    out = []
    for sym, q in lots.items():
        live = [l for l in q if l.shares > _EPS]
        s = side.get(sym)
        if live and s:
            out.append(_open_position_entry(sym, "Long" if s == "long" else "Short", live))
    return out
