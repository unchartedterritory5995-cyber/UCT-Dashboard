"""THE single grammar for multi-week BASE structure — metadata, sourced
criteria AND geometry in one place.

⭐ WHY ONE FILE. A structure needs a machine key, a display label, an axis, a
textbook bias, a precedence rank, a member-facing description, the criteria it
came from, and (for relations) a predicate. Split those across a detector
module, a filter registry and a frontend constant and they drift — this repo's
most repeated defect is a second authority over one value. `candle_catalog.py`
settled this argument for single bars; this is the same argument for the
multi-week structures those bars build.

⭐ TWO ORTHOGONAL AXES, AND THE CANDLE LIBRARY ALREADY PAID FOR FUSING THEM.
**SHAPE** is a TOTAL partition — exactly one per symbol, always, because the
last branch of the cascade takes no condition. **RELATION** is SPARSE — zero or
many. The original 7-label candle chain fused them and every shape branch
short-circuited every relation branch: three defects at once. Do not merge
these axes here.

⛔⛔ EVERY CRITERION CARRIES ITS PROVENANCE, IN EXACTLY ONE OF THREE STATES.
  - **sourced** — a `value`, the verbatim `quote` it came from, and a `source_id`
  - **refused** — `value is None` plus a `missing:` naming what would have to be
    published to make it computable
  - **ours** — `origin="uct"`, and it may NOT cite a source

There is no fourth state, and `test_every_criterion_has_exactly_one_provenance_state`
fails on one. This is not bureaucracy: `setup_templates`' VCP row currently
carries "40-50%+ expansion on breakout day" attributed to Minervini, and a regex
over the full 218-page *Think & Trade Like a Champion* finds no such threshold
anywhere. A number with nobody's name on it becomes a number with the wrong
name on it.

⛔ BIAS IS THE TEXTBOOK BIAS AND `rank` IS ORDERING ONLY. Same owner ruling as
the candle library, 2026-08-24: classic names, classic bias, NO scoring. The
column describes a structure; it does not forecast. Measured expectancy lives
in the lift ledger, earned per structure against our own base rates — never
here, and never as a confidence number bolted onto a shape.

Sources: the 15-lane sweep in `docs/superpowers/research/bases/`.
"""
from dataclasses import dataclass

from api.services.pattern_engine.primitives import cup
from typing import Callable, Optional

#: Darvas's own count. Sourced — see the DARVAS_BOX criteria below.
CONFIRM_DAYS = 3

#: ⛔⛔ OURS, AND THE MEASUREMENT THAT FORCED IT. Darvas explicitly refuses to
#: bound how long a stock may sit in its box ("I did not care how long it
#: stayed in its box"), so ANY dwell bound is our editorial choice and must
#: never be attributed to him — that refusal is recorded as a Criterion below.
#:
#: Measured 2026-08-30 over 3,705 real tickers x 400 daily bars: asking only
#: "did the walk end in a box state" matched **3,582 of 3,705 = 96.7%**, which
#: the coverage harness correctly called `noise`. The reason is that the median
#: box was framed **313 bars ago** — price has been drifting inside a year-old
#: frame, which is not what Darvas was pointing at. Requiring the frame to be
#: RECENT:
#:
#:     max age (bars)   10     20     30     40     60
#:     % of universe   2.3%   4.8%   6.1%   8.0%  12.3%
#:
#: 20 sessions (~4 weeks) is the choice: it keeps the label meaning "there is a
#: live frame here now" at an informative ~4.8% rather than a near-universal
#: 96.7%. origin: uct.
MAX_BOX_AGE_BARS = 20

#: The total-partition fallback. `_classify_shape` ends on this branch with no
#: condition, so there is no symbol it cannot name.
FALLBACK_SHAPE = "undefined-structure"


@dataclass(frozen=True)
class Criterion:
    """One rule from one house, with where it came from.

    `value` may be a number OR a short machine-readable string — the research
    corpus records plenty of rules whose content is structural rather than
    numeric ("top before bottom"), and those are sourced facts too, not
    refusals. A REFUSAL is specifically `value is None` + `missing`.
    """
    condition: str
    value: object = None
    quote: Optional[str] = None
    source_id: Optional[str] = None
    confidence: str = "med"
    missing: Optional[str] = None
    origin: str = "source"


@dataclass(frozen=True)
class Structure:
    key: str                 # stable machine key — NEVER renamed
    label: str               # display string
    axis: str                # "shape" (total) | "relation" (sparse)
    family: str
    bias: str                # textbook: bullish | bearish | neutral
    rank: int                # ORDERING ONLY, never displayed
    min_bars: int
    desc: str
    criteria: tuple = ()
    detect: Optional[Callable] = None
    # ⚰️ `needs_intraday` REMOVED 2026-08-30. It was declared here, surfaced in
    # `meta()` as a member-facing constant `false`, SET BY NOTHING and READ BY
    # NOTHING — a capability the payload asserted and no code checked. The
    # intraday decomposition it was meant to serve (spec §6.1: name the
    # structure and the entry level from daily bars, hold the TRIGGER at
    # `forming` for the 93% of symbols we cannot see intraday) belongs with the
    # gap & catalyst family, and returns WITH its consumer and its rail. A
    # field nothing sets is a claim nobody checks.
    #: Real-universe hit-rate, measured at authoring time. `None` means the
    #: structure has not been measured yet — which is itself a finding
    #: (`cup_handle_uct` shipped green and fires on 2 of 2,890 symbols).
    coverage_pct: Optional[float] = None


# ── the Darvas box state machine ───────────────────────────────────────────
# ⭐ THIS IS A STATEFUL MACHINE ACROSS BARS, NOT A PER-BAR PREDICATE, and the
# ordering constraint is Darvas's own: the floor cannot be sought until the
# ceiling is set. An implementation that tracks both at once is not his method.
#
# ⚠️ TWO PLACES WHERE THE POPULAR IMPLEMENTATION IS NOT DARVAS:
#   1. He DENIES the contiguous stacked box every charting package draws —
#      "The bottom of a new box is not necessarily the top of the old box."
#   2. The three-day rule governs box CONSTRUCTION only, never entry timing —
#      "It only applies to establish the lower and upper limit of the boxes."
# Both are verbatim from the primary text; see the corpus file.

def darvas_box_state(bars, confirm_days: int = CONFIRM_DAYS) -> dict:
    """Walk `bars` and report the CURRENT box state.

    States: ``seeking_top`` -> ``seeking_bottom`` -> ``box``. A trade below a
    established floor voids the box and restarts the search from that bar.
    """
    st = {"state": "seeking_top", "top": None, "top_set_at": None,
          "bottom": None, "bottom_set_at": None, "voided": False,
          "height_pct": None}
    if not bars:
        return st

    pending_top, top_i = bars[0]["h"], 0
    pending_bottom, bot_i = bars[0]["l"], 0
    streak = 0

    for i in range(1, len(bars)):
        b = bars[i]
        hi, lo = b["h"], b["l"]
        if hi <= 0 or lo <= 0:
            continue                      # a bar that never traded proves nothing

        if st["state"] == "seeking_top":
            # ⛔ `>=` — "does not TOUCH or penetrate". A touch resets the count.
            if hi >= pending_top:
                pending_top, top_i, streak = hi, i, 0
            else:
                streak += 1
                if streak >= confirm_days:
                    st["state"] = "seeking_bottom"
                    st["top"], st["top_set_at"] = pending_top, top_i
                    pending_bottom = min(x["l"] for x in bars[top_i:i + 1]
                                         if x["l"] > 0)
                    bot_i, streak = i, 0

        elif st["state"] == "seeking_bottom":
            if lo <= pending_bottom:
                pending_bottom, bot_i, streak = lo, i, 0
            else:
                streak += 1
                if streak >= confirm_days:
                    st["state"] = "box"
                    st["bottom"], st["bottom_set_at"] = pending_bottom, bot_i
                    streak = 0

        else:  # an established box
            if lo < st["bottom"]:
                # "If, however, it fell to 44 1/2, I eliminated it."
                st["voided"] = True
                st.update(state="seeking_top", top=None, top_set_at=None,
                          bottom=None, bottom_set_at=None)
                pending_top, top_i, streak = hi, i, 0

    if st["state"] == "box" and st["bottom"]:
        st["height_pct"] = (st["top"] - st["bottom"]) / st["bottom"] * 100.0
        # Age of the FRAME: bars since the later of the two edges was set.
        st["age_bars"] = len(bars) - 1 - max(st["top_set_at"], st["bottom_set_at"])
    return st


def _detect_darvas_box(ctx) -> bool:
    """A LIVE frame, not merely a frame that once existed.

    ⛔ The recency gate is load-bearing, not a tidy-up. Without it this
    predicate matched 96.7% of the universe (see `MAX_BOX_AGE_BARS`), because
    over 400 bars nearly every stock frames a box at some point and the walk
    simply reports wherever it ended. A label 96.7% of the market carries is
    not information — the same reason `Compression Bar (NR4)` was deleted.
    """
    st = darvas_box_state(ctx.bars)
    if st["state"] != "box":
        return False
    return st.get("age_bars", 10 ** 9) <= MAX_BOX_AGE_BARS


_DARVAS = "darvas_1960"   # Nicolas Darvas, "How I Made $2,000,000 in the Stock Market"

DARVAS_BOX = Structure(
    key="darvas-box",
    label="Darvas Box",
    axis="relation",
    family="Base Structure",
    bias="neutral",
    rank=10,
    min_bars=30,
    desc=("Price is framed between a ceiling and a floor, each established by "
          "three sessions that did not touch the prior extreme. The floor is "
          "only sought once the ceiling is set."),
    criteria=(
        Criterion(
            condition="Sessions with no touch of the prior high before the ceiling is set",
            value=3,
            quote=("The top of a box is established when the stock does not touch "
                   "or penetrate a previously set new high for three consecutive "
                   "days. This is true — in reverse — for the bottom of the box."),
            source_id=_DARVAS, confidence="high",
        ),
        Criterion(
            condition="Ordering: the floor cannot be sought until the ceiling is set",
            value="top-before-bottom",
            quote=("Equally important: the lower limit of the new box cannot be "
                   "established until the upper limit is firmly set."),
            source_id=_DARVAS, confidence="high",
        ),
        Criterion(
            condition="A touch resets the count (strict comparison, not >=)",
            value="touch-resets",
            quote="does not touch or penetrate",
            source_id=_DARVAS, confidence="high",
        ),
        Criterion(
            condition="Any trade below the floor voids the box",
            value="low-below-floor-voids",
            quote=("If, however, it fell to 44½, I eliminated it as a possibility."),
            source_id=_DARVAS, confidence="high",
        ),
        Criterion(
            condition="Box height, narrow names — DESCRIPTIVE, never a gate",
            value="~10% each way",
            quote=("some stocks moved in a very small frame, perhaps not more "
                   "than 10% each way"),
            source_id=_DARVAS, confidence="med",
        ),
        Criterion(
            condition="Box height, wide-swinging names — DESCRIPTIVE, never a gate",
            value="15% to 20%",
            quote="Other wide-swinging stocks moved in a frame between 15% and 20%.",
            source_id=_DARVAS, confidence="med",
        ),
        Criterion(
            condition="Box duration",
            value=None,
            quote=("I did not care how long it stayed in its box as long as it "
                   "did and did not fall below the lower frame figure."),
            source_id=_DARVAS, confidence="high",
            missing=("Darvas publishes no minimum or maximum box length, so any "
                     "dwell bound is ours and cannot be attributed to him."),
        ),
        Criterion(
            condition=("Frame must be LIVE — bars since the later edge was set. "
                       "Ours, because the criterion above records that Darvas "
                       "refuses to bound it. Measured: without this gate the "
                       "label matched 96.7% of the universe (median frame age "
                       "313 bars); with it, 4.8%."),
            value=MAX_BOX_AGE_BARS,
            origin="uct", confidence="high",
        ),
    ),
    coverage_pct=4.8,
    detect=_detect_darvas_box,
)


# ── Green Line Breakout (Dr. Eric Wish) ────────────────────────────────────
# ⚠️ ATTRIBUTION: Eric **Wish**, not "Eric Krull" — three independent sources
# agree, and the wrong name circulates widely.

_WISH = "wish_glb"        # Dr. Eric Wish, Wishing Wealth Blog, "Green line breakout (GLB) explained" (2018-05)

#: Wish's own count, in CALENDAR MONTHS. ⛔ Not 63 trading days — the corpus
#: flags that a 63-bar version fires on structures the monthly version rejects
#: and vice versa. Pick one and label it; we picked his.
GLB_MONTHS_UNBROKEN = 3


def _month_key(t) -> int:
    """`YYYYMM` from a bar timestamp.

    ⚠️ Screener daily bars carry `t` as an int **YYYYMMDD** (verified:
    `bars_sqlite.get_bars` returns 20260817), while `pattern_engine.types.Bar`
    documents unix seconds. Both shapes reach this module, so the form is
    detected rather than assumed — an 8-digit date and a 10-digit epoch are
    not confusable by magnitude, and guessing wrong silently buckets every
    bar into one month.
    """
    v = int(t)
    if 10_000_000 <= v <= 99_999_999:          # YYYYMMDD
        return v // 100
    import time as _time                        # unix seconds
    tm = _time.gmtime(v)
    return tm.tm_year * 100 + tm.tm_mon


