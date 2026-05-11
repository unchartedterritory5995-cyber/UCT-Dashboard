"""Fractal swing-pivot detection.

A bar is a "swing high" pivot if its high strictly exceeds both neighbors'
highs over a window of ±N bars on each side. A "swing low" is symmetric on
lows.

The first and last `window` bars of the series cannot be pivots (insufficient
neighbors). Strength is a 0-100 score: higher means the pivot dominates a
wider window AND by a larger margin.
"""
from __future__ import annotations

from typing import List

from api.services.pattern_engine.types import Bar, Pivot


def detect_pivots(bars: List[Bar], window: int = 5) -> List[Pivot]:
    """Detect swing highs and lows using the fractal method.

    Args:
      bars: OHLCV list, sorted by t ascending.
      window: number of bars on each side to compare against (typical: 3-9).

    Returns:
      List of Pivot dicts sorted by bar_index ascending.
    """
    if window <= 0:
        raise ValueError("window must be positive")
    n = len(bars)
    if n < 2 * window + 1:
        return []

    pivots: List[Pivot] = []

    for i in range(window, n - window):
        bar = bars[i]
        left  = bars[i - window:i]
        right = bars[i + 1:i + 1 + window]
        ctx   = left + right

        # Swing high: strictly greater than all neighbors' highs.
        if all(bar["h"] > b["h"] for b in ctx):
            max_neighbor = max(b["h"] for b in ctx)
            margin = (bar["h"] - max_neighbor) / max_neighbor if max_neighbor > 0 else 0
            # strength scales with margin (capped) and window size.
            strength = min(100, int(50 + margin * 1000 + window * 2))
            pivots.append({
                "t": bar["t"],
                "price": bar["h"],
                "type": "high",
                "strength": strength,
                "bar_index": i,
            })
            continue

        # Swing low: strictly less than all neighbors' lows.
        if all(bar["l"] < b["l"] for b in ctx):
            min_neighbor = min(b["l"] for b in ctx)
            margin = (min_neighbor - bar["l"]) / min_neighbor if min_neighbor > 0 else 0
            strength = min(100, int(50 + margin * 1000 + window * 2))
            pivots.append({
                "t": bar["t"],
                "price": bar["l"],
                "type": "low",
                "strength": strength,
                "bar_index": i,
            })

    return pivots
