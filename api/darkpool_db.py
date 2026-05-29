"""
darkpool_db.py — SQLite persistence for dark pool block trade data.

Mirrors the flow_db.py architecture: Railway persistent volume, dedup on
insert, date-range queries, streaming CSV output, auto-prune for old data.

Seeding from app/public/Darkpool-data.csv is handled by main.py's startup
background thread (parallel to the flow DB seed) — it is NOT triggered on
import here. That keeps app boot fast and the seed observable in logs.
"""

import sqlite3
import os
import csv
import io

# Railway persistent volume path (matches flow_db)
DB_DIR = os.environ.get("RAILWAY_VOLUME_MOUNT_PATH", "/data")
DB_PATH = os.path.join(DB_DIR, "darkpool.db")

# CSV column order — must match what DarkPool.jsx expects from /api/darkpool/data
CSV_COLUMNS = [
    "Date", "Timestamp", "Ticker", "Volume", "Price", "Pct_of_Avg30Day",
    "Notional", "Message", "Type", "SecurityType", "Industry", "Sector",
    "Avg30Day", "Float", "EarningsDate"
]
_HEADER_LINE = ",".join(CSV_COLUMNS) + "\n"

# DB column names in the same logical order (for SELECT)
_DB_COLS = [
    "date", "timestamp", "ticker", "volume", "price", "pct_avg30",
    "notional", "message", "type", "security_type", "industry", "sector",
    "avg30day", "float_shares", "earnings_date"
]
_SELECT_COLS = ", ".join(_DB_COLS)

# Stream batch size: balance ASGI round-trips vs memory.
# Larger = fewer yields, smaller = lower peak memory.
_STREAM_BATCH = 2000


def get_conn():
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Create tables and indexes if they don't exist. Idempotent + fast."""
    conn = get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS darkpool_trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            timestamp TEXT,
            ticker TEXT NOT NULL,
            volume REAL,
            price REAL,
            pct_avg30 REAL,
            notional REAL,
            message TEXT,
            type TEXT,
            security_type TEXT,
            industry TEXT,
            sector TEXT,
            avg30day REAL,
            float_shares REAL,
            earnings_date TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(date, timestamp, ticker, price, notional, message)
        );

        CREATE INDEX IF NOT EXISTS idx_dp_date ON darkpool_trades(date);
        CREATE INDEX IF NOT EXISTS idx_dp_ticker ON darkpool_trades(ticker);
        CREATE INDEX IF NOT EXISTS idx_dp_type ON darkpool_trades(type);
        CREATE INDEX IF NOT EXISTS idx_dp_date_ticker ON darkpool_trades(date, ticker);
    """)
    conn.close()


def parse_date_to_sortable(date_str):
    """Convert M/D/YYYY to YYYY-MM-DD for consistent sorting."""
    try:
        parts = date_str.strip().split("/")
        if len(parts) >= 3:
            m, d, y = int(parts[0]), int(parts[1]), int(parts[2])
            if y < 100:
                y += 2000
            return f"{y:04d}-{m:02d}-{d:02d}"
    except (ValueError, IndexError):
        pass
    return date_str


def _resolve_dates(conn, days):
    """Return date strings for the last N trading days, sorted newest first."""
    rows = conn.execute(
        "SELECT DISTINCT date FROM darkpool_trades"
    ).fetchall()
    all_dates = [r["date"] for r in rows]
    all_dates.sort(key=lambda d: parse_date_to_sortable(d), reverse=True)
    if days is not None:
        return all_dates[:days]
    return all_dates


def insert_csv_rows(csv_text: str) -> dict:
    """
    Parse CSV text and insert rows into the database.
    Returns { inserted, duplicates, errors, total }.
    """
    conn = get_conn()
    reader = csv.DictReader(io.StringIO(csv_text))

    inserted = 0
    duplicates = 0
    errors = 0
    total = 0

    for row in reader:
        total += 1
        try:
            date_raw = (row.get("Date") or "").strip()
            if not date_raw:
                errors += 1
                continue

            ticker = (row.get("Ticker") or "").strip()
            if not ticker:
                errors += 1
                continue

            timestamp = (row.get("Timestamp") or "").strip()
            volume = _float(row.get("Volume"))
            price = _float(row.get("Price"))
            pct_avg30 = _float(row.get("Pct_of_Avg30Day"))
            notional = _float(row.get("Notional"))
            message = (row.get("Message") or "").strip()
            type_ = (row.get("Type") or "").strip()
            security_type = (row.get("SecurityType") or "").strip()
            industry = (row.get("Industry") or "").strip()
            sector = (row.get("Sector") or "").strip()
            avg30day = _float(row.get("Avg30Day"))
            float_shares = _float(row.get("Float"))
            earnings_date = (row.get("EarningsDate") or "").strip()

            cur = conn.execute("""
                INSERT OR IGNORE INTO darkpool_trades
                (date, timestamp, ticker, volume, price, pct_avg30, notional,
                 message, type, security_type, industry, sector, avg30day,
                 float_shares, earnings_date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                date_raw, timestamp, ticker, volume, price, pct_avg30, notional,
                message, type_, security_type, industry, sector, avg30day,
                float_shares, earnings_date
            ))

            if cur.rowcount > 0:
                inserted += 1
            else:
                duplicates += 1

        except Exception as e:
            errors += 1
            if errors <= 3:
                print(f"[darkpool_db] Row error: {e}")

    conn.commit()
    conn.close()

    print(f"[darkpool_db] Upload: {inserted} inserted, {duplicates} dupes, {errors} errors / {total} total")
    return {"inserted": inserted, "duplicates": duplicates, "errors": errors, "total": total}


