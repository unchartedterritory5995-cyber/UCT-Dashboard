"""DRAW-1 (2026-11-16) - an ATTACHED step's `pine:objects-only` is the consequence of its dropped ops.

The host lane refuses a DIRTY objects-only program as `pine:objects-only` (a clean one is `ok`) and the
member door still attaches it, so the step's walls are the ops the object program names. Counted as a
wall of its own it was the bucket `drawing-objects`, which the wall analysis read as "a loss with nothing
named" for 29 sample scripts (27 of which name every drop). And an output-contract refusal on an attached
step (`pine:constant-only` beside a drawn program) is about the PLOTS: it is no longer relabelled as a lost
object program. Every rail has a control that keeps its old answer.
"""
from __future__ import annotations

from tools.pine_coverage import coverage_map as cm


class _Inv:
    items = {}

    @staticmethod
    def normalise(name, version):
        return name


CTORS = frozenset({"label.new", "table.new"})


def _walls(*steps, items=CTORS):
    return cm.walls_of({"steps": list(steps)}, _Inv, 6, frozenset(items))[0]


def _attached(guard, **kw):
    st = {"attached": True, "installed": True, "lossVerdict": "partial", "withheldObjects": False,
          "withheldPaints": 0, "refusals": [{"guard": guard, "line": None, "token": None}]}
    st.update(kw)
    return st


def test_an_attached_objects_only_step_is_walled_by_its_named_drops_only():
    w = _walls(_attached("pine:objects-only", attemptedOps=3, droppedOps=2, dropReasons={"cell:text": 2},
                         dropHeads=["cell:text@38: pine:text-value"]))
    assert w == {("drop", "cell:text <- pine:text-value")}
    assert ("bucket", "drawing-objects") not in w


def test_a_drop_no_host_guard_explains_is_still_named_by_its_key():
    w = _walls(_attached("pine:objects-only", attemptedOps=13, droppedOps=4, dropReasons={"loop:bounds": 4},
                         dropHeads=[], unsupported=["box.set_text_font_family"]))
    assert w == {("drop", "loop:bounds"), ("item", "box.set_text_font_family")}


def test_control_an_attached_dirty_program_that_names_nothing_keeps_drawing_objects():
    """No counter, no head, no reader name: the refusal is the only fact, so it stays the wall."""
    w = _walls(_attached("pine:objects-only", attemptedOps=None, droppedOps=None, dropReasons={}))
    assert w == {("bucket", "drawing-objects")}


def test_control_a_refused_step_keeps_its_object_program_reading():
    st = {"attached": False, "refusals": [{"guard": "pine:objects-only", "line": None, "token": None}],
          "attemptedOps": 3, "droppedOps": 3, "dropReasons": {"guard:create": 3},
          "dropHeads": ["create@9: pine:state"]}
    assert _walls(st) == {("drop", "guard:create <- pine:state")}


def test_an_attached_constant_only_step_is_an_output_contract_wall_not_a_lost_program():
    w = _walls(_attached("pine:constant-only", lossVerdict="clean", attemptedOps=171, droppedOps=0, dropReasons={}))
    assert w == {("bucket", "output-contract")}


def test_control_a_refused_no_output_drawing_script_is_still_relabelled_drawing_objects():
    st = {"attached": False, "refusals": [{"guard": "pine:no-output", "line": None, "token": None}]}
    assert _walls(st) == {("bucket", "drawing-objects")}
