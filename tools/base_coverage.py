"""Report a structure predicate's hit-rate across the real universe.

⭐ WHY THIS IS A RAIL AND NOT A NICETY. Two measured failures motivate it,
both found long after shipping:
  - `cup_handle_uct` gates on six conditions simultaneously and fires on
    **2 of 2,890 symbols** — shipped, tested, green, and effectively dead.
  - `Compression Bar (NR4)` fired on **1,304 of 3,707 (35%)**. A label a
    third of the market carries is not information; it was deleted.
Neither is a correctness bug, so no unit test could have caught either. Only
running the predicate over the real universe shows it.

⛔ THE VERDICT IS ADVISORY, NOT A GATE. A genuinely rare structure (high
tight flag: 8 symbols) is legitimately "thin" and should still ship. The
point is that the number appears in the author's face and lands in the
catalog entry, so a surprising one is a decision rather than an accident.
"""
from __future__ import annotations

from typing import Callable, Dict, List, Literal, TypedDict

DEAD_PCT = 0.0
THIN_PCT = 0.5      # origin: uct — below this, expect to justify the rarity
NOISE_PCT = 35.0    # origin: uct — the measured NR4 deletion threshold


class CoverageReport(TypedDict):
    hits: int
    total: int
    pct: float
    errors: int
    verdict: Literal["dead", "thin", "ok", "noise"]


def classify(pct: float) -> str:
    if pct <= DEAD_PCT:
        return "dead"
    if pct < THIN_PCT:
        return "thin"
    if pct > NOISE_PCT:
        return "noise"
    return "ok"


def coverage(predicate: Callable[[List[dict]], bool],
             bars_by_ticker: Dict[str, List[dict]]) -> CoverageReport:
    """Run `predicate` over every ticker's bars and report the hit-rate.

    ⛔ A predicate that RAISES counts as a miss and is tallied separately in
    `errors`. A structure that crashes on real data and one that simply never
    matches both produce zero hits, and they are completely different facts —
    the first is a bug, the second is a design choice. Only `errors`
    separates them, so it is part of the report, not a log line.
    """
    hits = errors = 0
    total = len(bars_by_ticker)
    for bars in bars_by_ticker.values():
        try:
            if predicate(bars):
                hits += 1
        except Exception:
            errors += 1
    pct = (100.0 * hits / total) if total else 0.0
    return {"hits": hits, "total": total, "pct": pct,
            "errors": errors, "verdict": classify(pct)}
