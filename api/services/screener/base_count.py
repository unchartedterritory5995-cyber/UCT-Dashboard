"""IBD base counting — the stage number, and everything about it we cannot compute.

⭐ WHAT IS SOURCED, AND IT IS ONE RULE. William J. O'Neil via IBD, quoted
directly: *"A breakout needs to produce a gain of at least 20% in order to be
counted as one stage."* And the merge rule, same source: *"If the gain is less
than 20% and the stock forms another base, it's a base-on-base pattern and
counted as one stage."* The IBD-derived handout states the positive form as
*"Each base should form at least 20% above the buy point of the base that
preceded it."* Those agree on the number and are the whole computable core.

⛔⛔ THE 20% IS MEASURED FROM THE PIVOT, NOT THE BASE LOW, and the research file
says why in one sentence: measuring from the low *"inflates every advance and
will systematically over-count stages, pushing first-stage bases into
third-stage grades and suppressing exactly the setups IBD wants bought."* That
is the single easiest way to get this wrong and it fails in the direction that
hides good setups.

⛔ TWO INPUTS ARE NOT COMPUTABLE FROM BARS AND ARE REFUSED RATHER THAN GUESSED:

  1. THE FUNDAMENTAL GATE. The handout: *"Don't count bases until quarterly
     earnings and sales start growing by at least 25%."* If that is IBD's rule,
     base counting is not a chart operation at all, and a purely OHLCV counter
     is computing A DIFFERENT QUANTITY than IBD's. This module computes the
     chart quantity and says so; it does not claim to be IBD's stage.
  2. THE RESET. IBD publishes that bear markets zero the count — *"Bear markets
     reset the base count back to zero"* — but the research reached NO verbatim
     definition of the decline that triggers it. `RESET_DRAWDOWN_PCT` below is
     therefore OURS, swept rather than chosen, and stamped `origin: uct`.

⛔⛔ AND THERE IS NO DEGRADATION CURVE TO APPLY. This is the central negative
finding of the source section: across every IBD source reached, **IBD publishes
no win rate, no average gain, no failure rate and no sample size for any base
stage.** The preference is asserted four ways ("usually best", "tend to be
risky", "tend to produce larger gains", "seldom a charm") and quantified zero
ways. So a stage may be used as a FILTER exactly as IBD states it — prefer
stages 1-2 — and must NEVER be used as a weight or a probability multiplier,
because every such number would be invented.

⚠️ IT IS STATEFUL OVER THE WHOLE PRICE HISTORY, not a property of a window.
That makes it the most expensive quantity in the taxonomy and means a windowed
detector cannot compute it from what it is given.
"""
from __future__ import annotations

from typing import List, Optional

from api.services.pattern_engine.primitives import zigzag

#: The sourced counting unit, stated TWICE from opposite sides and agreeing.
#: As an advance: *"A breakout needs to produce a gain of at least 20% in
#: order to be counted as one stage."* As a separation: *"There must be a
#: separation of at least 20% from a buy point until the start of the next
#: base."* O'Neil via IBD, confidence: high.
#:
#: ⭐⭐ THE SECOND FORM IS WHAT MAKES THIS COMPUTABLE, and missing it was a
#: real bug in the first draft of this module. Treating every confirmed swing
#: high as a base pivot made every minor pullback a "base": advances were
#: truncated by the next pullback within days, nothing ever reached +20%, and
#: every symbol read as stage 1 forever. The research file annotates the
#: separation rule as exactly the fix -- it "is what stops two adjacent
#: consolidations counting as two bases."
STAGE_ADVANCE_PCT = 0.20

#: origin: uct — IBD publishes that a severe decline resets the count and does
#: NOT publish the trigger. This is a placeholder to be SWEPT, never a number to
#: defend; `tools/measure_base_stage.py` reports the stage distribution across
#: candidate values so the choice is visible rather than buried.
RESET_DRAWDOWN_PCT = 0.33

#: IBD's hard floor on how long a consolidation must run to be a base at all:
#: *"One, two or three weeks do not get the job done."* Confidence: high. In
#: trading days, "more than three weeks" is >15.
MIN_BASE_BARS = 16