def green_line(bars) -> Optional[dict]:
    """The most recent qualifying green line, or None.

    A green line is the highest monthly HIGH in the series that has not been
    surpassed by any of the following `GLB_MONTHS_UNBROKEN` completed months.
    """
    if not bars:
        return None
    monthly: dict = {}
    for b in bars:
        hi = b.get("h") or 0
        if hi <= 0:
            continue
        k = _month_key(b["t"])
        monthly[k] = max(monthly.get(k, 0.0), hi)
    if len(monthly) < GLB_MONTHS_UNBROKEN + 1:
        return None

    keys = sorted(monthly)
    running_max = 0.0
    best = None
    # The last month is in progress; a line needs N COMPLETED months after it.
    for i, k in enumerate(keys):
        hi = monthly[k]
        if hi >= running_max:
            running_max = hi
            after = keys[i + 1:]
            if len(after) >= GLB_MONTHS_UNBROKEN and \
                    all(monthly[j] <= hi for j in after[:GLB_MONTHS_UNBROKEN]):
                best = {"price": hi, "month": k}
    return best


#: ⛔ OURS, AND MEASURED — the same trap the Darvas box sprang.
#: Wish phrases the condition two ways in one sentence: "When a stock MOVES
#: THROUGH the green line **or IS ABOVE** its last green line I become
#: interested." Those are an EVENT and a STATE, and they are different facts.
#: Implementing the state under a label that says "Breakout" names stocks that
#: broke out months ago.
#:
#: Measured 2026-08-30 over 3,541 tickers with >=260 sessions: 496 (14.0%) sit
#: above their green line, and the median cleared it **74 sessions ago** —
#: max 741, nearly three years. Requiring the break to be RECENT:
#:
#:     within (sessions)    5     10     20     40     60    120
#:     % of universe     1.16%  1.67%  3.33%  4.49%  6.16%  9.91%
#:
#: 20 sessions ships, matching the Darvas frame-age choice so the two
#: structures mean "recent" the same way. Wish publishes no recency bound at
#: all — his "is above" is unbounded — so this is entirely ours.
GLB_MAX_BREAKOUT_AGE_BARS = 20


def glb_breakout_age(bars) -> Optional[int]:
    """Sessions since price FIRST closed above the current green line.

    `None` when there is no line or price is not above it. `0` means the break
    happened on the latest bar.
    """
    line = green_line(bars)
    if not line:
        return None
    lp = line["price"]
    last_close = bars[-1].get("c") or 0
    if last_close <= 0 or last_close < lp:
        return None
    first_above = 0
    for i in range(len(bars) - 1, -1, -1):
        if (bars[i].get("c") or 0) < lp:
            first_above = i + 1
            break
    return len(bars) - 1 - first_above


def _detect_green_line_breakout(ctx) -> bool:
    """A RECENT break above the green line — the event, not the standing state.

    ⚠️ Wish never says whether the trigger is an intraday touch, a daily close
    or a MONTHLY close — the corpus checked three secondary sources and none
    resolves it. Daily close is OURS, recorded as such below.
    """
    bars = ctx.bars_full or ctx.bars
    age = glb_breakout_age(bars)
    return age is not None and age <= GLB_MAX_BREAKOUT_AGE_BARS


GREEN_LINE_BREAKOUT = Structure(
    key="green-line-breakout",
    label="Green Line Breakout",
    axis="relation",
    family="Base Structure",
    bias="bullish",
    rank=20,
    min_bars=260,
    desc=("Price has recently cleared the highest monthly high in the "
          "history we hold — a level that had stood unsurpassed for at least "
          "three completed months."),
    criteria=(
        Criterion(
            condition="Months the high must stand unsurpassed",
            value=GLB_MONTHS_UNBROKEN,
            quote="that has not been surpassed for at least 3 months",
            source_id=_WISH, confidence="high",
        ),
        Criterion(
            condition="Reference price is the monthly HIGH, not the monthly close",
            value="monthly-high",
            quote="the highest price reached at any month",
            source_id=_WISH, confidence="high",
        ),
        Criterion(
            condition="Sell rule — a close back below the line",
            value="close-below-line-voids",
            quote=("I have a strict rule to sell a stock immediately if it "
                   "comes back below its green line."),
            source_id=_WISH, confidence="high",
        ),
        Criterion(
            condition="Breakout volume expectation",
            value=None,
            quote="It does help if the stock showed above average volume at the break-out.",
            source_id=_WISH, confidence="high",
            missing=("No multiple and no averaging window. 'It does help' is a "
                     "preference, not a requirement, so the criterion is not "
                     "computable as published and ships uncomputed."),
        ),
        Criterion(
            condition=("Trigger resolution — intraday touch vs daily close vs "
                       "monthly close. Ours: DAILY CLOSE. Wish says only 'moves "
                       "through the green line' and no secondary source "
                       "resolves it."),
            value="daily-close",
            origin="uct", confidence="high",
        ),
        Criterion(
            condition=("Break must be RECENT (sessions since price first closed "
                       "above the line). Ours entirely — Wish's 'is above its "
                       "last green line' is unbounded, and measured, the median "
                       "name above its line cleared it 74 sessions ago (max "
                       "741). A column labelled Breakout must mean the event."),
            value=GLB_MAX_BREAKOUT_AGE_BARS,
            origin="uct", confidence="high",
        ),
        Criterion(
            condition=("⛔ SCOPE: this is a since-data-start high, NOT a true "
                       "all-time high. Wish requires an all-time high; our "
                       "deepest daily history is bounded (AAPL starts "
                       "2002-10-16 against a 1980 IPO). The corpus names this "
                       "as a real and common defect in GLB screeners, so the "
                       "label says 'the history we hold' rather than claiming "
                       "all-time."),
            value="since-data-start",
            origin="uct", confidence="high",
        ),
    ),
    detect=_detect_green_line_breakout,
    coverage_pct=3.2,   # full universe (3,707); the 3.33% sweep figure used the >=260-session subset
)


# ── Pocket Pivot (Dr. Chris Kacher) ────────────────────────────────────────

_KACHER = "morales_kacher_2010"   # Morales & Kacher, "Trade Like an O'Neil Disciple" (Wiley, 2010), p.160 + virtueofselfishinvesting.com

PP_WINDOW = 10          # sourced — "over the prior 10 days"
PP_TOP_HALF = 0.5       # sourced — "closes in the top half of its trading range"
PP_DOWNTREND_BARS = 105  # ~5 months, ours; see the criterion below


def _sma(closes, period):
    if len(closes) < period:
        return None
    return sum(closes[-period:]) / period


def _detect_pocket_pivot(ctx) -> bool:
    """Institutional accumulation INSIDE a base, not at the breakout.

    Only the daily-OHLCV-computable half of Kacher's rule is implemented. The
    fundamentals gate ("excellent earnings, sales, pretax margins, ROE"), the
    "constructive base" judgement, and the authors' discretionary permission to
    disregard a red volume day are all explicitly NOT computable from bars, and
    are recorded as refusals rather than approximated into a number.
    """
    bars = ctx.bars
    if len(bars) < max(PP_WINDOW + 2, 200, PP_DOWNTREND_BARS + 1):
        return False
    t = len(bars) - 1
    cur, prev = bars[t], bars[t - 1]
    c, h, l, v = cur.get("c"), cur.get("h"), cur.get("l"), cur.get("v") or 0
    if not c or not h or not l or h <= l or v <= 0:
        return False

    # up day
    if c <= (prev.get("c") or 0):
        return False

    # close in the top half of the day's range
    if (c - l) / (h - l) < PP_TOP_HALF:
        return False

    # volume vs the MAX down-day volume in the prior 10 sessions (exclusive)
    down_vols = [
        bars[i].get("v") or 0
        for i in range(t - PP_WINDOW, t)
        if (bars[i].get("c") or 0) < (bars[i - 1].get("c") or 0)
    ]
    if not down_vols:
        # ⛔ The rule's right-hand side is max of an empty set. The authors
        # never address it. We REFUSE rather than pass vacuously — a window
        # with no down days would otherwise make every up-day a pocket pivot.
        return False
    if v <= max(down_vols):
        return False

    closes = [b.get("c") or 0 for b in bars]
    sma10, sma50, sma200 = _sma(closes, 10), _sma(closes, 50), _sma(closes, 200)
    if not sma10 or not sma50 or not sma200:
        return False

    # "Do not buy pocket pivots if the stock is under a critical moving
    # average such as the 50-dma or 200-dma."
    if c < sma50 or c < sma200:
        return False

    # The authors' own worked extension example: the whole day's LOW above the
    # 10-dma reads as (mildly) extended.
    if l > sma10:
        return False

    # "Do not buy pocket pivots if the overall chart formation is in a
    # multi-month downtrend (5 months or longer)." The 5 months is theirs; the
    # test is ours — they publish no formula.
    if c <= closes[t - PP_DOWNTREND_BARS]:
        return False

    return True


POCKET_PIVOT = Structure(
    key="pocket-pivot",
    label="Pocket Pivot",
    axis="relation",
    family="Accumulation",
    bias="bullish",
    rank=30,
    min_bars=210,
    desc=("An up day whose volume exceeds the largest down-day volume of the "
          "prior ten sessions, closing in the top half of its range while "
          "holding above the 50- and 200-day averages."),
    criteria=(
        Criterion(
            condition="Volume exceeds the largest DOWN-day volume in the window",
            value="max",
            quote=("The day's volume should be larger than the highest down "
                   "volume day over the prior 10 days."),
            source_id=_KACHER, confidence="high",
        ),
        Criterion(
            condition="Lookback window length (trading days)",
            value=PP_WINDOW,
            quote="over the prior 10 days",
            source_id=_KACHER, confidence="high",
        ),
        Criterion(
            condition=("Whether the signal day itself sits inside the 10-day "
                       "window. Ours: EXCLUSIVE. No primary text states it; "
                       "exclusive is the only reading consistent with 'up day "
                       "vs prior down days', but it is an inference."),
            value="exclusive",
            origin="uct", confidence="high",
        ),
        Criterion(
            condition="Close location in the day's range (minimum tolerance)",
            value=PP_TOP_HALF,
            quote=("However, if it closes in the top half of its trading range "
                   "and is up on the day, it could still be considered valid."),
            source_id=_KACHER, confidence="high",
        ),
        Criterion(
            condition="Must not sit under a critical moving average",
            value="above-50dma-and-200dma",
            quote=("Do not buy pocket pivots if the stock is under a critical "
                   "moving average such as the 50-dma or 200-dma."),
            source_id=_KACHER, confidence="high",
        ),
        Criterion(
            condition="Extension test — the day's LOW above the 10-dma reads as extended",
            value="low>sma10 ⇒ extended",
            quote=("We did not notify members on 2/8/12 since KORS could be "
                   "considered mildly extended since the low of the trading day "
                   "was above its 10dma."),
            source_id=_KACHER, confidence="high",
        ),
        Criterion(
            condition="Disqualifying multi-month downtrend (months)",
            value=5,
            quote=("Do not buy pocket pivots if the overall chart formation is "
                   "in a multi-month downtrend (5 months or longer)."),
            source_id=_KACHER, confidence="high",
        ),
        Criterion(
            condition=("How that 5-month downtrend is tested. Ours: close above "
                       "the close 105 sessions ago. The 5 months is theirs; "
                       "they publish no formula, so the test is ours."),
            value=PP_DOWNTREND_BARS,
            origin="uct", confidence="high",
        ),
        Criterion(
            condition=("Behaviour when the prior-10-day window contains ZERO "
                       "down-close days. Ours: REFUSE. The rule's right-hand "
                       "side is max of an empty set; the authors never address "
                       "it, and passing vacuously would make every up day a "
                       "pocket pivot."),
            value="refuse",
            origin="uct", confidence="high",
        ),
        Criterion(
            condition="Fundamentals gate",
            value=None,
            quote=("The stock's fundamentals should be strong, i.e., excellent "
                   "earnings, sales, pretax margins, ROE, strong leader in its "
                   "space, etc."),
            source_id=_KACHER, confidence="high",
            missing=("The authors publish only the adjective 'excellent' — no "
                     "numeric thresholds — and none of it is computable from "
                     "OHLCV anyway. Ships uncomputed."),
        ),
        Criterion(
            condition="'Constructive base' context and the wedging prohibition",
            value=None,
            quote=("As with base breakouts, proper pocket pivots should emerge "
                   "within or out of constructive basing patterns."),
            source_id=_KACHER, confidence="high",
            missing=("No computable definition of 'constructive' or of "
                     "'wedging' exists in the authors' own text."),
        ),
    ),
    detect=_detect_pocket_pivot,
    coverage_pct=1.5,
)


# ── Power Play / High Tight Flag (Mark Minervini) ──────────────────────────
# ⚠️ THE SAME PATTERN UNDER TWO NAMES, WITH DIFFERENT PUBLISHED TOLERANCES.
# Minervini names the equivalence himself ("the power play, also referred to as
# the high tight flag"), but his numbers and O'Neil/IBD's differ at BOTH ends:
# he publishes 100%+ within 8 weeks and a <=20% flag over 3-6 weeks; the IBD
# figures usually quoted are 100-120% in 4-8 weeks with a 10-25% flag over 3-5
# weeks. A 95%-in-8-weeks name passes one and fails the other. The corpus could
# not fetch an IBD primary, so NO IBD number is asserted here — only Minervini's
# verbatim figures are implemented, and the conflict is recorded, not averaged.

_MINERVINI = "minervini_ttlac_2017"   # "Think & Trade Like a Champion" (2017), Section 7

POWER_THRUST_PCT = 1.00      # sourced — "up 100 percent or more"
POWER_THRUST_BARS = 40       # sourced — "within eight weeks" (~40 sessions)
POWER_MAX_DEPTH = 0.20       # sourced — "not correcting more than 20 percent"
POWER_MIN_CONSOL = 10        # sourced — "some can emerge after only 10 or 12 days"
POWER_MAX_CONSOL = 30        # sourced — "three to six weeks"


