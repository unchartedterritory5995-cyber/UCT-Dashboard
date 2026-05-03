"""
flow_db.py — SQLite persistence layer for UCT Intelligence options flow data.

Handles:
- Inserting CSV uploads (stocks + indexes) with automatic deduplication
- Querying by date range, serving as CSV to the frontend
- Auto-pruning expired contracts
- Stats for admin visibility

Usage:
    from flow_db import FlowDB
    db = FlowDB("/data/flow.db")
    inserted, skipped = db.insert_csv(csv_content, source="stocks")
    csv_string = db.query_csv(source="stocks", days=20)
    pruned = db.prune_expired()
"""

import sqlite3
import csv
import io
import os
from datetime import datetime, timedelta
from contextlib import contextmanager

# CSV columns in BBS export order
COLUMNS = [
    "CreatedDate", "CreatedTime", "Symbol", "Type", "Volume", "Price",
    "Side", "CallPut", "Strike", "Spot", "Premium", "ExpirationDate",
    "Color", "ImpliedVolatility", "Dte", "ER", "StockEtf", "Sector",
    "Uoa", "Weekly", "MktCap", "OI"
]

# Dedup key — uniquely identifies a single trade
DEDUP_COLS = [
    "CreatedDate", "CreatedTime", "Symbol", "Type", "Volume",
    "Price", "CallPut", "Strike", "ExpirationDate", "Premium"
]


