"""Prototype: compute the duplicated primitives ONCE per symbol and let the
cohort's detectors reuse them — WITHOUT editing any detector source file.

This does NOT rewrite detector logic. It monkeypatches, at the Python
object level and only for the life of this process, the specific pure,
side-effect-free functions identified in measure_duplication.py as being
independently recomputed on identical inputs:

  - primitives.context._sma           (also imported by vcp.py,
                                        pullback_to_50sma.py, stage_analysis.py)
  - primitives.context._trend_stage   (also imported+re-called by stage_analysis.py)
  - primitives.context._ma_alignment  (also imported+re-called by stage_analysis.py)
  - primitives.pivots.detect_pivots   (independently imported+called by
                                        vcp.py AND bull_flag.py)

Each is replaced with a memoizing wrapper keyed on (id(input), *args) that
delegates to the ORIGINAL function on a cache miss and returns the cached
result on a hit. Because every one of these functions is pure (same input
-> same output, no state), this changes NOTHING about detection results —
only how many times the underlying math runs. That is verified below by
asserting the detection COUNT matches the naive run exactly, at every
universe size.

This is the honest limit of what a same-process, no-source-edit prototype
can demonstrate: detector logic itself (the gating/scoring/narrative code)
is untouched and still runs in full; only the specific redundant primitive
calls this lab measured are deduplicated. A real fix would thread a shared
per-symbol feature cache through the detector signatures (a source change,
out of scope here — see RESULTS.md).
"""
from __future__ import annotations

import json
import os
import time

import bars_ro
import cohort

from api.services.pattern_engine import detect_all
from api.services.pattern_engine.primitives import context as context_mod
from api.services.pattern_engine.primitives import pivots as pivots_mod
from api.services.pattern_engine.detectors.uct import vcp
from api.services.pattern_engine.detectors.uct import pullback_to_50sma
from api.services.pattern_engine.detectors.classical import bull_flag
from api.services.pattern_engine.detectors.structure import stage_analysis
from api.services.pattern_engine.primitives.context import build_context

UNIVERSE_SIZES = [50, 200, 500]
MIN_BARS = 30
MAX_BARS = 200

# The naive run's detection counts (benchmark_naive.py), used as a
# correctness cross-check — patching must not change WHAT is detected.
EXPECTED_DETECTIONS_BY_SIZE = {50: 72, 200: 286, 500: 699}


def install_shared_cache(cache: dict):
    orig_sma = context_mod._sma
    orig_trend_stage = context_mod._trend_stage
    orig_ma_alignment = context_mod._ma_alignment
    orig_pivots = pivots_mod.detect_pivots

    def cached_sma(values, period):
        key = ("sma", id(values), period)
        if key in cache:
            return cache[key]
        r = orig_sma(values, period)
        cache[key] = r
        return r

    def cached_trend_stage(bars):
        key = ("trend_stage", id(bars))
        if key in cache:
            return cache[key]
        r = orig_trend_stage(bars)
        cache[key] = r
        return r

    def cached_ma_alignment(bars):
        key = ("ma_alignment", id(bars))
        if key in cache:
            return cache[key]
        r = orig_ma_alignment(bars)
        cache[key] = r
        return r

    def cached_pivots(bars, window=5):
        key = ("pivots", id(bars), window)
        if key in cache:
            return cache[key]
        r = orig_pivots(bars, window=window)
        cache[key] = r
        return r

    # context.py's OWN internal unqualified calls inside build_context()
    # resolve `_sma`/`_trend_stage`/`_ma_alignment` via the module globals
    # dict at call time, so patching the module attribute here also covers
    # build_context's own invocations, not just the detectors' re-imports.
    context_mod._sma = cached_sma
    context_mod._trend_stage = cached_trend_stage
    context_mod._ma_alignment = cached_ma_alignment

    # Each of these modules did `from ...context import _sma` (etc) at
    # import time, which bound ITS OWN name to the original function
    # object — reassigning context_mod's attribute above does not reach
    # them. Patch each module's local name directly.
    vcp._sma = cached_sma
    pullback_to_50sma._sma = cached_sma
    stage_analysis._sma = cached_sma
    stage_analysis._trend_stage = cached_trend_stage
    stage_analysis._ma_alignment = cached_ma_alignment

    vcp.detect_pivots = cached_pivots
    bull_flag.detect_pivots = cached_pivots

    return {
        "context_sma": orig_sma, "context_trend_stage": orig_trend_stage,
        "context_ma_alignment": orig_ma_alignment, "pivots": orig_pivots,
    }


def run_universe(symbols: list[str], conn, cache: dict) -> dict:
    n_scanned = 0
    n_detections = 0
    context_s = 0.0
    detect_s = 0.0
    fetch_s = 0.0

    t_wall0 = time.perf_counter()
    for sym in symbols:
        bars, dt_fetch = bars_ro.timed_get_daily_bars(conn, sym, MAX_BARS)
        fetch_s += dt_fetch
        if not bars or len(bars) < MIN_BARS:
            continue

        cache.clear()  # fresh per symbol — bars is a new list each fetch anyway

        t0 = time.perf_counter()
        ctx = build_context(bars, sym=sym)
        context_s += time.perf_counter() - t0

        t0 = time.perf_counter()
        dets = detect_all(bars, ctx, pattern_ids=cohort.COHORT_PATTERN_IDS)
        detect_s += time.perf_counter() - t0
        n_detections += len(dets)
        n_scanned += 1

    wall_s = time.perf_counter() - t_wall0
    return {
        "universe_size": len(symbols),
        "n_scanned": n_scanned,
        "n_detections": n_detections,
        "wall_s": round(wall_s, 4),
        "fetch_s_total": round(fetch_s, 4),
        "context_s_total": round(context_s, 4),
        "detect_s_total": round(detect_s, 4),
        "ms_per_symbol_context": round(context_s / max(1, n_scanned) * 1000, 3),
        "ms_per_symbol_detect_all_cohort": round(detect_s / max(1, n_scanned) * 1000, 3),
    }


def main():
    pool = cohort.load_symbol_pool()
    cache: dict = {}
    install_shared_cache(cache)

    conn = bars_ro.ro_connect()
    results = []
    try:
        for size in UNIVERSE_SIZES:
            symbols = pool[:size]
            r = run_universe(symbols, conn, cache)
            expected = EXPECTED_DETECTIONS_BY_SIZE.get(size)
            r["matches_naive_detection_count"] = (expected is None or r["n_detections"] == expected)
            results.append(r)
            flag = "OK" if r["matches_naive_detection_count"] else "MISMATCH"
            print(
                f"[shared] universe={size:>4} scanned={r['n_scanned']:>4} "
                f"detections={r['n_detections']:>4} (naive={expected}) [{flag}] "
                f"context={r['context_s_total']:.4f}s detect={r['detect_s_total']:.4f}s"
            )
    finally:
        conn.close()

    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shared_pass_benchmark_result.json")
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"-> {out_path}")

    if not all(r["matches_naive_detection_count"] for r in results):
        raise SystemExit("CORRECTNESS FAILURE: shared-pass detection counts diverged from naive run")


if __name__ == "__main__":
    main()
