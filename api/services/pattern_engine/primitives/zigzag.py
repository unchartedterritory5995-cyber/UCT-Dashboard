"""Volatility-scaled swing segmentation — the causal, non-repainting one.

⭐ WHY NOT `detect_pivots`. That primitive uses a fixed +/-N-BAR fractal
window, but the question a base asks is in PRICE, not in bars: the same
5-bar window that finds real swings on a 2%-ADR name emits pure noise on a
0.4%-ADR one. Osler's method scales the reversal threshold to each
security's own return volatility, which the academic corpus
(`docs/superpowers/research/bases/12-academic-algorithmic-detection.md`)
identifies as the best-argued answer to threshold selection. `detect_pivots`
is untouched and keeps its existing callers.

⛔⛔ SIGMA IS A TRAILING WINDOW, AND THAT IS THE WHOLE NON-REPAINTING
PROPERTY. Computing sigma over the entire series is the obvious
implementation and it silently repaints: every new bar changes sigma, which
changes the threshold at EVERY historical bar, which can retroactively
confirm or un-confirm pivots years old. A member who screened yesterday and
re-screens today would get a different history with no code change. The
trailing window makes the threshold at bar `i` a function only of bars
<= `i`, so a confirmed pivot is permanent.
`test_confirmed_pivots_are_prefix_stable_as_bars_arrive` is the rail, and it
has been demonstrated to FAIL against a whole-series-sigma implementation.

⚠️ THE TRAILING SWING IS ALWAYS PROVISIONAL. A swing is only knowable once
price has reversed away from it by the threshold; until then the running
extreme may still extend. Publishing it as confirmed is exactly the
repainting that six of ten charting vendors do not disclose
(`13-vendor-detection-implementations.md`). Callers must branch on
`provisional`, and a detector must never place an entry or stop on a
provisional swing.

`k` is `origin: uct`, and it is MEASURED, not asserted. Osler swept ten
cutoffs and published no single preferred value, so the number is ours --
which means we owe it a measurement rather than a plausible sentence.

⭐ SWEPT 2026-08-30 over 828 real tickers x 400 daily bars, counting
confirmed swings per ticker:

      k     median swings   bars per swing
    3.0          49              8.2
    5.0          16             25.0     <- DEFAULT
    8.0           6             66.7
   12.0           3            133.3
   16.0           1            400.0

A base is a MULTI-WEEK structure -- O'Neil publishes 4-12 weeks, Minervini
similar -- so a swing every ~25 sessions is the scale this segmenter exists
to find. k=3.0 gives a swing every 8 sessions: that is short-swing noise,
and a base detector built on it would be naming wiggles.

⛔ This docstring previously said 3.0 "is the smallest integer multiple of
daily sigma that suppresses the noise swings in a 3,700-name universe". That
sentence was written before anything was measured and it was simply false --
an acceptance number is a forecast until it is derived. Use k=8.0 when you
want only major structure; raise it per-detector, never here.
"""
from __future__ import annotations

import math
from typing import List, Literal, Optional, TypedDict

from api.services.pattern_engine.types import Bar

DEFAULT_K = 5.0        # origin: uct, MEASURED — see the sweep in the module docstring
SIGMA_WINDOW = 60      # trailing bars used to estimate daily sigma
MIN_SIGMA_BARS = 30    # below this we refuse rather than estimate
DEDUP_BARS = 2         # Osler's explicit +/-2-day de-duplication

#: ⛔ A ZERO VOLATILITY ESTIMATE IS A REFUSAL, NOT A SMALL NUMBER. On a series
#: of constant returns the sample variance is zero in exact arithmetic and
#: ~1e-34 in floating point, so `sigma > 0` is TRUE and the threshold comes out
#: around 1e-17 — at which point any bar's own high-low spread satisfies
#: "price reversed by more than the threshold" and every bar confirms a swing.
#: Measured while building this: a smooth 1%/bar rise produced 90 confirmed
#: pivots, all of them artifacts of float residue. Below this floor we cannot
#: scale anything and say so by declining to confirm.
#: origin: uct — no source publishes a minimum daily sigma; 1e-6 is ~0.0001%
#: daily, orders of magnitude below any real security.
MIN_SIGMA = 1e-6


class Swing(TypedDict):
    t: int
    price: float
    type: Literal["high", "low"]
    bar_index: int
    provisional: bool


