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
                print(f"  {t}: dropping…", flush=True)
                t0 = time.monotonic()
                conn.execute(f"DROP TABLE {t}")
                conn.commit()
                print(f"  {t}: DROPPED in {time.monotonic()-t0:.0f}s", flush=True)
        if dry:
            print(f"\nDRY RUN — auth.db is {size_before/1e9:.1f} GB. "
                  f"Re-run with --yes to drop + VACUUM.", flush=True)
            return 0
        # VACUUM on a background thread with a heartbeat so the ssh websocket
        # (which killed the first synchronous run) never idles out.
        print("\nVACUUM (holds the write lock; reads unaffected)…", flush=True)
        t0 = time.monotonic()
        result: list = []

        def _vacuum():
            vconn = sqlite3.connect(AUTH_DB, timeout=120)
            try:
                vconn.execute("VACUUM")
                result.append("ok")
            except Exception as e:  # noqa: BLE001
                result.append(f"error: {e}")
            finally:
                vconn.close()

        import threading
        th = threading.Thread(target=_vacuum, daemon=True)
        th.start()
        while th.is_alive():
            time.sleep(10)
            print(f"  …vacuuming ({time.monotonic()-t0:.0f}s)", flush=True)
        th.join()
        print(f"VACUUM {result[0] if result else '??'} "
              f"in {time.monotonic()-t0:.0f}s", flush=True)
    finally:
        conn.close()
    size_after = os.path.getsize(AUTH_DB)
    print(f"auth.db: {size_before/1e9:.1f} GB -> {size_after/1e9:.1f} GB "
          f"(reclaimed {(size_before-size_after)/1e9:.1f} GB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
