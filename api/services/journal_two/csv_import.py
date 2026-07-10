"""
Journal 2.0 — CSV import.

Spec §13 + §15.9 security hardening.

Flow:
  bytes → decode (UTF-8 / Windows-1252) → strip BOM → csv.reader
    → sanitize every cell → detect format → adapter-specific parse
    → return {format, trades, errors, warnings, headers, raw_rows}

Detected formats:
  pre_matched  — CSV with symbol/side/shares/entry_/exit_/[setup]/[notes]/[original_stop]
  tradezella   — TradeZella trade-log export (one row per round-trip trade)
  tradersync   — TraderSync trade export (one row per round-trip trade)
  tradervue    — Tradervue generic/fill-level export (Date+Time+Symbol+Qty+Price)
  schwab       — Schwab web-export (Brokerage → Transactions → Download)
  ibkr         — Interactive Brokers Trade Confirmation Report
  etrade       — E*Trade Portfolio → Download
  unknown      — unrecognized signature; client shows mapping wizard

Competitor presets (Task 7): a TradeZella / Tradervue / TraderSync refugee
arrives with THEIR product's export CSV. Golden header samples live in
`csv_samples/{tradezella,tradervue,tradersync}.csv` and are exercised by
`test_csv_presets.py`, so a future format drift becomes a failing test, not a
silent fall-through to the generic column-mapper.

Brokers export raw buy/sell FILLS. The adapter + FIFO reconstruction
in fifo.py turns those fills into round-trip Trade records (long only
per Phase 7 A1 decision).
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from typing import Any

# ── Sanitization (§15.9) ─────────────────────────────────────────────────────

# Cells beginning with any of these are potential formula-injection vectors
# (Excel, LibreOffice, Google Sheets). Prefix with a single apostrophe so the
# spreadsheet renders them as text. Applied to EVERY cell before it's stored
# or rendered.
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def sanitize_cell(value: str) -> str:
    """Neutralize formula-injection characters at the start of a cell.
    Passes numeric-looking leading `-` through unchanged because real
    negatives in data (e.g. "-100") would otherwise sprout apostrophes;
    instead we require the leading char to be `-` AND the next char
    NOT be a digit/decimal to apply the prefix. Same for `+`.
    """
    if not isinstance(value, str) or not value:
        return value
    first = value[0]
    if first in ("=", "@", "\t", "\r"):
        return "'" + value
    if first in ("-", "+"):
        if len(value) == 1:
            return value
        # If the next char is a digit or decimal point, it's a number —
        # leave alone. Otherwise treat as injection vector.
        nxt = value[1]
        if not (nxt.isdigit() or nxt == "."):
            return "'" + value
    return value


# ── Decoding ─────────────────────────────────────────────────────────────────

def decode_bytes(raw: bytes) -> str:
    """Try UTF-8, fall back to Windows-1252. Reject binary (control chars
    other than \\t, \\r, \\n in the decoded output)."""
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]  # strip UTF-8 BOM
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("cp1252", errors="strict")

    # Binary sniff: if >1% of chars are non-printable non-whitespace
    non_printable = sum(
        1 for c in text if ord(c) < 32 and c not in ("\t", "\r", "\n")
    )
    if text and non_printable / max(len(text), 1) > 0.01:
        raise ValueError("File looks binary, not CSV")

    # Normalize line endings (spec §14.5 edge case #16: mixed/BOM)
    return text.replace("\r\n", "\n").replace("\r", "\n")


# ── Format detection ─────────────────────────────────────────────────────────

# Headers are lowercased + trimmed before matching.

_PRE_MATCHED_REQUIRED = {
    "symbol",
    "side",
    "shares",
    "entry_price",
    "entry_date",
    "exit_price",
    "exit_date",
}

_PRE_MATCHED_OPTIONAL = {"setup", "notes", "original_stop"}


def _norm_header(h: str) -> str:
    return (h or "").strip().lower().replace(" ", "_").replace("-", "_")


def detect_format(headers: list[str]) -> str:
    """Returns 'pre_matched', 'tradezella', 'tradersync', 'tradervue',
    'schwab', 'ibkr', 'etrade', or 'unknown' based on the header signature."""
    if not headers:
        return "unknown"
    normed = {_norm_header(h) for h in headers}

    # Pre-matched: all required cols present (optionals may or may not be)
    if _PRE_MATCHED_REQUIRED.issubset(normed):
        return "pre_matched"

    # ── Competitor journal exports (Task 7) ─────────────────────────────────
    # Checked BEFORE the broker signatures. Each uses a distinctive, disjoint
    # marker so a file can only ever match one:
    #   TradeZella  → "Net ROI" (net_roi) — its trade-log P&L column.
    #   TraderSync  → "Avg Entry"/"Avg Exit" (avg_entry/avg_exit) prices.
    #   Tradervue   → fill-level Date + Time + Symbol + Quantity + Price (no
    #                 "action" column, which is what would make it Schwab).
    if {"symbol", "net_roi"}.issubset(normed):
        return "tradezella"
    if {"symbol", "avg_entry", "avg_exit"}.issubset(normed):
        return "tradersync"
    if {"date", "time", "symbol", "quantity", "price"}.issubset(normed):
        return "tradervue"

    # Schwab web export signature (common Brokerage transactions download)
    # "Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"
    if {"date", "action", "symbol", "quantity", "price"}.issubset(normed):
        return "schwab"

    # IBKR Trade Confirmation Report signature — varies, but the trade
    # rows typically include these once the header section is skipped.
    # "Symbol","DateTime","Quantity","TradePrice","IBCommission","ClosePrice",...
    if {"symbol", "datetime", "quantity", "tradeprice"}.issubset(normed):
        return "ibkr"

    # E*Trade signature: "TransactionDate","TransactionType","SecurityType",
    # "Symbol","Quantity","Amount"
    if {
        "transactiondate",
        "transactiontype",
        "symbol",
        "quantity",
    }.issubset(normed):
        return "etrade"

    return "unknown"


# ── Parse result types ───────────────────────────────────────────────────────

@dataclass
class ParseError:
    row: int  # 1-indexed, counting the header as row 1
    message: str


@dataclass
class ParseResult:
    format: str
    trades: list[dict[str, Any]] = field(default_factory=list)
    errors: list[ParseError] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    headers: list[str] = field(default_factory=list)
    raw_rows: list[list[str]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "format": self.format,
            "trades": self.trades,
            "errors": [{"row": e.row, "message": e.message} for e in self.errors],
            "warnings": list(self.warnings),
            "headers": list(self.headers),
            "raw_rows": list(self.raw_rows),
        }


# ── Pre-matched adapter ──────────────────────────────────────────────────────

def _require_number(value: str, label: str, row: int, errors: list[ParseError]) -> float | None:
    try:
        return float(str(value).replace("$", "").replace(",", "").strip())
    except (ValueError, TypeError):
        errors.append(ParseError(row, f"{label} must be a number (got '{value}')"))
        return None


def _require_iso_date(value: str, label: str, row: int, errors: list[ParseError]) -> str | None:
    """Pre-matched CSV requires ISO YYYY-MM-DD — no ambiguity."""
    import re
    v = (value or "").strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", v):
        errors.append(
            ParseError(row, f"{label} must be ISO date YYYY-MM-DD (got '{v}')")
        )
        return None
    return v + "T00:00:00Z"


def parse_pre_matched(headers: list[str], rows: list[list[str]]) -> ParseResult:
    """Each CSV row → one Trade-shaped dict ready for server-side derived
    compute. Missing or invalid required fields → row skipped, error
    logged with row number."""
    result = ParseResult(format="pre_matched", headers=list(headers))
    col_idx = {_norm_header(h): i for i, h in enumerate(headers)}

    for i, row in enumerate(rows, start=2):  # +1 for header, +1 for 1-indexed
        if all(not (c or "").strip() for c in row):
            continue  # blank line skip
        errors: list[ParseError] = []

        def get(key: str) -> str:
            idx = col_idx.get(key)
            if idx is None or idx >= len(row):
                return ""
            return (row[idx] or "").strip()

        symbol = get("symbol").upper()
        if not symbol:
            errors.append(ParseError(i, "symbol is required"))

        side_raw = get("side")
        side_norm = side_raw.strip().title()
        if side_norm not in {"Long", "Short"}:
            errors.append(
                ParseError(i, f"side must be Long or Short (got '{side_raw}')")
            )
            side_norm = None

        shares = _require_number(get("shares"), "shares", i, errors)
        if shares is not None and shares <= 0:
            errors.append(ParseError(i, "shares must be > 0"))
            shares = None

        entry_price = _require_number(get("entry_price"), "entry_price", i, errors)
        if entry_price is not None and entry_price <= 0:
            errors.append(ParseError(i, "entry_price must be > 0"))
            entry_price = None

        exit_price = _require_number(get("exit_price"), "exit_price", i, errors)
        if exit_price is not None and exit_price <= 0:
            errors.append(ParseError(i, "exit_price must be > 0"))
            exit_price = None

        entry_date = _require_iso_date(get("entry_date"), "entry_date", i, errors)
        exit_date = _require_iso_date(get("exit_date"), "exit_date", i, errors)

        if entry_date and exit_date and exit_date < entry_date:
            errors.append(ParseError(i, "exit_date cannot be before entry_date"))

        # Optional fields
        setup = get("setup") or None
        notes = get("notes") or None
        original_stop_raw = get("original_stop")
        if original_stop_raw:
            original_stop = _require_number(original_stop_raw, "original_stop", i, errors)
            if original_stop is not None and original_stop < 0:
                errors.append(ParseError(i, "original_stop must be >= 0"))
                original_stop = None
        else:
            original_stop = None  # defaults to entry_price in the bulk insert

        if errors:
            result.errors.extend(errors)
            continue

        result.trades.append(
            {
                "symbol": symbol,
                "side": side_norm,
                "shares": shares,
                "entryPrice": entry_price,
                "entryDate": entry_date,
                "exitPrice": exit_price,
                "exitDate": exit_date,
                "originalStop": original_stop,
                "setup": setup,
                "notes": notes,
            }
        )

    return result


# ── Broker adapters (raw fills → FIFO reconstruction) ───────────────────────

def _parse_us_date(s: str) -> str | None:
    """MM/DD/YYYY (or MM/DD/YY) → ISO. Used by Schwab + E*Trade."""
    import re
    s = (s or "").strip()
    # Strip time component if present
    s = s.split(" ")[0] if " " in s else s
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2,4})$", s)
    if not m:
        return None
    mm, dd, yy = m.groups()
    yyyy = yy if len(yy) == 4 else "20" + yy
    return f"{yyyy}-{int(mm):02d}-{int(dd):02d}T00:00:00Z"


def _parse_iso_datetime(s: str) -> str | None:
    """YYYY-MM-DD or YYYY-MM-DD HH:MM:SS → ISO UTC. IBKR uses this."""
    import re
    s = (s or "").strip().replace(",", "")
    # Handle "YYYYMMDD;HHMMSS" variant too
    m = re.match(r"^(\d{4})-?(\d{2})-?(\d{2})([ T;]?(\d{2}):?(\d{2}):?(\d{2}))?$", s)
    if not m:
        return None
    yyyy, mm, dd = m.group(1), m.group(2), m.group(3)
    hh = m.group(5) or "00"
    mi = m.group(6) or "00"
    ss = m.group(7) or "00"
    return f"{yyyy}-{mm}-{dd}T{hh}:{mi}:{ss}Z"


def _num_or_none(v: str) -> float | None:
    try:
        return float(str(v).replace("$", "").replace(",", "").strip())
    except (ValueError, TypeError):
        return None


# ── Flexible date/datetime parsing for competitor exports ────────────────────
# Competitor journals export a date OR a full datetime, in the account's local
# timezone (US traders → ET). We normalize to the same stored-ISO convention the
# rest of J2 uses so P1a's trading_day_et/hour_et land correctly:
#   • date-only cell        → "YYYY-MM-DDT00:00:00Z" (UTC-midnight = literal ET
#                             trading day, NULL hour) — matches _require_iso_date.
#   • cell carrying a time  → interpreted as ET-LOCAL and converted to UTC (real
#                             hour_et), unless it already carries an explicit tz
#                             offset (then that offset is respected).
# Every returned string ends in "Z" so lexical ordering is chronological (the
# FIFO reconstructor sorts fills by this string).

def _parse_date_part(s: str) -> tuple[int, int, int] | None:
    """(year, month, day) from 'YYYY-MM-DD' or 'MM/DD/YYYY' (or -). 2-digit
    year → 20xx."""
    s = (s or "").strip()
    m = re.match(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$", s)
    if m:
        return int(m.group(1)), int(m.group(2)), int(m.group(3))
    m = re.match(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$", s)
    if m:
        mm, dd, yy = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if yy < 100:
            yy += 2000
        return yy, mm, dd
    return None


def _parse_time_part(s: str) -> tuple[int, int, int] | None:
    """(hour, minute, second) from 'HH:MM[:SS]' with optional AM/PM."""
    s = (s or "").strip()
    if not s:
        return None
    m = re.match(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$", s)
    if not m:
        return None
    hh, mi, ss = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)
    ap = (m.group(4) or "").lower()
    if ap == "pm" and hh != 12:
        hh += 12
    elif ap == "am" and hh == 12:
        hh = 0
    if hh > 23 or mi > 59 or ss > 59:
        return None
    return hh, mi, ss


def _split_date_time_cell(s: str) -> tuple[str, str]:
    """Split a single cell that may bundle a date AND a time into (date, time)."""
    s = (s or "").strip()
    if "T" in s:
        a, b = s.split("T", 1)
        return a.strip(), b.strip()
    parts = s.split(" ", 1)
    if len(parts) == 2 and ":" in parts[1]:
        return parts[0].strip(), parts[1].strip()
    return s, ""


def _parse_dt(date_cell: str, time_cell: str = "") -> str | None:
    """Normalize a competitor date/datetime into stored-ISO (see block comment).
    Returns None when the date part can't be parsed."""
    from datetime import datetime as _dt

    from api.services.journal_two.timeutil import ET, UTC

    date_cell = (date_cell or "").strip()
    time_cell = (time_cell or "").strip()
    if not date_cell:
        return None

    # An already-tz-aware ISO datetime (e.g. "...T14:30:00Z" / "...+00:00") is
    # respected verbatim rather than re-interpreted as ET.
    if not time_cell and "T" in date_cell and (
        date_cell.endswith("Z") or re.search(r"[+-]\d{2}:?\d{2}$", date_cell)
    ):
        try:
            aware = _dt.fromisoformat(date_cell.replace("Z", "+00:00"))
            return aware.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            pass

    if not time_cell:
        date_cell, time_cell = _split_date_time_cell(date_cell)

    ymd = _parse_date_part(date_cell)
    if ymd is None:
        return None
    y, mo, d = ymd

    hms = _parse_time_part(time_cell) if time_cell else None
    if hms is None:
        # Date-only → UTC midnight (literal ET trading day, NULL hour).
        return f"{y:04d}-{mo:02d}-{d:02d}T00:00:00Z"
    try:
        local = _dt(y, mo, d, hms[0], hms[1], hms[2], tzinfo=ET)
    except ValueError:
        return None
    return local.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_schwab(headers: list[str], rows: list[list[str]]) -> ParseResult:
    """Schwab web-export (Brokerage → Transactions → Download).
    Expected columns: Date, Action, Symbol, Description, Quantity, Price,
    Fees & Comm, Amount. Action values include: Buy, Sell, Reinvest Dividend,
    etc. We only process Buy and Sell; others ignored silently."""
    from api.services.journal_two.fifo import Fill, reconstruct_trades

    result = ParseResult(format="schwab", headers=list(headers))
    col = {_norm_header(h): i for i, h in enumerate(headers)}
    fills: list[Fill] = []

    def get(row: list[str], key: str) -> str:
        idx = col.get(key)
        return (row[idx] or "").strip() if idx is not None and idx < len(row) else ""

    for i, row in enumerate(rows, start=2):
        if all(not (c or "").strip() for c in row):
            continue
        action_raw = get(row, "action")
        # Schwab uses "Buy" / "Sell" as primary actions on equity trades.
        # Ignore non-trade actions (dividends, transfers, etc.) silently.
        if action_raw not in ("Buy", "Sell"):
            continue

        symbol = get(row, "symbol").upper()
        if not symbol:
            result.errors.append(ParseError(i, "symbol missing on Buy/Sell row"))
            continue
        shares = _num_or_none(get(row, "quantity"))
        price = _num_or_none(get(row, "price"))
        date = _parse_us_date(get(row, "date"))
        if shares is None or price is None or date is None:
            result.errors.append(
                ParseError(i, "Schwab row needs numeric quantity + price and MM/DD/YYYY date")
            )
            continue
        fills.append(Fill(row=i, symbol=symbol, action=action_raw, shares=shares, price=price, date=date))

    fifo_out = reconstruct_trades(fills)
    result.trades = fifo_out["trades"]
    for e in fifo_out["errors"]:
        result.errors.append(ParseError(e["row"], e["message"]))
    return result


