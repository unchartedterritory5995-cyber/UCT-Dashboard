"""DCR (Daily Closing Range) primitives.

DCR measures where a bar's close sits within its high-low range:
  DCR = (close - low) / (high - low)

Range: [0.0, 1.0] where 1.0 = closed at session high (max bullish session),
0.0 = closed at session low (max bearish), 0.5 = mid range (neutral).

Bonde / Stockbee uses DCR as a primary bar-quality filter:
  - DCR >= 0.70 = strong close (institutional buyers held into the bell)
  - DCR <= 0.30 = weak close (sellers controlled into the bell)
  - 0.30-0.70 = indecision

At trend scale, avg DCR over recent bars reveals accumulation vs distribution:
  - avg_dcr >= 0.60 over N bars in a base = accumulation (bullish bias)
  - avg_dcr <= 0.40 = distribution (bearish bias)
  - 0.40-0.60 = neutral / mixed
"""
from __future__ import annotations

from typing import List, Literal

from api.services.pattern_engine.types import Bar


DcrSignature = Literal["accumulation", "distribution", "neutral"]


def compute_dcr(bar: Bar) -> float:
    """Compute DCR for a single bar. Returns 0.5 for zero-range bars (no movement)."""
    rng = bar["h"] - bar["l"]
    if rng <= 0:
        return 0.5
    return (bar["c"] - bar["l"]) / rng


def avg_dcr(bars: List[Bar], lookback: int = 10) -> float:
    """Average DCR over the last `lookback` bars. Returns 0.5 if too short."""
    if not bars:
        return 0.5
    window = bars[-lookback:] if len(bars) >= lookback else bars
    if not window:
        return 0.5
    return sum(compute_dcr(b) for b in window) / len(window)


def dcr_signature(bars: List[Bar], lookback: int = 10) -> DcrSignature:
    """Classify recent DCR trend: accumulation / distribution / neutral.

      avg_dcr >= 0.60 → "accumulation"
      avg_dcr <= 0.40 → "distribution"
      else            → "neutral"
    """
    avg = avg_dcr(bars, lookback)
    if avg >= 0.60:
        return "accumulation"
    if avg <= 0.40:
        return "distribution"
    return "neutral"


def dcr_strength(dcr: float) -> Literal["strong", "weak", "neutral"]:
    """Per-bar strength classifier.

      dcr >= 0.70 → "strong"
      dcr <= 0.30 → "weak"
      else        → "neutral"
    """
    if dcr >= 0.70:
        return "strong"
    if dcr <= 0.30:
        return "weak"
    return "neutral"
