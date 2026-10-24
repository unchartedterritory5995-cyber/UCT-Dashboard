"""MEMBER PARITY for round 4 (MEMBER_BASE_ROUND == 4) and the ROLLBACK to round 2.

Round 4 passed its own blind check and members now get it. Wherever round 2 draws, round 4 IS round 2's drawing,
so a member is served exactly the row the round-2 code built with one byte moved: the round stamp
(extras.draw_round 2 -> 4), which nothing a member renders reads. Where round 2 draws nothing, a member is now
served round 4's textbook drawing, with the lab's own metrics.

ROLLBACK: with the literal moved back to 2 (in memory here), every bc:base row is a round-4 row carrying round
2's drawing (extras.draw_member) and a member is served byte-for-byte what round 2 served, on both sweeps:

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

import pytest

from api.services import auto_structures, base_metrics
from api.services.pattern_engine import base_draw

from tests.test_base_draw_round4 import _bars, cases, expect


@pytest.fixture(autouse=True)
def stateless_base_released(monkeypatch):
    """The STATELESS bc:base is WITHHELD from members since 2026-10-24 (recert A: MEMBER_BASE_STATELESS_ROUND is
    None). This module tests the mechanism a released stateless base runs through, so it re-enables the literal in
    memory; tests/test_stateless_base_withheld_from_members.py rails the withholding."""
    from api.services import auto_structures as _as
    monkeypatch.setattr(_as, "MEMBER_BASE_STATELESS_ROUND", 5)

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("base_draw_member_sweep_r4",
                                               os.path.join(_HERE, "base_draw_member_sweep.py"))
SW = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(SW)

with open(os.path.join(_HERE, "fixtures", "base_draw_member_golden_r2.json"), encoding="utf-8") as _f:
    GOLDEN = json.load(_f)


def _canon(rows):
    return json.dumps(rows, sort_keys=True, separators=(",", ":"))


@pytest.fixture
def round_two_members(monkeypatch):
    """The rollback state: the member literal moved back to 2, in memory only."""
    monkeypatch.setattr(auto_structures, "MEMBER_BASE_ROUND", 2)


@pytest.fixture
def round_four_members(monkeypatch):
    """The rollback state from round 5: the member literal moved back to 4, in memory only."""
    monkeypatch.setattr(auto_structures, "MEMBER_BASE_ROUND", 4)


@pytest.fixture
def complete_sessions(monkeypatch):
    monkeypatch.setattr(auto_structures, "last_bar_forming", lambda t, now=None: False)


def test_the_golden_is_from_round_two_and_is_not_vacuous():
    assert GOLDEN["member_round"] == 2 and GOLDEN["code_sha"] == "22b8d7309d"
    c = GOLDEN["counts"]
    assert c["rows"] == 960 and c["scans"] == 168
    assert c["row_served"] >= 50 and c["scan_served"] >= 10
    assert c["row_metrics"] == c["row_served"]


def test_a_rollback_to_round_two_serves_byte_for_byte_the_round_two_view(round_two_members):
    assert auto_structures.MEMBER_BASE_ROUND == 2 and base_draw.BASE_DRAW_ROUND == 5
    got, counts = SW.run(auto_structures)
    assert set(got) == set(GOLDEN["digests"])
    bad = sorted(k for k, d in GOLDEN["digests"].items() if got[k] != d)
    assert bad == [], f"{len(bad)} member views moved: {bad[:10]}"
    assert counts == GOLDEN["counts"]


def test_on_real_bars_a_rollback_to_round_two_serves_the_round_two_row_byte_for_byte(round_two_members,
                                                                                    complete_sessions):
    drew2 = only4 = 0
    for c in cases():
        b = _bars(c)
        d2 = expect(c)["round2"]
        d4 = expect(c)["draw"]
        row = auto_structures.base_draw_row("SYN", b)
        served = base_metrics.with_metrics(auto_structures.member_rows([row] if row else []), b)
        want = base_metrics.with_metrics([auto_structures._base_row("SYN", d2, 2)], b) if d2 else []
        assert _canon(served) == _canon(want), c["id"]
        if d2 is not None:
            drew2 += 1
        elif d4 is not None:
            only4 += 1
            # the admin sees round 5's drawing (round 4's, unless the floor refuses it); the member sees nothing
            if base_draw.floor_refuses(b, len(b) - 1, d4):
                assert row is None and served == [], c["id"]
                continue
            assert row["geometry"]["extras"] == {"draw_base": d4, "draw_round": 5,
                                                 "draw_member": {"round": 2, "draw_base": None}}
            assert auto_structures.admin_base_rows([row]) == [row] and served == []
    assert drew2 >= 100 and only4 >= 80, (drew2, only4)


def test_on_real_bars_members_get_round_two_wherever_it_draws_and_round_four_where_it_does_not(
        round_four_members, complete_sessions):
    """At literal 4 (a rollback from round 5, carried by the round-5 rows). Wherever round 2 draws, the member
    view (metrics included) is the round-2 code's row with ONLY the round stamp moved (2 -> 4); where only round 4
    draws, it is round 4's drawing with the lab's own metrics; where neither draws, nothing."""
    assert auto_structures.MEMBER_BASE_ROUND == 4 and base_draw.BASE_DRAW_ROUND == 5
    same = new = none = 0
    for c in cases():
        b = _bars(c)
        d2, d4 = expect(c)["round2"], expect(c)["draw"]
        row = auto_structures.base_draw_row("SYN", b)
        served = base_metrics.with_metrics(auto_structures.member_rows([row] if row else []), b)
        if d2 is not None:
            was = base_metrics.with_metrics([auto_structures._base_row("SYN", d2, 2)], b)
            assert len(served) == 1 and served[0]["geometry"]["extras"]["draw_round"] == 4, c["id"]
            moved = json.loads(_canon(served))
            moved[0]["geometry"]["extras"]["draw_round"] = 2
            assert _canon(moved) == _canon(was), c["id"]                 # byte-for-byte but the stamp
            assert _canon(served) != _canon(was)                           # control: the stamp IS seen
            same += 1
        elif d4 is not None:
            assert len(served) == 1, c["id"]
            ex = served[0]["geometry"]["extras"]
            assert ex["draw_base"] == d4 and ex["draw_round"] == 4 and ex["metrics"] == expect(c)["metrics"]
            new += 1
        else:
            # where no base is drawn, the only row is a base STATE (base_draw.state_drawing), and a member gets
            # one only for a state whose member literal is live (tests/test_base_draw_states.py)
            st = row["geometry"]["extras"]["draw_base"].get("state") if row else None
            assert row is None or st in base_draw.STATES, c["id"]
            live = {s for s, r in (("breakout", auto_structures.MEMBER_BASE_BREAKOUT_ROUND),
                                   ("extended", auto_structures.MEMBER_BASE_BREAKOUT_ROUND),
                                   ("forming", auto_structures.MEMBER_BASE_FORMING_ROUND),
                                   ("tight", auto_structures.MEMBER_BASE_TIGHT_ROUND)) if r is not None}
            assert served == [] or (st in live and len(served) == 1), c["id"]
            none += 1
    assert same >= 100 and new >= 80 and none >= 100, (same, new, none)


def test_nothing_a_member_renders_reads_the_round_stamp():
    """The one byte the switch moves on a day round 2 draws is extras.draw_round: the chart overlay never reads
    it for a base, and the metrics never read it."""
    import pathlib
    root = pathlib.Path(_HERE).parent
    overlay = (root / "app" / "src" / "components" / "chart" / "PatternOverlay.jsx").read_text(encoding="utf-8")
    assert "draw_base" in overlay                                     # control: the overlay draws bases
    assert all("draw_base" not in ln for ln in overlay.splitlines() if "draw_round" in ln)
    src = (root / "api" / "services" / "base_metrics.py").read_text(encoding="utf-8")
    assert "draw_base" in src and "draw_round" not in src


def test_the_carrier_pairs_are_exactly_the_known_ones():
    assert auto_structures._BASE_CARRIERS == frozenset({(1, 2), (1, 4), (2, 4), (1, 5), (2, 5), (4, 5)})