def parse_etrade(headers: list[str], rows: list[list[str]]) -> ParseResult:
    """E*Trade Portfolio → Download export. Spec §13.2: "Bought/Sold rows
    only." We only process rows where TransactionType is Bought or Sold.
    Expected columns: TransactionDate, TransactionType, SecurityType,
    Symbol, Quantity, Amount."""
    from api.services.journal_two.fifo import Fill, reconstruct_trades

    result = ParseResult(format="etrade", headers=list(headers))
    col = {_norm_header(h): i for i, h in enumerate(headers)}
    fills: list[Fill] = []

    def get(row: list[str], key: str) -> str:
        idx = col.get(key)
        return (row[idx] or "").strip() if idx is not None and idx < len(row) else ""

    for i, row in enumerate(rows, start=2):
        if all(not (c or "").strip() for c in row):
            continue

        txn = get(row, "transactiontype")
        if txn == "Bought":
            action = "Buy"
        elif txn == "Sold":
            action = "Sell"
        else:
            continue  # ignore dividends, transfers, etc.

        # Stocks only — spec §13.2 IBKR extends here. E*Trade SecurityType
        # may say "EQ" or "STOCK"; skip options/futures.
        sec_type = get(row, "securitytype").lower()
        if sec_type and sec_type not in ("eq", "stock", ""):
            continue

        symbol = get(row, "symbol").upper()
        if not symbol:
            result.errors.append(ParseError(i, "symbol missing on Bought/Sold row"))
            continue
        shares = _num_or_none(get(row, "quantity"))
        # E*Trade "Amount" is signed total; derive price from Amount/Quantity
        # when Price column isn't present.
        price = _num_or_none(get(row, "price"))
        if price is None:
            amount = _num_or_none(get(row, "amount"))
            if amount is not None and shares and shares != 0:
                price = abs(amount / shares)
        date = _parse_us_date(get(row, "transactiondate"))
        if shares is None or price is None or price <= 0 or date is None:
            result.errors.append(
                ParseError(i, "E*Trade row needs quantity, price (or amount/quantity), and MM/DD/YYYY transaction date")
            )
            continue
        shares = abs(shares)  # E*Trade may emit negative shares for sells
        fills.append(Fill(row=i, symbol=symbol, action=action, shares=shares, price=price, date=date))

    fifo_out = reconstruct_trades(fills)
    result.trades = fifo_out["trades"]
    for e in fifo_out["errors"]:
        result.errors.append(ParseError(e["row"], e["message"]))
    return result


