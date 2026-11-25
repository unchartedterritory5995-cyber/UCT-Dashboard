"""EDGE CHARTS FOR THE FORMULA LANE (2026-11-25): the plain bars, with one or two bars set so that a check can tell a
window one bar longer, or a strict comparison from one that admits an equal value.

⚰️ WHY: the value-case audit (2026-11-25) graded two slips of every recorded right answer by its own rule: every length
one bar longer, and every strict comparison flipped. On the plain bars of `market.py` five formula cases could not
see the window (the extreme of N bars and of N + 1 bars are the same bar everywhere), and some could not see "above"
from "at least" (the generated prices never tie). A check that cannot tell right from wrong proves nothing about the
words it was written from. The script lane has had edge charts since 2026-11-21 (`script_lane.mjs` `chartOf`); this
is the formula lane's, with the same idea and explicit parts:

  {"extreme": {"field": "c" | "h" | "l" | "v", "back": N, "at": K, "factor": F}}
      the END bar (K bars before the newest, the newest by default) gets 1.25 x the field's highest value on the
      chart, and the bar N bars before the end bar gets F x it (1.5 by default: then it is the strict highest and
      the end bar is above every other bar; on the end bar a window that stops one bar short of the marked bar finds
      the end bar the highest, one that reaches it does not). With F between 1 and 1.25 the marked bar is the
      chart's second highest: an earlier qualifying high just outside a window, below the end bar ("a new high
      after N bars without one");
  {"tie": {"field": ..., "back": A, "as": B}}
      the bar A bars before the newest takes EXACTLY the value of the bar B bars before it (after any extreme):
      "above" and "at least" then disagree on the bar that reads them.

A case names its edge as `"edge"` in the fixture, a list of those parts. The rule is unchanged: it is computed on the
edge chart exactly as on the plain one (`rules.bind`), the formula is evaluated on the same bars, and the case is
right only when it is right on both.
"""
from __future__ import annotations

import contextlib
import copy
from typing import Any, Dict, List

FIELDS = ("o", "h", "l", "c", "v")


def edge_bars(bars: List[Dict[str, Any]], edge: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """The bars with the edge's parts applied in order (a copy; `bars` is not touched)."""
    out = copy.deepcopy(list(bars))
    n = len(out)
    for part in edge:
        if set(part) - {"extreme", "tie"} or len(part) != 1:
            raise ValueError(f"an edge part is one extreme or one tie: {part!r}")
    for part in (p for p in edge if "extreme" in p):
        x = part["extreme"]
        f, back, at = x["field"], int(x["back"]), int(x.get("at", 0))
        factor = float(x.get("factor", 1.5))
        assert f in FIELDS and 0 < back and 0 <= at and at + back < n and factor > 0, part
        top = max(b[f] for b in out)
        # the window ends on the bar `at` bars before the newest (the newest by default); the marked bar is `back`
        # bars before THAT one. factor > 1.25: the marked bar is above the end bar; below 1.25: just under it
        out[n - 1 - at - back][f] = top * factor
        out[n - 1 - at][f] = top * 1.25
    for bar in out:                                   # a bar stays a bar: its high and low hold its open and close
        bar["h"] = max(bar["h"], bar["o"], bar["c"])
        bar["l"] = min(bar["l"], bar["o"], bar["c"])
    # ties last, exactly: nothing moves a tied value after it is set, and a tie that would break a bar is refused
    for part in (p for p in edge if "tie" in p):
        f, a, b = part["tie"]["field"], int(part["tie"]["back"]), int(part["tie"]["as"])
        assert f in FIELDS and 0 <= a < n and 0 <= b < n and a != b, part
        out[n - 1 - a][f] = out[n - 1 - b][f]
        bar = out[n - 1 - a]
        assert bar["l"] <= min(bar["o"], bar["c"]) and bar["h"] >= max(bar["o"], bar["c"]), f"the tie breaks the bar: {part!r}"
    return out


def script_form(edge: Any) -> Any:
    """The same edge in the SCRIPT lane's form (`script_lane.mjs` `chartOf`), for a reference script that answers a
    formula case: its ties as `{"ties": [{field, back, as}]}`. A script-lane edge (a dict) or none is returned as it
    is. An extreme has no script-lane form here: refused, never dropped."""
    if not isinstance(edge, list):
        return edge
    if any("tie" not in part for part in edge):
        raise ValueError(f"only ties have a script-lane form: {edge!r}")
    return {"ties": [dict(part["tie"]) for part in edge]}


@contextlib.contextmanager
def on(edge: List[Dict[str, Any]], chart: str = "daily"):
    """Within: the formula lane's chart AND its rules read the edge chart's bars. Restored on the way out."""
    from . import grade as G
    from . import rules as R
    c = G.CHARTS[chart]
    plain = c["bars"]
    bars = edge_bars(plain, edge)
    c["bars"] = bars
    R.bind(bars)
    try:
        yield bars
    finally:
        c["bars"] = plain
        R.bind(plain)
