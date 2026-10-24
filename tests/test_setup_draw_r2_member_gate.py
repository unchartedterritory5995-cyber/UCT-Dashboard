"""Round-2 setup drawings: the member gate.

Six setups (setup_draw_r2.py) ride the same `setup_draws` layer and the same AUTO_STRUCTURES_G4_SETUPS_ENABLED flag
as remount / u_and_r. A member is served a round-2 row only while ALL of these hold, each proved load-bearing on its
own below: its MEMBER_<SETUP>_ROUND literal is an int equal to setup_draw_r2.R2_DRAW_ROUND and to the row's own
draw_round stamp; its id is in registry.DISPLAY_MEMBER_SET; its draw_setup names its own judged shape; its geometry is
its judged shape with the judged anchor count at finite prices; and (the divergence only) its RSI(14) panel is
well-formed, because the judged picture had one.
"""
import ast
import copy
import json
import os

import pytest

from api.services import auto_structures as AS
from api.services.pattern_engine import setup_draw_r2 as M
from api.services.pattern_engine.detectors import registry as REG

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "setup_draw_r2_parity.json")
R2_IDS = {
    "draw:rsi-bullish-divergence", "draw:wyckoff-upthrust", "draw:channel", "draw:pennant", "draw:darvas-box",
    "draw:falling-wedge", "draw:double-top", "draw:golden-cross", "draw:death-cross",
}
LITERALS = {
    "MEMBER_RSI_BULLISH_DIVERGENCE_ROUND": "draw:rsi-bullish-divergence",
    "MEMBER_WYCKOFF_UPTHRUST_ROUND": "draw:wyckoff-upthrust",
    "MEMBER_CHANNEL_ROUND": "draw:channel",
    "MEMBER_PENNANT_ROUND": "draw:pennant",
    "MEMBER_DARVAS_BOX_ROUND": "draw:darvas-box",
    "MEMBER_FALLING_WEDGE_ROUND": "draw:falling-wedge",
    "MEMBER_DOUBLE_TOP_ROUND": "draw:double-top",
    "MEMBER_GOLDEN_CROSS_ROUND": "draw:golden-cross",
    "MEMBER_DEATH_CROSS_ROUND": "draw:death-cross",
}


def _series():
    with open(FIXTURE, encoding="utf-8") as fh:
        return json.load(fh)["series"]


