"""
Journal 2.0 — CSV import.

Spec §13 + §15.9 security hardening.

Flow:
  bytes → decode (UTF-8 / Windows-1252) → strip BOM → csv.reader
    → sanitize every cell → detect format → adapter-specific parse
    → return {format, trades, errors, warnings, headers, raw_rows}

Detected formats:
  pre_matched  — CSV with symbol/side/shares/entry_/exit_/[setup]/[notes]/[original_stop]
  schwab       — Schwab web-export (Brokerage → Transactions → Download)
  ibkr         — Interactive Brokers Trade Confirmation Report
  etrade       — E*Trade Portfolio → Download
  unknown      — unrecognized signature; client shows mapping wizard

Brokers export raw buy/sell FILLS. The adapter + FIFO reconstruction
in fifo.py turns those fills into round-trip Trade records (long only
per Phase 7 A1 decision).
"""

from __future__ import annotations

import csv
import io
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
    """Returns 'pre_matched', 'schwab', 'ibkr', 'etrade', or 'unknown'
    based on the header row signature."""
    if not headers:
        return "unknown"
    normed = {_norm_header(h) for h in headers}

    # Pre-matched: all required cols present (optionals may or may not be)
    if _PRE_MATCHED_REQUIRED.issubset(normed):
        return "pre_matched"

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