def parse_ibkr(headers: list[str], rows: list[list[str]]) -> ParseResult:
    """Interactive Brokers Trade Confirmation Report — stocks only
    (spec §13.2). Expected columns: Symbol, DateTime, Quantity,
    TradePrice, IBCommission. Quantity sign encodes side: positive
    = Buy, negative = Sell (IBKR convention)."""
    from api.services.journal_two.fifo import Fill, reconstruct_trades

    result = ParseResult(format="ibkr", headers=list(headers))
    col = {_norm_header(h): i for i, h in enumerate(headers)}
    fills: list[Fill] = []

    def get(row: list[str], key: str) -> str:
        idx = col.get(key)
        return (row[idx] or "").strip() if idx is not None and idx < len(row) else ""

    for i, row in enumerate(rows, start=2):
        if all(not (c or "").strip() for c in row):
            continue
        # IBKR may have "AssetClass" column. Filter to stocks only.
        asset_class = get(row, "assetclass").upper() if "assetclass" in col else ""
        if asset_class and asset_class not in ("STK", "STOCK", ""):
            continue

        symbol = get(row, "symbol").upper()
        if not symbol:
            result.errors.append(ParseError(i, "symbol missing on IBKR row"))
            continue
        qty = _num_or_none(get(row, "quantity"))
        price = _num_or_none(get(row, "tradeprice"))
        date = _parse_iso_datetime(get(row, "datetime"))
        if qty is None or price is None or date is None:
            result.errors.append(
                ParseError(i, "IBKR row needs numeric quantity + tradePrice and YYYY-MM-DD DateTime")
            )
            continue
        if qty == 0:
            continue
        action = "Buy" if qty > 0 else "Sell"
        fills.append(Fill(row=i, symbol=symbol, action=action, shares=abs(qty), price=price, date=date))

    fifo_out = reconstruct_trades(fills)
    result.trades = fifo_out["trades"]
    for e in fifo_out["errors"]:
        result.errors.append(ParseError(e["row"], e["message"]))
    return result


