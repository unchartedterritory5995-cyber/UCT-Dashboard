"""Quantify duplicated `detect_pivots` computation across the FULL 85-detector
registry -- real code, real timings, not an estimate. Full-registry successor
to the prior two lab passes' duplication scripts (6-family: 1 wasted call,
~163us/symbol; 22-family: 8 independent callers, ~1,169us/symbol, ~19x the
shared build_context cost).

Source-verified (grep + read every one of the 85 registered detector files --
see `full_registry.py::PIVOT_CALLING_DETECTORS` for the citation and the full
list): 29 of 85 registered detectors independently call
`detect_pivots(bars, window=3)` on the exact same `bars` list, with the exact
same arguments. `build_context()` (primitives/context.py) never calls
detect_pivots at all (confirmed by reading the file: it only computes
SMA10/20/50/150/200, volume signature, DCR, CAN SLIM) -- so NONE of this cost
is amortized anywhere. This is ~3.6x as many independent callers as the prior
22-family pass found (8), and the true, complete count for the live registry.
"""
from __future__ import annotations

import json
import os
import time

import bars_ro
import full_registry as fr

from api.services.pattern_engine.primitives.pivots import detect_pivots
from api.services.pattern_engine.primitives.context import build_context

SAMPLE_N = 300

PIVOT_CALLERS = fr.PIVOT_CALLING_DETECTORS
N_PIVOT_CALLS = len(PIVOT_CALLERS)


def timeit(fn, *args, **kwargs):
    t0 = time.perf_counter()
    fn(*args, **kwargs)
    return time.perf_counter() - t0


def main():
    pool = fr.load_symbol_pool()[:SAMPLE_N]
    conn = bars_ro.ro_connect()

    totals = {
        "build_context_once": 0.0,
        "detect_pivots_first_call": 0.0,
        "detect_pivots_redundant_calls": 0.0,
    }
    n = 0
    try:
        for sym in pool:
            bars, _ = bars_ro.timed_get_daily_bars(conn, sym, bars_ro.PATTERN_SCAN_DAILY_BARS)
            if not bars or len(bars) < 30:
                continue
            n += 1

            totals["build_context_once"] += timeit(build_context, bars, sym=sym)
            totals["detect_pivots_first_call"] += timeit(detect_pivots, bars, window=3)
            for _ in range(N_PIVOT_CALLS - 1):
                totals["detect_pivots_redundant_calls"] += timeit(detect_pivots, bars, window=3)
    finally:
        conn.close()

    ctx_total = totals["build_context_once"]
    redundant_total = totals["detect_pivots_redundant_calls"]

    out = {
        "sample_n": n,
        "registry_size": len(fr.FULL_REGISTRY_PATTERN_IDS),
        "pivot_calling_detectors": PIVOT_CALLERS,
        "n_independent_pivot_callers": N_PIVOT_CALLS,
        "prior_22family_pass_pivot_callers_for_comparison": 8,
        "prior_6family_pass_pivot_callers_for_comparison": 2,
        "totals_seconds": {k: round(v, 6) for k, v in totals.items()},
        "us_per_symbol": {k: round(v / n * 1e6, 2) for k, v in totals.items()},
        "total_redundant_recompute_s": round(redundant_total, 6),
        "total_redundant_recompute_pct_of_context_cost": round(
            100.0 * redundant_total / ctx_total, 1
        ) if ctx_total > 0 else None,
        "note": (
            "build_context() never calls detect_pivots -- confirmed by reading "
            "primitives/context.py -- so all 29 calls above are independent, "
            "none amortized by the shared context pass. Only the identical-args "
            "detect_pivots(bars, window=3) duplication is counted here. Two "
            "softer/qualitative categories are noted in RESULTS.md but NOT "
            "individually timed: fit_trendline() called independently by 10 "
            "detector files (different pivot subsets, not identical args); and "
            "16 (SMA/EMA) + 17 (ATR) detector files each defining their OWN "
            "local moving-average / range helper rather than reading a shared "
            "value -- build_context() computes internal SMA10/20/50/150/200 "
            "but never exposes them, and there is no ATR primitive under "
            "primitives/ at all."
        ),
    }
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "duplication_full_result.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2)

    print(f"sample_n={n}, registry_size={len(fr.FULL_REGISTRY_PATTERN_IDS)}")
    print(f"build_context (shared, once):        {ctx_total*1e6/n:8.2f} us/symbol")
    print(f"detect_pivots first (needed) call:    {totals['detect_pivots_first_call']*1e6/n:8.2f} us/symbol")
    print(f"detect_pivots x{N_PIVOT_CALLS-1} redundant calls:      {redundant_total*1e6/n:8.2f} us/symbol "
          f"({out['total_redundant_recompute_pct_of_context_cost']}% of the shared context-build cost)")
    print(f"-> {out_path}")


if __name__ == "__main__":
    main()
