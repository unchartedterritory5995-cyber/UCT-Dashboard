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

from api.services.pattern_engine.primitives import cup, shape
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
    rank=16,
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
    rank=14,
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
    rank=21,
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
    rank=15,
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
    rank=22,
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


# -- Ascending Base (William J. O'Neil / IBD) -------------------------------
# ⭐⭐ THE ONLY STRUCTURE IN THE TAXONOMY WITH NO CONFLICTS. IBD editorial, the
# O'Neil quote inside it, MarketSmith and the base-counting column all give the
# SAME numbers: three pullbacks, 10-20% each, 9-16 weeks. Every other base in
# this file needed a "CONFLICT, recorded not resolved" criterion. The corpus
# calls it "the most mechanically specifiable of all the IBD bases", and that
# is why it is a strict alternation with monotonicity constraints rather than a
# shape with tolerances.

_IBD_ASC = "ibd_ascending_base"
_MARKETSMITH = "marketsmith_ascending"   # O'Neil-affiliated, not IBD editorial

#: "There are three healthy price pullbacks of 10% to 20%"
ASC_PULLBACKS = 3
ASC_MIN_PULLBACK = 0.10
ASC_MAX_PULLBACK = 0.20

#: "over a nine- to 16-week span"
ASC_MIN_BARS = 45
ASC_MAX_BARS = 80

#: "after a stock has run up at least 20% off an earlier base" (MarketSmith,
#: med confidence -- IBD editorial states the PLACEMENT without a number).
ASC_PRIOR_ADVANCE = 0.20
ASC_ADVANCE_LOOKBACK = 120

#: "$0.1 higher than the high point from which the third pull back began"
ASC_PIVOT_PAD = 0.10

#: SOURCED: "up to 5% above the ideal buy point" is IBD's general buy zone, so
#: a staircase whose price has run further than that has resolved and the label
#: would describe the past.
ASC_BUY_ZONE = 0.05


def ascending_base_state(ctx) -> Optional[dict]:
    """Three higher-low, higher-high pullbacks of 10-20%, or None.

    ⛔ THE PIVOT IS THE HIGH BEFORE THE THIRD LOW, not the highest point of the
    structure. The rule is "the high point from which the third pullback
    began", and on a staircase that is a specific, earlier price than whatever
    the stock reached afterwards.
    """
    bars = ctx.bars
    swings = ctx.swings
    if not bars or len(swings) < ASC_PULLBACKS * 2:
        return None

    pairs = []
    for a, b in zip(swings, swings[1:]):
        if a["type"] == "high" and b["type"] == "low":
            hi, lo = a["price"], b["price"]
            if hi > 0 and lo > 0 and lo < hi:
                pairs.append((a, b, (hi - lo) / hi))
    if len(pairs) < ASC_PULLBACKS:
        return None

    step = pairs[-ASC_PULLBACKS:]
    highs = [x[0]["price"] for x in step]
    lows = [x[1]["price"] for x in step]
    depths = [x[2] for x in step]

    # A strict staircase: every high above the last, every low above the last.
    if not all(b > a for a, b in zip(highs, highs[1:])):
        return None
    if not all(b > a for a, b in zip(lows, lows[1:])):
        return None
    if not all(ASC_MIN_PULLBACK <= d <= ASC_MAX_PULLBACK for d in depths):
        return None

    n = len(bars)
    start = step[0][0]["bar_index"]
    end = step[-1][1]["bar_index"]
    # ⛔ THE SPAN IS THE BASE'S OWN DURATION -- first high to third low -- NOT
    # the distance from the base's start to today. Measuring to `n - 1` folds
    # "time since the base finished" into "how long the base took", and the
    # 9-16 week window then refuses any staircase that completed a few weeks
    # ago. Measured: 3 symbols with the wrong span, 16 with the right one.
    span = end - start
    if not (ASC_MIN_BARS <= span <= ASC_MAX_BARS):
        return None

    adv = _prior_advance(bars, n - start, look=ASC_ADVANCE_LOOKBACK)
    if (adv or 0.0) < ASC_PRIOR_ADVANCE:
        return None

    # Structural recency, the same shape as the VCP's: the staircase is intact
    # while price holds above its third low and has not run past the published
    # 5% buy zone above the pivot.
    pivot = highs[-1] + ASC_PIVOT_PAD
    last_close = bars[-1].get("c") or 0.0
    if not (lows[-1] <= last_close <= pivot * (1.0 + ASC_BUY_ZONE)):
        return None

    return {"highs": highs, "lows": lows, "depths": depths,
            "bars": span, "age_bars": (n - 1) - end, "prior_advance": adv,
            "pivot": pivot}


def _detect_ascending_base(ctx) -> bool:
    return ascending_base_state(ctx) is not None


ASCENDING_BASE = Structure(
    key="ascending-base",
    label="Ascending Base",
    axis="relation",
    family="Base Structure",
    bias="bullish",
    rank=13,
    min_bars=ASC_MIN_BARS,
    desc=("A three-step staircase midway through an advance: three pullbacks "
          "of 10-20%, each bottoming higher than the last and each recovery "
          "making a new high."),
    criteria=(
        Criterion(
            condition="Number of pullbacks -- exactly three",
            value=ASC_PULLBACKS,
            quote=("There are three healthy price pullbacks of 10% to 20%, "
                   "with each low higher than the preceding one."),
            source_id=_IBD_ASC, confidence="high",
        ),
        Criterion(
            condition="Pullback depth, each",
            value=(ASC_MIN_PULLBACK, ASC_MAX_PULLBACK),
            quote="three 10-20% pullbacks",
            source_id=_MARKETSMITH, confidence="high",
        ),
        Criterion(
            condition="Each low higher than the preceding one",
            value="higher-lows",
            quote="with each low higher than the preceding one",
            source_id=_IBD_ASC, confidence="high",
        ),
        Criterion(
            condition="Three advances to new highs, each above the last",
            value="higher-highs",
            quote=("The base shows three advances to new highs, with each high "
                   "rising above the previous high."),
            source_id=_IBD_ASC, confidence="high",
        ),
        Criterion(
            condition="Base length",
            value=(ASC_MIN_BARS, ASC_MAX_BARS),
            quote=("Ascending bases are shaped by three pullbacks with higher "
                   "highs and higher lows over a nine- to 16-week span."),
            source_id=_IBD_ASC, confidence="high",
        ),
        Criterion(
            condition="Placement -- midway through an advance, never a first base",
            value=ASC_PRIOR_ADVANCE,
            quote=("midway along a move up after a stock has run up at least "
                   "20% off an earlier base"),
            source_id=_MARKETSMITH, confidence="med",
        ),
        Criterion(
            condition=("Pivot -- the high from which the THIRD pullback began, "
                       "not the structure's highest point"),
            value=ASC_PIVOT_PAD,
            quote=("when the stock price rises $0.1 higher than the high point "
                   "from which the third pull back began"),
            source_id=_MARKETSMITH, confidence="med",
        ),
        Criterion(
            condition=("The pullbacks are attributed to general-market "
                       "declines. An EXPLANATION, never a required condition -- "
                       "railing on it would over-refuse, and it needs index "
                       "data this per-symbol detector is not given."),
            value=None,
            quote=("Each of the pullbacks usually occurs because the general "
                   "market is declining at that time."),
            source_id=_IBD_ASC, confidence="high",
            missing=("O'Neil states it as a cause, not a criterion, so there "
                     "is nothing to test even with index data in hand."),
        ),
        Criterion(
            condition="Buy zone above the pivot",
            value=ASC_BUY_ZONE,
            quote="up to 5% above the ideal buy point",
            source_id=_IBD_ASC, confidence="high",
        ),
        Criterion(
            condition=("⭐ NO CONFLICTS. Every fetched source -- IBD editorial, "
                       "its O'Neil quote, MarketSmith and the base-counting "
                       "column -- gives identical numbers. Unique in this "
                       "taxonomy, and worth recording precisely because every "
                       "neighbouring base needed a conflict criterion."),
            value="no-conflicts",
            origin="uct", confidence="high",
        ),
    ),
    coverage_pct=0.11,
    detect=_detect_ascending_base,
)


