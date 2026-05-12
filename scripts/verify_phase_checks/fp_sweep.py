"""Light false-positive sweep: run all detectors on synthetic random walks and
monotonic trends, report detections per 1000 bars per detector.

Any detector that fires more than ~2× the median rate is flagged as potentially
over-eager.
"""
from __future__ import annotations

import random
from statistics import median

from api.services.pattern_engine.primitives.context import build_context


def _random_walk(n: int, seed: int, drift: float = 0.0, start: float = 100.0,
                 sigma: float = 1.0) -> list[dict]:
    rng = random.Random(seed)
    bars = []
    price = start
    t = 1700000000
    for _ in range(n):
        d = rng.gauss(drift, sigma)
        new_price = max(0.01, price + d)
        h = max(price, new_price) + abs(rng.uniform(0, 0.3))
        l = min(price, new_price) - abs(rng.uniform(0, 0.3))
        bars.append({"t": t, "o": round(price, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(new_price, 2), "v": 1000.0})
        price = new_price
        t += 86400
    return bars


def _monotonic_trend(n: int, slope: float, start: float = 100.0) -> list[dict]:
    bars = []
    t = 1700000000
    for i in range(n):
        c = start + slope * i
        bars.append({"t": t, "o": c - 0.1, "h": c + 0.2, "l": c - 0.2,
                     "c": c, "v": 1000.0})
        t += 86400
    return bars


def run() -> dict:
    from api.routers import patterns as _patterns  # noqa: F401
    from api.services.pattern_engine.detectors.registry import list_pattern_ids, get_detector

    pids = list_pattern_ids()
    if not pids:
        return {"status": "WARN", "summary": "no detectors registered", "details": ""}

    series = []
    for seed in range(1, 6):
        series.append(("random_walk", _random_walk(200, seed=seed)))
    series.append(("uptrend_steep", _monotonic_trend(200, 0.5)))
    series.append(("uptrend_gentle", _monotonic_trend(200, 0.15)))
    series.append(("flat", _monotonic_trend(200, 0.0)))
    series.append(("downtrend_gentle", _monotonic_trend(200, -0.15)))
    series.append(("downtrend_steep", _monotonic_trend(200, -0.5)))

    total_bars = sum(len(s[1]) for s in series)
    per_pid_counts: dict[str, int] = {pid: 0 for pid in pids}

    for label, bars in series:
        ctx = build_context(bars, sym="SYN")
        for pid in pids:
            try:
                detections = get_detector(pid)(bars, ctx)
            except Exception:
                continue
            per_pid_counts[pid] += len(detections)

    rates = {pid: round(count / total_bars * 1000, 2) for pid, count in per_pid_counts.items()}
    median_rate = median(rates.values()) if rates else 0.0

    lines = ["| pattern | detections | rate (per 1000 bars) | flag |", "|---|---|---|---|"]
    flagged = 0
    for pid in sorted(pids):
        rate = rates[pid]
        flag = ""
        if median_rate > 0 and rate > median_rate * 2:
            flag = "⚠ over-eager"
            flagged += 1
        elif rate > 10:
            flag = "⚠ high"
            flagged += 1
        lines.append(f"| `{pid}` | {per_pid_counts[pid]} | {rate} | {flag} |")

    status = "PASS" if flagged == 0 else "WARN"
    summary = f"sweep across {total_bars} synthetic bars; median rate {median_rate:.2f}/1k; {flagged} flagged"
    return {"status": status, "summary": summary, "details": "\n".join(lines)}
