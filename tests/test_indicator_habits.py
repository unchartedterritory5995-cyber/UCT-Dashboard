"""WHAT A MEMBER USUALLY USES, read from their own saved indicators (`api/services/indicator_habits.py`;
slice E of "clarify and learn").

The door asks before it assumes. A member's usual kind of average and usual lengths are offered
FIRST when they are a habit, and never applied unasked. Held here: what counts as a habit (at
least three saved indicators, a majority, no tie), that one indicator counts once however many
averages it holds, and that nothing but the formulas of the member's own indicators is read.
"""
from __future__ import annotations

import pytest

from api.services import indicator_habits as ih

S = lambda n: {"type": "series", "name": n}  # noqa: E731
num = lambda v: {"type": "num", "value": v}  # noqa: E731
call = lambda name, *a: {"type": "call", "name": name, "args": list(a)}  # noqa: E731
op = lambda name, *a: {"type": "op", "name": name, "args": list(a)}  # noqa: E731
CLOSE = S("close")


def saved(*trees, row=False):
    doc = {"compute": {"kind": "ast", "trees": {f"o{i}": t for i, t in enumerate(trees)}}}
    return {"id": "x", "definition": doc} if row else doc


def avg(kind, n):
    return call(kind, CLOSE, num(n))


# ═══ 1. reading one formula ══════════════════════════════════════════════════

def test_every_average_in_a_formula_is_found_with_its_length():
    tree = op("-", avg("ema", 12), op("/", avg("ema", 26), call("sma", avg("wma", 9), num(3))))
    assert sorted(ih.averages_in(tree)) == [("ema", 12), ("ema", 26), ("sma", 3), ("wma", 9)]
    assert ih.averages_in(call("rsi", CLOSE, num(14))) == []                     # not an average the question offers
    assert ih.averages_in(call("ema", CLOSE, S("len"))) == [("ema", None)]        # a setting for a length: the kind counts, no length does
    assert ih.averages_in(call("ema", CLOSE, num(20.5))) == [("ema", None)]       # not a whole number of bars
    assert ih.averages_in(call("vwma", CLOSE, S("volume"), num(20))) == [("vwma", 20)]
    for not_a_tree in (None, 3, "ema", [], {"type": "call", "name": "ema"}):
        assert ih.averages_in(not_a_tree) in ([], [("ema", None)])


def test_a_formula_far_past_any_saved_size_is_read_to_a_bound_and_no_further():
    node = avg("ema", 5)
    for _ in range(ih.MAX_NODES + 50):
        node = op("+", node, num(1))
    assert ih.averages_in(node) == []                                            # the one average sits past the bound
    wide = op("+", *[avg("sma", 10)] * 2)
    assert ih.averages_in(wide) == [("sma", 10), ("sma", 10)]


# ═══ 2. counting over saved indicators ═══════════════════════════════════════

def test_one_indicator_counts_once_however_many_averages_it_holds():
    ribbon = saved(*[avg("ema", n) for n in (8, 13, 21, 34, 55)])
    counts = ih.habits([ribbon, saved(avg("ema", 21)), saved(avg("sma", 50), avg("sma", 200)), saved(call("rsi", CLOSE, num(14)))])
    assert counts["indicators"] == 4 and counts["with_an_average"] == 3
    assert counts["kinds"] == [{"value": "ema", "indicators": 2}, {"value": "sma", "indicators": 1}]
    assert counts["lengths"][0] == {"value": 21, "indicators": 2}                 # in the ribbon and in the single line


def test_a_stored_row_and_a_bare_document_are_both_read_and_a_script_is_not():
    counts = ih.habits([saved(avg("ema", 20), row=True), saved(avg("ema", 20)),
                        {"compute": {"kind": "pine", "source": "plot(ta.ema(close, 20))"}},
                        {"compute": {"kind": "pine", "trees": {"a": avg("sma", 20)}}},  # a script, whatever it carries
                        {"compute": {"kind": "ast", "ast": avg("hma", 55)}},           # the single-formula form
                        None, 3, {"definition": None}, {}])
    assert counts["indicators"] == 3 and counts["with_an_average"] == 3
    assert {k["value"]: k["indicators"] for k in counts["kinds"]} == {"ema": 2, "hma": 1}


def test_only_the_newest_are_read():
    many = [saved(avg("sma", 10))] * (ih.MAX_DEFINITIONS + 25)
    assert ih.habits(many)["indicators"] == ih.MAX_DEFINITIONS
    assert ih.habits(None) == {"indicators": 0, "with_an_average": 0, "kinds": [], "lengths": []}


# ═══ 3. what is a habit ══════════════════════════════════════════════════════

def member(**kinds):
    """Saved indicators by kind: member(ema=4, sma=1) is four that use an EMA and one an SMA."""
    return [saved(avg(kind, 20 + i)) for kind, n in kinds.items() for i in range(n)]


def test_the_usual_kind_is_offered_only_when_it_is_a_habit():
    assert ih.usual_kind(ih.habits(member(ema=4, sma=1))) == {"value": "ema", "indicators": 4, "of": 5}
    assert ih.usual_kind(ih.habits(member(ema=3))) == {"value": "ema", "indicators": 3, "of": 3}
    # two saved indicators are a coincidence
    assert ih.usual_kind(ih.habits(member(ema=2))) is None
    # the most used, but not most of them
    assert ih.usual_kind(ih.habits(member(ema=3, sma=2, wma=2))) is None           # 3 of 7
    assert ih.usual_kind(ih.habits(member(ema=3, sma=3))) is None                  # exactly half, and a tie
    assert ih.usual_kind(ih.habits(member(ema=3, sma=2, wma=1))) is None           # exactly half with no tie: half is not most
    assert ih.usual_kind(ih.habits(member(ema=4, sma=3))) == {"value": "ema", "indicators": 4, "of": 7}
    assert ih.usual_kind(ih.habits([])) is None and ih.usual_kind({}) is None


def test_an_indicator_that_uses_two_kinds_counts_for_both_and_a_tie_is_no_habit():
    both = [saved(avg("ema", 10), avg("sma", 50))] * 4
    counts = ih.habits(both)
    assert counts["kinds"] == [{"value": "sma", "indicators": 4}, {"value": "ema", "indicators": 4}]   # tie: the question's own order
    assert ih.usual_kind(counts) is None


def test_the_usual_lengths_are_the_ones_used_in_three_or_more_most_used_first():
    lib = [saved(avg("ema", 21))] * 5 + [saved(avg("sma", 50))] * 3 + [saved(avg("sma", 200))] * 3 + [saved(avg("ema", 9))] * 2
    lengths = ih.usual_lengths(ih.habits(lib))
    assert lengths == [{"value": 21, "indicators": 5, "of": 13}, {"value": 50, "indicators": 3, "of": 13}]   # two at most; 50 before 200 on a tie
    assert ih.usual_lengths(ih.habits(member(ema=2))) == []
    assert ih.usual_lengths({}) == []


def test_the_kinds_are_the_ones_the_doors_own_question_offers():
    """A habit the question could not offer would be offered nowhere."""
    import io
    import json
    import pathlib
    doc = json.load(io.open(pathlib.Path(__file__).resolve().parents[1] / "api" / "data" / "clarify_questions.json", encoding="utf-8"))
    text = json.dumps(doc)
    for kind in ih.AVERAGE_KINDS:
        assert f'"{kind}"' in text, kind
