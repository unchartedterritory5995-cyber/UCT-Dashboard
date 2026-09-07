"""Read-only probe: which cap_universe symbols actually have >=220 daily bars
in the real local bars.db?

Scope discipline (see lab mission brief): this ONLY reads. It opens the
database via a strict read-only SQLite URI connection (mode=ro) so it is
physically incapable of writing, even by accident. It runs a handful of
GROUP BY queries (chunked IN-clauses over the existing (ticker, tf, ts DESC)
index) and exits. No long-running transactions, no per-symbol query loop.

Output: lab/runtime/coverage_result.json — a list of tickers (from a broad,
deterministic sample of cap_universe.json plus the full leader_universe) that
have >=220 stored daily bars, sorted by bar count descending.
"""
from __future__ import annotations

import json
import os
import sqlite3
import time

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB_PATH = r"C:\data\bars.db"
MIN_BARS = 220  # cohort's deepest need (VCP trend-template precondition wants 200)


def ro_conn() -> sqlite3.Connection:
    uri = f"file:{DB_PATH}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=5)
    return conn


def chunked(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def main():
    with open(os.path.join(REPO_ROOT, "api", "data", "leader_universe.json")) as f:
        leaders = json.load(f).get("tickers", [])
    with open(os.path.join(REPO_ROOT, "api", "data", "cap_universe.json")) as f:
        cap = json.load(f)
        if isinstance(cap, dict):
            cap = cap.get("tickers", [])

    # Deterministic broad sample across the alphabet: every 3rd ticker.
    sample = list(dict.fromkeys(leaders + cap[::3]))

    conn = ro_conn()
    t0 = time.time()
    counts: dict[str, int] = {}
    try:
        for chunk in chunked(sample, 400):
            placeholders = ",".join("?" for _ in chunk)
            rows = conn.execute(
                f"SELECT ticker, COUNT(*) FROM ohlcv "
                f"WHERE tf='D' AND ticker IN ({placeholders}) "
                f"GROUP BY ticker HAVING COUNT(*) >= ?",
                [*chunk, MIN_BARS],
            ).fetchall()
            for ticker, n in rows:
                counts[ticker] = n
    finally:
        conn.close()
    elapsed = time.time() - t0

    ranked = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)
    out = {
        "checked": len(sample),
        "with_coverage": len(ranked),
        "elapsed_s": round(elapsed, 2),
        "tickers_by_bar_count_desc": ranked,
    }
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "coverage_result.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2)
    print(f"checked={len(sample)} with_coverage={len(ranked)} elapsed={elapsed:.2f}s -> {out_path}")


if __name__ == "__main__":
    main()
