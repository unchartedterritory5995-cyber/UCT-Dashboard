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


@dataclass(frozen=True)
class BaseCtx:
    """Everything a structure predicate may look at, built once per ticker.

    ⚠️ `swings` EXCLUDES the provisional trailing swing. A structure must never
    be built on a swing that can still move — that is the repainting six of ten
    charting vendors do not disclose. The provisional one is kept separately for
    predicates that legitimately want to know where price is right now.
    """
    bars: list
    swings: list          # confirmed only
    provisional: Optional[dict]
    highs: list           # confirmed swing highs, oldest -> newest
    lows: list            # confirmed swing lows, oldest -> newest


def _context(bars: list) -> BaseCtx:
    swings = zigzag.segment(bars)
    confirmed = [s for s in swings if not s["provisional"]]
    prov = next((s for s in swings if s["provisional"]), None)
    return BaseCtx(
        bars=bars,
        swings=confirmed,
        provisional=prov,
        highs=[s for s in confirmed if s["type"] == "high"],
        lows=[s for s in confirmed if s["type"] == "low"],
    )


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


def classify(bars) -> dict:
    """Name this symbol's multi-week structure.

    Returns the snapshot columns. On refusal every KEY is still present with a
    `None` value — a missing key and a null value are different facts to every
    consumer downstream.
    """
    if not bars or len(bars) < MIN_HISTORY:
        return dict(_NULL)

    ctx = _context(bars)
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