# ── Streaming CSV (preferred for /api/darkpool/data) ────────────────────

def stream_csv(days=None, all_data: bool = False):
    """
    Generator that yields CSV chunks from the database.

    Uses cursor iteration (no fetchall) so memory stays flat regardless
    of result size, and rows ship as soon as the first batch is ready —
    no server-side wait for a giant string to be built.

    ``days=None`` or ``all_data=True`` means everything.
    Matches the flow_db.FlowDB.stream_csv pattern.
    """
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.row_factory = sqlite3.Row
    try:
        if all_data or days is None:
            cursor = conn.execute(
                f"SELECT {_SELECT_COLS} FROM darkpool_trades "
                f"ORDER BY date DESC, timestamp DESC"
            )
        else:
            selected_dates = _resolve_dates(conn, days)
            if not selected_dates:
                yield _HEADER_LINE
                return
            placeholders = ",".join(["?"] * len(selected_dates))
            cursor = conn.execute(
                f"SELECT {_SELECT_COLS} FROM darkpool_trades "
                f"WHERE date IN ({placeholders}) "
                f"ORDER BY date DESC, timestamp DESC",
                selected_dates,
            )

        yield _HEADER_LINE

        buf = io.StringIO()
        writer = csv.writer(buf)
        count = 0

        for row in cursor:
            writer.writerow(list(row))
            count += 1
            if count % _STREAM_BATCH == 0:
                yield buf.getvalue()
                buf.seek(0)
                buf.truncate(0)

        remainder = buf.getvalue()
        if remainder:
            yield remainder
    finally:
        conn.close()


# ── Legacy full-string method (kept for backward compat) ────────────────

def get_data_csv(days=None, all_data: bool = False) -> str:
    """
    Retrieve dark pool data as CSV text. Kept for backward compat — new
    code should use stream_csv() to avoid building large strings in memory.
    """
    if days is None and not all_data:
        days = 1
    return "".join(stream_csv(days=days, all_data=all_data))


def get_available_dates() -> list:
    """Return list of unique trading dates in the DB, sorted chronologically."""
    conn = get_conn()
    rows = conn.execute("SELECT DISTINCT date FROM darkpool_trades").fetchall()
    conn.close()
    dates = [r["date"] for r in rows]
    dates.sort(key=lambda d: parse_date_to_sortable(d))
    return dates


def get_stats() -> dict:
    """Return DB stats for admin dashboard."""
    conn = get_conn()
    total = conn.execute("SELECT COUNT(*) as c FROM darkpool_trades").fetchone()["c"]
    dates = conn.execute("SELECT COUNT(DISTINCT date) as c FROM darkpool_trades").fetchone()["c"]
    tickers = conn.execute("SELECT COUNT(DISTINCT ticker) as c FROM darkpool_trades").fetchone()["c"]
    latest = conn.execute("SELECT date FROM darkpool_trades ORDER BY date DESC LIMIT 1").fetchone()
    earliest = conn.execute("SELECT date FROM darkpool_trades ORDER BY date ASC LIMIT 1").fetchone()
    db_size = os.path.getsize(DB_PATH) if os.path.exists(DB_PATH) else 0
    conn.close()
    return {
        "total_rows": total,
        "trading_days": dates,
        "tickers": tickers,
        "latest_date": latest["date"] if latest else None,
        "earliest_date": earliest["date"] if earliest else None,
        "db_path": DB_PATH,
        "db_size_mb": round(db_size / 1e6, 1),
    }


def prune_old_data(keep_days: int = 120):
    """Remove data older than keep_days trading days."""
    conn = get_conn()
    dates = conn.execute(
        "SELECT DISTINCT date FROM darkpool_trades"
    ).fetchall()
    date_list = sorted(
        [r["date"] for r in dates],
        key=lambda d: parse_date_to_sortable(d),
        reverse=True
    )
    if len(date_list) <= keep_days:
        conn.close()
        return 0

    old_dates = date_list[keep_days:]
    placeholders = ",".join("?" * len(old_dates))
    result = conn.execute(
        f"DELETE FROM darkpool_trades WHERE date IN ({placeholders})",
        old_dates
    )
    deleted = result.rowcount
    conn.commit()
    conn.close()
    print(f"[darkpool_db] Pruned {deleted} rows from {len(old_dates)} old trading days")
    return deleted


def clear_all():
    """Delete all data (admin use)."""
    conn = get_conn()
    conn.execute("DELETE FROM darkpool_trades")
    conn.commit()
    conn.close()
    print("[darkpool_db] Cleared all data")


# ── Helpers ────────────────────────────────────────────────────────────

def _float(val):
    try:
        return float(val) if val else None
    except (ValueError, TypeError):
        return None


# Auto-init tables on import (idempotent, fast — just CREATE IF NOT EXISTS).
# The CSV seed is intentionally NOT triggered here — main.py runs it in a
# background thread on startup to mirror the flow DB pattern.
init_db()
