"""Calibration backtest for the pattern recognition engine (Gate 4).

Walks historical bars across a sampled universe, simulates trade outcomes,
bins detections by confidence, and reports per-pattern realized hit rates.

A well-calibrated detector has realized hit rates within ±5% of the predicted
confidence bin midpoint (e.g., 70-80 confidence band → ~75% hit rate).

Usage:
  python scripts/calibration_backtest.py --symbols 50 --tf D
  python scripts/calibration_backtest.py --symbols 200 --tf D --bars 500
  python scripts/calibration_backtest.py --symbols 100 --tf W
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import datetime
from typing import List

# Add repo root to sys.path so api.* imports work
_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, _REPO_ROOT)


def run(symbol_limit: int = 100, tf: str = "D", lookback_bars: int = 500, anchor_step: int = 5, forward_bars: int = 30):
    from api.services import bars_sqlite
    from api.services.pattern_engine import detect_all
    from api.services.pattern_engine.primitives.context import build_context
    # Trigger detector self-registration:
    from api.routers import patterns as _patterns  # noqa: F401

    universe_path = os.path.join(_REPO_ROOT, "api", "data", "cap_universe.json")
    with open(universe_path) as f:
        data = json.load(f)
    universe = data if isinstance(data, list) else data.get("tickers", [])

    print(f"\n{'=' * 60}")
    print(f"  CALIBRATION BACKTEST — Gate 4")
    print(f"  Symbols: {min(symbol_limit, len(universe))}")
    print(f"  Timeframe: {tf}")
    print(f"  Bars per symbol: {lookback_bars}")
    print(f"  Anchor step: every {anchor_step} bars")
    print(f"  Forward bars: {forward_bars}")
    print(f"{'=' * 60}\n")

    all_outcomes = []   # list of {pattern_id, confidence, hit_target, hit_stop, mfe, mae}
    symbols_processed = 0
    symbols_with_no_data = 0

    for sym in universe[:symbol_limit]:
        bars = bars_sqlite.get_bars(sym, tf, lookback_bars)
        if not bars or len(bars) < 60:
            symbols_with_no_data += 1
            continue

        bars_list = [
            {"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]}
            for r in bars
        ]

        # For each anchor point, run detection then walk forward
        for anchor_idx in range(50, len(bars_list) - forward_bars, anchor_step):
            past = bars_list[:anchor_idx + 1]
            future = bars_list[anchor_idx + 1: anchor_idx + 1 + forward_bars]
            if not future:
                break

            try:
                ctx = build_context(past, sym=sym)
                detections = detect_all(past, ctx)
            except Exception:
                continue

            for d in detections:
                lv = d.get("levels", {})
                entry = lv.get("entry")
                stop = lv.get("stop")
                target = lv.get("target_primary")
                if entry is None or stop is None or target is None:
                    continue

                is_long = target > entry

                hit_target = False
                hit_stop = False
                mfe = 0.0
                mae = 0.0

                for fb in future:
                    if is_long:
                        if fb["h"] >= target:
                            hit_target = True
                            break
                        if fb["l"] <= stop:
                            hit_stop = True
                            break
                        mfe = max(mfe, (fb["h"] - entry) / entry * 100)
                        mae = max(mae, (entry - fb["l"]) / entry * 100)
                    else:
                        if fb["l"] <= target:
                            hit_target = True
                            break
                        if fb["h"] >= stop:
                            hit_stop = True
                            break
                        mfe = max(mfe, (entry - fb["l"]) / entry * 100)
                        mae = max(mae, (fb["h"] - entry) / entry * 100)

                # Resolved (target hit or stop hit) or expired (neither in forward window)
                resolved = hit_target or hit_stop
                if resolved:
                    all_outcomes.append({
                        "pattern_id": d["pattern_id"],
                        "confidence": d["confidence"],
                        "hit_target": hit_target,
                        "hit_stop": hit_stop,
                        "mfe": round(mfe, 2),
                        "mae": round(mae, 2),
                    })

        symbols_processed += 1
        if symbols_processed % 25 == 0:
            print(f"  Processed {symbols_processed} symbols, {len(all_outcomes)} resolved outcomes so far")

    print(f"\n--- Backtest complete ---")
    print(f"Symbols processed: {symbols_processed}")
    print(f"Symbols with no data: {symbols_with_no_data}")
    print(f"Total resolved outcomes: {len(all_outcomes)}")

    # Bin and analyze
    BINS = [(50, 60, "50-60", 55), (60, 70, "60-70", 65), (70, 80, "70-80", 75),
            (80, 90, "80-90", 85), (90, 101, "90+", 95)]

    # binned[pattern_id][bin_label] = list of outcome dicts
    binned: dict = defaultdict(lambda: defaultdict(list))

    for o in all_outcomes:
        c = o["confidence"]
        for lo, hi, label, _mid in BINS:
            if lo <= c < hi:
                binned[o["pattern_id"]][label].append(o)
                break

    # Write report
    report_path = os.path.join(
        _REPO_ROOT, "docs", "superpowers", "phase-reports",
        f"{datetime.now().strftime('%Y-%m-%d')}-calibration-backtest.md"
    )
    os.makedirs(os.path.dirname(report_path), exist_ok=True)

    lines = [
        "# Pattern Recognition - Calibration Backtest (Gate 4)",
        "",
        f"**Date:** {datetime.now().isoformat()}",
        f"**Universe:** {symbols_processed} symbols processed (cap {symbol_limit}), TF={tf}, {lookback_bars} bars/sym",
        f"**Total resolved outcomes:** {len(all_outcomes)}",
        f"**Anchor step:** every {anchor_step} bars, **forward window:** {forward_bars} bars",
        "",
        "## Calibration table per detector",
        "",
        "For each detector, the realized hit rate per confidence bin. A well-calibrated detector",
        "has hit rates near the bin midpoint (e.g., 70-80 band → ~75% hit rate, Δ near 0).",
        "",
        "| Detector | Bin | N | Hit rate | Predicted mid | Δ | Avg MFE | Avg MAE |",
        "|---|---|---|---|---|---|---|---|",
    ]

    midpoints = {"50-60": 55, "60-70": 65, "70-80": 75, "80-90": 85, "90+": 95}

    # Sort patterns by total outcomes (most-detected first)
    pattern_totals = {pid: sum(len(v) for v in bins.values()) for pid, bins in binned.items()}
    pattern_order = sorted(binned.keys(), key=lambda p: -pattern_totals[p])

    for pid in pattern_order:
        for _, _, label, _ in BINS:
            outcomes = binned[pid][label]
            if not outcomes:
                continue
            n = len(outcomes)
            hit_rate = sum(1 for o in outcomes if o["hit_target"]) / n * 100
            avg_mfe = sum(o["mfe"] for o in outcomes) / n
            avg_mae = sum(o["mae"] for o in outcomes) / n
            mid = midpoints[label]
            delta = hit_rate - mid
            delta_emoji = "✅" if abs(delta) < 5 else "⚠️" if abs(delta) < 15 else "❌"
            lines.append(
                f"| `{pid}` | {label} | {n} | {hit_rate:.1f}% | {mid}% | {delta:+.1f} {delta_emoji} | {avg_mfe:.2f}% | {avg_mae:.2f}% |"
            )

    lines.extend([
        "",
        "## Interpretation",
        "",
        "- **|Δ| < 5% (✅)**: well-calibrated - confidence prediction matches realized hit rate.",
        "- **|Δ| 5-15% (⚠️)**: moderate miscalibration - consider tuning confidence weights or reviewing detector logic.",
        "- **|Δ| > 15% (❌)**: significant miscalibration - retune before launching this detector to users.",
        "",
        "## Notes",
        "",
        "- The backtest assumes immediate trade execution on entry trigger.",
        "- 'Forward window' caps the resolution period — detections still open after `forward_bars` are not counted.",
        "- Increasing `--symbols` and `--bars` improves statistical confidence per bin. Aim for ≥30 outcomes per (pattern, bin) cell.",
        "- Re-run after Phase 7 has accumulated real-world detection data via the live scheduler; the historical backtest is an initial baseline only.",
    ])

    with open(report_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"\nReport written: {report_path}\n")
    return report_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Calibration backtest for pattern recognition engine")
    parser.add_argument("--symbols", type=int, default=100, help="number of symbols to test")
    parser.add_argument("--tf", default="D", help="timeframe (5min/30min/1hr/D/W/M)")
    parser.add_argument("--bars", type=int, default=500, help="bars per symbol")
    parser.add_argument("--step", type=int, default=5, help="anchor step (every N bars)")
    parser.add_argument("--forward", type=int, default=30, help="forward window for resolution")
    args = parser.parse_args()
    run(args.symbols, args.tf, args.bars, args.step, args.forward)
