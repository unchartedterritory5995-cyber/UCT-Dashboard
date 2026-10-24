"""The donchian channel line joins one-breakout-line-per-base: auto_structures.member_setup_one_line_per_base.

The draw:donchian_breakout setup line is the 55-bar channel high, which lands on a base's ceiling by construction.
A blind paired round (2026-10-24, precedence round e) put it head to head with the base drawing a member is
served on the same base; there was no clear winner, so the base drawing already shown stays and the channel line
is shown only where no higher-ranked drawn line is within ONE_LINE_PER_BASE_ATR over overlapping spans. The rows
below are synthetic (made-up dates and prices). Public repo.
"""
from __future__ import annotations

import ast
import copy
import pathlib

from api.services import auto_structures as AS
from tests.test_one_line_per_base import (E, FAR_E, FAR_S, S, _base, _bull_flag, _double_bottom, _flat_top,
                                          _ids)


def _donchian(level, s=S, e=E, rid="dc"):
    """A setup row in the shape auto_structures.setup_draw_rows serves (a horizontal_line with two anchors)."""
    return {"id": rid, "pattern_id": "draw:donchian_breakout", "start_t": s, "end_t": e,
            "geometry": {"shape": "horizontal_line",
                         "anchors": [{"t": s, "price": level}, {"t": e, "price": level}],
                         "extras": {"draw_round": 1, "draw_setup": {"level": level}}},
            "levels": {"entry": level}}


def _remount(level, s=S, e=E):
    return {"id": "rm", "pattern_id": "draw:remount", "start_t": s, "end_t": e,
            "geometry": {"shape": "horizontal_line",
                         "anchors": [{"t": s, "price": level}, {"t": e, "price": level}],
                         "extras": {"draw_round": 3, "draw_setup": {"level": level}}}}


def _state_base(p, state="breakout", s=S, e=E):
    row = _base(p, s, e)
    row["geometry"]["extras"]["draw_base"]["state"] = state
    return row


def _run(dets, sts, setups, atr=1.0):
    d0, s0, x0 = copy.deepcopy(dets), copy.deepcopy(sts), copy.deepcopy(setups)
    before_d, before_s = copy.deepcopy(d0), copy.deepcopy(s0)
    out = AS.member_setup_one_line_per_base(d0, s0, x0, atr=atr)
    assert d0 == before_d and s0 == before_s        # the settled chart is read, never changed
    if out is not None:
        assert all(any(r is x for x in x0) for r in out)   # kept rows are the very objects passed in
    return out


def test_the_donchian_line_ranks_after_every_base_drawing():
    pr = AS.ONE_LINE_PER_BASE_PRIORITY
    # the donchian line ranks after every base drawing; only the rectangle box (tests/
    # test_setup_draw_rectangle_member_gate.py) ranks after it
    assert pr[-2:] == ("draw:donchian_breakout", "draw:rectangle")
    for pid in ("bc:cup-with-handle", "draw:double-bottom", "uct_flat_top_breakout", "bc:flat-base",
                "flat_base", "bc:base"):
        assert pr.index(pid) < pr.index("draw:donchian_breakout")


def test_a_donchian_line_on_the_base_line_yields_to_the_base():
    assert _ids(_run([], [_base(50.0)], [_donchian(50.4)])) == []


def test_a_donchian_line_yields_to_a_base_STATE_row_too():
    # a base state row yields to every incumbent drawing, but the base drawing a member is shown outranks the
    # channel line (round e: the drawing already shown stays)
    assert _ids(_run([], [_state_base(50.0)], [_donchian(50.3)])) == []
    assert _ids(_run([], [_state_base(50.0, "forming")], [_donchian(50.3)])) == []


def test_a_donchian_line_yields_to_a_double_bottom_and_a_flat_top():
    assert _ids(_run([], [_double_bottom(30.0)], [_donchian(30.5)])) == []
    assert _ids(_run([_flat_top(30.0)], [], [_donchian(29.6)])) == []


def test_a_donchian_line_more_than_one_atr_away_stays():
    assert _ids(_run([], [_base(50.0)], [_donchian(51.2)])) == ["draw:donchian_breakout"]
    assert _ids(_run([], [_base(50.0)], [_donchian(50.99)])) == []          # control: just inside drops


def test_a_donchian_line_over_other_bars_stays():
    assert _ids(_run([], [_base(50.0, FAR_S, FAR_E)], [_donchian(50.0)])) == ["draw:donchian_breakout"]


def test_alone_or_beside_a_bull_flag_entry_far_away_it_stays():
    assert _ids(_run([], [], [_donchian(50.0)])) == ["draw:donchian_breakout"]
    assert _ids(_run([_bull_flag(40.0)], [], [_donchian(50.0)])) == ["draw:donchian_breakout"]


def test_other_setup_lines_are_never_touched():
    out = _run([], [_base(50.0)], [_remount(50.0), _donchian(50.0)])
    assert _ids(out) == ["draw:remount"]


def test_no_setups_key_stays_no_setups_key():
    assert AS.member_setup_one_line_per_base([], [_base(50.0)], None, atr=1.0) is None
    assert AS.member_setup_one_line_per_base([], [_base(50.0)], [], atr=1.0) == []


def test_the_donchian_line_is_read_where_the_chart_draws_it():
    # HorizontalLine.jsx draws one line at the mean of the first two anchors, over the row's span
    row = _donchian(50.0)
    row["geometry"]["anchors"][1]["price"] = 52.0
    assert AS._breakout_lines(row) == [(51.0, S, E)]


def test_the_member_route_passes_its_setup_draws_through_the_pass():
    """The wire: patterns.get_detections hands the member's setup_draws to member_setup_one_line_per_base
    before they reach the payload (an AST over the route, so a rename or a dropped call goes red)."""
    src = pathlib.Path(__file__).resolve().parents[1] / "api" / "routers" / "patterns.py"
    tree = ast.parse(src.read_text(encoding="utf-8"))
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)]
    names = {n.func.attr for n in calls}
    assert "setup_draws_for" in names                         # control: the probe sees the sibling call
    hits = [n for n in calls if n.func.attr == "member_setup_one_line_per_base"]
    assert len(hits) == 1
    assert [a.id for a in hits[0].args if isinstance(a, ast.Name)] == ["rows", "boxes", "sd"]
    # its RESULT replaces sd, the value the payload's setup_draws key is built from (a call whose answer is
    # thrown away would leave the chart unchanged)
    assigns = [n for n in ast.walk(tree) if isinstance(n, ast.Assign) and n.value is hits[0]]
    assert [t.id for a in assigns for t in a.targets if isinstance(t, ast.Name)] == ["sd"]