class FlowDB:
    def __init__(self, db_path: str = "/data/flow.db"):
        self.db_path = db_path
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._init_db()

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _init_db(self):
        with self._conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS flow (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source TEXT NOT NULL DEFAULT 'stocks',
                    CreatedDate TEXT,
                    CreatedTime TEXT,
                    Symbol TEXT,
                    Type TEXT,
                    Volume TEXT,
                    Price TEXT,
                    Side TEXT,
                    CallPut TEXT,
                    Strike TEXT,
                    Spot TEXT,
                    Premium TEXT,
                    ExpirationDate TEXT,
                    Color TEXT,
                    ImpliedVolatility TEXT,
                    Dte TEXT,
                    ER TEXT,
                    StockEtf TEXT,
                    Sector TEXT,
                    Uoa TEXT,
                    Weekly TEXT,
                    MktCap TEXT,
                    OI TEXT,
                    dedup_key TEXT UNIQUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            # Index for fast queries
            conn.execute("CREATE INDEX IF NOT EXISTS idx_flow_source ON flow(source)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_flow_date ON flow(CreatedDate)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_flow_symbol ON flow(Symbol)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_flow_exp ON flow(ExpirationDate)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_flow_source_date ON flow(source, CreatedDate)")

    @staticmethod
    def _make_dedup_key(row: dict, source: str) -> str:
        """Build a unique key for deduplication."""
        parts = [source]
        for col in DEDUP_COLS:
            val = (row.get(col) or "").strip()
            parts.append(val)
        return "|".join(parts)

    @staticmethod
    def _parse_date_mdy(date_str: str):
        """Parse M/D/YYYY to a sortable date object."""
        try:
            parts = date_str.strip().split("/")
            if len(parts) == 3:
                m, d, y = int(parts[0]), int(parts[1]), int(parts[2])
                return datetime(y, m, d)
        except (ValueError, IndexError):
            pass
        return None

    def insert_csv(self, csv_content: str, source: str = "stocks") -> dict:
        """
        Insert CSV rows into the database. Skips duplicates automatically.

        Returns: { "inserted": int, "skipped": int, "dates": list[str] }
        """
        # Handle BOM and normalize line endings
        csv_content = csv_content.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")

        reader = csv.DictReader(io.StringIO(csv_content))
        inserted = 0
        skipped = 0
        dates_seen = set()

        with self._conn() as conn:
            for row in reader:
                # Normalize: strip whitespace from all values
                row = {k: (v or "").strip() for k, v in row.items() if k in COLUMNS}
                if not row.get("Symbol") or not row.get("CreatedDate"):
                    skipped += 1
                    continue

                dedup_key = self._make_dedup_key(row, source)
                dates_seen.add(row["CreatedDate"])

                try:
                    conn.execute(
                        """INSERT INTO flow (
                            source, CreatedDate, CreatedTime, Symbol, Type, Volume,
                            Price, Side, CallPut, Strike, Spot, Premium,
                            ExpirationDate, Color, ImpliedVolatility, Dte, ER,
                            StockEtf, Sector, Uoa, Weekly, MktCap, OI, dedup_key
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            source,
                            row.get("CreatedDate", ""),
                            row.get("CreatedTime", ""),
                            row.get("Symbol", ""),
                            row.get("Type", ""),
                            row.get("Volume", ""),
                            row.get("Price", ""),
                            row.get("Side", ""),
                            row.get("CallPut", ""),
                            row.get("Strike", ""),
                            row.get("Spot", ""),
                            row.get("Premium", ""),
                            row.get("ExpirationDate", ""),
                            row.get("Color", ""),
                            row.get("ImpliedVolatility", ""),
                            row.get("Dte", ""),
                            row.get("ER", ""),
                            row.get("StockEtf", ""),
                            row.get("Sector", ""),
                            row.get("Uoa", ""),
                            row.get("Weekly", ""),
                            row.get("MktCap", ""),
                            row.get("OI", ""),
                            dedup_key,
                        ),
                    )
                    inserted += 1
                except sqlite3.IntegrityError:
                    # Duplicate — dedup_key already exists
                    skipped += 1

        return {
            "inserted": inserted,
            "skipped": skipped,
            "dates": sorted(dates_seen),
        }

    def query_csv(self, source: str = "stocks", days: int = 20) -> str:
        """
        Query the last N trading days of data for the given source.
        Returns a CSV string with the same headers as BBS exports.
        """
        with self._conn() as conn:
            # Get the last N distinct trading dates
            cursor = conn.execute(
                """SELECT DISTINCT CreatedDate FROM flow
                   WHERE source = ?
                   ORDER BY CreatedDate DESC""",
                (source,),
            )
            all_dates_raw = [r[0] for r in cursor.fetchall()]

            # Sort dates chronologically (M/D/YYYY format)
            dated = []
            for d in all_dates_raw:
                parsed = self._parse_date_mdy(d)
                if parsed:
                    dated.append((parsed, d))
            dated.sort(key=lambda x: x[0], reverse=True)

            # Take last N trading days
            selected_dates = [d[1] for d in dated[:days]]

            if not selected_dates:
                return ",".join(COLUMNS) + "\n"

            placeholders = ",".join(["?"] * len(selected_dates))
            cursor = conn.execute(
                f"""SELECT {', '.join(COLUMNS)} FROM flow
                    WHERE source = ? AND CreatedDate IN ({placeholders})
                    ORDER BY id DESC""",
                [source] + selected_dates,
            )
            rows = cursor.fetchall()

        # Build CSV string
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(COLUMNS)
        for row in rows:
            writer.writerow(row)
        return output.getvalue()

    def query_all_csv(self, source: str = "stocks") -> str:
        """Query ALL data for the given source. Use with caution on large DBs."""
        with self._conn() as conn:
            cursor = conn.execute(
                f"SELECT {', '.join(COLUMNS)} FROM flow WHERE source = ? ORDER BY id DESC",
                (source,),
            )
            rows = cursor.fetchall()

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(COLUMNS)
        for row in rows:
            writer.writerow(row)
        return output.getvalue()

    def prune_expired(self, buffer_days: int = 7) -> int:
        """
        Remove rows where ExpirationDate has passed (+ buffer).
        Returns number of rows pruned.
        """
        cutoff = datetime.now() - timedelta(days=buffer_days)
        pruned = 0

        with self._conn() as conn:
            cursor = conn.execute(
                "SELECT DISTINCT ExpirationDate FROM flow"
            )
            all_exps = [r[0] for r in cursor.fetchall()]

            expired_dates = []
            for exp in all_exps:
                parsed = self._parse_date_mdy(exp)
                if parsed and parsed < cutoff:
                    expired_dates.append(exp)

            if expired_dates:
                placeholders = ",".join(["?"] * len(expired_dates))
                cursor = conn.execute(
                    f"DELETE FROM flow WHERE ExpirationDate IN ({placeholders})",
                    expired_dates,
                )
                pruned = cursor.rowcount

        return pruned

    def stats(self) -> dict:
        """Get database statistics for admin display."""
        with self._conn() as conn:
            total = conn.execute("SELECT COUNT(*) FROM flow").fetchone()[0]
            stocks = conn.execute(
                "SELECT COUNT(*) FROM flow WHERE source='stocks'"
            ).fetchone()[0]
            indexes = conn.execute(
                "SELECT COUNT(*) FROM flow WHERE source='indexes'"
            ).fetchone()[0]

            # Date range
            cursor = conn.execute(
                "SELECT DISTINCT CreatedDate FROM flow ORDER BY CreatedDate"
            )
            all_dates_raw = [r[0] for r in cursor.fetchall()]
            dated = []
            for d in all_dates_raw:
                parsed = self._parse_date_mdy(d)
                if parsed:
                    dated.append((parsed, d))
            dated.sort(key=lambda x: x[0])

            # Trading days by source
            stock_days = conn.execute(
                "SELECT COUNT(DISTINCT CreatedDate) FROM flow WHERE source='stocks'"
            ).fetchone()[0]
            index_days = conn.execute(
                "SELECT COUNT(DISTINCT CreatedDate) FROM flow WHERE source='indexes'"
            ).fetchone()[0]

            # DB file size
            db_size = os.path.getsize(self.db_path) if os.path.exists(self.db_path) else 0

            return {
                "total_rows": total,
                "stocks_rows": stocks,
                "indexes_rows": indexes,
                "stock_days": stock_days,
                "index_days": index_days,
                "date_range": {
                    "earliest": dated[0][1] if dated else None,
                    "latest": dated[-1][1] if dated else None,
                },
                "trading_days": len(dated),
                "db_size_mb": round(db_size / 1e6, 1),
            }

    def get_available_dates(self, source: str = "stocks") -> list:
        """Get all available trading dates for a source, sorted chronologically."""
        with self._conn() as conn:
            cursor = conn.execute(
                "SELECT DISTINCT CreatedDate FROM flow WHERE source = ?",
                (source,),
            )
            all_dates_raw = [r[0] for r in cursor.fetchall()]

        dated = []
        for d in all_dates_raw:
            parsed = self._parse_date_mdy(d)
            if parsed:
                dated.append((parsed, d))
        dated.sort(key=lambda x: x[0])
        return [d[1] for d in dated]
