"""The cup with handle is WITHDRAWN from members (owner decision 4, chart pattern product decisions, 2026-10-24).

The strict blind recertification scored the cup 1.98 against the 2.3 bar on n = 20 charts, and n = 20 cannot
certify the drawing either way. MEMBER_CUP_TIER_ROUND is None until a pre-registered blind packet of n >= 60 cups
clears the product bar. Admins keep the cup: the team chart never passes member_rows, and its stale-cup door reads
CUP_TIER_JUDGED_ROUND, not the member literal.

Rails: the literal stays None; with it None a confirmed cup row reaches no member; the re-enable control (the
literal set back to the judged round) serves the same row again, so the door is real; the team chart still draws a
stale tier-drawn cup with the literal None. Synthetic ids and prices only (public repo).
"""
from __future__ import annotations

import copy

from api.services import auto_structures
from tests.test_cup_tier_member_drawing import CUP, _bars, _cup_row, _stamp


def _trusted(row):
    return {**row, "display_tier": "trusted"}


def test_the_member_cup_literal_is_none():
    assert auto_structures.MEMBER_CUP_TIER_ROUND is None
    assert auto_structures.CUP_TIER_JUDGED_ROUND == 4


def test_a_confirmed_cup_reaches_no_member_while_the_literal_is_none():
    row = _trusted(_cup_row(_stamp()))
    assert not [r for r in auto_structures.member_rows([row]) if r.get("pattern_id") == CUP]


def test_re_enable_control_the_judged_round_serves_the_same_cup_again(monkeypatch):
    """What a passed n >= 60 packet would ship: the literal back to the judged round. Proves the gate above is the
    literal, not a cup row the member path could never have served."""
    row = _trusted(_cup_row(_stamp()))
    monkeypatch.setattr(auto_structures, "MEMBER_CUP_TIER_ROUND", auto_structures.CUP_TIER_JUDGED_ROUND)
    served = [r for r in auto_structures.member_rows([row]) if r.get("pattern_id") == CUP]
    assert len(served) == 1
    assert served[0]["geometry"]["extras"]["draw_pivot"]["price"] == _stamp()["pivot"]["price"]


def test_the_team_chart_keeps_a_stale_tier_drawn_cup_with_the_literal_none(monkeypatch):
    """The stale-cup door feeds the team chart: it must read the JUDGED round, so withdrawing the cup from members
    leaves the admin chart exactly as it was."""
    assert auto_structures.MEMBER_CUP_TIER_ROUND is None

    def fake_stamp(det, bars):
        det["geometry"]["extras"]["cup_tier"] = _stamp()

    monkeypatch.setattr(auto_structures, "cup_tier_stamp", fake_stamp)
    det = _cup_row(None, stale=True, stale_reason="rim_broken")
    out = auto_structures._tier_drawn_stale_cup(copy.deepcopy(det), _bars())
    assert out is not None and out["pattern_id"] == CUP
    # control: a stamp the tier withheld is still dropped (the judged round is not a bypass)
    monkeypatch.setattr(auto_structures, "cup_tier_stamp",
                        lambda d, b: d["geometry"]["extras"].__setitem__("cup_tier", _stamp(withheld="handle_deep")))
    assert auto_structures._tier_drawn_stale_cup(copy.deepcopy(det), _bars()) is None
