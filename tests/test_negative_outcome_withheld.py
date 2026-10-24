"""Buy setups whose outcome verdict is NEGATIVE are withheld from members (outcome replay 2026-10-24, against a
matched plain 20-day-high breakout in the same stock). A buy setup that trails a plain breakout misleads.

  * draw:darvas-box -- win8 lift -5.1pp [-6.7,-3.4] vs matched breakout: MEMBER_DARVAS_BOX_ROUND is None in source.
  * the uct_flag_htf setup tag -- NEGATIVE: in registry.SETUP_TAG_MEMBER_WITHHELD.

Admins keep both. Each rail has a re-enable control proving the gate is the literal / the set, not a row the member
path could never serve. Synthetic ids only (public repo).
"""
from __future__ import annotations

import ast

from api.services import auto_structures as AS
from api.services import setup_tags as ST
from api.services.pattern_engine.detectors import registry as REG
from tests.test_setup_draw_r2_member_gate import ROWS


def _source_literal(name):
    tree = ast.parse(open(AS.__file__, encoding="utf-8").read())
    lits = [n for n in ast.walk(tree) if isinstance(n, ast.Assign)
            and any(getattr(t, "id", None) == name for t in n.targets)]
    assert len(lits) == 1 and isinstance(lits[0].value, ast.Constant), name
    return lits[0].value.value


def test_the_darvas_member_literal_is_none_in_source():
    assert _source_literal("MEMBER_DARVAS_BOX_ROUND") is None
    assert AS.MEMBER_DARVAS_BOX_ROUND is None


def test_a_real_darvas_row_reaches_no_member_and_the_round_brings_it_back(monkeypatch):
    row = ROWS["draw:darvas-box"]
    assert AS.member_rows([row]) == []
    assert "draw:darvas-box" in REG.DISPLAY_TEAM_SET          # admins keep it
    monkeypatch.setattr(AS, "MEMBER_DARVAS_BOX_ROUND", 2)     # re-enable control
    assert AS.member_rows([row]) == [row]


def _flag_tag():
    return {"setup": "uct_flag_htf", "direction": "bullish", "tag_round": ST.TAGS_ROUND, "kind": "setup"}


def test_the_flag_tag_is_withheld_from_members_and_kept_for_the_team():
    assert "uct_flag_htf" in REG.SETUP_TAG_MEMBER_WITHHELD
    assert "uct_flag_htf" not in REG.SETUP_TAG_MEMBER_SET
    assert "uct_flag_htf" in REG.SETUP_TAG_TEAM_SET
    assert ST.member_tags([_flag_tag()]) == []


def test_re_enable_control_the_flag_tag_is_served_once_back_in_the_member_set(monkeypatch):
    monkeypatch.setattr(REG, "SETUP_TAG_MEMBER_SET", REG.SETUP_TAG_MEMBER_SET | {"uct_flag_htf"})
    assert ST.member_tags([_flag_tag()]) == [_flag_tag()]