#: Bars of history below which a stage number is refused outright. A count over
#: two swings is not a count.
MIN_HISTORY_BARS = 260


def pivot_sequence(bars: List[dict]) -> List[dict]:
    """Ordered base pivots and the advance each produced.

    A pivot is a CONFIRMED swing high that price later closes above — IBD's
    "buy point" of the base that preceded the breakout. The provisional
    trailing swing is excluded by `BaseCtx`'s own rule: a structure must never
    be built on a swing that can still move.

    Returns `[{pivot, pivot_idx, breakout_idx, max_after, advance}]` in bar
    order, where `advance` is `(max_after - pivot) / pivot` — measured from the
    PIVOT, per the source.
    """
    swings = [s for s in zigzag.segment(bars) if not s.get("provisional")]
    highs = [s for s in swings if s.get("type") == "high"]
    if not highs:
        return []

    closes = [b.get("c") or 0 for b in bars]
    n = len(closes)
    out = []
    for h in highs:
        idx = h.get("bar_index")
        price = h.get("price") or 0
        if idx is None or price <= 0 or idx >= n - 1:
            continue
        brk = None
        for j in range(idx + 1, n):
            if closes[j] > price:
                brk = j
                break
        if brk is None:
            continue
        out.append({"pivot": price, "pivot_idx": idx, "breakout_idx": brk,
                    "max_after": None, "advance": None})

    # the advance a breakout produced runs until the NEXT base's pivot forms —
    # that is what "the base that preceded it" means in the handout's phrasing.
    for k, ev in enumerate(out):
        stop = out[k + 1]["pivot_idx"] if k + 1 < len(out) else n
        window = closes[ev["breakout_idx"]:max(ev["breakout_idx"] + 1, stop)]
        window = [c for c in window if c > 0]
        if not window:
            continue
        ev["max_after"] = max(window)
        ev["advance"] = (ev["max_after"] - ev["pivot"]) / ev["pivot"]
    return [e for e in out if e["advance"] is not None]


def starts_new_base(prev_pivot: float, prev_idx: int,
                   pivot: float, idx: int) -> bool:
    """Does a candidate pivot begin a NEW base, or merge into the current one?

    ⭐ BOTH CONDITIONS ARE SOURCED, and they are the whole rule:
      · separation — *"There must be a separation of at least 20% from a buy
        point until the start of the next base."* Below it, the handout's merge
        applies: *"If the gain is less than 20% and the stock forms another
        base, it's a base-on-base pattern and counted as one stage."*
      · duration — *"One, two or three weeks do not get the job done."*

    ⛔ EXTRACTED SO IT CAN BE TESTED AT ALL. This lived inline in
    `stage_series`, and the duration half was UNTESTABLE from series fixtures:
    every attempt to build a series with two pivots close in time and far apart
    in price produced no confirmed swing highs, so the test asserted `max() == 1`
    over an EMPTY sequence and passed however the counter behaved. Deleting the
    floor entirely left it green. A rule reachable only through a fixture nobody
    can construct is a rule nobody is testing.
    """
    separated = (pivot - prev_pivot) / prev_pivot >= STAGE_ADVANCE_PCT
    long_enough = (idx - prev_idx) >= MIN_BASE_BARS
    return separated and long_enough


