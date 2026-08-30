"""Multi-week BASE structure classification — the orchestrator.

`base_catalog` owns what a structure IS; this module owns the pipeline that
runs it over one symbol's bars and produces the snapshot columns. Nothing here
decides what a structure means, and nothing in the catalog decides how a row
is assembled.

    guard -> context -> segment -> classify SHAPE -> collect RELATIONS
          -> rank -> render

⭐ THE TWO-AXIS SPLIT IS THE WHOLE DESIGN. SHAPE is a TOTAL partition (exactly
one, always, because `_classify_shape`'s last branch takes no condition);
RELATIONS are SPARSE (zero or many, each an independent predicate). The candle
library's original 7-label chain fused these and every shape branch
short-circuited every relation branch — one bar could satisfy a hammer AND an
engulfing and only ever reported the first. That produced three defects at
once and 43.6% unnamed rows. Do not merge the axes here.

⛔ `base_matches` IS DELIMITER-WRAPPED (`,key,`). `contains` compiles to
`LIKE %v%` in `query.py`, so a bare CSV makes a filter for `range` match a row
carrying only `contracting-range`. `candle_matches` is wrapped for exactly
this reason; the trap is documented and already shipped once.

⛔ THE COLUMNS ARE THE SCREENABLE FACT; `base_shape` IS THE RENDERED HEAD.
Screen `base_matches`, never `base_shape` — the same information loss the
candle library records: filtering the head silently drops every symbol whose
structure was ALSO something else.
"""
from dataclasses import dataclass
from typing import List, Optional

from api.services.pattern_engine.primitives import zigzag
from api.services.screener import base_catalog

#: Below this we refuse rather than read a structure into noise. The segmenter
#: itself needs `MIN_SIGMA_BARS + 2`; a structure needs enough swings on top of
#: that to say anything. origin: uct.
MIN_HISTORY = 60

_NULL = {
    "base_shape": None,
    "base_shape_label": None,
    "base_matches": None,
    "base_relation_count": None,
    "base_render": None,
}


class BaseCtx:
    """Everything a structure predicate may look at, built once per ticker.

    ⚠️ `swings` EXCLUDES the provisional trailing swing. A structure must never
    be built on a swing that can still move — that is the repainting six of ten
    charting vendors do not disclose. The provisional one is kept separately for
    predicates that legitimately want to know where price is right now.

    ⭐⭐ THE SEGMENTATION IS LAZY, AND THAT IS A THROUGHPUT DECISION WITH A
    MEASUREMENT BEHIND IT. `zigzag.segment` costs **8.48 ms** on a 600-bar
    window; the base-on-base and cup-with-handle predicates cost 0.28 ms and
    0.47 ms. Neither reads a swing. The lift harness rebuilds a context PER
    ANCHOR -- tens of thousands per scan, six scans per screen -- so eagerly
    segmenting made a measurement of a structure that never asks for swings
    spend ~97% of its time computing them. A base-on-base screen ran forty
    minutes without finishing; the cost was never in the detector.

    Nothing about the VALUES changes: the same confirmed-only list, computed
    from the same bars, the first time anything asks. `test_bases.py` pins that
    the lazy and eager readings agree, because a cache that quietly returns
    something else would move every structure at once.
    """

    __slots__ = ("bars", "bars_full", "_seg")

    def __init__(self, bars: list, bars_full: list):
        self.bars = bars
        #: The DEEP series, when the caller has one. Structures whose
        #: definition reaches past the working window (Green Line Breakout
        #: needs every month we hold) read this; everything else reads `bars`.
        #: Defaults to `bars` so a caller with only one series is never handed
        #: None.
        self.bars_full = bars_full if bars_full else bars
        self._seg = None

    def _segment(self) -> dict:
        if self._seg is None:
            swings = zigzag.segment(self.bars)
            confirmed = [x for x in swings if not x["provisional"]]
            self._seg = {
                "swings": confirmed,
                "provisional": next(
                    (x for x in swings if x["provisional"]), None),
                "highs": [x for x in confirmed if x["type"] == "high"],
                "lows": [x for x in confirmed if x["type"] == "low"],
            }
        return self._seg

    @property
    def swings(self) -> list:
        return self._segment()["swings"]

    @property
    def provisional(self):
        return self._segment()["provisional"]

    @property
    def highs(self) -> list:
        return self._segment()["highs"]

    @property
    def lows(self) -> list:
        return self._segment()["lows"]

    def __repr__(self) -> str:
        state = "segmented" if self._seg is not None else "unsegmented"
        return "BaseCtx(bars=%d, %s)" % (len(self.bars), state)