# -- Square Box (William J. O'Neil, HTMMIS 4th ed.) -------------------------
# ⚠️ IBD publishes a dedicated column defining this base and then OMITS it from
# its own "seven bases" list. Recorded, not reconciled.

_IBD_BOX = "ibd_square_box"

#: "The square box just takes four weeks to develop and does not exceed seven
#: weeks." ⭐ THE ONLY IBD BASE WITH A PUBLISHED MAXIMUM DURATION -- every
#: other one has a floor and no ceiling, so this is the only base you can
#: invalidate by being too LONG.
BOX_MIN_BARS = 20
BOX_MAX_BARS = 35

#: "With a square box, a stock corrects no more than 15%."
BOX_MAX_DEPTH = 0.15

#: "adding a dime to Deere's 79.66 high"
BOX_PIVOT_PAD = 0.10

#: OURS, and the corpus says outright that this is where the work happens:
#: "the tilt test is what does most of the discriminating work here. Without
#: it, this detector will fire constantly." IBD's only characterisation is a
#: "square, boxy look" with no angle published, so the number is ours.
#: ⛔⛔ IT IS A RATIO, NOT AN ABSOLUTE DRIFT, AND THAT MATTERS. The first
#: version reused the flat base's absolute bound (drift <= 2/3 of the depth
#: CEILING) and matched 46.7% of the universe -- a NOISE verdict, exactly the
#: failure the corpus predicted. The bug is that an absolute drift is
#: scale-DEPENDENT: 10% of price over a 4-7 week box is a visible trend, while
#: the same 10% over a 52-week base is flat. Measuring drift against the box's
#: OWN depth is scale-free: a box that drifts more than a third of its own
#: height is a channel, not a box. Measured: 46.7% -> 16.8%.
BOX_MAX_BOXINESS = 0.30

#: OURS, serving a SOURCED placement rule: the square box "forms after a stock
#: has already moved up out of an earlier base". The house states the placement
#: and never a number, so this is ours -- and it mirrors the flat base, which
#: needed the same gate for the same reason. Measured: 16.8% -> 5.1%.
BOX_PRIOR_ADVANCE = 0.20
BOX_ADVANCE_LOOKBACK = 60


def square_box_state(bars) -> Optional[dict]:
    """A four-to-seven week boxy consolidation ending at the last bar."""
    n = len(bars)
    if n < BOX_MIN_BARS:
        return None
    head_max = _head_max_array(bars)
    best = None
    for k in range(BOX_MIN_BARS, min(n, BOX_MAX_BARS) + 1):
        w = bars[n - k:]
        highs = [b.get("h") or 0 for b in w]
        lows = [b.get("l") or 0 for b in w]
        if not highs or min(lows) <= 0:
            continue
        hi, lo = max(highs), min(lows)
        if hi <= 0:
            continue
        depth = (hi - lo) / hi
        if depth > BOX_MAX_DEPTH or depth <= 0:
            continue
        drift = _base_drift_of(w)
        if drift > BOX_MAX_BOXINESS * depth:
            continue
        best = {"bars": k, "high": hi, "low": lo, "depth": depth,
                "drift": drift, "boxiness": drift / depth,
                "prior_advance": _prior_advance(bars, k,
                                                look=BOX_ADVANCE_LOOKBACK),
                "pivot": hi + BOX_PIVOT_PAD}
    return best


def _base_drift_of(window) -> float:
    """Fitted drift across a window, over its mean close. Absolute."""
    w = [b.get("c") or 0 for b in window if (b.get("c") or 0) > 0]
    n = len(w)
    if n < 3:
        return 1.0
    mx = (n - 1) / 2.0
    my = sum(w) / n
    den = sum((i - mx) ** 2 for i in range(n))
    if den <= 0 or my <= 0:
        return 1.0
    slope = sum((i - mx) * (w[i] - my) for i in range(n)) / den
    return abs(slope * (n - 1)) / my


def _detect_square_box(ctx) -> bool:
    st = square_box_state(ctx.bars)
    if st is None:
        return False
    return (st["prior_advance"] or 0.0) >= BOX_PRIOR_ADVANCE


SQUARE_BOX = Structure(
    key="square-box",
    label="Square Box",
    axis="relation",
    family="Base Structure",
    bias="neutral",
    rank=17,
    min_bars=BOX_MIN_BARS,
    desc=("A short, shallow, boxy consolidation of four to seven weeks "
          "correcting no more than 15% -- the only base that can be "
          "invalidated by lasting too long."),
    criteria=(
        Criterion(
            condition=("Base length -- a floor AND a ceiling. The only IBD base "
                       "with a published maximum duration."),
            value=(BOX_MIN_BARS, BOX_MAX_BARS),
            quote=("The square box just takes four weeks to develop and does "
                   "not exceed seven weeks."),
            source_id=_IBD_BOX, confidence="high",
        ),
        Criterion(
            condition="Base depth, maximum",
            value=BOX_MAX_DEPTH,
            quote="With a square box, a stock corrects no more than 15%.",
            source_id=_IBD_BOX, confidence="high",
        ),
        Criterion(
            condition="Pivot / buy point",
            value=BOX_PIVOT_PAD,
            quote="You get the buy point by adding a dime to Deere's 79.66 high",
            source_id=_IBD_BOX, confidence="high",
        ),
        Criterion(
            condition="Tilt -- the 'boxy look'",
            value=None,
            quote="Note how the chart action has a square, boxy look.",
            source_id=_IBD_BOX, confidence="high",
            missing=("No maximum slope is published for the box's highs or "
                     "lows. Our drift bound below is therefore ours -- and it "
                     "is doing most of the discriminating, because a sub-15% "
                     "correction over a 4-7 week window is otherwise a very "
                     "common shape."),
        ),
        Criterion(
            condition=("Breakout volume. IBD accepted a breakout week whose "
                       "volume FELL against the prior week provided it was "
                       "above average -- a materially weaker bar than the "
                       "40%-above-50-day rule it applies to the flat base, a "
                       "base of essentially the same shape and depth."),
            value=None,
            quote=("Volume came in above average that week, even if it dipped "
                   "slightly from the prior week's level."),
            source_id=_IBD_BOX, confidence="high",
            missing="No square-box-specific volume percentage is published.",
        ),
        Criterion(
            condition=("OVERLAP WITH THE FLAT BASE, unresolved by publication. "
                       "A 5-, 6- or 7-week sub-15% consolidation satisfies BOTH "
                       "definitions, and IBD publishes no tiebreak. Both are "
                       "allowed to fire: relations are zero-or-many by design, "
                       "so the honest answer is to report both rather than "
                       "invent a precedence rule."),
            value=None,
            source_id=_IBD_BOX, confidence="high",
            missing="IBD's tiebreak between square box and flat base.",
        ),
        Criterion(
            condition=("IBD defines this base in a dedicated column and then "
                       "omits it from its own 'seven bases' list. Recorded, "
                       "not reconciled."),
            value="absent-from-seven-bases",
            quote=("a relatively new pattern among the lineup of bases defined "
                   "by IBD"),
            source_id=_IBD_BOX, confidence="high",
        ),
        Criterion(
            condition=("Boxiness -- fitted drift as a fraction of the box's OWN "
                       "depth. Ours, and a RATIO rather than an absolute drift: "
                       "an absolute bound is scale-dependent and matched 46.7% "
                       "of the universe. Measured: 46.7% -> 16.8%."),
            value=BOX_MAX_BOXINESS,
            origin="uct", confidence="high",
        ),
        Criterion(
            condition=("Prior advance into the box. Ours, serving the sourced "
                       "placement rule above. Measured: 16.8% -> 5.1%."),
            value=BOX_PRIOR_ADVANCE,
            origin="uct", confidence="high",
        ),
    ),
    coverage_pct=8.0,
    detect=_detect_square_box,
)