# ── Competitor journal presets (Task 7) ─────────────────────────────────────
#
# TradeZella + TraderSync export ROUND-TRIP trades (one CSV row = one closed
# trade with entry/exit prices + open/close dates) → parsed directly into the
# pre-matched trade-dict shape, preserving any execution timestamps.
#
# Tradervue exports FILL-level executions (Date/Time/Symbol/Qty/Price/Side) →
# runs through the same FIFO reconstructor the broker CSVs use, so multi-fill
# round-trips collapse into trades with real entry/exit timestamps.
#
# Setup/strategy → `setup`; any extra tags (mistakes, custom tags, additional
# setups) spill into a `[tags: …]` suffix on `notes`. Nothing is written to the
# per-account settings library — imported labels are free-text on the trade only.

# Generous alias sets (normalized headers) so minor column-name drift between
# these products' export versions still parses; the golden samples pin the
# canonical header row and turn a real signature change into a failing test.
_TL_SYMBOL = ("symbol", "ticker")
_TL_SIDE = ("side", "direction", "position", "long_short", "type")
_TL_SHARES = ("quantity", "size", "shares", "qty", "volume", "contracts")
_TL_ENTRY_PX = ("entry_price", "avg_entry", "avg_entry_price", "avg_buy_price",
                "buy_price", "open_price", "entry")
