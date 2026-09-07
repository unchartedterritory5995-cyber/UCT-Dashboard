"""Full-registry runtime baseline: does the prior 22-family sample's "roughly
linear, ~6.5s at 1,253 symbols, redundant computation growing with sample
breadth" conclusion hold for the REAL, COMPLETE, currently-registered
detector set (85 -- see `full_registry.py`), not a hand-picked subset?

Mirrors the real production shape exactly (`api/main.py::_scan_patterns_daily`,
commit e4f7ce432, the already-shipped fetch-depth fix this branch owns):

    bars = bars_sqlite.get_bars(sym, "D", _PATTERN_SCAN_DAILY_BARS)   # here: read-only equivalent, 300 bars
    if not bars or len(bars) < 30: skip
    ctx = build_context(bars_list, sym=sym)
    detections = detect_all(bars_list, ctx)     # pattern_ids=None -> FULL REGISTRY, exactly like production

Two passes:

  1. Universe sweep (50 / 200 / 500 / full 1,253) using the REAL `detect_all`
     (production's own swallow-and-log exception handling) for wall/fetch/
     context/detect timing -- directly comparable to the prior pass's table.

  2. ONE full-registry, full-pool (all 1,253 symbols) per-detector pass,
     calling every one of the 85 registered detector functions DIRECTLY
     (bypassing detect_all's swallow-and-log wrapper) so a real per-detector
     exception is CAUGHT AND RECORDED (pattern_id, exception type, message,
     and one example symbol) rather than disappearing into a logger, and a
     legitimate detector cost is attributed to its own pattern_id. This is
     deliberately run on "full", not a 100-symbol subsample like the two
     prior lab passes used for their per-family breakdown -- the mission
     requires accounting for every detector's success/error status across
     the run, and a subsample cannot support the claim "no detector was
     silently skipped."

Output: full_registry_result.json
"""
from __future__ import annotations

import json
import os
import time
import traceback

import bars_ro
import full_registry as fr

from api.services.pattern_engine import detect_all
from api.services.pattern_engine.primitives.context import build_context

UNIVERSE_SIZES = [50, 200, 500, "full"]
MIN_BARS = 30
MAX_BARS = bars_ro.PATTERN_SCAN_DAILY_BARS  # 300 -- the shipped fix's depth, not the pre-fix 200


def _assert_depth_matches_shipped_constant() -> None:
    """Refuse to benchmark a stale depth.

    Imports `api.main` ONLY for this one assertion (not for the fetch itself
    -- `bars_ro.py` stays a lightweight, dependency-free read-only module) so
    a future change to the shipped `_PATTERN_SCAN_DAILY_BARS` constant fails
    this script loudly instead of silently benchmarking last session's number.
    """
    from api import main as _main
    if _main._PATTERN_SCAN_DAILY_BARS != MAX_BARS:
        raise SystemExit(
            f"bars_ro.PATTERN_SCAN_DAILY_BARS={MAX_BARS} no longer matches "
            f"api.main._PATTERN_SCAN_DAILY_BARS={_main._PATTERN_SCAN_DAILY_BARS} "
            f"-- update bars_ro.py before trusting this benchmark"
        )


def run_universe(symbols: list[str], conn) -> dict:
    """Timing-only pass using the REAL `detect_all` (pattern_ids=None -> every
    registered detector), exactly the call `_scan_patterns_daily` makes."""
    n_scanned = 0
    n_skipped_thin = 0
    n_detections = 0
    fetch_s = 0.0
    context_s = 0.0
    detect_s = 0.0

    t_wall0 = time.perf_counter()
    for sym in symbols:
        bars, dt_fetch = bars_ro.timed_get_daily_bars(conn, sym, MAX_BARS)
        fetch_s += dt_fetch
        if not bars or len(bars) < MIN_BARS:
            n_skipped_thin += 1
            continue

        t0 = time.perf_counter()
        ctx = build_context(bars, sym=sym)
        context_s += time.perf_counter() - t0

        t0 = time.perf_counter()
        dets = detect_all(bars, ctx)  # full registry, exactly like production
        detect_s += time.perf_counter() - t0
        n_detections += len(dets)
        n_scanned += 1

    wall_s = time.perf_counter() - t_wall0
    return {
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
        "ms_per_symbol_detect_all_full_registry": round(detect_s / max(1, n_scanned or 1) * 1000, 3),
    }


