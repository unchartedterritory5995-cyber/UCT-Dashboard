"""The structures sweep behind the cup tier's byte-for-byte rail (synthetic bars only, public repo).

`run(auto_structures)` feeds every scan of tests/flat_top_sweep.py (seeded series x cuts) to
`auto_structures.structures_for` -- the one function a chart's `structures` comes from -- and digests its rows
per scan. With `strip` the tier stamp (`extras.cup_tier`, the only key the tier adds) is removed first, so the
digest covers exactly what existed before the tier: every base_catalog box as box_to_detection stamps it. The
golden is written by tools/cup_tier_golden.py from code that has no cup tier; regenerate it only from such code.
"""
from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import os

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("flat_top_sweep_for_cup_tier",
                                               os.path.join(_HERE, "flat_top_sweep.py"))
SW = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(SW)

STAMP_KEY = "cup_tier"
#: A LATER drawing's own row (lab id_draw_v2), built after this golden was written: never digested or counted
#: here; tests/test_inside_day_draw_golden.py rails it.
INSIDE_DAY_ID = "draw:inside-day"
SYM = "SYN"


def canonical(rows: list, strip: bool = True) -> str:
    out = []
    for r in rows:
        r = copy.deepcopy(r)
        if strip:
            ((r.get("geometry") or {}).get("extras") or {}).pop(STAMP_KEY, None)
        out.append(json.dumps(r, sort_keys=True, separators=(",", ":"), default=str))
    return "[" + ",".join(out) + "]"


def digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def _base_as_round_one(auto_structures, rows):
    """The bc:base row in the form round 1 drew it. This golden was written while the base drawing was round 1;
    the drawing code has since moved to round 2 (lab base_draw_v2), whose rows carry round 1's drawing for
    members (auto_structures._base_member_row). Mapping through it keeps this rail pinned to exactly what it
    pinned before -- the round-2 drawing has its own rails (tests/test_base_draw_round2.py,
    tests/test_base_draw_member_parity.py). Code without the carrier is passed through unchanged."""
    fn = getattr(auto_structures, "_base_member_row", None)
    if fn is None:
        return rows
    out = []
    for r in rows:
        if r.get("pattern_id") == "bc:base":
            r = fn(r)
            if r is None:
                continue
        out.append(r)
    return out


def run(auto_structures, strip: bool = True):
    """({key: digest}, counts) for one implementation of auto_structures.structures_for."""
    saved = auto_structures._daily_bars, auto_structures.last_bar_forming
    out, counts = {}, {"scans": 0, "rows": 0, "cup_rows": 0, "stamped": 0}
    try:
        auto_structures.last_bar_forming = lambda t, now=None: False
        for key, bars in SW.scans():
            snap = json.loads(json.dumps(bars))
            auto_structures._daily_bars = lambda sym, _b=snap: json.loads(json.dumps(_b))
            auto_structures._CACHE.clear()
            rows = [r for r in auto_structures.structures_for(SYM) if r.get("pattern_id") != INSIDE_DAY_ID]
            rows = _base_as_round_one(auto_structures, rows)
            counts["scans"] += 1
            for r in rows:
                counts["rows"] += 1
                counts["cup_rows"] += r.get("pattern_id") == "bc:cup-with-handle"
                counts["stamped"] += STAMP_KEY in ((r.get("geometry") or {}).get("extras") or {})
            out[key] = digest(canonical(rows, strip))
    finally:
        auto_structures._daily_bars, auto_structures.last_bar_forming = saved
        auto_structures._CACHE.clear()
    return out, counts