_TL_EXIT_PX = ("exit_price", "avg_exit", "avg_exit_price", "avg_sell_price",
               "sell_price", "close_price", "exit")
_TL_ENTRY_DT = ("open_date", "entry_date", "opened", "date_opened", "open_time",
                "entry_time", "open_datetime", "entry_datetime", "open")
_TL_EXIT_DT = ("close_date", "closed_date", "exit_date", "closed", "date_closed",
               "close_time", "exit_time", "close_datetime", "exit_datetime", "close")
_TL_SETUP = ("setups", "setup", "strategy", "strategies", "playbook")
_TL_TAGS = ("mistakes", "mistake", "custom_tags", "tags", "tag", "emotions")
_TL_NOTES = ("notes", "note", "comment", "comments", "journal")
_TL_STOP = ("stop_loss", "stop", "stop_price", "initial_stop", "stoploss")


def _norm_side(raw: str) -> str | None:
    s = (raw or "").strip().lower()
    if not s:
        return None
    if s in ("long", "buy", "b", "bought", "l") or s.startswith("long"):
        return "Long"
    if s in ("short", "sell", "s", "sold", "sht") or s.startswith("short"):
        return "Short"
    return None


def _collect_tokens(row: list[str], col: dict[str, int], aliases: tuple) -> list[str]:
    """Comma/semicolon/pipe-split tokens gathered across EVERY column whose
    normalized header is in `aliases` (mistakes AND custom_tags both spill)."""
    tokens: list[str] = []
    seen_idx: set[int] = set()
    for a in aliases:
        idx = col.get(a)
        if idx is None or idx in seen_idx or idx >= len(row):
            continue
        seen_idx.add(idx)
        for tok in re.split(r"[;,|]", (row[idx] or "")):
            tok = tok.strip()
            if tok:
                tokens.append(tok)
    return tokens


