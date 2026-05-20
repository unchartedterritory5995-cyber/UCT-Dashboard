"""
darkpool_db.py — SQLite persistence for dark pool block trade data.
Mirrors the flow_db.py pattern: Railway persistent volume, dedup on insert,
date-range queries, auto-prune for expired/old data.
"""

import sqlite3
import os
import csv
import io
from datetime import datetime, timedelta

# Railway persistent volume path (same as flow_db)
DB_DIR = os.environ.get("RAILWAY_VOLUME_MOUNT_PATH", "/data")
DB_PATH = os.path.join(DB_DIR, "darkpool.db")


def get_conn():
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Create tables and indexes if they don't exist."""
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
    print(f"[darkpool_db] Initialized at {DB_PATH}")


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


def get_data_csv(days: int = None, all_data: bool = False) -> str:
    """
    Retrieve dark pool data as CSV text.
    - days=N: last N trading days
    - all_data=True: everything
    """
    conn = get_conn()

    if all_data:
        rows = conn.execute(
            "SELECT * FROM darkpool_trades ORDER BY date DESC, timestamp DESC"
        ).fetchall()
    elif days and days > 0:
        # Get unique dates sorted descending, take last N
        dates = conn.execute(
            "SELECT DISTINCT date FROM darkpool_trades ORDER BY date DESC"
        ).fetchall()
        # Convert to sortable, take top N, then query
        date_list = sorted(
            [r["date"] for r in dates],
            key=lambda d: parse_date_to_sortable(d),
            reverse=True
        )[:days]
        if not date_list:
            conn.close()
            return _empty_csv()

        placeholders = ",".join("?" * len(date_list))
        rows = conn.execute(
            f"SELECT * FROM darkpool_trades WHERE date IN ({placeholders}) ORDER BY date DESC, timestamp DESC",
            date_list
        ).fetchall()
    else:
        # Default: last 1 trading day
        latest = conn.execute(
            "SELECT DISTINCT date FROM darkpool_trades ORDER BY date DESC LIMIT 1"
        ).fetchone()
        if not latest:
            conn.close()
            return _empty_csv()
        rows = conn.execute(
            "SELECT * FROM darkpool_trades WHERE date = ? ORDER BY timestamp DESC",
            (latest["date"],)
        ).fetchall()

    conn.close()
    return _rows_to_csv(rows)


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
    conn.close()
    return {
        "total_rows": total,
        "trading_days": dates,
        "tickers": tickers,
        "latest_date": latest["date"] if latest else None,
        "earliest_date": earliest["date"] if earliest else None,
        "db_path": DB_PATH,
    }


def prune_old_data(keep_days: int = 120):
    """Remove data older than keep_days trading days."""
    conn = get_conn()
    dates = conn.execute(
        "SELECT DISTINCT date FROM darkpool_trades ORDER BY date DESC"
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


# ── Helpers ──────────────────────────────────────────────────────────────────

def _float(val):
    try:
        return float(val) if val else None
    except (ValueError, TypeError):
        return None


def _empty_csv():
    return "Date,Timestamp,Ticker,Volume,Price,Pct_of_Avg30Day,Notional,Message,Type,SecurityType,Industry,Sector,Avg30Day,Float,EarningsDate\n"


def _rows_to_csv(rows):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Date", "Timestamp", "Ticker", "Volume", "Price", "Pct_of_Avg30Day",
        "Notional", "Message", "Type", "SecurityType", "Industry", "Sector",
        "Avg30Day", "Float", "EarningsDate"
    ])
    for r in rows:
        writer.writerow([
            r["date"], r["timestamp"], r["ticker"], r["volume"], r["price"],
            r["pct_avg30"], r["notional"], r["message"], r["type"],
            r["security_type"], r["industry"], r["sector"], r["avg30day"],
            r["float_shares"], r["earnings_date"]
        ])
    return output.getvalue()


def auto_seed_from_csv():
    """
    Auto-seed DB from Darkpool-data.csv in the public folder on startup.
    Ravi uploads new CSV to GitHub → Railway deploys → this runs on import.
    Dedup via INSERT OR IGNORE means existing rows are skipped.
    """
    # Try multiple possible paths for the CSV
    candidates = [
        os.path.join(os.getcwd(), "app", "public", "Darkpool-data.csv"),
        os.path.join(os.getcwd(), "public", "Darkpool-data.csv"),
        "/app/public/Darkpool-data.csv",
        "app/public/Darkpool-data.csv",
        "Darkpool-data.csv",
    ]

    csv_path = None
    for p in candidates:
        if os.path.isfile(p):
            csv_path = p
            break

    if not csv_path:
        print("[darkpool_db] No Darkpool-data.csv found to seed — skipping auto-seed")
        return

    try:
        file_size = os.path.getsize(csv_path)
        print(f"[darkpool_db] Auto-seeding from {csv_path} ({file_size/1024:.0f}KB)…")

        with open(csv_path, "r", encoding="utf-8-sig") as f:
            csv_text = f.read()

        result = insert_csv_rows(csv_text)
        print(f"[darkpool_db] Auto-seed complete: {result['inserted']} new, {result['duplicates']} dupes, {result['errors']} errors / {result['total']} total")

        # Log DB state after seed
        stats = get_stats()
        print(f"[darkpool_db] DB now has {stats['total_rows']} rows, {stats['trading_days']} trading days, {stats['tickers']} tickers")
        if stats["latest_date"]:
            print(f"[darkpool_db] Date range: {stats['earliest_date']} → {stats['latest_date']}")

    except Exception as e:
        print(f"[darkpool_db] Auto-seed error: {e}")


# Auto-init on import
init_db()

# Auto-seed from CSV on startup (dedup handles re-runs)
auto_seed_from_csv()

