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

RELATIONS = [DARVAS_BOX]

ALL_STRUCTURES = SHAPES + RELATIONS
_BY_KEY = {s.key: s for s in ALL_STRUCTURES}


def by_key(key):
    return _BY_KEY.get(key)


def meta() -> dict:
    """What the frontend and the filter registry read. Nobody restates a key."""
    return {
        s.key: {
            "label": s.label,
            "desc": s.desc,
            "axis": s.axis,
            "family": s.family,
            "bias": s.bias,
            "needs_intraday": s.needs_intraday,
            "coverage_pct": s.coverage_pct,
        }
        for s in ALL_STRUCTURES
    }
