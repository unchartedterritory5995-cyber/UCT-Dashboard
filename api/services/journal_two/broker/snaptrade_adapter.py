"""SnapTrade activity → normalized records.

Converts SnapTrade "universal activity" dicts (already plain-Python via the
client's _to_plain) into:
  • equity Fills  → fed to fifo.reconstruct_trades(allow_shorts=True)
  • option events → reconstructed into j2_option_strategies (Phase 4)
  • cash / transfer / unknown → recorded but not turned into trades

This is the structural analogue of csv_import.parse_schwab — all the
SnapTrade-shape knowledge lives here so the reconstructor stays clean.

Assumed activity schema (snaptrade-python-sdk 11.x UniversalActivity;
verify exact enum values against SnapTrade docs/sandbox):
  id                 stable activity id            → external_id
  type               BUY|SELL|DIVIDEND|INTEREST|FEE|REI|CONTRIBUTION|
                     WITHDRAWAL|OPTIONEXPIRATION|OPTIONASSIGNMENT|
                     OPTIONEXERCISE|*TRANSFER*|...
  option_type        BUY_TO_OPEN|BUY_TO_CLOSE|SELL_TO_OPEN|SELL_TO_CLOSE
  units              quantity (shares, or option contracts)
  price              fill price (per share / per contract premium)
  fee                commission/fees
  amount             net cash
  currency           {code|currency} or string
  symbol             equity symbol object {symbol: 'AAPL', ...} or string
  option_symbol      option contract object (ticker/strike/expiry/type/underlying)
  trade_date         ISO date or datetime
  settlement_date    ISO date
"""

from __future__ import annotations

import re
from typing import Any

from api.services.journal_two.fifo import Fill


# Activity-type buckets.
_EQUITY_TRADE_TYPES = {"BUY", "SELL"}
_OPTION_LIFECYCLE = {
    "OPTIONEXPIRATION": "option_expiration",
    "OPTIONASSIGNMENT": "option_assignment",
    "OPTIONEXERCISE": "option_exercise",
}
_CASH_TYPES = {"DIVIDEND", "INTEREST", "FEE", "REI", "CONTRIBUTION", "WITHDRAWAL",
               "CASH", "STOCK_DIVIDEND", "SWEEP_IN", "SWEEP_OUT"}
# Share-moving non-trade activities: stock splits and securities journaled
# between accounts (Schwab JRNLSEC). These change the share count WITHOUT
# being trades — skipping them desyncs FIFO for the symbol (sells of
# journaled/split shares reconstruct as phantom shorts with bogus P&L).
_SHARE_ADJ_TYPES = {"SPLIT", "JRNLSEC"}


# ── Field extraction helpers ────────────────────────────────────────────────