def _detect_power_play(ctx) -> bool:
    """An explosive thrust, then a shallow tight consolidation.

    ⚠️ Minervini does not say whether the 100% is measured close-to-close,
    low-to-high, or base-low-to-thrust-high. CLOSE-TO-CLOSE is ours, recorded
    below — and it is the most conservative of the three, so it under-counts
    rather than manufacturing thrusts.
    """
    bars = ctx.bars
    if len(bars) < POWER_THRUST_BARS + POWER_MAX_CONSOL + 2:
        return False
    n = len(bars)

    # The consolidation starts at the highest high of the recent window.
    window_start = n - 1 - POWER_MAX_CONSOL
    hi_i = max(range(window_start, n), key=lambda i: bars[i].get("h") or 0)
    consol_len = n - 1 - hi_i
    if not (POWER_MIN_CONSOL <= consol_len <= POWER_MAX_CONSOL):
        return False
    if hi_i - POWER_THRUST_BARS < 0:
        return False

    closes = [b.get("c") or 0 for b in bars]
    base_close = closes[hi_i - POWER_THRUST_BARS]
    if base_close <= 0:
        return False
    if closes[hi_i] / base_close - 1.0 < POWER_THRUST_PCT:
        return False

    thrust_high = bars[hi_i].get("h") or 0
    lows = [b.get("l") for b in bars[hi_i:] if (b.get("l") or 0) > 0]
    if thrust_high <= 0 or not lows:
        return False
    depth = (thrust_high - min(lows)) / thrust_high
    return depth <= POWER_MAX_DEPTH


POWER_PLAY = Structure(
    key="power-play",
    label="Power Play",
    axis="relation",
    family="Momentum Continuation",
    bias="bullish",
    rank=40,
    min_bars=POWER_THRUST_BARS + POWER_MAX_CONSOL + 2,
    desc=("A doubling inside eight weeks, then a shallow sideways range that "
          "has held within a fifth of the thrust high."),
    criteria=(
        Criterion(
            condition="Prior advance and its window",
            value="100%+ within 8 weeks",
            quote=("An explosive price move on huge volume that propels the "
                   "stock price up 100 percent or more within eight weeks."),
            source_id=_MINERVINI, confidence="high",
        ),
        Criterion(
            condition="Consolidation depth ceiling",
            value=POWER_MAX_DEPTH,
            quote=("the stock price moves sideways in a relatively tight "
                   "range, not correcting more than 20 percent"),
            source_id=_MINERVINI, confidence="high",
        ),
        Criterion(
            condition="Consolidation duration",
            value="3 to 6 weeks; some emerge after only 10 or 12 days",
            quote=("over a period of three to six weeks (some can emerge "
                   "after only 10 or 12 days)"),
            source_id=_MINERVINI, confidence="high",
        ),
        Criterion(
            condition=("⭐ THE 10% VCP WAIVER IS SCOPED TO THIS SETUP, NOT TO "
                       "EVERY BASE. It is published as the third bullet of the "
                       "Power Play list; applying it to all bases is an "
                       "extension beyond the source. Not yet consumed here — "
                       "no contraction-sequence test exists to waive."),
            value=0.10,
            quote=("If the correction in the base, from high to low, does not "
                   "exceed 10 percent, it is not necessary to see price "
                   "tightening in the form of a volatility contraction, "
                   "because the price is already tight enough."),
            source_id=_MINERVINI, confidence="high",
        ),
        Criterion(
            condition=("How the 100% is measured — close-to-close vs low-to-high "
                       "vs base-low-to-thrust-high. Ours: CLOSE-TO-CLOSE, the "
                       "most conservative of the three, so it under-counts "
                       "rather than manufacturing thrusts. The book does not say."),
            value="close-to-close",
            origin="uct", confidence="high",
        ),
        Criterion(
            condition="Depth allowance for lower-priced names",
            value=None,
            quote="some lower-priced stocks can correct as much as 25 percent",
            source_id=_MINERVINI, confidence="high",
            missing=("'Lower-priced' is never defined — no price threshold is "
                     "published — so the 25% branch is not implementable and "
                     "the flat 20% ceiling applies to every name."),
        ),
        Criterion(
            condition="'Huge volume' on the thrust",
            value=None,
            quote="An explosive price move on huge volume",
            source_id=_MINERVINI, confidence="high",
            missing="No volume multiple and no averaging window for 'huge'.",
        ),
        Criterion(
            condition="Stage-1 quiescence before the thrust",
            value=None,
            quote=("The best power plays are stocks that were quiet in Stage 1 "
                   "and then suddenly explode."),
            source_id=_MINERVINI, confidence="high",
            missing="No threshold for 'quiet' — no range or volume figure.",
        ),
        Criterion(
            condition="Tight weekly closes across the consolidation",
            value=None,
            quote=("With a power play, you should look for tight weekly closes "
                   "over three to six weeks."),
            source_id=_MINERVINI, confidence="high",
            missing="No numeric weekly close-to-close range is published.",
        ),
        Criterion(
            condition=("⚠️ CONFLICT, RECORDED NOT RESOLVED: O'Neil/IBD publish "
                       "the same pattern as the High Tight Flag with different "
                       "tolerances (commonly quoted 100-120% in 4-8 weeks, "
                       "10-25% flag over 3-5 weeks). The corpus could not fetch "
                       "an IBD primary, so no IBD number is asserted and only "
                       "Minervini's verbatim figures are implemented."),
            value="minervini-figures-only",
            origin="uct", confidence="high",
        ),
    ),
    detect=_detect_power_play,
    #: 5 of 3,707 (0.13%) — verdict `thin`, and CORRECT. A doubling inside
    #: eight weeks followed by a sub-20% flag is genuinely rare. Independent
    #: cross-check: the pattern engine's own separately-written
    #: `high_tight_flag` detector fires on 8 symbols over the same universe.
    #: Two independent implementations of one pattern landing at 5 and 8 is a
    #: meaningful agreement — Nekrasov's implementation of LMW's PUBLISHED
    #: algorithm diverged from theirs by 15x.
    coverage_pct=0.13,
)



# ── Weinstein stage structures ─────────────────────────────────────────────
# ⚠️⚠️ THE VOLUME RULE IS ASYMMETRIC BY DESIGN, AND THIS IS THE SINGLE MOST
# MIS-IMPLEMENTED FACT IN THE METHOD. A Stage 2 BREAKOUT without volume
# expansion is disqualified; a Stage 4 BREAKDOWN without it is not --
# "Volume is not the key to this stage because it can be heavy or light as
# price drops" and "This is not necessary on the short side." A screener that
# applies one symmetric volume filter to both is not implementing Weinstein.

_WEINSTEIN = "weinstein_secrets"   # "Secrets for Profiting in Bull and Bear Markets"

MA_WEEKS = 30            # sourced
BREAKOUT_VOL_MULT = 2.0  # sourced (form A) -- see the conflict recorded below
VOL_AVG_WEEKS = 4        # sourced -- "the average for the previous month"


