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
    Row is 1-indexed (counting the header), for error reporting.
    `fee` is the commission/fees on THIS fill (0 for CSV imports that don't
    carry fees) — threaded into round-trip P&L."""
    row: int
    symbol: str
    action: Literal["Buy", "Sell"]
    shares: float    # positive number
    price: float
    date: str        # ISO 8601 UTC
    fee: float = 0.0


@dataclass
class Lot:
    shares: float
    price: float
    date: str
    fee_per_share: float = 0.0  # opening-fill fee / opening shares, for proration


_EPS = 1e-9


def _round_shares(x: float) -> float:
    return round(x * 10000) / 10000


def _round_price(x: float) -> float:
    # 4dp preserves sub-penny / option-tick prices; avoids 2dp P&L drift.
    return round(x * 10000) / 10000


def reconstruct_trades(fills: list[Fill], *, allow_shorts: bool = False,
                       adjustments: list[dict] | None = None) -> dict:
    """Walk fills chronologically, emit one Trade per closed round-trip
    segment. Returns {trades: [...], errors: [...], open_positions: [...]}.

    `allow_shorts=False` preserves the original long-only contract (sells
    without a prior buy, or overselling, are errors). `allow_shorts=True`
    enables the full signed-lot model (see module docstring).

    `adjustments` (signed-lot mode only) are share movements that are NOT
    trades — splits and share transfers/journals between accounts, as dicts
    {row, symbol, kind: 'split'|'transfer', delta (signed shares), price
    (per-share basis for a transfer-in, may be None), date}. A split scales
    the open lots in place (share count × ratio, basis ÷ ratio — zero P&L).
    A transfer-out removes shares at basis WITHOUT emitting a trade; a
    transfer-in opens a lot at the given basis. Ignoring these desyncs the
    share count and fabricates phantom shorts / bogus P&L for the symbol."""
    if allow_shorts:
        return _reconstruct_with_shorts(fills, adjustments or [])
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
            errors.append({"row": f.row, "symbol": f.symbol, "message": f"shares must be > 0 (got {f.shares})"})
            continue
        if f.price <= 0:
            errors.append({"row": f.row, "symbol": f.symbol, "message": f"price must be > 0 (got {f.price})"})
            continue

        q = queues.setdefault(f.symbol, deque())

        if f.action == "Buy":
            q.append(Lot(shares=f.shares, price=f.price, date=f.date,
                         fee_per_share=(f.fee / f.shares if f.shares else 0.0)))
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
        consumed: list[tuple[float, float, str, float]] = []  # (shares, price, date, fee_portion)

        while remaining > _EPS and q:
            lot = q[0]
            take = min(lot.shares, remaining)
            consumed.append((take, lot.price, lot.date, take * lot.fee_per_share))
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

        trades.append(_make_trade(f.symbol, "Long", consumed, f.price, f.date, exit_fee=f.fee))

    return {"trades": trades, "errors": errors, "open_positions": _open_from_queues(queues, "Long")}


# ── Signed-lot model (broker sync; supports shorts + flips) ──────────────────

def _adjustment_rank(a: dict) -> int:
    """Same-date ordering for adjustments vs fills (fills rank 0). Splits and
    incoming shares must land BEFORE the day's fills (a same-day sell of
    split/journaled shares needs them present); outgoing shares leave AFTER
    the day's fills (a same-day buy can be the source of the shares)."""
    if a["kind"] == "split" or a["delta"] > 0:
        return -1
    return 1


def _apply_adjustment(a: dict, lots: dict[str, deque[Lot]],
                      side: dict[str, str | None], errors: list[dict]) -> None:
    sym = a["symbol"]
    q = lots.setdefault(sym, deque())
    cur = side.setdefault(sym, None)
    delta = a["delta"]

    if a["kind"] == "split":
        pos = sum(l.shares for l in q)
        if cur is None or pos <= _EPS:
            errors.append({"row": a["row"], "symbol": sym, "message": f"{sym} split with no open position — skipped"})
            return
        rel = delta if cur == "long" else -delta
        new_pos = pos + rel
        if new_pos <= _EPS:
            errors.append({"row": a["row"], "symbol": sym, "message": f"{sym} split would zero or flip the position — skipped"})
            return
        ratio = new_pos / pos
        for l in q:  # total lot cost is preserved: (shares×ratio) × (price÷ratio)
            l.shares *= ratio
            l.price /= ratio
            l.fee_per_share /= ratio
        return

    # transfer / journal
    if delta > 0:
        if cur == "short":
            errors.append({"row": a["row"], "symbol": sym, "message": f"{sym} share transfer-in against a short position — skipped"})
            return
        price = a.get("price")
        if price is None or price <= 0:
            errors.append({"row": a["row"], "symbol": sym, "message": f"{sym} share transfer-in with no basis price — skipped"})
            return
        q.append(Lot(shares=delta, price=price, date=a["date"], fee_per_share=0.0))
        side[sym] = "long"
        return

    # delta < 0 — shares leave the account at basis; no P&L is realized.
    if cur != "long" or not q:
        errors.append({"row": a["row"], "symbol": sym, "message": f"{sym} share transfer-out with no held long shares — skipped"})
        return
    remaining = -delta
    while remaining > _EPS and q:
        lot = q[0]
        take = min(lot.shares, remaining)
        lot.shares -= take
        remaining -= take
        if lot.shares <= _EPS:
            q.popleft()
    if not q:
        side[sym] = None
    if remaining > _EPS:
        errors.append({"row": a["row"], "symbol": sym, "message": f"{sym} share transfer-out exceeded held shares by {remaining:g}"})