def run_full_registry_error_catalog(symbols: list[str], conn) -> dict:
    """Per-detector pass over the FULL pool, calling every one of the 85
    registered detectors DIRECTLY so an exception is caught and attributed
    (never silently absorbed by detect_all's own try/except+log)."""
    per_pid_s = {pid: 0.0 for pid in fr.FULL_REGISTRY_PATTERN_IDS}
    per_pid_n_ok = {pid: 0 for pid in fr.FULL_REGISTRY_PATTERN_IDS}
    per_pid_n_err = {pid: 0 for pid in fr.FULL_REGISTRY_PATTERN_IDS}
    per_pid_detections = {pid: 0 for pid in fr.FULL_REGISTRY_PATTERN_IDS}
    per_pid_errors: dict[str, dict] = {}  # pid -> {example_sym, exc_type, message}

    n_scanned = 0
    n_skipped_thin = 0
    ctx_total_s = 0.0
    fetch_total_s = 0.0

    for sym in symbols:
        bars, dt_fetch = bars_ro.timed_get_daily_bars(conn, sym, MAX_BARS)
        fetch_total_s += dt_fetch
        if not bars or len(bars) < MIN_BARS:
            n_skipped_thin += 1
            continue
        t0 = time.perf_counter()
        ctx = build_context(bars, sym=sym)
        ctx_total_s += time.perf_counter() - t0
        n_scanned += 1

        for pid, fn in fr.DETECTOR_FNS.items():
            t0 = time.perf_counter()
            try:
                dets = fn(bars, ctx)
                per_pid_s[pid] += time.perf_counter() - t0
                per_pid_n_ok[pid] += 1
                per_pid_detections[pid] += len(dets) if dets else 0
            except Exception as e:  # noqa: BLE001 -- deliberately broad: cataloguing, not filtering
                per_pid_s[pid] += time.perf_counter() - t0
                per_pid_n_err[pid] += 1
                if pid not in per_pid_errors:
                    per_pid_errors[pid] = {
                        "example_symbol": sym,
                        "exception_type": type(e).__name__,
                        "message": str(e)[:300],
                    }

    per_pid_ms_avg = {
        pid: round(per_pid_s[pid] / max(1, per_pid_n_ok[pid] + per_pid_n_err[pid]) * 1000, 5)
        for pid in fr.FULL_REGISTRY_PATTERN_IDS
    }
    ranked_by_cost = sorted(per_pid_ms_avg.items(), key=lambda kv: kv[1], reverse=True)
    detectors_with_any_error = sorted(
        pid for pid in fr.FULL_REGISTRY_PATTERN_IDS if per_pid_n_err[pid] > 0
    )
    return {
        "n_scanned": n_scanned,
        "n_skipped_thin": n_skipped_thin,
        "fetch_total_s": round(fetch_total_s, 4),
        "context_total_s": round(ctx_total_s, 4),
        "registered_pattern_ids": fr.FULL_REGISTRY_PATTERN_IDS,
        "registered_count": len(fr.FULL_REGISTRY_PATTERN_IDS),
        "per_detector_ms_avg": per_pid_ms_avg,
        "per_detector_n_ok": per_pid_n_ok,
        "per_detector_n_err": per_pid_n_err,
        "per_detector_detections_total": per_pid_detections,
        "top_10_most_expensive": ranked_by_cost[:10],
        "detectors_with_any_error": detectors_with_any_error,
        "error_examples": per_pid_errors,
        "detectors_executed_zero_times": [
            pid for pid in fr.FULL_REGISTRY_PATTERN_IDS
            if per_pid_n_ok[pid] == 0 and per_pid_n_err[pid] == 0
        ],
    }


def _four_target_detections(catalog: dict) -> dict:
    """Step 3 of the mission: do the four newly-reachable detectors (this
    branch's own fix, e4f7ce432) actually fire anywhere in this full run?"""
    targets = ["pullback_to_50sma", "pullback_to_200sma", "golden_cross", "death_cross"]
    out = {}
    for pid in targets:
        out[pid] = {
            "executed_ok_count": catalog["per_detector_n_ok"].get(pid, 0),
            "errored_count": catalog["per_detector_n_err"].get(pid, 0),
            "detections_total": catalog["per_detector_detections_total"].get(pid, 0),
            "fired": catalog["per_detector_detections_total"].get(pid, 0) > 0,
        }
    return out


def main():
    _assert_depth_matches_shipped_constant()

    pool = fr.load_symbol_pool()
    max_needed = max(s for s in UNIVERSE_SIZES if isinstance(s, int))
    if len(pool) < max_needed:
        raise SystemExit(
            f"coverage pool only has {len(pool)} symbols with data; need {max_needed}."
        )

    conn = bars_ro.ro_connect()
    sweep_results = []
    try:
        for size in UNIVERSE_SIZES:
            symbols = pool if size == "full" else pool[:size]
            t0 = time.perf_counter()
            r = run_universe(symbols, conn)
            wall = time.perf_counter() - t0
            sweep_results.append(r)
            print(
                f"[sweep] universe={r['universe_size']:>5} scanned={r['n_scanned']:>5} "
                f"detections={r['n_detections']:>6} wall={r['wall_s']:.3f}s "
                f"(fetch={r['fetch_s_total']:.3f}s context={r['context_s_total']:.3f}s "
                f"detect={r['detect_s_total']:.3f}s) [outer={wall:.3f}s]"
            )

        print(f"\n[error-catalog] running all {len(fr.FULL_REGISTRY_PATTERN_IDS)} detectors "
              f"directly across the full {len(pool)}-symbol pool ...")
        t0 = time.perf_counter()
        catalog = run_full_registry_error_catalog(pool, conn)
        cat_wall = time.perf_counter() - t0
        print(f"[error-catalog] done in {cat_wall:.3f}s -- "
              f"{len(catalog['detectors_with_any_error'])} detector(s) with >=1 error, "
              f"{len(catalog['detectors_executed_zero_times'])} executed zero times")
    finally:
        conn.close()

    four = _four_target_detections(catalog)
    for pid, info in four.items():
        print(f"[four-detector check] {pid}: fired={info['fired']} "
              f"(detections={info['detections_total']}, ok={info['executed_ok_count']}, "
              f"errors={info['errored_count']})")

    out = {
        "measured_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "branch": "local/pullback-history-reachability",
        "fix_commit": "e4f7ce432",
        "pattern_scan_daily_bars": MAX_BARS,
        "symbol_pool_size": len(pool),
        "sweep": sweep_results,
        "error_catalog_wall_s": round(cat_wall, 4),
        "error_catalog": catalog,
        "four_newly_reachable_detectors": four,
    }
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "full_registry_result.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2)
    print(f"\n-> {out_path}")


if __name__ == "__main__":
    main()
