"""PC4 isolated timing: is get_symbol_backlinks genuinely super-linear 25k->50k, or noise?

Seeds the benchmark's own 25k and 50k tiers (reusing tools/notebook_scale_benchmark._seed,
the real schema via ensure_schema), then times ONLY get_symbol_backlinks, in the per-call
connection model (auth_db.get_connection() pointed at the tier db, a fresh connection per
call -- production's own model), many reps across several independent rounds, in ONE process.
Never touches C:\\data (import conftest pins every /data path to a sandbox before any api.*
import, same as the benchmark tool itself).

Prints raw samples (ms) per tier/round, then p50/p95/min/max and the between-round spread,
and the empirical 25k->50k doubling ratio + its log2 (the "last segment slope" the curve
computes, but measured here with many quiet-of-suite-noise reps in one pinned process).
"""
from __future__ import annotations

import json
import os
import statistics
import sys
import sqlite3
import tempfile
import time
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[0]  # placeholder, overwritten below
REPO_ROOT = Path(r"C:\Users\Patrick\uct-worktrees\notebook-w10-pc4")
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import conftest  # noqa: E402,F401  -- census pins + shared-root tripwire, before any api.* import

from tools.notebook_scale_benchmark import (  # noqa: E402
    _seed, _ticker_meta_stubbed, _auth_db_is, USER_ID,
)
from api.services.journal_two import db as j2db  # noqa: E402
from api.services.journal_two import notes as notes_svc  # noqa: E402

TIERS = (25000, 50000)
ROUNDS = 5
REPS_PER_ROUND = 30
WARMUP_PER_ROUND = 2
PARAGRAPHS = 5

WORK_DIR = Path(tempfile.mkdtemp(prefix="pc4_backlinks_"))


def percentile(samples, pct):
    s = sorted(samples)
    import math
    rank = max(1, math.ceil(pct / 100.0 * len(s)))
    return s[rank - 1]


def seed_tier(n: int) -> tuple[str, dict]:
    tmp_dir = tempfile.mkdtemp(prefix=f"pc4_tier_{n}_", dir=str(WORK_DIR))
    db_path = os.path.join(tmp_dir, "bench.db")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    j2db.ensure_schema(conn)
    heavy = notes_svc.create_folder(USER_ID, "Catch-All", conn=conn)
    others = [notes_svc.create_folder(USER_ID, f"Folder {i}", conn=conn)["id"] for i in range(8)]
    truth = _seed(conn, n, heavy["id"], others, PARAGRAPHS)
    # production maintains indexes live as notes are written -- the raw seed bypasses the
    # door writers, but ensure_schema already built every index before the inserts ran, so
    # they were maintained incrementally during the executemany, same as a live member's
    # saves would build them. No extra backfill needed for this op (backlinks does not read
    # the task digest).
    conn.close()
    return db_path, truth


def time_backlinks_per_call(db_path: str, sym: str, reps: int, warmup: int) -> list[float]:
    samples = []
    with _ticker_meta_stubbed():
        from api.services import auth_db

        def one_call():
            with _auth_db_is(db_path):
                c = auth_db.get_connection()
            try:
                return notes_svc.get_symbol_backlinks(USER_ID, sym, conn=c)
            finally:
                c.close()

        for _ in range(warmup):
            one_call()
        for _ in range(reps):
            t0 = time.perf_counter()
            r = one_call()
            samples.append((time.perf_counter() - t0) * 1000.0)
    return samples, r


def main():
    report = {"tiers": {}}
    for n in TIERS:
        print(f"=== seeding tier n={n} ===", flush=True)
        t0 = time.perf_counter()
        db_path, truth = seed_tier(n)
        seed_s = time.perf_counter() - t0
        sym = truth["embed_symbol"]
        expected = truth["backlink_notes"]
        print(f"seeded in {seed_s:.1f}s, symbol={sym}, expected backlink notes={expected}", flush=True)
        all_samples = []
        round_medians = []
        for rnd in range(ROUNDS):
            samples, last_result = time_backlinks_per_call(db_path, sym, REPS_PER_ROUND, WARMUP_PER_ROUND)
            assert last_result["count"] == expected, (last_result["count"], expected)
            all_samples.extend(samples)
            med = statistics.median(samples)
            round_medians.append(med)
            print(f"  round {rnd}: n={len(samples)} median={med:.3f}ms "
                  f"p95={percentile(samples,95):.3f}ms min={min(samples):.3f}ms max={max(samples):.3f}ms",
                  flush=True)
        report["tiers"][n] = {
            "symbol": sym,
            "expected_backlink_notes": expected,
            "db_bytes": os.path.getsize(db_path),
            "all_samples_ms": all_samples,
            "round_medians_ms": round_medians,
            "overall_p50_ms": percentile(all_samples, 50),
            "overall_p95_ms": percentile(all_samples, 95),
            "overall_min_ms": min(all_samples),
            "overall_max_ms": max(all_samples),
            "overall_stdev_ms": statistics.pstdev(all_samples),
            "round_median_spread_ms": max(round_medians) - min(round_medians),
        }
    p25 = report["tiers"][25000]["overall_p50_ms"]
    p50 = report["tiers"][50000]["overall_p50_ms"]
    ratio = p50 / p25
    import math
    slope = math.log2(ratio)
    report["segment_25k_50k"] = {"median_25k_ms": p25, "median_50k_ms": p50,
                                  "ratio": ratio, "log2_slope": slope}
    print(json.dumps(report, indent=2)[:200])
    out_path = WORK_DIR / "report.json"
    out_path.write_text(json.dumps(report, indent=2))
    print(f"\nWROTE {out_path}")
    print(f"\n=== SUMMARY ===")
    print(f"25k median: {p25:.3f} ms   50k median: {p50:.3f} ms   ratio: {ratio:.3f}   log2 slope: {slope:.3f}")
    for n in TIERS:
        t = report["tiers"][n]
        print(f"  n={n}: p50={t['overall_p50_ms']:.3f} p95={t['overall_p95_ms']:.3f} "
              f"min={t['overall_min_ms']:.3f} max={t['overall_max_ms']:.3f} "
              f"round-median spread={t['round_median_spread_ms']:.3f}ms")


if __name__ == "__main__":
    main()
