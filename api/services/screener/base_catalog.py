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
    needs_intraday: bool = False
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

RELATIONS = [DARVAS_BOX, GREEN_LINE_BREAKOUT, POCKET_PIVOT, POWER_PLAY]

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
            "needs_intraday": s.needs_intraday,
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
