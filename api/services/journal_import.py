"""
CSV import service — parse broker exports, map fields, detect duplicates, create trades.
Supports TD Ameritrade, Interactive Brokers, Schwab, and generic CSV formats.
"""

import csv
import io
import uuid
from datetime import datetime, timezone

from api.services.auth_db import get_connection
from api.services.journal_service import create_entry


# Known broker column mappings
BROKER_PROFILES = {
    "td_ameritrade": {
        "sym": ["Symbol", "Sym"],
        "direction": ["Side", "Buy/Sell", "Action"],
        "entry_price": ["Price", "Exec Price", "Fill Price"],
        "shares": ["Qty", "Quantity", "Shares"],
        "entry_date": ["Date", "Trade Date", "Exec Date", "Date/Time"],
        "entry_time": ["Time", "Exec Time"],
        "fees": ["Commission", "Comm", "Fees"],
    },
    "interactive_brokers": {
        "sym": ["Symbol", "Underlying"],
        "direction": ["Buy/Sell", "Side"],
        "entry_price": ["T. Price", "Price", "Trade Price"],
        "shares": ["Quantity", "Qty"],
        "entry_date": ["Date/Time", "TradeDate"],
        "fees": ["Comm/Fee", "IBCommission", "Commission"],
    },
    "schwab": {
        "sym": ["Symbol"],
        "direction": ["Action"],
        "entry_price": ["Price"],
        "shares": ["Quantity"],
        "entry_date": ["Date"],
        "fees": ["Fees & Comm", "Fees"],
    },
    "generic": {
        "sym": ["sym", "symbol", "ticker", "Symbol", "Ticker", "Sym"],
        "direction": ["side", "direction", "Side", "Direction", "Buy/Sell", "Action", "action"],
        "entry_price": ["price", "entry", "entry_price", "Price", "Entry", "Entry Price"],
        "shares": ["qty", "shares", "quantity", "Qty", "Shares", "Quantity"],
        "entry_date": ["date", "entry_date", "Date", "Entry Date", "Trade Date"],
        "entry_time": ["time", "entry_time", "Time", "Entry Time"],
        "fees": ["fees", "commission", "Fees", "Commission"],
        "stop_price": ["stop", "stop_price", "Stop", "Stop Price"],
        "notes": ["notes", "Notes", "Comment", "comment"],
    },
}


def detect_broker(headers: list[str]) -> str | None:
    """Attempt to auto-detect broker from CSV headers."""
    header_set = {h.strip().lower() for h in headers}

    # Check specific brokers first (not generic)
    for broker in ("td_ameritrade", "interactive_brokers", "schwab"):
        mapping = BROKER_PROFILES[broker]
        matches = 0
        for field, candidates in mapping.items():
            if any(c.lower() in header_set for c in candidates):
                matches += 1
        if matches >= 3:
            return broker

    # Fall back to generic if we can match at least sym + date + price
    generic = BROKER_PROFILES["generic"]
    essential_matches = 0
    for field in ("sym", "entry_date", "entry_price"):
        if any(c.lower() in header_set for c in generic[field]):
            essential_matches += 1
    if essential_matches >= 2:
        return "generic"

    return None


def build_auto_mapping(headers: list[str], broker: str) -> dict[str, str]:
    """Build field mapping from detected broker profile."""
    if broker not in BROKER_PROFILES:
        return {}

    profile = BROKER_PROFILES[broker]
    mapping = {}
    for target, candidates in profile.items():
        for c in candidates:
            if c in headers:
                mapping[target] = c
                break
    return mapping


