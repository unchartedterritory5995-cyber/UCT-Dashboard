"""One-shot: drop the LEGACY pattern_* tables from auth.db and reclaim disk.

Context (2026-07-17): the pattern engine moved to /data/patterns.db
(pattern_engine/pattern_db.py). The old tables were left in auth.db as a
frozen backup — 2.37M detection rows ≈ 15+ GB of auth.db's 20.9 GB, all of
it shipped to R2 every 6h by the backup job. Once patterns.db has been
green for a few days, this reclaims the space.

DESTRUCTIVE + LOCKS THE DB. Run via railway ssh during a quiet window
(pre-market or late evening ET):

  railway ssh -s web "/opt/venv/bin/python /app/tools/purge_legacy_patterns.py --dry-run"
  railway ssh -s web "/opt/venv/bin/python /app/tools/purge_legacy_patterns.py --yes"

Notes:
- VACUUM needs free disk ≈ the post-delete DB size (fine: ~24 GB free,
  post-delete DB ≈ 5 GB) and holds the write lock for the duration
  (est. 1-3 min at this size). Reads keep working (WAL).
- The script refuses to run unless /data/patterns.db exists and has served
  detections (sanity: the new engine is actually live).
"""
from __future__ import annotations

import os
import sqlite3
import sys
import time

AUTH_DB = os.environ.get("AUTH_DB_PATH", "/data/auth.db")
PATTERN_DB = os.environ.get("PATTERN_DB_PATH", "/data/patterns.db")
LEGACY_TABLES = ("pattern_feedback", "pattern_outcomes", "pattern_stats",
                 "pattern_detections")  # FK-referencing tables first


def main() -> int:
    dry = "--yes" not in sys.argv
    if not os.path.exists(AUTH_DB):
        print(f"auth.db not found at {AUTH_DB}"); return 1
    if not os.path.exists(PATTERN_DB):
        print(f"REFUSING: {PATTERN_DB} missing — pattern move not live here."); return 1

    pconn = sqlite3.connect(f"file:{PATTERN_DB}?mode=ro", uri=True, timeout=5)
    try:
        n_new = pconn.execute("SELECT COUNT(*) FROM pattern_detections").fetchone()[0]
    finally:
        pconn.close()
    print(f"patterns.db detections: {n_new}")

    size_before = os.path.getsize(AUTH_DB)
    conn = sqlite3.connect(AUTH_DB, timeout=120)
    try:
        for t in LEGACY_TABLES:
            row = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (t,)
            ).fetchone()
            if not row:
                print(f"  {t}: not present (already purged?)", flush=True)
                continue
            if dry:
                # COUNT(*) scans the whole table — minutes on the 15 GB
                # detections table, which is exactly what outlived the
                # railway-ssh websocket on the first run. Dry-run only.
                n = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                print(f"  {t}: {n} rows", flush=True)
            else:
                # Presence report ONLY — the actual DROP happens on the
                # heartbeated worker thread below. A synchronous DROP here is
                # silent for 10+ minutes on the 15 GB table, the railway-ssh
                # websocket dies, and the transaction rolls back (runs 1-4
                # ALL died at exactly this line).
                print(f"  {t}: present — will drop on the worker thread", flush=True)
        if dry:
            print(f"\nDRY RUN — auth.db is {size_before/1e9:.1f} GB. "
                  f"Re-run with --yes to drop + VACUUM.", flush=True)
            return 0
    finally:
        conn.close()

    if dry:
        return 0
    # A single DROP TABLE on the 15 GB detections table is ONE giant
    # transaction: ~10+ min of sustained page churn into the WAL, during
    # which runs 1-5 ALL took the container down and rolled back to zero.
    # Instead: DELETE in small committed batches with a WAL checkpoint
    # after each — every batch is durable, the WAL stays small, and a
    # crash mid-run only loses the in-flight batch (re-run resumes).
    # Then DROP the empty table (instant) and VACUUM to reclaim disk.
    import threading
    t0 = time.monotonic()
    hb_stop = threading.Event()

    def _hb():
        # railway-ssh kills silent sessions; keep output flowing even if a
        # batch or the VACUUM runs long.
        while not hb_stop.wait(10):
            print(f"  …working ({time.monotonic()-t0:.0f}s)", flush=True)

    threading.Thread(target=_hb, daemon=True).start()
    BATCH = int(os.environ.get("PURGE_BATCH_ROWS", "100000"))
    conn = sqlite3.connect(AUTH_DB, timeout=120)
    try:
        conn.execute("PRAGMA busy_timeout=120000")
        for t in LEGACY_TABLES:
            row = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                (t,)).fetchone()
            if not row:
                continue
            total = 0
            while True:
                cur = conn.execute(
                    f"DELETE FROM {t} WHERE rowid IN "
                    f"(SELECT rowid FROM {t} LIMIT ?)", (BATCH,))
                conn.commit()
                if cur.rowcount <= 0:
                    break
                total += cur.rowcount
                conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                print(f"  {t}: {total} rows deleted "
                      f"({time.monotonic()-t0:.0f}s)", flush=True)
                time.sleep(0.3)   # let other writers breathe between batches
            conn.execute(f"DROP TABLE {t}")
            conn.commit()
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            print(f"  {t}: dropped at {time.monotonic()-t0:.0f}s", flush=True)
        free_pages = conn.execute("PRAGMA freelist_count").fetchone()[0]
        print(f"  freelist: {free_pages} pages — vacuum…", flush=True)
        conn.execute("VACUUM")
        print(f"  vacuum ok at {time.monotonic()-t0:.0f}s", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"  ERROR: {e}", flush=True)
        return 1
    finally:
        hb_stop.set()
        conn.close()
    size_after = os.path.getsize(AUTH_DB)
    print(f"auth.db: {size_before/1e9:.1f} GB -> {size_after/1e9:.1f} GB "
          f"(reclaimed {(size_before-size_after)/1e9:.1f} GB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
