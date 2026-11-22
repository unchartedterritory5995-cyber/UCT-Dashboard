"""A WALL HELD TO MORE THAN "REFUSED AND NAMED".

A request that cannot be served is right when nothing is built, the door refuses, and the reply names the wall.
Two kinds of wall need more, both found by the first full live run of the value cases and the rulings on it:

  * `wall.theirs` -- the member asked for ANOTHER PUBLISHER'S OWN NUMBER. Right: it says plainly that the number
    cannot be given here, BEFORE anything of UCT's is named, and names UCT's own as not theirs. It may be an ANSWER
    that then offers UCT's own (the door offers its built-in in one tap), not only a refusal.
  * `wall.offers` -- the nearest builds the refusal must OFFER, each as a one-tap choice of a question, or in the
    sentence of a plain refusal.

And the runner keeps a question's text and its choices, which is where such a refusal's words are.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from tools import value_eval
from tools.value_cases import grade as G

ROOT = Path(__file__).resolve().parents[1]
CASES = json.loads((ROOT / "tests" / "fixtures" / "authoring" / "value_cases.json").read_text(encoding="utf-8"))["cases"]
WALLS = [c for c in CASES if c["lane"] == "wall"]
BUILT = {"disposition": "change", "reply": "Here it is.", "ops": [{"op": "create", "outputs": [{"key": "a", "tree": {"type": "series", "name": "close"}}]}]}


# ── another publisher's own number ──

THEIRS = {"id": "w", "lane": "wall", "wall": {"names": ["IBD"], "theirs": "IBD"}}
SAID_FIRST = "IBD's RS Rating is IBD's own and is not available here. UCT RS Rating is UCT's own, not IBD's: the stock's rating, 1 to 99."


@pytest.mark.parametrize("answer", [
    {"disposition": "answer", "reply": SAID_FIRST},                                             # it says so, then offers UCT's own
    {"disposition": "unsupported", "reply": "IBD's RS Rating is IBD's own number and I can't give it here."},      # a plain refusal
    {"disposition": "unsupported", "reply": "IBD's RS Rating cannot be given here. UCT RS Rating is UCT's own, not IBD's."},
])
def test_it_says_first_that_the_number_is_theirs_and_cannot_be_given(answer):
    assert G.grade_wall(THEIRS, answer)["verdict"] == "right", answer


@pytest.mark.parametrize("answer,why", [
    ({"disposition": "answer", "reply": "RS Rating is one of UCT's own indicators, UCT RS Rating: the stock's RS Rating, 1 to 99. It is not a formula to build here."},
     "it never says IBD's own number cannot be given here"),                                     # THE FINDING
    ({"disposition": "answer", "reply": "UCT RS Rating is UCT's own, not IBD's. IBD's number is not available here."},
     "it names UCT's own BEFORE saying IBD's number cannot be given"),
    ({"disposition": "answer", "reply": "IBD's RS Rating is not available here. UCT RS Rating is in the Indicators list."},
     "it offers UCT's own without saying it is not IBD's"),
    ({"disposition": "answer", "reply": "That rating is not available here."}, "the reply names none of"),
    ({**BUILT, "reply": "IBD's is not available here."}, "something was BUILT"),
    ({"disposition": "clarify", "reply": "IBD's is not available here.", "questions": [{"text": "Which?", "choices": ["a", "b"]}]}, "the door did not refuse"),
])
def test_an_answer_that_reads_as_a_yes_or_says_it_late_is_WRONG(answer, why):
    got = G.grade_wall(THEIRS, answer)
    assert got["verdict"] == "wrong" and why in " ".join(got["lines"]), (why, got["lines"])


def test_an_ordinary_wall_still_needs_a_refusal_never_an_answer():
    plain = {"id": "p", "lane": "wall", "wall": {"names": ["options"]}}
    assert G.grade_wall(plain, {"disposition": "unsupported", "reply": "There is no options data here."})["verdict"] == "right"
    assert G.grade_wall(plain, {"disposition": "answer", "reply": "Options data is not available here."})["verdict"] == "wrong"
    assert G.grade_wall(plain, {"disposition": "clarify", "reply": "options", "questions": [{"text": "options?", "choices": ["a", "b"]}]})["verdict"] == "wrong"


# ── a refusal that must offer the nearest builds ──

QUESTION = {"text": "I can't yet compare each 5 minute bar with a daily measure like the 50 day average. Which would you like?",
            "choices": ["The 50 day average as a line, on daily bars", "Crosses of the average of 50 five-minute bars (about 4 hours)"]}
OFFERS = {"id": "o", "lane": "wall", "wall": {"names": ["daily measure", "50 day average"], "offers": [
    {"what": "the daily measure on its own, on daily bars", "words": ["50 day", "daily bars"]},
    {"what": "the same idea on this chart's own bars, named for what it spans", "words": ["50 five-minute bars"]}]}}
ASKED = {"disposition": "clarify", "reply": "", "questions": [QUESTION]}


def test_a_refusal_by_name_with_every_offer_is_RIGHT():
    got = G.grade_wall(OFFERS, ASKED)
    assert got["verdict"] == "right" and sum(1 for line in got["lines"] if line.startswith("offered: ")) == 2
    said = {"disposition": "unsupported", "reply": "I can't compare each bar with a daily measure yet. I can draw the 50 day average on daily bars, "
                                                   "or crosses of the average of 50 five-minute bars."}
    assert G.grade_wall(OFFERS, said)["verdict"] == "right"                 # a plain refusal that makes both offers in its sentence


@pytest.mark.parametrize("answer,why", [
    ({**ASKED, "questions": [{**QUESTION, "choices": [QUESTION["choices"][0], "Never mind"]}]}, "NOT OFFERED: the same idea on this chart's own bars"),
    ({**ASKED, "questions": [{**QUESTION, "choices": ["Never mind", QUESTION["choices"][1]]}]}, "NOT OFFERED: the daily measure on its own"),
    ({**ASKED, "questions": [{**QUESTION, "text": "Which would you like?"}]}, "the reply names none of"),
    ({"disposition": "unsupported", "reply": "I can't compare each bar with a daily measure like the 50 day average yet."}, "NOT OFFERED"),
    ({"disposition": "clarify", "reply": "a daily measure, the 50 day average"}, "the door did not refuse"),      # a question with no question
    ({"disposition": "answer", "reply": "a daily measure, the 50 day average, on daily bars or 50 five-minute bars"}, "the door did not refuse"),
    ({**BUILT, "reply": "a daily measure"}, "something was BUILT"),
])
def test_a_refusal_that_names_nothing_or_offers_less_or_builds_is_WRONG(answer, why):
    got = G.grade_wall(OFFERS, answer)
    assert got["verdict"] == "wrong" and why in " ".join(got["lines"]), (why, got["lines"])


# ── the record ──

def test_a_recorded_question_keeps_its_text_and_its_choices():
    body = {"disposition": "clarify", "reply": "r", "envelope": {"questions": [{**QUESTION, "id": "which", "extra": 1}], "ops": []}}
    answer = value_eval.answer_of(body)
    assert answer["questions"][0]["choices"] == QUESTION["choices"]
    kept = value_eval.record_of({"lane": "wall"}, answer)
    assert kept == {"disposition": "clarify", "reply": "r", "questions": [{"text": QUESTION["text"], "choices": QUESTION["choices"]}]}
    assert value_eval.record_of({"lane": "wall"}, {"disposition": "unsupported", "reply": "no"}) == {"disposition": "unsupported", "reply": "no"}
    # and the kept record grades as the live answer did
    assert G.grade_wall(OFFERS, kept)["verdict"] == G.grade_wall(OFFERS, answer)["verdict"] == "right"


def test_every_recorded_wall_is_what_its_case_says_and_only_the_named_kinds_carry_more():
    more = {c["id"]: sorted(k for k in c["wall"] if k != "names") for c in WALLS if set(c["wall"]) - {"names"}}
    assert more == {"wall-26": ["theirs"]}
    for case in WALLS:
        assert G.grade_wall(case, case["answer"])["verdict"] == case.get("recorded_verdict", "right"), case["id"]
    assert [c["id"] for c in WALLS if c.get("recorded_verdict") == "wrong"] == ["wall-26"]
