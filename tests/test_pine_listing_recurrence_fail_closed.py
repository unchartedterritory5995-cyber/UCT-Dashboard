"""Ruling (i), 2026-11-20: from the listing, a recurrence is the chart lane's.

The chart lane (``interpret.js::listingPass``, C12w, ruling R-W) runs a recurrence from bar 0 when the series starts at
the listing, which is TradingView's own value (the RDDT-from-listing captures). This lane never ported that pass and
answered the bounded window there, a different number. Now it withholds such a plot whole, by name
(``var-origin:listing-pass``), and the two lanes never disagree on a drawn value. Off the listing they agree bar for bar.

⛔ LIFT CONDITION: a server path that passes ``historyFromListing`` (none does) needs the full port of the listing pass
to this lane; then this rail's ``accum`` case asserts the chart lane's ``listing`` column instead.

The fixture is WRITTEN by ``app/src/components/chart/engine/ast/listingRecurrenceTwin.test.js``.
"""
from __future__ import annotations

import io
import json
import math
import pathlib

import pytest

from api.services import ast_interpret as ai

FIXTURE = pathlib.Path(__file__).resolve().parent / "fixtures" / "ast" / "listing_recurrence_twin.json"


def _doc() -> dict:
    return json.load(io.open(FIXTURE, encoding="utf-8"))


def _column(tree, bars, opts):
    out = ai.interpret(tree, bars, {}, opts=opts)
    return [None if (v is None or (isinstance(v, float) and math.isnan(v))) else v for v in out]


def _same(a, b) -> bool:
    if a is None or b is None:
        return a is None and b is None
    return abs(a - b) <= 1e-9 * max(1.0, abs(b))


def _case(name: str) -> dict:
    return next(c for c in _doc()["cases"] if c["name"] == name)


def test_off_the_listing_the_lanes_agree_bar_for_bar():
    doc = _doc()
    for case in doc["cases"]:
        got = _column(case["tree"], doc["bars"], dict(doc["chart"]))
        bad = [i for i, (a, b) in enumerate(zip(got, case["off"])) if not _same(a, b)]
        assert not bad, f"{case['name']} differs from the chart lane off the listing at bars {bad[:5]}"


def test_bar_7_from_the_listing_is_withheld_by_name_never_the_bounded_window():
    doc = _doc()
    case = _case("accum")
    # the disagreement this rail exists for: the chart lane's listing pass against the bounded window
    assert case["listing"][7] == pytest.approx(85.05277, abs=1e-4)
    assert case["off"][7] == pytest.approx(85.05684, abs=1e-4)
    sink: dict = {}
    got = _column(case["tree"], doc["bars"], dict(doc["chart"], historyFromListing=True, chartClockSink=sink))
    assert got[7] is None, "this lane drew a number from the listing where the chart lane draws another"
    assert all(v is None for v in got), "a recurrence from the listing is withheld whole"
    assert doc["code"] == ai.LISTING_PASS_CHART_LANE
    assert ai.LISTING_PASS_CHART_LANE in sink
    assert ai.LISTING_PASS_CHART_LANE in ai.CHART_CLOCK_WHOLE


def test_control_no_recurrence_computes_from_the_listing_as_the_chart_lane_does():
    doc = _doc()
    case = _case("sma")
    sink: dict = {}
    got = _column(case["tree"], doc["bars"], dict(doc["chart"], historyFromListing=True, chartClockSink=sink))
    bad = [i for i, (a, b) in enumerate(zip(got, case["listing"])) if not _same(a, b)]
    assert not bad, f"bars {bad[:5]} differ from the chart lane from the listing"
    assert ai.LISTING_PASS_CHART_LANE not in sink


def test_off_the_listing_a_recurrence_is_not_named():
    doc = _doc()
    sink: dict = {}
    _column(_case("accum")["tree"], doc["bars"], dict(doc["chart"], chartClockSink=sink))
    assert ai.LISTING_PASS_CHART_LANE not in sink