def _context(bars: list, bars_full: list) -> BaseCtx:
    """Build a context. The zigzag runs only if a predicate asks for it."""
    return BaseCtx(bars=bars, bars_full=bars_full)


def _classify_shape(ctx: BaseCtx) -> str:
    """Return exactly one shape key. TOTAL BY CONSTRUCTION.

    🔴 THE DEFECT THIS SHAPE IS BUILT TO AVOID. The candle library's original
    chain ended on a conditional branch, so a bar that satisfied none of them
    kept `"none"` — 1,620 of 3,714 rows (43.6%), every one of them fully
    measured. The final `return` below takes NO condition, so there is no
    series this function cannot name.
    """
    highs, lows = ctx.highs, ctx.lows
    if len(highs) >= 2 and len(lows) >= 2:
        highs_rising = highs[-1]["price"] > highs[-2]["price"]
        lows_rising = lows[-1]["price"] > lows[-2]["price"]
        if highs_rising and lows_rising:
            return "advancing-structure"
        if not highs_rising and not lows_rising:
            return "declining-structure"
        if not highs_rising and lows_rising:
            return "contracting-range"
        return "expanding-range"
    return base_catalog.FALLBACK_SHAPE


def _collect_relations(ctx: BaseCtx) -> List[str]:
    """Every relation whose predicate fires. Sparse: zero or many.

    ⛔ ONE BAD PREDICATE COSTS THAT PREDICATE, NEVER THE ROW. Same failure
    contract as every context-join reader in this package — a structure that
    raises on some edge case must not turn the whole symbol into a null row.
    """
    out = []
    for s in base_catalog.RELATIONS:
        if len(ctx.bars) < s.min_bars:
            continue
        if s.detect is None:
            continue
        try:
            if s.detect(ctx):
                out.append(s.key)
        except Exception:
            continue
    return out


def _render_order(shape_key: str, relation_keys: List[str]) -> List[str]:
    """Relations lead, then the shape.

    A named structure ("Darvas Box") is a more specific statement than a trend
    reading ("Advancing Structure"), so it takes the rendered head. The shape
    is never lost — it keeps its own column and its place in `base_matches`.
    """
    ranked = sorted(
        relation_keys,
        key=lambda k: (base_catalog.by_key(k).rank if base_catalog.by_key(k) else 10 ** 6),
    )
    return ranked + [shape_key]


def _render(labels: List[str]) -> Optional[str]:
    """`Primary (Secondary) +N` — the candle library's rendering, unchanged."""
    if not labels:
        return None
    head = labels[0]
    if len(labels) == 1:
        return head
    out = f"{head} ({labels[1]})"
    extra = len(labels) - 2
    return f"{out} +{extra}" if extra > 0 else out


def classify(bars, bars_full=None) -> dict:
    """Name this symbol's multi-week structure.

    Returns the snapshot columns. On refusal every KEY is still present with a
    `None` value — a missing key and a null value are different facts to every
    consumer downstream.
    """
    if not bars or len(bars) < MIN_HISTORY:
        return dict(_NULL)

    ctx = _context(bars, bars_full)
    shape_key = _classify_shape(ctx)
    relation_keys = _collect_relations(ctx)

    order = _render_order(shape_key, relation_keys)
    labels = []
    for key in order:
        s = base_catalog.by_key(key)
        if s is not None:
            labels.append(s.label)

    matches = [shape_key] + relation_keys
    shape = base_catalog.by_key(shape_key)

    return {
        "base_shape": shape_key,
        "base_shape_label": shape.label if shape else None,
        # ⛔ wrapped at BOTH ends — see the module docstring.
        "base_matches": "," + ",".join(matches) + ",",
        "base_relation_count": len(relation_keys),
        "base_render": _render(labels),
    }
