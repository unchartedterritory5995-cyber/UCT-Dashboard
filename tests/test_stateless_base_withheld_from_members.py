"""The STATELESS bc:base (the judged base with its "Buy point X" label, before any breakout) is WITHHELD from members
(recert A, 2026-10-24: it failed the strict textbook rubric in rounds r1, r2 and r3), while the base STATES that
passed -- breakout / extended (r2) and "Base forming" (r3) -- are still served. One literal withholds it
(MEMBER_BASE_STATELESS_ROUND); the controls prove it is the only thing withholding it."""
import ast
import pathlib

from api.services import auto_structures as AS

SRC = pathlib.Path(AS.__file__)


def _literal(name):
    for node in ast.walk(ast.parse(SRC.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == name for t in node.targets):
            return ast.literal_eval(node.value)
    raise AssertionError("%s is not assigned at module level" % name)


def _row(state=None):
    bd = {"pivot": 12.0, "low": 10.0, "start_t": 20250102, "end_t": 20250210, "label": "pivot",
          "low_label": "base low"}
    if state is not None:
        bd["state"] = state
        bd["state_round"] = {"breakout": AS.MEMBER_BASE_BREAKOUT_ROUND, "extended": AS.MEMBER_BASE_BREAKOUT_ROUND,
                             "forming": AS.MEMBER_BASE_FORMING_ROUND}[state]
    return {"pattern_id": "bc:base", "sym": "ZZZ", "display_tier": "trusted", "start_t": 20250102,
            "end_t": 20250210, "geometry": {"shape": "base_draw", "anchors": [],
                                            "extras": {"draw_base": bd, "draw_round": AS.MEMBER_BASE_ROUND}}}


def test_the_literal_is_None_in_source():
    assert _literal("MEMBER_BASE_STATELESS_ROUND") is None


def test_a_member_gets_no_stateless_base_but_every_passed_state():
    assert AS.member_rows([_row()]) == []
    for st in ("breakout", "extended", "forming"):
        assert [r["geometry"]["extras"]["draw_base"]["state"] for r in AS.member_rows([_row(st)])] == [st], st


def test_the_literal_alone_re_enables_it(monkeypatch):
    """The control: with only the literal set, the same row is served."""
    monkeypatch.setattr(AS, "MEMBER_BASE_STATELESS_ROUND", AS.MEMBER_BASE_ROUND)
    assert [r["pattern_id"] for r in AS.member_rows([_row()])] == ["bc:base"]


def test_the_textbook_gate_leaves_the_stateless_row_to_its_literal(monkeypatch):
    """member_base_textbook_gate never refuses a stateless row (whatever the bars): the literal is what withholds it."""
    monkeypatch.setattr(AS, "_daily_bars", lambda sym: [{"t": 20250210, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}])
    monkeypatch.setattr(AS, "last_bar_forming", lambda t, now=None: False)
    monkeypatch.setattr(AS, "base_textbook_gate_fails", lambda b, r: "always")
    row, st = _row(), _row("forming")
    det, boxes = AS.member_base_textbook_gate("ZZZ", [], [row, st])
    assert boxes == [row]
