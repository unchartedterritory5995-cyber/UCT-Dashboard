"""Every bull flag is withheld from members (recert E, 2026-10-24).

The round-9 confirmed tier scored 1.62 on the strict textbook rubric (lab flag_textbook_r2) and the "flagging"
tier 1.28 (already withheld: MEMBER_FLAGGING_ROUND = None). A rebuilt textbook bull flag -- new filter AND new
drawing -- was judged on 4 pre-registered blind packets of 25: 2.34 / 2.36 / 2.22 / 2.50, pooled 2.355; the bar is
every packet >= 2.3 and pooled >= 2.4, so it FAILED, and a fresh fix round could not be filled on the member universe.
Per the recertification protocol: hide it from members, keep it for admins.

What this file holds:
  1. the shipped literal is None, written in source (not a reference that could release itself);
  2. on the REAL member route, with a real round-9 confirmed flag and a real flagging flag in the store, a member
     gets no bull_flag at all, while an admin still gets every row;
  3. control: the one-literal re-enable (MEMBER_BULL_FLAG_ROUND = 9) serves the confirmed flag again -- so (2) is
     the literal doing the work, not a broken fixture.
Synthetic bars only (public repo).
"""
from __future__ import annotations

import ast

from api.services import auto_structures
from tests.authclients import ADMIN, PAID_MEMBER
from tests.test_bull_flag_r7 import _drawn
from tests.test_bull_flag_r9 import SHORT_LEG, TALL_LEG, _flag_after
from tests.test_member_drawing_set import _flag, _flags, _get, _store


def _literal_in_source(name):
    tree = ast.parse(open(auto_structures.__file__, encoding="utf-8").read())
    vals = [n.value for n in tree.body if isinstance(n, ast.Assign)
            for t in n.targets if isinstance(t, ast.Name) and t.id == name]
    assert len(vals) == 1, (name, len(vals))
    return vals[0]


def test_both_member_bull_flag_literals_are_none_in_source():
    for name in ("MEMBER_BULL_FLAG_ROUND", "MEMBER_FLAGGING_ROUND"):
        node = _literal_in_source(name)
        assert isinstance(node, ast.Constant) and node.value is None, name
    assert auto_structures.MEMBER_BULL_FLAG_ROUND is None
    assert auto_structures.MEMBER_FLAGGING_ROUND is None


def _route(monkeypatch):
    good, _ = _drawn(*_flag_after(TALL_LEG))       # every verdict passes: the round-9 confirmed tier
    bad, _ = _drawn(*_flag_after(SHORT_LEG))       # stale on a relaxed reason: the "flagging" tier
    assert not good.get("stale") and isinstance(good.get("draw_round"), int)
    assert bad["flagging"]["tier"] == "flagging"
    _flags(monkeypatch, True, True)
    _store(monkeypatch, [_flag("g", **good), _flag("b", **bad)])
    monkeypatch.setattr(auto_structures, "structures_for", lambda sym: [])
    monkeypatch.setattr(auto_structures, "drawn_for", lambda sym: None)


def test_a_member_gets_no_bull_flag_and_an_admin_still_gets_both_tiers(monkeypatch):
    _route(monkeypatch)
    body = _get(PAID_MEMBER).json()
    assert [r for r in body["detections"] if r.get("pattern_id") == "bull_flag"] == []
    assert all(r.get("pattern_id") != "bull_flag" for r in body.get("structures") or [])
    assert [r["id"] for r in _get(ADMIN).json()["detections"]] == ["g", "b"]


def test_control_the_one_literal_re_enable_serves_the_confirmed_flag_again(monkeypatch):
    _route(monkeypatch)
    monkeypatch.setattr(auto_structures, "MEMBER_BULL_FLAG_ROUND", 9)
    assert [r["id"] for r in _get(PAID_MEMBER).json()["detections"]] == ["g"]
    monkeypatch.setattr(auto_structures, "MEMBER_FLAGGING_ROUND", 9)
    assert [r["id"] for r in _get(PAID_MEMBER).json()["detections"]] == ["g", "b"]


def test_member_rows_drops_every_bull_flag_shape_while_the_literal_is_none():
    """The gate itself, without the route: a confirmed-stamped, a flagging-stamped, an unstamped and a
    wrong-round bull_flag row all leave member_rows, whatever else they carry."""
    from api.services.pattern_engine.detectors import registry
    pol = registry.display_policy("bull_flag")
    good, _ = _drawn(*_flag_after(TALL_LEG))
    bad, _ = _drawn(*_flag_after(SHORT_LEG))
    rows = [{**_flag("g", **good), **pol}, {**_flag("b", **bad), **pol}, {**_flag("u"), **pol},
            {**_flag("w", draw_round=8), **pol}, {**_flag("s", draw_round=9, stale=True), **pol}]
    assert auto_structures.member_rows(rows) == []
