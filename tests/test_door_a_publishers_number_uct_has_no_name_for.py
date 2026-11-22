"""ANOTHER PUBLISHER'S OWN NUMBER THAT UCT HAS NOTHING BY THE NAME OF.

Found by the two pending siblings of `wall-26`, re-sent live as a member (2026-11-22). The first fix
(`tests/test_door_another_publishers_number.py`) covered the request that names something UCT HOLDS ("the same RS
Rating IBD publishes"). When UCT holds nothing by the name, the request fell to the planner's unknown-name sentence:

    "Zacks Rank" is not an indicator UCT knows by name. Describe the rule itself in your own words (what it
    measures, over how many bars) and the assistant will build exactly that.

A member reads that as "you can have Zacks Rank if you explain it". It never says the number is the publisher's own
and is not on offer; for "IBD's Composite Rating" it did not even say IBD.

Three things, in this order:
  * THE GRADER FIRST: a refusal AT THE DOOR by a gate (`ok` false, a `reason`, no `disposition`) is a refusal. The
    wall grader read it as "the door did not refuse". No wall of the live run was such an answer, so it never showed;
  * THE DOOR says first that the name is the publisher's own number and is not available here, that UCT has nothing
    by that name, and only then how the member can build something of their own. It claims a name for a publisher
    only when the words tie them together; a publisher named in passing changes nothing. Measured before it was
    written over the 554 distinct recorded requests: 3 name another publisher, and the sentence fires on exactly 2
    (these two);
  * THE WALL RULE asks for "it is not <publisher>'s" where the reply names something UCT HAS, and only there.

No paid calls: the door answers these by itself, with no model call at all.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from api.services import named_indicators as ni
from tests.test_named_built_ins import CHART
from tests.test_p2_truth_server import conv, model  # noqa: F401 -- fixtures by name
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name
from tools import value_eval
from tools.value_cases import grade as G

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "tests" / "fixtures" / "authoring" / "value_cases.json").read_text(encoding="utf-8"))
EVERY = {c["id"]: c for c in DATA["cases"] + (DATA.get("pending") or [])}
ZACKS, COMPOSITE, RATING = EVERY["wall-31"], EVERY["wall-32"], EVERY["wall-26"]
OLD = '"{name}" is not an indicator UCT knows by name. Describe the rule itself in your own words (what it measures, over how many bars) and the assistant will build exactly that.'
NEW = ('"{name}" is {publisher}\'s own number and is not available here. UCT has nothing by that name. To build something of your own, '
       "describe the rule (what it measures, over how many bars) and the assistant will build exactly that.")


# ── whose name it is ──

@pytest.mark.parametrize("message,phrase,publisher", [
    ("Show the Zacks Rank for this stock as a number under the chart.", "Zacks Rank", "Zacks"),              # the publisher's word is in the name
    ("Plot IBD's Composite Rating for this stock under the chart.", "Composite Rating", "IBD"),               # right before it, possessive
    ("Plot the IBD Composite Rating under the chart", "Composite Rating", "IBD"),                              # right before it
    ("Add Investor's Business Daily's Composite Rating", "Composite Rating", "IBD"),                           # the long name
    ("Plot IBD's proprietary Composite Rating", "Composite Rating", "IBD"),
    ("Plot the Composite Rating from IBD under the chart", "Composite Rating", "IBD"),                         # right after it
    ("Show the Timeliness Rank by Value Line", "Timeliness Rank", "Value Line"),
    ("Show the Smart Score of TipRanks", "Smart Score", "TipRanks"),
])
def test_a_name_tied_to_a_publisher_is_that_publishers(message, phrase, publisher):
    assert ni.publisher_of(message, phrase) == publisher
    assert ni.their_unknown_name(message, phrase) == NEW.format(name=phrase, publisher=publisher)


@pytest.mark.parametrize("message,phrase", [
    ("Plot the Foo Line, I saw it on Barchart", "Foo Line"),                 # named in passing
    ("Like IBD does, plot my Swing Line under the chart", "Swing Line"),     # not tied to the name
    ("Plot the Swing Line", "Swing Line"),                                   # no publisher at all
    ("Plot the Swing Line", ""), ("Plot the Swing Line", None), (None, "Swing Line"),
])
def test_CONTROL_a_publisher_named_in_passing_or_not_at_all_claims_nothing(message, phrase):
    assert ni.publisher_of(message, phrase) is None and ni.their_unknown_name(message, phrase) is None


def test_the_sentence_says_it_is_theirs_FIRST_then_that_uct_has_nothing_then_the_way_forward():
    said = ni.their_unknown_name(ZACKS["words"], "Zacks Rank")
    theirs, nothing, forward = said.index("is Zacks's own number and is not available here"), said.index("UCT has nothing by that name"), said.index("To build something of your own")
    assert 0 < theirs < nothing < forward
    assert "not an indicator UCT knows by name" not in said and "Describe the rule itself" not in said
    assert ni.is_their_unknown_name(said, "Zacks Rank") and not ni.is_their_unknown_name(said, "Zacks Score")
    assert not ni.is_their_unknown_name(OLD.format(name="Zacks Rank"), "Zacks Rank") and not ni.is_their_unknown_name(None, "Zacks Rank")


# ── the grader ──

def test_a_refusal_at_the_door_by_a_gate_is_a_refusal():
    at_the_door = {"ok": False, "gate": "concept:ungrounded", "reason": "No."}
    assert value_eval.answer_of(at_the_door) == {"disposition": "unsupported", "reply": "No."}
    # CONTROLS: an answer is what it says it is; a gate with nothing to tell the member is not made into a refusal
    assert value_eval.answer_of({"ok": True, "disposition": "answer", "reply": "Yes."})["disposition"] == "answer"
    assert value_eval.answer_of({"ok": False, "disposition": "clarify", "reason": "x"})["disposition"] == "clarify"
    assert value_eval.answer_of({"ok": False, "gate": "g"})["disposition"] is None
    assert value_eval.answer_of({"ok": True, "reason": "x"})["disposition"] is None


def test_NOT_THEIRS_is_owed_where_the_reply_names_something_uct_has_and_only_there():
    refused = lambda reply: {"disposition": "unsupported", "reply": reply}  # noqa: E731
    # nothing of UCT's is offered: right without "not Zacks's"
    assert G.grade_wall(ZACKS, refused(NEW.format(name="Zacks Rank", publisher="Zacks")))["verdict"] == "right"
    # the same sentence that then OFFERS a UCT indicator without saying it is not theirs: wrong, and the line names it
    offering = NEW.format(name="Zacks Rank", publisher="Zacks") + " You can add UCT RS Rating instead."
    got = G.grade_wall(ZACKS, refused(offering))
    assert got["verdict"] == "wrong" and "it offers UCT's own without saying it is not Zacks's" in got["lines"]
    # UCT named as having something, even with no indicator's name, is an offer too
    vague = NEW.format(name="Zacks Rank", publisher="Zacks") + " UCT has a ranking of its own."
    assert G.grade_wall(ZACKS, refused(vague))["verdict"] == "wrong"
    # a publisher's name for its OWN number that UCT's catalogue also uses ("RS Rating") is not an offer of UCT's
    assert G.grade_wall(RATING, refused("IBD's RS Rating is IBD's own number and I can't give it here."))["verdict"] == "right"
    assert G.UCT_HAS_NOTHING in NEW.lower()
    assert G.grade_wall(ZACKS, refused(offering + " It is not Zacks's number."))["verdict"] == "right"
    # wall-26 stays strict: the live reply that read as a yes is wrong, the approved one right
    yes = {"disposition": "answer", "reply": "RS Rating is one of UCT's own indicators, UCT RS Rating: the stock's RS Rating, 1 to 99. It is not a formula to build here."}
    assert G.grade_wall(RATING, yes)["verdict"] == "wrong"
    approved = {"disposition": "answer", "reply": "IBD's RS Rating is IBD's own and is not available here. UCT has its own, UCT RS Rating: the stock's rating. It is not IBD's number."}
    assert G.grade_wall(RATING, approved)["verdict"] == "right"
    assert G.grade_wall(RATING, {**approved, "reply": approved["reply"].replace(" It is not IBD's number.", "")})["verdict"] == "wrong"


@pytest.mark.parametrize("case,name,publisher", [(ZACKS, "Zacks Rank", "Zacks"), (COMPOSITE, "Composite Rating", "IBD")])
def test_THE_FINDING_the_old_sentence_is_WRONG_by_the_cases_own_rule_and_the_new_one_RIGHT(case, name, publisher):
    old = value_eval.answer_of({"ok": False, "gate": "concept:ungrounded", "reason": OLD.format(name=name)})
    got = G.grade_wall(case, old)
    assert got["verdict"] == "wrong" and f"it never says {publisher}'s own number cannot be given here" in got["lines"]
    assert "the door did not refuse" not in " ".join(got["lines"])          # refused it was; what it SAID was wrong
    new = value_eval.answer_of({"ok": False, "gate": "concept:ungrounded", "reason": NEW.format(name=name, publisher=publisher)})
    assert G.grade_wall(case, new)["verdict"] == "right"


# ── at the door ──

@pytest.mark.parametrize("case,name,publisher", [(ZACKS, "Zacks Rank", "Zacks"), (COMPOSITE, "Composite Rating", "IBD")])
def test_the_door_says_it_is_theirs_with_no_model_call(conv, clean_env, model, case, name, publisher):
    client = model([])
    r = conv.converse(case["words"], user_id="u1", view=None, chart=CHART)
    assert r["ok"] is False and client.calls == []
    assert r["reason"] == NEW.format(name=name, publisher=publisher)
    assert G.grade_wall(case, value_eval.answer_of(r))["verdict"] == "right"
    got = conv.understand_turn(case["words"], CHART)
    assert got["refusal"]["gate"] == "concept:ungrounded" and conv.refused_names(got["refusal"]["not_understood"]) == [name]


@pytest.mark.parametrize("words,name", [("Plot the Swing Line Thing under the chart", "Swing Line Thing"),
                                         ("Plot the Foo Bar Line, I saw it on Barchart", "Foo Bar Line")])
def test_CONTROL_an_unknown_name_that_is_nobodys_keeps_the_usual_sentence(conv, words, name):
    got = conv.understand_turn(words, CHART)
    assert got["refusal"] is not None and got["refusal"]["reason"] == OLD.format(name=name), got["refusal"]
    assert conv.refused_names(got["refusal"]["not_understood"]) == [name]


def test_CONTROL_a_name_uct_holds_still_gets_the_first_fixes_sentence(conv):
    got = conv.understand_turn(RATING["words"], CHART)
    assert got["refusal"]["reason"].startswith("IBD's RS Rating is IBD's own and is not available here. UCT has its own, UCT RS Rating: ")
