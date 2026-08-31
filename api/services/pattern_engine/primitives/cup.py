"""The cup-with-handle: geometry, with every published number kept separate
from every number of ours.

⭐ WHY THIS IS ITS OWN MODULE. `base_catalog` already carries the Darvas and
flat-base state machines inline, and it is long. The cup is the largest single
base geometry in the taxonomy -- two rims, a floor, a roundness test and a
handle with four rules of its own -- and it is the one a chart overlay will
want to draw. Keeping it beside `shape.py`, whose `roundness` / `rim_equality`
/ `symmetry` primitives were built for exactly this, puts the geometry in one
place and leaves the catalog to do provenance.

⛔ THE SEARCH PICKS A CUP BY QUALITY, NOT BY LENGTH. The flat base takes the
LONGEST qualifying window because a flat base is a duration ("at least five
weeks of this"). A cup is a SHAPE, and the longest window satisfying the depth
band is routinely a worse cup than a shorter one inside it. So candidates are
scored on roundness x rim equality and the best wins. That rule is ours;
nothing published says how to choose between overlapping candidate cups.
"""
from __future__ import annotations

from typing import List, Optional

from . import shape

# ── SOURCED (William J. O'Neil / IBD) ──────────────────────────────────────

#: "A proper cup base needs to span a minimum of seven weeks."
CUP_MIN_BARS = 35

#: "They range from seven weeks to as long as 65 weeks in length."
CUP_MAX_BARS = 325

#: "The size of the decline, or correction, in a cup base should generally be
#: between 12% and 33%."
CUP_MIN_DEPTH = 0.12
CUP_MAX_DEPTH = 0.33

#: "In bear markets, cups can run as deep as 50%." Recorded as a separate
#: allowance rather than folded into the normal band -- averaging the two
#: would invent a ceiling nobody published, and the allowance is CONDITIONAL
#: on a market regime this function is not given.
CUP_BEAR_MAX_DEPTH = 0.50

#: "depth of the handle should be 10%-12%" (IBD handout, provenance
#: unverified -> med confidence). The looser end is used, so the rule refuses
#: only handles that are clearly too deep.
HANDLE_MAX_DEPTH = 0.12

#: "Handle should form in the upper half of the cup, and within 15% of the old
#: price high" (med confidence, same handout).
HANDLE_WITHIN_OLD_HIGH = 0.15

#: "10 cents above the peak in the handle."
PIVOT_PAD = 0.10

# ── OURS ───────────────────────────────────────────────────────────────────

#: Ours. IBD publishes NO minimum handle length. Bulkowski publishes "1 week
#: minimum with no maximum" -- for HIS pattern, not IBD's, and importing it
#: would attribute a number to a house that never said it. The corpus flags
#: this refusal explicitly, so the bounds here are labelled ours and the
#: catalog records the refusal beside them.
HANDLE_MIN_BARS = 5
HANDLE_MAX_BARS = 25
HANDLE_STEP = 5

#: Ours. How many bars at each end define a rim. A single bar is too noisy to
#: stand for "the old high"; a fifth of the cup drifts with cup length.
RIM_BARS = 10

#: Ours, and the corpus is explicit that no rim tolerance is published:
#: O'Neil says the right side returns "near" the old high and never says how
#: near. `rim_equality` decays ~10% per 10% of divergence, so 0.75 admits rims
#: within roughly 3%.
MIN_RIM_EQUALITY = 0.75

#: Ours, and MEASURED rather than chosen. O'Neil's rule is qualitative -- a cup
#: is "U-shaped", and the V is the named failure -- so the threshold has to sit
#: between those two shapes. Scored over 60-bar synthetic cups, `roundness` is
#: depth-invariant (as a shape measure should be) and lands at:
#:
#:      linear V     0.000        cosine cup   0.208        semicircle   1.000
#:
#: at every one of 12%, 20%, 33% and 45% depth. The first version of this
#: constant was 0.30, picked by eye, which refused EVERY realistic cup -- a
#: 45%-deep cosine came in at 0.275 and was rejected as insufficiently round.
#: 0.10 is the midpoint between the named failure and the softest shape a real
#: cup takes, so it refuses what O'Neil refuses and nothing else.
MIN_ROUNDNESS = 0.10

#: Ours. Step of the cup-start search, in bars.
CUP_SEARCH_STEP = 5

#: SOURCED at med confidence: "Prior uptrend of at least 30%" / "first leg
#: should be up at least 30%". ⛔ WITHOUT THIS THE DETECTOR IS NOT MEASURING
#: THE PUBLISHED PATTERN. A cup is a REST IN AN ADVANCE; the same geometry
#: with no prior advance is a stock that fell and recovered, which is
#: mean-reversion and a different animal entirely. Leaving it out does not
#: make the rule looser, it makes it a DIFFERENT rule -- and then measuring
#: that rule and reporting the number against O'Neil's name would be a
#: straightforward misattribution.
CUP_PRIOR_UPTREND = 0.30

#: Ours: how far back the prior advance is sought.
CUP_UPTREND_LOOKBACK = 120


def _prior_uptrend(bars: List[dict], cup_start: int,
                   look: int = CUP_UPTREND_LOOKBACK) -> Optional[float]:
    """Gain from the pre-cup trough into the cup's left rim, or None."""
    pre = bars[max(0, cup_start - look):cup_start]
    if len(pre) < 20:
        return None
    lows = [b.get("l") or 0.0 for b in pre if (b.get("l") or 0) > 0]
    entry = bars[cup_start].get("c") or 0.0
    if not lows or entry <= 0:
        return None
    lo = min(lows)
    return ((entry - lo) / lo) if lo > 0 else None


