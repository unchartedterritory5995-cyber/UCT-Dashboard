"""MEMBER PARITY for round 3: members (MEMBER_BASE_ROUND == 2) are served byte-for-byte what round 2 served.

The drawing code moved to round 3 (a shelf under a higher peak, admin-only). Every bc:base row is now a round-3
row carrying round 2's drawing of the same bars (extras.draw_member), and member_rows rebuilds the member row
from it. tests/fixtures/base_draw_member_golden_r2.json was written by tools/base_draw_member_golden.py from
code whose drawing round IS round 2 (origin/master 8043eca012, BASE_DRAW_ROUND == MEMBER_BASE_ROUND == 2): one
digest per session / scan of what that code served a member (member_rows, then with_metrics member=True,
metrics flag on). Here the same synthetic sweep runs on the code under test and every digest must match.

Controls: the sweep must serve members a base, must contain sessions where round 3 draws and round 2 does not
(so the carrier's "member gets nothing" branch is exercised), and there the admin must see round 3's row.
"""
import importlib.util
import json
import os

from api.services import auto_structures
from api.services.pattern_engine import base_draw

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("base_draw_member_sweep_r3",
                                               os.path.join(_HERE, "base_draw_member_sweep.py"))
SW = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(SW)

with open(os.path.join(_HERE, "fixtures", "base_draw_member_golden_r2.json"), encoding="utf-8") as _f:
    GOLDEN = json.load(_f)


def test_the_golden_is_from_round_two_and_is_not_vacuous():
    assert GOLDEN["member_round"] == 2 and GOLDEN["code_sha"] == "8043eca012"
    c = GOLDEN["counts"]
    assert c["rows"] == 960 and c["scans"] == 168
    assert c["row_served"] >= 50 and c["scan_served"] >= 10
    assert c["row_metrics"] == c["row_served"]


def test_members_are_served_byte_for_byte_the_round_two_view():
    assert auto_structures.MEMBER_BASE_ROUND == 2 and base_draw.BASE_DRAW_ROUND == 3
    got, counts = SW.run(auto_structures)
    assert set(got) == set(GOLDEN["digests"])
    bad = sorted(k for k, d in GOLDEN["digests"].items() if got[k] != d)
    assert bad == [], f"{len(bad)} member views moved: {bad[:10]}"
    assert counts == GOLDEN["counts"]


def test_control_round_three_adds_drawings_on_this_sweep_and_only_admins_see_them():
    only3 = carried = 0
    for s in range(SW.SW.SERIES):
        bars = SW.SW.series(s)
        for i in range(SW.FIRST, len(bars), SW.STEP):
            b = bars[:i + 1]
            d2 = base_draw.base_drawing(b, i, draw_round=2)
            d3 = base_draw.base_drawing(b, i)
            row = auto_structures.base_draw_row("SYN", b)
            if d3 is None:
                assert d2 is None and row is None
                continue
            assert row["geometry"]["extras"] == {"draw_base": d3, "draw_round": 3,
                                                 "draw_member": {"round": 2, "draw_base": d2}}
            assert auto_structures.admin_base_rows([row]) == [row]
            if d2 is None:
                only3 += 1
                assert auto_structures.member_rows([row]) == []
            else:
                carried += 1
                assert auto_structures.member_rows([row]) == [auto_structures._base_row("SYN", d2, 2)]
    assert only3 >= 5 and carried >= 50, (only3, carried)


def test_the_carrier_pairs_are_exactly_the_known_ones():
    assert auto_structures._BASE_CARRIERS == frozenset({(1, 2), (1, 3), (2, 3)})
