"""MEMBER PARITY for round 4: members (MEMBER_BASE_ROUND == 2) are served byte-for-byte what round 2 served.

The drawing code moved to round 4 ("textbook consolidation", admin-only until its literal moves). Every bc:base
row is now a round-4 row carrying round 2's drawing of the same bars (extras.draw_member), and member_rows
rebuilds the member row from it.

Two sweeps, both against the code whose drawing round IS round 2:
  * synthetic -- tests/fixtures/base_draw_member_golden_r2.json, written by tools/base_draw_member_golden.py from
    origin/master 22b8d7309d (BASE_DRAW_ROUND == MEMBER_BASE_ROUND == 2): one digest per session / scan of what
    that code served a member (member_rows, then with_metrics member=True, metrics flag on);
  * real bars -- every case of tests/fixtures/base_draw_r4_parity.json.gz (the lab's judged, regression and
    coverage-sample days): the member view, metrics included, is byte-identical to the row the round-2 code
    built (`_base_row(sym, round-2 drawing, 2)`), and is nothing where round 2 draws nothing.

Controls: round 4 must add drawings on the real sweep (so the carrier's "member gets nothing" branch is
exercised) and there the admin must see round 4's row.
"""
import importlib.util
import json
import os

from api.services import auto_structures, base_metrics
from api.services.pattern_engine import base_draw

from tests.test_base_draw_round4 import _bars, cases

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("base_draw_member_sweep_r4",
                                               os.path.join(_HERE, "base_draw_member_sweep.py"))
SW = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(SW)

with open(os.path.join(_HERE, "fixtures", "base_draw_member_golden_r2.json"), encoding="utf-8") as _f:
    GOLDEN = json.load(_f)


def _canon(rows):
    return json.dumps(rows, sort_keys=True, separators=(",", ":"))


def test_the_golden_is_from_round_two_and_is_not_vacuous():
    assert GOLDEN["member_round"] == 2 and GOLDEN["code_sha"] == "22b8d7309d"
    c = GOLDEN["counts"]
    assert c["rows"] == 960 and c["scans"] == 168
    assert c["row_served"] >= 50 and c["scan_served"] >= 10
    assert c["row_metrics"] == c["row_served"]


def test_members_are_served_byte_for_byte_the_round_two_view():
    assert auto_structures.MEMBER_BASE_ROUND == 2 and base_draw.BASE_DRAW_ROUND == 4
    got, counts = SW.run(auto_structures)
    assert set(got) == set(GOLDEN["digests"])
    bad = sorted(k for k, d in GOLDEN["digests"].items() if got[k] != d)
    assert bad == [], f"{len(bad)} member views moved: {bad[:10]}"
    assert counts == GOLDEN["counts"]


def test_on_real_bars_members_get_the_round_two_row_byte_for_byte(monkeypatch):
    monkeypatch.setattr(auto_structures, "last_bar_forming", lambda t, now=None: False)
    drew2 = only4 = 0
    for c in cases():
        b = _bars(c)
        d2 = c["expect"]["round2"]
        d4 = c["expect"]["draw"]
        row = auto_structures.base_draw_row("SYN", b)
        served = base_metrics.with_metrics(auto_structures.member_rows([row] if row else []), b)
        want = base_metrics.with_metrics([auto_structures._base_row("SYN", d2, 2)], b) if d2 else []
        assert _canon(served) == _canon(want), c["id"]
        if d2 is not None:
            drew2 += 1
        elif d4 is not None:
            only4 += 1
            # the admin sees round 4's drawing; the member sees nothing
            assert row["geometry"]["extras"] == {"draw_base": d4, "draw_round": 4,
                                                 "draw_member": {"round": 2, "draw_base": None}}
            assert auto_structures.admin_base_rows([row]) == [row] and served == []
    assert drew2 >= 100 and only4 >= 80, (drew2, only4)


def test_the_carrier_pairs_are_exactly_the_known_ones():
    assert auto_structures._BASE_CARRIERS == frozenset({(1, 2), (1, 4), (2, 4)})
