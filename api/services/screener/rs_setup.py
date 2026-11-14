"""The Setup label for the Relative Strength screens (plan 2026-11-14 v2,
section 3): one of six setups, an optional "Tight range" tag beside it, and one
of three flags.

PURE. No I/O, no env read, no clock. :func:`label` reads a dict and returns a
dict; it changes neither. Nothing here writes a `screener_rows` column: the
build step that calls this (unit U2b) decides what is stored.

FAIL CLOSED. A rule is answered only when every input it reads is a real number
(or a real true/false). When one is missing the setup is ``None``, never the
next label down: "Uptrend, no setup" printed on a row whose pullback could not
be judged would be a claim about bars we did not read.

The inputs are `technicals.setup_inputs(bars)` plus three keys the caller adds:

* ``pivot``: the price of a FRESH base pivot, or ``None``. Freshness is the
  caller's decision; a stale pivot must arrive as ``None``.
* ``tight_consolidation``: the row's existing 0 / 1 / ``None`` column.
* ``closes``: the last :data:`CLOSES_NEEDED` (64) closes, oldest first.
"""

from __future__ import annotations

import math
from typing import Optional, Sequence

# IBD's buy zone, "up to 5% above the ideal buy point": the one number the base
# catalog already uses to say a base has resolved. Imported, never retyped.
from api.services.screener.base_catalog import IBD_BUY_ZONE

# ── Thresholds (each names its source; none is adjustable by a member: plan 4) ─

#: Extended above the 50-day line, in ATR(14) units. Jeff Sun's published 4x ATR
#: cap from the 50-day average: the one published number for "extended" the RS
#: scans research found (plan section 3). Read off the `atr_ext_sma50` column's
#: own calculation, so the label and the column cannot disagree.
EXTENDED_ATR_SMA50 = 4.0
#: Extended above the 21-day EMA, in ATR(14) units. Plan section 3, "3+ ATR
#: above the 21-day" (owner-approved 2026-11-14; a house threshold, no
#: published test).
EXTENDED_ATR_EMA21 = 3.0
#: "At pivot" starts 3% below the pivot (plan section 3) and ends at the top of
#: IBD's buy zone, :data:`IBD_BUY_ZONE` above it.
PIVOT_BELOW = 0.03
#: A pullback needs a 20-session closing high no more than this many sessions
#: ago (plan section 3, decision D5).
PULLBACK_HIGH_MAX_AGE = 15
#: ... and the low within this many ATRs above a rising 8-day or 21-day EMA,
#: with the close no more than this many ATRs under it (decision D5).
PULLBACK_ATR_BAND = 0.5

#: "Buyout pending" (plan section 3: "3 flat sessions following a 15%+ gap").
BUYOUT_JUMP_PCT = 15.0      # one session's close over the prior close, percent
BUYOUT_WINDOW = 60          # the jump is one of the last 60 sessions (today counts)
BUYOUT_MIN_SESSIONS = 3     # at least this many sessions have closed since the jump
BUYOUT_BAND_PCT = 2.0       # every close from the jump on sits inside this range, percent

#: "One-day move" (plan section 3: "one session supplied over half of the
#: 3-month gain").
ONE_DAY_WINDOW = 63         # sessions of change: a quarter
ONE_DAY_SHARE = 0.5         # the session's gain is MORE than this share of the net gain
ONE_DAY_MIN_PCT = 15.0      # and at least this large on its own, percent

#: "New issue": fewer bars than a 252-session lookback plus the bar it judges.
NEW_ISSUE_BARS = 253

#: Closes the flags read: 63 sessions of change need 64 closes.
CLOSES_NEEDED = ONE_DAY_WINDOW + 1

# ── Vocabulary ──────────────────────────────────────────────────────────────