def _reconstruct_with_shorts(fills: list[Fill], adjustments: list[dict] | None = None) -> dict:
    # Same-TIMESTAMP tie-break: buys before sells. Date-only brokers (Schwab
    # reports every fill at midnight) lose intraday order, so a flat-position
    # same-day round trip would otherwise have arbitrary odds of replaying
    # sell-first and booking a phantom SHORT. Buys-first keeps every long
    # round trip labeled Long; a genuine intraday short still books identical
    # P&L (entry/exit swap cancels). Full-timestamp brokers are unaffected
    # (distinct timestamps never tie). Multi-day shorts are unaffected too —
    # their open and cover are on different dates.
    stream: list[tuple] = [
        ((f.date, 0, 0 if f.action == "Buy" else 1, f.row), "fill", f) for f in fills
    ]
    stream += [((a["date"], _adjustment_rank(a), 0, a["row"]), "adj", a)
               for a in (adjustments or [])]
    stream.sort(key=lambda t: t[0])

    # Per-symbol state: a deque of open lots all on the same side.
    lots: dict[str, deque[Lot]] = {}
    side: dict[str, str | None] = {}  # 'long' | 'short' | None

    trades: list[dict] = []
    errors: list[dict] = []

    for _, item_kind, item in stream:
        if item_kind == "adj":
            _apply_adjustment(item, lots, side, errors)
            continue
        f = item
        if f.shares <= 0:
            errors.append({"row": f.row, "symbol": f.symbol, "message": f"shares must be > 0 (got {f.shares})"})
            continue
        if f.price <= 0:
            errors.append({"row": f.row, "symbol": f.symbol, "message": f"price must be > 0 (got {f.price})"})
            continue

        sym = f.symbol
        q = lots.setdefault(sym, deque())
        side.setdefault(sym, None)
        is_buy = f.action == "Buy"
        remaining = f.shares

        # Per-share fee of this fill is constant, so any lot opened from it
        # and any close it performs prorate cleanly by share count.
        fps = (f.fee / f.shares) if f.shares else 0.0

        while remaining > _EPS:
            cur = side[sym]
            if cur is None:
                # Flat → open in the fill's direction with all remaining.
                q.append(Lot(shares=remaining, price=f.price, date=f.date, fee_per_share=fps))
                side[sym] = "long" if is_buy else "short"
                remaining = 0
                break

            opening = (cur == "long" and is_buy) or (cur == "short" and not is_buy)
            if opening:
                q.append(Lot(shares=remaining, price=f.price, date=f.date, fee_per_share=fps))
                remaining = 0
                break

            # Closing the current side. Consume front lots up to `remaining`.
            consumed: list[tuple[float, float, str, float]] = []
            close_shares = 0.0
            while remaining > _EPS and q:
                lot = q[0]
                take = min(lot.shares, remaining)
                consumed.append((take, lot.price, lot.date, take * lot.fee_per_share))
                close_shares += take
                lot.shares -= take
                remaining -= take
                if lot.shares <= _EPS:
                    q.popleft()

            if consumed:
                label = "Long" if cur == "long" else "Short"
                # Exit fee = this fill's fee for the shares it actually closed.
                exit_fee = fps * close_shares
                trades.append(_make_trade(sym, label, consumed, f.price, f.date, exit_fee=exit_fee))

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

def _make_trade(symbol: str, side_label: str,
                consumed: list[tuple[float, float, str, float]],
                exit_price: float, exit_date: str, *, exit_fee: float = 0.0) -> dict:
    """Aggregate consumed open-lots into one round-trip trade. `consumed`
    is [(shares, lot_price, lot_date, fee_portion), ...]; for a Long these are
    buy lots (entry side), for a Short these are sell-to-open lots. Total trade
    `fees` = prorated entry-lot fees + this close's exit fee."""
    total = sum(s for s, _, _, _ in consumed)
    vwap = sum(s * p for s, p, _, _ in consumed) / total if total > 0 else 0.0
    earliest = min(d for _, _, d, _ in consumed)
    entry_fee = sum(fp for _, _, _, fp in consumed)
    return {
        "symbol": symbol,
        "side": side_label,
        "shares": _round_shares(total),
        "entryPrice": _round_price(vwap),
        "entryDate": earliest,
        "exitPrice": exit_price,
        "exitDate": exit_date,
        "fees": round(entry_fee + (exit_fee or 0.0), 2),
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
