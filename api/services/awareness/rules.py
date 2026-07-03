"""Pure watch-rule functions for the Awareness Engine (Milestone 1).

Every rule has the same shape: (scan_ctx, user_ctx) -> list[InsightCandidate].
scan_ctx is the ONE shared market-wide computation for this cycle (live
prices, regime, earnings window) built once by engine.py. user_ctx is that
one user's bulk-loaded positions + watchlist symbols. Rules never touch the
database or the network — engine.py owns all I/O.

The relevance score is deterministic and pure:
    importance = clamp(round(base_signal * personal_multiplier * urgency * 10), 1, 10)

  - base_signal (0.0-1.0): raw strength of the trigger itself (e.g. 1.0 for
    a stop that's been hit, 0.4-0.7 for "nearing" it).
  - personal_multiplier (~0.5-1.6): how much this matters to THIS user
    (owns it vs. just watches it).
  - urgency (~1.0-2.0): how time-sensitive it is (today vs. a few days out).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class InsightCandidate:
    kind: str
    symbol: str | None
    headline: str
    body: str | None
    base_signal: float
    personal_multiplier: float
    urgency: float
    # Passed as `symbol=` to add_insight() for its per-symbol cooldown scope.
    # May be a composite key (e.g. "NVDA:earnings") so different rule kinds
    # on the same ticker don't share a cooldown window.
    dedup_key: str | None


def compute_relevance_score(
    base_signal: float, personal_multiplier: float = 1.0, urgency: float = 1.0,
) -> int:
    """The deterministic relevance-score formula. Pure; clamped to 1-10 so
    it's always a valid add_insight() importance value."""
    raw = float(base_signal) * float(personal_multiplier) * float(urgency) * 10.0
    return max(1, min(10, round(raw)))