def _parse_trade_level(fmt: str, headers: list[str], rows: list[list[str]]) -> ParseResult:
    """Shared parser for TradeZella / TraderSync round-trip-trade exports."""
    result = ParseResult(format=fmt, headers=list(headers))
    col = {_norm_header(h): i for i, h in enumerate(headers)}

    def cell(row: list[str], aliases: tuple) -> str:
        for a in aliases:
            idx = col.get(a)
            if idx is not None and idx < len(row):
                v = (row[idx] or "").strip()
                if v:
                    return v
        return ""

    for i, row in enumerate(rows, start=2):
        if all(not (c or "").strip() for c in row):
            continue
        errors: list[ParseError] = []

        symbol = cell(row, _TL_SYMBOL).upper()
        if not symbol:
            errors.append(ParseError(i, "symbol is required"))

        side_raw = cell(row, _TL_SIDE)
        side = _norm_side(side_raw)
        if side is None:
            errors.append(ParseError(i, f"side must be Long or Short (got '{side_raw}')"))

        shares = _require_number(cell(row, _TL_SHARES), "shares/size", i, errors)
        if shares is not None and shares <= 0:
            errors.append(ParseError(i, "shares must be > 0"))
            shares = None

        entry_price = _require_number(cell(row, _TL_ENTRY_PX), "entry price", i, errors)
        if entry_price is not None and entry_price <= 0:
            errors.append(ParseError(i, "entry price must be > 0"))
            entry_price = None

        exit_price = _require_number(cell(row, _TL_EXIT_PX), "exit price", i, errors)
        if exit_price is not None and exit_price <= 0:
            errors.append(ParseError(i, "exit price must be > 0"))
            exit_price = None

        entry_raw = cell(row, _TL_ENTRY_DT)
        entry_date = _parse_dt(entry_raw)
        if entry_date is None:
            errors.append(ParseError(i, f"open/entry date unparseable (got '{entry_raw}')"))

        exit_raw = cell(row, _TL_EXIT_DT)
        exit_date = _parse_dt(exit_raw)
        if exit_date is None:
            errors.append(ParseError(i, f"close/exit date unparseable (got '{exit_raw}')"))

        if entry_date and exit_date and exit_date < entry_date:
            errors.append(ParseError(i, "exit date cannot be before entry date"))

        # Optional original stop → real R-multiple when present (blank → None →
        # bulk_insert defaults to entry price → honest null R).
        original_stop = None
        stop_raw = cell(row, _TL_STOP)
        if stop_raw:
            sv = _num_or_none(stop_raw)
            if sv is not None and sv > 0:
                original_stop = sv

        # Setup (lead token) + spilled tags.
        setup_tokens = _collect_tokens(row, col, _TL_SETUP)
        setup = setup_tokens[0] if setup_tokens else None
        extra_tags = setup_tokens[1:] + _collect_tokens(row, col, _TL_TAGS)
        notes = cell(row, _TL_NOTES) or None
        if extra_tags:
            suffix = "[tags: " + ", ".join(extra_tags) + "]"
            notes = f"{notes} {suffix}" if notes else suffix

        if errors:
            result.errors.extend(errors)
            continue

        result.trades.append(
            {
                "symbol": symbol,
                "side": side,
                "shares": shares,
                "entryPrice": entry_price,
                "entryDate": entry_date,
                "exitPrice": exit_price,
                "exitDate": exit_date,
                "originalStop": original_stop,
                "setup": setup,
                "notes": notes,
            }
        )

    return result


