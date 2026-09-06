"""Wave 4 (Search Evolution I) — validate idx_j2_notes_user_created BEFORE
building it (decision-log 2026-09-06 checkpoint item 17: "no production
index change yet, prove it first").

Pure-SQLite, in-memory, no web app, no C:\\data. Seeds a synthetic j2_notes
corpus via the REAL schema (db.py::ensure_schema), runs the date-range query
`wave4-search-evolution-i-prep.md` §3 proposes
(`user_id = ? AND created_at BETWEEN ? AND ? ORDER BY created_at DESC`),
captures EXPLAIN QUERY PLAN + timing WITHOUT the index, then creates
`idx_j2_notes_user_created ON j2_notes(user_id, created_at)` and re-measures
the same query — so the "materially improves" claim is measured, not assumed.

    DATA_DIR=/some/scratch/dir python tools/wave4_date_range_index_benchmark.py [scales...]
"""
from __future__ import annotations

import os
import random
import sqlite3
import statistics
import sys
import time
import uuid

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO_ROOT)

if "DATA_DIR" not in os.environ:
    raise SystemExit(
        "Refusing to run without DATA_DIR set to a scratch directory -- "
        "db.py's schema init resolves DATA_DIR-derived paths, and its "
        "default ('/data') is the real shared production root on this box. "
        "See this file's own module docstring."
    )
# Defensive, even though this script never calls the notes.py service layer
# today (only raw SQL against j2_notes): a future edit that calls
# list_notes()/create_note() would otherwise silently resolve
# auth_db.get_connection() to the real C:\data\auth.db on this box (that
# module-level path is independent of DATA_DIR entirely) -- see the real
# near-miss recorded in wave4_search_correctness_matrix.py's history.
os.environ.setdefault("AUTH_DB_PATH", os.path.join(os.environ["DATA_DIR"], "auth_scratch.db"))

from api.services.journal_two.db import ensure_schema  # noqa: E402

random.seed(7)


def seed_notes(conn, user_id, count, span_days=400):
    now = time.time()
    for i in range(count):
        note_id = str(uuid.uuid4())
        days_ago = random.randint(0, span_days)
        created = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now - days_ago * 86400))
        conn.execute(
            "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags,"
            " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
            (note_id, user_id, f"note {i}", '{"type":"doc","content":[]}', "x", "[]", created, created),
        )
        if i % 5000 == 0 and i:
            conn.commit()
    conn.commit()


def explain(conn, sql, params):
    return [dict(r) for r in conn.execute("EXPLAIN QUERY PLAN " + sql, params).fetchall()]


def bench(conn, sql, params, reps=25):
    times = []
    for _ in range(reps):
        t0 = time.perf_counter()
        conn.execute(sql, params).fetchall()
        times.append((time.perf_counter() - t0) * 1000)
    return {
        "median_ms": round(statistics.median(times), 3),
        "p95_ms": round(sorted(times)[int(len(times) * 0.95)], 3),
    }


DATE_RANGE_SQL = (
    "SELECT id FROM j2_notes WHERE user_id = ? AND created_at BETWEEN ? AND ?"
    " ORDER BY created_at DESC"
)


def run_scale(scale, target_user_notes_frac=0.02):
    """scale = total platform-wide j2_notes rows (global table, many users);
    the query's own user gets a realistic slice of that, not the whole scale."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    ensure_schema(conn)
    user_id = "bench-user"
    user_notes = max(20, int(scale * target_user_notes_frac))
    other_notes = scale - user_notes

    t0 = time.perf_counter()
    seed_notes(conn, user_id, user_notes)
    if other_notes > 0:
        # Spread synthetic "noise" rows across many other users so the table
        # is realistically global, not single-tenant.
        per_other_user = 200
        n_other_users = max(1, other_notes // per_other_user)
        for i in range(n_other_users):
            seed_notes(conn, f"other-{i}", per_other_user)
    seed_ms = (time.perf_counter() - t0) * 1000

    total = conn.execute("SELECT COUNT(*) FROM j2_notes").fetchone()[0]
    print(f"\n=== scale: {total} total j2_notes rows ({user_notes} for bench-user) ===")
    print(f"seed time: {seed_ms:.0f}ms")

    date_from = time.strftime("%Y-%m-%d", time.gmtime(time.time() - 90 * 86400))
    date_to = time.strftime("%Y-%m-%d", time.gmtime())
    params = (user_id, date_from, date_to)

    print("-- WITHOUT idx_j2_notes_user_created --")
    plan_before = explain(conn, DATE_RANGE_SQL, params)
    for row in plan_before:
        print(f"   {row['detail']}")
    r_before = bench(conn, DATE_RANGE_SQL, params)
    print(f"   median={r_before['median_ms']}ms p95={r_before['p95_ms']}ms")

    insert_sql = (
        "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags,"
        " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)"
    )

    def _bench_inserts(prefix):
        times = []
        for i in range(200):
            now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            t0 = time.perf_counter()
            conn.execute(insert_sql, (
                f"{prefix}-{i}", user_id, "t", '{"type":"doc","content":[]}', "x", "[]", now, now,
            ))
            conn.commit()
            times.append((time.perf_counter() - t0) * 1000)
        return statistics.median(times)

    insert_before = _bench_inserts("write-bench-noidx")
    print(f"   INSERT median WITHOUT the index: {insert_before:.3f}ms (200 single-row inserts)")

    conn.execute("CREATE INDEX idx_j2_notes_user_created ON j2_notes(user_id, created_at)")
    conn.commit()

    print("-- WITH idx_j2_notes_user_created --")
    plan_after = explain(conn, DATE_RANGE_SQL, params)
    for row in plan_after:
        print(f"   {row['detail']}")
    r_after = bench(conn, DATE_RANGE_SQL, params)
    print(f"   median={r_after['median_ms']}ms p95={r_after['p95_ms']}ms")

    used_index = any("idx_j2_notes_user_created" in row["detail"] for row in plan_after)
    speedup = (r_before["median_ms"] / r_after["median_ms"]) if r_after["median_ms"] else float("inf")
    print(f"   index used by planner: {used_index} | speedup: {speedup:.1f}x")

    insert_after = _bench_inserts("write-bench-idx")
    delta = insert_after - insert_before
    print(f"   INSERT median WITH the index present: {insert_after:.3f}ms"
          f" (200 single-row inserts) -- delta vs without: {delta:+.3f}ms")

    db_size_estimate_bytes = total * 24  # ~(user_id TEXT + created_at TEXT) per b-tree entry, rough
    print(f"   estimated additional index size at this scale: ~{db_size_estimate_bytes/1024:.1f} KB"
          f" (rough: {total} rows x ~24 bytes/entry for a (user_id, created_at) b-tree entry)")

    conn.close()


if __name__ == "__main__":
    scales = [int(s) for s in (sys.argv[1:] or ["1000", "10000", "50000"])]
    for scale in scales:
        run_scale(scale)
