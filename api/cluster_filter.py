"""
Arbitrage cluster filter — tag structured-noise rows with Color='ARB'.

The rule (per coaching session 2026-06-27):
  Group rows by (Symbol, CreatedDate, CreatedTime).  CreatedTime is stored as
  TEXT at second resolution ("3:46:16 PM"), so this groups by exact second.

  If a group has:
    - n >= 4 events, AND
    - >= 2 distinct (CallPut, Strike, ExpirationDate) combinations,
  flag every row in the group as Color='ARB'.

This catches the classic noise patterns:
  - Box spreads / synthetic structures (SPX $1.1B mixed CP at 11:35:15)
  - Multi-strike position management (LULU $54M at 15:46:16, 5 PUT strikes)
  - Same-instant CALL/PUT structures across expiries (MU $386M)

It correctly preserves legitimate same-contract sweeps that fragment across
exchange venues — those have only ONE distinct (CallPut, Strike, Exp) tuple,
even when 8+ prints land at the same second. (Example: QQQ PUT $630 8/21 at
11:26:21 with 8 prints, all same contract = real sweep, not arb.)

Behavior:
  - IDEMPOTENT — safe to re-run. Rows already Color='ARB' get skipped.
  - DISPOSITIVE — overwrites prior Color values (YELLOW/MAGENTA included).
    Rationale: a YELLOW or MAGENTA classification in the middle of a 5-strike
    multi-CP cluster IS structural noise, not conviction. The cluster pattern
    wins.
  - Side classification is left untouched. Only Color changes.

Order of operations recommendation:
  1. Run THIS filter first (tags ARB clusters)
  2. THEN run color_rebuild (only touches WHITE rows -> won't undo ARB tags)

Endpoint: POST /api/admin/massive/filter-arb?target_date=6/26/2026

Returns:
{
  "target_date": "...",
  "rows_scanned": int,             # total rows for target_date
  "candidate_groups_found": int,    # qualifying clusters
  "rows_tagged_arb": int,           # rows whose Color flipped TO 'ARB'
  "rows_overwritten_classified": int,  # subset that had YELLOW/MAGENTA before
  "rows_already_arb": int,          # part of cluster but already tagged
}
"""
import sqlite3
import logging
import os

logger = logging.getLogger(__name__)
DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")


def run_cluster_filter(target_date: str) -> dict:
    """Tag arbitrage clusters as Color='ARB' for the given target_date."""
    if not target_date:
        raise ValueError("target_date is required (format 'M/D/YYYY')")

    stats = {
        "target_date": target_date,
        "rows_scanned": 0,
        "candidate_groups_found": 0,
        "rows_tagged_arb": 0,
        "rows_overwritten_classified": 0,
        "rows_already_arb": 0,
    }

    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    try:
        cur = conn.cursor()

        # Total row count for stats
        cur.execute("SELECT COUNT(*) FROM flow WHERE CreatedDate = ?", (target_date,))
        stats["rows_scanned"] = cur.fetchone()[0]

        # Find qualifying clusters:
        #   group by (Symbol, CreatedTime [exact second])
        #   require n >= 4 events AND distinct (CP, Strike, Exp) >= 2
        # Strike is normalized via CAST(... AS REAL) so '300' and '300.0' collide.
        cur.execute("""
            SELECT Symbol, CreatedTime,
                   COUNT(*) AS n_rows,
                   COUNT(DISTINCT CallPut || '|' ||
                                  CAST(Strike AS REAL) || '|' ||
                                  ExpirationDate) AS n_distinct
            FROM flow
            WHERE CreatedDate = ?
            GROUP BY Symbol, CreatedTime
            HAVING n_rows >= 4 AND n_distinct >= 2
        """, (target_date,))
        clusters = cur.fetchall()
        stats["candidate_groups_found"] = len(clusters)
        logger.info(f"[cluster_filter] {len(clusters):,} qualifying clusters for {target_date}")

        if not clusters:
            return stats

        # Pull all row ids + current colors for those clusters.
        # We do this per-cluster (avoids building a huge IN clause; each
        # cluster is small so the per-query cost is negligible).
        ids_to_tag = []
        for sym, time, n_rows, n_distinct in clusters:
            cur.execute("""
                SELECT id, Color
                FROM flow
                WHERE CreatedDate = ? AND Symbol = ? AND CreatedTime = ?
            """, (target_date, sym, time))
            for rid, color in cur.fetchall():
                cur_color = (color or "").upper().strip()
                if cur_color == "ARB":
                    stats["rows_already_arb"] += 1
                    continue
                ids_to_tag.append(rid)
                if cur_color in ("YELLOW", "MAGENTA"):
                    stats["rows_overwritten_classified"] += 1

        if ids_to_tag:
            # We don't guard on prior color in the UPDATE — the cluster pattern
            # is dispositive. Already-ARB rows were excluded above.
            cur.executemany(
                "UPDATE flow SET Color = 'ARB' WHERE id = ?",
                [(rid,) for rid in ids_to_tag]
            )
            stats["rows_tagged_arb"] = len(ids_to_tag)

        conn.commit()
        logger.info(
            f"[cluster_filter] done: tagged {stats['rows_tagged_arb']:,} rows, "
            f"of which {stats['rows_overwritten_classified']:,} had prior classification"
        )
        return stats

    except Exception:
        conn.rollback()
        logger.exception("[cluster_filter] failed")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    import sys, json
    target = sys.argv[1] if len(sys.argv) > 1 else None
    if not target:
        print("Usage: python cluster_filter.py 6/26/2026")
        sys.exit(1)
    print(json.dumps(run_cluster_filter(target), indent=2))
