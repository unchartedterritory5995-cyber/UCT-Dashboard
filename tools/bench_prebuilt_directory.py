"""Before/after for the prebuilt directory, on a DB built to production's shape.

Standing up a local stack would measure a DB that does not look like production's.
Instead this builds `auth.db` with the EXACT shape measured on prod 2026-09-20 —
33 prebuilt lists, 4,704 item rows, Russell 2000 = 1,872 — and times the real
service + route against it, full mode vs slim, memo cold vs warm.

    python tools/bench_prebuilt_directory.py
"""
from __future__ import annotations

import json
import os
import sqlite3
import statistics
import tempfile
import time
import uuid

# Measured on production 2026-09-20 via GET /api/watchlists/prebuilt (33 lists,
# 4,704 items, 607,445 bytes). The named lists are the twelve largest as reported;
# the remainder are padded to reach the real totals.
NAMED = [
    ("Russell 2000", 1872), ("S&P SmallCap 600", 587), ("S&P 500", 501),
    ("S&P MidCap 400", 390), ("UCT Thematic Indexes", 112), ("Nasdaq 100", 102),
    ("S&P 100", 96), ("Sunday Scans — August 30, 2026", 90),
    ("Sunday Scans — September 6, 2026", 83), ("Sunday Scans — August 23, 2026", 74),
    ("Sunday Scans — August 2, 2026", 74), ("Bull & Bear ETFs", 72),
]
TOTAL_LISTS, TOTAL_ITEMS = 33, 4704


def build_db(path: str) -> None:
    os.environ["AUTH_DB_PATH"] = path
    from api.services import auth_db
    auth_db._DB_PATH = path
    conn = sqlite3.connect(path)
    conn.executescript(auth_db.SCHEMA if hasattr(auth_db, "SCHEMA") else "")
    conn.close()

    # The schema helper name varies; create what we need directly if it didn't run.
    conn = sqlite3.connect(path)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, display_name TEXT);
        CREATE TABLE IF NOT EXISTS watchlists (
            id TEXT PRIMARY KEY, user_id TEXT, name TEXT, description TEXT,
            is_public INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT,
            is_flagged_list INTEGER DEFAULT 0, is_prebuilt INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS watchlist_items (
            id TEXT PRIMARY KEY, watchlist_id TEXT NOT NULL, sym TEXT NOT NULL,
            notes TEXT DEFAULT '', sort_order INTEGER DEFAULT 0,
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
        CREATE INDEX IF NOT EXISTS idx_watchlist_items_list ON watchlist_items(watchlist_id);
    """)
    conn.execute("INSERT OR REPLACE INTO users VALUES ('admin','a@b.c','UCT')")

    sizes = [n for _, n in NAMED]
    rest = TOTAL_LISTS - len(NAMED)
    remaining = TOTAL_ITEMS - sum(sizes)
    sizes += [remaining // rest] * rest
    sizes[-1] += TOTAL_ITEMS - sum(sizes)
    names = [n for n, _ in NAMED] + [f"UCT List {i}" for i in range(rest)]

    for name, n in zip(names, sizes):
        wid = str(uuid.uuid4())[:11]
        conn.execute(
            "INSERT INTO watchlists (id,user_id,name,description,is_public,created_at,"
            "updated_at,is_flagged_list,is_prebuilt) VALUES (?,?,?,?,1,?,?,0,1)",
            (wid, "admin", name, "", "2026-01-01", "2026-01-01"))
        conn.executemany(
            "INSERT INTO watchlist_items (id,watchlist_id,sym,notes,sort_order,added_at) "
            "VALUES (?,?,?,'',?,?)",
            [(str(uuid.uuid4())[:11], wid, f"T{i:05d}", i, "2026-08-09 21:26:05")
             for i in range(n)])
    conn.commit()
    conn.close()


def timed(fn, n=7):
    """Median ms over n runs, after one warm-up."""
    fn()
    out = []
    for _ in range(n):
        t = time.perf_counter()
        fn()
        out.append((time.perf_counter() - t) * 1000)
    return statistics.median(out), min(out), max(out)


def main() -> None:
    tmp = tempfile.mkdtemp()
    db = os.path.join(tmp, "auth.db")
    os.environ["AUTH_DB_PATH"] = db
    os.environ.setdefault("DATA_DIR", tmp)
    build_db(db)

    from api.services import auth_db, watchlist_service as wl, watchlist_prebuilt as wp
    auth_db._DB_PATH = db

    full = wl.list_prebuilt_watchlists(limit=1000, include_items=True)
    slim = wl.list_prebuilt_watchlists(limit=1000, include_items=False)
    b_full = len(json.dumps(full, default=str).encode())
    b_slim = len(json.dumps(slim, default=str).encode())
    items = sum(len(r.get("items") or []) for r in full)

    print(f"  lists={len(full)}  items={items}")
    print(f"\n{'':<34}{'median':>10}{'min':>9}{'max':>9}")

    m = timed(lambda: wl.list_prebuilt_watchlists(limit=1000, include_items=True))
    print(f"  {'service, full (with items)':<32}{m[0]:>9.1f}{m[1]:>9.1f}{m[2]:>9.1f} ms")
    m = timed(lambda: wl.list_prebuilt_watchlists(limit=1000, include_items=False))
    print(f"  {'service, slim (counts only)':<32}{m[0]:>9.1f}{m[1]:>9.1f}{m[2]:>9.1f} ms")

    # The config enrichment the route runs on top, cold (no memo) vs warm.
    def cold_config():
        wp.invalidate_prebuilt_config_cache()
        wp.category_map(); wp.category_order(); wp.issue_date_map(); wp.alias_map()

    def warm_config():
        wp.category_map(); wp.category_order(); wp.issue_date_map(); wp.alias_map()

    m = timed(cold_config, n=5)
    print(f"  {'route config, memo COLD':<32}{m[0]:>9.1f}{m[1]:>9.1f}{m[2]:>9.1f} ms")
    m = timed(warm_config)
    print(f"  {'route config, memo WARM':<32}{m[0]:>9.1f}{m[1]:>9.1f}{m[2]:>9.1f} ms")

    print(f"\n  payload full  {b_full:>9,} bytes")
    print(f"  payload slim  {b_slim:>9,} bytes   ({b_full / max(b_slim, 1):.0f}x smaller)")
    print(f"  prod measured   607,445 bytes / 4,704 items\n")


if __name__ == "__main__":
    main()
