"""W4 T0 - the coverage map's measurement artefacts, each with a rail that can fail.

W4-BREAKDOWN section 0 found that the top runtime-lane wall was an instrument effect and that
`runtime:object-op` was the wrong probe's answer; the W0 review queued two lows on section 7.1.
This pins the tooling half (the census peel and the probe are pinned in
`coverageMapDoorCensus.measure.test.js`):

  * `runtime_walls_of` takes the door's decline code when the probe disagrees with it;
  * `rt_wave` re-maps `for … in` loops (W6), a bare `security` (W7) and order strategies' no-output (W9);
  * `capture_plan` leaves a script whose own capture already DIVERGEs out of 7.1 and never credits a
    runtime-on row's items to the production figure.
"""
from __future__ import annotations

import importlib.util
import os

from tools.pine_coverage import coverage_map as cm

_TARGETS = os.path.join(os.path.dirname(cm.__file__), "w0", "targets.py")
_spec = importlib.util.spec_from_file_location("w0_targets_under_test", _TARGETS)
targets = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(targets)


def _step(probe_guard=None, agrees=None, code=None, text="a = f(x)", message="", token=None, **kw):
    st = {"attached": False, "refusals": [], "guard": None}
    if probe_guard is not None:
        pr = {"guard": probe_guard, "line": 3, "text": text, "message": message, "token": token}
        if agrees is not None:
            pr["agrees"] = agrees
        st["rtProbe"] = pr
    if code is not None:
        st["runtimeDeclined"] = {"code": code, "why": kw.get("why", "")}
    return st


def _walls(*steps):
    return cm.runtime_walls_of({"steps": list(steps) + [{"attached": True}]})


# ---- 1. the decline's code wins when the probe disagrees --------------------------------------

def test_a_disagreeing_probe_does_not_name_the_wall():
    # the 2026-11-02 shape: the value build said object-op, the door declined on the drawing build's guard
    got = _walls(_step("runtime:object-op", agrees=False, code="runtime:conditional-history"))
    assert got == ["runtime:conditional-history"]


def test_an_agreeing_probe_still_names_the_wall():
    got = _walls(_step("runtime:loop", agrees=True, code="runtime:loop"))
    assert got == ["runtime:loop"]


def test_a_row_from_before_agrees_existed_keeps_the_probe_guard():
    got = _walls(_step("runtime:object-op", agrees=None, code="runtime:conditional-history"))
    assert got == ["runtime:object-op"]


def test_a_disagreeing_probe_with_no_decline_falls_back_to_the_probe():
    got = _walls(_step("runtime:object-op", agrees=False, code=None))
    assert got == ["runtime:object-op"]


# ---- 2. the wave of the three re-mapped walls --------------------------------------------------

def test_for_in_loops_are_w6_and_the_tag_is_read_off_the_message():
    msg = "a loop in a form this lane does not iterate \u2014 `for \u2026 in`"
    steps = cm.runtime_wall_steps({"steps": [_step("runtime:loop", agrees=True, code="runtime:loop", message=msg), {"attached": True}]})
    assert steps == [("runtime:loop", [cm.TAG_FOR_IN])]
    assert targets.rt_wave("runtime:loop", [cm.TAG_FOR_IN]) == "W6"
    assert targets.rt_wave("runtime:loop") == "W4"          # a loop that is not for-in stays W4


def test_a_bare_security_is_w7_and_other_undeclared_builtins_are_not():
    g = "runtime:call-undeclared-builtin-state"
    row = {"steps": [_step(g, agrees=True, code=g, token="security"), {"attached": True}]}
    assert cm.runtime_wall_steps(row) == [(g, [cm.TAG_BARE_SECURITY])]
    row = {"steps": [_step(g, agrees=True, code=g, token="xhma"), {"attached": True}]}
    assert cm.runtime_wall_steps(row) == [(g, [])]
    assert targets.rt_wave(g, [cm.TAG_BARE_SECURITY]) == "W7"
    assert targets.rt_wave(g, []) == "W4"


def test_no_output_on_an_order_strategy_is_w9():
    assert targets.rt_wave("runtime:no-output", (), True) == "W9"
    assert targets.rt_wave("runtime:no-output", (), False) == "W4"


# ---- 3. 7.1: the capture plan ------------------------------------------------------------------

def _row(key, lane, existing, agree=0):
    return {"key": key, "lane": lane, "existingCapture": existing, "agree": agree}


def test_a_script_whose_capture_already_diverges_is_not_a_capture_target():
    rows = [_row("a", "production", "DIVERGE", agree=99), _row("b", "production", None)]
    uses = {"a": {"i1", "i2", "i3"}, "b": {"i3", "i4"}}
    plan = targets.capture_plan(rows, uses, {})
    assert [p["key"] for p in plan["picks"]] == ["b"]
    assert plan["coveredProduction"] == {"i3", "i4"}          # i1, i2 are NOT claimed
    assert plan["excludedDiverging"] == {"a": ["i1", "i2", "i3"]}


def test_a_runtime_on_row_is_never_credited_to_the_production_figure():
    rows = [_row("p", "production", None), _row("r", "runtime-on", None)]
    uses = {"p": {"i1"}, "r": {"i1", "i2", "i3"}}
    plan = targets.capture_plan(rows, uses, {})
    by = {p["key"]: p for p in plan["picks"]}
    assert plan["coveredProduction"] == {"i1"}                 # r's items are not production coverage
    assert plan["coveredRuntimeLane"] == {"i1", "i2", "i3"}
    assert by["r"]["lane"] == "runtime-on" and by["r"]["verifiesNewItems"] == ["i1", "i2", "i3"]
    assert by["p"]["verifiesNewItems"] == ["i1"]


def test_a_runtime_on_row_does_not_count_an_item_already_matching_in_that_run():
    rows = [_row("r", "runtime-on", None)]
    plan = targets.capture_plan(rows, {"r": {"i1", "i2"}}, {"i1": ["cap"]})
    assert plan["picks"][0]["verifiesNewItems"] == ["i2"]
    assert plan["coveredProduction"] == set()
