"""Round-3 setup drawings: the member gate.

Sixteen setups (setup_draw_r3.py) ride the same `setup_draws` layer and the same AUTO_STRUCTURES_G4_SETUPS_ENABLED flag
as rounds 1 and 2. A member is served a round-3 row only while ALL of these hold, each proved load-bearing on its
own below: its MEMBER_<SETUP>_ROUND literal is an int equal to setup_draw_r3.R3_DRAW_ROUND and to the row's own
draw_round stamp; its id is in registry.DISPLAY_MEMBER_SET; its draw_setup names its own judged shape; its geometry is
its judged shape with the judged anchor count at finite prices; and (the major trendline only) its geometry carries
the single_trendline subtype, without which the overlay draws nothing.
"""
import ast
import copy
import json
import os

import pytest

from api.services import auto_structures as AS
from api.services.pattern_engine import setup_draw_r3 as M
from api.services.pattern_engine.detectors import registry as REG

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "setup_draw_r3_parity.json")
R3_IDS = {
    "draw:outside-bar", "draw:descending-triangle", "draw:inverse-head-shoulders", "draw:bear-flag",
    "draw:bollinger-squeeze", "draw:major-trendline", "draw:rsi-bearish-divergence", "draw:symmetrical-triangle",
    "draw:rising-wedge", "draw:avwap-reclaim", "draw:nr7", "draw:head-shoulders", "draw:triple-top",
    "draw:triple-bottom", "draw:wyckoff-spring", "draw:ascending-triangle",
}
LITERALS = {
    "MEMBER_OUTSIDE_BAR_ROUND": "draw:outside-bar",
    "MEMBER_DESCENDING_TRIANGLE_ROUND": "draw:descending-triangle",
    "MEMBER_INVERSE_HEAD_SHOULDERS_ROUND": "draw:inverse-head-shoulders",
    "MEMBER_BEAR_FLAG_ROUND": "draw:bear-flag",
    "MEMBER_BOLLINGER_SQUEEZE_ROUND": "draw:bollinger-squeeze",
    "MEMBER_MAJOR_TRENDLINES_ROUND": "draw:major-trendline",
    "MEMBER_RSI_BEARISH_DIVERGENCE_ROUND": "draw:rsi-bearish-divergence",
    "MEMBER_SYMMETRICAL_TRIANGLE_ROUND": "draw:symmetrical-triangle",
    "MEMBER_RISING_WEDGE_ROUND": "draw:rising-wedge",
    "MEMBER_AVWAP_RECLAIM_ROUND": "draw:avwap-reclaim",
    "MEMBER_NR7_ROUND": "draw:nr7",
    "MEMBER_HEAD_SHOULDERS_ROUND": "draw:head-shoulders",
    "MEMBER_TRIPLE_TOP_ROUND": "draw:triple-top",
    "MEMBER_TRIPLE_BOTTOM_ROUND": "draw:triple-bottom",
    "MEMBER_WYCKOFF_SPRING_ROUND": "draw:wyckoff-spring",
    "MEMBER_ASCENDING_TRIANGLE_ROUND": "draw:ascending-triangle",
}


def _series():
    with open(FIXTURE, encoding="utf-8") as fh:
        return json.load(fh)["series"]


