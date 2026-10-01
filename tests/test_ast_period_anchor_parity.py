"""C36 -- ``time(<timeframe>)`` in the Python lane, held to the JS lane's own output.

C30 served ``time("W" | "M" | "3M" | "12M")`` on a daily chart and withheld the
first partial period -- in the JS lanes only. This interpreter evaluated the same
saved tree and read the anchor's ``NaN`` as Pine's ``na``, and three server
consumers can be handed that tree (a member pane saves ONE document):

    a user-series alert   ``alert_user_series``   bars keyed ``YYYYMMDD``, no ``tf``
    the scan sweep        ``scan_evaluator``      bars keyed ``YYYYMMDD``, ``tf = D``
    the screen backtest   ``screener/backtest``   ISO dates, no ``tf``

In every one of them the clock the anchor reads is blank, so the anchor was
``NaN`` on EVERY bar and a reader answered confidently on every bar:
``na(time("W")) ? 111 : 222`` -> 111, ``ta.change(time("W")) != 0`` -> 0.
``ast_interpret.period_anchor_mask`` is now the port of
``interpret.js::periodAnchorMask``: those bars are withheld here as they are on
the chart.

⛔ THE FIXTURE IS THE ONE AUTHORITY. ``periodAnchorParity.test.js`` writes and
reads the same file, so a lane that drifts fails against the OTHER LANE'S OWN
OUTPUT rather than against a number retyped here.
"""
from __future__ import annotations

import io
import json
import pathlib

import pytest

from api.services import ast_interpret as ai

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "ast" / "period_anchor_parity.json"


def _doc() -> dict:
    return json.load(io.open(FIXTURE, encoding="utf-8"))


def _run(case: dict, doc: dict):
    sink: dict = {}
    opts = dict(case.get("opts") or {}, chartClockSink=sink)
    return ai.interpret(case["ast"], doc["bars"][case["bars"]], {}, opts=opts), sorted(sink)


@pytest.mark.parametrize("case", _doc()["cases"], ids=lambda c: c["name"])
def test_the_python_lane_reproduces_the_js_lane(case):
    doc = _doc()
    got, codes = _run(case, doc)
    expected = case["expected"]
    assert len(got) == len(expected)
    for i, (a, b) in enumerate(zip(got, expected)):
        if b is None:
            assert a is None, f"{case['name']} bar {i}: this lane produced {a} where the other withheld"
            continue
        assert a is not None, f"{case['name']} bar {i}: this lane produced nothing where the other produced {b}"
        assert abs(a - b) < 1e-9, f"{case['name']} bar {i}: {a} vs {b}"
    assert codes == case["codes"], case["name"]


def test_the_fixture_is_not_vacuous():
    cases = {c["name"]: c for c in _doc()["cases"]}
    served = cases["W · weekdays · D"]["expected"]
    assert sum(1 for v in served if v is None) == 2
    assert sum(1 for v in served if v is not None) == 298
    event = cases["change(W) · weekdays · D"]["expected"]
    assert {0, 1} <= set(v for v in event if v is not None) and None in event
    assert cases["W · every day · D"]["codes"] == ["time-anchor:weekend-bars"]
    assert cases["own · hourly · 5 (unmeasured)"]["codes"] == ["time-own:chart-unwitnessed"]
    assert {code for c in cases.values() for code in c["codes"]} <= set(ai.CHART_CLOCK_WITHHELD_CODES)


def test_the_builders_are_the_fixtures_own_trees():
    """The recognisers compare against THIS lane's builders; the fixture's trees
    are the JS translator's. If the two builders drifted, nothing would be
    recognised and every case above would answer unmasked."""
    cases = {c["name"]: c for c in _doc()["cases"]}

    def anchors(tree):
        out, stack = [], [tree]
        while stack:
            n = stack.pop()
            if not isinstance(n, dict):
                continue
            if ai.is_period_anchor(n):
                out.append(n)
            stack.extend(n.get("args") or [])
        return out

    for key, period in (("W", "W"), ("M", "M"), ("Q", "3M"), ("Y", "12M")):
        found = anchors(cases[f"{key} · weekdays · D"]["ast"])
        assert len(found) == 1, key
        assert found[0]["args"][0] == ai.period_first_condition(period), key
    assert ai.is_chart_own_time(cases["own · weekdays · D"]["ast"])
    assert cases["own · weekdays · D"]["ast"] == ai.chart_own_time_node(True)
    assert ai.period_first_condition("2W") is None


# --------------------------------------------------------------------------- #
# the three server consumers' contexts -- the wrong value this port removes
# --------------------------------------------------------------------------- #