# -- Climax Top (IBD) -------------------------------------------------------
# ⭐⭐ THE SHARPEST SELF-CONTRADICTION IN THE CORPUS, and it is inside ONE
# column. IBD's selling column says a stock that gains 20% or more in three
# weeks or less "should be held at least eight weeks", and -- in the same
# column -- that a stock which soars "25% to 50% or more in three weeks or
# less" is showing "the hallmark of a climax top". Those overlap: a 30% move in
# two weeks is simultaneously a hold-for-eight-weeks signal and an exhaustion
# warning. We implement the climax reading, label the structure bearish, and
# record the other rule verbatim rather than pretending the tension is not
# there.

_IBD_CLIMAX = "ibd_selling_climax"

#: "shares soar 25% to 50% or more in three weeks or less"
CLIMAX_MIN_GAIN = 0.25
CLIMAX_MAX_BARS = 15          # three weeks

#: OURS. "After a PROLONGED ADVANCE" is the precondition and IBD never
#: quantifies it. Without something here the rule fires on any sharp three-week
#: pop, including the first leg off a bottom -- which is the opposite of a
#: climax.
CLIMAX_PRIOR_ADVANCE = 0.50
CLIMAX_PRIOR_LOOKBACK = 120


def climax_top_state(bars) -> Optional[dict]:
    """A 25%+ surge inside three weeks, after a prolonged advance."""
    n = len(bars)
    if n < CLIMAX_MAX_BARS + 20:
        return None
    last = bars[-1].get("c") or 0.0
    if last <= 0:
        return None

    best = None
    for k in range(3, CLIMAX_MAX_BARS + 1):
        lows = [b.get("l") or 0 for b in bars[n - k:] if (b.get("l") or 0) > 0]
        if not lows:
            continue
        lo = min(lows)
        if lo <= 0:
            continue
        gain = (last - lo) / lo
        if gain < CLIMAX_MIN_GAIN:
            continue
        if best is None or gain > best["gain"]:
            best = {"gain": gain, "bars": k, "from_low": lo, "close": last}
    if best is None:
        return None

    adv = _prior_advance(bars, best["bars"], look=CLIMAX_PRIOR_LOOKBACK)
    if (adv or 0.0) < CLIMAX_PRIOR_ADVANCE:
        return None
    best["prior_advance"] = adv
    return best


def _detect_climax_top(ctx) -> bool:
    return climax_top_state(ctx.bars) is not None


CLIMAX_TOP = Structure(
    key="climax-top",
    label="Climax Top",
    axis="relation",
    family="Exhaustion",
    bias="bearish",
    rank=55,
    min_bars=CLIMAX_MAX_BARS + 20,
    desc=("A 25%-or-more surge inside three weeks at the end of a prolonged "
          "advance -- the hallmark of an exhaustion move rather than a "
          "continuation."),
    criteria=(
        Criterion(
            condition="Surge size and window",
            value=(CLIMAX_MIN_GAIN, CLIMAX_MAX_BARS),
            quote=("After a prolonged advance, shares soar 25% to 50% or more "
                   "in three weeks or less. That's the hallmark of a climax "
                   "top."),
            source_id=_IBD_CLIMAX, confidence="high",
        ),
        Criterion(
            condition=("⭐⭐ DIRECT OVERLAP WITH THE HOLD RULE IN THE SAME "
                       "COLUMN. IBD tells you to HOLD a stock that gains 20%+ "
                       "in three weeks or less for at least eight weeks, and "
                       "tells you 25%+ in three weeks or less is a climax top. "
                       "A 30% move in two weeks satisfies both. Recorded, not "
                       "reconciled -- the house publishes both and we are not "
                       "entitled to pick which one it meant."),
            value="hold-8-weeks vs climax-top",
            quote=("any stock that surges that fast in three weeks or less "
                   "should be held at least eight weeks"),
            source_id=_IBD_CLIMAX, confidence="high",
        ),
        Criterion(
            condition="The 'prolonged advance' that must precede it",
            value=None,
            quote="After a prolonged advance",
            source_id=_IBD_CLIMAX, confidence="high",
            missing=("IBD never quantifies 'prolonged'. Our number is recorded "
                     "separately, below, and it is load-bearing: without it the "
                     "rule fires on any sharp three-week pop, including the "
                     "first leg off a bottom, which is the OPPOSITE of a "
                     "climax."),
        ),
        Criterion(
            condition="Prior advance required before the surge",
            value=CLIMAX_PRIOR_ADVANCE,
            origin="uct", confidence="high",
        ),
    ),
    coverage_pct=2.1,
    detect=_detect_climax_top,
)


# -- Parabolic Extension (Kristjan Kullamagi) -------------------------------
# His "Parabolic Short". ⚠️ ONLY THE DAILY-DETECTABLE HALF IS IMPLEMENTED: the
# entry ("short the opening range lows of the 1- or 5-minute candle") and the
# stop ("a reclaim of VWAP") are intraday, and this is a daily-bar structure.
# What ships is the STATE -- the stock is parabolically extended -- not his
# trade.

_QULLAMAGGIE = "qullamaggie_parabolic"

#: "A stock up 50-100%+ in a few days or weeks (if larger cap)"
PARA_MIN_GAIN = 0.50

#: "The stock should be up 3-5+ days in a row."
PARA_MIN_UP_DAYS = 3

#: OURS: "a few days or weeks" is not a number.
PARA_MAX_BARS = 20


