"""
Apply gap-fill CSV to FlowDB — insert events the worker missed.

Companion to build_gap_fill_csv.py. Reads a BBS-format CSV generated offline
from Massive's T+1 flat file and inserts only the rows that aren't already
in FlowDB.

Dedup: relies on FlowDB.insert_csv's native handling via the dedup_key UNIQUE
constraint. The key is built from:
    source | CreatedDate | CreatedTime | Symbol | Type | Volume | Price |
    CallPut | Strike | ExpirationDate | Premium

This uniquely identifies a single trade. Two events with the same trade
identity collide on dedup_key → SQLite raises IntegrityError → insert_csv
catches it and increments skipped count.

Because both the worker and our offline aggregator emit events with the
same first_ts_ns (from the same underlying OPRA print), CreatedTime
formats identically — meaning matching events naturally collide on
dedup_key without any fuzzy time matching needed.

Workflow:
  1. python build_gap_fill_csv.py raw.csv.gz YYYY-MM-DD out.csv
     -> produces out-stocks.csv and out-indexes.csv
  2. Commit fill CSVs to api/ directory
  3. POST /api/admin/massive/apply-gap-fill
         ?fill_file=fill-6-26-stocks.csv
         &source=stocks
  4. Same with source=indexes

Idempotent: re-running on the same file inserts 0 (everything already there).
"""
import os
import logging

logger = logging.getLogger(__name__)


def run_apply_gap_fill(fill_csv_path: str, source: str = "stocks") -> dict:
    """Apply a gap-fill CSV via FlowDB.insert_csv (which natively dedupes).

    Returns counts from FlowDB plus context useful for debugging:
      - inserted: rows actually inserted
      - skipped: rows that hit dedup_key UNIQUE constraint (already there)
      - dates: list of unique CreatedDate values seen in the fill
      - rows_in_fill: total CSV rows read
      - fill_file, source: echoed back for clarity
    """
    if not os.path.exists(fill_csv_path):
        raise FileNotFoundError(f"fill csv not found: {fill_csv_path}")
    if source not in ("stocks", "indexes"):
        raise ValueError("source must be 'stocks' or 'indexes'")

    # Count rows so we can compute rows_in_fill independently of insert_csv's
    # internal counts (which may not match if some rows are filtered out due
    # to missing Symbol/CreatedDate as 'skipped' inside insert_csv).
    file_size = os.path.getsize(fill_csv_path)
    with open(fill_csv_path, "r") as f:
        csv_content = f.read()

    # Hand off to FlowDB — which already has the native dedup logic
    from api.flow_db import FlowDB
    db = FlowDB()
    result = db.insert_csv(csv_content, source=source)

    stats = {
        "fill_file": os.path.basename(fill_csv_path),
        "fill_file_bytes": file_size,
        "source": source,
        "rows_inserted": result.get("inserted", 0),
        "rows_skipped_existing_or_invalid": result.get("skipped", 0),
        "dates_touched": result.get("dates", []),
    }
    logger.info(f"[gap_fill] done: {stats}")
    return stats
