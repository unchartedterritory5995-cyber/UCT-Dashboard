"""C45 (C36's decision 6) -- a tree its lane withholds on EVERY bar is refused at
the door, by name, instead of being admitted to answer "no number" forever.

The member pane saves ONE document and two server doors admit its trees:

    ``scan_definition.assert_scannable``   the nightly sweep (daily bars keyed by
                                           session DATE, ``tf = "D"``)
    ``alert_user_series`` (arm)            a user-series alert (no ``tf``)

Since C36 the Python lane withholds what the chart withholds: ``time("W")`` on
bars that carry no clock, and (C45) a Pine document's value that depends on the
absolute ``bar_index``. Each consumer files a withheld bar correctly -- and a
tree withheld on every bar was therefore admitted, stamped runnable, and silent:
a scan that returned ``not_computable`` for every symbol every night, an alert
that armed and never fired.

⛔ THE DOORS ASK ``interpret``'S OWN DECISION (``ast_interpret.whole_series_withheld``
runs the same two functions ``interpret`` runs), on the lane's own bar shape, with
the lane's own opts -- never a second list of "clock-ish node types".
"""
from __future__ import annotations

import io
import json
import math
import pathlib

import pytest

from api.services import alert_user_series as aus
from api.services import ast_interpret as ai
from api.services import scan_definition
from api.services.screener import scan_evaluator

_FIXTURES = pathlib.Path(__file__).parent / "fixtures" / "ast"


def _cases(name: str) -> dict:
    doc = json.load(io.open(_FIXTURES / name, encoding="utf-8"))
    return {c["name"]: c for c in doc["cases"]}


ANCHOR = _cases("period_anchor_parity.json")

# the member door's own trees, read from the fixture the JS lane wrote
WEEK = ANCHOR["W · weekdays · D"]["ast"]                 # time("W")
WEEK_CHANGED = ANCHOR["change(W) · weekdays · D"]["ast"]  # ta.change(time("W"))
WEEK_CLOSE = ANCHOR["closeW · weekdays · D"]["ast"]       # time_close("W")
OWN_TIME = ANCHOR["own · weekdays · D"]["ast"]            # time(timeframe.period)

CLOSE = {"type": "series", "name": "close"}
INDEX = {"type": "series", "name": "barindex"}


def num(v):
    return {"type": "num", "value": v}


def op(name, *args):
    return {"type": "op", "name": name, "args": list(args)}


def call(name, *args):
    return {"type": "call", "name": name, "args": list(args)}


#: `bar_index % 3 == 0` -- depends on the count itself
INDEX_MOD = op("==", call("mod", INDEX, num(3)), num(0))
#: `bar_index > 100` -- a threshold: unknown on the early bars only
INDEX_PAST = op(">", INDEX, num(100))
#: `bar_index - bar_index[5] == 5` -- a distance: the count cancels
INDEX_DISTANCE = op("==", op("-", INDEX, {"type": "offset", "value": 5, "args": [INDEX]}), num(5))
ABOVE_AVERAGE = op(">", CLOSE, call("sma", CLOSE, num(3)))

PINE = {"name": "from pine", "recurrenceOrigin": ai.PINE_RECURRENCE_ORIGIN}