def parabolic_extension_state(bars) -> Optional[dict]:
    """A vertical move with a run of consecutive up days behind it."""
    n = len(bars)
    if n < PARA_MAX_BARS + 5:
        return None
    last = bars[-1].get("c") or 0.0
    if last <= 0:
        return None

    up = 0
    for i in range(n - 1, 0, -1):
        c, prev = bars[i].get("c") or 0, bars[i - 1].get("c") or 0
        if c > prev > 0:
            up += 1
        else:
            break
    if up < PARA_MIN_UP_DAYS:
        return None

    best = None
    for k in range(3, PARA_MAX_BARS + 1):
        lows = [b.get("l") or 0 for b in bars[n - k:] if (b.get("l") or 0) > 0]
        if not lows:
            continue
        lo = min(lows)
        if lo <= 0:
            continue
        gain = (last - lo) / lo
        if gain < PARA_MIN_GAIN:
            continue
        if best is None or gain > best["gain"]:
            best = {"gain": gain, "bars": k, "from_low": lo,
                    "up_days": up, "close": last}
    return best


def _detect_parabolic_extension(ctx) -> bool:
    return parabolic_extension_state(ctx.bars) is not None


PARABOLIC_EXTENSION = Structure(
    key="parabolic-extension",
    label="Parabolic Extension",
    axis="relation",
    family="Exhaustion",
    bias="bearish",
    rank=57,
    min_bars=PARA_MAX_BARS + 5,
    desc=("Up 50% or more within a few weeks with three or more consecutive "
          "up days -- stretched far enough from its short-term averages that "
          "reversion to them is the expected move."),
    criteria=(
        Criterion(
            condition="Prior move, larger caps",
            value=PARA_MIN_GAIN,
            quote=("A stock up 50-100%+ in a few days or weeks (if larger cap) "
                   "or 300-1000%+ (if smaller cap)."),
            source_id=_QULLAMAGGIE, confidence="high",
        ),
        Criterion(
            condition="Consecutive up days",
            value=PARA_MIN_UP_DAYS,
            quote="The stock should be up 3-5+ days in a row.",
            source_id=_QULLAMAGGIE, confidence="high",
        ),
        Criterion(
            condition=("The large-cap / small-cap boundary that selects between "
                       "50-100% and 300-1000%"),
            value=None,
            source_id=_QULLAMAGGIE, confidence="high",
            missing=("No market-cap or share-price level is published, so his "
                     "TWO-BRANCH rule is not computable. We apply the "
                     "larger-cap threshold universally, which means this "
                     "OVER-FIRES on small caps he would require a far bigger "
                     "move from. Stated because it biases the measurement, not "
                     "merely the label."),
        ),
        Criterion(
            condition="Length of the parabolic leg",
            value=None,
            quote="in a few days or weeks",
            source_id=_QULLAMAGGIE, confidence="high",
            missing="No maximum bar count is published; ours is recorded below.",
        ),
        Criterion(
            condition="Extension above the moving averages that makes it 'parabolic'",
            value=None,
            source_id=_QULLAMAGGIE, confidence="high",
            missing=("No percentage or ATR multiple is published. He defines "
                     "the 10- and 20-day MAs as the TARGET, never as an "
                     "entry-qualifying distance, so there is nothing to test."),
        ),
        Criterion(
            condition=("Entry and stop are INTRADAY and are not implemented: "
                       "'short on the opening range lows (1-minute, 5-minute "
                       "candles)', stop at 'highs of the day or if VWAP fail, "
                       "a reclaim of the VWAP'."),
            value=None,
            quote=("When you think you have identified a candidate you can "
                   "short on the opening range lows (1-minute, 5-minute "
                   "candles)."),
            source_id=_QULLAMAGGIE, confidence="high",
            missing=("This is a daily-bar structure. What ships is the STATE "
                     "(the stock is parabolically extended), not his trade."),
        ),
        Criterion(
            condition="The asserted 5-10x risk/reward",
            value=None,
            quote="This setup is more like 5-10x risk reward",
            source_id=_QULLAMAGGIE, confidence="high",
            missing=("An asserted payoff SHAPE, not a measured expectancy over "
                     "a sample. His only win-rate statement is hedged and "
                     "unquantified ('probably going to be higher'). Nothing "
                     "here is usable as evidence."),
        ),
        Criterion(
            condition="Borrow / shortability, the practical gate on this setup",
            value=None,
            source_id=_QULLAMAGGIE, confidence="high",
            missing=("No published rule on locate availability or borrow cost, "
                     "and we hold no borrow data either -- so a name this "
                     "labels may be untradeable short."),
        ),
        Criterion(
            condition="Maximum length of the parabolic leg",
            value=PARA_MAX_BARS,
            origin="uct", confidence="high",
        ),
    ),
    coverage_pct=0.54,
    detect=_detect_parabolic_extension,
)


# -- Wyckoff Spring ---------------------------------------------------------
# ⛔⛔ THE ONLY WYCKOFF EVENT BUILT, AND DELIBERATELY SO. The Wyckoff corpus
# supplies a GRAMMAR, NOT THRESHOLDS: 184 refusals and not one criterion at
# high confidence with a published constant. Its own summary says so -- "almost
# every criterion below is comparative ('wider spread than', 'less volume than
# the prior') with no published constant... there are only about a dozen [real
# numbers] in the entire corpus and most of them are illustrative examples on a
# $50 stock". Wyckoff is quoted rejecting mechanical rules outright: "Instead
# of steadfast rules, Wyckoff advocated broad guidelines... Nothing in the
# stock market is definitive."
#
# A four-schematic state machine built on that would be OUR invention wearing
# his name -- and it would attribute to him a precision he explicitly denied.
# The Spring is the exception the corpus itself names: "this is the single most
# computable Wyckoff criterion in the corpus: `low < tr_support AND close >
# tr_support`". So the Spring ships and the schematic does not.

_WYCKOFF = "wyckoff_schematics"

#: Ours: how far back the trading range is read.
SPRING_TR_BARS = 60

#: Ours: how recent the penetration must be for this to be a setup rather than
#: history. "Springs usually occur late within a TR" is published; "late" as a
#: fraction of the range is NOT, so the bound is ours.
SPRING_RECENT_BARS = 10

#: Ours, and load-bearing. A trading range is HORIZONTAL; without this every
#: downtrend "penetrates support" on almost every bar, which is the same
#: failure the square box had. Reuses the boxiness ratio so the file holds one
#: definition of "not trending" rather than two.
SPRING_MAX_BOXINESS = BOX_MAX_BOXINESS


def wyckoff_spring_state(bars) -> Optional[dict]:
    """A penetration below trading-range support that closed back inside.

    ⛔ THE RANGE MUST BE A RANGE. The published criterion is comparative --
    price goes below support and closes back above it -- and on a downtrend
    that is true almost every day. The horizontality bound is what makes the
    word "support" mean anything, and it is ours.
    """
    n = len(bars)
    if n < SPRING_TR_BARS + 5:
        return None

    tr = bars[n - SPRING_TR_BARS:n - SPRING_RECENT_BARS]
    recent = bars[n - SPRING_RECENT_BARS:]
    if len(tr) < 20 or not recent:
        return None

    lows = [b.get("l") or 0 for b in tr if (b.get("l") or 0) > 0]
    highs = [b.get("h") or 0 for b in tr if (b.get("h") or 0) > 0]
    if not lows or not highs:
        return None
    support, resistance = min(lows), max(highs)
    if support <= 0 or resistance <= support:
        return None

    depth = (resistance - support) / resistance
    if depth <= 0:
        return None
    if _base_drift_of(tr) > SPRING_MAX_BOXINESS * depth:
        return None                      # a trend, not a trading range

    spring = None
    for b in recent:
        lo, c = b.get("l") or 0, b.get("c") or 0
        if lo <= 0 or c <= 0:
            continue
        if lo < support and c > support:
            pen = (support - lo) / support
            if spring is None or pen > spring["penetration"]:
                spring = {"penetration": pen, "low": lo, "close": c}
    if spring is None:
        return None

    # Still inside the range now -- a spring that has since broken down is a
    # failed spring, which is a different event with a different meaning.
    last = bars[-1].get("c") or 0
    if last <= support:
        return None

    return {"support": support, "resistance": resistance, "range_depth": depth,
            "penetration": spring["penetration"], "spring_low": spring["low"],
            "close": last}


