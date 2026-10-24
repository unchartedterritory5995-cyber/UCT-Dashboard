"""Rectangle setup drawing: the member gate.

The rectangle (setup_draw_rectangle.py) rides the same `setup_draws` layer and the same
AUTO_STRUCTURES_G4_SETUPS_ENABLED flag as the other setup drawings. A member is served it only while ALL of these
hold, each proved load-bearing on its own below: MEMBER_RECTANGLE_ROUND is an int literal equal to
setup_draw_rectangle.RECTANGLE_DRAW_ROUND and to the row's own draw_round stamp; draw:rectangle is in
registry.DISPLAY_MEMBER_SET and the trusted tier; its draw_setup is the rectangle's (finite top above a finite
floor); and its geometry is the judged box (a `rectangle`, exactly 2 finite anchors, the first one the top).
"""
import ast
import copy

import pytest

from api.services import auto_structures as AS
from api.services.pattern_engine import setup_draw_rectangle as M
from api.services.pattern_engine.detectors import registry as REG

from tests.test_setup_draw_rectangle_parity import SERIES

PID = "draw:rectangle"


def _dicts(rows):
    # volume x100 keeps every synthetic chart inside the judged liquidity frame; the rectangle reads no volume
    return [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": float(r[5]) * 100} for r in rows]


def _real_row():
    """A REAL row, built by setup_draw_rows at an as-of bar where the fixture draws the rectangle."""
    for sr in SERIES:
        for asof in sorted(sr["expected"], key=int):
            i = int(asof)
            if i < AS.SETUP_MIN_BARS:
                continue
            rows = [r for r in AS.setup_draw_rows("ZZZ", _dicts(sr["rows"][:i + 1])) if r["pattern_id"] == PID]
            if rows:
                return rows[0], sr, i
    raise AssertionError("the fixture never draws the rectangle through setup_draw_rows")


ROW, _SR, _I = _real_row()


def test_the_row_is_the_judged_box_exactly():
    d = M.detect(_SR["rows"][:_I + 1])
    assert ROW["geometry"]["shape"] == "rectangle"
    assert ROW["geometry"]["anchors"] == d["det"]["geometry"]["anchors"]
    assert ROW["geometry"]["extras"]["draw_round"] == M.RECTANGLE_DRAW_ROUND == 1
    assert ROW["geometry"]["extras"]["draw_setup"] == M.facts(d)
    assert ROW["levels"] == {}                       # the judged drawing is the box alone: no entry line
    assert ROW["id"].startswith(PID + ":ZZZ:")


def test_the_member_round_literal_is_written_in_source():
    """Literal ON PURPOSE (never a reference to RECTANGLE_DRAW_ROUND), so a new round cannot release itself."""
    tree = ast.parse(open(AS.__file__, encoding="utf-8").read())
    lits = [n for n in ast.walk(tree) if isinstance(n, ast.Assign)
            and any(getattr(t, "id", None) == "MEMBER_RECTANGLE_ROUND" for t in n.targets)]
    assert len(lits) == 1 and isinstance(lits[0].value, ast.Constant) and lits[0].value.value == 1
    assert type(lits[0].value.value) is int


def test_the_registry_sets_and_the_id_lists():
    assert PID in REG.DISPLAY_MEMBER_SET and PID in REG.DISPLAY_TEAM_SET and PID in REG.DISPLAY_TRUSTED
    assert REG.display_policy(PID)["display_tier"] == "trusted"
    assert AS.SETUP_DRAW_RECT_IDS == (PID,) and PID in AS.SETUP_DRAW_IDS
    # the experimental `rectangle` DETECTOR row is a different id and stays out of both sets
    assert "rectangle" not in REG.DISPLAY_MEMBER_SET and "rectangle" not in REG.DISPLAY_TEAM_SET


def test_a_real_row_reaches_a_member():
    assert AS.member_rows([ROW]) == [ROW]


def test_a_None_literal_withholds_it(monkeypatch):
    monkeypatch.setattr(AS, "MEMBER_RECTANGLE_ROUND", None)
    assert AS.member_rows([ROW]) == []


def test_a_literal_off_the_frozen_round_withholds_it(monkeypatch):
    monkeypatch.setattr(AS, "MEMBER_RECTANGLE_ROUND", 2)
    assert AS.member_rows([ROW]) == []


def test_a_row_not_in_the_member_set_is_withheld(monkeypatch):
    monkeypatch.setattr(REG, "DISPLAY_MEMBER_SET", frozenset(REG.DISPLAY_MEMBER_SET - {PID}))
    assert AS.member_rows([ROW]) == []


def test_an_untrusted_row_is_withheld():
    assert AS.member_rows([{**ROW, "display_tier": "experimental"}]) == []


@pytest.mark.parametrize("mutate", [
    lambda r: r["geometry"]["extras"].__setitem__("draw_round", 2),
    lambda r: r["geometry"]["extras"].__setitem__("draw_round", "1"),
    lambda r: r["geometry"]["extras"]["draw_setup"].__setitem__("shape", "remount"),
    lambda r: r["geometry"]["extras"]["draw_setup"].__setitem__("draw_round", 2),
    lambda r: r["geometry"]["extras"]["draw_setup"].__setitem__("top", float("nan")),
    lambda r: r["geometry"]["extras"]["draw_setup"].__setitem__("floor", r["geometry"]["extras"]["draw_setup"]["top"]),
    lambda r: r["geometry"]["extras"].pop("draw_setup"),
    lambda r: r["geometry"].__setitem__("shape", "base_box"),
    lambda r: r["geometry"]["anchors"].append(dict(r["geometry"]["anchors"][0])),
    lambda r: r["geometry"]["anchors"][0].__setitem__("price", float("nan")),
    lambda r: r["geometry"]["anchors"][1].__setitem__("t", None),
    lambda r: r["geometry"]["anchors"].reverse(),
], ids=["stamp-2", "stamp-str", "setup-shape", "setup-round", "nan-top", "flat-box", "no-setup", "geom-shape",
        "3-anchors", "nan-anchor", "no-t", "inverted"])
def test_a_malformed_row_is_withheld(mutate):
    r = copy.deepcopy(ROW)
    mutate(r)
    assert AS.member_rows([r]) == []


def test_flag_off_serves_no_setup_row(monkeypatch):
    monkeypatch.delenv("AUTO_STRUCTURES_G4_SETUPS_ENABLED", raising=False)
    assert AS.setup_draws_for("ZZZ") is None and AS.setup_draws_for("ZZZ", member=True) is None


def test_outside_the_judged_frame_there_is_no_rectangle_row():
    thin = [{**b, "v": 1.0} for b in _dicts(_SR["rows"][:_I + 1])]           # dollar volume far under $20M
    assert [r for r in AS.setup_draw_rows("ZZZ", thin) if r["pattern_id"] == PID] == []


def test_a_failing_rectangle_costs_the_rectangle_only(monkeypatch):
    def boom(_b):
        raise RuntimeError("boom")
    monkeypatch.setattr(M, "detect", boom)
    assert [r for r in AS.setup_draw_rows("ZZZ", _dicts(_SR["rows"][:_I + 1])) if r["pattern_id"] == PID] == []