def definition(tree, *, meta=None) -> dict:
    d = {
        "schemaVersion": 1, "id": "u_c45c45c45c45", "version": 1,
        "meta": dict(meta or {"name": "typed"}),
        "compute": {"kind": "ast", "ast": tree},
        "placement": {"target": "pane"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }
    return d


def _sweep_opts(doc: dict) -> dict:
    """The opts the sweep evaluates a document with (the keys a tree's clock and
    index read; `symbols` / `now` are not this file's subject)."""
    return {"tf": scan_definition.SWEEP_TF, "barIndexAbsolute": ai.bar_index_absolute_for(doc)}


def date_bars(n: int = 320) -> list:
    """`n` weekday daily bars keyed YYYYMMDD -- the sweep's shape, built here from
    a calendar walk (not copied from the probe)."""
    import datetime
    day, out = datetime.date(2024, 1, 2), []
    while len(out) < n:
        if day.weekday() < 5:
            c = 100.0 + (len(out) % 9)
            out.append({"t": int(day.strftime("%Y%m%d")), "o": c, "h": c + 1, "l": c - 1, "c": c, "v": 1000.0})
        day += datetime.timedelta(days=1)
    return out


# ═══ 1. the one question ═════════════════════════════════════════════════════

def test_the_offset_node_this_file_writes_is_a_canonical_one():
    """The hand-built trees are the engine's own shapes (a typo'd node would make
    every refusal below a `tree` refusal, not the one under test)."""
    for tree in (INDEX_MOD, INDEX_PAST, INDEX_DISTANCE, ABOVE_AVERAGE):
        assert ai.max_lookback(tree) >= 0
        assert scan_definition.is_boolean_tree(tree) is True


@pytest.mark.parametrize("tree,alert,sweep", [
    (WEEK, ("time-anchor:not-daily",), ("time-clock:unreadable",)),
    (WEEK_CHANGED, ("time-anchor:not-daily",), ("time-clock:unreadable",)),
    (WEEK_CLOSE, ("time-close:not-daily",), ("time-clock:unreadable",)),
    (OWN_TIME, ("time-own:chart-unwitnessed",), ()),
    (ABOVE_AVERAGE, (), ()),
    (CLOSE, (), ()),
])
def test_the_whole_series_question_per_lane(tree, alert, sweep):
    # a user-series alert: no `tf`, and no bars are read to decide it
    assert ai.whole_series_withheld(tree, []) == alert
    # the sweep: daily bars keyed by date
    assert ai.whole_series_withheld(tree, ai.DATE_KEYED_PROBE_BARS, opts={"tf": "D"}) == sweep


def test_bar_index_is_asked_only_of_a_document_that_means_pines():
    lane = ai.lane_opts_for(definition(INDEX_MOD, meta=PINE))
    assert lane == {"barIndexAbsolute": True}
    assert ai.lane_opts_for(definition(INDEX_MOD)) == {}
    assert ai.lane_opts_for(None) == {} and ai.lane_opts_for({"meta": None}) == {}
    assert ai.whole_series_withheld(INDEX_MOD, [], opts=lane) == ("bar-index:window",)
    assert ai.whole_series_withheld(INDEX, [], opts=lane) == ("bar-index:window",)
    # the formula language's own `barindex` is the bar's position in the series
    assert ai.whole_series_withheld(INDEX_MOD, [], opts={}) == ()
    # a distance, and a threshold, are not withheld on every bar
    assert ai.whole_series_withheld(INDEX_DISTANCE, [], opts=lane) == ()
    assert ai.whole_series_withheld(INDEX_PAST, date_bars(), opts=dict(lane, tf="D")) == ()


@pytest.mark.parametrize("name", sorted(ANCHOR))
def test_the_question_agrees_with_what_interpret_does_on_the_same_bars(name):
    """⭐ ONE AUTHORITY, MEASURED: for every tree the C36 fixture holds, on the
    sweep's bars and on an alert's, the door's answer is non-empty exactly when
    `interpret` names a whole-series code -- and then every bar is `None`."""
    tree = ANCHOR[name]["ast"]
    bars = date_bars(60)
    for opts in ({"tf": "D"}, {}):
        sink: dict = {}
        column = ai.interpret(tree, bars, {}, opts=dict(opts, chartClockSink=sink))
        named = tuple(c for c in ai.CHART_CLOCK_WHOLE if c in sink)
        asked = ai.whole_series_withheld(tree, bars, opts=opts)
        assert asked == named, (name, opts)
        if asked:
            assert column == [None] * len(bars), (name, opts)


def test_the_question_is_not_vacuous_and_can_answer_no():
    cases = [ANCHOR[n]["ast"] for n in ANCHOR]
    sweep = [ai.whole_series_withheld(t, ai.DATE_KEYED_PROBE_BARS, opts={"tf": "D"}) for t in cases]
    alert = [ai.whole_series_withheld(t, []) for t in cases]
    assert sum(1 for c in sweep if c) >= 40 and sum(1 for c in sweep if not c) >= 5
    assert all(alert), "with no tf every chart-clock tree is withheld whole"


# ═══ 2. the sweep's door ═════════════════════════════════════════════════════

def test_the_probe_bars_are_the_sweeps_shape():
    """The door asks on `DATE_KEYED_PROBE_BARS` at `SWEEP_TF`; the sweep evaluates
    daily bars whose `t` is the session date. Pinned to the sweep's OWN reading."""
    assert scan_definition.SWEEP_TF == scan_evaluator.DEFAULT_TF
    for bar in ai.DATE_KEYED_PROBE_BARS:
        assert scan_evaluator._session_of_bar_time(bar["t"]) == bar["t"]
    # the C36 fixture names the same lane the same way
    sweep_case = ANCHOR["na(W) · date ints · D (the scan sweep)"]
    assert sweep_case["opts"] == {"tf": scan_definition.SWEEP_TF}
    doc = json.load(io.open(_FIXTURES / "period_anchor_parity.json", encoding="utf-8"))
    keyed = doc["bars"][sweep_case["bars"]] if isinstance(sweep_case.get("bars"), str) else None
    if keyed is not None:
        assert all(scan_evaluator._session_of_bar_time(b["t"]) == b["t"] for b in keyed[:5])


def test_CONTROL_before_the_gate_the_sweep_answered_no_number_on_every_bar():
    """What the member's scan did every night: computed, and answered nothing."""
    tree = op("!=", WEEK_CHANGED, num(0))
    column = ai.interpret(tree, date_bars(), {}, opts={"tf": scan_definition.SWEEP_TF})
    assert column == [None] * 320
    # ...and a Pine document's `bar_index % 3 == 0`, once the sweep is told what it means
    column = ai.interpret(INDEX_MOD, date_bars(), {}, opts=_sweep_opts(definition(INDEX_MOD, meta=PINE)))
    assert column == [None] * 320
    # ⚰️ before C45 the sweep read the window's own count: a confident 0/1 that is
    # TradingView's only by accident of where the window starts
    assert ai.interpret(INDEX_MOD, date_bars(), {}, opts={"tf": "D"})[:4] == [1.0, 0.0, 0.0, 1.0]


def test_assert_scannable_refuses_a_period_clock_by_name():
    tree = op("!=", WEEK_CHANGED, num(0))
    with pytest.raises(scan_definition.ScanRefused) as exc:
        scan_definition.assert_scannable(definition(tree))
    assert exc.value.gate == "withheld"
    assert "time-clock:unreadable" in str(exc.value)
    assert "carry a date and no clock" in str(exc.value)


def test_assert_scannable_refuses_a_pine_documents_absolute_bar_index_by_name():
    with pytest.raises(scan_definition.ScanRefused) as exc:
        scan_definition.assert_scannable(definition(INDEX_MOD, meta=PINE))
    assert exc.value.gate == "withheld"
    assert "bar-index:window" in str(exc.value)
    assert "count of bars since the symbol's first" in str(exc.value)


def test_assert_scannable_still_admits_what_the_sweep_can_answer():
    # the same tree typed in the formula language: `barindex` is its own count
    assert scan_definition.assert_scannable(definition(INDEX_MOD))["yields"] == "bool"
    # a Pine document: a threshold answers the last bar, a distance every bar
    for tree in (INDEX_PAST, INDEX_DISTANCE, ABOVE_AVERAGE):
        assert scan_definition.assert_scannable(definition(tree, meta=PINE))["yields"] == "bool"
    # ...and the sweep does answer them on its last bar, under the door's own opts
    column = ai.interpret(INDEX_PAST, date_bars(), {}, opts=_sweep_opts(definition(INDEX_PAST, meta=PINE)))
    assert column[-1] == 1.0
    assert column[:101] == [None] * 101      # the early bars: a longer history may differ


def _declares_bar_index(source: str, function: str) -> list:
    """Every `"barIndexAbsolute": <x>.bar_index_absolute_for(definition)` entry in a
    dict literal inside `function` -- the door's and the lane's shared declaration."""
    import ast as pyast
    fn = next(n for n in pyast.walk(pyast.parse(source))
              if isinstance(n, pyast.FunctionDef) and n.name == function)
    found = []
    for node in pyast.walk(fn):
        if not isinstance(node, pyast.Dict):
            continue
        for key, value in zip(node.keys, node.values):
            if isinstance(key, pyast.Constant) and key.value == "barIndexAbsolute":
                found.append(isinstance(value, pyast.Call)
                             and getattr(value.func, "attr", None) == "bar_index_absolute_for"
                             and [getattr(a, "id", None) for a in value.args] == ["definition"])
    return found


def test_the_sweep_evaluates_under_the_declaration_the_door_admitted():
    """ONE call decides it on both sides: `bar_index_absolute_for(definition)` at
    the door (`assert_scannable`) and in the sweep's evaluating `interpret`
    (`evaluate_one`). Read off the source, so the two cannot drift apart."""
    lane = io.open(pathlib.Path(scan_evaluator.__file__), encoding="utf-8").read()
    door = io.open(pathlib.Path(scan_definition.__file__), encoding="utf-8").read()
    assert _declares_bar_index(lane, "evaluate_one") == [True]
    assert _declares_bar_index(door, "assert_scannable") == [True]


# ═══ 3. the alert's door ═════════════════════════════════════════════════════

def _doc(tree, meta=None) -> dict:
    return {"meta": dict(meta or {}), "compute": {"kind": "ast", "ast": tree},
            "plots": [{"key": "value"}]}


def test_the_alert_door_refuses_a_period_clock_by_name():
    with pytest.raises(aus.AdmissionRefused) as exc:
        aus._make_value_fn("u_c45c45c45c45", "value", _doc(WEEK_CHANGED))
    assert exc.value.gate == "withheld"
    assert aus.REFUSAL_FRAGMENTS["withheld"] in str(exc.value)
    assert "time-anchor:not-daily" in str(exc.value)
    assert "would arm and never fire" in str(exc.value)


def test_the_alert_door_refuses_a_pine_documents_bar_index_and_admits_the_typed_one():
    with pytest.raises(aus.AdmissionRefused) as exc:
        aus._make_value_fn("u_c45c45c45c45", "value", _doc(INDEX, PINE))
    assert exc.value.gate == "withheld" and "bar-index:window" in str(exc.value)
    # the same tree in a document that is not a Pine translation: its own count
    fn = aus._make_value_fn("u_c45c45c45c45", "value", _doc(INDEX))
    assert fn(date_bars(40), {}) == 39.0


def test_CONTROL_what_the_alert_read_before_no_number_on_every_bar():
    assert ai.interpret(WEEK_CHANGED, date_bars(60), {}) == [None] * 60


def test_an_admitted_pine_alert_evaluates_under_the_lanes_opts():
    """A threshold is admitted, and the column the alert reads is masked on the
    early bars -- the alert lane passes the SAME opts the door asked with."""
    fn = aus._make_value_fn("u_c45c45c45c45", "value", _doc(INDEX_PAST, PINE))
    column = fn.column(date_bars(200), {})
    assert column[:101] == [None] * 101
    assert column[101:] == [1.0] * 99
    # the typed twin reads its own count: a confident 0 on the early bars
    typed = aus._make_value_fn("u_c45c45c45c45", "value", _doc(INDEX_PAST)).column(date_bars(200), {})
    assert typed[:101] == [0.0] * 101


def test_one_withheld_plot_does_not_take_its_siblings_down(monkeypatch):
    """`admit_user_definition` registers the answerable plots and KEEPS the
    refusal of the other; `arm_for_alert` raises it for that plot only."""
    doc = {
        "meta": dict(PINE),
        "compute": {"kind": "ast", "ast": ABOVE_AVERAGE,
                    "trees": {"signal": ABOVE_AVERAGE, "count": INDEX},
                    "treesHash": "sha256:" + "0" * 64, "scanPlot": "signal"},
        "plots": [{"key": "signal"}, {"key": "count"}],
    }
    row = {"def_id": "u_c45c45c45c45", "version": 1, "rev": 1, "ast_hash": "x", "definition": doc}
    monkeypatch.setattr(aus, "_gate_definition", lambda user_id, def_id, version: row)
    monkeypatch.setattr(aus, "_gate_lane", lambda r: doc)
    monkeypatch.setattr(aus, "_gate_requirements", lambda r, d: None)
    monkeypatch.setattr(aus, "_gate_repaint", lambda r, d: None)
    monkeypatch.setattr(aus, "_gate_budget", lambda d, i: None)
    monkeypatch.setattr(aus, "_gate_cross_lane", lambda d, i, bars: {"compared": 1, "rel_tol": 1e-9})
    aus.forget()
    try:
        admitted = aus.admit_user_definition("user-c45", "u_c45c45c45c45", bars=date_bars(40))
        assert admitted["addresses"] == ["u_c45c45c45c45.signal"]
        assert list(admitted["withheld"]) == ["u_c45c45c45c45.count"]
        assert admitted["withheld"]["u_c45c45c45c45.count"].gate == "withheld"
        # the answerable plot arms
        assert aus.arm_for_alert("user-c45", "u_c45c45c45c45.signal", "SPY", "D",
                                 bars=date_bars(40))["addresses"] == ["u_c45c45c45c45.signal"]
        # the withheld one is refused at arm, by its own gate, and is not registered
        with pytest.raises(aus.AdmissionRefused) as exc:
            aus.arm_for_alert("user-c45", "u_c45c45c45c45.count", "SPY", "D", bars=date_bars(40))
        assert exc.value.gate == "withheld"
        assert aus.scoped_key("user-c45", "u_c45c45c45c45.count") not in aus.USER_FUNCS
        assert aus.scoped_key("user-c45", "u_c45c45c45c45.signal") in aus.USER_FUNCS
    finally:
        aus.forget()


def test_an_admission_with_nothing_withheld_returns_the_shape_it_always_did(monkeypatch):
    doc = _doc(ABOVE_AVERAGE)
    row = {"def_id": "u_c45c45c45c45", "version": 1, "rev": 1, "ast_hash": "x", "definition": doc}
    monkeypatch.setattr(aus, "_gate_definition", lambda user_id, def_id, version: row)
    monkeypatch.setattr(aus, "_gate_lane", lambda r: doc)
    monkeypatch.setattr(aus, "_gate_requirements", lambda r, d: None)
    monkeypatch.setattr(aus, "_gate_repaint", lambda r, d: None)
    monkeypatch.setattr(aus, "_gate_budget", lambda d, i: None)
    monkeypatch.setattr(aus, "_gate_cross_lane", lambda d, i, bars: {"compared": 1, "rel_tol": 1e-9})
    aus.forget()
    try:
        admitted = aus.admit_user_definition("user-c45", "u_c45c45c45c45", bars=date_bars(40))
        assert sorted(admitted) == ["addresses", "ast_hash", "compared", "def_id", "rel_tol", "rev", "version"]
    finally:
        aus.forget()


def test_both_gate_vocabularies_declare_the_new_door():
    assert "withheld" in scan_definition.GATES
    assert "withheld" in aus.GATES and "withheld" in aus.REFUSAL_FRAGMENTS
    assert not math.isnan(0.0)
