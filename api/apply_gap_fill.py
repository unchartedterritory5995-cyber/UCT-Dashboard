"""
Apply gap-fill CSV to FlowDB — insert events that the worker missed.

Companion to build_gap_fill_csv.py. Reads a BBS-format CSV (generated offline
from Massive's T+1 flat file) and inserts only the rows that aren't already
in FlowDB.

Matching strategy (explicit dedup, doesn't depend on FlowDB.insert_csv's
internal dedup behavior):
  - For each row in the fill CSV, look for a matching FlowDB row by:
      Symbol AND CallPut AND _norm_strike(Strike) AND ExpirationDate
      AND CreatedDate AND CreatedTime within ±60s
  - If match found: skip (it's already there)
  - If no match: insert via raw SQL with all NULL/empty fields except the
    core trade data (Symbol, CP, Strike, Exp, Volume, Price, Premium, Time,
    Type). Enrichment fields (Side, Color, OI, MktCap, Sector) are set to
    defaults and rebuilt by existing admin endpoints downstream.

Workflow:
  1. Build fill CSV from raw OPRA flat file:
       python build_gap_fill_csv.py raw.csv.gz YYYY-MM-DD out.csv
  2. Commit fill-DATE-stocks.csv and fill-DATE-indexes.csv to api/
  3. POST /api/admin/massive/apply-gap-fill
         ?fill_file=fill-6-26-stocks.csv
         &source=stocks
  4. Same with source=indexes
  5. (Optional) Run rebuild-color and apply-cancel-patches to enrich the new rows

Returns counts (rows inserted, skipped, examined).
"""
import sqlite3
import os
import csv
import logging

logger = logging.getLogger(__name__)
DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")
WINDOW_SECONDS = 60


def _norm_strike(s) -> str:
    try:
        f = float(s)
        if f == int(f):
            return str(int(f))
        return ("%g" % f)
    except (ValueError, TypeError):
        return str(s) if s is not None else ""


def _parse_time(t: str) -> int:
    if not t:
        return -1
    try:
        parts = t.strip().split(":")
        h = int(parts[0])
        m = int(parts[1])
        sec_part = parts[2]
        is_pm = sec_part.upper().endswith("PM")
        is_am = sec_part.upper().endswith("AM")
        sec = int(sec_part[:-2].strip()) if (is_pm or is_am) else int(sec_part)
        if is_pm and h != 12:
            h += 12
        elif is_am and h == 12:
            h = 0
        return h * 3600 + m * 60 + sec
    except (ValueError, IndexError):
        return -1


def run_apply_gap_fill(fill_csv_path: str, source: str = "stocks") -> dict:
    """Apply gap-fill CSV. Returns insert/skip counts."""
    if not os.path.exists(fill_csv_path):
        raise FileNotFoundError(f"fill csv not found: {fill_csv_path}")
    if source not in ("stocks", "indexes"):
        raise ValueError("source must be 'stocks' or 'indexes'")

    stats = {
        "fill_file": os.path.basename(fill_csv_path),
        "source": source,
        "rows_in_fill": 0,
        "rows_inserted": 0,
        "rows_skipped_existing": 0,
        "rows_skipped_invalid": 0,
        "dates_touched": set(),
    }

    # Load fill CSV
    with open(fill_csv_path, "r") as f:
        reader = csv.DictReader(f)
        fill_rows = list(reader)
    stats["rows_in_fill"] = len(fill_rows)

    if not fill_rows:
        stats["dates_touched"] = []
        return stats

    # Get list of dates in fill — query FlowDB existing rows in batches per date
    dates_in_fill = {r["CreatedDate"] for r in fill_rows}
    stats["dates_touched"] = sorted(list(dates_in_fill))

    conn = sqlite3.connect(DB_PATH, timeout=60)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    try:
        cur = conn.cursor()

        # Build a lookup index of existing FlowDB rows for each date
        # Key: (date, symbol, cp, norm_strike, exp) -> list of CreatedTime seconds
        existing_index = {}
        for d in dates_in_fill:
            cur.execute("""
                SELECT Symbol, CallPut, Strike, ExpirationDate, CreatedTime
                FROM flow
                WHERE CreatedDate = ? AND source = ?
            """, (d, source))
            for row in cur.fetchall():
                sym, cp, strike, exp, ct = row
                k = (d, sym, cp, _norm_strike(strike), exp)
                t_sec = _parse_time(ct or "")
                if t_sec < 0:
                    continue
                existing_index.setdefault(k, []).append(t_sec)

        # Determine which columns exist in flow table (for INSERT)
        cur.execute("PRAGMA table_info(flow)")
        flow_cols = [r[1] for r in cur.fetchall()]
        # Strip 'id' column (autoincrement)
        flow_cols = [c for c in flow_cols if c != "id"]

        # Insert non-matching rows
        to_insert = []
        for r in fill_rows:
            d = r.get("CreatedDate")
            sym = r.get("Symbol")
            cp = r.get("CallPut")
            strike = r.get("Strike")
            exp = r.get("ExpirationDate")
            ct = r.get("CreatedTime")
            if not (d and sym and cp and strike and exp and ct):
                stats["rows_skipped_invalid"] += 1
                continue
            k = (d, sym, cp, _norm_strike(strike), exp)
            t_sec = _parse_time(ct)
            if t_sec < 0:
                stats["rows_skipped_invalid"] += 1
                continue
            # Check for existing row within window
            existing_times = existing_index.get(k, [])
            matched = any(abs(t - t_sec) <= WINDOW_SECONDS for t in existing_times)
            if matched:
                stats["rows_skipped_existing"] += 1
                continue
            # Build row tuple matching flow_cols order
            # 'source' column needs explicit value
            row_data = {c: r.get(c, "") for c in flow_cols}
            row_data["source"] = source
            to_insert.append(tuple(row_data.get(c, "") for c in flow_cols))
            # NOTE: do NOT extend existing_index with this newly-inserted row.
            # Within the fill batch, two events on the same contract within 60s
            # are LEGITIMATELY distinct events (e.g. TWST CALL $125 at 11:25:28
            # vol=92 and 11:25:29 vol=215 — both real, both should insert).
            # The dedup check is purely "does this row match anything the worker
            # already wrote to FlowDB". The fill CSV is internally consistent
            # because the offline aggregator's logic mirrors the worker's, so
            # we trust that no two fill rows refer to the same underlying event.

        if to_insert:
            placeholders = ",".join("?" * len(flow_cols))
            col_list = ",".join(flow_cols)
            cur.executemany(
                f"INSERT INTO flow ({col_list}) VALUES ({placeholders})",
                to_insert,
            )
            stats["rows_inserted"] = len(to_insert)

        conn.commit()
        logger.info(f"[gap_fill] done: {stats}")
        return stats

    except Exception:
        conn.rollback()
        logger.exception("[gap_fill] failed")
        raise
    finally:
        conn.close()
