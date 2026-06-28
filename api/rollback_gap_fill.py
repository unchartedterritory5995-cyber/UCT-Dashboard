"""
Roll back rows inserted by apply_gap_fill.

Targets rows with the gap-fill fingerprint: empty Spot, MktCap, Sector, OI.
Worker writes never leave all four fields empty — there's always at least
some enrichment (MktCap from FlowDB cache, Spot from Yahoo, etc.). So this
fingerprint cleanly distinguishes gap-fill inserts from worker writes.

Use case: when offline aggregation produces different bucket boundaries
than the worker's stateful aggregator (especially on ultra-high-frequency
contracts like SPX/SPXW), the gap-fill may insert events that cover the
same underlying prints as existing worker rows — duplicate-counting.
This rolls them back cleanly.

Usage:
  POST /api/admin/massive/rollback-gap-fill?source=indexes&target_date=6/26/2026
"""
import sqlite3
import os
import logging

logger = logging.getLogger(__name__)
DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")


def run_rollback_gap_fill(source: str, target_date: str) -> dict:
    """Delete rows with the gap-fill fingerprint for the given source+date.

    Fingerprint: Spot='0' AND MktCap='0' AND Sector='' AND OI='0'
    """
    if source not in ("stocks", "indexes"):
        raise ValueError("source must be 'stocks' or 'indexes'")
    if not target_date or "/" not in target_date:
        raise ValueError("target_date must be M/D/YYYY format")

    stats = {
        "source": source,
        "target_date": target_date,
        "fingerprint": "Spot=0 AND MktCap=0 AND Sector='' AND OI=0",
        "rows_examined": 0,
        "rows_deleted": 0,
        "sample_deleted": [],
    }

    conn = sqlite3.connect(DB_PATH, timeout=60)
    try:
        cur = conn.cursor()

        # First: count and sample the rows we're about to delete
        cur.execute("""
            SELECT COUNT(*) FROM flow
             WHERE source = ?
               AND CreatedDate = ?
               AND Spot = '0' AND MktCap = '0'
               AND Sector = '' AND OI = '0'
        """, (source, target_date))
        stats["rows_examined"] = cur.fetchone()[0]

        # Get a small sample for verification
        cur.execute("""
            SELECT Symbol, CreatedTime, CallPut, Strike, Volume, Premium
              FROM flow
             WHERE source = ?
               AND CreatedDate = ?
               AND Spot = '0' AND MktCap = '0'
               AND Sector = '' AND OI = '0'
             LIMIT 5
        """, (source, target_date))
        stats["sample_deleted"] = [
            {"symbol": r[0], "time": r[1], "cp": r[2], "strike": r[3],
             "volume": r[4], "premium": r[5]}
            for r in cur.fetchall()
        ]

        # Now delete
        cur.execute("""
            DELETE FROM flow
             WHERE source = ?
               AND CreatedDate = ?
               AND Spot = '0' AND MktCap = '0'
               AND Sector = '' AND OI = '0'
        """, (source, target_date))
        stats["rows_deleted"] = cur.rowcount

        conn.commit()
        logger.info(f"[rollback_gap_fill] {stats}")
        return stats

    except Exception:
        conn.rollback()
        logger.exception("[rollback_gap_fill] failed")
        raise
    finally:
        conn.close()
