"""ANOTHER PUBLISHER'S OWN NUMBER: the door says first that it cannot give it, then that UCT has its own, not theirs.

Found by the first full live run of the value cases, as a member (2026-11-22). Asked "Give me the same proprietary RS
Rating number IBD publishes", the door answered by name, with the offer to add it:
"RS Rating is one of UCT's own indicators, UCT RS Rating: ..." It never said it is NOT IBD's number. A named offer
under the words of another publisher's proprietary number reads as a yes.

The fix, in the door's own words (no model call is involved where the door answers by name):
  * `named_indicators.other_publisher` reads the publisher the member's words name;
  * `named_indicators.their_number` is said IN PLACE of the door's usual sentence: first that the publisher's number
    is theirs and is not available here; only then that UCT has its own, what that is, and that it is not theirs.
    Both where the door offers the built-in in one tap and where it points to the Indicators list;
  * the assistant's instructions say the same for a publisher's number UCT has no name for (a Zacks Rank);
  * the value cases hold it: a wall may be `theirs` (`tests/test_value_cases_walls.py`), and `wall-26` records what a
    member was told in the live run, WRONG by it. Two siblings wait for their live answers (`pending`): their words
    and their rule are written here, before any answer exists.

MEASURED before it was written: of the 624 requests on file, ONE names another publisher (this one).

No paid calls: the door answers these by name, and every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from api.services import named_indicators as ni
from tests.test_named_built_ins import CHART, OFFERS, RATING, ask
from tests.test_p2_truth_server import conv, emits, empty_view, env, model  # noqa: F401 -- fixtures by name
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name
from tools.value_cases import grade as G

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "tests" / "fixtures" / "authoring" / "value_cases.json").read_text(encoding="utf-8"))
CASE = next(c for c in DATA["cases"] if c["id"] == "wall-26")
WORDS = CASE["words"]
SAID = ("IBD's RS Rating is IBD's own and is not available here. UCT has its own, UCT RS Rating: the stock's RS Rating, 1 to 99, "
        "session by session on daily charts. It is not IBD's number")
CAN_ADD = SAID + ", and it is not a formula to build here."
CANNOT_ADD = SAID + ". Look for UCT RS Rating in the Indicators list."


# ── the words ──

@pytest.mark.parametrize("words,publisher", [
    (WORDS, "IBD"), ("Show MarketSmith's RS Rating under the chart", "IBD"), ("the MarketSurge composite rating", "IBD"),
    ("investor's business daily relative strength rating", "IBD"), ("investors business daily RS", "IBD"),
    ("Show the Zacks Rank for this stock", "Zacks"), ("the Morningstar star rating", "Morningstar"), ("Value Line timeliness rank", "Value Line"),
    ("the TipRanks smart score", "TipRanks"), ("Barchart's opinion", "Barchart"), ("the Seeking Alpha quant rating", "Seeking Alpha"),
    ("Plot the RS Rating", None), ("Add the RS line versus SPY", None), ("the TradingView RSI", None), ("a ribbon of EMAs", None),
    ("ibdx", None), ("exhibit d", None), ("", None), (None, None),
])
def test_the_publisher_the_words_name(words, publisher):
    assert ni.other_publisher(words) == publisher, words


def test_what_the_door_says_in_place_of_its_usual_sentence():
    assert ni.their_number(WORDS, RATING, True) == CAN_ADD
    assert ni.their_number(WORDS, RATING, False) == CANNOT_ADD
    assert ni.their_number("Plot the RS Rating", RATING, True) is None           # no other publisher: the usual sentence stands
    for said in (CAN_ADD, CANNOT_ADD):
        assert said.index("not available here") < said.index("UCT")              # the refusal comes before anything of UCT's
        assert "It is not IBD's number" in said and said.count("UCT RS Rating") <= 2
        assert "one of UCT's own indicators" not in said                         # said once, not three times
    # what UCT's own IS comes from the built-in's own entry (one authority), never typed again here
    assert ni.built_in(RATING)["what"] in CAN_ADD
    # a name UCT holds with no built-in behind it: the refusal, then the usual way forward for that name
    plain = next(e for e in ni.entries() if ni.built_in(e) is None)
    said = ni.their_number("IBD's " + plain["name"], plain, True)
    assert said == f"IBD's {plain['name']} is IBD's own and is not available here. {ni.way_forward(plain)}"


# ── the door, with no model call ──

def test_THE_FINDING_the_offer_says_first_that_it_is_not_theirs(conv, clean_env, model):
    client = model([])
    r = ask(conv, WORDS, accepts=OFFERS, addable=["rsRating"])
    assert client.calls == [] and r["cost_usd"] == 0.0                              # the door's own answer
    assert r["ok"] is True and r["disposition"] == "answer" and r["turn"] == "offer"
    assert r["reply"] == CAN_ADD == r["envelope"]["reply"]
    assert r["offer"]["indicator"] == "rsRating"                                    # the one-tap offer is still made
    # and the value case that recorded the defect is RIGHT on this answer
    assert G.grade_wall(CASE, {"disposition": r["disposition"], "reply": r["reply"]})["verdict"] == "right"


def test_a_browser_that_cannot_add_it_is_told_the_same_first(conv, clean_env, model):
    client = model([])
    r = ask(conv, WORDS)
    assert client.calls == [] and r["ok"] is False and r["gate"] == "named:built-in"
    assert r["reason"] == CANNOT_ADD
    assert conv.understand_turn(WORDS, CHART)["refusal"]["reason"] == CANNOT_ADD
    assert G.grade_wall(CASE, {"disposition": "unsupported", "reply": r["reason"]})["verdict"] == "right"


@pytest.mark.parametrize("words", ["Add the RS Rating", "Plot the RS Rating under the chart"])
def test_CONTROL_with_no_other_publisher_named_the_door_says_what_it_always_said(conv, clean_env, model, words):
    model([])
    r = ask(conv, words, accepts=OFFERS, addable=["rsRating"])
    assert r["reply"] == ni.built_in_answer(RATING) and "IBD" not in r["reply"]
    model([])
    r = ask(conv, words)
    assert r["reason"] == ni.way_forward(RATING)


def test_the_instructions_say_it_for_a_number_UCT_has_no_name_for(conv):
    prompt = " ".join(conv.CONVERSE_SYSTEM_PROMPT.split())
    for piece in ("ANOTHER PUBLISHER'S OWN NUMBER (IBD's RS Rating or Composite Rating, a Zacks Rank, a Morningstar rating, a TipRanks score)",
                  "FIRST say plainly that it is that publisher's own and is not available here",
                  "named as UCT's or the member's and as NOT that publisher's", "Never imply the two are the same number"):
        assert piece in prompt, piece


# ── the record ──

def test_the_live_answer_is_recorded_WRONG_and_says_why():
    # the wrong answer the finding rests on: the case's record while it is recorded WRONG, its `found` specimen after
    found = G.specimen(CASE)
    assert CASE["wall"] == {"names": ["IBD"], "theirs": "IBD"} and found is not None
    assert found["answer"]["disposition"] == "answer" and "IBD" not in found["answer"]["reply"]
    assert "reads as a yes" in found["defect"]
    got = G.grade_case(CASE, found["answer"])
    assert got["verdict"] == "wrong" and any("cannot be given" in line for line in got["lines"])


def test_the_two_siblings_were_written_words_and_rule_first_and_are_held_wherever_they_now_are():
    """⛔ WRITTEN BEFORE ANY ANSWER EXISTED, so the rule could not learn from the door. A pending case holds words and
    a rule and NO answer; the live re-check recorded the answers, and each then moved into `cases` (2026-11-22: both
    WRONG, a second gap of this family: a publisher's number UCT has nothing by the name of)."""
    waiting = {c["id"]: c for c in DATA.get("pending") or []}
    recorded = {c["id"]: c for c in DATA["cases"]}
    assert not set(waiting) & set(recorded)                                       # a case is pending or recorded, never both
    siblings = {cid: (waiting.get(cid) or recorded.get(cid)) for cid in ("wall-31", "wall-32")}
    assert all(siblings.values())
    for cid, case in siblings.items():
        assert case["lane"] == "wall" and case["wall"]["theirs"] in case["wall"]["names"] and ni.other_publisher(case["words"]) == case["wall"]["theirs"]
        assert any(n.lower() in case["words"].lower() for n in case["wall"]["names"])
        if cid in waiting:
            assert "answer" not in case and "recorded" not in case
        else:
            assert case["recorded"]["front"] and G.grade_case(case)["verdict"] == case.get("recorded_verdict", "right")
            assert ("defect" in case) == (case.get("recorded_verdict") == "wrong")
        # the rule can pass and can fail, whatever the door has said so far
        P = case["wall"]["theirs"]
        assert G.grade_wall(case, {"disposition": "unsupported", "reply": f"That is {P}'s own number and is not available here."})["verdict"] == "right"
        assert G.grade_wall(case, {"disposition": "answer", "reply": "UCT has a rating of its own for that."})["verdict"] == "wrong"
    assert siblings["wall-31"]["wall"]["theirs"] == "Zacks"                       # a publisher UCT has no name for
    assert siblings["wall-32"]["wall"]["theirs"] == "IBD" and "RS Rating" not in siblings["wall-32"]["words"]      # another IBD rating
