"""MEMBER PARITY: while MEMBER_BASE_ROUND is 1, a member is served byte-for-byte what round 1 served.

The drawing code moved to round 2 (lab base_draw_v2: the pivot on the base's highest body, no base straight
after a parabolic run). Round 2 has NOT passed its blind check, so members must keep the confirmed round-1
drawing until the literal auth_structures.MEMBER_BASE_ROUND is moved by hand.

tests/fixtures/base_draw_member_golden.json was written by tools/base_draw_member_golden.py from the
pre-round-2 code (origin/master 0a6d21b7b9, where base_draw.BASE_DRAW_ROUND == MEMBER_BASE_ROUND == 1): one
digest per session / scan of what that code served a member (member_rows, then with_metrics member=True,
metrics flag on). Here the same synthetic sweep runs on the code under test and every digest must match.

Controls: the sweep must serve members a base, must contain sessions where round 2 draws DIFFERENTLY from
round 1 (so the carrier is exercised, not bypassed), and the admin view must differ from the member view
exactly there.
"""
import importlib.util
import json
import os

from api.services import auto_structures
from api.services.pattern_engine import base_draw

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("base_draw_member_sweep",
                                               os.path.join(_HERE, "base_draw_member_sweep.py"))
SW = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(SW)

with open(os.path.join(_HERE, "fixtures", "base_draw_member_golden.json"), encoding="utf-8") as _f:
    GOLDEN = json.load(_f)


def test_the_golden_is_from_the_member_round_and_is_not_vacuous():
    assert GOLDEN["member_round"] == 1 == auto_structures.MEMBER_BASE_ROUND
    c = GOLDEN["counts"]
    assert c["rows"] == 960 and c["scans"] == 168
    assert c["row_served"] >= 50 and c["scan_served"] >= 10
    assert c["row_metrics"] == c["row_served"]          # members saw metrics on every served base


def test_members_are_served_byte_for_byte_the_confirmed_round():
    got, counts = SW.run(auto_structures)
    assert set(got) == set(GOLDEN["digests"])
    bad = sorted(k for k, d in GOLDEN["digests"].items() if got[k] != d)
    assert bad == [], f"{len(bad)} member views moved: {bad[:10]}"
    assert counts == GOLDEN["counts"]


def test_control_round_two_draws_differently_on_this_sweep():
    """Without sessions where the rounds differ, the parity above would prove nothing about the carrier."""
    differ = only_r1 = only_r2 = 0
    for s in range(SW.SW.SERIES):
        bars = SW.SW.series(s)
        for i in range(SW.FIRST, len(bars), SW.STEP):
            a = base_draw.base_drawing(bars[:i + 1], i, draw_round=1)
            b = base_draw.base_drawing(bars[:i + 1], i)
            differ += a is not None and b is not None and a != b
            only_r1 += a is not None and b is None
            only_r2 += a is None and b is not None
    assert differ >= 5 and only_r1 >= 1 and only_r2 >= 1, (differ, only_r1, only_r2)


def test_control_the_admin_view_is_round_two():
    """The admin structures carry the CURRENT round: where round 2 draws, the admin row is round 2's drawing;
    where only round 1 draws, the admin gets no bc:base row at all."""
    seen_r2 = seen_hidden = 0
    for s in range(SW.SW.SERIES):
        bars = SW.SW.series(s)
        for i in range(SW.FIRST, len(bars), SW.STEP):
            b = bars[:i + 1]
            row = auto_structures.base_draw_row("SYN", b)
            d2 = base_draw.base_drawing(b, i)
            d1 = base_draw.base_drawing(b, i, draw_round=1)
            admin = auto_structures.admin_base_rows([row] if row else [])
            if d2 is not None:
                assert admin and admin[0]["geometry"]["extras"]["draw_base"] == d2
                assert admin[0]["geometry"]["extras"]["draw_round"] == 2
                seen_r2 += 1
            else:
                assert admin == []
                seen_hidden += d1 is not None
    assert seen_r2 >= 50 and seen_hidden >= 1
