"""End-to-end smoke test for the pattern engine.

Loads real bars for a symbol from the local bars_sqlite store, runs the
bull_flag detector, prints any detections + their confidence + levels.

Usage: python scripts/smoke_pattern_engine.py AAPL D
"""
import sys

from api.services import bars_sqlite
from api.services.pattern_engine import detect_one
from api.services.pattern_engine.primitives.context import build_context
from api.services.pattern_engine import memory
from api.services.auth_db import init_db


def main(sym: str = "AAPL", tf: str = "D", bars_count: int = 200):
    init_db()
    rows = bars_sqlite.get_bars(sym.upper(), tf, bars_count)
    if not rows:
        print(f"No bars for {sym} {tf} in local SQLite store. Try a Railway deployment.")
        sys.exit(1)
    bars = [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in rows]
    print(f"Loaded {len(bars)} bars for {sym} {tf}")

    ctx = build_context(bars, sym=sym)
    print(f"Context: {ctx}")

    detections = detect_one(bars, ctx, pattern_id="bull_flag")
    print(f"\nDetected {len(detections)} bull_flag(s):")
    for d in detections:
        d["sym"] = sym.upper()
        d["tf"] = tf
        print(f"  - confidence {d['confidence']:.1f}, entry {d['levels']['entry']:.2f}, "
              f"stop {d['levels']['stop']:.2f}, target {d['levels']['target_primary']:.2f}, "
              f"R:R {d['levels']['risk_reward']:.2f}")
        print(f"    {d['narrative']['headline']}")
        memory.store_detection(d)
        print(f"    [stored as {d['id']}]")

    print("\nDone.")


if __name__ == "__main__":
    sym = sys.argv[1] if len(sys.argv) > 1 else "AAPL"
    tf = sys.argv[2] if len(sys.argv) > 2 else "D"
    main(sym, tf)