def _detect_wyckoff_spring(ctx) -> bool:
    return wyckoff_spring_state(ctx.bars) is not None


WYCKOFF_SPRING = Structure(
    key="wyckoff-spring",
    label="Wyckoff Spring",
    axis="relation",
    family="Base Structure",
    bias="bullish",
    rank=19,
    min_bars=SPRING_TR_BARS + 5,
    desc=("Price dipped below the floor of a trading range and closed back "
          "inside it -- the shakeout that traps late sellers before the range "
          "resolves."),
    criteria=(
        Criterion(
            condition="Price penetrates trading-range support and closes back inside",
            value="undercut-and-reclaim",
            quote=("A 'spring' takes price below the low of the TR and then "
                   "reverses to close within the TR; this action allows large "
                   "interests to mislead the public about the future trend "
                   "direction and to acquire additional shares at bargain "
                   "prices."),
            source_id=_WYCKOFF, confidence="high",
        ),
        Criterion(
            condition="What the event IS -- a bear trap, not a breakdown",
            value="bear-trap",
            quote=("A spring is an example of a 'bear trap'... In reality, "
                   "though, the drop marks the end of the downtrend, thus "
                   "'trapping' the late sellers, or bears."),
            source_id=_WYCKOFF, confidence="high",
        ),
        Criterion(
            condition="Depth of the penetration below support",
            value=None,
            quote="a penetration below a previous support area",
            source_id=_WYCKOFF, confidence="high",
            missing=("No depth is published. The one numeric penetration "
                     "figure in the corpus is an illustrative example on a $50 "
                     "stock, not a threshold, so there is nothing to gate on "
                     "and any penetration counts."),
        ),
        Criterion(
            condition="'Springs usually occur late within a TR'",
            value=None,
            quote="Springs or shakeouts usually occur late within a TR",
            source_id=_WYCKOFF, confidence="high",
            missing=("'Late' is never expressed as a fraction of the range's "
                     "duration. Our recency bound below is ours."),
        ),
        Criterion(
            condition=("⛔⛔ THE CORPUS PUBLISHES A GRAMMAR, NOT THRESHOLDS, and "
                       "that is why only this ONE event is built. 184 refusals "
                       "and no criterion at high confidence carries a published "
                       "constant; the source's own summary calls almost every "
                       "criterion comparative with no published number. Wyckoff "
                       "himself rejected mechanical rules. A four-schematic "
                       "state machine would be our invention wearing his name."),
            value="grammar-not-thresholds",
            quote=("Instead of steadfast rules, Wyckoff advocated broad "
                   "guidelines when analyzing the stock market. Nothing in the "
                   "stock market is definitive."),
            source_id=_WYCKOFF, confidence="high",
        ),
        Criterion(
            condition="Trading-range lookback and how recent the spring must be",
            value=(SPRING_TR_BARS, SPRING_RECENT_BARS),
            origin="uct", confidence="high",
        ),
        Criterion(
            condition=("Horizontality of the range. OURS, and load-bearing: the "
                       "published criterion is comparative, and on a downtrend "
                       "'price went below support and closed back above it' is "
                       "true on almost every bar. This is what makes the word "
                       "support mean anything."),
            value=SPRING_MAX_BOXINESS,
            origin="uct", confidence="high",
        ),
    ),
    coverage_pct=2.8,
    detect=_detect_wyckoff_spring,
)


# -- The 3-C / Cup Completion Cheat (Mark Minervini) ------------------------
# The best-sourced structure in the whole build: nine criteria at high
# confidence with published numbers, including the ONLY explicit minimum base
# duration Minervini publishes anywhere in the book. An early pivot formed
# INSIDE a cup, before any handle -- "the earliest point at which you should
# attempt to buy any stock".

_MINERVINI_3C = "minervini_ttlac_3c"

#: "the stock should have already moved up by at least 25 to 100 percent...
#: during the previous 3 to 36 months of trading"
CHEAT_PRIOR_ADVANCE = 0.25
CHEAT_PRIOR_LOOKBACK = 250        # ~12 months, inside the published 3-36

#: "The pattern can form in as few as 3 weeks to as many as 45 weeks"
CHEAT_MIN_BARS = 15
CHEAT_MAX_BARS = 225

#: "The correction from peak to low point varies from 15 or 20 percent to 35
#: or 40 percent in some cases, and as much as 50 percent" -- the widest
#: published form is used, since the narrower one is a sub-range of it.
CHEAT_MIN_DEPTH = 0.15
CHEAT_MAX_DEPTH = 0.50

#: "Corrections in excess of 60 percent are usually too deep and are extremely
#: prone to failure." A separate DISQUALIFIER, not the band's ceiling.
CHEAT_HARD_DEPTH = 0.60

#: "form a plateau area (the cheat), which should be contained within 5 percent
#: to 10 percent from high point to low point"
CHEAT_PLATEAU_MAX_DEPTH = 0.10

#: "usually recouping about one-third to one-half its previous decline"
CHEAT_MIN_RECOVERY = 1.0 / 3.0
CHEAT_MAX_RECOVERY = 0.50

#: Ours: how long the plateau is measured over. The house says "a number of
#: days or weeks" and gives no count.
CHEAT_PLATEAU_BARS = 10

#: "trading above its upwardly trending 200-day moving average"
CHEAT_MA_BARS = 200


def _sma(bars, n, end=None):
    end = len(bars) if end is None else end
    seg = [b.get("c") or 0 for b in bars[max(0, end - n):end]
           if (b.get("c") or 0) > 0]
    return (sum(seg) / len(seg)) if len(seg) >= n else None


