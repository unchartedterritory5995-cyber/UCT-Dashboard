"""Where a member does NOT get the inside-day drawing: auto_structures.member_inside_day_precedence.

On the MEMBER path, after member_rows and the base precedence, the inside-day drawing is dropped (1) on
any timeframe but daily -- it was judged on daily charts -- and (2) when an incumbent member drawing
(flat base, base pivot, flat top, cup, the base drawing, a bull flag) carries a breakout / entry line
within INSIDE_DAY_PRECEDENCE_ATR ATR of the trigger, so a chart never shows two breakout lines a hair
apart. A base that merely CONTAINS the inside day (spans overlap) is not a cover. Admins are unchanged.
Synthetic rows only (public repo).
"""
from __future__ import annotations

import copy
import json

import pytest

import api.routers.patterns as patterns_router  # registers every detector
from api.services import auto_structures as AS
from tests.authclients import ADMIN, PAID_MEMBER
from tests.test_inside_day_draw_member_drawing import _synth
from tests.test_member_drawing_set import _flags, _get, _store


@pytest.fixture(autouse=True)
def _complete_sessions(monkeypatch):
    monkeypatch.setattr(AS, "last_bar_forming", lambda t, now=None: False)
    monkeypatch.setattr(AS, "last_bar_complete", lambda t, now=None: True)


@pytest.fixture(scope="module")
def idrow():
    AS_last = AS.last_bar_complete
    AS.last_bar_complete = lambda t, now=None: True
    try:
        row = AS.inside_day_draw_row("SYN", _synth())
    finally:
        AS.last_bar_complete = AS_last
    assert row is not None
    return row


def _d(row):
    return row["geometry"]["extras"]["draw_inside_day"]


def _base(row, pivot):
    """A bc:base drawing whose span CONTAINS the inside day, with its pivot at `pivot`."""
    d = _d(row)
    s, e = d["start_t"] - 400, d["end_t"]
    return {"id": "bb", "pattern_id": "bc:base", "start_t": s, "end_t": e, "levels": {"entry": pivot},
            "geometry": {"shape": "base_draw", "anchors": [],
                         "extras": {"draw_round": 1, "draw_base": {"pivot": pivot, "low": pivot * 0.8,
                                                                     "start_t": s, "end_t": e, "atr": 1.0,
                                                                     "label": "pivot", "low_label": "base low"}}}}


def _flat_top(price):
    return {"id": "ft", "pattern_id": "uct_flat_top_breakout", "levels": {"entry": price},
            "geometry": {"extras": {"draw_flat_top": {"price": price, "start_t": 1, "end_t": 2}}}}


def _ids(rows):
    return [r["pattern_id"] for r in rows]


def test_alone_on_a_daily_chart_it_is_kept(idrow):
    assert _ids(AS.member_inside_day_precedence([], [idrow], "D")) == ["draw:inside-day"]
    assert _ids(AS.member_inside_day_precedence([], [idrow])) == ["draw:inside-day"]


@pytest.mark.parametrize("tf", ["W", "M", "60", "5"])
def test_any_other_timeframe_drops_it(idrow, tf):
    other = _base(idrow, _d(idrow)["trigger"] * 3)
    assert _ids(AS.member_inside_day_precedence([], [other, idrow], tf)) == ["bc:base"]


def test_an_incumbent_line_near_the_trigger_wins(idrow):
    d = _d(idrow)
    near = d["trigger"] + 0.9 * d["atr"]
    far = d["trigger"] + 1.1 * d["atr"]
    # a base drawing in structures
    assert _ids(AS.member_inside_day_precedence([], [_base(idrow, near), idrow])) == ["bc:base"]
    assert _ids(AS.member_inside_day_precedence([], [_base(idrow, far), idrow])) == ["bc:base", "draw:inside-day"]
    # a flat-top detection row (the incumbent arrives among detections, not structures)
    assert _ids(AS.member_inside_day_precedence([_flat_top(near)], [idrow])) == []
    assert _ids(AS.member_inside_day_precedence([_flat_top(far)], [idrow])) == ["draw:inside-day"]


def test_a_containing_base_far_from_the_trigger_is_not_a_cover(idrow):
    """Span overlap alone never drops it: the inside day sits inside nearly every base."""
    far = _d(idrow)["trigger"] * 2
    assert _ids(AS.member_inside_day_precedence([], [_base(idrow, far), idrow])) == ["bc:base", "draw:inside-day"]


def test_it_fails_closed(idrow):
    for k, v in (("atr", None), ("atr", 0), ("trigger", float("nan")), ("trigger", "x")):
        bad = copy.deepcopy(idrow)
        _d(bad)[k] = v
        assert AS.member_inside_day_precedence([], [bad]) == [], (k, v)
    # a malformed structures list never raises and never serves the drawing
    assert AS.member_inside_day_precedence(None, None) == []
    assert _ids(AS.member_inside_day_precedence(5, [idrow])) == []


def _serve(monkeypatch, structures, detections=()):
    _flags(monkeypatch, True, True)
    _store(monkeypatch, list(detections))
    monkeypatch.setattr(AS, "structures_for", lambda sym: json.loads(json.dumps(structures)))
    monkeypatch.setattr(AS, "drawn_for", lambda sym: None)


def test_the_route_applies_it_for_members_only(monkeypatch, idrow):
    near = _d(idrow)["trigger"]
    base = _base(idrow, near)
    base["display_tier"] = "trusted"
    _serve(monkeypatch, [base, idrow])
    member = _get(PAID_MEMBER).json()
    assert "draw:inside-day" not in _ids(member.get("structures", []))
    admin = _get(ADMIN).json()
    assert "draw:inside-day" in _ids(admin["structures"])
    # and on a weekly chart a member does not get it even alone
    _serve(monkeypatch, [idrow])
    assert "structures" not in _get(PAID_MEMBER, "/api/patterns/ZZZ?tf=W&confirmed_only=false&include_structures=true").json()
    assert _ids(_get(PAID_MEMBER).json()["structures"]) == ["draw:inside-day"]


def test_a_stale_incumbent_is_never_drawn_so_it_covers_nothing(idrow):
    """A stale row is served but never drawn (PatternOverlay.selectDrawable), so it cannot be the
    breakout line that makes the inside-day trigger redundant."""
    near = _d(idrow)["trigger"] + 0.5 * _d(idrow)["atr"]
    ft = _flat_top(near)
    assert _ids(AS.member_inside_day_precedence([ft], [idrow])) == []
    ft["geometry"]["extras"]["stale"] = True
    assert _ids(AS.member_inside_day_precedence([ft], [idrow])) == ["draw:inside-day"]