def _dicts(rows):
    # volume x100 keeps every synthetic chart inside the judged liquidity frame; a constant volume scale changes no
    # volume ratio, and none of the six detectors reads raw volume anyway
    return [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": float(r[5]) * 100} for r in rows]


def _real_rows():
    """One REAL row per round-2 setup, built by setup_draw_rows at an as-of bar where the fixture draws it."""
    out = {}
    for sr in _series():
        for asof, setups in sorted(sr["expected"].items(), key=lambda kv: int(kv[0])):
            i = int(asof)
            if i < AS.SETUP_MIN_BARS:
                continue
            for r in AS.setup_draw_rows("ZZZ", _dicts(sr["rows"][:i + 1])):
                if r["pattern_id"] in R2_IDS and r["pattern_id"] not in out:
                    out[r["pattern_id"]] = r
    return out


ROWS = _real_rows()


def test_the_fixture_yields_a_real_row_for_every_setup():
    assert set(ROWS) == R2_IDS


def test_the_member_round_literals_are_written_in_source():
    """Literals ON PURPOSE (never a reference to setup_draw_r2.R2_DRAW_ROUND), so a new round cannot release itself."""
    tree = ast.parse(open(AS.__file__, encoding="utf-8").read())
    for name in LITERALS:
        lits = [n for n in ast.walk(tree) if isinstance(n, ast.Assign)
                and any(getattr(t, "id", None) == name for t in n.targets)]
        assert len(lits) == 1 and isinstance(lits[0].value, ast.Constant) and lits[0].value.value == 2, name
    assert M.R2_DRAW_ROUND == 2


def test_the_registry_sets():
    for pid in R2_IDS:
        assert pid in REG.DISPLAY_MEMBER_SET and pid in REG.DISPLAY_TEAM_SET and pid in REG.DISPLAY_TRUSTED
        assert REG.display_policy(pid)["display_tier"] == "trusted"


@pytest.mark.parametrize("pid", sorted(R2_IDS))
def test_a_real_row_reaches_a_member(pid):
    assert AS.member_rows([ROWS[pid]]) == [ROWS[pid]]


@pytest.mark.parametrize("name", sorted(LITERALS))
def test_a_None_literal_withholds_that_setup_only(monkeypatch, name):
    monkeypatch.setattr(AS, name, None)
    pid = LITERALS[name]
    served = {r["pattern_id"] for r in AS.member_rows(list(ROWS.values()))}
    assert pid not in served and served == R2_IDS - {pid}


@pytest.mark.parametrize("pid", sorted(R2_IDS))
def test_a_row_not_in_the_member_set_is_withheld(monkeypatch, pid):
    monkeypatch.setattr(REG, "DISPLAY_MEMBER_SET", frozenset(REG.DISPLAY_MEMBER_SET - {pid}))
    monkeypatch.setattr(AS, "member_ids", lambda: REG.DISPLAY_MEMBER_SET, raising=False)
    assert AS.member_rows([ROWS[pid]]) == []


@pytest.mark.parametrize("pid", sorted(R2_IDS))
def test_a_wrong_stamp_is_withheld(pid):
    r = copy.deepcopy(ROWS[pid])
    r["geometry"]["extras"]["draw_round"] = 3
    assert AS.member_rows([r]) == []


@pytest.mark.parametrize("pid", sorted(R2_IDS))
def test_a_draw_setup_of_another_shape_is_withheld(pid):
    r = copy.deepcopy(ROWS[pid])
    r["geometry"]["extras"]["draw_setup"]["shape"] = "remount"
    assert AS.member_rows([r]) == []


@pytest.mark.parametrize("pid", sorted(R2_IDS))
def test_a_wrong_geometry_shape_is_withheld(pid):
    r = copy.deepcopy(ROWS[pid])
    r["geometry"]["shape"] = "base_box"
    assert AS.member_rows([r]) == []


@pytest.mark.parametrize("pid", sorted(R2_IDS))
def test_a_non_finite_anchor_is_withheld(pid):
    r = copy.deepcopy(ROWS[pid])
    r["geometry"]["anchors"][0]["price"] = float("nan")
    assert AS.member_rows([r]) == []


def test_the_divergence_without_its_rsi_panel_is_withheld():
    r = copy.deepcopy(ROWS["draw:rsi-bullish-divergence"])
    assert r["geometry"]["extras"]["draw_panel"]["kind"] == "rsi14"
    del r["geometry"]["extras"]["draw_panel"]
    assert AS.member_rows([r]) == []


def test_the_divergence_panel_carries_the_two_judged_points():
    pn = ROWS["draw:rsi-bullish-divergence"]["geometry"]["extras"]["draw_panel"]
    a = ROWS["draw:rsi-bullish-divergence"]["geometry"]["anchors"]
    assert pn["p1"]["t"] == a[0]["t"] and pn["p2"]["t"] == a[1]["t"]
    assert pn["p2"]["value"] > pn["p1"]["value"]          # RSI higher low, as judged
    assert a[1]["price"] < a[0]["price"]                  # price lower low
    assert len(pn["points"]) <= AS.SETUP_RSI_PANEL_BARS and pn["guides"] == [70, 30]


def test_the_pennant_row_carries_its_pole():
    ex = ROWS["draw:pennant"]["geometry"]["extras"]
    assert len(ex["draw_pole"]) == 2 and ex["line_spaces"] == ["log", "log"]


def test_flag_off_serves_no_round_2_row(monkeypatch):
    monkeypatch.delenv("AUTO_STRUCTURES_G4_SETUPS_ENABLED", raising=False)
    assert AS.setup_draws_for("ZZZ") is None and AS.setup_draws_for("ZZZ", member=True) is None


@pytest.mark.parametrize("pid", ["draw:golden-cross", "draw:death-cross"])
def test_a_cross_draws_both_averages_as_curves(pid):
    for sr in _series():
        for asof in sorted(sr["expected"], key=int):
            i = int(asof)
            if i < AS.SETUP_MIN_BARS:
                continue
            rows = [r for r in AS.setup_draw_rows("ZZZ", _dicts(sr["rows"][:i + 1])) if r["pattern_id"] == pid]
            if rows:
                assert [r["geometry"]["extras"]["draw_ema"]["period"] for r in rows] == [50, 200]
                assert len({r["id"] for r in rows}) == 2            # two rows, two ids
                assert all(len(r["geometry"]["extras"]["draw_ema"]["points"]) >= 2 for r in rows)
                assert AS.member_rows(rows) == rows
                return
    raise AssertionError("the fixture never draws " + pid)


@pytest.mark.parametrize("pid", ["draw:golden-cross", "draw:death-cross"])
def test_a_cross_row_without_its_curve_is_withheld(pid):
    r = copy.deepcopy(ROWS[pid])
    del r["geometry"]["extras"]["draw_ema"]
    assert AS.member_rows([r]) == []