def _dicts(rows):
    # volume x100 keeps every synthetic chart inside the judged liquidity frame; a constant volume scale changes no
    # volume ratio, and none of the six detectors reads raw volume
    return [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": float(r[5]) * 100} for r in rows]


def _real_rows():
    """One REAL row per round-3 setup, built by setup_draw_rows at an as-of bar where the fixture draws it."""
    out = {}
    for sr in _series():
        for asof, setups in sorted(sr["expected"].items(), key=lambda kv: int(kv[0])):
            i = int(asof)
            if i < AS.SETUP_MIN_BARS or not (set(setups) & {m[0] for m in AS._SETUP_DRAW_R3_FUNCS}):
                continue
            for r in AS.setup_draw_rows("ZZZ", _dicts(sr["rows"][:i + 1])):
                if r["pattern_id"] in R3_IDS and r["pattern_id"] not in out:
                    out[r["pattern_id"]] = r
    return out


ROWS = _real_rows()


def test_the_fixture_yields_a_real_row_for_every_setup():
    assert set(ROWS) == R3_IDS


def test_the_member_round_literals_are_written_in_source():
    """Literals ON PURPOSE (never a reference to setup_draw_r3.R3_DRAW_ROUND), so a new round cannot release itself."""
    tree = ast.parse(open(AS.__file__, encoding="utf-8").read())
    for name in LITERALS:
        lits = [n for n in ast.walk(tree) if isinstance(n, ast.Assign)
                and any(getattr(t, "id", None) == name for t in n.targets)]
        assert len(lits) == 1 and isinstance(lits[0].value, ast.Constant) and lits[0].value.value == 3, name
    assert M.R3_DRAW_ROUND == 3


def test_the_ids_are_one_list():
    assert set(AS.SETUP_DRAW_R3_IDS) == R3_IDS and set(AS.SETUP_DRAW_R3_IDS) <= set(AS.SETUP_DRAW_IDS)
    assert {k for k, *_ in AS._SETUP_DRAW_R3_FUNCS} == set(M.SETUPS)


def test_the_registry_sets():
    for pid in R3_IDS:
        assert pid in REG.DISPLAY_MEMBER_SET and pid in REG.DISPLAY_TEAM_SET and pid in REG.DISPLAY_TRUSTED
        assert REG.display_policy(pid)["display_tier"] == "trusted"


@pytest.mark.parametrize("pid", sorted(R3_IDS))
def test_a_real_row_reaches_a_member(pid):
    assert AS.member_rows([ROWS[pid]]) == [ROWS[pid]]


@pytest.mark.parametrize("name", sorted(LITERALS))
def test_a_None_literal_withholds_that_setup_only(monkeypatch, name):
    monkeypatch.setattr(AS, name, None)
    pid = LITERALS[name]
    served = {r["pattern_id"] for r in AS.member_rows(list(ROWS.values()))}
    assert pid not in served and served == R3_IDS - {pid}


@pytest.mark.parametrize("pid", sorted(R3_IDS))
def test_a_row_not_in_the_member_set_is_withheld(monkeypatch, pid):
    monkeypatch.setattr(REG, "DISPLAY_MEMBER_SET", frozenset(REG.DISPLAY_MEMBER_SET - {pid}))
    monkeypatch.setattr(AS, "member_ids", lambda: REG.DISPLAY_MEMBER_SET, raising=False)
    assert AS.member_rows([ROWS[pid]]) == []


@pytest.mark.parametrize("pid", sorted(R3_IDS))
def test_a_wrong_stamp_is_withheld(pid):
    r = copy.deepcopy(ROWS[pid])
    r["geometry"]["extras"]["draw_round"] = 2
    assert AS.member_rows([r]) == []


@pytest.mark.parametrize("pid", sorted(R3_IDS))
def test_a_draw_setup_of_another_shape_is_withheld(pid):
    r = copy.deepcopy(ROWS[pid])
    r["geometry"]["extras"]["draw_setup"]["shape"] = "remount"
    assert AS.member_rows([r]) == []


@pytest.mark.parametrize("pid", sorted(R3_IDS))
def test_a_wrong_geometry_shape_is_withheld(pid):
    r = copy.deepcopy(ROWS[pid])
    r["geometry"]["shape"] = "base_box"
    assert AS.member_rows([r]) == []


@pytest.mark.parametrize("pid", sorted(R3_IDS))
def test_a_wrong_anchor_count_is_withheld(pid):
    r = copy.deepcopy(ROWS[pid])
    r["geometry"]["anchors"] = r["geometry"]["anchors"][:-1]
    assert AS.member_rows([r]) == []


@pytest.mark.parametrize("pid", sorted(R3_IDS))
def test_a_non_finite_anchor_is_withheld(pid):
    r = copy.deepcopy(ROWS[pid])
    r["geometry"]["anchors"][0]["price"] = float("nan")
    assert AS.member_rows([r]) == []


def test_the_major_trendline_is_one_straight_line():
    g = ROWS["draw:major-trendline"]["geometry"]
    assert g["semantic_subtype"] == "single_trendline" and len(g["anchors"]) == 2
    assert g["extras"]["line_spaces"] == ["lin"]


def test_the_major_trendline_without_its_subtype_is_withheld():
    r = copy.deepcopy(ROWS["draw:major-trendline"])
    del r["geometry"]["semantic_subtype"]
    assert AS.member_rows([r]) == []


def test_only_the_single_line_carries_a_subtype():
    """The subtype is carried for single_trendline ONLY: the released round-2 lane rows must not change shape."""
    for pid, r in ROWS.items():
        assert ("semantic_subtype" in r["geometry"]) == (pid == "draw:major-trendline"), pid


def test_the_bear_flag_row_carries_its_pole():
    ex = ROWS["draw:bear-flag"]["geometry"]["extras"]
    assert len(ex["draw_pole"]) == 2 and ex["line_spaces"] == ["log", "log"]


def test_the_inverse_head_and_shoulders_is_a_five_point_neckline():
    a = ROWS["draw:inverse-head-shoulders"]["geometry"]["anchors"]
    assert len(a) == 5
    assert a[2]["price"] < min(a[0]["price"], a[4]["price"])      # the head is the deepest low


def test_flag_off_serves_no_round_3_row(monkeypatch):
    monkeypatch.delenv("AUTO_STRUCTURES_G4_SETUPS_ENABLED", raising=False)
    assert AS.setup_draws_for("ZZZ") is None and AS.setup_draws_for("ZZZ", member=True) is None


def test_the_bearish_divergence_carries_its_rsi_panel():
    pn = ROWS["draw:rsi-bearish-divergence"]["geometry"]["extras"]["draw_panel"]
    assert pn["kind"] == "rsi14" and len(pn["points"]) >= 2 and pn["p2"]["value"] < pn["p1"]["value"]


def test_the_bearish_divergence_without_its_panel_is_withheld():
    r = copy.deepcopy(ROWS["draw:rsi-bearish-divergence"])
    del r["geometry"]["extras"]["draw_panel"]
    assert AS.member_rows([r]) == []


def test_the_avwap_reclaim_is_its_curve_labelled_avwap():
    em = ROWS["draw:avwap-reclaim"]["geometry"]["extras"]["draw_ema"]
    assert em["kind"] == "avwap" and "period" not in em and len(em["points"]) >= 2


def test_the_avwap_reclaim_without_its_curve_is_withheld():
    r = copy.deepcopy(ROWS["draw:avwap-reclaim"])
    r["geometry"]["extras"]["draw_ema"]["points"] = r["geometry"]["extras"]["draw_ema"]["points"][:1]
    assert AS.member_rows([r]) == []


def test_the_converging_pairs_are_two_lines():
    for pid in ("draw:symmetrical-triangle", "draw:rising-wedge"):
        g = ROWS[pid]["geometry"]
        assert len(g["anchors"]) == 4 and g["extras"]["line_spaces"] and "semantic_subtype" not in g


def test_the_ascending_triangle_is_two_lines_with_its_touches_and_no_lane():
    r = ROWS["draw:ascending-triangle"]
    ex = r["geometry"]["extras"]
    assert ex["draw_lanes"] is False and len(ex["draw_touches"]) >= 5
    assert r["geometry"]["anchors"][0]["price"] == r["geometry"]["anchors"][1]["price"]     # the flat buy-point line
    assert r["pattern_name"].startswith("Ascending triangle · Buy point ")


def test_the_ascending_triangle_with_a_lane_or_without_touches_is_withheld():
    for mut in ("lanes", "touches"):
        r = copy.deepcopy(ROWS["draw:ascending-triangle"])
        if mut == "lanes":
            r["geometry"]["extras"]["draw_lanes"] = True
        else:
            r["geometry"]["extras"]["draw_touches"] = []
        assert AS.member_rows([r]) == [], mut
