"""The view rules after the be->impl merge: impl's DATA (`VIEW_CHECKS` / `AUTO_VIEW`, ruling R-35) carrying be's
wave 10 semantics (Tasks 10.6/10.7): a progress target may be a goal, and a line or a heat map runs along ANY day
field of the source (the notes source's "Written" and "Updated"), not only the trades' day and month. The client
interpreter (`builderCatalog.js` CHECK_TESTS) is railed on the same cases by builderCatalog.merge.test.js.
"""
from __future__ import annotations

from api.services.journal_two.widget_engine import sources as S

CAT = S.CATALOG


def _p(source, view, split=None, **kw):
    return {"source": source, "view": {"type": view}, "split": split, **kw}


def test_a_line_and_a_heat_map_run_along_any_day_field():
    for by in ("created", "updated"):
        assert S.SOURCES["notes"].fields[by].type == "day"                 # the data this rests on
        assert CAT.view_allowed(_p("notes", "line", {"by": by})) is None
        assert CAT.view_allowed(_p("notes", "heat", {"by": by})) is None
        assert CAT.auto_view({"source": "notes", "split": {"by": by}}) == "line"
    assert CAT.view_allowed(_p("closed_trades", "line", {"by": "month"})) is None
    assert CAT.view_allowed(_p("closed_trades", "heat", {"by": "month"})) == S.S_VIEW_HEAT   # month: not a day
    assert CAT.view_allowed(_p("closed_trades", "line", {"by": "setup"})) == S.S_VIEW_LINE   # control
    assert CAT.auto_view({"source": "closed_trades", "split": {"by": "setup"}}) == "bar"


def test_a_goal_target_is_a_target():
    assert CAT.view_allowed(_p("closed_trades", "progress", display={"targetGoal": {"goal": "g1"}})) is None
    assert CAT.view_allowed(_p("closed_trades", "progress", display={"target": 100})) is None
    assert CAT.view_allowed(_p("closed_trades", "progress", display={})) == S.S_VIEW_PROGRESS


def test_the_rules_are_still_data():
    line = next(c for c in S.VIEW_CHECKS if c["reason"] == "view_line")
    assert line["test"] == "split_in" and line["types"] == ["day"]
    assert S.AUTO_VIEW["time_types"] == ["day"]
