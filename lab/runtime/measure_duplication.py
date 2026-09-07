"""Quantify duplicated computation within the 6-detector cohort — real code,
real timings, not an estimate.

Source-verified duplication (grep + read, see RESULTS.md for file:line
citations). Within this cohort, per symbol, on top of the ONE shared
`build_context()` pass:

  1. `detect_pivots(bars, window=3)` is called a SECOND time, independently,
     by both `vcp.py` (line 112) and `bull_flag.py` (line 65) on the exact
     same `bars` list. One of the two calls is pure waste.
  2. `stage_analysis.py` calls `_trend_stage(bars)` (line 95) and
     `_ma_alignment(bars)` (line 101) — the EXACT SAME functions
     `build_context()` already called on the exact same `bars`, to produce
     `context["trend_stage"]` / `context["ma_alignment"]`. Both are recomputed
     from scratch a second time, then the detector ALSO calls `_sma(closes,
     50/150/200)` three more times directly (lines 103-105) to re-derive
     values its own `_ma_alignment`/`_trend_stage` re-call just computed
     internally.
  3. `vcp.py` calls its own local `_sma(closes, 150)` and `_sma(closes, 200)`
     (lines 396-397) — the same two periods `build_context._ma_alignment`
     (200) and `._trend_stage` (150, when len(bars)>=200) already computed.
  4. `pullback_to_50sma.py` calls its own local `_sma(closes, 50)` (line 70)
     — the same period `build_context._ma_alignment` already computed (its
     second call, `_sma(closes[:-20], 50)` for the slope, is a genuinely
     different window — not counted as duplication below).

This script measures the REAL wall-clock cost of each duplicated call,
across a sample of real symbols with real bars, by calling the actual
imported functions directly (no source edited, nothing mocked).
"""
from __future__ import annotations

import json
import os
import time

import bars_ro
import cohort  # noqa: F401 (registers detectors; also gives us module handles below)

from api.services.pattern_engine.detectors.uct import vcp
from api.services.pattern_engine.detectors.classical import bull_flag
from api.services.pattern_engine.detectors.uct import pullback_to_50sma
from api.services.pattern_engine.detectors.structure import stage_analysis
from api.services.pattern_engine.primitives.context import build_context

SAMPLE_N = 300


def timeit(fn, *args, **kwargs):
    t0 = time.perf_counter()
    fn(*args, **kwargs)
    return time.perf_counter() - t0


def main():
    pool = cohort.load_symbol_pool()[:SAMPLE_N]
    conn = bars_ro.ro_connect()

    totals = {
        "build_context_once": 0.0,
        "detect_pivots_2nd_call_waste": 0.0,   # bull_flag's call, given vcp already made one
        "stage_analysis_trend_stage_redup": 0.0,
        "stage_analysis_ma_alignment_redup": 0.0,
        "stage_analysis_extra_sma_calls": 0.0,  # its own 3 direct _sma() calls
        "vcp_sma150_sma200_redup": 0.0,
        "pullback_sma50_redup": 0.0,
    }
    n = 0
    try:
        for sym in pool:
            bars, _ = bars_ro.timed_get_daily_bars(conn, sym, 200)
            if not bars or len(bars) < 30:
                continue
            n += 1
            closes = [float(b["c"]) for b in bars]

            totals["build_context_once"] += timeit(build_context, bars, sym=sym)

            # (1) the second, wasted detect_pivots call. Both files import the
            # SAME function object from primitives.pivots; time it once and
            # attribute it as "the call bull_flag makes that vcp already paid
            # for" — i.e. the marginal/duplicate cost, not the first, needed one.
            totals["detect_pivots_2nd_call_waste"] += timeit(bull_flag.detect_pivots, bars, window=3)

            # (2) stage_analysis re-deriving what build_context already derived
            totals["stage_analysis_trend_stage_redup"] += timeit(stage_analysis._trend_stage, bars)
            totals["stage_analysis_ma_alignment_redup"] += timeit(stage_analysis._ma_alignment, bars)

            def _extra_sma_calls():
                stage_analysis._sma(closes, 50)
                stage_analysis._sma(closes, 150)
                stage_analysis._sma(closes, 200)
            totals["stage_analysis_extra_sma_calls"] += timeit(_extra_sma_calls)

            # (3) vcp's own sma150/sma200 (duplicates of context's)
            def _vcp_smas():
                vcp._sma(closes, 150)
                vcp._sma(closes, 200)
            totals["vcp_sma150_sma200_redup"] += timeit(_vcp_smas)

            # (4) pullback_to_50sma's own current-window sma50 (duplicate;
            # NOT counting its second call on closes[:-20], which is a
            # genuinely different window context.py never computes)
            totals["pullback_sma50_redup"] += timeit(pullback_to_50sma._sma, closes, 50)
    finally:
        conn.close()

    redup_keys = [k for k in totals if k != "build_context_once"]
    total_redup = sum(totals[k] for k in redup_keys)
    ctx_total = totals["build_context_once"]

    out = {
        "sample_n": n,
        "totals_seconds": {k: round(v, 6) for k, v in totals.items()},
        "us_per_symbol": {k: round(v / n * 1e6, 2) for k, v in totals.items()},
        "total_redundant_recompute_s": round(total_redup, 6),
        "total_redundant_recompute_pct_of_context_cost": round(
            100.0 * total_redup / ctx_total, 1
        ) if ctx_total > 0 else None,
    }
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "duplication_result.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2)

    print(f"sample_n={n}")
    print(f"build_context (shared, once):        {ctx_total*1e6/n:8.2f} us/symbol")
    for k in redup_keys:
        print(f"  redundant: {k:38s} {totals[k]*1e6/n:8.2f} us/symbol")
    print(f"total redundant recompute: {total_redup*1e6/n:.2f} us/symbol "
          f"({out['total_redundant_recompute_pct_of_context_cost']}% of the shared context-build cost)")
    print(f"-> {out_path}")


if __name__ == "__main__":
    main()
