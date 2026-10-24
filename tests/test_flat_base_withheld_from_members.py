"""The flat base is WITHHELD from members (recert A, 2026-10-24): neither flat_base (the detector's box + pivot) nor
bc:flat-base (the base catalogue's pivot line) reaches a member, while an admin keeps both. Restoring either is one
literal (MEMBER_FLAT_BASE_ROUND = 1, MEMBER_BC_FLAT_BASE_ROUND = "team"), and the controls below prove that literal is
the only thing withholding them."""
import ast
import pathlib

import pytest

from api.services import auto_structures as AS

SRC = pathlib.Path(AS.__file__)


def _literal(name):
    for node in ast.walk(ast.parse(SRC.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == name for t in node.targets):
            return ast.literal_eval(node.value)
    raise AssertionError("%s is not assigned at module level" % name)


def _flat_base_row():
    return {"pattern_id": "flat_base", "display_tier": "trusted", "start_t": 20250102,
            "geometry": {"shape": "rectangle", "anchors": [{"t": 20250102, "price": 10.0}, {"t": 20250203, "price": 9.0}],
                         "extras": {"draw_round": 1,
                                    "draw_pivot": {"start_t": 20250102, "end_t": 20250203, "price": 10.0}}}}


def _bc_flat_base_row():
    return {"pattern_id": "bc:flat-base", "display_tier": "trusted", "start_t": 20250102,
            "geometry": {"shape": "base_box", "anchors": [{"t": 20250102, "price": 10.0}, {"t": 20250203, "price": 9.0}],
                         "extras": {"draw_box": False,
                                    "draw_pivot": {"start_t": 20250102, "end_t": 20250203, "price": 10.0}}}}


def test_the_two_literals_are_None_in_source():
    assert _literal("MEMBER_FLAT_BASE_ROUND") is None
    assert _literal("MEMBER_BC_FLAT_BASE_ROUND") is None


@pytest.mark.parametrize("row", [_flat_base_row(), _bc_flat_base_row()], ids=["flat_base", "bc:flat-base"])
def test_member_rows_drop_every_flat_base(row):
    assert row["pattern_id"] in AS.member_ids()          # still in the member set: the literal is what withholds it
    assert AS.member_rows([row]) == []


@pytest.mark.parametrize("row,lit,val", [(_flat_base_row(), "MEMBER_FLAT_BASE_ROUND", 1),
                                         (_bc_flat_base_row(), "MEMBER_BC_FLAT_BASE_ROUND", "team")],
                         ids=["flat_base", "bc:flat-base"])
def test_the_one_literal_re_enables_it(monkeypatch, row, lit, val):
    """The control: with only that literal restored the same row is served, so the drop above is the withholding
    and not some other filter."""
    monkeypatch.setattr(AS, lit, val)
    assert [r["pattern_id"] for r in AS.member_rows([row])] == [row["pattern_id"]]