def _iso_week_key(t):
    import datetime as _dt
    v = int(t)
    if 10_000_000 <= v <= 99_999_999:
        d = _dt.date(v // 10000, (v // 100) % 100, v % 100)
    else:
        d = _dt.date.fromtimestamp(v)
    return d.isocalendar()[:2]


def _weekly_closes(bars) -> list:
    """The last close of each ISO week, oldest first.

    ⚠️ CLOSES ONLY -- this is NOT a bar resample and does not pretend to be.
    `bars_fetch._resample_weekly_iso` owns what a weekly CANDLE is, and the
    stable-Friday-key rationale that goes with it; this computes the input to a
    moving average, so it is not a second authority on resampling.

    ⛔ Weinstein's average is explicitly built on WEEKLY CLOSES, not a 150-day
    average: "Based on Friday night closes only (not traditional 50-day or
    150-day MAs)." The two are routinely treated as interchangeable and the
    source says plainly that they are not.
    """
    seen = {}
    for b in bars:
        c = b.get("c") or 0
        if c > 0:
            seen[_iso_week_key(b["t"])] = c
    return [seen[k] for k in sorted(seen)]


def _weekly_volumes(bars) -> list:
    """Summed volume per ISO week, oldest first."""
    agg = {}
    for b in bars:
        k = _iso_week_key(b["t"])
        agg[k] = agg.get(k, 0) + (b.get("v") or 0)
    return [agg[k] for k in sorted(agg)]


def _ma_state(bars):
    """(latest 30-week MA, previous 30-week MA, latest weekly close) or None."""
    wc = _weekly_closes(bars)
    if len(wc) < MA_WEEKS + 1:
        return None
    cur = sum(wc[-MA_WEEKS:]) / MA_WEEKS
    prev = sum(wc[-MA_WEEKS - 1:-1]) / MA_WEEKS
    return cur, prev, wc[-1]


def _detect_stage2_breakout(ctx) -> bool:
    """Above a non-declining 30-week MA, clearing the last swing high, on a
    week of expanded volume."""
    st = _ma_state(ctx.bars)
    if st is None:
        return False
    ma, ma_prev, close = st
    if close <= ma:
        return False
    # ⛔ "must NOT be declining" -- flat qualifies. The book's BUY test and its
    # Stage 2 NARRATIVE disagree (the narrative says "rising") and both are
    # published by the same author. The buy test is what is implemented here;
    # the conflict is recorded as a criterion rather than silently resolved.
    if ma < ma_prev:
        return False

    highs = [sw for sw in ctx.swings if sw["type"] == "high"]
    if not highs or close <= highs[-1]["price"]:
        return False

    wv = _weekly_volumes(ctx.bars)
    if len(wv) < VOL_AVG_WEEKS + 1:
        return False
    base = sum(wv[-VOL_AVG_WEEKS - 1:-1]) / VOL_AVG_WEEKS
    return base > 0 and wv[-1] >= BREAKOUT_VOL_MULT * base


def _detect_stage4_breakdown(ctx) -> bool:
    """Below a DECLINING 30-week MA, breaking the last swing low.

    ⛔ NO VOLUME FILTER, AND THAT IS NOT AN OMISSION -- see the block comment.
    """
    st = _ma_state(ctx.bars)
    if st is None:
        return False
    ma, ma_prev, close = st
    if close >= ma or ma >= ma_prev:
        return False
    lows = [sw for sw in ctx.swings if sw["type"] == "low"]
    return bool(lows) and close < lows[-1]["price"]


STAGE2_BREAKOUT = Structure(
    key="stage-2-breakout", label="Stage 2 Breakout", axis="relation",
    family="Stage / Trend", bias="bullish", rank=50, min_bars=260,
    desc=("Price has cleared its last swing high while holding above a 30-week "
          "average that is not declining, on a week of expanded volume."),
    criteria=(
        Criterion(
            condition="Moving average period and type",
            value="30-week simple, on weekly closes",
            quote="Draw a 30-week (150-day) simple moving average on charts.",
            source_id=_WEINSTEIN, confidence="high"),
        Criterion(
            condition=("Built on WEEKLY CLOSES, not a 150-day average -- the two "
                       "are routinely treated as interchangeable and are not"),
            value="friday-closes",
            quote=("Based on Friday night closes only (not traditional 50-day "
                   "or 150-day MAs)."),
            source_id=_WEINSTEIN, confidence="high"),
        Criterion(
            condition="Price above the MA, and the MA not declining",
            value="close > ma and ma >= prior_ma",
            quote=("they must move above their 30-week MA, and the 30-week MA "
                   "must not be declining."),
            source_id=_WEINSTEIN, confidence="high"),
        Criterion(
            condition=("CONFLICT RECORDED, NOT RESOLVED: the BUY test says "
                       "'must not be declining' (flat qualifies) while the "
                       "Stage 2 NARRATIVE says 'rising'. Same author, both "
                       "published. We implement the buy test, the more literal."),
            value="not-declining", origin="uct", confidence="high"),
        Criterion(
            condition="Breakout volume, one-week spike form",
            value="2x the previous month's average",
            quote=("He wants to see a weekly volume spike that is at least "
                   "twice the average for the previous month"),
            source_id=_WEINSTEIN, confidence="high"),
        Criterion(
            condition=("CONFLICT RECORDED: the volume multiple is published in "
                       "at least four incompatible forms -- 2x the prior four "
                       "weeks, a 3-4 week build-up at 2x then a further rise, "
                       "3x daily average, and the author's own later interview "
                       "figure of 3x 'normal' with no window defined. We "
                       "implement the one-week spike; the rest are NOT averaged."),
            value="form-a-only", origin="uct", confidence="high"),
        Criterion(
            condition="Minimum weeks spent under the resistance",
            value=None,
            quote=("The longer the time spent below the resistance, the more "
                   "significant is the eventual breakout"),
            source_id=_WEINSTEIN, confidence="med",
            missing=("Stated as monotone, never as a threshold -- no minimum "
                     "number of weeks is published.")),
        Criterion(
            condition="How far above the breakout counts as chasing",
            value=None,
            quote="Don't chase a stock that you've missed",
            source_id=_WEINSTEIN, confidence="high",
            missing="No percentage extension is published."),
    ),
    detect=_detect_stage2_breakout,
    #: 21 of 3,541 (0.59%) -- `thin`, and correct. A FRESH Stage 2
    #: breakout is a single-week event: the volume spike, the swing-high
    #: clearance and the non-declining MA have to coincide on the one
    #: week being read. Compare Stage 4 below at 7.94%, which is a STATE
    #: rather than an event and is correspondingly common.
    coverage_pct=0.59,
)

STAGE4_BREAKDOWN = Structure(
    key="stage-4-breakdown", label="Stage 4 Breakdown", axis="relation",
    family="Stage / Trend", bias="bearish", rank=60, min_bars=260,
    desc=("Price has broken its last swing low and sits beneath a 30-week "
          "average that is itself declining."),
    criteria=(
        Criterion(
            condition="Price below a declining 30-week MA",
            value="close < ma and ma < prior_ma",
            quote=("The stock breaks down below Stage 3 trading range and below "
                   "the 30-week moving average in Stage 4, and continues to "
                   "decline mostly below the 30 week moving average."),
            source_id=_WEINSTEIN, confidence="high"),
        Criterion(
            condition=("VOLUME IS NOT REQUIRED -- the asymmetry most "
                       "implementations get wrong. A Stage 2 breakout without "
                       "volume expansion is disqualified; this is not."),
            value="no-volume-gate",
            quote=("Volume is not the key to this stage because it can be "
                   "heavy or light as price drops."),
            source_id=_WEINSTEIN, confidence="high"),
        Criterion(
            condition="Head-and-shoulders top reliability",
            value=None,
            quote="confirmed in around two-thirds of cases",
            source_id=_WEINSTEIN, confidence="med",
            missing=("The only quasi-statistic in Weinstein's material, and it "
                     "ships with no sample size, no period and no base rate. "
                     "Two-thirds of what population, over what years, against "
                     "what unconditional decline rate -- none is given. Not "
                     "usable as an expectancy.")),
    ),
    detect=_detect_stage4_breakdown,
    #: 281 of 3,541 (7.94%). Higher than Stage 2 by design, not by
    #: accident: this is a STATE (below a declining average, under the
    #: last swing low) where Stage 2 is an EVENT, and it carries no
    #: volume gate because the source explicitly refuses one.
    coverage_pct=7.94,
)


# -- Flat Base (William J. O'Neil / IBD) ------------------------------------
# The cheapest of the IBD bases to detect and the one E2 (Base-on-Base) needs,
# because base-on-base is defined by its relationship to a PRIOR base's pivot.

_IBD_FLAT = "ibd_flat_base"   # IBD editorial, "Flat Base Is A Simple Pattern..."

#: 5 weeks x 5 sessions. SOURCED.
FLAT_MIN_BARS = 25

#: Intraday peak to intraday trough. SOURCED, and the measurement basis is
#: sourced too -- IBD is explicit that it is high-to-low, not close-to-close,
#: which is one of the few places the house names its price series. Using
#: weekly closes here would UNDER-measure depth and admit bases IBD rejects.
FLAT_MAX_DEPTH = 0.15

#: Ten cents above the base high. SOURCED, three separate IBD articles agree.
FLAT_PIVOT_PAD = 0.10

#: Ours: an upper bound on how far back the base may be sought, so a decade of
#: dead sideways price cannot be reported as one enormous "flat base".
FLAT_MAX_LOOKBACK = 260

#: OURS, and the house asked for it. IBD requires "tight trading" inside a flat
#: base and publishes no number, so this is our number serving their rule --
#: mean daily (high-low)/close across the base.
#: ⛔ MEASURED, NOT CHOSEN BY TASTE: the sourced 15% ceiling ALONE matched
#: 41.1% of the universe, above the 35% band at which `Compression Bar (NR4)`
#: was deleted for being uninformative. The tell was in the distribution --
#: median matched depth sat at 14.3%, i.e. hard against the ceiling, so the
#: published rule was admitting bases that are the opposite of tight.
FLAT_MAX_TIGHTNESS = 0.025

#: OURS. A flat base is a REST IN AN ADVANCE -- IBD places it "as a second or
#: third base in a stock's major advance" -- so a stock that never advanced is
#: not forming one, it is merely dead sideways. The 20% figure has only
#: third-party corroboration (a summary of O'Neil, not IBD editorial), so the
#: number is recorded as ours rather than dressed in the house's name.
FLAT_PRIOR_ADVANCE = 0.20
FLAT_ADVANCE_LOOKBACK = 60

#: OURS, but DERIVED rather than picked. IBD's flat base is price that "moved
#: horizontally"; the published rules bound the base's HEIGHT and say nothing
#: about its SLOPE, so a smooth advance sits happily inside a 15% band and was
#: being labelled a flat base -- a defect a FIXTURE caught, not the universe
#: sweep, because 41% coverage hid it perfectly.
#: A base that drifts monotonically by D has depth at least D, so for the shape
#: to be a consolidation rather than a trend the drift must be a MINORITY of
#: the permitted depth. Two-thirds is that minority, and it lands on the
#: measured separation: a pure 50% advance drifts 15.2% and is refused, while
#: the real universe keeps 3.8%.
FLAT_MAX_DRIFT = FLAT_MAX_DEPTH * 2.0 / 3.0

#: SOURCED IN SHAPE, ours in number. IBD counts a flat base from the first DOWN
#: week -- "Usually, start counting with the first down week on a weekly chart."
#: A base therefore OPENS AT ITS HIGH: the top is where the rest begins, not
#: somewhere in the middle. That is what stops the window running back into the
#: advance the base is resting, and it is a statement about where the base
#: STARTS, so it belongs in choosing the window rather than in judging the
#: symbol. As a gate it would have cost more than half the population (4.6% ->
#: 2.0%); as a window rule it costs almost nothing and makes the reported base
#: length honest.
FLAT_HEAD_BARS = 5              # one week
FLAT_HEAD_REACH = 0.97


def _head_max_array(bars) -> list:
    """`out[i]` = the highest high over `bars[i : i+FLAT_HEAD_BARS]`.

    ⛔ A MONOTONIC DEQUE, NOT A NESTED LOOP, AND CACHED BY THE CALLER. The
    first version rebuilt this with an inner `max()` over a 5-bar slice for
    every bar -- O(n x 5) allocations -- and `base_on_base_state` calls
    `flat_base_state` a dozen times per anchor over the SAME series, so the
    ledger scan recomputed an identical array twelve times per anchor and the
    base-on-base measurement ran for forty minutes without finishing. The
    array depends only on the bars, so it is built once and passed down.
    """
    n = len(bars)
    out = [0.0] * n
    dq: list = []              # indices, highs decreasing
    for i in range(n - 1, -1, -1):
        h = bars[i].get("h") or 0.0
        while dq and (bars[dq[-1]].get("h") or 0.0) <= h:
            dq.pop()
        dq.append(i)
        if dq[0] - i >= FLAT_HEAD_BARS:
            dq.pop(0)
        out[i] = bars[dq[0]].get("h") or 0.0
    return out


def flat_base_state(bars, end: Optional[int] = None,
                    head_max: Optional[list] = None) -> Optional[dict]:
    """The LONGEST horizontal base ending at the last bar, or None.

    The window extends backwards while it stays BOTH within the depth ceiling
    and horizontal. Depth is monotone non-decreasing in the window length --
    widening can only raise the high or lower the low, and `1 - low/high` moves
    one way -- so the first depth violation is final and bounds the search.
    Drift is NOT monotone, so every length up to that bound is tested and the
    longest qualifying one wins.

    ⛔⛔ DRIFT BELONGS IN THE WINDOW SELECTION, NOT ONLY IN THE VERDICT. The
    first version chose the longest window inside the 15% ceiling and then
    asked whether it was horizontal. On a base that rests an advance -- which
    is the ONLY kind IBD describes -- that greedily swallowed the tail of the
    advance itself, so the base it measured was part trend and its drift was
    the trend's. The structure was then refused for a property of a window it
    should never have chosen.

    ⭐⭐ NO RECENCY GATE IS NEEDED, AND THAT IS THE POINT. The window is
    ANCHORED to the last bar, so the base is either in place now or it is not.
    `darvas-box` and `green-line-breakout` each had to grow an age bound after
    the coverage harness caught them reporting long-dead structures (96.7% of
    the universe, and a median 74-session-old breakout). Making "current"
    structural rather than a threshold is the cheaper fix, and it cannot drift.
    """
    if end is not None:
        bars = bars[:end]
    n = len(bars)
    if n < FLAT_MIN_BARS:
        return None

    if head_max is None:
        head_max = _head_max_array(bars)

    hi, lo, best = 0.0, float("inf"), None
    # Running sums for a least-squares fit in j, where j counts BACKWARDS from
    # the last bar. Prepending a bar is then an O(1) update, which keeps the
    # whole scan linear instead of quadratic over 3,705 symbols.
    s1 = sj = sjj = sjy = 0.0
    for k in range(1, min(n, FLAT_MAX_LOOKBACK) + 1):
        b = bars[n - k]
        h, l, c = b.get("h") or 0, b.get("l") or 0, b.get("c") or 0
        if h <= 0 or l <= 0 or c <= 0:
            break
        j = k - 1
        s1 += c
        sj += j
        sjj += j * j
        sjy += j * c
        hi, lo = max(hi, h), min(lo, l)
        if k < FLAT_MIN_BARS:
            continue
        depth = (hi - lo) / hi if hi > 0 else 1.0
        if depth > FLAT_MAX_DEPTH:
            break
        den = k * sjj - sj * sj
        mean = s1 / k
        if den <= 0 or mean <= 0:
            continue
        slope = (k * sjy - sj * s1) / den
        drift = abs(slope * (k - 1)) / mean
        if drift > FLAT_MAX_DRIFT:
            continue
        # The base must OPEN at its high -- IBD counts from the first down
        # week. Without this the window ran back through the advance the base
        # rests on: a 30-bar consolidation after a 50% advance was reported as
        # 50 bars, 20 of them trend.
        if head_max[n - k] < FLAT_HEAD_REACH * hi:
            continue
        best = {"bars": k, "high": hi, "low": lo, "depth": depth,
                "pivot": hi + FLAT_PIVOT_PAD, "drift": drift}
    if best is None:
        return None
    best["tightness"] = _base_tightness(bars, best["bars"])
    best["prior_advance"] = _prior_advance(bars, best["bars"])
    return best


def _base_tightness(bars, k) -> float:
    """Mean daily range as a fraction of close, across the base."""
    vals = [((b["h"] - b["l"]) / b["c"]) for b in bars[-k:]
            if (b.get("c") or 0) > 0 and b.get("h") and b.get("l")]
    return (sum(vals) / len(vals)) if vals else 1.0


def _prior_advance(bars, k, look: int = FLAT_ADVANCE_LOOKBACK):
    """Gain from the pre-base trough into the base's first bar, or None."""
    start = len(bars) - k
    pre = bars[max(0, start - look):start]
    if len(pre) < 20:
        return None
    lows = [b["l"] for b in pre if (b.get("l") or 0) > 0]
    entry = bars[start].get("c") or 0
    if not lows or entry <= 0:
        return None
    lo = min(lows)
    return ((entry - lo) / lo) if lo > 0 else None


def flat_base_qualifies(st: Optional[dict]) -> bool:
    """Does a base state clear every gate the Flat Base structure applies?

    ⛔⛔ ONE DEFINITION, ONE PLACE. `flat_base_state` finds the SHAPE; these
    gates decide whether the shape is a flat base. When the gates lived only
    inside the detector, `base_on_base_state` composed on the raw shape and so
    accepted second bases that Flat Base itself refuses -- the composed
    structure matched 21.2% of the universe while its own component matched
    4.5%. A structure built out of another must not be looser than the thing
    it is built from, and the only way to guarantee that is for both to ask
    the same function.
    """
    if st is None:
        return False
    if st["tightness"] > FLAT_MAX_TIGHTNESS:
        return False
    if st["drift"] > FLAT_MAX_DRIFT:
        return False
    return (st["prior_advance"] or 0.0) >= FLAT_PRIOR_ADVANCE


def _detect_flat_base(ctx) -> bool:
    """A TIGHT base that is resting an advance -- not merely a quiet stretch.

    ⛔ The extra gates are ours and every one is load-bearing. Measured over
    3,705 symbols: the sourced rules alone matched 41.1%; + tightness 26.4%;
    + prior advance 4.8%; + horizontality and the opening-high rule 4.5%. A
    label two-fifths of the market carries would say nothing, and that is the
    failure the coverage harness was built after.
    """
    return flat_base_qualifies(flat_base_state(ctx.bars))


FLAT_BASE = Structure(
    key="flat-base",
    label="Flat Base",
    axis="relation",
    family="Base Structure",
    bias="neutral",
    rank=15,
    min_bars=FLAT_MIN_BARS,
    desc=("A tight sideways consolidation at least five weeks long that has "
          "corrected no more than 15% from its intraday high to its intraday "
          "low. The pivot is ten cents above the base high."),
    criteria=(
        Criterion(
            condition="Base length, minimum",
            value=FLAT_MIN_BARS,
            quote=("It needs at least five weeks to form. Shorter patterns are "
                   "not adequate enough to flush out weak or impatient "
                   "shareholders."),
            source_id=_IBD_FLAT, confidence="high",
        ),
        Criterion(
            condition="Base depth, maximum",
            value=FLAT_MAX_DEPTH,
            quote=("The stock's price declines no more than 15% from its "
                   "intraday peak to intraday trough."),
            source_id=_IBD_FLAT, confidence="high",
        ),
        Criterion(
            condition=("Depth is measured INTRADAY high to INTRADAY low, not "
                       "close to close"),
            value="high-to-low",
            quote="from its intraday peak to intraday trough",
            source_id=_IBD_FLAT, confidence="high",
        ),
        Criterion(
            condition=("CONFLICT, recorded not averaged: the same house "
                       "publishes both a plain 15% ceiling and a tighter "
                       "10-15% band. We implement 15% and say so."),
            value="10-15% vs 15%",
            quote=("Still, look for consolidation areas that are at least five "
                   "weeks long and fall no more than 10% to 15%."),
            source_id=_IBD_FLAT, confidence="high",
        ),
        Criterion(
            condition="Pivot / buy point",
            value=FLAT_PIVOT_PAD,
            quote=("The optimal [buy point] is determined by finding the "
                   "highest price in the pattern and adding 10 cents to it."),
            source_id=_IBD_FLAT, confidence="high",
        ),
        Criterion(
            condition="Tightness of trade within the base",
            value=None,
            quote="Flat bases should show tight trading.",
            source_id=_IBD_FLAT, confidence="high",
            missing=("The house requires tight trading and publishes NO number "
                     "for it -- no maximum weekly range, no close dispersion. "
                     "Any tightness gate here would be ours wearing IBD's "
                     "name, so there is none."),
        ),
        Criterion(
            condition=("Base stage -- usually the second or third base of an "
                       "advance. A FREQUENCY statement, never a disqualifier."),
            value="second-or-third",
            quote=("Flat bases tend to form as a second or third base in a "
                   "stock's major advance... Rarely, flat bases are the first "
                   "base."),
            source_id=_IBD_FLAT, confidence="high",
        ),
        Criterion(
            condition="Search horizon for the base start",
            value=FLAT_MAX_LOOKBACK,
            origin="uct", confidence="high",
        ),
        Criterion(
            condition=("Tightness ceiling -- mean daily range / close. OURS, "
                       "supplying the number the house requires and never "
                       "publishes. Measured: sourced rules alone matched 41.1% "
                       "of the universe; with this, 26.4%."),
            value=FLAT_MAX_TIGHTNESS,
            origin="uct", confidence="high",
        ),
        Criterion(
            condition=("Prior advance into the base. OURS. A flat base rests an "
                       "advance; without this the label also lands on stocks "
                       "that never advanced. Measured: 26.4% -> 4.8%."),
            value=FLAT_PRIOR_ADVANCE,
            origin="uct", confidence="high",
        ),
        Criterion(
            condition="Where the base is counted from",
            value="first-down-week",
            quote="Usually, start counting with the first down week on a weekly chart.",
            source_id=_IBD_FLAT, confidence="high",
        ),
        Criterion(
            condition=("How much of its high the base's first week must reach, "
                       "which is how the rule above is made computable. OURS -- "
                       "the house says where counting starts and never says how "
                       "close to the high that is. It chooses where the base "
                       "STARTS rather than which symbols qualify: as a verdict "
                       "gate it cost more than half the population (4.6% -> "
                       "2.0%); as a window rule it costs ~0.2pp and stops the "
                       "base swallowing the advance it rests."),
            value=FLAT_HEAD_REACH,
            origin="uct", confidence="high",
        ),
        Criterion(
            condition=("Horizontality -- maximum fitted drift across the base, "
                       "DERIVED as two-thirds of the sourced depth ceiling. "
                       "OURS. The published rules bound the base's height and "
                       "not its slope, so a smooth advance sat inside a 15% "
                       "band and read as a flat base. Measured: 4.8% -> 3.8%."),
            value=FLAT_MAX_DRIFT,
            origin="uct", confidence="high",
        ),
    ),
    coverage_pct=4.5,
    detect=_detect_flat_base,
)


# -- Base on Base (William J. O'Neil / IBD) ---------------------------------
# The only IBD base defined by its RELATIONSHIP to a prior base rather than by
# its own shape, and the only one whose whole function is bookkeeping: it
# exists to stop the base count incrementing. The corpus is blunt about the
# half-implementation risk -- "a detector that finds the shape but does not
# feed the count has implemented half of it" -- so `base_stage_count` ships
# beside the predicate, not later.

_IBD_BOB = "ibd_base_on_base"       # IBD editorial on the base count
_MSI_BOB = "marketsmith_india_bob"  # MarketSmith India (affiliated, not IBD)

#: The defining number, and the most consistently stated figure in the whole
#: IBD taxonomy. SOURCED.
BOB_MAX_GAIN = 0.20

#: Ours: how far back a prior base may be sought, and the step of that search.
#: The two bases are stacked, so the gap between them is the FAILED advance --
#: short by construction, since it gained less than 20%.
BOB_MAX_GAP = 60
BOB_SEARCH_STEP = 5

#: Ours, and load-bearing. The prior base must be separated from the current
#: one by a real advance leg. Without this the backwards search slid its end
#: index INTO the advance, found a "base" that was really the trend's first
#: few bars, and measured the leg from there -- a 30% breakout came out as
#: 12% and a two-stage structure reported as a base-on-base. A truncated leg
#: understates the gain, and understating the gain is the direction that
#: wrongly COLLAPSES two stages into one.
BOB_MIN_LEG = 10


def base_on_base_state(bars) -> Optional[dict]:
    """A base sitting on a prior base whose breakout gained less than 20%.

    THE 20% IS MEASURED FROM THE PIVOT, NOT FROM THE BASE LOW. The corpus
    flags this precisely: measuring from the low inflates the gain and would
    silently reclassify base-on-bases as two separate stages -- which is the
    one thing this structure exists to prevent.
    """
    head_max = _head_max_array(bars)
    b2 = flat_base_state(bars, head_max=head_max)
    if not flat_base_qualifies(b2):
        return None
    n = len(bars)
    start2 = n - b2["bars"]
    if start2 < FLAT_MIN_BARS:
        return None

    top = start2 - BOB_MIN_LEG
    floor = max(FLAT_MIN_BARS, start2 - BOB_MAX_GAP)
    for e1 in range(top, floor - 1, -BOB_SEARCH_STEP):
        b1 = flat_base_state(bars, end=e1, head_max=head_max)
        if not flat_base_qualifies(b1):
            continue
        pivot1 = b1["pivot"]
        if pivot1 <= 0:
            continue
        # ⛔ THE PEAK IS TAKEN FROM THE PRIOR PIVOT TO NOW, NOT TO THE NEW
        # BASE'S START. The advance's high often lands while the second base
        # is forming, so truncating at `start2` clips it -- and a clipped peak
        # understates the gain, which is the direction that wrongly turns two
        # stages into one.
        highs = [b.get("h") or 0 for b in bars[e1:]]
        if not highs:
            continue
        peak = max(highs)
        if peak <= pivot1:
            continue                      # the first base never broke out
        gain = (peak - pivot1) / pivot1
        if gain >= BOB_MAX_GAIN:
            continue                      # a full stage: two bases, not one
        return {"gain": gain, "pivot1": pivot1, "peak": peak,
                "base1_bars": b1["bars"], "base2_bars": b2["bars"],
                "pivot2": b2["pivot"], "stages": 1}
    return None


#: Ours: how deep a stack of bases is walked. Six is far past any real base
#: count; the bound exists so a pathological series cannot loop.
BOB_MAX_STACK = 6


def base_stack(bars, max_bases: int = BOB_MAX_STACK) -> list:
    """The stack of bases ending at, and behind, the last bar. Newest first."""
    out, end = [], len(bars)
    head_max = _head_max_array(bars)
    while len(out) < max_bases:
        b = flat_base_state(bars, end=end, head_max=head_max)
        if not flat_base_qualifies(b):
            break
        start = end - b["bars"]
        out.append({"start": start, "end": end, "base": b})
        # Step back past a minimum advance leg for the same reason
        # `base_on_base_state` does: searching from `start` itself lets the
        # next window slide into the advance and report the trend's first bars
        # as a base.
        end = start - BOB_MIN_LEG
        if end < FLAT_MIN_BARS:
            break
    return out


def base_stage_count(bars) -> int:
    """How many STAGES the current stack of bases represents.

    THE OTHER HALF OF THE PATTERN, and the reason it exists at all. IBD: "If
    the gain is less than 20% and the stock forms another base, it's a
    base-on-base pattern and counted as one stage." A detector that reports the
    shape and still counts two has implemented the geometry and discarded the
    point -- the whole function of this structure is to stop the base count
    incrementing, because base count is what tells a reader whether a setup is
    early or late in an advance.

    ⛔ The first version of this returned 1 for a base-on-base and 1 for a lone
    base, which is true and useless: it could not tell one stage from two, so
    it could not have been wrong. Adjacent bases are separated here by the
    advance between them, and only an advance of 20% or more off the older
    base's PIVOT opens a new stage.
    """
    stack = base_stack(bars)
    if not stack:
        return 0
    stages = 1
    for i in range(len(stack) - 1):
        newer_end = stack[i]["end"]
        older = stack[i + 1]
        pivot = older["base"]["pivot"]
        # Same span as `base_on_base_state`: from the older pivot through the
        # END of the newer base, so an advance that peaks while the newer base
        # forms is not clipped. The two must agree, or a structure could be a
        # base-on-base and still increment the count it exists to hold.
        highs = [b.get("h") or 0 for b in bars[older["end"]:newer_end]]
        peak = max(highs) if highs else 0.0
        if pivot > 0 and (peak - pivot) / pivot >= BOB_MAX_GAIN:
            stages += 1
    return stages


def _detect_base_on_base(ctx) -> bool:
    return base_on_base_state(ctx.bars) is not None


BASE_ON_BASE = Structure(
    key="base-on-base",
    label="Base on Base",
    axis="relation",
    family="Base Structure",
    bias="neutral",
    # ⛔ MUST OUTRANK `flat-base`, which it is built on. A base-on-base
    # requires a qualifying flat base, so the two ALWAYS fire together and the
    # renderer leads with the lower rank. At 16 it rendered as
    # "Flat Base (Base on Base)" -- the general statement leading the specific
    # one, on every symbol that had it.
    rank=13,
    min_bars=FLAT_MIN_BARS * 2,
    desc=("A second base formed directly on a first, because the breakout from "
          "the first gained less than 20% before the market turned it back. "
          "The pair counts as ONE stage, not two."),
    criteria=(
        Criterion(
            condition="Defining condition -- the prior breakout gained less than 20%",
            value=BOB_MAX_GAIN,
            quote=("If the gain is less than 20% and the stock forms another "
                   "base, it's a base-on-base pattern and counted as one stage."),
            source_id=_IBD_BOB, confidence="high",
        ),
        Criterion(
            condition="The gain is measured FROM THE PIVOT, not from the base low",
            value="from-pivot",
            quote=("A breakout needs to produce a gain of at least 20% in order "
                   "to be counted as one stage."),
            source_id=_IBD_BOB, confidence="high",
        ),
        Criterion(
            condition="Base-count treatment -- the pair counts as ONE stage",
            value=1,
            quote=("If a stock advances less than 20%, then forms another base, "
                   "it's all counted as one consolidation"),
            source_id=_IBD_BOB, confidence="high",
        ),
        Criterion(
            condition="Second base depth -- ideally 10-15%, rarely over 20%",
            value="10-20%",
            quote="Shallow depth (ideally 10-15%, rarely more than 20%).",
            source_id=_MSI_BOB, confidence="med",
        ),
        Criterion(
            condition="How far the second base may sink into the first",
            value=None,
            source_id=_IBD_BOB, confidence="high",
            missing=("No fetched source states a maximum overlap with a number "
                     "-- neither as a share of the first base's range nor as a "
                     "price level. The summarised rule is 'ideally not by "
                     "much', which is not a predicate. So we do not test it, "
                     "rather than inventing a bound and attributing it."),
        ),
        Criterion(
            condition="Minimum duration for each of the two bases",
            value=None,
            source_id=_IBD_BOB, confidence="high",
            missing=("Nothing published says whether each constituent base must "
                     "meet its own type's minimum or whether the pair has its "
                     "own. We apply the flat base's five weeks to each because "
                     "that is the detector we run, and this records that the "
                     "choice is ours."),
        ),
        Criterion(
            condition=("CONFLICT, recorded not resolved: entry volume. The "
                       "affiliate says merely 'above-average'; IBD uses 40% "
                       "above the 50-day everywhere else."),
            value="above-average vs +40%",
            quote="Enter as the stock clears the second base on above-average volume.",
            source_id=_MSI_BOB, confidence="med",
        ),
        Criterion(
            condition="Search horizon for the prior base",
            value=BOB_MAX_GAP,
            origin="uct", confidence="high",
        ),
    ),
    coverage_pct=0.6,
    detect=_detect_base_on_base,
)


# -- Cup with Handle (William J. O'Neil / IBD) ------------------------------
# The flagship base of the taxonomy. Geometry lives in
# `pattern_engine.primitives.cup`; what lives here is provenance -- which of
# its numbers a house published, which are ours, and which it declined to give.

_IBD_CUP = "ibd_cup_with_handle"     # IBD editorial / O'Neil, How to Make Money in Stocks
_IBD_HANDOUT = "ibd_handout"         # IBD teaching handout, provenance unverified
_BULKOWSKI = "bulkowski_cupwithhandle"


def _detect_cup_with_handle(ctx) -> bool:
    return cup.cup_with_handle_state(ctx.bars) is not None


CUP_WITH_HANDLE = Structure(
    key="cup-with-handle",
    label="Cup with Handle",
    axis="relation",
    family="Base Structure",
    bias="bullish",
    rank=12,
    min_bars=cup.CUP_MIN_BARS + cup.HANDLE_MIN_BARS,
    desc=("A U-shaped consolidation after a prior advance whose right side "
          "returns near the old high, then pauses in a short handle that "
          "drifts down along its lows. The pivot is ten cents above the "
          "handle's peak."),
    criteria=(
        Criterion(
            condition="Base length, minimum",
            value=cup.CUP_MIN_BARS,
            quote=("A proper cup base needs to span a minimum of seven weeks, "
                   "while a flat base can be as short as five weeks."),
            source_id=_IBD_CUP, confidence="high",
        ),
        Criterion(
            condition="Base length, observed range",
            value=cup.CUP_MAX_BARS,
            quote=("They range from seven weeks to as long as 65 weeks in "
                   "length, with many forming over three to six months."),
            source_id=_IBD_CUP, confidence="high",
        ),
        Criterion(
            condition="Base depth, normal band",
            value=(cup.CUP_MIN_DEPTH, cup.CUP_MAX_DEPTH),
            quote=("The size of the decline, or correction, in a cup base "
                   "should generally be between 12% and 33%."),
            source_id=_IBD_CUP, confidence="high",
        ),
        Criterion(
            condition=("Base depth, bear-market allowance. CONDITIONAL on a "
                       "regime the detector is not given, so it is an opt-in "
                       "argument and never the default -- silently applying it "
                       "would measure a different rule than the one published."),
            value=cup.CUP_BEAR_MAX_DEPTH,
            quote="In bear markets, cups can run as deep as 50%.",
            source_id=_IBD_CUP, confidence="high",
        ),
        Criterion(
            condition="Handle forms in the upper half of the base",
            value="upper-half",
            quote=("A proper handle forms in the upper half of a base and "
                   "drifts slightly downward along its price lows."),
            source_id=_IBD_CUP, confidence="high",
        ),
        Criterion(
            condition=("Handle drifts DOWN along its LOWS; an upward drift is "
                       "a named defect. Measured on the lows, not the closes -- "
                       "a handle can close flat while its lows step down, and "
                       "that is the shakeout the rule describes."),
            value="down-along-lows",
            quote="handle with an upward drift, a negative",
            source_id=_IBD_CUP, confidence="high",
        ),
        Criterion(
            condition="Handle within 15% of the old high",
            value=cup.HANDLE_WITHIN_OLD_HIGH,
            quote=("Handle should form in the upper half of the cup, and "
                   "within 15% of the old price high"),
            source_id=_IBD_HANDOUT, confidence="med",
        ),
        Criterion(
            condition="Handle depth",
            value=cup.HANDLE_MAX_DEPTH,
            quote="depth of the handle should be 10%-12%",
            source_id=_IBD_HANDOUT, confidence="med",
        ),
        Criterion(
            condition="Handle length, minimum",
            value=None,
            source_id=_IBD_CUP, confidence="high",
            missing=("No IBD source states a minimum handle duration. "
                     "Bulkowski publishes '1 week minimum with no maximum' -- "
                     "for HIS pattern, under HIS identification guidelines. "
                     "Importing it would put a number in O'Neil's mouth that "
                     "he never said, so the bounds we use are recorded "
                     "separately as ours."),
        ),
        Criterion(
            condition="Pivot / buy point",
            value=cup.PIVOT_PAD,
            quote="10 cents above the peak in the handle",
            source_id=_IBD_HANDOUT, confidence="med",
        ),
        Criterion(
            condition="Cup shape -- U, not V; no jagged weekly swings",
            value="smooth-U",
            quote=("Cups should show smooth action on the left and right sides "
                   "of the pattern. There shouldn't be jagged edges or many "
                   "wild weekly swings of 10% to 15% or more."),
            source_id=_IBD_CUP, confidence="high",
        ),
        Criterion(
            condition="Symmetry -- down weeks left roughly match up weeks right",
            value="roughly-symmetric",
            quote=("The base should be symmetrical in shape; the number of "
                   "down weeks on the left side should roughly match the "
                   "number of up weeks on the right side."),
            source_id=_IBD_CUP, confidence="high",
        ),
        Criterion(
            condition="Rim tolerance -- how near the old high the right side must return",
            value=None,
            source_id=_IBD_CUP, confidence="high",
            missing=("O'Neil says the right side returns 'near' the old high "
                     "and never quantifies it, and Bulkowski likewise says the "
                     "rims should be 'near the same price'. `rim_equality` is "
                     "therefore a continuous score and the cutoff below is "
                     "ours."),
        ),
        Criterion(
            condition="Accumulation vs distribution weeks inside the base",
            value=None,
            source_id=_IBD_CUP, confidence="high",
            missing=("The house states a DIRECTION -- 'you prefer to see weeks "
                     "of accumulation outnumber weeks of distribution' -- with "
                     "no ratio, and no OHLCV definition of an accumulation "
                     "week. A direction is not a predicate, so it is not "
                     "tested."),
        ),
        Criterion(
            condition=("Bulkowski's measured numbers are recorded and NOT used: "
                       "rank 3 of 39, 5% break-even failure, 54% average rise "
                       "on 913 'perfect trades'."),
            value=None,
            source_id=_BULKOWSKI, confidence="high",
            missing=("They are measured on HIS definition, not IBD's, and he "
                     "publishes no benchmark -- no all-stocks control over the "
                     "same window and no stated date range. An average rise "
                     "over an unstated horizon in a hand-selected sample of "
                     "PERFECT patterns is not comparable to anything. Our own "
                     "number, if we earn one, comes from the lift ledger."),
        ),
        Criterion(
            condition=("Prior uptrend before the base. ⛔ Omitting this does "
                       "not loosen the rule, it makes it a DIFFERENT rule: the "
                       "same geometry with no advance in front of it is a "
                       "stock that fell and recovered."),
            value=cup.CUP_PRIOR_UPTREND,
            quote="first leg should be up at least 30%",
            source_id=_IBD_HANDOUT, confidence="med",
        ),
        Criterion(
            condition=("Volume must EASE through the base and handle. A "
                       "direction, not a ratio -- the house publishes no "
                       "percentage, so the test is the direction alone."),
            value="eases",
            quote=("Volume should mostly ease until the breakout ... Turnover "
                   "fell sharply as it shaped a handle."),
            source_id=_IBD_CUP, confidence="high",
        ),
        Criterion(
            condition="Minimum roundness, separating a U from the named V failure",
            value=cup.MIN_ROUNDNESS,
            origin="uct", confidence="high",
        ),
        Criterion(
            condition="Minimum rim equality",
            value=cup.MIN_RIM_EQUALITY,
            origin="uct", confidence="high",
        ),
        Criterion(
            condition="Handle search bounds, in bars, and the rim width",
            value=(cup.HANDLE_MIN_BARS, cup.HANDLE_MAX_BARS, cup.RIM_BARS),
            origin="uct", confidence="high",
        ),
    ),
    coverage_pct=0.6,
    detect=_detect_cup_with_handle,
)


# -- Double Bottom, the "W" (William J. O'Neil / IBD) -----------------------
# ⭐⭐ THE ONE PATTERN WHERE TWO AUTHORITIES REQUIRE OPPOSITE THINGS OF THE
# SAME FEATURE. IBD REQUIRES the second low to undercut the first -- that
# shakeout is the pattern's whole purpose. Bulkowski and Edwards & Magee want
# the two lows at roughly the SAME price and treat an undercut as a flaw. Same
# name, contradictory definitions, and a detector cannot satisfy both. We
# implement IBD's, say so, and record theirs rather than quietly averaging the
# two into something neither house would recognise.

_IBD_DBL = "ibd_double_bottom"
_CLASSIC_DBL = "classic_ta_double_bottom"   # Bulkowski; Edwards & Magee

#: "Double bottoms must also be at least seven weeks in length."
DBL_MIN_BARS = 35

#: "Undercutting the first low by 5% to 10% or so is also acceptable."
DBL_MAX_UNDERCUT = 0.10

#: CONFLICT, unresolved: 30% (one handout) vs 40% (another). Both are med
#: confidence and they cannot both be the rule. We take the LOOSER, so the
#: gate refuses only what BOTH would refuse -- the same choice made for the
#: cup's handle depth, and for the same reason: when two published numbers
#: disagree, the tighter one would reject bases one of the sources accepts.
DBL_MAX_DEPTH = 0.40

#: "30% or more" prior uptrend (med confidence).
DBL_PRIOR_UPTREND = 0.30
DBL_UPTREND_LOOKBACK = 120

#: "the middle peak of the W plus a dime"
DBL_PIVOT_PAD = 0.10

#: Ours: the second low must be recent or the W is history, not a setup. Same
#: lesson `darvas-box` and `green-line-breakout` both had to learn -- without a
#: recency bound a walk simply reports wherever it ended.
DBL_MAX_AGE_BARS = 40


def double_bottom_state(ctx) -> Optional[dict]:
    """The current W, or None. Reads CONFIRMED swings only.

    ⛔ The undercut is the DEFINING feature, not a tolerance. A second low that
    fails to undercut the first is not a weak double bottom in IBD's sense --
    it is a different pattern, and one the classical authorities would call a
    proper double bottom. That disagreement is recorded in the criteria.
    """
    bars = ctx.bars
    lows, highs = ctx.lows, ctx.highs
    if len(lows) < 2 or not bars:
        return None

    low1, low2 = lows[-2], lows[-1]
    if low2["bar_index"] <= low1["bar_index"]:
        return None

    n = len(bars)
    if (n - 1) - low2["bar_index"] > DBL_MAX_AGE_BARS:
        return None

    p1, p2 = low1["price"], low2["price"]
    if p1 <= 0 or p2 <= 0:
        return None
    if p2 >= p1:
        return None                      # no undercut: not IBD's W
    if (p1 - p2) / p1 > DBL_MAX_UNDERCUT:
        return None                      # undercut far beyond the tolerated band

    mid = [h for h in highs
           if low1["bar_index"] < h["bar_index"] < low2["bar_index"]]
    if not mid:
        return None
    middle_peak = max(mid, key=lambda h: h["price"])

    # The base opens at the swing high before the first low.
    prior = [h for h in highs if h["bar_index"] < low1["bar_index"]]
    if not prior:
        return None
    start = prior[-1]
    length = (n - 1) - start["bar_index"]
    if length < DBL_MIN_BARS:
        return None

    top = start["price"]
    if top <= 0:
        return None
    depth = (top - p2) / top
    if depth > DBL_MAX_DEPTH:
        return None

    adv = _prior_advance(bars, n - start["bar_index"], look=DBL_UPTREND_LOOKBACK)
    if (adv or 0.0) < DBL_PRIOR_UPTREND:
        return None

    return {"low1": p1, "low2": p2, "undercut": (p1 - p2) / p1,
            "middle_peak": middle_peak["price"], "depth": depth,
            "bars": length, "prior_uptrend": adv,
            "pivot": middle_peak["price"] + DBL_PIVOT_PAD}


def _detect_double_bottom(ctx) -> bool:
    return double_bottom_state(ctx) is not None


DOUBLE_BOTTOM = Structure(
    key="double-bottom",
    label="Double Bottom",
    axis="relation",
    family="Base Structure",
    bias="bullish",
    rank=14,
    min_bars=DBL_MIN_BARS,
    desc=("A W: two down legs where the second undercuts the first, shaking "
          "out everyone who bought the first low. The pivot is ten cents "
          "above the middle peak."),
    criteria=(
        Criterion(
            condition="Base length, minimum",
            value=DBL_MIN_BARS,
            quote="Double bottoms must also be at least seven weeks in length.",
            source_id=_IBD_DBL, confidence="high",
        ),
        Criterion(
            condition=("The second leg MUST undercut the first. This is the "
                       "defining feature, not a preference."),
            value="undercut-required",
            quote=("The low of the second leg should fall slightly beneath the "
                   "low of the first leg."),
            source_id=_IBD_DBL, confidence="high",
        ),
        Criterion(
            condition="Tolerated undercut magnitude",
            value=DBL_MAX_UNDERCUT,
            quote="Undercutting the first low by 5% to 10% or so is also acceptable.",
            source_id=_IBD_DBL, confidence="high",
        ),
        Criterion(
            condition=("⭐ DIRECT CONTRADICTION BETWEEN AUTHORITIES, recorded "
                       "and NOT reconciled. The classical definition wants the "
                       "two lows at roughly the SAME price and treats an "
                       "undercut as a flaw; IBD REQUIRES the undercut. Same "
                       "pattern name, opposite requirement on the defining "
                       "feature. We implement IBD's and label it."),
            value="classical-forbids-what-IBD-requires",
            quote="Price variation between bottoms is small",
            source_id=_CLASSIC_DBL, confidence="high",
        ),
        Criterion(
            condition="Pivot / buy point -- the middle peak of the W",
            value=DBL_PIVOT_PAD,
            quote=("In a double bottom, the ideal time to buy shares is when "
                   "the stock crosses 10 cents above the middle peak between "
                   "the two lows."),
            source_id=_IBD_DBL, confidence="high",
        ),
        Criterion(
            condition=("CONFLICT on the depth ceiling: 30% and 40% are both "
                       "published, both med confidence, and they cannot both "
                       "be the rule. We take the LOOSER so the gate refuses "
                       "only what both sources would refuse."),
            value=DBL_MAX_DEPTH,
            quote="Max 30% ... 40% or less",
            source_id=_IBD_DBL, confidence="med",
        ),
        Criterion(
            condition="Prior uptrend before the base",
            value=DBL_PRIOR_UPTREND,
            quote="30% or more",
            source_id=_IBD_DBL, confidence="med",
        ),
        Criterion(
            condition="Early entry -- 'shakeout plus three'",
            value=None,
            quote="Add three points to the price of the first low.",
            source_id=_IBD_DBL, confidence="high",
            missing=("The 'plus three' and 'plus six' early entries are "
                     "absolute DOLLARS, and the house ties the choice to the "
                     "stock's price level ('80 to 100 a share'). Two sample "
                     "points do not define a function, so everything between "
                     "and beyond them is undefined and a naive percentage "
                     "conversion would invent the rule. Not implemented."),
        ),
        Criterion(
            condition="Breakout volume, double-bottom specific",
            value=None,
            quote=("look for a surge in [volume] as it clears the entry"),
            source_id=_IBD_DBL, confidence="high",
            missing=("The column states a surge with no percentage. A separate "
                     "handout gives 40-50% above average at med confidence, "
                     "which is the general rule rather than this base's."),
        ),
        Criterion(
            condition="Relative frequency versus the cup",
            value=None,
            quote="It tends to occur less frequently than the cup base",
            source_id=_IBD_DBL, confidence="high",
            missing="No count or rate is published, so this is not testable.",
        ),
        Criterion(
            condition="Maximum age of the second low, so the W is a setup and not history",
            value=DBL_MAX_AGE_BARS,
            origin="uct", confidence="high",
        ),
    ),
    coverage_pct=6.9,
    detect=_detect_double_bottom,
)


# -- High, Tight Flag (William J. O'Neil / IBD) -----------------------------
# ⚠️ THE HOUSE ITSELF SAYS "MANY FAIL". Every performance figure IBD publishes
# for this base -- 200%, 450%, 1,300% -- is a named winner, and by its own
# admission those examples are drawn from the surviving tail. They are
# recorded as refusals, never as expectancy.
#
# ⭐ RARITY IS THE SANITY RAIL, and the corpus says so outright: a screener
# emitting high tight flags at any meaningful daily rate is almost certainly
# mis-detecting, and the natural failure mode is a LOOSE FLAGPOLE ANCHOR. So
# the pole is anchored to a confirmed swing low, never to an arbitrary window
# edge -- otherwise the rule fires on any 40-day stretch inside a longer trend.

_IBD_HTF = "ibd_high_tight_flag"
_ONEIL_SUMMARY = "stockbee_oneil_summary"   # third-party summary, not IBD

#: "The stock begins by climbing 100% to 120% in four to eight weeks."
HTF_POLE_MIN_GAIN = 1.00
HTF_POLE_MAX_GAIN = 1.20
HTF_POLE_MIN_BARS = 20      # 4 weeks
HTF_POLE_MAX_BARS = 40      # 8 weeks

#: "Next, the stock corrects 10% to 25% in three to five weeks."
#: CONFLICT, minor and recorded: another column renders the same rule as
#: "usually 10% to 20% or sometimes 25%". The looser ceiling is used.
HTF_FLAG_MIN_DEPTH = 0.10
HTF_FLAG_MAX_DEPTH = 0.25
HTF_FLAG_MIN_BARS = 15      # 3 weeks
HTF_FLAG_MAX_BARS = 25      # 5 weeks


def high_tight_flag_state(ctx) -> Optional[dict]:
    """A near-doubling followed by a shallow, tight flag, or None.

    The pole is measured from a CONFIRMED SWING LOW to the highest high that
    follows it. Anchoring on a window edge instead is the mis-detection the
    corpus warns about: any 40-day slice of a long advance shows a big rise,
    so the rule would fire constantly on a pattern IBD calls rare.
    """
    bars = ctx.bars
    n = len(bars)
    if n < HTF_POLE_MIN_BARS + HTF_FLAG_MIN_BARS:
        return None

    for low in reversed(ctx.lows):
        origin = low["bar_index"]
        base_px = low["price"]
        if base_px <= 0:
            continue
        # The flag must END at the last bar, so the pole peak sits between
        # HTF_FLAG_MIN_BARS and HTF_FLAG_MAX_BARS back from now.
        first = max(origin + HTF_POLE_MIN_BARS, n - HTF_FLAG_MAX_BARS)
        last = min(origin + HTF_POLE_MAX_BARS, n - HTF_FLAG_MIN_BARS)
        if first > last:
            continue

        best = None
        for peak_i in range(first, last + 1):
            pole = bars[origin:peak_i + 1]
            highs = [b.get("h") or 0.0 for b in pole]
            if not highs:
                continue
            pole_high = max(highs)
            if pole_high <= 0:
                continue
            gain = (pole_high - base_px) / base_px
            if gain < HTF_POLE_MIN_GAIN or gain > HTF_POLE_MAX_GAIN:
                continue
            pole_bars = peak_i - origin
            if not (HTF_POLE_MIN_BARS <= pole_bars <= HTF_POLE_MAX_BARS):
                continue

            flag = bars[peak_i + 1:]
            if not (HTF_FLAG_MIN_BARS <= len(flag) <= HTF_FLAG_MAX_BARS):
                continue
            lows_f = [b.get("l") or 0.0 for b in flag if (b.get("l") or 0) > 0]
            if not lows_f:
                continue
            flag_low = min(lows_f)
            depth = (pole_high - flag_low) / pole_high
            if depth < HTF_FLAG_MIN_DEPTH or depth > HTF_FLAG_MAX_DEPTH:
                continue
            # "volume generally dries up" -- a DIRECTION, no number published.
            pv = [b.get("v") or 0 for b in pole]
            fv = [b.get("v") or 0 for b in flag]
            if not pv or not fv:
                continue
            if (sum(fv) / len(fv)) >= (sum(pv) / len(pv)):
                continue

            cand = {"pole_gain": gain, "pole_bars": pole_bars,
                    "pole_high": pole_high, "pole_low": base_px,
                    "flag_bars": len(flag), "flag_low": flag_low,
                    "flag_depth": depth,
                    # IBD editorial: the buy point is the flagpole PEAK. The
                    # +$0.10 comes only from a third-party summary, so it is
                    # recorded as a conflict and not applied here.
                    "pivot": pole_high}
            if best is None or cand["pole_gain"] > best["pole_gain"]:
                best = cand
        if best is not None:
            return best
    return None


def _detect_high_tight_flag(ctx) -> bool:
    return high_tight_flag_state(ctx) is not None


HIGH_TIGHT_FLAG = Structure(
    key="high-tight-flag",
    label="High Tight Flag",
    axis="relation",
    family="Base Structure",
    bias="bullish",
    rank=11,
    min_bars=HTF_POLE_MIN_BARS + HTF_FLAG_MIN_BARS,
    desc=("A near-vertical doubling in four to eight weeks, then a shallow, "
          "tight three-to-five week flag on drying volume. Rare, and the "
          "house that named it says many fail."),
    criteria=(
        Criterion(
            condition="Flagpole gain",
            value=(HTF_POLE_MIN_GAIN, HTF_POLE_MAX_GAIN),
            quote="The stock begins by climbing 100% to 120% in four to eight weeks.",
            source_id=_IBD_HTF, confidence="high",
        ),
        Criterion(
            condition="Flagpole duration",
            value=(HTF_POLE_MIN_BARS, HTF_POLE_MAX_BARS),
            quote="a stock must gain 100% to 120% in a span of four to eight weeks",
            source_id=_IBD_HTF, confidence="high",
        ),
        Criterion(
            condition="Flag depth",
            value=(HTF_FLAG_MIN_DEPTH, HTF_FLAG_MAX_DEPTH),
            quote="Next, the stock corrects 10% to 25% in three to five weeks.",
            source_id=_IBD_HTF, confidence="high",
        ),
        Criterion(
            condition="Flag duration",
            value=(HTF_FLAG_MIN_BARS, HTF_FLAG_MAX_BARS),
            quote="The flag then forms with three to five weeks of tight sideways trading.",
            source_id=_IBD_HTF, confidence="high",
        ),
        Criterion(
            condition="Flag volume dries up -- a direction, no percentage published",
            value="dries-up",
            quote=("volume generally dries up. Big fund managers are holding "
                   "the stock"),
            source_id=_IBD_HTF, confidence="high",
        ),
        Criterion(
            condition="Pivot / buy point",
            value="flagpole-peak",
            quote="when the stock clears the peak of the flagpole in big turnover",
            source_id=_IBD_HTF, confidence="high",
        ),
        Criterion(
            condition=("CONFLICT on the pivot: IBD editorial says the flagpole "
                       "peak with NO dime; a third-party O'Neil summary adds "
                       "10 cents. We use IBD's and record theirs."),
            value="peak vs peak+0.10",
            quote="the high of the pattern plus 10 cents",
            source_id=_ONEIL_SUMMARY, confidence="low",
        ),
        Criterion(
            condition=("CONFLICT on flag depth, minor: one column says 10-25%, "
                       "another 'usually 10% to 20% or sometimes 25%'. The "
                       "looser ceiling is used."),
            value="10-25% vs 10-20%/25%",
            quote="usually 10% to 20% or sometimes 25%",
            source_id=_IBD_HTF, confidence="high",
        ),
        Criterion(
            condition="Tightness of the flag",
            value=None,
            quote="three to five weeks of tight sideways trading",
            source_id=_IBD_HTF, confidence="high",
            missing=("The house calls the flag tight and publishes no measure "
                     "for it -- no maximum weekly range, no close dispersion. "
                     "The depth and duration bounds already constrain the "
                     "shape hard, so no invented tightness gate is added."),
        ),
        Criterion(
            condition="Failure rate behind 'many fail'",
            value=None,
            quote="High, tight flags are high-risk bases. Many fail.",
            source_id=_IBD_HTF, confidence="high",
            missing=("The warning is published without the statistic. 'Many' "
                     "is not a frequency."),
        ),
        Criterion(
            condition=("The published upside figures are ANECDOTES and are not "
                       "used: 200%, 450%, 1,300%, and a roster of named "
                       "winners."),
            value=None,
            source_id=_IBD_HTF, confidence="high",
            missing=("Every example the house publishes is a winner, and by "
                     "its own admission ('Many fail') they are drawn from the "
                     "surviving tail. n=1 each, no benchmark, no period. "
                     "Treating them as expectancy would be survivorship bias "
                     "with a citation attached."),
        ),
    ),
    coverage_pct=0.08,
    detect=_detect_high_tight_flag,
)


# -- Volatility Contraction Pattern (Mark Minervini) ------------------------
# ⭐⭐ NOT A SHAPE. Minervini is explicit that the VCP is a PROPERTY imposed on
# whatever base shape is present -- "I'm looking for volatility to contract
# from left to right" -- which is why it sits on the relation axis beside the
# shapes rather than competing with them. A symbol can carry a cup AND a VCP.

_MINERVINI = "minervini_ttlac"   # Mark Minervini, "Trade Like a Stock Market Wizard"

#: "you will generally see a sequence of anywhere from two to six price
#: contractions" -- the outer bound. "Typically ... two to four" is the typical
#: case and is recorded separately, as a description rather than a gate.
VCP_MIN_CONTRACTIONS = 2
VCP_MAX_CONTRACTIONS = 6

#: "Most constructive setups correct between 10 percent and 35 percent, some
#: as much as 40 percent."
VCP_MIN_DEPTH = 0.10
VCP_MAX_DEPTH = 0.40

#: "A stock that has corrected 60 percent or more is off my radar." A hard
#: disqualifier, distinct from the normal band above.
VCP_HARD_DEPTH = 0.60

#: "the VCP is going to happen at higher levels, after the stock has already
#: moved up 30, 40, 50 percent or even much more, because the VCP is a
#: CONTINUATION pattern as part of a much larger upward move."
VCP_PRIOR_ADVANCE = 0.30
VCP_ADVANCE_LOOKBACK = 120

#: ⛔⛔ OURS, AND THE BOOK SAYS SO. The rule is "each successive contraction is
#: generally contained to about half (plus or minus a reasonable amount) of the
#: previous" -- and the tolerance behind "a reasonable amount" is NEVER
#: published. So any band is the implementer's invention; these are ours,
#: taken from the range the corpus itself names as an example of what an
#: implementer would have to supply. Each bound earns its place separately:
#:   - the UPPER bound forces each contraction to be meaningfully tighter than
#:     the last, which is the property the pattern is named for;
#:   - the LOWER bound stops a trivial blip completing a sequence. Without it a
#:     1% wobble after a 25% pullback counts as "a contraction", and noise
#:     produces those constantly -- the count would then measure how jittery a
#:     series is rather than whether supply is drying up.
#: Minervini's own worked example sits comfortably inside: 25% -> 15% -> 8% is
#: ratios of 0.60 and 0.53.
VCP_RATIO_MIN = 0.35
VCP_RATIO_MAX = 0.75

#: Ours: how stale the last CONFIRMED contraction may be. Same lesson
#: `darvas-box` and `green-line-breakout` each had to learn -- a walk with no
#: recency bound reports wherever it happened to end.
#: ⚠️ DELIBERATELY LOOSE, AND PAIRED WITH A STRUCTURAL TEST. A tight bound
#: here interacts badly with the confirmation threshold: the tighter a VCP's
#: final contractions are, the less likely they confirm, so the last CONFIRMED
#: contraction sits further back -- and a 30-bar gate refused a five-
#: contraction base at 47 bars, which is to say it refused the pattern
#: precisely when it was most complete. The real question is not "when did a
#: swing last confirm" but "is price still IN the base", which is what
#: `_vcp_still_in_base` asks.
VCP_MAX_AGE_BARS = 60


def vcp_state(ctx, max_depth: float = VCP_MAX_DEPTH) -> Optional[dict]:
    """The current volatility contraction sequence, or None.

    Contractions are read off the CONFIRMED swing sequence: each (high, low)
    pair is one pullback, and the pattern requires them to shrink left to
    right. The provisional trailing swing is deliberately excluded -- a
    contraction built on a swing that can still move is the repainting this
    whole library exists to avoid.
    """
    bars = ctx.bars
    swings = ctx.swings
    if not bars or len(swings) < 3:
        return None

    # Walk the confirmed swings and collect (high -> next low) pullbacks.
    pulls = []
    for a, b in zip(swings, swings[1:]):
        if a["type"] == "high" and b["type"] == "low":
            hi, lo = a["price"], b["price"]
            if hi > 0 and lo > 0 and lo < hi:
                pulls.append({"high": hi, "low": lo,
                              "depth": (hi - lo) / hi,
                              "start": a["bar_index"], "end": b["bar_index"]})
    if len(pulls) < VCP_MIN_CONTRACTIONS:
        return None

    n = len(bars)
    if (n - 1) - pulls[-1]["end"] > VCP_MAX_AGE_BARS:
        return None

    # Take the longest RUN of successively tighter contractions ending at the
    # most recent pullback -- the sequence is what the pattern is, so it is
    # read backwards from now rather than searched for anywhere in history.
    run = [pulls[-1]]
    for prev in reversed(pulls[:-1]):
        nxt = run[0]
        if prev["depth"] <= nxt["depth"]:
            break                       # not contracting at this step
        ratio = nxt["depth"] / prev["depth"]
        if not (VCP_RATIO_MIN <= ratio <= VCP_RATIO_MAX):
            break
        run.insert(0, prev)
        if len(run) >= VCP_MAX_CONTRACTIONS:
            break

    if len(run) < VCP_MIN_CONTRACTIONS:
        return None

    top = run[0]["high"]
    floor = min(x["low"] for x in run)
    if top <= 0:
        return None
    depth = (top - floor) / top
    if depth >= VCP_HARD_DEPTH:
        return None                     # "off my radar"
    if depth < VCP_MIN_DEPTH or depth > max_depth:
        return None

    # "on successively lower volume as the supply diminishes" -- a DIRECTION,
    # no ratio published, so the test is first-versus-last and nothing more.
    def _vol(pull):
        seg = bars[pull["start"]:pull["end"] + 1]
        vals = [b.get("v") or 0 for b in seg]
        return (sum(vals) / len(vals)) if vals else 0.0

    if _vol(run[-1]) >= _vol(run[0]):
        return None

    adv = _prior_advance(bars, n - run[0]["start"], look=VCP_ADVANCE_LOOKBACK)
    if (adv or 0.0) < VCP_PRIOR_ADVANCE:
        return None

    # ⭐ THE STRUCTURAL RECENCY TEST. A VCP is current while price is still
    # inside the consolidation: above its floor and not yet through the pivot.
    # Asking that, rather than "did a swing confirm recently", is what stops
    # the confirmation lag refusing the tightest and most complete bases.
    last_close = bars[-1].get("c") or 0.0
    if not (floor <= last_close <= top):
        return None

    return {"contractions": len(run), "depths": [x["depth"] for x in run],
            "depth": depth, "top": top, "floor": floor,
            "prior_advance": adv, "bars": (n - 1) - run[0]["start"],
            "pivot": top}


def _detect_vcp(ctx) -> bool:
    return vcp_state(ctx) is not None


VCP = Structure(
    key="vcp",
    label="Volatility Contraction",
    axis="relation",
    family="Base Structure",
    bias="bullish",
    rank=9,
    min_bars=60,
    desc=("Successive pullbacks each meaningfully tighter than the last, on "
          "falling volume, inside an existing advance. A property of a base "
          "rather than a shape of its own."),
    criteria=(
        Criterion(
            condition="Number of contractions -- outer bound",
            value=(VCP_MIN_CONTRACTIONS, VCP_MAX_CONTRACTIONS),
            quote=("During a VCP, you will generally see a sequence of anywhere "
                   "from two to six price contractions."),
            source_id=_MINERVINI, confidence="high",
        ),
        Criterion(
            condition=("Number of contractions -- TYPICAL case. Descriptive, "
                       "never a gate: gating on it would refuse the five- and "
                       "six-contraction bases the same sentence allows."),
            value="2-4",
            quote=("Typically, most VCP setups will be formed by two to four "
                   "contractions, although sometimes there can be as many as "
                   "five or six."),
            source_id=_MINERVINI, confidence="high",
        ),
        Criterion(
            condition="Each successive contraction is about half the previous",
            value="about-half",
            quote=("As a rule of thumb, each successive contraction is "
                   "generally contained to about half (plus or minus a "
                   "reasonable amount) of the previous pullback or "
                   "contraction."),
            source_id=_MINERVINI, confidence="high",
        ),
        Criterion(
            condition="The tolerance behind 'plus or minus a reasonable amount'",
            value=None,
            source_id=_MINERVINI, confidence="high",
            missing=("The book never quantifies it. Any numeric band is the "
                     "implementer's invention, so ours is recorded separately "
                     "as ours rather than presented as his rule."),
        ),
        Criterion(
            condition=("The worked sequence 25% -> 15% -> 8% is an EXAMPLE, "
                       "not a threshold -- the book prefaces it 'For example'."),
            value="25/15/8-illustrative",
            quote=("For example, a stock will initially come off by, say, 25 "
                   "percent from its absolute high to its low."),
            source_id=_MINERVINI, confidence="high",
        ),
        Criterion(
            condition="Volume falls with the contractions -- a direction, no ratio",
            value="successively-lower",
            quote=("it corrects less and less from left to right on "
                   "successively lower volume as the supply diminishes"),
            source_id=_MINERVINI, confidence="high",
        ),
        Criterion(
            condition="Base depth, normal conditions",
            value=(VCP_MIN_DEPTH, VCP_MAX_DEPTH),
            quote=("Most constructive setups correct between 10 percent and 35 "
                   "percent, some as much as 40 percent."),
            source_id=_MINERVINI, confidence="high",
        ),
        Criterion(
            condition="Hard depth disqualifier",
            value=VCP_HARD_DEPTH,
            quote=("A stock that has corrected 60 percent or more is off my "
                   "radar, especially because a decline of that magnitude "
                   "often signals a serious problem."),
            source_id=_MINERVINI, confidence="high",
        ),
        Criterion(
            condition="It is a CONTINUATION pattern -- there must be an advance to continue",
            value=VCP_PRIOR_ADVANCE,
            quote=("the VCP is going to happen at higher levels, after the "
                   "stock has already moved up 30, 40, 50 percent or even much "
                   "more, because the VCP is a continuation pattern as part of "
                   "a much larger upward move."),
            source_id=_MINERVINI, confidence="high",
        ),
        Criterion(
            condition="Minimum base duration",
            value=None,
            source_id=_MINERVINI, confidence="high",
            missing=("The VCP section publishes NO minimum. The worked "
                     "examples run 6, 8, 19, 27 and 40 weeks, which is a range "
                     "of illustrations rather than a floor. The 3-week floor "
                     "published elsewhere in the book is stated for the 3-C "
                     "pattern, not for the VCP, and importing it would be "
                     "borrowing a number across rules."),
        ),
        Criterion(
            condition="Tightness of closes inside the contractions",
            value=None,
            quote=("Tightness in price from absolute highs to lows and tight "
                   "closes with little change in price from one day to the "
                   "next ... are generally constructive."),
            source_id=_MINERVINI, confidence="high",
            missing=("No number for what counts as 'little change', and none "
                     "for what counts as a 'significant decrease' in volume. "
                     "The contraction ratio already enforces tightening, so no "
                     "second invented threshold is added."),
        ),
        Criterion(
            condition="Depth relative to the general market -- 2.5x to 3x is disqualifying",
            value=None,
            quote=("Under most conditions, stocks that correct more than two "
                   "and a half or three times the decline of the general "
                   "market should be avoided."),
            source_id=_MINERVINI, confidence="high",
            missing=("Computable in principle, but it needs the index decline "
                     "over the same window, which this per-symbol detector is "
                     "not given. Recorded so the gap is visible rather than "
                     "forgotten."),
        ),
        Criterion(
            condition=("The book's per-name outcomes (465%, 118%, 525%, 75%) "
                       "are NOT performance and are not used."),
            value=None,
            source_id=_MINERVINI, confidence="high",
            missing=("No win rate, no failure rate, no sample size, no period, "
                     "no base rate. They are selected illustrations of "
                     "successful trades and carry survivorship selection by "
                     "construction. His one quasi-measured claim -- that a "
                     "close below the 20-day after breakout cuts success 'in "
                     "about half' -- is RELATIVE, with no absolute base rate "
                     "published, so it cannot be converted into a number "
                     "either."),
        ),
        Criterion(
            condition=("⚠️ KNOWN LIMITATION, measured: the contraction COUNT is "
                       "a LOWER BOUND. Contractions are read off confirmed "
                       "swings, and the segmenter confirms a reversal only "
                       "past k*sigma, so a pullback tighter than that never "
                       "registers. Minervini's own worked sequence -- 25%, "
                       "15%, 8% -- yields TWO confirmed contractions on a "
                       "series with ordinary daily noise, not three: the final "
                       "8% leg is below the threshold. The tight end of the "
                       "sequence is exactly where this truncates, which is the "
                       "part the pattern is named for. Reported counts are "
                       "therefore conservative, and lowering k to recover the "
                       "third leg would trade a non-repainting segmentation "
                       "for a repainting one -- a far worse bargain."),
            # OURS, with a value: this is a consequence of a choice we made
            # (a volatility-scaled, non-repainting segmenter), not a gap in
            # what Minervini published. A `missing:` here would have made it a
            # refusal AND ours at once, which the provenance rail refuses --
            # correctly, since the two say different things about who owns it.
            value="count-is-a-lower-bound",
            origin="uct", confidence="high",
        ),
        Criterion(
            condition="Contraction ratio band, successive over previous",
            value=(VCP_RATIO_MIN, VCP_RATIO_MAX),
            origin="uct", confidence="high",
        ),
        Criterion(
            condition="Maximum age of the last contraction",
            value=VCP_MAX_AGE_BARS,
            origin="uct", confidence="high",
        ),
    ),
    coverage_pct=1.8,
    detect=_detect_vcp,
)


# ── SHAPES — a TOTAL partition over the swing sequence ─────────────────────
# ⭐ Every symbol gets exactly one. These are structural readings of the
# confirmed swing sequence, so no house publishes them and every criterion is
# `origin="uct"` — stated openly rather than dressed up with a citation.

def _uct(condition: str, value: object) -> Criterion:
    return Criterion(condition=condition, value=value, origin="uct",
                     confidence="high")


_SHAPE_MIN_BARS = 60

SHAPES = [
    Structure(
        key="advancing-structure", label="Advancing Structure", axis="shape",
        family="Trend", bias="bullish", rank=10, min_bars=_SHAPE_MIN_BARS,
        desc="The last two swing highs and the last two swing lows are both rising.",
        criteria=(_uct("Last two swing highs rising AND last two swing lows rising", True),),
    ),
    Structure(
        key="declining-structure", label="Declining Structure", axis="shape",
        family="Trend", bias="bearish", rank=20, min_bars=_SHAPE_MIN_BARS,
        desc="The last two swing highs and the last two swing lows are both falling.",
        criteria=(_uct("Last two swing highs falling AND last two swing lows falling", True),),
    ),
    Structure(
        key="contracting-range", label="Contracting Range", axis="shape",
        family="Consolidation", bias="neutral", rank=30, min_bars=_SHAPE_MIN_BARS,
        desc="Swing highs are falling while swing lows are rising — the range is narrowing.",
        criteria=(_uct("Swing highs falling AND swing lows rising", True),),
    ),
    Structure(
        key="expanding-range", label="Expanding Range", axis="shape",
        family="Consolidation", bias="neutral", rank=40, min_bars=_SHAPE_MIN_BARS,
        desc="Swing highs are rising while swing lows are falling — the range is widening.",
        criteria=(_uct("Swing highs rising AND swing lows falling", True),),
    ),
    Structure(
        key=FALLBACK_SHAPE, label="Undefined Structure", axis="shape",
        family="Consolidation", bias="neutral", rank=99, min_bars=0,
        desc=("Too few confirmed swings to read a structure, or the swings do "
              "not agree on a direction."),
        criteria=(_uct("The cascade's final branch — takes no condition, so the "
                       "partition is total by construction", True),),
    ),
]

RELATIONS = [BASE_ON_BASE, CUP_WITH_HANDLE, DARVAS_BOX, DOUBLE_BOTTOM,
             FLAT_BASE, GREEN_LINE_BREAKOUT, HIGH_TIGHT_FLAG,
             POCKET_PIVOT, POWER_PLAY, STAGE2_BREAKOUT,
             STAGE4_BREAKDOWN, VCP]

ALL_STRUCTURES = SHAPES + RELATIONS
_BY_KEY = {s.key: s for s in ALL_STRUCTURES}


def by_key(key):
    return _BY_KEY.get(key)


def meta() -> dict:
    """What the frontend and the filter registry read. Nobody restates a key.

    ⛔ `lift` IS READ FROM THE LEDGER, NEVER STORED ON THE STRUCTURE. `Structure`
    has no lift field on purpose: copying the number here would put a second
    authority on one value, and the catalog would then be able to disagree with
    the harness that measured it. `None` means we have no number — covering
    both "never measured" and "measured and refused", which say the same honest
    thing to a member.
    """
    from api.services.screener import lift_ledger

    out = {}
    for s in ALL_STRUCTURES:
        entry = lift_ledger.for_structure(s.key)
        out[s.key] = {
            "label": s.label,
            "desc": s.desc,
            "axis": s.axis,
            "family": s.family,
            "bias": s.bias,
            "coverage_pct": s.coverage_pct,
            "lift_pp": round(entry["lift"] * 100, 2) if entry else None,
            "lift_ci_pp": ([round(entry["ci_low"] * 100, 2),
                            round(entry["ci_high"] * 100, 2)]
                           if entry else None),
            "lift_n": entry.get("n") if entry else None,
        }
    return out


def match_value(key: str) -> str:
    """The value a `contains` filter must use against `base_matches`.

    ⛔ DELIMITER-WRAPPED. `contains` compiles to `LIKE %v%` in `query.py`, so a
    bare key makes a filter for `range` match a row carrying only
    `contracting-range`. The candle library learned this once already; the
    wrapping is why `bases.classify` emits `,a,b,` rather than `a,b`.
    """
    return f",{key},"


def enum_options() -> list:
    """Filter presets, DERIVED — never hand-listed beside the registry.

    The seven candle options that were once typed into `filters.py` became a
    second authority and drifted the moment that library grew from 7 labels to
    62. This list cannot drift: it is the registry.
    """
    out = [{"label": "Any"}]
    for s in sorted(ALL_STRUCTURES, key=lambda q: (q.axis != "relation", q.rank)):
        out.append({"label": s.label, "op": "contains", "value": match_value(s.key)})
    return out
