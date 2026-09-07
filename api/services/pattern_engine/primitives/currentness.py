"""Shared post-trigger currentness check for single/two-bar reversal candlestick patterns.

Several candlestick reversal detectors (shooting_star, hanging_man,
bearish_engulfing -- and, by the same architecture, their bullish mirrors)
share one documented lifecycle: each detector's own docstring and narrative
text specify an explicit CONFIRMATION condition (price closes through the
trigger bar's low/high in the pattern's direction on a later bar) and an
explicit INVALIDATION condition (price closes back through the trigger's
high/low against the pattern's direction) -- but the code that emits these
detections never inspected the bars AFTER the trigger to check whether
either documented condition had already fired. A trigger sitting anywhere
inside a bounded backward search window could be presented as a fresh,
forward-looking alert long after its own documented lifecycle had already
resolved one way or the other (already invalidated, or already confirmed
and fully played out several bars ago).

This is a currentness check only -- it does not touch geometry, scoring,
volume, or context. It reuses conditions each detector already computes and
documents in its own narrative (the entry/invalidation price levels); it
does not invent new pattern semantics.
"""
from __future__ import annotations

from typing import List, Optional

from api.services.pattern_engine.types import Bar

# Confirmation may have happened up to this many bars ago and the trigger is
# still considered "current" -- a reversal candle may remain relevant through
# one confirming bar (the setup just resolved, still fresh news). Beyond that,
# the setup has fully played out and is no longer a forward-looking alert.
_MAX_BARS_SINCE_CONFIRM = 1


def reversal_trigger_still_current(
    bars: List[Bar],
    trigger_idx: int,
    invalidation_level: float,
    confirmation_level: float,
    direction: str,
) -> bool:
    """Is a single/two-bar reversal trigger at `trigger_idx` still current?

    `direction` is "bearish" (invalidation = a later bar closing ABOVE
    `invalidation_level`; confirmation = a later bar closing BELOW
    `confirmation_level`) or "bullish" (mirrored).

    Returns False if a later bar has already invalidated the trigger, or if
    confirmation already happened more than `_MAX_BARS_SINCE_CONFIRM` bars
    ago (the setup has fully resolved and is no longer a fresh alert).
    Returns True if the trigger bar IS the most recent bar (nothing has
    happened yet to confirm or invalidate it), or if confirmation happened
    within the allowed recency window and no invalidation has occurred.
    """
    n = len(bars)
    if trigger_idx >= n - 1:
        return True  # trigger bar is the current bar -- nothing has happened yet

    bearish = direction == "bearish"
    confirm_idx: Optional[int] = None
    for j in range(trigger_idx + 1, n):
        c = bars[j]["c"]
        invalidated = (c > invalidation_level) if bearish else (c < invalidation_level)
        if invalidated:
            return False
        if confirm_idx is None:
            confirmed = (c < confirmation_level) if bearish else (c > confirmation_level)
            if confirmed:
                confirm_idx = j

    if confirm_idx is None:
        return True  # still dormant -- neither confirmed nor invalidated yet

    bars_since_confirm = (n - 1) - confirm_idx
    return bars_since_confirm <= _MAX_BARS_SINCE_CONFIRM