def stage_series(bars: List[dict],
                 reset_drawdown: float = RESET_DRAWDOWN_PCT) -> List[dict]:
    """Every counted base and the stage number it carries, in order.

    ⭐ THE 20% IS A SEPARATION AND AN ADVANCE AT ONCE. A candidate pivot only
    STARTS a new base when it sits at least 20% above the last counted buy
    point; anything nearer is the same consolidation seen twice, which is the
    base-on-base merge stated as *"If the gain is less than 20% and the stock
    forms another base, it's a base-on-base pattern and counted as one stage."*
    So the stage increments on the separation, and adjacent pullbacks cannot
    inflate it.

    ⛔ AND A BASE MUST LAST. IBD's floor -- *"One, two or three weeks do not
    get the job done"* -- rejects a candidate whose consolidation ran under
    `MIN_BASE_BARS`, which stops a two-day dip from being counted as a stage.
    """
    events = pivot_sequence(bars)
    if not events:
        return []
    closes = [b.get("c") or 0 for b in bars]
    out = []
    stage = 1
    last_pivot = None
    last_idx = None
    peak = 0.0
    for ev in events:
        # ⛔ THE RESET IS OURS, not IBD's. Applied before the stamp so a base
        # forming after a collapse reads first-stage, the direction IBD
        # describes ("bear markets reset the base count back to zero").
        seg = [c for c in closes[ev["pivot_idx"]:ev["breakout_idx"] + 1] if c > 0]
        if seg:
            peak = max(peak, max(seg))
            if peak > 0 and (peak - min(seg)) / peak >= reset_drawdown:
                stage, last_pivot, last_idx = 1, None, None
                peak = max(seg)

        if last_pivot is None:
            counted = True
        else:
            counted = starts_new_base(last_pivot, last_idx,
                                      ev["pivot"], ev["pivot_idx"])
            if counted:
                stage += 1
        if not counted:
            continue                      # base-on-base: the SAME stage
        out.append({**ev, "stage": stage})
        last_pivot, last_idx = ev["pivot"], ev["pivot_idx"]
    return out


def stage_at(bars: List[dict], i: Optional[int] = None,
             reset_drawdown: float = RESET_DRAWDOWN_PCT) -> Optional[int]:
    """The stage a base forming at bar `i` would carry, or None if refused.

    ⛔ CAUSAL. Only bases whose breakout is at or before `i` are counted, so a
    stage read at bar `i` never uses a bar after it.
    """
    cut = len(bars) - 1 if i is None else i
    # ⛔ THE FLOOR APPLIES TO HISTORY UP TO `i`, NOT TO THE ARRAY. This read
    # `len(bars)`, so asking for the stage at bar 200 of a 300-bar series passed
    # a 260-bar guard on history that had not happened yet — the stage at a bar
    # became a function of how much data arrived AFTER it. A causality rail
    # caught it: the same call answered differently on a truncated series.
    if cut + 1 < MIN_HISTORY_BARS:
        return None
    seq = [e for e in stage_series(bars[:cut + 1], reset_drawdown)
           if e["breakout_idx"] <= cut]
    if not seq:
        return None
    # ⭐ THE STAGE IS THE COUNT ITSELF. A base forming now belongs to the
    # stage of the last counted base until price separates 20% from its buy
    # point -- at which moment `stage_series` counts a new one. Adding a
    # speculative +1 here would be a second authority over the same rule.
    return seq[-1]["stage"]


def is_early_stage(stage: Optional[int]) -> Optional[bool]:
    """IBD's rule as a FILTER, which is the only form it is published in.

    *"It's usually best to buy when a stock breaks out from a first-stage or
    second-stage base."* — and O'Neil: *"Sell when your stock makes a new high
    in price off a third- or fourth-stage base. The third time is seldom a
    charm."*

    ⛔ RETURNS A BOOLEAN, NEVER A SCORE. IBD publishes no expectancy per stage,
    so any weight would be a number nobody measured. `None` when the stage
    could not be determined — never `False`, which would read as "late stage".
    """
    if stage is None:
        return None
    return stage <= 2


# ⛔⛔ A FAST WHOLE-HISTORY TIMELINE WAS BUILT HERE AND DELETED. `stage_at`
# re-segments `bars[:i+1]` on every call, so walking every anchor of a series is
# quadratic — 33x slower than one full-series pass, which is why the
# lift-by-stage measurement never finished. The obvious fix is to segment once
# and index the result.
#
# It is wrong, and quietly. `zigzag` scales its threshold to the series' own
# return sigma, so segmenting `bars[:i+1]` does not produce a prefix of
# segmenting `bars` — it produces a DIFFERENT segmentation, computed on less
# data, which is exactly what a live system would have had. Measured on a
# 1,500-bar series the one-pass version reported stage 2 at bars where the
# truncating version still said stage 1: it LEADS, which is look-ahead, in the
# one direction that flatters a late-stage filter.
#
# So the slow path is the correct one and the measurement must pay for it.
# Anyone reaching for the fast version again: the disagreement is not a rounding
# artefact of the confirmation rule, it is the sigma window.