def cheat_state(ctx, min_recovery: float, max_recovery: float,
                require_inside_days: bool = False) -> Optional[dict]:
    """An early pivot inside a cup: the plateau after a partial right-side rally.

    ⛔ THE RECOVERY BAND IS THE WHOLE POINT. A cheat is not "price is back near
    the highs" -- it is a pause AFTER recouping only about a third to a half of
    the decline. Price that has recovered most of the base is forming a handle
    or is already extended, which is a different (and later) entry.
    """
    bars = ctx.bars
    n = len(bars)
    if n < CHEAT_MIN_BARS + 20:
        return None

    # ⛔ THE BASE'S TOP IS THE HIGHEST QUALIFYING SWING, NOT THE LAST ONE.
    # Taking `highs[-1]` picked a minor swing high formed INSIDE the plateau
    # itself, so the "base" was the last ten bars and its depth was 7% -- the
    # structure measured the pause instead of the base the pause sits in.
    cands = [h for h in ctx.highs
             if CHEAT_MIN_BARS <= (n - 1) - h["bar_index"] <= CHEAT_MAX_BARS]
    if not cands:
        return None
    top_sw = max(cands, key=lambda h: h["price"])
    top, top_i = top_sw["price"], top_sw["bar_index"]
    if top <= 0:
        return None

    after = bars[top_i:]
    lows = [b.get("l") or 0 for b in after if (b.get("l") or 0) > 0]
    if not lows:
        return None
    low = min(lows)
    if low <= 0 or low >= top:
        return None

    depth = (top - low) / top
    if depth >= CHEAT_HARD_DEPTH:
        return None
    if depth < CHEAT_MIN_DEPTH or depth > CHEAT_MAX_DEPTH:
        return None

    span = (n - 1) - top_i
    if not (CHEAT_MIN_BARS <= span <= CHEAT_MAX_BARS):
        return None

    last = bars[-1].get("c") or 0
    if last <= 0:
        return None
    recovery = (last - low) / (top - low)
    if not (min_recovery <= recovery <= max_recovery):
        return None

    plate = bars[-CHEAT_PLATEAU_BARS:]
    ph = max((b.get("h") or 0) for b in plate)
    pl = min((b.get("l") or 0) for b in plate if (b.get("l") or 0) > 0)
    if ph <= 0 or pl <= 0:
        return None
    plateau_depth = (ph - pl) / ph
    if plateau_depth > CHEAT_PLATEAU_MAX_DEPTH:
        return None

    ma = _sma(bars, CHEAT_MA_BARS)
    ma_prev = _sma(bars, CHEAT_MA_BARS, end=n - 20)
    if ma is None or ma_prev is None:
        return None
    if last <= ma or ma <= ma_prev:
        return None                       # must be above a RISING 200-day

    adv = _prior_advance(bars, n - top_i, look=CHEAT_PRIOR_LOOKBACK)
    if (adv or 0.0) < CHEAT_PRIOR_ADVANCE:
        return None

    inside = _inside_days_on_light_volume(bars, top_i)
    if require_inside_days and not inside:
        return None

    return {"top": top, "low": low, "depth": depth, "bars": span,
            "recovery": recovery, "plateau_depth": plateau_depth,
            "prior_advance": adv, "pivot": ph, "inside_days": inside}


def _inside_days_on_light_volume(bars, base_start: int,
                                 window: int = 5, need: int = 2) -> int:
    """Inside days in the recent window whose volume is below the base's mean.

    SOURCED as a confirmation, with no number: "I also like to see some inside
    days on very low volume, another sign that supply coming to market has
    slowed to a trickle". "Some" and "very low" are not quantities, so the
    counts here are ours and are recorded as ours.
    """
    seg = [b.get("v") or 0 for b in bars[base_start:] if (b.get("v") or 0) > 0]
    if not seg:
        return 0
    base_vol = sum(seg) / len(seg)
    hits = 0
    for i in range(max(1, len(bars) - window), len(bars)):
        cur, prev = bars[i], bars[i - 1]
        ch, cl = cur.get("h") or 0, cur.get("l") or 0
        ph_, pl = prev.get("h") or 0, prev.get("l") or 0
        if ch <= 0 or cl <= 0 or ph_ <= 0 or pl <= 0:
            continue
        if ch < ph_ and cl > pl and (cur.get("v") or 0) < base_vol:
            hits += 1
    return hits


def cheat_3c_state(ctx) -> Optional[dict]:
    """The classic cheat: a plateau in the MIDDLE third of the base."""
    return cheat_state(ctx, CHEAT_MIN_RECOVERY, CHEAT_MAX_RECOVERY)


def _detect_cheat_3c(ctx) -> bool:
    return cheat_3c_state(ctx) is not None


CHEAT_3C = Structure(
    key="cheat-3c",
    label="Cheat (3-C)",
    axis="relation",
    family="Base Structure",
    bias="bullish",
    rank=12,
    min_bars=CHEAT_MIN_BARS + 20,
    desc=("A pause inside a cup after price has recouped only a third to a "
          "half of its decline -- an early pivot before any handle forms."),
    criteria=(
        Criterion(
            condition="Prior advance required",
            value=CHEAT_PRIOR_ADVANCE,
            quote=("To qualify, the stock should have already moved up by at "
                   "least 25 to 100 percent-and in some cases by 200 or 300 "
                   "percent-during the previous 3 to 36 months of trading."),
            source_id=_MINERVINI_3C, confidence="high",
        ),
        Criterion(
            condition="Trend gate -- above a RISING 200-day moving average",
            value=CHEAT_MA_BARS,
            quote=("The stock also should be trading above its upwardly "
                   "trending 200-day moving average"),
            source_id=_MINERVINI_3C, confidence="high",
        ),
        Criterion(
            condition=("Pattern duration. ⭐ The ONLY explicit minimum base "
                       "duration Minervini publishes anywhere in the book -- "
                       "the VCP section publishes none, which is why the VCP "
                       "entry records that as a refusal rather than borrowing "
                       "this number."),
            value=(CHEAT_MIN_BARS, CHEAT_MAX_BARS),
            quote=("The pattern can form in as few as 3 weeks to as many as 45 "
                   "weeks (most are 7 to 25 weeks in duration)."),
            source_id=_MINERVINI_3C, confidence="high",
        ),
        Criterion(
            condition="Pattern depth",
            value=(CHEAT_MIN_DEPTH, CHEAT_MAX_DEPTH),
            quote=("The correction from peak to low point varies from 15 or 20 "
                   "percent to 35 or 40 percent in some cases, and as much as "
                   "50 percent, depending on the general market conditions."),
            source_id=_MINERVINI_3C, confidence="high",
        ),
        Criterion(
            condition="Depth disqualifier, separate from the band",
            value=CHEAT_HARD_DEPTH,
            quote=("Corrections in excess of 60 percent are usually too deep "
                   "and are extremely prone to failure."),
            source_id=_MINERVINI_3C, confidence="high",
        ),
        Criterion(
            condition="The plateau (the cheat itself), high to low",
            value=CHEAT_PLATEAU_MAX_DEPTH,
            quote=("The stock will pause over a number of days or weeks and "
                   "form a plateau area (the cheat), which should be contained "
                   "within 5 percent to 10 percent from high point to low "
                   "point."),
            source_id=_MINERVINI_3C, confidence="high",
        ),
        Criterion(
            condition=("Right-side rally BEFORE the pause. ⛔ This band is the "
                       "whole point: a cheat is a pause after recouping only "
                       "about a third to a half of the decline, not price back "
                       "near its highs -- that is a handle, or extended."),
            value=(CHEAT_MIN_RECOVERY, CHEAT_MAX_RECOVERY),
            quote=("The price will start to run up the right side, usually "
                   "recouping about one-third to one-half its previous "
                   "decline."),
            source_id=_MINERVINI_3C, confidence="high",
        ),
        Criterion(
            condition="Preferred shakeout -- the plateau drifting below a prior low",
            value="shakeout-preferred",
            quote=("The optimum situation is to have the cheat drift down to "
                   "where the price drops below a prior low point, creating a "
                   "shakeout"),
            source_id=_MINERVINI_3C, confidence="high",
        ),
        Criterion(
            condition="Volume dry-up and price tightness at the cheat",
            value=None,
            quote=("A valid cheat area should exhibit a contraction in volume "
                   "and tightness in price."),
            source_id=_MINERVINI_3C, confidence="high",
            missing=("No volume ratio and no window for 'dries up "
                     "dramatically'. The 5-10% plateau bound already enforces "
                     "the price tightness half, so no invented volume "
                     "threshold is added on top of it."),
        ),
        Criterion(
            condition="Length of the plateau",
            value=CHEAT_PLATEAU_BARS,
            origin="uct", confidence="high",
        ),
    ),
    coverage_pct=2.2,
    detect=_detect_cheat_3c,
)


