"""W3W4-T0 - a refused drawing script names its REAL reason (review B1).

A door `pine:no-output` means "zero surviving ops": ops attempted and dropped, ops never attempted, or an
empty program for a reason no counter names. `walls_of` now reads the step's own counters on a refused step 0
and keeps the three apart; a dropped op is keyed to the host guard that dropped it, and that guard's
capability owns it. Each rail has a control that must keep its old answer.
"""
from __future__ import annotations

from tools.pine_coverage import coverage_map as cm


class _Inv:
    items = {}

    @staticmethod
    def normalise(name, version):
        return name


REFUSE = {"guard": "pine:no-output", "line": None, "token": None}
CTORS = frozenset({"label.new"})


def _row(*steps):
    return {"steps": list(steps)}


def _walls(row, items=CTORS):
    return cm.walls_of(row, _Inv, 6, frozenset(items))[0]


def _refused(**kw):
    st = {"attached": False, "refusals": [dict(REFUSE)], "guard": "pine:no-output"}
    st.update(kw)
    return st


def test_a_dropped_op_is_named_by_op_and_host_guard():
    w = _walls(_row(_refused(attemptedOps=5, droppedOps=3, dropReasons={"guard:create": 3},
                             dropHeads=["create@9: pine:state `x`"])))
    assert w == {("drop", "guard:create <- pine:state")}
    assert cm.key_bucket(next(iter(w)), _Inv) == "imperative"
    assert cm.key_label(next(iter(w))) == "object op dropped: guard:create <- pine:state"


def test_create_family_and_cell_text_resolve_through_their_own_heads():
    w = _walls(_row(_refused(attemptedOps=4, droppedOps=4, dropReasons={"create:line": 2, "cell:text": 2},
                             dropHeads=["create:line@3: pine:collection", "cell:text@5: pine:text-value"])))
    assert w == {("drop", "create:line <- pine:collection"), ("drop", "cell:text <- pine:text-value")}


def test_a_drop_no_host_guard_explains_stays_an_object_op_wall():
    w = _walls(_row(_refused(attemptedOps=2, droppedOps=2, dropReasons={"coll:diverged": 2}, dropHeads=[])))
    assert w == {("drop", "coll:diverged")}
    assert cm.key_bucket(("drop", "coll:diverged"), _Inv) == "drawing-objects"


def test_never_attempted_is_its_own_wall_not_drawing_objects():
    w = _walls(_row(_refused(attemptedOps=0, droppedOps=0, dropReasons={})))
    assert w == {("bucket", "drawing-never-attempted")}


def test_no_output_other_is_its_own_wall():
    w = _walls(_row(_refused(attemptedOps=4, droppedOps=0, dropReasons={})))
    assert w == {("bucket", "drawing-no-output-other")}


def test_control_without_counters_or_ctors_keeps_the_old_answer():
    old = _walls(_row(_refused()))                       # a census row from before the counters
    assert old == {("bucket", "drawing-objects")}        # output-contract moved by the drawing constructor
    assert _walls(_row(_refused(attemptedOps=0, droppedOps=0)), items=set()) == {("bucket", "output-contract")}


def test_a_guard_named_beside_no_output_is_the_wall_not_the_drops():
    st = _refused(attemptedOps=3, droppedOps=3, dropReasons={"guard:create": 3}, dropHeads=["create@9: pine:state"])
    st["refusals"].append({"guard": "pine:reassign", "line": 4, "token": None})
    w = _walls(_row(st))
    assert w == {("bucket", "imperative")}


def test_a_withheld_paint_is_not_a_drawing():
    ok = {"attached": True, "installed": True, "refusals": [], "lossVerdict": "clean", "withheldPaints": 1}
    assert _walls(_row(ok)) == {("bucket", "paint-withheld")}


def test_control_an_unnamed_loss_stays_drawing_objects():
    st = {"attached": True, "installed": True, "refusals": [], "lossVerdict": "partial", "withheldPaints": 0}
    assert _walls(_row(st)) == {("bucket", "drawing-objects")}
    st2 = dict(st, lossVerdict="clean", withheldPaints=1, withheldObjects=True)
    assert _walls(_row(st2)) == {("bucket", "drawing-objects")}


def test_attached_dirty_drops_are_resolved_too():
    st = {"attached": True, "installed": True, "refusals": [], "lossVerdict": "partial",
          "dropReasons": {"guard:update": 1}, "dropHeads": ["update@7: pine:block"]}
    assert _walls(_row(st)) == {("drop", "guard:update <- pine:block")}


def test_parse_drop_heads_keeps_a_drifted_format_visible():
    got = cm.parse_drop_heads(["create:line@12: unrecorded", "update@7: pine:state `x`", "garbage"])
    assert [g["guard"] for g in got] == ["unrecorded", "pine:state", None]
    assert got[1]["token"] == "x" and got[2]["op"] is None
    assert cm.drop_guard_of("guard:create <- unrecorded") is None
    assert cm.object_program_split({}) is None