def _volume_eases(bars: List[dict], cup_start: int, cup_end: int) -> bool:
    """Does turnover fall into the handle relative to the cup?

    SOURCED, high confidence: "Volume should mostly ease until the breakout"
    and "Turnover fell sharply as it shaped a handle." The house gives a
    DIRECTION and no ratio, so this tests the direction and nothing more --
    inventing a percentage would put a number in its mouth.
    """
    cup_v = [b.get("v") or 0 for b in bars[cup_start:cup_end]]
    handle_v = [b.get("v") or 0 for b in bars[cup_end:]]
    if not cup_v or not handle_v:
        return False
    cup_mean = sum(cup_v) / len(cup_v)
    handle_mean = sum(handle_v) / len(handle_v)
    if cup_mean <= 0:
        return False
    return handle_mean < cup_mean


def _rolling_max_high(bars: List[dict], width: int) -> List[float]:
    """`out[i]` = max high over `bars[i:i+width]`."""
    n = len(bars)
    out = [0.0] * n
    for i in range(n):
        w = [bars[j].get("h") or 0.0 for j in range(i, min(n, i + width))]
        out[i] = max(w) if w else 0.0
    return out


def _drifts_down(bars: List[dict]) -> bool:
    """Does a least-squares fit through the LOWS slope downward?

    ⛔ THROUGH THE LOWS, NOT THE CLOSES. O'Neil's rule is specific: a proper
    handle "drifts slightly downward along its price lows", and an upward
    drift is named as a defect. A handle can close flat or even slightly up
    while its lows step down, which is the shakeout the rule describes.
    """
    lows = [b.get("l") or 0.0 for b in bars]
    n = len(lows)
    if n < 3:
        return False
    mx = (n - 1) / 2.0
    my = sum(lows) / n
    den = sum((i - mx) ** 2 for i in range(n))
    if den <= 0:
        return False
    slope = sum((i - mx) * (lows[i] - my) for i in range(n)) / den
    return slope < 0


def cup_with_handle_state(bars: List[dict],
                          max_depth: float = CUP_MAX_DEPTH) -> Optional[dict]:
    """The best cup-with-handle ending at the last bar, or None.

    `max_depth` defaults to the normal 33% band. A caller that KNOWS it is in
    a bear market may pass `CUP_BEAR_MAX_DEPTH`; this function will not guess
    the regime, because the deeper allowance is conditional on one and a
    detector that silently applies it would be measuring a different rule.
    """
    n = len(bars)
    if n < CUP_MIN_BARS + HANDLE_MIN_BARS:
        return None

    head_max = _rolling_max_high(bars, RIM_BARS)
    best = None

    for h in range(HANDLE_MIN_BARS, HANDLE_MAX_BARS + 1, HANDLE_STEP):
        cup_end = n - h                      # exclusive
        if cup_end < CUP_MIN_BARS:
            continue
        handle = bars[cup_end:]
        handle_highs = [b.get("h") or 0.0 for b in handle]
        handle_lows = [b.get("l") or 0.0 for b in handle]
        if not handle_highs or min(handle_lows) <= 0:
            continue
        handle_high = max(handle_highs)
        handle_low = min(handle_lows)
        if handle_high <= 0:
            continue
        handle_depth = (handle_high - handle_low) / handle_high
        if handle_depth > HANDLE_MAX_DEPTH:
            continue
        if not _drifts_down(handle):
            continue

        # The right rim is fixed once the handle length is: it is the last
        # RIM_BARS of the cup, immediately before the handle begins.
        right_rim = max((b.get("h") or 0.0)
                        for b in bars[max(0, cup_end - RIM_BARS):cup_end])
        if right_rim <= 0:
            continue

        low = float("inf")
        for start in range(cup_end - 1, -1, -1):
            l = bars[start].get("l") or 0.0
            if l <= 0:
                break
            low = min(low, l)
            length = cup_end - start
            if length < CUP_MIN_BARS:
                continue
            if length > CUP_MAX_BARS:
                break
            if (cup_end - start) % CUP_SEARCH_STEP:
                continue

            left_rim = head_max[start]
            if left_rim <= 0 or low >= left_rim:
                continue
            depth = (left_rim - low) / left_rim
            if depth < CUP_MIN_DEPTH:
                continue
            if depth > max_depth:
                break        # deeper starts only go deeper

            eq = shape.rim_equality(left_rim, right_rim)
            if eq is None or eq < MIN_RIM_EQUALITY:
                continue

            # Handle in the UPPER HALF of the base, measured on the cup's own
            # span, and within 15% of the old high.
            midpoint = low + 0.5 * (left_rim - low)
            if handle_low < midpoint:
                continue
            if handle_high < (1.0 - HANDLE_WITHIN_OLD_HIGH) * left_rim:
                continue

            r = shape.roundness(bars, start, cup_end - 1)
            if r is None or r < MIN_ROUNDNESS:
                continue

            adv = _prior_uptrend(bars, start)
            if (adv or 0.0) < CUP_PRIOR_UPTREND:
                continue
            if not _volume_eases(bars, start, cup_end):
                continue

            score = r * eq
            if best is None or score > best["score"]:
                low_idx = min(range(start, cup_end),
                              key=lambda i: bars[i].get("l") or float("inf"))
                best = {
                    "score": score, "roundness": r, "rim_equality": eq,
                    "cup_start": start, "cup_end": cup_end,
                    "cup_bars": length, "depth": depth,
                    "left_rim": left_rim, "right_rim": right_rim, "low": low,
                    "symmetry": shape.symmetry(bars, start, low_idx,
                                               cup_end - 1),
                    "prior_uptrend": adv,
                    "handle_bars": h, "handle_high": handle_high,
                    "handle_low": handle_low, "handle_depth": handle_depth,
                    "pivot": handle_high + PIVOT_PAD,
                }
    return best
