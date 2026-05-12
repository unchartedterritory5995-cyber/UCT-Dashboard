"""Performance bench: time detect_all on synthetic 200/500/1000 bar series.

Reports p50/p95/p99 latency per size. Phase 0 target is <100ms p99 for 500 bars.
"""
from __future__ import annotations

import random
import time
from statistics import median


def _make_bars(n: int, seed: int = 42) -> list[dict]:
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    price = 100.0
    for _ in range(n):
        price = max(0.01, price + rng.gauss(0, 0.6))
        h = price + abs(rng.uniform(0, 0.3))
        l = price - abs(rng.uniform(0, 0.3))
        bars.append({"t": t, "o": price - 0.1, "h": h, "l": l, "c": price, "v": 1000.0})
        t += 86400
    return bars


def run() -> dict:
    from api.routers import patterns as _patterns  # noqa: F401
    from api.services.pattern_engine import detect_all
    from api.services.pattern_engine.primitives.context import build_context

    sizes = [200, 500, 1000]
    iters_per_size = 20
    rows = []

    for size in sizes:
        timings = []
        bars = _make_bars(size, seed=size)
        ctx = build_context(bars, sym="BENCH")
        for i in range(iters_per_size):
            t0 = time.perf_counter()
            detect_all(bars, ctx)
            timings.append((time.perf_counter() - t0) * 1000)
        timings.sort()
        p50 = round(median(timings), 2)
        p95 = round(timings[int(len(timings) * 0.95)], 2)
        p99 = round(timings[-1], 2)
        rows.append((size, p50, p95, p99))

    lines = ["| bar count | p50 (ms) | p95 (ms) | p99 (ms) | target | result |",
             "|---|---|---|---|---|---|"]
    fails = 0
    for size, p50, p95, p99 in rows:
        target_actual = 100.0 if size <= 500 else 200.0
        ok = p99 < target_actual
        if not ok:
            fails += 1
        lines.append(f"| {size} | {p50} | {p95} | {p99} | <{target_actual}ms p99 | {'✅' if ok else '❌'} |")

    status = "PASS" if fails == 0 else "WARN"
    summary = (f"p99 latency across {sizes}: " +
               ", ".join([f"{p99}ms" for _, _, _, p99 in rows]))
    return {"status": status, "summary": summary, "details": "\n".join(lines)}
