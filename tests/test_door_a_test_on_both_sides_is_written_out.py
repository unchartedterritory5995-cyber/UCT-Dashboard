"""A TEST ON BOTH SIDES OF A BAR, IN THE MEMBER'S WORDS, IS WRITTEN OUT AT A LAG OF N, STRICT WHERE THE WORDS ARE (2026-11-24).

⚰️ MEASURED 2026-11-24 as the MEMBER account: cap-03 ("Plot the average of the last 5 swing highs as a line, where a
swing high is a bar whose high is above the highs of the 3 bars before it and the 3 bars after it") came back 0 of 3
right by its own rule, 739 of 1,643 bars wrong, each answer built on the function table's entry for that shape. The
engine's function is TradingView-exact (the e97 builder checked it): it admits an equal high on the left and places
its value on the marked bar. The member's words ask for neither. So the gap is the assistant's, and STRICT_WORDS_RULE,
already in the instructions, was not enough on its own.

The rule now also says what such words ARE in the formula's own terms (offsets compared with > on each side, at a
lag of N, the value known N bars after the bar it marks), and still names no function and restates nothing the table
says (`test_door_says_the_doors_and_the_table_says_the_functions.py` holds that).

Held here, with no model call: the rule's words; the formula built EXACTLY as the rule describes it, for cap-03's
numbers, is RIGHT by cap-03's own rule on every bar, while the recorded answer stays WRONG; and each half of the rule
matters: the same recipe with >= on the left, or reading the value on this bar instead of N back, is WRONG.
Whether the assistant now writes it is measured live after this serves (the case's rule, the member account).
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

from api.services import definition_conversation as dc
from tools.value_cases import grade as G

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "tests" / "fixtures" / "authoring" / "value_cases.json").read_text(encoding="utf-8"))
CAP03 = next(c for c in DATA["cases"] if c["id"] == "cap-03")
H = {"type": "series", "name": "high"}
num = lambda v: {"type": "num", "value": v}  # noqa: E731
op = lambda name, *a: {"type": "op", "name": name, "args": list(a)}  # noqa: E731
call = lambda name, *a: {"type": "call", "name": name, "args": list(a)}  # noqa: E731
EXTENSION = "A TEST ON BOTH SIDES OF A BAR IS WRITTEN OUT THE SAME WAY"


def offset(n, x):
    return x if n == 0 else {"type": "offset", "value": n, "args": [x]}


def as_the_rule_says(n=3, last=5, left=">", read_back=None):
    """The formula the rule describes, for "the average of the last `last` values": the bar n back, compared with
    `left` against each of the n bars before it and > against each of the n bars after it, joined with &&; its value
    offset n of high (or `read_back`); the last `last` values of it where the condition held, averaged."""
    marked = offset(n, H)
    tests = [op(left, marked, offset(n + k, H)) for k in range(1, n + 1)] + [op(">", marked, offset(n - k, H)) for k in range(1, n + 1)]
    cond = tests[0]
    for t in tests[1:]:
        cond = op("&&", cond, t)
    value = marked if read_back is None else read_back
    total = call("valuewhenOccurrence", cond, value, num(0))
    for i in range(1, last):
        total = op("+", total, call("valuewhenOccurrence", cond, value, num(i)))
    return op("/", total, num(last))


def graded(tree):
    answer = copy.deepcopy(CAP03["answer"])
    answer["ops"][0]["outputs"][0]["tree"] = tree
    return G.grade_case({**CAP03, "answer": answer}, answer)


def test_the_rule_says_what_the_words_are_in_the_formulas_own_terms():
    rule = dc.STRICT_WORDS_RULE
    assert dc.CONVERSE_SYSTEM_PROMPT.count(rule) == 1
    assert rule.index("A STRICT WORD STAYS STRICT INSIDE A FUNCTION") < rule.index(EXTENSION)     # it extends that one
    for part in (EXTENSION,
                 "\"a bar whose high is above the highs of the N bars before it and the N bars after it\" is, on each bar, the bar N back",
                 "(offset N of high) > (offset N+k of high) and (offset N of high) > (offset N-k of high) for every k from 1 to N",
                 "all joined with &&", "with >= only where the member says \"at least\"",
                 "Its value is offset N of high, and it is known on this bar, N bars after the bar it marks",
                 "say in `reply` that each one is known N bars after the bar it marks"):
        assert part in rule, part


def test_THE_FINDING_the_formula_the_rule_describes_is_right_by_cap03s_own_rule():
    got = graded(as_the_rule_says())
    assert got["verdict"] == "right", got["lines"]
    assert any("on 1643 bars" in str(line) for line in got["lines"]), got["lines"]
    # the recorded answer (the table's function for that shape) stays wrong, by the same rule, as recorded
    assert CAP03.get("recorded_verdict") == "wrong"
    assert G.grade_case(CAP03, CAP03["answer"])["verdict"] == "wrong"


def test_each_half_of_the_rule_matters():
    # an equal high admitted on the left (the function's own tie rule) is wrong: the words say "above"
    assert graded(as_the_rule_says(left=">="))["verdict"] == "wrong"
    # the value read on THIS bar instead of the bar N back is wrong
    assert graded(as_the_rule_says(read_back=H))["verdict"] == "wrong"
    # control: the grader can still see the right one (not "wrong" for everything)
    assert graded(as_the_rule_says())["verdict"] == "right"
