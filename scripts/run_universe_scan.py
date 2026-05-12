"""Heavy universe-scale scan of the pattern engine.

For each ticker in cap_universe.json × specified timeframes, fetch bars from
bars_sqlite, run all registered detectors, store detections to memory layer.

Used for:
  - Phase 6 Gate 3 (false positive sweep at scale)
  - Phase 6 Gate 4 (confidence calibration baseline)
  - Continuous post-launch monitoring

Usage:
  python scripts/run_universe_scan.py --tf D --max 100      # 100 tickers, daily
  python scripts/run_universe_scan.py --tf D --tf W         # all tickers, daily + weekly
  python scripts/run_universe_scan.py --dry-run             # don't store, just count
"""
from __future__ import annotations

import argparse
import json
import os
import time

_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_UNIVERSE_PATH = os.path.join(_REPO_ROOT, "api", "data", "cap_universe.json")


def _load_universe() -> list[str]:
    with open(_UNIVERSE_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list):
        return [t for t in data if isinstance(t, str)]
    if isinstance(data, dict) and "tickers" in data:
        return data["tickers"]
    return []


def run(timeframes: list[str], max_tickers: int | None, dry_run: bool, bars_per: int):
    from api.services import bars_sqlite
    from api.services.pattern_engine import detect_all
    from api.services.pattern_engine import memory
    from api.services.pattern_engine.primitives.context import build_context
    from api.routers import patterns as _patterns  # noqa: F401

    universe = _load_universe()
    if max_tickers:
        universe = universe[:max_tickers]
    print(f"Scanning {len(universe)} ticker(s) × {len(timeframes)} timeframe(s) = "
          f"{len(universe) * len(timeframes)} symbol-TFs")

    t0 = time.time()
    counts = {tf: 0 for tf in timeframes}
    per_pattern: dict[str, int] = {}
    fetch_misses = 0

    for sym in universe:
        for tf in timeframes:
            rows = bars_sqlite.get_bars(sym, tf, bars_per)
            if not rows:
                fetch_misses += 1
                continue
            bars = [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]}
                    for r in rows]
            ctx = build_context(bars, sym=sym)
            detections = detect_all(bars, ctx)
            counts[tf] += len(detections)
            for d in detections:
                pid = d.get("pattern_id", "?")
                per_pattern[pid] = per_pattern.get(pid, 0) + 1
                if not dry_run:
                    d["sym"] = sym
                    d["tf"] = tf
                    try:
                        memory.store_detection(d)
                    except Exception as e:
                        print(f"  store failed for {sym} {tf} {pid}: {e}")

    elapsed = time.time() - t0
    print(f"\nDone in {elapsed:.1f}s")
    print(f"Fetch misses (no bars): {fetch_misses}")
    print(f"Detections per timeframe:")
    for tf in timeframes:
        print(f"  {tf}: {counts[tf]}")
    print(f"Detections per pattern:")
    for pid, n in sorted(per_pattern.items(), key=lambda x: -x[1]):
        print(f"  {pid}: {n}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--tf", action="append", default=[], help="timeframe(s) to scan")
    parser.add_argument("--max", type=int, default=None, help="cap on tickers")
    parser.add_argument("--bars", type=int, default=200, help="bars per symbol-tf")
    parser.add_argument("--dry-run", action="store_true", help="don't store detections")
    args = parser.parse_args()
    tfs = args.tf if args.tf else ["D"]
    run(tfs, args.max, args.dry_run, args.bars)
