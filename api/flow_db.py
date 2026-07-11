"""
flow_db.py — SQLite persistence layer for UCT Intelligence options flow data.

Handles:
- Inserting CSV uploads (stocks + indexes) with automatic deduplication
- Querying by date range, serving as CSV to the frontend
- Streaming CSV responses (avoids building 27MB+ strings in memory)
- Auto-pruning expired contracts
- Stats for admin visibility

Usage:
    from flow_db import FlowDB
    db = FlowDB("/data/flow.db")
    inserted, skipped = db.insert_csv(csv_content, source="stocks")
    csv_string = db.query_csv(source="stocks", days=20)
    for chunk in db.stream_csv(source="stocks", days=20):
        send(chunk)
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

# Pre-computed header line and column select clause
_HEADER_LINE = ",".join(COLUMNS) + "\n"
_SELECT_COLS = ", ".join(COLUMNS)

# Dedup key — uniquely identifies a single trade
DEDUP_COLS = [
    "CreatedDate", "CreatedTime", "Symbol", "Type", "Volume",
    "Price", "CallPut", "Strike", "ExpirationDate", "Premium"
]

# How many rows to batch into a single chunk when streaming CSV.
# Larger = fewer Python→ASGI round-trips, smaller = lower memory.
_STREAM_BATCH = 2000


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
            # Covering index for the live-tape hot path (T1-1): /recent's
            # `WHERE source=? AND CreatedDate=? ... ORDER BY id DESC LIMIT ?`
            # otherwise degrades to a reverse rowid scan over the whole table
            # (measured 43s on 774MB, 2026-07-01). With (source, CreatedDate,
            # id) SQLite walks the index backwards touching only today's rows.
            # One-time build on a large existing DB takes ~30-60s at boot.
            conn.execute("CREATE INDEX IF NOT EXISTS idx_flow_source_date_id ON flow(source, CreatedDate, id)")
            # Color-aware index (2026-07-09): /recent + /day-stats scan for the
            # latest N *classified* (MAGENTA/YELLOW + premium-WHITE) rows. With
            # only (source,CreatedDate,id) SQLite walks backward through every
            # unclassified WHITE row to find them — by midday (~400K rows/day)
            # that's a 8-30s scan/timeout. Adding Color lets the planner jump
            # straight to MAGENTA/YELLOW ranges. One-time build at boot.
            conn.execute("CREATE INDEX IF NOT EXISTS idx_flow_classified ON flow(source, CreatedDate, Color, id)")

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

    def _resolve_dates(self, conn, source: str, days: int | None = None) -> list[str]:
        """Get the date strings for the last N trading days, or all if days is None."""
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
        dated.sort(key=lambda x: x[0], reverse=True)

        if days is not None:
            return [d[1] for d in dated[:days]]
        return [d[1] for d in dated]

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

    def update_sides_by_dedup(self, updates: list) -> int:
        """Reclassify Side in place for already-inserted rows (post-NBBO recovery).

        `updates`: list of (dedup_key, new_side, only_if_side) tuples. Each row's
        Side is overwritten ONLY when its stored value still equals
        `only_if_side` — the tick/empty value the worker recorded at emit time.

        This guard makes the update both idempotent (a second pass is a no-op)
        and incapable of clobbering an NBBO-derived side: rows are write-once
        (insert_csv skips duplicates), so a buffered tick/empty row's stored
        Side is still exactly what we recorded, and an NBBO row's Side never
        matches `only_if_side`. `dedup_key` is UNIQUE and excludes Side, so the
        match targets exactly one row without disturbing the key.

        Returns the number of rows actually updated.
        """
        if not updates:
            return 0
        n = 0
        with self._conn() as conn:
            for dedup_key, new_side, only_if_side in updates:
                if not dedup_key or new_side == only_if_side:
                    continue
                cur = conn.execute(
                    "UPDATE flow SET Side = ? WHERE dedup_key = ? AND Side = ?",
                    (new_side, dedup_key, only_if_side),
                )
                n += cur.rowcount
        return n

    # ── Streaming CSV (preferred for /api/flow/data) ────────────────────

    def stream_csv(self, source: str = "stocks", days: int | None = None):
        """
        Generator that yields CSV chunks from the database.

        Uses cursor iteration (no fetchall) so memory stays flat regardless
        of result size, and the first chunk ships as soon as the first batch
        of rows is read — no 50-second server-side wait.

        ``days=None`` means all data.
        """
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        try:
            # Resolve target dates
            selected_dates = self._resolve_dates(conn, source, days)
            if not selected_dates:
                yield _HEADER_LINE
                return

            placeholders = ",".join(["?"] * len(selected_dates))
            cursor = conn.execute(
                f"SELECT {_SELECT_COLS} FROM flow "
                f"WHERE source = ? AND CreatedDate IN ({placeholders})",
                [source] + selected_dates,
            )

            # Yield header
            yield _HEADER_LINE

            # Yield rows in batches — csv.writer into a small StringIO buffer
            buf = io.StringIO()
            writer = csv.writer(buf)
            count = 0

            for row in cursor:
                writer.writerow(row)
                count += 1
                if count % _STREAM_BATCH == 0:
                    yield buf.getvalue()
                    buf.seek(0)
                    buf.truncate(0)

            # Flush remaining
            remainder = buf.getvalue()
            if remainder:
                yield remainder
        finally:
            conn.close()

    # ── Legacy full-string methods (kept for backward compat / startup seed) ─

    def query_csv(self, source: str = "stocks", days: int = 20) -> str:
        """
        Query the last N trading days of data for the given source.
        Returns a CSV string with the same headers as BBS exports.
        """
        return "".join(self.stream_csv(source=source, days=days))

    def query_all_csv(self, source: str = "stocks") -> str:
        """Query ALL data for the given source. Use with caution on large DBs."""
        return "".join(self.stream_csv(source=source, days=None))

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

    def get_mktcap_batch(self, symbols: list[str]) -> dict[str, int]:
        """Return the most recent non-zero MktCap value seen in flow data
        for each requested symbol. Stored as TEXT in the flow table because
        BBS exports it that way; we parse to int here and skip blanks/zeros.

        Used by /api/schwab/mktcap-batch as the first lookup layer so the
        dark pool view can resolve mkt caps without hitting Schwab or Yahoo
        for every ticker. The flow CSV ships MktCap as a column, so for any
        ticker that's appeared in options flow this is a free, instant,
        offline lookup.

        Picks the MAX(id) row per symbol — the most recently ingested print
        for that ticker — which is also the freshest market-cap snapshot.
        BBS occasionally stamps wildly wrong values (e.g. MU at $1.2T),
        but we don't try to validate here; the caller can sanity-check if
        needed.
        """
        if not symbols:
            return {}
        # Normalize: upper-case, dedupe, drop empties
        clean = sorted({s.strip().upper() for s in symbols if s and s.strip()})
        if not clean:
            return {}
        placeholders = ",".join("?" for _ in clean)
        # Subquery picks the max(id) per symbol where MktCap is usable, then
        # joins back to get the actual MktCap text. Single query, scales fine
        # at hundreds of symbols.
        sql = f"""
            SELECT f.Symbol, f.MktCap
            FROM flow f
            INNER JOIN (
                SELECT Symbol, MAX(id) AS max_id
                FROM flow
                WHERE Symbol IN ({placeholders})
                  AND MktCap IS NOT NULL
                  AND MktCap != ''
                  AND MktCap != '0'
                GROUP BY Symbol
            ) latest ON f.id = latest.max_id
        """
        out: dict[str, int] = {}
        try:
            with self._conn() as conn:
                cursor = conn.execute(sql, clean)
                for row in cursor.fetchall():
                    sym = (row[0] or "").strip().upper()
                    raw = (row[1] or "").strip()
                    if not sym or not raw:
                        continue
                    try:
                        # MktCap is stored as TEXT; values look like
                        # "340897000000" (raw dollars). Cast through float
                        # to tolerate any stray decimal points.
                        v = int(float(raw))
                        if v > 0:
                            out[sym] = v
                    except (ValueError, TypeError):
                        continue
        except Exception as e:
            print(f"[flow_db] get_mktcap_batch failed: {e}")
        return out