#: The setups, in first-match order.
SETUPS = ("below_50", "extended", "at_pivot", "pullback_8", "pullback_21", "uptrend")
#: The flags, in first-match order.
FLAGS = ("buyout_pending", "one_day_move", "new_issue")
#: The setups that count as near a buy point (with "tight", see `near_buy_point`).
BUY_POINT_SETUPS = ("at_pivot", "pullback_8", "pullback_21")
#: Setups that are never near a buy point, whatever else is true.
NOT_BUY_POINT_SETUPS = ("extended", "below_50")
#: Flags that keep a name out of "near a buy point".
NOT_BUY_POINT_FLAGS = ("buyout_pending", "one_day_move")

#: The member-facing words (plan section 3). Row captions, never coloured pills.
SETUP_LABELS = {
    "below_50": "Below its 50-day line",
    "extended": "Extended",
    "at_pivot": "At pivot",
    "pullback_8": "Pullback to the 8-day",
    "pullback_21": "Pullback to the 21-day",
    "uptrend": "Uptrend, no setup",
    "tight": "Tight range",
    "buyout_pending": "Buyout pending",
    "one_day_move": "One-day move",
    "new_issue": "New issue",
}


def _num(v) -> Optional[float]:
    """``v`` as a float when it is a real, finite number; else ``None``. A bool
    is not a number here (``True`` would otherwise read as a price of 1)."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    f = float(v)
    return f if math.isfinite(f) else None


def _price(v) -> Optional[float]:
    """A positive finite number, or ``None``: a price, an average, an ATR."""
    f = _num(v)
    return f if (f is not None and f > 0) else None


def _truth(v) -> Optional[bool]:
    """True / False from a bool or a stored 1 / 0; ``None`` for anything else."""
    if isinstance(v, bool):
        return v
    if isinstance(v, int) and v in (0, 1):
        return bool(v)
    return None


def _pullback_to(ema: float, rising: bool, low: float, close: float, atr: float) -> bool:
    """The low came within half an ATR of a RISING average and the close is no
    more than half an ATR under it."""
    band = PULLBACK_ATR_BAND * atr
    return bool(rising) and low <= ema + band and close >= ema - band


def _setup(inp: dict) -> Optional[str]:
    close, sma50, atr = _price(inp.get("close")), _price(inp.get("sma50")), _price(inp.get("atr14"))
    if close is None or sma50 is None or atr is None:
        return None

    # 1. Below its 50-day line.
    if close < sma50:
        return "below_50"

    # 2. Extended. Both ATR readings must be present to rule it out.
    ext50, ext21 = _num(inp.get("atr_ext_sma50")), _num(inp.get("atr_ext_ema21"))
    if ext50 is None or ext21 is None:
        return None
    pivot = _price(inp.get("pivot"))
    if ext50 >= EXTENDED_ATR_SMA50 or ext21 >= EXTENDED_ATR_EMA21:
        return "extended"
    # The same expression `base_catalog` uses to say a base has resolved.
    if pivot is not None and close > pivot * (1.0 + IBD_BUY_ZONE):
        return "extended"

    # 3. At pivot: 3% below to 5% above.
    if pivot is not None and pivot * (1.0 - PIVOT_BELOW) <= close <= pivot * (1.0 + IBD_BUY_ZONE):
        return "at_pivot"

    # 4. Pullback to a rising 8-day or 21-day EMA; the 8-day is named when both hold.
    ema8, ema21, low = _price(inp.get("ema8")), _price(inp.get("ema21")), _price(inp.get("low"))
    up8, up21 = _truth(inp.get("ema8_rising")), _truth(inp.get("ema21_rising"))
    age = _num(inp.get("high20_age"))
    if None in (ema8, ema21, low, up8, up21, age):
        return None
    if age <= PULLBACK_HIGH_MAX_AGE:
        if _pullback_to(ema8, up8, low, close, atr):
            return "pullback_8"
        if _pullback_to(ema21, up21, low, close, atr):
            return "pullback_21"

    # 5. None of the above, at or above the 50-day line (rule 1 said so).
    return "uptrend"


def _tight(inp: dict) -> Optional[int]:
    v = inp.get("tight_consolidation")
    if isinstance(v, bool):
        return 1 if v else 0
    if v == 1:
        return 1
    if v == 0:
        return 0
    return None


def _pct_gain(now: float, before: float) -> float:
    """``now`` over ``before`` in percent, written as a difference over the
    prior value so a 100 to 115 step is exactly 15.0 and the threshold is
    decidable (`relative_strength`'s Clenow gap rule, for the same reason:
    ``115 / 100 - 1`` is 0.1499999...)."""
    return (now - before) / before * 100.0


def _buyout_pending(closes: Sequence) -> bool:
    """A session inside the last :data:`BUYOUT_WINDOW` closed 15%+ above the
    prior close, at least :data:`BUYOUT_MIN_SESSIONS` sessions have closed
    since, and every close FROM THAT SESSION ON sits inside a 2% range.

    The jump session's own close is inside the range on purpose: a deal pins the
    price at the jump, and a stock that gapped and then kept climbing is not
    pinned. Walks back from the newest close and stops at the first jump (an
    older one cannot qualify: the newer jump would break its range) or at the
    first close that is not a price (no claim across a hole)."""
    n = len(closes)
    for age in range(min(BUYOUT_WINDOW, n - 1)):
        i = n - 1 - age
        now, before = _price(closes[i]), _price(closes[i - 1])
        if now is None or before is None:
            return False
        if _pct_gain(now, before) >= BUYOUT_JUMP_PCT:
            if age < BUYOUT_MIN_SESSIONS:
                return False
            since = [float(c) for c in closes[i:]]
            return _pct_gain(max(since), min(since)) <= BUYOUT_BAND_PCT
    return False


def _one_day_move(closes: Sequence) -> bool:
    """Over the last :data:`ONE_DAY_WINDOW` sessions the net change is positive
    and ONE session's close-to-close gain is more than half of it (in price
    points: the sessions' point changes sum to the net change) and at least 15%
    on its own. Needs all 64 closes; a hole anywhere is no answer."""
    if len(closes) < CLOSES_NEEDED:
        return False
    window = [_price(c) for c in closes[-CLOSES_NEEDED:]]
    if any(c is None for c in window):
        return False
    net = window[-1] - window[0]
    if net <= 0:
        return False
    for before, now in zip(window, window[1:]):
        if now - before > ONE_DAY_SHARE * net and _pct_gain(now, before) >= ONE_DAY_MIN_PCT:
            return True
    return False


def _flag(inp: dict) -> Optional[str]:
    closes = inp.get("closes")
    closes = list(closes) if isinstance(closes, (list, tuple)) else []
    if _buyout_pending(closes):
        return "buyout_pending"
    if _one_day_move(closes):
        return "one_day_move"
    bars = _num(inp.get("bars"))
    if bars is not None and bars < NEW_ISSUE_BARS:
        return "new_issue"
    return None


def label(inputs: dict) -> dict:
    """``{"setup": <one of SETUPS or None>, "tight": 0 / 1 / None,
    "flag": <one of FLAGS or None>}`` for one row. See the module header for
    the inputs and :data:`SETUP_LABELS` for the words."""
    inp = inputs if isinstance(inputs, dict) else {}
    return {"setup": _setup(inp), "tight": _tight(inp), "flag": _flag(inp)}


def near_buy_point(result: dict) -> bool:
    """At pivot, a pullback, or a tight range; never extended or below the
    50-day line; never a buyout or a one-day move. A row with NO setup is not
    near a buy point even when it is tight: nothing vouches that it is not
    extended."""
    res = result if isinstance(result, dict) else {}
    setup, flag = res.get("setup"), res.get("flag")
    if setup is None or setup in NOT_BUY_POINT_SETUPS or flag in NOT_BUY_POINT_FLAGS:
        return False
    return setup in BUY_POINT_SETUPS or res.get("tight") == 1