def _trailing_sigma(bars: List[Bar], i: int, window: int) -> float:
    """Stdev of log returns over the `window` bars ending at `i`.

    Causal by construction: reads no bar after `i`. `window` is a parameter,
    never a module global read at call time — threading it through is what
    keeps `segment` re-entrant and free of the shared-state bug a global
    would introduce under concurrent builds.
    """
    lo = max(1, i - window + 1)
    rets = []
    for j in range(lo, i + 1):
        p0, p1 = bars[j - 1]["c"], bars[j]["c"]
        if p0 > 0 and p1 > 0:
            rets.append(math.log(p1 / p0))
    if len(rets) < MIN_SIGMA_BARS:
        return 0.0
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
    return math.sqrt(var)


def _usable(bar: Bar) -> bool:
    """A bar that never traded cannot extend or confirm a swing.

    Same refusal the candle library applies: a zero-range, zero-price bar is
    an absence of data, and building a structure on it fabricates one (the
    island-reversal defect, 2026-08-24).
    """
    return bar["h"] > 0 and bar["l"] > 0 and bar["h"] >= bar["l"]


def _dedup(swings: List[Swing]) -> List[Swing]:
    """Collapse adjacent same-type swings within DEDUP_BARS, keeping the
    more extreme. Alternation is guaranteed by the walk below, so this only
    fires on the degenerate case where two extremes land within the window.
    """
    out: List[Swing] = []
    for s in swings:
        if out and out[-1]["type"] == s["type"] \
                and s["bar_index"] - out[-1]["bar_index"] <= DEDUP_BARS:
            better = (s["price"] > out[-1]["price"]) if s["type"] == "high" \
                else (s["price"] < out[-1]["price"])
            if better:
                out[-1] = s
            continue
        out.append(s)
    return out


def segment(bars: List[Bar], k: float = DEFAULT_K,
            sigma_window: int = SIGMA_WINDOW) -> List[Swing]:
    """Segment `bars` into alternating swing highs and lows.

    Returns confirmed swings in bar order, followed by exactly one
    `provisional` swing (the running extreme) when there is one. An empty
    list means we refuse: too little history to estimate sigma.
    """
    n = len(bars)
    if n < MIN_SIGMA_BARS + 2:
        return []
    return _walk(bars, k, sigma_window, n)


def _walk(bars: List[Bar], k: float, window: int, n: int) -> List[Swing]:
    start: Optional[int] = None
    for i in range(n):
        if _usable(bars[i]):
            start = i
            break
    if start is None:
        return []

    direction: Optional[str] = None
    hi_i, hi = start, bars[start]["h"]
    lo_i, lo = start, bars[start]["l"]
    confirmed: List[Swing] = []

    def _mk(idx: int, price: float, kind: str, prov: bool) -> Swing:
        return {"t": bars[idx]["t"], "price": price, "type": kind,
                "bar_index": idx, "provisional": prov}

    for i in range(start + 1, n):
        bar = bars[i]
        if not _usable(bar):
            continue
        h, l = bar["h"], bar["l"]

        # ⛔ TRACK THE RUNNING EXTREME BEFORE THE THRESHOLD GATE. Extreme
        # tracking is pure bookkeeping and does not depend on sigma; skipping
        # it whenever sigma is unusable leaves `hi`/`lo` stranded on the seed
        # bar, and the first confirmation after sigma recovers then names the
        # WRONG bar as the swing. Measured while building this: an 80-bar rise
        # into a hard reversal reported its swing high at bar 30 instead of the
        # actual peak at bar 79.
        if direction != "down" and h > hi:
            hi, hi_i = h, i
        if direction != "up" and l < lo:
            lo, lo_i = l, i

        sigma = _trailing_sigma(bars, i, window)
        if sigma < MIN_SIGMA:
            continue
        thr = k * sigma

        if direction != "down" and hi > 0 and (hi - l) / hi >= thr:
            confirmed.append(_mk(hi_i, hi, "high", False))
            direction = "down"
            lo, lo_i = l, i
            continue
        if direction != "up" and lo > 0 and (h - lo) / lo >= thr:
            confirmed.append(_mk(lo_i, lo, "low", False))
            direction = "up"
            hi, hi_i = h, i

    out = _dedup(confirmed)
    # Exactly one trailing provisional swing: the extreme we are still
    # tracking. `direction is None` means price never moved k*sigma in
    # either direction, so there is nothing to report — not even a guess.
    if direction == "down":
        out.append(_mk(lo_i, lo, "low", True))
    elif direction == "up":
        out.append(_mk(hi_i, hi, "high", True))
    return out
