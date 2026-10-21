"""The member-path sweep behind the bc:base member byte-identity rail (synthetic bars only, public repo).

`run(auto_structures)` digests, for one implementation of auto_structures, what a MEMBER is served from the
base drawing (bc:base) -- `member_rows`, then `with_metrics(..., member=True)` with the metrics flag ON --
on two seeded synthetic sweeps:

  * "row:<series>:<i>": every 2nd session from bar 220 of every tests/flat_top_sweep.py series (24 series),
    from `base_draw_row` on bars[:i+1];
  * "scan:<key>": every scan of the 168-scan structures sweep, from `structures_for` (bc:base rows only).

tools/base_draw_member_golden.py writes the digests from code whose drawing round IS the member round
(before a later round existed); tests/test_base_draw_member_parity.py recomputes them with the code under
test and requires every digest to match: a member is served byte-for-byte what the confirmed round served.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("flat_top_sweep_for_base_member",
                                               os.path.join(_HERE, "flat_top_sweep.py"))
SW = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(SW)

BASE_ID = "bc:base"
SYM = "SYN"
FIRST, STEP = 220, 2


def canonical(rows) -> str:
    return json.dumps(rows, sort_keys=True, separators=(",", ":"), default=str)


def digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def _member(auto_structures, rows, bars):
    auto_structures._daily_bars = lambda sym, _b=bars: json.loads(json.dumps(_b))
    served = auto_structures.member_rows(rows)
    return auto_structures.with_metrics(SYM, served, member=True)


def run(auto_structures):
    """({key: digest}, counts)."""
    saved = auto_structures._daily_bars, auto_structures.last_bar_forming
    saved_env = os.environ.get("AUTO_STRUCTURES_METRICS_ENABLED")
    out, counts = {}, {"rows": 0, "row_served": 0, "row_metrics": 0, "scans": 0, "scan_served": 0}
    try:
        os.environ["AUTO_STRUCTURES_METRICS_ENABLED"] = "1"
        auto_structures.last_bar_forming = lambda t, now=None: False
        for s in range(SW.SERIES):
            bars = SW.series(s)
            for i in range(FIRST, len(bars), STEP):
                b = json.loads(json.dumps(bars[:i + 1]))
                row = auto_structures.base_draw_row(SYM, b)
                served = _member(auto_structures, [row] if row is not None else [], b)
                counts["rows"] += 1
                counts["row_served"] += bool(served)
                counts["row_metrics"] += any("metrics" in r["geometry"]["extras"] for r in served)
                out[f"row:{s}:{i}"] = digest(canonical(served))
        for key, bars in SW.scans():
            snap = json.loads(json.dumps(bars))
            auto_structures._daily_bars = lambda sym, _b=snap: json.loads(json.dumps(_b))
            auto_structures._CACHE.clear()
            rows = [r for r in auto_structures.structures_for(SYM) if r.get("pattern_id") == BASE_ID]
            served = _member(auto_structures, rows, snap)
            counts["scans"] += 1
            counts["scan_served"] += bool(served)
            out[f"scan:{key}"] = digest(canonical(served))
    finally:
        auto_structures._daily_bars, auto_structures.last_bar_forming = saved
        auto_structures._CACHE.clear()
        if saved_env is None:
            os.environ.pop("AUTO_STRUCTURES_METRICS_ENABLED", None)
        else:
            os.environ["AUTO_STRUCTURES_METRICS_ENABLED"] = saved_env
    return out, counts