#: (bars key, opts) exactly as each consumer calls ``interpret``:
#:   alert_user_series.py      ``interpret(tree, bars, inputs)``            -- no opts
#:   scan_evaluator.py         ``opts={"tf": tf_code, ...}`` over bars_sqlite ints
#:   screener/backtest.py      ISO dates from ``_fmt_sqlite_bars``, no opts
CONSUMER_CONTEXTS = {
    "a user-series alert": ("dateInts", None),
    "the scan sweep": ("dateInts", {"tf": "D"}),
    "the screen backtest": ("weekdays", None),
}


@pytest.mark.parametrize("consumer", sorted(CONSUMER_CONTEXTS))
@pytest.mark.parametrize("reader", ["na(W)", "change(W)"])
def test_no_server_consumer_reads_the_anchor_as_na(consumer, reader):
    doc = _doc()
    bars_key, opts = CONSUMER_CONTEXTS[consumer]
    tree = next(c["ast"] for c in doc["cases"] if c["pine"] == reader)
    got = ai.interpret(tree, doc["bars"][bars_key], {}, opts=opts)
    assert got and all(v is None for v in got), (
        f"{consumer}: {reader} answered {sorted(set(v for v in got if v is not None))} -- "
        "a reader of an anchor this lane does not hold must be withheld, never answered")


@pytest.mark.parametrize("consumer", sorted(CONSUMER_CONTEXTS))
def test_control_the_unmasked_column_is_the_confident_wrong_answer(consumer):
    """⛔ CONTROL -- the withholding is not decoration. ``_interpret_column`` is
    the evaluator without the mask; in each consumer's context it answers 111
    (``na`` of an anchor that is merely blank) on every bar."""
    doc = _doc()
    bars_key, opts = CONSUMER_CONTEXTS[consumer]
    tree = next(c["ast"] for c in doc["cases"] if c["pine"] == "na(W)")
    raw = ai._interpret_column(tree, doc["bars"][bars_key], {}, None, None, opts)
    assert set(raw) == {111.0}


def test_a_tree_with_no_anchor_is_untouched():
    """The mask answers ``None`` for a tree that reads no anchor -- a member's own
    ``valuewhenOccurrence`` over another condition keeps its meaning."""
    doc = _doc()
    bars = doc["bars"]["weekdays"]
    own = {"type": "call", "name": "valuewhenOccurrence", "args": [
        {"type": "op", "name": ">", "args": [{"type": "series", "name": "close"},
                                             {"type": "series", "name": "open"}]},
        {"type": "series", "name": "time"}, {"type": "num", "value": 0}]}
    assert not ai.is_period_anchor(own)
    assert ai.period_anchor_mask(own, bars, {}, None, None, {"tf": "D"}) is None
    assert ai.period_anchor_mask({"type": "series", "name": "close"}, bars) is None


def test_a_read_of_other_bars_is_withheld_whole_and_named():
    """An anchor (or the own-time node) under ``tf`` / ``sym`` reads other bars --
    the JS rail's twin (``vendorHarness.c36TimeFollowups``)."""
    bars = _doc()["bars"]["weekdays"]
    anchor = {"type": "call", "name": "valuewhenOccurrence", "args": [
        ai.period_first_condition("M"), {"type": "series", "name": "time"}, {"type": "num", "value": 0}]}
    for inner in (anchor, ai.chart_own_time_node(True)):
        for kind, value in (("tf", "W"), ("sym", "QQQ")):
            sink: dict = {}
            mask = ai.period_anchor_mask({"type": kind, "value": value, "args": [inner]}, bars, {},
                                         None, None, {"tf": "D", "chartClockSink": sink})
            assert mask == [1] * len(bars), kind
            assert sorted(sink) == ["time-anchor:other-bars"], kind
    # CONTROL -- the same anchor on the chart's own bars: 16 weekdays to November, nothing named
    sink = {}
    mask = ai.period_anchor_mask(anchor, bars, {}, None, None, {"tf": "D", "chartClockSink": sink})
    assert sum(mask) == 16 and not sink


@pytest.mark.parametrize("weekend_day", [5, 6], ids=["a Saturday alone", "a Sunday alone"])
def test_one_weekend_bar_is_enough(weekend_day):
    """``dayofweek`` 7 (Saturday) or 1 (Sunday) on ANY bar withholds the series."""
    import datetime
    bars = [dict(b) for b in _doc()["bars"]["weekdays"][:40]]
    d = datetime.date.fromisoformat(bars[-1]["t"])
    while d.weekday() != weekend_day:
        d += datetime.timedelta(days=1)
    bars.append(dict(bars[-1], t=d.isoformat()))
    tree = next(c["ast"] for c in _doc()["cases"] if c["pine"] == "W")
    sink: dict = {}
    got = ai.interpret(tree, bars, {}, opts={"tf": "D", "chartClockSink": sink})
    assert all(v is None for v in got)
    assert sorted(sink) == ["time-anchor:weekend-bars"]
    # CONTROL -- without the weekend bar the same series is served
    assert any(v is not None for v in ai.interpret(tree, bars[:-1], {}, opts={"tf": "D"}))