def parse_tradezella(headers: list[str], rows: list[list[str]]) -> ParseResult:
    """TradeZella trade-log export → round-trip trade dicts."""
    return _parse_trade_level("tradezella", headers, rows)


def parse_tradersync(headers: list[str], rows: list[list[str]]) -> ParseResult:
    """TraderSync trade export → round-trip trade dicts."""
    return _parse_trade_level("tradersync", headers, rows)


def parse_tradervue(headers: list[str], rows: list[list[str]]) -> ParseResult:
    """Tradervue generic/fill-level export → FIFO-reconstructed round-trips.

    Long-only (allow_shorts=False, same as the other broker CSV adapters): a
    sell with no held long / a 'Short' side surfaces as a FIFO error row.
    Date + Time combine into a real ET-anchored execution timestamp preserved
    onto the reconstructed trade's entry/exit dates."""
    from api.services.journal_two.fifo import Fill, reconstruct_trades

    result = ParseResult(format="tradervue", headers=list(headers))
    col = {_norm_header(h): i for i, h in enumerate(headers)}
    fills: list[Fill] = []

    def g(row: list[str], aliases: tuple) -> str:
        for a in aliases:
            idx = col.get(a)
            if idx is not None and idx < len(row):
                v = (row[idx] or "").strip()
                if v:
                    return v
        return ""

    for i, row in enumerate(rows, start=2):
        if all(not (c or "").strip() for c in row):
            continue

        symbol = g(row, ("symbol", "ticker")).upper()
        if not symbol:
            result.errors.append(ParseError(i, "symbol missing on fill row"))
            continue

        qty = _num_or_none(g(row, ("quantity", "qty", "volume", "shares", "size")))
        price = _num_or_none(g(row, ("price", "fill_price", "avg_price")))
        dt = _parse_dt(
            g(row, ("date", "trade_date", "exec_date", "datetime")),
            g(row, ("time", "exec_time", "fill_time")),
        )
        if qty is None or price is None or price <= 0 or dt is None:
            result.errors.append(
                ParseError(i, "Tradervue fill needs quantity, price (> 0), and a valid date")
            )
            continue

        side_raw = g(row, ("side", "action", "type"))
        if side_raw:
            action = "Buy" if side_raw.strip().lower().startswith("b") else "Sell"
        else:
            # No side column → Tradervue convention: negative qty = sell.
            action = "Sell" if qty < 0 else "Buy"

        shares = abs(qty)
        if shares == 0:
            continue

        fee = 0.0
        for fa in ("commission", "commissions", "fees", "fee", "transfee", "ecnfee"):
            fv = _num_or_none(g(row, (fa,)))
            if fv is not None:
                fee += abs(fv)

        fills.append(Fill(row=i, symbol=symbol, action=action, shares=shares, price=price, date=dt, fee=fee))

    fifo_out = reconstruct_trades(fills)
    result.trades = fifo_out["trades"]
    for e in fifo_out["errors"]:
        result.errors.append(ParseError(e["row"], e["message"]))
    return result