def parse_csv(content: str, field_mapping: dict) -> tuple[list[dict], list[str]]:
    """Parse CSV content using the provided field mapping.
    Returns (parsed_rows, warnings).
    field_mapping: {"sym": "Symbol", "entry_price": "Price", ...}
    """
    reader = csv.DictReader(io.StringIO(content))
    rows = []
    warnings = []

    for i, csv_row in enumerate(reader, 1):
        trade = {}
        for target_field, source_col in field_mapping.items():
            val = csv_row.get(source_col, "").strip()
            if val:
                trade[target_field] = val

        # Normalize
        if not trade.get("sym"):
            warnings.append(f"Row {i}: missing symbol, skipped")
            continue

        trade["sym"] = trade["sym"].upper().replace(" ", "")

        # Parse price fields
        for price_field in ("entry_price", "exit_price", "stop_price", "fees"):
            if trade.get(price_field):
                try:
                    trade[price_field] = float(
                        trade[price_field].replace("$", "").replace(",", "").strip()
                    )
                except ValueError:
                    warnings.append(f"Row {i}: invalid {price_field} '{trade[price_field]}'")
                    trade[price_field] = None

        # Parse shares
        if trade.get("shares"):
            try:
                trade["shares"] = abs(float(trade["shares"].replace(",", "").strip()))
            except ValueError:
                warnings.append(f"Row {i}: invalid shares")
                trade["shares"] = None

        # Normalize direction
        direction = (trade.get("direction") or "").strip().lower()
        if direction in ("buy", "long", "bot", "bought", "b"):
            trade["direction"] = "long"
        elif direction in ("sell", "short", "sld", "sold", "s", "sell short"):
            trade["direction"] = "short"
        else:
            trade["direction"] = "long"

        # Parse date
        if trade.get("entry_date"):
            trade["entry_date"] = _normalize_date(trade["entry_date"])

        # Parse time if embedded in date
        if trade.get("entry_date") and " " in str(trade.get("entry_date", "")):
            # Date might contain time component — already handled by _normalize_date
            pass

        trade["status"] = "closed"  # Imported trades default to closed
        trade["review_status"] = "draft"  # Start as draft
        rows.append(trade)

    return rows, warnings


def _normalize_date(date_str: str) -> str:
    """Try common date formats and return YYYY-MM-DD."""
    date_str = date_str.strip()

    # Handle datetime strings (strip time component for date field)
    for fmt in (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%m/%d/%Y %H:%M:%S",
        "%m/%d/%Y %I:%M %p",
        "%Y-%m-%d",
        "%m/%d/%Y",
        "%m/%d/%y",
        "%Y/%m/%d",
        "%d-%b-%Y",
        "%m-%d-%Y",
        "%d/%m/%Y",
    ):
        try:
            return datetime.strptime(date_str, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    # Last resort: try to extract first 10 chars
    return date_str[:10]


def find_duplicates(user_id: str, rows: list[dict], tolerance: float = 0.01) -> list[int]:
    """Return indices of rows that are likely duplicates of existing trades.
    Matches on symbol + date + price within tolerance (default 1%).
    """
    conn = get_connection()
    try:
        existing = conn.execute(
            "SELECT sym, entry_date, entry_price FROM journal_entries WHERE user_id = ?",
            (user_id,),
        ).fetchall()
        existing_set = [
            (r["sym"], r["entry_date"], r["entry_price"])
            for r in existing if r["entry_price"]
        ]

        dupes = []
        for i, row in enumerate(rows):
            sym = row.get("sym")
            date = row.get("entry_date")
            price = row.get("entry_price")
            if not all([sym, date, price]):
                continue
            for e_sym, e_date, e_price in existing_set:
                if (sym == e_sym and date == e_date
                        and e_price and abs(price - e_price) / e_price <= tolerance):
                    dupes.append(i)
                    break

        return dupes
    finally:
        conn.close()


def import_trades(user_id: str, rows: list[dict], skip_indices: set = None,
                  filename: str = None, broker_format: str = None) -> dict:
    """Create journal entries from parsed rows. Returns import summary."""
    skip_indices = skip_indices or set()
    created = 0
    skipped = 0
    errors = []

    for i, row in enumerate(rows):
        if i in skip_indices:
            skipped += 1
            continue
        try:
            create_entry(user_id, row)
            created += 1
        except Exception as e:
            skipped += 1
            errors.append(f"Row {i + 1}: {str(e)[:100]}")

    # Record import session
    session_id = str(uuid.uuid4())[:12]
    now = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        conn.execute(
            """INSERT INTO import_sessions
               (id, user_id, filename, format, imported_count, duplicate_count, error_count, created_at)
               VALUES (?,?,?,?,?,?,?,?)""",
            (session_id, user_id, filename or "unknown.csv",
             broker_format or "unknown", created, skipped,
             len(errors), now),
        )
        conn.commit()
    finally:
        conn.close()

    return {
        "session_id": session_id,
        "imported": created,
        "duplicates": skipped,
        "errors": errors[:20],
        "total": len(rows),
    }


def get_import_history(user_id: str) -> list[dict]:
    """List past import sessions."""
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT * FROM import_sessions
               WHERE user_id = ?
               ORDER BY created_at DESC
               LIMIT 50""",
            (user_id,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()
