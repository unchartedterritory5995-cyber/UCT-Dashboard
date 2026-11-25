"""⭐⭐ TRAIN e96 (coordinator ruling 2026-11-23) -- U-DAILY'S DAILY ROUTE AND e95 2b'S BINDING COMPOSE: BIND FIRST, THEN ROUTE.

e95 unit 2b keeps every arm of a ``switch`` on a member's ``input.string`` in the saved tree, and one binding prunes the
arms its knobs do not pick (``ast_bind.prune_knob_arms``; the 2b bind audit, 79c21a4ffb: every member-facing gate
decides on what a binding draws). U-DAILY part A (#2550) routes a tree that reads a daily value (``tf(x, 'D')``, the
last finished day on each bar of a chart below a day) to ONE evaluator (``ast_interpret._interpret_daily_reads``).

A knob script WITH a daily read must be bound first and routed second, on every path:
  * the evaluator (``ast_interpret.interpret``): the knob prune runs before the daily route, so an unpicked arm's daily
    read is never routed (nothing withheld for want of daily bars the drawn arm never reads), and a picked one is;
  * the scan door (``scan_definition.assert_scannable``): the daily read's cadence refusal reads the bound tree
    (``bound_scan_tree``);
  * the alert lane (``alert_user_series._make_value_fn``): ``daily-read:unsupplied`` is asked of the tree the defaults
    bind, and of each instance's own setting (``instance_gate``).
Each has a CONTROL: the arm that reads the day, picked, still routes / refuses by name. The browser half is
``app/src/components/chart/engine/ast/dailyReadKnobBind.test.js``; the mutants are ``ci/mutants/e96-train-integration.json``.
"""
import calendar
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from api.services import alert_user_series as aus                   # noqa: E402
from api.services import ast_bind                                   # noqa: E402
from api.services import ast_interpret as ai                        # noqa: E402
from api.services import scan_definition as sd                      # noqa: E402

OPTIONS = ["Session", "Week", "Day"]
DAY = 2                                    # the option's index: what the knob ternary compares the knob with
CLOSE = {"type": "series", "name": "close"}
DAILY_CLOSE = {"type": "tf", "value": "D", "args": [CLOSE]}


def _is(k):
    return {"type": "op", "name": "==", "args": [{"type": "series", "name": "anchor"}, {"type": "num", "value": k}]}


#: ``anchor == Day ? tf(close, 'D') : close`` -- a knob ternary whose Day arm reads the last finished day
KNOB_DAILY = {"type": "op", "name": "?:", "args": [_is(DAY), DAILY_CLOSE, CLOSE]}


def _defn(tree=KNOB_DAILY, default="Session"):
    return {"inputs": [{"key": "anchor", "type": "enum", "label": "Anchor", "default": default, "options": list(OPTIONS)}],
            "plots": [{"key": "p"}], "compute": {"kind": "ast", "ast": tree}}


# THREE SESSIONS of four 5 minute bars (09:30..09:45 New York, EST), Monday 12 to Wednesday 14 January 2026
CHART = []
for _d in ("2026-01-12", "2026-01-13", "2026-01-14"):
    _y, _m, _dd = (int(x) for x in _d.split("-"))
    for _k in range(4):
        _c = 200.0 + len(CHART)
        CHART.append({"t": calendar.timegm((_y, _m, _dd, 14, 30, 0)) + _k * 300, "o": _c, "h": _c + 1, "l": _c - 1,
                      "c": _c, "v": 1000.0})
FRAME_DAYS = ["2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09",
              "2026-01-12", "2026-01-13", "2026-01-14"]
FRAME = [{"t": t, "o": 100.0 + j, "h": 102.0 + j, "l": 98.0 + j, "c": 100.0 + j, "v": 5000.0} for j, t in enumerate(FRAME_DAYS)]
WITH_DAILY = {"tf": "5", "frames": {"D": {"bars": FRAME, "symbols": {}, "newestFinal": True}}}


def run(tree, inputs, opts):
    return ai.interpret(tree, CHART, inputs, None, None, opts)


def test_non_vacuity_the_saved_tree_reads_the_day_and_each_binding_reads_what_it_picks():
    assert ai.tree_reads_daily(KNOB_DAILY) is True
    assert ai.tree_reads_daily(ast_bind.prune_knob_arms(KNOB_DAILY, {"anchor": 0})) is False
    assert ai.tree_reads_daily(ast_bind.prune_knob_arms(KNOB_DAILY, {"anchor": DAY})) is True


class TestTheEvaluator:
    def test_THE_COMPOSITION_an_unpicked_daily_arm_is_never_routed_nothing_waits_for_daily_bars(self):
        """Bound at Session the tree is ``close``: drawn bar for bar, with NO daily bars handed and nothing withheld."""
        clock = {}
        got = run(KNOB_DAILY, {"anchor": 0}, {"tf": "5", "chartClockSink": clock})
        assert got == [c["c"] for c in CHART]
        assert ai.DAILY_READ_NO_DAILY_BARS not in clock

    def test_CONTROL_the_picked_daily_arm_routes_and_shows_the_last_finished_day(self):
        # Monday 12th shows Friday 9th's close (row 5: 105), Tuesday Monday's (106), Wednesday Tuesday's (107)
        assert run(KNOB_DAILY, {"anchor": DAY}, dict(WITH_DAILY)) == [105.0] * 4 + [106.0] * 4 + [107.0] * 4

    def test_CONTROL_the_picked_daily_arm_with_no_daily_bars_is_withheld_by_name(self):
        clock = {}
        assert run(KNOB_DAILY, {"anchor": DAY}, {"tf": "5", "chartClockSink": clock}) == [None] * len(CHART)
        assert ai.DAILY_READ_NO_DAILY_BARS in clock


class TestTheScanDoor:
    #: a screen is a condition: ``anchor == Day ? close > tf(close, 'D') : close > open``
    OPEN = {"type": "series", "name": "open"}
    CONDITION = {"type": "op", "name": "?:", "args": [_is(DAY), {"type": "op", "name": ">", "args": [CLOSE, DAILY_CLOSE]},
                                                      {"type": "op", "name": ">", "args": [CLOSE, OPEN]}]}

    def test_a_default_that_does_not_pick_the_day_is_scannable(self):
        defn = _defn(self.CONDITION)
        sd.assert_scannable(defn)                                 # raises ScanRefused when the saved tree decides
        assert ai.tree_reads_daily(sd.bound_scan_tree(defn)) is False

    def test_CONTROL_a_default_that_picks_the_day_is_refused_by_name(self):
        with pytest.raises(sd.ScanRefused) as exc:
            sd.assert_scannable(_defn(self.CONDITION, default="Day"))
        assert exc.value.gate == "cadence"


class TestTheAlertLane:
    def test_admitted_at_a_default_that_does_not_pick_the_day(self):
        aus._make_value_fn("u_knob_daily", "p", _defn())        # raises AdmissionRefused when the saved tree decides

    def test_CONTROL_a_default_that_picks_the_day_is_refused_by_name(self):
        with pytest.raises(aus.AdmissionRefused) as exc:
            aus._make_value_fn("u_knob_daily_d", "p", _defn(default="Day"))
        assert aus.UNSUPPLIED_DAILY_READ in str(exc.value)
