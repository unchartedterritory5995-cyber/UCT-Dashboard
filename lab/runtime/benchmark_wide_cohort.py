"""Benchmark: does "current recognition scales past 84 symbols" survive a
wider, harder 22-detector cohort (see wide_cohort.py for the selection and
rationale)?

Mirrors the prior pass's real production shape exactly
(api/main.py::_scan_patterns_daily), same as benchmark_naive.py:
  bars = bars_sqlite.get_bars(sym, "D", 200)      # (here: read-only equivalent)
  if not bars or len(bars) < 30: skip
  ctx = build_context(bars_list, sym=sym)
  detections = detect_all(bars_list, ctx, pattern_ids=WIDE_COHORT)

Measures, at each universe size, wall-clock split into three buckets (bar
fetch / build_context / detect_all for the 22-detector cohort), plus a
per-family breakdown over a fixed subsample so each family's cost is visible
without doubling DB load across the full universe — same technique as the
prior pass, so the numbers are directly comparable.

Universe sizes: 50, 200, 500, and (new) the full confirmed real-symbol pool
(~1,253 symbols) — the prior pass never went past 500.

Output: lab/runtime/wide_benchmark_result.json
"""
from __future__ import annotations

import json
import os
import time

import bars_ro
import wide_cohort

from api.services.pattern_engine import detect_all
from api.services.pattern_engine.primitives.context import build_context

UNIVERSE_SIZES = [50, 200, 500, "full"]
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
    per_family_s = {pid: 0.0 for pid in wide_cohort.WIDE_COHORT_PATTERN_IDS}
    per_family_n = {pid: 0 for pid in wide_cohort.WIDE_COHORT_PATTERN_IDS}
    per_family_detections = {pid: 0 for pid in wide_cohort.WIDE_COHORT_PATTERN_IDS}
    max_family_ms = {"pattern_id": None, "ms": -1.0}

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
        dets = detect_all(bars, ctx, pattern_ids=wide_cohort.WIDE_COHORT_PATTERN_IDS)
        detect_s += time.perf_counter() - t0
        n_detections += len(dets)
        n_scanned += 1

        if collect_per_family and i < PER_FAMILY_SAMPLE:
            for pid, fn in wide_cohort.DETECTOR_FNS.items():
                t0 = time.perf_counter()
                try:
                    fam_dets = fn(bars, ctx)
                except Exception:
                    fam_dets = []
                dt = time.perf_counter() - t0
                per_family_s[pid] += dt
                per_family_n[pid] += 1
                per_family_detections[pid] += len(fam_dets) if fam_dets else 0

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
        per_family_ms_avg = {
            pid: round(per_family_s[pid] / max(1, per_family_n[pid]) * 1000, 4)
            for pid in wide_cohort.WIDE_COHORT_PATTERN_IDS
        }
        for pid, ms in per_family_ms_avg.items():
            if ms > max_family_ms["ms"]:
                max_family_ms = {"pattern_id": pid, "ms": ms}
        result["per_family_ms_avg"] = per_family_ms_avg
        result["per_family_detections_in_sample"] = per_family_detections
        result["per_family_sample_n"] = min(PER_FAMILY_SAMPLE, len(symbols))
        result["slowest_family"] = max_family_ms
    return result


def main():
    pool = wide_cohort.load_symbol_pool()
    max_needed = max(s for s in UNIVERSE_SIZES if isinstance(s, int))
    if len(pool) < max_needed:
        raise SystemExit(
            f"coverage pool only has {len(pool)} symbols with data; need {max_needed}. "
            f"Re-run check_universe_coverage.py with a broader sample."
        )

    conn = bars_ro.ro_connect()
    results = []
    try:
        for size in UNIVERSE_SIZES:
            if size == "full":
                symbols = pool
                effective_size = len(pool)
            else:
                symbols = pool[:size]
                effective_size = size
            # Only collect the (expensive, ~22x per-symbol) per-family
            # breakdown once, on the largest 500-symbol non-full run — doing
            # it again on "full" would just repeat the same subsample's cost
            # for no new information.
            collect = (size == 500)
            r = run_universe(symbols, conn, collect_per_family=collect)
            results.append(r)
            print(
                f"[wide] universe={effective_size:>5} scanned={r['n_scanned']:>5} "
                f"detections={r['n_detections']:>5} wall={r['wall_s']:.3f}s "
                f"(fetch={r['fetch_s_total']:.3f}s context={r['context_s_total']:.3f}s "
                f"detect={r['detect_s_total']:.3f}s)"
            )
    finally:
        conn.close()

    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wide_benchmark_result.json")
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"-> {out_path}")


if __name__ == "__main__":
    main()