# -- The "Low Cheat" (Mark Minervini) ---------------------------------------
# ⭐ THE SAME DETECTOR AS THE 3-C WITH ONE BAND MOVED. Minervini's own framing
# is positional, not structural: "The low cheat forms in the LOWER THIRD of the
# base. It's riskier to buy in the lower third of the base than in the middle
# third (the classic cheat area) or the upper third (from the handle)." So the
# two share `cheat_state` and differ only in where the plateau sits -- writing
# a second detector would put a second authority on every other rule they hold
# in common.

_MINERVINI_LOW = "minervini_ttlac_lowcheat"

#: The lower third of the base. The 3-C's band starts where this one ends.
LOW_CHEAT_MIN_RECOVERY = 0.05
LOW_CHEAT_MAX_RECOVERY = 1.0 / 3.0


def low_cheat_state(ctx) -> Optional[dict]:
    """A plateau in the lower third of the base, with inside days to confirm."""
    return cheat_state(ctx, LOW_CHEAT_MIN_RECOVERY, LOW_CHEAT_MAX_RECOVERY,
                       require_inside_days=True)


def _detect_low_cheat(ctx) -> bool:
    return low_cheat_state(ctx) is not None


LOW_CHEAT = Structure(
    key="low-cheat",
    label="Low Cheat",
    axis="relation",
    family="Base Structure",
    bias="bullish",
    rank=11,
    min_bars=CHEAT_MIN_BARS + 20,
    desc=("A pause in the LOWER third of a base -- an earlier and riskier "
          "entry than the classic cheat, confirmed by inside days on light "
          "volume."),
    criteria=(
        Criterion(
            condition="Location -- the lower third of the base",
            value=(LOW_CHEAT_MIN_RECOVERY, LOW_CHEAT_MAX_RECOVERY),
            quote=("The low cheat forms in the lower third of the base. It's "
                   "riskier to buy in the lower third of the base than in the "
                   "middle third (the classic cheat area) or the upper third "
                   "(from the handle)."),
            source_id=_MINERVINI_LOW, confidence="high",
        ),
        Criterion(
            condition="Confirmation -- inside days on very low volume",
            value="inside-days-light-volume",
            quote=("Before I buy, I also like to see some inside days on very "
                   "low volume, another sign that supply coming to market has "
                   "slowed to a trickle and the line of least resistance is "
                   "forming."),
            source_id=_MINERVINI_LOW, confidence="high",
        ),
        Criterion(
            condition="Minimum post-IPO basing period",
            value=10,
            quote="The basing period after the IPO should be at least 10 days.",
            source_id=_MINERVINI_LOW, confidence="high",
        ),
        Criterion(
            condition=("Intended universe -- larger caps and recent IPOs. The "
                       "MARKET-CAP FLOOR is not published."),
            value=None,
            quote=("I like to use the low cheat for larger cap names, and in "
                   "some cases new issues that recently went public."),
            source_id=_MINERVINI_LOW, confidence="high",
            missing=("No cap floor is given. A third party asserts '>$10B'; "
                     "that number is THEIRS, not his, and importing it would "
                     "put a figure in his mouth. So this detector does not "
                     "filter by size at all, which means it fires on small "
                     "caps he would not apply it to."),
        ),
        Criterion(
            condition="The IPO condition itself",
            value=None,
            quote=("The low cheat can work for IPOs that don't spend much time "
                   "trading below their IPO price and don't correct too "
                   "excessively."),
            source_id=_MINERVINI_LOW, confidence="high",
            missing=("'Much time' and 'too excessively' are not quantities, "
                     "and we hold no IPO-price field either, so the IPO branch "
                     "is not implemented."),
        ),
        Criterion(
            condition="Position sizing -- scale in, do not commit fully",
            value=None,
            quote=("I will often start a position at a low cheat and then add "
                   "as it forms additional pivot points at progressively "
                   "higher prices."),
            source_id=_MINERVINI_LOW, confidence="high",
            missing=("He publishes no fractions. A third party's ladder "
                     "('<=20% at the low cheat, ~50% at the cheat, full at the "
                     "handle') is theirs, not his. Sizing is not this "
                     "detector's business anyway -- recorded so the absence is "
                     "visible."),
        ),
        Criterion(
            condition=("Worked example durations -- 14 days (GOOG), 19 days "
                       "(TWTR). EXAMPLES, not thresholds."),
            value="14d/19d-illustrative",
            quote="The Twitter base formed in 19 days.",
            source_id=_MINERVINI_LOW, confidence="high",
        ),
        Criterion(
            condition=("The named outcomes are not performance: GOOG 'soared "
                       "625 percent in 40 months', TWTR 'ran up 77 percent in "
                       "just 16 days'."),
            value=None,
            source_id=_MINERVINI_LOW, confidence="high",
            missing=("Single illustrations. No sample, no base rate, and "
                     "selected after the fact."),
        ),
        Criterion(
            condition="Inside-day window and count required",
            value=(5, 2),
            origin="uct", confidence="high",
        ),
    ),
    coverage_pct=1.1,
    detect=_detect_low_cheat,
)


# -- Saucer with Handle (IBD) -----------------------------------------------
# ⭐⭐ IBD AGAINST ITSELF, INSIDE ONE BASE NAME. One column says a saucer
# corrects "about 12% to 20%"; another says "up to 30%, or as much as a solid
# cup pattern". A detector cannot satisfy both, and averaging them would
# produce a number neither column published. We take the WIDER band -- so the
# gate refuses only what BOTH columns would refuse -- and record the tighter
# one verbatim.
#
# ⚠️ AND THE HOUSE SAYS THIS STRUCTURE IS HARD TO SEE ON DAILY BARS: "saucer
# bases can be so long that they're only visible on a weekly or monthly
# chart." A daily-bar detector will therefore MISS saucers rather than merely
# mis-score them. Recorded on the structure, because it bounds what any
# measurement of it can mean.

_IBD_SAUCER = "ibd_saucer"

#: "A proper saucer takes at least seven weeks to develop." / "Saucers form
#: over a period of seven weeks to a year or more."
SAUCER_MIN_BARS = 35
SAUCER_MAX_BARS = 300          # ~a year and a bit, the published upper shape

#: The WIDER of the two published depth ceilings. See the conflict above.
SAUCER_MAX_DEPTH = 0.30
SAUCER_MIN_DEPTH = 0.08

#: OURS, and it is what separates a saucer from a cup: a saucer is SHALLOW AND
#: LONG, a cup is deeper and shorter. The corpus says outright that the
#: boundary "is a tunable, not a rule" -- IBD publishes no cutoff -- so the
#: discriminator is depth per unit of duration, and the number is ours.
SAUCER_MAX_DEPTH_PER_100_BARS = 0.12


