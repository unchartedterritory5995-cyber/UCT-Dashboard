"""Wave 4 Stage 0 (Search Evolution I) — FTS5 read-latency benchmark.

Pure-SQLite, no web app, no C:\\data, no sandbox server. Builds a synthetic
j2_notes + j2_notes_fts corpus (via the REAL schema from db.py) at several
scales and measures MATCH read-path latency for a representative query set.

⚠️ Set DATA_DIR to a scratch directory before running this — db.py's
ensure_schema() resolves DATA_DIR-derived migration flag paths, and its
default ('/data') is the real shared production root on this box:

    DATA_DIR=/some/scratch/dir python tools/wave4_fts_benchmark.py [scales...]

Read the full findings + the caveat about this synthetic corpus's
unrealistically small/repetitive vocabulary in
docs/notebook/wave4-search-evolution-i-prep.md §2 before citing any number
this script prints as a production-representative latency.
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

from api.services.journal_two.db import ensure_schema  # noqa: E402
from api.services.journal_two.notes_search import fts_match_expr  # noqa: E402

random.seed(42)

VOCAB = (
    "NVDA semiconductor capex accelerating AI datacenter buildout risk gross margin debate "
    "AMD earnings beat guidance raise cloud AWS Azure GCP hyperscaler spend TSMC foundry node "
    "thesis invalidation stop loss trim position size Berkshire BRK class shares intrinsic value "
    "discount premium moat buyback dividend yield inflation Fed meeting rate cut hike CPI print "
    "breakout base pattern volume confirmation support resistance trendline pullback swing trade "
    "earnings call transcript guidance raised lowered beat miss revenue EPS margin expansion "
    "sector rotation growth value momentum quality factor risk management drawdown volatility "
    "watchlist screener setup entry stop target catalyst news flow options flow dark pool "
    "portfolio allocation rebalance correlation hedge macro regime bullish bearish neutral"
).split()

TICKERS = ["NVDA", "AMD", "MSFT", "AAPL", "GOOGL", "TSLA", "BRK-B", "META", "AVGO", "SMCI"]

BENCHMARK_QUERIES = [
    "NVDA",
    "semiconductor capex",
    "earnings",
    "risk to gross margin",
    "AI datacenter demand",
    "thesis invalidation",
    "BRK-B",
    "$NVDA",
]


def gen_body(min_words=40, max_words=180):
    n = random.randint(min_words, max_words)
    words = [random.choice(VOCAB) for _ in range(n)]
    if random.random() < 0.6:
        words.insert(random.randrange(len(words)), random.choice(TICKERS))
    return " ".join(words)


def seed_notes(conn, user_id, count, start_days_ago=400):
    now = time.time()
    for i in range(count):
        note_id = str(uuid.uuid4())
        title = f"{random.choice(TICKERS)} note {i}"
        body = gen_body()
        days_ago = random.randint(0, start_days_ago)
        created = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now - days_ago * 86400))
        # j2_notes_fts_ai (the real schema trigger) fires on this INSERT and
        # populates j2_notes_fts + j2_notes_fts_map itself -- no manual mirror
        # needed, and this is schema-faithful to the actual write path.
        conn.execute(
            "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags,"
            " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
            (note_id, user_id, title, '{"type":"doc","content":[]}', body, "[]", created, created),
        )
        if i % 2000 == 0 and i:
            conn.commit()
    conn.commit()


def bench_query(conn, user_id, q, reps=15):
    expr = fts_match_expr(q)
    times = []
    result_count = None
    for _ in range(reps):
        t0 = time.perf_counter()
        rows = conn.execute(
            "SELECT note_id FROM j2_notes_fts WHERE j2_notes_fts MATCH ? AND user_id = ?",
            (expr, user_id),
        ).fetchall()
        times.append((time.perf_counter() - t0) * 1000)
        result_count = len(rows)
    return {
        "query": q, "expr": expr, "result_count": result_count,
        "median_ms": round(statistics.median(times), 3),
        "p95_ms": round(sorted(times)[int(len(times) * 0.95)], 3),
        "min_ms": round(min(times), 3),
        "max_ms": round(max(times), 3),
    }


def bench_snippet(conn, user_id, q, reps=10):
    expr = fts_match_expr(q)
    times = []
    for _ in range(reps):
        t0 = time.perf_counter()
        conn.execute(
            "SELECT note_id, snippet(j2_notes_fts, 3, '[', ']', '...', 12) FROM j2_notes_fts"
            " WHERE j2_notes_fts MATCH ? AND user_id = ? LIMIT 20",
            (expr, user_id),
        ).fetchall()
        times.append((time.perf_counter() - t0) * 1000)
    return {"query": q, "snippet_median_ms": round(statistics.median(times), 3)}


def run_scale(scale):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    ensure_schema(conn)
    user_id = "bench-user"
    other_user_notes = max(1, scale // 20)  # a little cross-user noise, realistic global-table shape
    t0 = time.perf_counter()
    seed_notes(conn, user_id, scale)
    seed_notes(conn, "other-user", other_user_notes)
    seed_ms = (time.perf_counter() - t0) * 1000

    print(f"\n=== scale: {scale} notes (user) + {other_user_notes} (other users) ===")
    print(f"seed time: {seed_ms:.0f}ms")
    total_rows = conn.execute("SELECT COUNT(*) FROM j2_notes_fts").fetchone()[0]
    print(f"j2_notes_fts total rows (global table): {total_rows}")

    for q in BENCHMARK_QUERIES:
        r = bench_query(conn, user_id, q)
        print(f"  MATCH {r['query']!r:30s} -> expr={r['expr']!r:35s} "
              f"results={r['result_count']:5d} median={r['median_ms']:.3f}ms p95={r['p95_ms']:.3f}ms")

    for q in ["NVDA", "earnings"]:
        s = bench_snippet(conn, user_id, q)
        print(f"  snippet() {s['query']!r:20s} -> median={s['snippet_median_ms']:.3f}ms")

    conn.close()


if __name__ == "__main__":
    scales = [int(s) for s in (sys.argv[1:] or ["100", "1000", "10000", "50000"])]
    for scale in scales:
        run_scale(scale)
