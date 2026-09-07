"""Benchmark: naive per-symbol, per-detector pattern scan at 50/200/500 symbols.

Mirrors the REAL production shape exactly (api/main.py::_scan_patterns_daily):
  bars = bars_sqlite.get_bars(sym, "D", 200)      # (here: read-only equivalent)
  if not bars or len(bars) < 30: skip
  ctx = build_context(bars_list, sym=sym)
  detections = detect_all(bars_list, ctx, pattern_ids=COHORT)

Measures, at each universe size, wall-clock split into three buckets:
  - bars fetch time (SQLite read)
  - build_context time (the ALREADY-shared once-per-symbol feature pass)
  - detect_all time for the 6-detector cohort

Also captures a per-family breakdown (each detector fn timed individually)
over a fixed subsample, so the per-family cost is visible without doubling
DB load across the full universe.

Output: lab/runtime/naive_benchmark_result.json
"""
from __future__ import annotations

import json
import os
import time

import bars_ro
import cohort

from api.services.pattern_engine import detect_all
from api.services.pattern_engine.primitives.context import build_context

UNIVERSE_SIZES = [50, 200, 500]
PER_FAMILY_SAMPLE = 100  # first N symbols of the largest universe, breakdown pass
MIN_BARS = 30
MAX_BARS = 200


def run_universe(symbols: list[str], conn, collect_per_family: bool) -> dict:
    n_scanned = 0
    n_skipped_thin = 0
    n_detections = 0
    fetch_s = 0.0
    context_s = 0.0
    detect_s = 0.0
    per_family_s = {pid: 0.0 for pid in cohort.COHORT_PATTERN_IDS}
    per_family_n = {pid: 0 for pid in cohort.COHORT_PATTERN_IDS}

    t_wall0 = time.perf_counter()
    for i, sym in enumerate(symbols):
        bars, dt_fetch = bars_ro.timed_get_daily_bars(conn, sym, MAX_BARS)
        fetch_s += dt_fetch
        if not bars or len(bars) < MIN_BARS:
            n_skipped_thin += 1
            continue

        t0 = time.perf_counter()
        ctx = build_context(bars, sym=sym)
        context_s += time.perf_counter() - t0

        t0 = time.perf_counter()
        dets = detect_all(bars, ctx, pattern_ids=cohort.COHORT_PATTERN_IDS)
        detect_s += time.perf_counter() - t0
        n_detections += len(dets)
        n_scanned += 1

        if collect_per_family and i < PER_FAMILY_SAMPLE:
            for pid, fn in cohort.DETECTOR_FNS.items():
                t0 = time.perf_counter()
                try:
                    fn(bars, ctx)
                except Exception:
                    pass
                per_family_s[pid] += time.perf_counter() - t0
                per_family_n[pid] += 1

    wall_s = time.perf_counter() - t_wall0
    result = {
        "universe_size": len(symbols),
        "n_scanned": n_scanned,
        "n_skipped_thin": n_skipped_thin,
        "n_detections": n_detections,
        "wall_s": round(wall_s, 4),
        "fetch_s_total": round(fetch_s, 4),
        "context_s_total": round(context_s, 4),
        "detect_s_total": round(detect_s, 4),
        "ms_per_symbol_wall": round(wall_s / max(1, len(symbols)) * 1000, 3),
        "ms_per_symbol_fetch": round(fetch_s / max(1, len(symbols)) * 1000, 3),
        "ms_per_symbol_context": round(context_s / max(1, n_scanned or 1) * 1000, 3),
        "ms_per_symbol_detect_all_cohort": round(detect_s / max(1, n_scanned or 1) * 1000, 3),
    }
    if collect_per_family:
        result["per_family_ms_avg"] = {
            pid: round(per_family_s[pid] / max(1, per_family_n[pid]) * 1000, 4)
            for pid in cohort.COHORT_PATTERN_IDS
        }
        result["per_family_sample_n"] = min(PER_FAMILY_SAMPLE, len(symbols))
    return result


def main():
    pool = cohort.load_symbol_pool()
    max_needed = max(UNIVERSE_SIZES)
    if len(pool) < max_needed:
        raise SystemExit(
            f"coverage pool only has {len(pool)} symbols with data; need {max_needed}. "
            f"Re-run check_universe_coverage.py with a broader sample."
        )

    conn = bars_ro.ro_connect()
    results = []
    try:
        for size in UNIVERSE_SIZES:
            symbols = pool[:size]
            is_largest = size == max(UNIVERSE_SIZES)
            r = run_universe(symbols, conn, collect_per_family=is_largest)
            results.append(r)
            print(
                f"[naive] universe={size:>4} scanned={r['n_scanned']:>4} "
                f"detections={r['n_detections']:>4} wall={r['wall_s']:.2f}s "
                f"(fetch={r['fetch_s_total']:.2f}s context={r['context_s_total']:.2f}s "
                f"detect={r['detect_s_total']:.2f}s)"
            )
    finally:
        conn.close()

    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "naive_benchmark_result.json")
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"-> {out_path}")


if __name__ == "__main__":
    main()