def _num(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def normalize_symbol(raw: Any) -> str | None:
    """Uppercase, trim, and map class-share dots to hyphens (BRK.B → BRK-B)
    to match the app's canonical internal symbology (to_polygon_symbol maps
    hyphen→dot only at the Massive boundary)."""
    if raw is None:
        return None
    s = str(raw).strip().upper()
    if not s:
        return None
    # Single class suffix like BRK.B / BF.B → BRK-B / BF-B.
    s = re.sub(r"\.([A-Z])$", r"-\1", s)
    return s


def extract_symbol(act: dict) -> str | None:
    """Pull the equity ticker out of an activity's `symbol` field, which may
    be a nested universal-symbol object or a bare string."""
    sym = act.get("symbol")
    if isinstance(sym, str):
        return normalize_symbol(sym)
    if isinstance(sym, dict):
        # Universal symbol object: {symbol: 'AAPL', ...} or nested raw_symbol.
        return normalize_symbol(
            sym.get("symbol") or sym.get("raw_symbol") or sym.get("ticker")
        )
    return None


def normalize_date(act: dict) -> str | None:
    """Return an ISO-UTC string the FIFO layer can sort lexically. Date-only
    inputs anchor at midnight Z."""
    raw = act.get("trade_date") or act.get("settlement_date")
    if not raw:
        return None
    s = str(raw).strip()
    if not s:
        return None
    if "T" in s:
        # Ensure a trailing Z if there's no explicit offset.
        if s.endswith("Z") or "+" in s[10:] or re.search(r"-\d{2}:\d{2}$", s):
            return s
        return s + "Z"
    return s + "T00:00:00Z"


def extract_currency(act: dict) -> str | None:
    cur = act.get("currency")
    if isinstance(cur, str):
        return cur.upper() or None
    if isinstance(cur, dict):
        return (cur.get("code") or cur.get("currency") or "").upper() or None
    return None


# ── Classification ──────────────────────────────────────────────────────────

def classify(act: dict) -> str:
    """Bucket an activity. Option trades are detected by the presence of an
    option_symbol (covers brokers that report option fills with a plain
    BUY/SELL type)."""
    typ = str(act.get("type") or "").strip().upper()
    if typ in _OPTION_LIFECYCLE:
        return _OPTION_LIFECYCLE[typ]
    has_option = bool(act.get("option_symbol")) or bool(act.get("option_type"))
    if typ in _EQUITY_TRADE_TYPES or act.get("option_type"):
        return "option_trade" if has_option else "equity_trade"
    if typ in _CASH_TYPES:
        return "cash"
    if typ in _SHARE_ADJ_TYPES:
        return "share_adjustment"
    if "TRANSFER" in typ:
        return "transfer"
    return "unknown"


# ── Equity fills ────────────────────────────────────────────────────────────

def to_equity_fill(act: dict, row: int) -> Fill | None:
    """Convert an equity BUY/SELL activity into a FIFO Fill. Returns None
    (caller records a skip) if required fields are missing/invalid."""
    typ = str(act.get("type") or "").strip().upper()
    action = "Buy" if typ == "BUY" else "Sell" if typ == "SELL" else None
    if action is None:
        return None
    symbol = extract_symbol(act)
    units = _num(act.get("units"))
    price = _num(act.get("price"))
    date = normalize_date(act)
    if not symbol or units is None or price is None or date is None:
        return None
    if price <= 0:
        return None
    fee = _num(act.get("fee")) or 0.0
    return Fill(row=row, symbol=symbol, action=action,
                shares=abs(units), price=price, date=date, fee=abs(fee))


# ── Share adjustments (splits + share transfers/journals) ───────────────────

def to_share_adjustment(act: dict, row: int) -> dict | None:
    """Normalize a share-moving non-trade activity (SPLIT / JRNLSEC / a
    TRANSFER that carries a symbol + units) into a flat record for the FIFO
    layer: {row, symbol, kind: split|transfer, delta (signed shares), price
    (per-share value if the broker reported one), date}. Returns None when it
    doesn't describe an equity share movement (cash transfers, option-contract
    journals, missing fields)."""
    if act.get("option_symbol"):
        return None  # option-contract journal/adjust — not handled here
    typ = str(act.get("type") or "").strip().upper()
    symbol = extract_symbol(act)
    units = _num(act.get("units"))
    date = normalize_date(act)
    if not symbol or not units or date is None:
        return None
    price = _num(act.get("price"))
    return {
        "row": row,
        "symbol": symbol,
        "kind": "split" if typ == "SPLIT" else "transfer",
        "delta": units,
        "price": price if price and price > 0 else None,
        "date": date,
    }


# ── Option events ───────────────────────────────────────────────────────────

def _extract_option_contract(act: dict) -> dict | None:
    """Pull underlying / strike / expiration / call-or-put out of the
    option_symbol object. Defensive about field names."""
    osym = act.get("option_symbol")
    if not isinstance(osym, dict):
        return None
    underlying = osym.get("underlying_symbol")
    if isinstance(underlying, dict):
        underlying = underlying.get("symbol") or underlying.get("raw_symbol")
    underlying = normalize_symbol(underlying or osym.get("underlying"))
    strike = _num(osym.get("strike_price") or osym.get("strike"))
    expiration = osym.get("expiration_date") or osym.get("expiration")
    cp_raw = str(osym.get("option_type") or osym.get("type") or "").strip().lower()
    contract_type = None
    if cp_raw.startswith("c"):
        contract_type = "call"
    elif cp_raw.startswith("p"):
        contract_type = "put"
    if not underlying or strike is None or not expiration or not contract_type:
        return None
    exp = str(expiration).split("T")[0]  # date-only
    return {
        "underlying": underlying,
        "strike": strike,
        "expiration": exp,
        "contractType": contract_type,
    }


def to_option_event(act: dict, row: int) -> dict | None:
    """Normalize an option activity (trade or lifecycle event) into a flat
    record the option reconstructor (Phase 4) consumes. Returns None if it
    can't be parsed."""
    kind = classify(act)
    if kind not in ("option_trade", "option_expiration", "option_assignment", "option_exercise"):
        return None
    contract = _extract_option_contract(act)
    if contract is None:
        return None

    date = normalize_date(act)
    units = _num(act.get("units"))
    price = _num(act.get("price"))
    fee = _num(act.get("fee")) or 0.0

    # Determine open/close + buy/sell.
    ot = str(act.get("option_type") or "").strip().upper().replace(" ", "_")
    typ = str(act.get("type") or "").strip().upper()
    side = None      # 'buy' | 'sell'
    open_close = None  # 'open' | 'close'
    if ot in ("BUY_TO_OPEN", "BUY_TO_CLOSE", "SELL_TO_OPEN", "SELL_TO_CLOSE"):
        side = "buy" if ot.startswith("BUY") else "sell"
        open_close = "open" if ot.endswith("OPEN") else "close"
    elif typ == "BUY":
        side, open_close = "buy", None
    elif typ == "SELL":
        side, open_close = "sell", None

    return {
        "externalId": act.get("id"),
        "row": row,
        "eventKind": kind,            # option_trade | option_expiration | ...
        "side": side,                 # buy|sell|None (lifecycle events)
        "openClose": open_close,      # open|close|None
        "underlying": contract["underlying"],
        "strike": contract["strike"],
        "expiration": contract["expiration"],
        "contractType": contract["contractType"],
        "contracts": abs(units) if units is not None else None,
        "price": price,
        "fee": fee,
        "date": date,
        "currency": extract_currency(act),
    }


# ── Partition a batch ───────────────────────────────────────────────────────

def partition(activities: list[dict]) -> dict[str, Any]:
    """Split a list of raw activities into buckets. `row` indexes by input
    position for error reporting. Equity fills come out ready for FIFO."""
    equity_fills: list[Fill] = []
    option_events: list[dict] = []
    cash: list[dict] = []
    transfers: list[dict] = []
    share_adjustments: list[dict] = []
    skipped: list[dict] = []

    for i, act in enumerate(activities, start=1):
        if not isinstance(act, dict):
            skipped.append({"row": i, "reason": "not an object"})
            continue
        kind = classify(act)
        if kind == "equity_trade":
            fill = to_equity_fill(act, i)
            if fill is None:
                skipped.append({"row": i, "reason": "unparseable equity trade", "id": act.get("id")})
            else:
                equity_fills.append(fill)
        elif kind in ("option_trade", "option_expiration", "option_assignment", "option_exercise"):
            ev = to_option_event(act, i)
            if ev is None:
                skipped.append({"row": i, "reason": "unparseable option event", "id": act.get("id")})
            else:
                option_events.append(ev)
        elif kind == "cash":
            cash.append(act)
        elif kind == "share_adjustment":
            adj = to_share_adjustment(act, i)
            if adj is None:
                skipped.append({"row": i, "reason": "unparseable share adjustment", "id": act.get("id")})
            else:
                share_adjustments.append(adj)
        elif kind == "transfer":
            # Stays in the cash-flow bucket (reconcile_cash_flows consumes it);
            # a transfer that moves SHARES additionally feeds the FIFO layer.
            transfers.append(act)
            adj = to_share_adjustment(act, i)
            if adj is not None:
                share_adjustments.append(adj)
        else:
            skipped.append({"row": i, "reason": f"unknown type {act.get('type')!r}", "id": act.get("id")})

    return {
        "equity_fills": equity_fills,
        "option_events": option_events,
        "cash": cash,
        "transfers": transfers,
        "share_adjustments": share_adjustments,
        "skipped": skipped,
    }
