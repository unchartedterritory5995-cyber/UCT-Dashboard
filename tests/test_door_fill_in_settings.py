"""A SETTING THE MEMBER MUST FILL IN DRAWS NOTHING UNTIL IT IS FILLED.

Found by the first full live run of the value cases, as a member (2026-11-22). Asked to "plot the number of shares I
own and my average cost", the door built two settings for the member to fill in and said it cannot know the holdings
(right: only the account is unreachable, the member has the two numbers). But it drew the average cost as the BARE
setting: until the member fills it in that is a line at price 0, and the price chart is squeezed to fit it.

Three things:
  * THE DOOR: one instruction sentence, and a guard on a visible price-pane output that is nothing but a setting whose
    default is 0. Measured before it was written over the 202 recorded answers that change something: ONE declares
    settings (this one), and it is the one refused;
  * THE SCRIPT DOCUMENT says the same in Pine's words (rule 14);
  * THE VALUE CASES could not hold a case with settings at all: the grader read a setting's name as `name` and the door
    writes `key`. Fixed first, and a rule can now be ABOUT settings (`__fill_in__`): a setting for each figure, none
    invented, nothing drawn until filled, each figure shown on every bar once filled; and a case may hold what the
    member is told (`says`). `wall-18` moves from the wall lane to the build lane by it (corrected on review: the words
    ask for the member's own numbers, not an account read), recorded WRONG; a sibling that truly needs the account
    waits in `pending`.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from api.services import definition_conversation as dc
from api.services import pine_authoring as pa
from tests.test_p2_truth_server import conv, emits, empty_view, env, model  # noqa: F401 -- fixtures by name
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name
from tools import value_eval
from tools.value_cases import grade as G

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "tests" / "fixtures" / "authoring" / "value_cases.json").read_text(encoding="utf-8"))
CASES = DATA["cases"]
CASE = next(c for c in CASES if c["id"] == "wall-18")
WORDS = CASE["words"]
#: the build a member was given live (a line at price 0 until filled): the case's FIRST wrong answer
LIVE = G.specimens(CASE)[0]["answer"]
#: the SECOND: after the first fix the build was right and the reply never said the door cannot read the holdings
SILENT = G.specimens(CASE)[1]["answer"]
CHART = {"sym": "NVDA", "tf": "D"}
ZERO_OVER_ZERO = {"type": "op", "name": "/", "args": [{"type": "num", "value": 0}, {"type": "num", "value": 0}]}


def setting(key):
    return {"type": "series", "name": key}


def when_filled(key):
    """`key > 0 ? key : 0 / 0`: nothing until the member fills it in."""
    return {"type": "op", "name": "?:", "args": [{"type": "op", "name": ">", "args": [setting(key), {"type": "num", "value": 0}]}, setting(key), ZERO_OVER_ZERO]}


def position(avg_tree, shares_tree, *, placement="price", defaults=(0, 0), hidden=(False, True)):
    return {"op": "create", "name": "My Position", "placement": placement,
            "inputs": [{"key": "shares", "label": "Shares owned", "default": defaults[0]}, {"key": "avgPrice", "label": "Average cost", "default": defaults[1]}],
            "outputs": [{"key": "avgCost", "tree": avg_tree, **({"hidden": True} if hidden[0] else {})},
                        {"key": "sharesOwned", "tree": shares_tree, **({"hidden": True} if hidden[1] else {})}]}


FILLED = position(when_filled("avgPrice"), when_filled("shares"))
REPLY = "I can't read your account, so enter your shares and average cost in the indicator's settings."


def refused_by(fn, *args):
    try:
        fn(*args)
    except dc._Refused as exc:
        return exc
    return None


# ── the door's guard ──

def test_THE_FINDING_a_setting_drawn_bare_on_the_price_chart_is_refused():
    exc = refused_by(dc._refuse_a_bare_fill_in_setting, {"ops": LIVE["ops"]})
    assert exc is not None and exc.gate == "envelope:reference"
    told = exc.for_model()
    for piece in ("draws the setting `avgPrice` bare on the price chart", "a line at price 0, and the chart is squeezed to fit it",
                  "`avgPrice > 0 ? avgPrice : 0 / 0`"):
        assert piece in told, piece
    assert refused_by(dc.check_envelope, {**env(0, copy.deepcopy(LIVE["ops"])), "reply": REPLY}, 0) is not None      # and at the whole check


@pytest.mark.parametrize("op,why", [
    (FILLED, "it says when to draw: nothing until filled"),
    (position(setting("avgPrice"), setting("shares"), defaults=(0, 100)), "a real default is a level the member asked for (a line at 100)"),
    (position(setting("avgPrice"), setting("shares"), placement="pane"), "under the chart a line at zero is a line at zero"),
    (position(setting("avgPrice"), setting("shares"), hidden=(True, True)), "a hidden output is not drawn"),
    (position({"type": "num", "value": 100}, when_filled("shares")), "a plain number is a level, not a setting"),
    (position({"type": "op", "name": "*", "args": [setting("avgPrice"), {"type": "num", "value": 1.1}]}, when_filled("shares")), "a setting inside a calculation is not bare"),
    (position({"type": "series", "name": "close"}, when_filled("shares")), "a series that is not a setting"),
])
def test_CONTROL_what_is_not_a_bare_unfilled_setting_on_the_price_chart_is_left_alone(op, why):
    assert refused_by(dc._refuse_a_bare_fill_in_setting, {"ops": [op]}) is None, why


def test_a_setting_with_no_default_at_all_is_unfilled_too():
    op = position(setting("avgPrice"), when_filled("shares"))
    del op["inputs"][1]["default"]
    assert refused_by(dc._refuse_a_bare_fill_in_setting, {"ops": [op]}) is not None


def test_no_recorded_right_answer_is_refused():
    right = [c for c in CASES if c["lane"] == "formula" and c.get("recorded_verdict") != "wrong"]
    assert len(right) >= 100
    for case in right:
        assert refused_by(dc._refuse_a_bare_fill_in_setting, case["answer"]) is None, case["id"]


# ── at the door ──

def test_the_live_build_is_sent_back_and_the_one_that_draws_nothing_until_filled_is_the_answer(conv, clean_env, model):
    client = model([emits({**env(0, copy.deepcopy(LIVE["ops"])), "reply": REPLY}), emits({**env(0, [FILLED]), "reply": REPLY})])
    r = conv.converse(WORDS, user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["attempts"] == 2 and len(client.calls) == 2, (r.get("gate"), r.get("reason"))
    assert "a line at price 0" in json.dumps(client.calls[1]["messages"])
    built = {"ops": r["envelope"]["ops"], "reply": r["reply"]}
    assert G.grade_case(CASE, built)["verdict"] == "right", G.grade_case(CASE, built)["lines"]


def test_the_formula_door_is_told(conv):
    prompt = " ".join(conv.CONVERSE_SYSTEM_PROMPT.split())
    for piece in ("NEVER invent the member's own figures -- default 0", "A setting that is DRAWN on the price chart (an entry, a stop, an average cost) draws NOTHING until the member fills it in",
                  "`avgCost > 0 ? avgCost : 0 / 0`, never the bare setting", "a line at price 0 that squeezes the member's chart to fit it"):
        assert piece in prompt, piece


def test_the_script_document_says_it_in_its_own_words():
    doc = pa.document()
    rule = doc.split("\n14. ")[1].split("\n")[0]
    assert rule == pa.FILL_IN_RULE and doc.count(pa.FILL_IN_RULE) == 1 and "{fill_in}" not in doc
    for piece in ("A FIGURE THE MEMBER MUST FILL IN (shares, an entry, an average cost, a stop): never invent it",
                  "`plot(avg > 0 ? avg : na)`", "A bare `plot(avg)` is a line at price 0 that squeezes the chart",
                  "the member's own figures cannot be read here"):
        assert piece in rule, piece
    assert doc.index("\n13. ") < doc.index("\n14. ") < doc.index("## ")


# ── the grader: settings are read as the door writes them ──

def test_a_setting_is_read_by_the_name_the_door_writes_it_with():
    _built, inputs = G.trees_of({"ops": LIVE["ops"]})
    assert inputs == {"shares": 0, "avgPrice": 0}                     # `key`: this read `name`, and found none
    older = {"ops": [{"op": "create", "inputs": [{"name": "len", "default": 20}], "outputs": [{"key": "a", "tree": setting("len")}]}]}
    assert G.trees_of(older)[1] == {"len": 20}                       # the older shape is still read
    col, err = G.evaluate(setting("avgPrice"), {"avgPrice": 48.25})
    assert err is None and set(col) == {48.25}


FILL = [("the shares the member owns", 150.0), ("the average cost", 48.25)]


def _fill(ops):
    built, inputs = G.trees_of({"ops": ops})
    cols = [(n, *G.evaluate(t, inputs)) for n, t in built]
    return G._grade_fill_in(FILL, built, inputs, cols, "daily", None)


def test_a_rule_about_settings_holds_all_three_conditions():
    right = _fill([FILLED])
    assert right["verdict"] == "right" and "with nothing filled in, nothing is drawn" in right["lines"][0]
    assert "each figure is shown on every bar" in right["lines"][1]
    # (c) the live build: drawn at 0 until filled
    live = _fill(LIVE["ops"])
    assert live["verdict"] == "wrong" and "has a value on the chart" in " ".join(live["lines"])
    # (a) a figure of the member INVENTED as a default (an example position)
    invented = _fill([position(when_filled("avgPrice"), when_filled("shares"), defaults=(100, 0))])
    assert invented["verdict"] == "wrong" and "INVENTED as a default" in " ".join(invented["lines"])
    # one setting for two figures
    one = copy.deepcopy(FILLED)
    one["inputs"] = one["inputs"][:1]
    one["outputs"] = one["outputs"][1:]
    assert _fill([one])["verdict"] == "wrong" and "1 setting(s) for 2 figure(s)" in _fill([one])["lines"][0]
    # filled in, a figure is not what is shown (the cost is drawn doubled)
    doubled = position({"type": "op", "name": "?:", "args": [{"type": "op", "name": ">", "args": [setting("avgPrice"), {"type": "num", "value": 0}]},
                                                             {"type": "op", "name": "*", "args": [setting("avgPrice"), {"type": "num", "value": 2}]}, ZERO_OVER_ZERO]},
                       when_filled("shares"))
    assert _fill([doubled])["verdict"] == "wrong" and "no output shows each of them" in " ".join(_fill([doubled])["lines"])


def test_a_case_may_hold_what_the_member_is_told():
    said = {"contract": "uct.authoring.patch/1", "ops": [FILLED], "reply": REPLY}
    assert G.grade_case(CASE, said)["verdict"] == "right"
    silent = {**said, "reply": "Here are two settings for your shares and your average cost."}
    got = G.grade_case(CASE, silent)
    assert got["verdict"] == "wrong" and "the reply says none of" in " ".join(got["lines"])
    # the record of such a case keeps the reply (it is graded), and only for such a case
    assert value_eval.record_of(CASE, {"ops": [FILLED], "reply": REPLY, "turn": "patch"}) == {"contract": "uct.authoring.patch/1", "ops": [FILLED], "reply": REPLY}
    plain = next(c for c in CASES if c["lane"] == "formula" and not c.get("says"))
    assert set(value_eval.record_of(plain, {"ops": [FILLED], "reply": REPLY})) == {"contract", "ops"}


# ── the record ──

def test_the_case_moved_to_the_build_lane_with_its_reason_and_its_first_answer_was_WRONG():
    assert CASE["lane"] == "formula" and "wall" not in CASE and G.specimen(CASE) is not None
    assert CASE["provenance"].startswith("corrected on review 11-22: the words ask for the member's own numbers, not an account read")
    assert G.rule_digest("wall-18") == CASE["rule"]["digest"]
    got = G.grade_case(CASE, LIVE)
    assert got["verdict"] == "wrong" and "has a value on the chart" in " ".join(got["lines"])
    assert "the reply says none of" not in " ".join(got["lines"])                 # what it SAID was right; what it drew was not


def test_the_wall_lane_keeps_a_request_that_truly_needs_the_account():
    # (written words and rule first, as a pending case; it holds its first live answer since the thresholds PR)
    sibling = next(c for c in (DATA.get("pending") or []) + DATA["cases"] if c["id"] == "wall-33")
    assert sibling["lane"] == "wall" and "brokerage account" in sibling["words"]
    if "answer" in sibling:
        assert sibling["recorded"]["front"] and G.grade_wall(sibling, sibling["answer"])["verdict"] == sibling.get("recorded_verdict", "right")
    assert G.grade_wall(sibling, {"disposition": "unsupported", "reply": "I can't read a brokerage account from here."})["verdict"] == "right"
    assert G.grade_wall(sibling, {"disposition": "unsupported", "reply": "I can't build that."})["verdict"] == "wrong"
    assert G.grade_wall(sibling, {"disposition": "change", "reply": "your account", "ops": [FILLED]})["verdict"] == "wrong"


# ── a figure only the member has: the reply says the door cannot read it (2026-11-23) ──
#
# Found by the live re-check of the guard above, as a member (2026-11-22 23:40Z). The build was right (nothing at price
# 0; the share count kept for a table cell) and the reply never said the door cannot read the member's holdings.

SAYS_GATE = dc._refuse_a_reply_silent_on_a_figure_only_the_member_has
SILENT_REPLY = SILENT["reply"]


def test_THE_SECOND_FINDING_the_build_is_right_and_the_reply_never_says_why():
    assert refused_by(dc._refuse_a_bare_fill_in_setting, {"ops": SILENT["ops"]}) is None          # the first fix holds: nothing at price 0
    assert sorted(dc.member_filled_outputs({"ops": SILENT["ops"]})) == [("avgCostLine", "avgCost"), ("sharesHeld", "shares")]
    exc = refused_by(SAYS_GATE, SILENT)
    assert exc is not None and exc.gate == "envelope:reference"
    told = exc.for_model()
    for piece in ("`reply` does not say that UCT cannot read `avgCost`, `shares` for the member",
                  "they are owed the reason they must type it", "I can't read your account, so enter them in the indicator's settings"):
        assert piece in told, piece
    assert refused_by(dc.check_envelope, {**env(0, copy.deepcopy(SILENT["ops"])), "reply": SILENT_REPLY}, 0) is not None      # and at the whole check
    # the same build with a reply that says why passes the whole check
    assert refused_by(dc.check_envelope, {**env(0, copy.deepcopy(SILENT["ops"])), "reply": SILENT_REPLY + " " + REPLY}, 0) is None


@pytest.mark.parametrize("reply", [
    REPLY,
    "I can’t know your actual holdings, so please enter them there.",                 # a typographic apostrophe
    "There is no way to read a brokerage from here; type both figures in.",
    "I'm unable to see your position, so the two figures are settings.",
    "I do not have access to your account. Enter your shares and cost in the settings.",
    "UCT CANNOT read your holdings; fill both in.",
])
def test_a_reply_that_says_the_door_cannot_read_it_passes(reply):
    assert refused_by(SAYS_GATE, {"ops": [FILLED], "reply": reply}) is None


@pytest.mark.parametrize("reply", [
    SILENT_REPLY,
    "Here are two settings for your shares and your average cost.",
    "Enter your shares and your cost in the indicator's settings; both default to 0.",
    "Built.",
])
def test_a_reply_that_never_says_it_is_refused(reply):
    exc = refused_by(SAYS_GATE, {"ops": [FILLED], "reply": reply})
    assert exc is not None and "`avgPrice`, `shares`" in exc.for_model()


def test_every_shape_of_a_figure_only_the_member_has():
    def shown(tree, **kw):
        return dc.member_filled_outputs({"ops": [position(tree, {"type": "num", "value": 1}, **kw)]})
    key = "avgPrice"
    cond = lambda name, of=key: {"type": "op", "name": name, "args": [setting(of), {"type": "num", "value": 0}]}  # noqa: E731
    assert shown(setting(key)) == [("avgCost", key)]                                               # bare, drawn
    assert shown(setting(key), hidden=(True, True)) == [("avgCost", key)]                          # bare, hidden (a table cell reads it)
    assert shown(setting(key), placement="pane") == [("avgCost", key)]                             # under the chart too
    for name in (">", "!=", ">="):                                                                 # drawn only once filled
        assert shown({"type": "op", "name": "?:", "args": [cond(name), setting(key), ZERO_OVER_ZERO]}) == [("avgCost", key)], name
    # NOT such a figure: the setting inside a calculation, a branch that is not the setting, a condition about something else
    assert shown({"type": "op", "name": "*", "args": [setting(key), {"type": "num", "value": 1.1}]}) == []
    assert shown({"type": "op", "name": "?:", "args": [cond(">"), {"type": "series", "name": "close"}, ZERO_OVER_ZERO]}) == []
    assert shown({"type": "op", "name": "?:", "args": [cond(">", "shares"), setting(key), ZERO_OVER_ZERO]}) == []
    assert shown({"type": "op", "name": "?:", "args": [cond("<"), setting(key), ZERO_OVER_ZERO]}) == []
    assert shown({"type": "series", "name": "close"}) == [] and shown({"type": "num", "value": 100}) == [] and shown(None) == []
    # a setting with a REAL default is a level the member asked for, not a figure only they have
    assert shown(setting(key), defaults=(0, 100)) == []
    # each such output is listed, whichever create it is in; an op that is not a create shows nothing
    both = {"ops": [position(setting("avgPrice"), setting("shares")), {"op": "set_style", "output": "avgCost", "color": "#fff"}]}
    assert dc.member_filled_outputs(both) == [("avgCost", "avgPrice"), ("sharesOwned", "shares")]
    assert dc.member_filled_outputs({"ops": [{"op": "set_style", "output": "x"}, "junk"]}) == [] and dc.member_filled_outputs({}) == []


@pytest.mark.parametrize("op,why", [
    (position(setting("avgPrice"), setting("shares"), defaults=(100, 100), placement="pane"), "real defaults: levels the member asked for"),
    (position({"type": "op", "name": "*", "args": [setting("avgPrice"), {"type": "num", "value": 1.1}]}, {"type": "series", "name": "close"}), "a setting inside a calculation"),
    (position({"type": "series", "name": "close"}, {"type": "num", "value": 5}), "no setting is shown at all"),
])
def test_CONTROL_a_turn_that_shows_no_figure_of_the_members_is_left_alone_whatever_it_says(op, why):
    assert refused_by(SAYS_GATE, {"ops": [op], "reply": "Built."}) is None, why


def test_no_reply_at_all_is_left_as_it_was():
    for reply in (None, "", "   ", 7):
        assert refused_by(SAYS_GATE, {"ops": [FILLED], **({} if reply is None else {"reply": reply})}) is None, reply


def test_ONE_helper_tells_both_guards_which_settings_are_the_members_to_fill():
    assert dc._unfilled_settings({"inputs": [{"key": "a", "default": 0}, {"key": "b"}, {"key": "c", "default": 5}, {"key": "d", "default": 0.0},
                                             "junk", {"default": 0}, {"key": 3, "default": 0}]}) == {"a", "b", "d"}
    assert dc._unfilled_settings({}) == set()
    import ast
    tree = ast.parse(Path(dc.__file__).read_text(encoding="utf-8"))
    calls = {fn.name: {c.func.id for c in ast.walk(fn) if isinstance(c, ast.Call) and isinstance(c.func, ast.Name)}
             for fn in ast.walk(tree) if isinstance(fn, ast.FunctionDef)}
    assert "_unfilled_settings" in calls["_refuse_a_bare_fill_in_setting"] and "_unfilled_settings" in calls["member_filled_outputs"]
    assert "member_filled_outputs" in calls["_refuse_a_reply_silent_on_a_figure_only_the_member_has"]
    # and the whole check runs the new guard right after the first
    assert {"_refuse_a_bare_fill_in_setting", "_refuse_a_reply_silent_on_a_figure_only_the_member_has"} <= calls["check_envelope"]


def test_no_recorded_right_answer_shows_such_a_figure_so_none_can_be_refused():
    right = [c for c in CASES if c["lane"] == "formula" and c.get("recorded_verdict") != "wrong"]
    assert len(right) >= 100
    for case in right:
        assert dc.member_filled_outputs(case["answer"]) == [], case["id"]
    # CONTROL: the one recorded request that does, in both its answers
    assert all(dc.member_filled_outputs(s["answer"]) for s in G.specimens(CASE))


def test_the_formula_door_is_told_to_say_it(conv):
    prompt = " ".join(conv.CONVERSE_SYSTEM_PROMPT.split())
    assert ("NEVER invent the member's own figures -- default 0, say in `reply` that you cannot read them (their account, their holdings) "
            "and tell them to set them in the indicator's settings.") in prompt


def test_the_silent_reply_is_sent_back_and_the_one_that_says_why_is_the_answer(conv, clean_env, model):
    said = SILENT_REPLY + " I can't read your account or your holdings, which is why you enter them yourself."
    client = model([emits({**env(0, copy.deepcopy(SILENT["ops"])), "reply": SILENT_REPLY}), emits({**env(0, copy.deepcopy(SILENT["ops"])), "reply": said})])
    r = conv.converse(WORDS, user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["attempts"] == 2 and len(client.calls) == 2, (r.get("gate"), r.get("reason"))
    assert "does not say that UCT cannot read" in json.dumps(client.calls[1]["messages"])
    built = {"ops": r["envelope"]["ops"], "reply": r["reply"]}
    assert G.grade_case(CASE, built)["verdict"] == "right", G.grade_case(CASE, built)["lines"]


def test_a_reply_that_says_why_the_first_time_costs_no_second_call(conv, clean_env, model):
    client = model([emits({**env(0, copy.deepcopy(SILENT["ops"])), "reply": SILENT_REPLY + " " + REPLY})])
    r = conv.converse(WORDS, user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["attempts"] == 1 and len(client.calls) == 1


# ── the rule: only what is DRAWN ON BARS counts (corrected 2026-11-23) ──

def test_a_HIDDEN_output_is_not_drawn_and_a_visible_one_is():
    hidden_bare = position(when_filled("avgPrice"), setting("shares"))                 # the share count hidden, read by a table cell
    assert G.hidden_outputs({"ops": [hidden_bare]}) == {"output sharesOwned"} and G.hidden_outputs({}) == set()
    built, inputs = G.trees_of({"ops": [hidden_bare]})
    cols = [(n, *G.evaluate(t, inputs)) for n, t in built]
    got = G._grade_fill_in(FILL, built, inputs, cols, "daily", None, G.hidden_outputs({"ops": [hidden_bare]}))
    assert got["verdict"] == "right" and got["lines"][0] == "with nothing filled in, nothing is drawn (hidden, not drawn: ['output sharesOwned'])"
    # the SAME tree drawn (not hidden) is a level at 0 on the bars: wrong
    visible = position(when_filled("avgPrice"), setting("shares"), hidden=(False, False))
    built, inputs = G.trees_of({"ops": [visible]})
    cols = [(n, *G.evaluate(t, inputs)) for n, t in built]
    drawn = G._grade_fill_in(FILL, built, inputs, cols, "daily", None, G.hidden_outputs({"ops": [visible]}))
    assert drawn["verdict"] == "wrong" and "['output sharesOwned'] has a value on the chart" in drawn["lines"][0]
    # and the rule is told which outputs are hidden by the grader itself (the case's own verdict moves with it)
    assert G.grade_case(CASE, {"contract": "uct.authoring.patch/1", "ops": [hidden_bare], "reply": REPLY})["verdict"] == "right"
    assert G.grade_case(CASE, {"contract": "uct.authoring.patch/1", "ops": [visible], "reply": REPLY})["verdict"] == "wrong"


def test_what_the_member_is_told_is_read_with_a_typographic_apostrophe_as_a_plain_one():
    said = {"contract": "uct.authoring.patch/1", "ops": [FILLED], "reply": "I can’t read your account, so enter both in the settings."}
    assert G.grade_case(CASE, said)["verdict"] == "right"


def test_the_case_holds_BOTH_findings_and_its_rule_says_how_it_was_corrected():
    held = G.specimens(CASE)
    assert len(held) >= 2 and held[0]["fixed_by"] == {"pr": "#2472", "merge": "04949a82d776e05ff9fa5af07ab2c4e73233e277"}
    first, second = G.grade_case(CASE, held[0]["answer"]), G.grade_case(CASE, held[1]["answer"])
    assert first["verdict"] == "wrong" and "has a value on the chart" in " ".join(first["lines"])
    assert "the reply says none of" not in " ".join(first["lines"])                        # the first SAID it and drew a line at 0
    assert second["verdict"] == "wrong" and second["lines"][0].startswith("with nothing filled in, nothing is drawn")
    assert len([line for line in second["lines"] if line.startswith("the reply says none of")]) == 2       # the second drew right and never said it
    assert "never says the door cannot read the member's holdings" in held[1]["defect"]
    last = CASE["rule"]["history"][-1]
    assert last["digest"] == CASE["rule"]["digest"] == G.rule_digest("wall-18") and last["quote"] in WORDS
    assert "only what is DRAWN ON BARS counts" in last["reason"] and "numbers did not change" in last["reason"]
