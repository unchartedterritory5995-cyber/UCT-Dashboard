"""H11 (CAP5 Q-RT10a) -- a pivot window's ``na`` is a BARRIER, not a veto.

``vw-rt10-runtime-walls-rddt-1d-2026-10-04`` (NYSE:RDDT 1D, 636 bars): TradingView's
``pivothigh`` / ``pivotlow`` over a series that is ``na`` every 37th bar compare the
candidate outward and stop at the first ``na`` on each side. ``interpret.js::pivotAt``
carries the evidence; this is the Python twin's rail, on the capture itself.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from api.services.ast_interpret import _pivot_col

FIXTURE = Path(__file__).parent / "fixtures" / "vendor" / "harness" / "vw-rt10-runtime-walls-rddt-1d-2026-10-04.json"


def _col(cap, title):
    plot = next(p for p in cap["study"]["plots"] if p.get("title") == title)
    at = cap["plotValues"]["fields"].index(plot["id"])
    return [r[at] for r in cap["plotValues"]["rows"]]


def _confirmed(col, right):
    """``_pivot_col`` answers at the PIVOT bar; Pine plots at the confirmation bar."""
    out = [None] * len(col)
    for i, v in enumerate(col):
        if not math.isnan(v) and i + right < len(col):
            out[i + right] = v
    return out


def test_the_barrier_rule_answers_every_bar_of_the_capture():
    cap = json.loads(FIXTURE.read_text(encoding="utf-8"))
    x = [math.nan if v is None else float(v) for v in _col(cap, "P00 x control")]
    hi = lambda a, b: a > b  # noqa: E731
    lo = lambda a, b: a < b  # noqa: E731
    assert _confirmed(_pivot_col(x, 2, 3, hi), 3) == _col(cap, "P01 pivothigh(x,2,3)")
    assert _confirmed(_pivot_col(x, 2, 2, lo), 2) == _col(cap, "P02 pivotlow(x,2,2)")
    assert _confirmed(_pivot_col(x, 1, 2, lo), 2) == _col(cap, "P03 f(x) pivotlow(1,2)")
    # the bar that tells a barrier from a veto: candidate 116.38 (bar 36), bar 37 na,
    # bar 38 121.26 -- still the pivot high TradingView plots on bar 39
    assert _col(cap, "P01 pivothigh(x,2,3)")[39] == 116.38
