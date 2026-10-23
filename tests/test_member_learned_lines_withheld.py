"""The learned auto-drawer's levels + trendlines (the `drawn` block) are WITHHELD from members.

Owner decision 2026-10-23: members stop seeing the violet "learned ..." lines until the layer is
rebuilt to textbook support / resistance rules and passes blind judging again. Admins keep them.
The gate is one literal, auto_structures.MEMBER_LEARNED_LINES_ROUND (None today), in the
MEMBER_*_ROUND convention: set by hand to a confirmed round, and even then a member gets a `drawn`
block only while it carries that round in `learned_round` (today's drawer stamps none -- fail closed).

The member path must not COMPUTE the drawing either (it is the expensive daily-bars pass), so the
rails count calls to drawn_for, not just the payload key. Synthetic ids and prices only (public repo).
"""
from __future__ import annotations

import ast
import inspect
import json
import textwrap

from api.services import auto_structures
from tests.authclients import ADMIN, PAID_MEMBER
from tests.test_member_drawing_set import DRAWN, URL, _flags, _get, calls  # noqa: F401 -- fixture


def _count_drawn_for(monkeypatch, block):
    seen = []

    def fake(sym):
        seen.append(sym)
        return json.loads(json.dumps(block)) if block is not None else None

    monkeypatch.setattr(auto_structures, "drawn_for", fake)
    return seen


def test_the_member_literal_is_none():
    """Pinned: releasing learned lines to members is a deliberate edit here AND in auto_structures."""
    assert auto_structures.MEMBER_LEARNED_LINES_ROUND is None


def test_member_payload_has_no_drawn_key_and_never_computes_it(monkeypatch, calls):  # noqa: F811
    _flags(monkeypatch, True, True)
    seen = _count_drawn_for(monkeypatch, DRAWN)
    for tf in ("D", "W", "M", "5"):
        body = _get(PAID_MEMBER, URL.replace("tf=D", "tf=" + tf)).json()
        assert "drawn" not in body, tf
        # nothing else carries the learned lines or their suppress map under another name
        assert "learned" not in json.dumps(body), tf
        assert "suppress" not in json.dumps(body), tf
    assert seen == []           # the member path never ran the drawer


def test_admin_payload_still_carries_the_drawn_block_unchanged(monkeypatch, calls):  # noqa: F811
    _flags(monkeypatch, True, True)
    seen = _count_drawn_for(monkeypatch, DRAWN)
    body = _get(ADMIN).json()
    assert body["drawn"] == DRAWN
    assert seen == ["ZZZ"]


def test_moving_the_literal_releases_only_a_block_stamped_with_that_round(monkeypatch, calls):  # noqa: F811
    """Derived, not restated: the route reads the literal per call, and the stamp must match."""
    _flags(monkeypatch, True, True)
    monkeypatch.setattr(auto_structures, "MEMBER_LEARNED_LINES_ROUND", "textbook-r1")
    stamped = {**DRAWN, "learned_round": "textbook-r1"}
    _count_drawn_for(monkeypatch, stamped)
    assert _get(PAID_MEMBER).json()["drawn"] == stamped
    for block in (DRAWN, {**DRAWN, "learned_round": "textbook-r0"}, None):   # unstamped / other / none
        _count_drawn_for(monkeypatch, block)
        assert "drawn" not in _get(PAID_MEMBER).json(), block and block.get("learned_round")


def test_a_bool_literal_does_not_release_anything(monkeypatch):
    """`True` is not a round: a hand edit to True must not serve today's unstamped drawer."""
    monkeypatch.setattr(auto_structures, "MEMBER_LEARNED_LINES_ROUND", True)
    monkeypatch.setattr(auto_structures, "drawn_for", lambda sym: {**DRAWN, "learned_round": True})
    assert auto_structures.member_drawn_for("ZZZ") is None


def test_a_raising_drawer_answers_none(monkeypatch):
    monkeypatch.setattr(auto_structures, "MEMBER_LEARNED_LINES_ROUND", "textbook-r1")

    def boom(sym):
        raise RuntimeError("bars down")

    monkeypatch.setattr(auto_structures, "drawn_for", boom)
    assert auto_structures.member_drawn_for("ZZZ") is None


def _called_names(fn):
    tree = ast.parse(textwrap.dedent(inspect.getsource(fn)))
    return {n.func.attr if isinstance(n.func, ast.Attribute) else getattr(n.func, "id", None)
            for n in ast.walk(tree) if isinstance(n, ast.Call)}


def test_the_shelf_pivot_member_path_does_not_depend_on_the_learned_drawer():
    """The shelf pivot's member facts (what the member chart serves, for the C3 hide rule) are built
    from detector rows and structures only -- never the learned `drawn` block -- so withholding it
    from members cannot move the shelf pivot. Control: the names this walk sees include one it must."""
    for fn in (auto_structures.shelf_member_facts, auto_structures.shelf_compute,
               auto_structures.shelf_pivot_row):
        names = _called_names(fn)
        assert not names & {"drawn_for", "member_drawn_for", "drawn_set"}, fn.__name__
    assert "member_rows" in _called_names(auto_structures.shelf_member_facts)   # non-vacuity