def saucer_state(ctx) -> Optional[dict]:
    """A long, shallow, rounded base ending at the last bar.

    ⛔ THE SHAPE TEST IS WHAT KEEPS THIS FROM BEING "ANY LONG BASE". Depth and
    duration alone admit every cup; the saucer is the one whose decline is
    gradual enough that the base flattens and stretches.
    """
    bars = ctx.bars
    n = len(bars)
    if n < SAUCER_MIN_BARS + 10:
        return None

    cands = [h for h in ctx.highs
             if SAUCER_MIN_BARS <= (n - 1) - h["bar_index"] <= SAUCER_MAX_BARS]
    if not cands:
        return None
    top_sw = max(cands, key=lambda h: h["price"])
    top, top_i = top_sw["price"], top_sw["bar_index"]
    if top <= 0:
        return None

    seg = bars[top_i:]
    lows = [b.get("l") or 0 for b in seg if (b.get("l") or 0) > 0]
    if not lows:
        return None
    low = min(lows)
    if low <= 0 or low >= top:
        return None

    span = (n - 1) - top_i
    depth = (top - low) / top
    if depth < SAUCER_MIN_DEPTH or depth > SAUCER_MAX_DEPTH:
        return None

    # Shallow AND long: the discriminator against a cup.
    if depth > SAUCER_MAX_DEPTH_PER_100_BARS * (span / 100.0):
        return None

    r = shape.roundness(bars, top_i, n - 1)
    if r is None or r < cup.MIN_ROUNDNESS:
        return None

    low_idx = min(range(top_i, n), key=lambda i: bars[i].get("l") or 1e18)
    return {"top": top, "low": low, "depth": depth, "bars": span,
            "roundness": r,
            "symmetry": shape.symmetry(bars, top_i, low_idx, n - 1),
            "pivot": max((b.get("h") or 0) for b in bars[-10:]) + 0.10}


def _detect_saucer(ctx) -> bool:
    return saucer_state(ctx) is not None


SAUCER = Structure(
    key="saucer",
    label="Saucer",
    axis="relation",
    family="Base Structure",
    bias="bullish",
    rank=23,
    min_bars=SAUCER_MIN_BARS + 10,
    desc=("A long, shallow, rounded base -- the cup's gentler cousin, where "
          "the decline is slow enough that the pattern flattens and "
          "stretches."),
    criteria=(
        Criterion(
            condition="Base length, minimum",
            value=SAUCER_MIN_BARS,
            quote="A proper saucer takes at least seven weeks to develop.",
            source_id=_IBD_SAUCER, confidence="high",
        ),
        Criterion(
            condition="Base length, published range",
            value=(SAUCER_MIN_BARS, SAUCER_MAX_BARS),
            quote="Saucers form over a period of seven weeks to a year or more.",
            source_id=_IBD_SAUCER, confidence="high",
        ),
        Criterion(
            condition=("⭐⭐ DEPTH: IBD AGAINST ITSELF INSIDE ONE BASE NAME. One "
                       "column says 'about 12% to 20%', another 'up to 30%, or "
                       "as much as a solid cup pattern'. A detector cannot "
                       "satisfy both and averaging would invent a third "
                       "number. We take the WIDER, so the gate refuses only "
                       "what BOTH columns refuse."),
            value=SAUCER_MAX_DEPTH,
            quote=("they can correct up to 30%, or as much as a solid cup "
                   "pattern."),
            source_id=_IBD_SAUCER, confidence="high",
        ),
        Criterion(
            condition="The tighter published depth, recorded not applied",
            value="12-20%",
            quote=("You might see a correction of about 12% to 20%, while a "
                   "typical cup can run as deep as 35%."),
            source_id=_IBD_SAUCER, confidence="high",
        ),
        Criterion(
            condition="Handle volume -- light, drifting lower",
            value="light-drifting-lower",
            quote="The handle drifted lower in light volume, a bullish sign.",
            source_id=_IBD_SAUCER, confidence="high",
        ),
        Criterion(
            condition=("Symmetry -- weeks left of the low matching weeks right. "
                       "Stated as PRAISE OF ONE EXAMPLE, not as a rule, so it "
                       "is scored and reported, never gated."),
            value="reported-not-gated",
            quote=("Altria's base showed nice symmetry. The number of weeks on "
                   "the left side of the pattern equaled the number of weeks "
                   "on the right side."),
            source_id=_IBD_SAUCER, confidence="high",
        ),
        Criterion(
            condition=("⚠️ THE HOUSE SAYS THIS IS HARD TO SEE ON DAILY BARS, "
                       "which bounds what any measurement of it can mean: a "
                       "daily-bar detector will MISS saucers, not merely "
                       "mis-score them."),
            value="weekly-or-monthly",
            quote=("saucer bases can be so long that they're only visible on a "
                   "weekly or monthly chart."),
            source_id=_IBD_SAUCER, confidence="high",
        ),
        Criterion(
            condition="Saucer-specific handle geometry",
            value=None,
            source_id=_IBD_SAUCER, confidence="high",
            missing=("Neither column publishes handle depth, length or "
                     "position for a saucer. Whether the cup-with-handle's "
                     "handle rules transfer unchanged is not stated, so they "
                     "are NOT imported -- that would be borrowing a number "
                     "across patterns."),
        ),
        Criterion(
            condition="Breakout volume threshold",
            value=None,
            quote=("Sometimes volume can kick in a bit late with a [breakout], "
                   "but the move still works out."),
            source_id=_IBD_SAUCER, confidence="high",
            missing=("The house explicitly SOFTENS the volume rule here rather "
                     "than stating one, so there is no threshold to apply."),
        ),
        Criterion(
            condition=("The claim that saucers produce gains 'similar to' cups "
                       "and flat bases"),
            value=None,
            quote=("capable of producing strong gains similar to shorter "
                   "patterns such as the cup-with-handle and flat bases."),
            source_id=_IBD_SAUCER, confidence="high",
            missing=("An equivalence claim with no sample, no period and no "
                     "comparison statistic. Not usable as evidence."),
        ),
        Criterion(
            condition=("Saucer-versus-cup boundary -- depth per 100 bars. OURS, "
                       "and the corpus says outright it must be: 'IBD "
                       "publishes no cutoff, so the saucer/cup boundary is a "
                       "tunable, not a rule.'"),
            value=SAUCER_MAX_DEPTH_PER_100_BARS,
            origin="uct", confidence="high",
        ),
    ),
    coverage_pct=1.9,
    detect=_detect_saucer,
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

RELATIONS = [ASCENDING_BASE, BASE_ON_BASE, CHEAT_3C, CLIMAX_TOP,
             LOW_CHEAT,
             CUP_WITH_HANDLE,
             DARVAS_BOX, DOUBLE_BOTTOM, FLAT_BASE, GREEN_LINE_BREAKOUT,
             HIGH_TIGHT_FLAG, PARABOLIC_EXTENSION, POCKET_PIVOT,
             POWER_PLAY, SQUARE_BOX, STAGE2_BREAKOUT, STAGE4_BREAKDOWN,
             SAUCER, VCP, WYCKOFF_SPRING]

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