# ── Column-mapping (unknown → pre-matched shape) ────────────────────────────

def parse_with_mapping(
    headers: list[str],
    rows: list[list[str]],
    mapping: dict[str, str],
) -> ParseResult:
    """Parse an unknown-format CSV by translating it to pre-matched via
    a user-supplied mapping. `mapping` keys are pre-matched field names
    (symbol, side, shares, entry_price, entry_date, exit_price, exit_date,
    setup, notes, original_stop); values are the source CSV header names
    (exact, case-sensitive match against `headers`).
    """
    REQUIRED = {"symbol", "side", "shares", "entry_price", "entry_date",
                "exit_price", "exit_date"}
    missing = REQUIRED - set(mapping.keys())
    if missing:
        res = ParseResult(format="unknown")
        res.errors.append(ParseError(0, f"mapping missing required fields: {sorted(missing)}"))
        return res

    # Build a synthetic header row + translated rows matching pre-matched shape
    header_to_index = {h: i for i, h in enumerate(headers)}
    synth_headers = list(mapping.keys())
    translated = []
    for r in rows:
        new_row = []
        for field in synth_headers:
            src_header = mapping[field]
            idx = header_to_index.get(src_header)
            new_row.append((r[idx] if idx is not None and idx < len(r) else "") or "")
        translated.append(new_row)

    out = parse_pre_matched(synth_headers, translated)
    out.format = "mapped"  # hint to the client it went through the wizard
    out.headers = list(headers)
    return out


# ── Main entry point ─────────────────────────────────────────────────────────

MAX_BYTES = 10 * 1024 * 1024  # §15.9: reject files > 10 MB


def parse_csv(raw: bytes) -> ParseResult:
    """Main entry. Decode → sanitize → detect → dispatch. Never raises
    on user errors; returns a ParseResult with errors[] populated."""
    if len(raw) > MAX_BYTES:
        raise ValueError(f"File exceeds {MAX_BYTES // (1024 * 1024)} MB limit")
    if not raw:
        raise ValueError("File is empty")

    text = decode_bytes(raw)
    reader = csv.reader(io.StringIO(text))
    rows = [
        [sanitize_cell(cell) for cell in r] for r in reader
    ]
    if not rows:
        raise ValueError("CSV has no rows")

    headers = rows[0]
    data_rows = rows[1:]

    fmt = detect_format(headers)

    if fmt == "pre_matched":
        return parse_pre_matched(headers, data_rows)

    if fmt == "tradezella":
        return parse_tradezella(headers, data_rows)
    if fmt == "tradersync":
        return parse_tradersync(headers, data_rows)
    if fmt == "tradervue":
        return parse_tradervue(headers, data_rows)

    if fmt == "schwab":
        return parse_schwab(headers, data_rows)
    if fmt == "ibkr":
        return parse_ibkr(headers, data_rows)
    if fmt == "etrade":
        return parse_etrade(headers, data_rows)

    # Unknown → return headers + first 20 rows so the mapping wizard can draw
    result = ParseResult(format="unknown", headers=list(headers))
    result.raw_rows = [list(r) for r in data_rows[:20]]
    result.warnings.append(
        "Unrecognized format — use the column mapper to match your columns."
    )
    return result
