"""(coordinator ruling 2026-11-20, found by the e90 train) A weekly or monthly chart that starts at the listing is FROM the
listing for the read-before-the-chart mask, in the Python lane (``ast_interpret.history_before_chart_mask``).

The twin of ``app/src/components/chart/engine/ast/historyBeforeChartListingStart.test.js``: the same bars, trees and
hand-written answers. #2167's mask judged "off the listing" as ``barIndexAbsolute`` and not ``historyFromListing``; a
weekly / monthly chart whose first bar IS the listing period carries only the fact (``listingStart``), so ``close[1]``
on bar 0 was withheld there and named with a sentence that is false on that chart. TradingView's ``na`` stands now.
"""
from __future__ import annotations

import math

import pytest

from api.services import ast_interpret

CLOSE = {"type": "series", "name": "close"}


def _num(v):
    return {"type": "num", "value": v}


def _bars(days):
    return [{"t": t, "o": i + 0.5, "h": i + 1.5, "l": i, "c": i + 1, "v": 100 + i} for i, t in enumerate(days)]


MONTHS = _bars(["2025-10-01", "2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01", "2026-03-01"])
WEEKS = _bars(["2025-10-24", "2025-10-31", "2025-11-07", "2025-11-14", "2025-11-21", "2025-11-28"])
PINE = {"barIndexAbsolute": True, "varOriginAbsolute": True}


def _nz():
    return {"type": "call", "name": "nz", "args": [{"type": "offset", "value": 1, "args": [CLOSE]}, _num(0)]}


def _na():
    return {"type": "call", "name": "na", "args": [{"type": "offset", "value": 1, "args": [CLOSE]}]}


CASES = [
    ("M chart from the listing (listingStart): nz(close[1]) draws 0 on bar 0", MONTHS,
     dict(tf="M", listingStart=True, **PINE), _nz, [0, 1, 2, 3], False),
    ("M chart from the listing (listingStart): na(close[1]) draws 1 on bar 0", MONTHS,
     dict(tf="M", listingStart=True, **PINE), _na, [1, 0, 0, 0], False),
    ("W chart from the listing (listingStart): nz(close[1]) draws 0", WEEKS,
     dict(tf="W", listingStart=True, **PINE), _nz, [0, 1, 2, 3], False),
    ("W chart served from the listing (historyFromListing): nz(close[1]) draws 0", WEEKS,
     dict(tf="W", historyFromListing=True, **PINE), _nz, [0, 1, 2, 3], False),
    ("CONTROL M chart off the listing: nz(close[1]) withheld on bar 0, named", MONTHS,
     dict(tf="M", **PINE), _nz, [None, 1, 2, 3], True),
    ("CONTROL W chart off the listing: nz(close[1]) withheld on bar 0, named", WEEKS,
     dict(tf="W", **PINE), _nz, [None, 1, 2, 3], True),
]


@pytest.mark.parametrize("name,bars,opts,tree,expect,named", CASES, ids=[c[0] for c in CASES])
def test_the_python_lane_gives_the_hand_written_answer_and_names_the_code_only_off_the_listing(
        name, bars, opts, tree, expect, named):
    sink: dict = {}
    col = ast_interpret.interpret(tree(), bars, {}, opts=dict(opts, newest_bar_is_forming=False, chartClockSink=sink))
    got = [None if v is None or (isinstance(v, float) and math.isnan(v)) else v for v in col][:len(expect)]
    assert got == expect, name
    assert (ast_interpret.HISTORY_BEFORE_CHART_CODE in sink) == named, name
