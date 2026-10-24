"""The MA pullback v5 is withheld from members (recertification C, 2026-10-24).

uct_pullback_ma_v5 as served (the tagged MA curve, tag-bar marker and stop) was judged on the strict textbook
placement rubric, four pre-registered blind packets of 25 with two fresh judges each: 1.60 / 1.60 / 1.78 / 1.52,
pooled 1.63. Two fix rounds on development dates (fresh seeds, previous rounds' tickers banned) reached 2.10 /
2.28 / 2.28 / 2.26 (pooled 2.23) and 2.20 / 2.36 / 2.42 / 2.28 (pooled 2.315). The bar is every packet >= 2.3 with
>= 70% of cases >= 2, pooled >= 2.4, so it FAILED; per the protocol, hide it from members and keep it for admins.

What this file holds:
  1. the shipped literal is None, written in source (not a reference that could release itself);
  2. on the REAL member route, with a live v5 row in the store, a member gets no v5 pullback while an admin still
     gets it;
  3. control: the one-literal re-enable serves it again -- so (2) is the literal doing the work, not a broken
     fixture.
Synthetic rows only (public repo).
"""
from __future__ import annotations

import ast

import pytest

from api.services import auto_structures
from api.services.pattern_engine.detectors import registry
from tests.authclients import ADMIN, PAID_MEMBER
from tests.test_member_drawing_set import _flags, _get, _store

V5 = "uct_pullback_ma_v5"



@pytest.fixture(autouse=True)
def flat_base_released(monkeypatch):
    """flat_base is this file's still-served "other" member type; it is withheld from members since 2026-10-24
    (recert A), so it is re-enabled in memory here (tests/test_flat_base_withheld_from_members.py rails that)."""
    monkeypatch.setattr(auto_structures, "MEMBER_FLAT_BASE_ROUND", 1)
    monkeypatch.setattr(auto_structures, "MEMBER_BC_FLAT_BASE_ROUND", "team")

def test_the_member_v5_literal_is_none_in_source():
    tree = ast.parse(open(auto_structures.__file__, encoding="utf-8").read())
    vals = [n.value for n in tree.body if isinstance(n, ast.Assign)
            for t in n.targets if isinstance(t, ast.Name) and t.id == "MEMBER_PULLBACK_MA_V5_ROUND"]
    assert len(vals) == 1 and isinstance(vals[0], ast.Constant) and vals[0].value is None
    assert auto_structures.MEMBER_PULLBACK_MA_V5_ROUND is None
    assert auto_structures.PULLBACK_MA_V5_ID == V5


def _route(monkeypatch):
    _flags(monkeypatch, True, True)
    _store(monkeypatch, [{"id": "p", "pattern_id": V5}, {"id": "f", "pattern_id": "flat_base"}])
    monkeypatch.setattr(auto_structures, "structures_for", lambda sym: [])
    monkeypatch.setattr(auto_structures, "drawn_for", lambda sym: None)


def test_a_member_gets_no_v5_pullback_and_an_admin_still_does(monkeypatch):
    _route(monkeypatch)
    member = [r["pattern_id"] for r in _get(PAID_MEMBER).json()["detections"]]
    assert V5 not in member and "flat_base" in member          # the route still serves the other member types
    assert V5 in [r["pattern_id"] for r in _get(ADMIN).json()["detections"]]


def test_control_the_one_literal_re_enable_serves_it_again(monkeypatch):
    _route(monkeypatch)
    monkeypatch.setattr(auto_structures, "MEMBER_PULLBACK_MA_V5_ROUND", 1)
    assert V5 in [r["pattern_id"] for r in _get(PAID_MEMBER).json()["detections"]]


def test_member_rows_drops_every_v5_row_while_the_literal_is_none(monkeypatch):
    """The gate itself, without the route: a live, a stale and a stamped v5 row all leave member_rows, while the
    team tier is unchanged (admins and the team never pass through member_rows)."""
    pol = registry.display_policy(V5)
    assert pol["display_tier"] == "trusted" and V5 in registry.DISPLAY_TEAM_SET
    rows = [{"id": "a", "pattern_id": V5, **pol},
            {"id": "b", "pattern_id": V5, "geometry": {"extras": {"stale": True}}, **pol},
            {"id": "c", "pattern_id": V5, "geometry": {"extras": {"draw_round": 1}}, **pol},
            {"id": "d", "pattern_id": "flat_base", **pol}]
    assert [r["pattern_id"] for r in auto_structures.member_rows(rows)] == ["flat_base"]
    monkeypatch.setattr(auto_structures, "MEMBER_PULLBACK_MA_V5_ROUND", 1)
    assert [r["id"] for r in auto_structures.member_rows(rows) if r["pattern_id"] == V5] == ["a", "b", "c"]
