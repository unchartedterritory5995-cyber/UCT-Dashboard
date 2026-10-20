"""The structures sweep behind the base drawing's byte-for-byte rail (synthetic bars only, public repo).

`run(auto_structures)` feeds every scan of tests/flat_top_sweep.py (24 seeded series x 7 cuts) to
`auto_structures.structures_for` -- the one function a chart's `structures` comes from -- and digests
its rows per scan. With `drop_base` the base drawing's own row (pattern_id bc:base) is removed first,
so the digest covers exactly the rows that existed before the drawing: every base_catalog box as
box_to_detection stamps it. The golden is written by tools/base_draw_golden.py from code that has no
base drawing; regenerate it only from such code, never from the code under test.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("flat_top_sweep_for_base",
                                               os.path.join(_HERE, "flat_top_sweep.py"))
SW = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(SW)

BASE_ID = "bc:base"
#: A LATER drawing's own row (lab id_draw_v2). The base golden pins the rows that existed before the
#: base drawing, so this row is never part of its digest; tests/test_inside_day_draw_golden.py rails it.
INSIDE_DAY_ID = "draw:inside-day"
SYM = "SYN"


def canonical(rows: list, drop_base: bool = True, drop_inside_day: bool = True) -> str:
    out = []
    for r in rows:
        if drop_base and r.get("pattern_id") == BASE_ID:
            continue
        if drop_inside_day and r.get("pattern_id") == INSIDE_DAY_ID:
            continue
        out.append(json.dumps(r, sort_keys=True, separators=(",", ":"), default=str))
    return "[" + ",".join(out) + "]"


def digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def run(auto_structures, drop_base: bool = True, drop_inside_day: bool = True):
    """({key: digest}, counts) for one implementation of auto_structures.structures_for."""
    saved = auto_structures._daily_bars, auto_structures.last_bar_forming
    out, counts = {}, {"scans": 0, "rows": 0, "base_rows": 0, "inside_day_rows": 0, "keys": 0}
    keys = set()
    try:
        auto_structures.last_bar_forming = lambda t, now=None: False
        for key, bars in SW.scans():
            snap = json.loads(json.dumps(bars))
            auto_structures._daily_bars = lambda sym, _b=snap: json.loads(json.dumps(_b))
            auto_structures._CACHE.clear()
            rows = auto_structures.structures_for(SYM)
            counts["scans"] += 1
            for r in rows:
                counts["rows"] += 1
                counts["base_rows"] += r.get("pattern_id") == BASE_ID
                counts["inside_day_rows"] += r.get("pattern_id") == INSIDE_DAY_ID
                keys.add(r.get("pattern_id"))
            out[key] = digest(canonical(rows, drop_base, drop_inside_day))
    finally:
        auto_structures._daily_bars, auto_structures.last_bar_forming = saved
        auto_structures._CACHE.clear()
    counts["keys"] = len(keys)
    return out, counts
