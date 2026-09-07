"""Quantify duplicated primitive computation in the WIDE 22-detector cohort —
real code, real timings, not an estimate. Companion to measure_duplication.py
(which measured the original 6-family cohort and found 1 wasted
`detect_pivots` call + some SMA re-derivation, ~163us/symbol total).

Source-verified duplication (grep + read every file in wide_cohort.py — see
RESULTS_WIDE.md for the file:line citations): EIGHT of this cohort's 22
detectors independently call `detect_pivots(bars, window=3)` on the exact
same `bars` list, with the exact same arguments:
  vcp.py, swing_pivots.py, support_resistance.py, major_trendlines.py,
  head_shoulders.py, triple_top.py, cup_handle.py, ascending_triangle.py

`build_context()` (primitives/context.py) — the ONE shared once-per-symbol
pass — never calls detect_pivots at all (confirmed by reading the file: it
only computes SMA10/20/50/150/200, volume signature, DCR, CAN SLIM). So NONE
of this cost is amortized anywhere: this is 8 fully independent O(n) fractal
sweeps over the identical input, where 1 would suffice if the result were
shared. That is 4x as many independent callers as the original 6-family
cohort found (2: vcp + bull_flag).

This script measures the REAL wall-clock cost of that duplication, across a
sample of real symbols with real bars, by calling the actual imported
`detect_pivots` function directly (no source edited, nothing mocked) once per
"caller" to reproduce the true per-symbol cost the production pipeline pays.

It also separately notes (does NOT count in the "redundant" total, since the
underlying calls are NOT identical args) a softer, secondary duplication:
`fit_trendline()` is called independently by both `ascending_triangle.py` and
`major_trendlines.py` — each on its own re-filtered pivot subset, so the two
calls do genuinely overlapping but not byte-identical work.
"""
from __future__ import annotations

import json
import os
import time

import bars_ro
import wide_cohort  # noqa: F401 (registers detectors)

from api.services.pattern_engine.primitives.pivots import detect_pivots
from api.services.pattern_engine.primitives.context import build_context

SAMPLE_N = 300

# The 8 detectors in this cohort that call detect_pivots(bars, window=3) on
# the raw bars, verified by reading each file (see wide_cohort.py's
# PIVOT_CALLING_DETECTORS + RESULTS_WIDE.md for file:line citations).
PIVOT_CALLERS = wide_cohort.PIVOT_CALLING_DETECTORS
N_PIVOT_CALLS = len(PIVOT_CALLERS)


def timeit(fn, *args, **kwargs):
    t0 = time.perf_counter()
    fn(*args, **kwargs)
    return time.perf_counter() - t0


def main():
    pool = wide_cohort.load_symbol_pool()[:SAMPLE_N]
    conn = bars_ro.ro_connect()

    totals = {
        "build_context_once": 0.0,
        # cost of ONE detect_pivots(bars, window=3) call — the "needed" one
        "detect_pivots_first_call": 0.0,
        # cost of the (N_PIVOT_CALLS - 1) further identical calls this
        # cohort's other detectors make — pure waste if the result were
        # shared instead of independently recomputed by each detector
        "detect_pivots_redundant_calls": 0.0,
    }
    n = 0
    try:
        for sym in pool:
            bars, _ = bars_ro.timed_get_daily_bars(conn, sym, 200)
            if not bars or len(bars) < 30:
                continue
            n += 1

            totals["build_context_once"] += timeit(build_context, bars, sym=sym)

            # First call: the one genuinely-needed detect_pivots invocation.
            totals["detect_pivots_first_call"] += timeit(detect_pivots, bars, window=3)

            # The remaining (N_PIVOT_CALLS - 1) callers in this cohort make
            # the IDENTICAL call independently. Time each repetition
            # separately (not just multiply-by-N) so this measures real
            # wall-clock, not an estimate.
            for _ in range(N_PIVOT_CALLS - 1):
                totals["detect_pivots_redundant_calls"] += timeit(detect_pivots, bars, window=3)
    finally:
        conn.close()

    ctx_total = totals["build_context_once"]
    redundant_total = totals["detect_pivots_redundant_calls"]

    out = {
        "sample_n": n,
        "cohort_size": len(wide_cohort.WIDE_COHORT_PATTERN_IDS),
        "pivot_calling_detectors": PIVOT_CALLERS,
        "n_independent_pivot_callers": N_PIVOT_CALLS,
        "prior_pass_pivot_callers_for_comparison": 2,  # vcp + bull_flag, see RESULTS.md
        "totals_seconds": {k: round(v, 6) for k, v in totals.items()},
        "us_per_symbol": {k: round(v / n * 1e6, 2) for k, v in totals.items()},
        "total_redundant_recompute_s": round(redundant_total, 6),
        "total_redundant_recompute_pct_of_context_cost": round(
            100.0 * redundant_total / ctx_total, 1
        ) if ctx_total > 0 else None,
        "note": (
            "build_context() never calls detect_pivots — confirmed by reading "
            "primitives/context.py — so ALL 8 calls above are independent, "
            "none amortized by the shared context pass. Only the identical-args "
            "detect_pivots(bars, window=3) duplication is counted here; "
            "fit_trendline() is also called independently by ascending_triangle "
            "and major_trendlines but on different pivot subsets, so it is a "
            "softer/partial overlap, not counted as redundant recompute."
        ),
    }
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "duplication_wide_result.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2)

    print(f"sample_n={n}, cohort_size={len(wide_cohort.WIDE_COHORT_PATTERN_IDS)}")
    print(f"build_context (shared, once):        {ctx_total*1e6/n:8.2f} us/symbol")
    print(f"detect_pivots first (needed) call:    {totals['detect_pivots_first_call']*1e6/n:8.2f} us/symbol")
    print(f"detect_pivots x{N_PIVOT_CALLS-1} redundant calls:      {redundant_total*1e6/n:8.2f} us/symbol "
          f"({out['total_redundant_recompute_pct_of_context_cost']}% of the shared context-build cost)")
    print(f"-> {out_path}")


if __name__ == "__main__":
    main()
