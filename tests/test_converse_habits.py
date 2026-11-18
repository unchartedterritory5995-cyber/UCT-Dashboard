"""WHAT A MEMBER USUALLY USES IS OFFERED FIRST WHEN THE DOOR ASKS (slice E of "clarify and learn").

Owner direction, 2026-11-18: "always clarify and build your intelligence better constantly. Learn
about the member and what they want and do!" The door asks before it assumes. A member whose saved
indicators mostly use an exponential average should not have to read past "Simple" every time:

  * their usual kind, or their usual lengths, are listed FIRST and marked "(your usual)";
  * the question says WHY in one more sentence (the counts);
  * nothing is applied without being chosen, and a tapped choice is read back as that choice;
  * it is derived from the formulas of the member's OWN saved indicators each time it is needed.
    Nothing is stored, and Settings shows it ("What Create Indicator remembers").

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import pytest

from api.services import indicator_memory
from tests.test_p2_truth_server import call, conv, emits, empty_view, env, model, num  # noqa: F401 -- fixtures by name
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

S = lambda n: {"type": "series", "name": n}  # noqa: E731
CHART = {"sym": "NVDA", "tf": "D"}


def saved(kind, n):
    return {"definition": {"compute": {"kind": "ast", "trees": {"line": call(kind, S("close"), num(n))}}}}


EMA_MEMBER = [saved("ema", 21)] * 4 + [saved("ema", 9)] * 3 + [saved("sma", 50)] * 2      # 7 of 9 use an EMA; 21 in four
NO_HABIT = [saved("ema", 21), saved("sma", 50)]


def memory_of(doc=None):
    box = {"text": doc}
    return indicator_memory.Memory("u1", reader=lambda _u: box["text"], writer=lambda _u, t: box.__setitem__("text", t))


# ═══ 1. the choices and the sentence ═════════════════════════════════════════

def test_the_usual_kind_is_named_with_its_counts_and_only_when_it_is_a_habit(conv):
    got = conv.usual_choices("average_kind", EMA_MEMBER)
    assert got["labels"] == ["Exponential (EMA)"]
    assert got["why"] == "You usually use Exponential (EMA): it is in 7 of your 9 saved indicators that use an average."
    assert conv.usual_choices("average_kind", NO_HABIT) == {}
    assert conv.usual_choices("average_kind", []) == {} and conv.usual_choices("average_kind", None) == {}


def test_the_usual_lengths_are_named_most_used_first(conv):
    got = conv.usual_choices("average_length", EMA_MEMBER)
    assert got["labels"] == ["21", "9"]
    assert got["why"] == "Your saved indicators most often use 21 and 9."
    assert conv.usual_choices("average_length", NO_HABIT) == {}


def test_no_other_question_reads_the_members_indicators(conv):
    for qid in conv.clarify_registry():
        if qid not in conv.HABIT_QUESTIONS:
            assert conv.usual_choices(qid, EMA_MEMBER) == {}, qid
    assert conv.HABIT_QUESTIONS == ("average_kind", "average_length")


def test_a_store_that_cannot_be_read_is_no_habit_and_no_failed_turn(conv):
    class Broken:
        def __iter__(self):
            raise RuntimeError("the store is down")
    assert conv.usual_choices("average_kind", Broken()) == {}


def test_the_usual_choice_is_listed_first_marked_and_the_question_says_why(conv):
    q = conv.offered_first(conv.clarify_question("average_kind"), None, conv.usual_choices("average_kind", EMA_MEMBER))
    assert q["choices"][0] == "Exponential (EMA) (your usual)"
    assert q["choices"][1:] == ["Simple (SMA)", "Weighted (WMA)", "Hull (HMA)", "Volume-weighted (VWMA)", "Kaufman adaptive (KAMA)"]
    assert q["text"] == ("Which kind of moving average? You usually use Exponential (EMA): it is in 7 of your 9 saved "
                         "indicators that use an average.")
    # no habit: the question is the registry's own, word for word
    assert conv.offered_first(conv.clarify_question("average_kind"), None, {}) == conv.clarify_question("average_kind")
    assert conv.offered_first(conv.clarify_question("average_kind"), None) == conv.clarify_question("average_kind")


def test_the_last_answer_comes_before_the_usual_ones_and_nothing_is_listed_twice(conv):
    memory = memory_of()
    memory.remember("average_length", 21, "21")
    q = conv.offered_first(conv.clarify_question("average_length"), memory, conv.usual_choices("average_length", EMA_MEMBER))
    assert q["choices"] == ["21 (your last)", "9 (your usual)", "10", "20", "50", "200"]     # 21 is both: said once, as the last
    assert q["text"].endswith("Your saved indicators most often use 21 and 9.")
    assert len(q["choices"]) <= 6
    # only the last answer, no habit: as it was before this slice
    q = conv.offered_first(conv.clarify_question("average_length"), memory, {})
    assert q["choices"] == ["21 (your last)", "10", "20", "50", "200"] and q["text"] == "How many bars should the average use?"


def test_the_list_never_grows_past_six_and_says_why_only_when_a_usual_choice_is_shown(conv):
    # a last answer that is neither usual one, and two usual ones: seven candidates, six shown
    memory = memory_of()
    memory.remember("average_length", 33, "33")
    q = conv.offered_first(conv.clarify_question("average_length"), memory, conv.usual_choices("average_length", EMA_MEMBER))
    assert q["choices"] == ["33 (your last)", "21 (your usual)", "9 (your usual)", "10", "20", "50"] and len(q["choices"]) == 6
    # the only usual length IS the last answer: it is shown once, as the last, and no sentence about a habit is added
    only_21 = [saved("ema", 21)] * 4
    memory = memory_of()
    memory.remember("average_length", 21, "21")
    q = conv.offered_first(conv.clarify_question("average_length"), memory, conv.usual_choices("average_length", only_21))
    assert q["choices"] == ["21 (your last)", "10", "20", "50", "200"]
    assert q["text"] == "How many bars should the average use?"


def test_no_mark_holds_a_digit_so_a_tapped_choice_is_read_as_that_choice(conv):
    """A tapped choice comes back as the member's message. A number in the mark would be read as a
    length: "Exponential (EMA), in 7 of 9" would ask for a 7-bar average."""
    for mark in (conv.LAST_MARK, conv.USUAL_MARK):
        assert not any(ch.isdigit() for ch in mark), mark
    for qid, definitions in (("average_kind", EMA_MEMBER), ("average_length", EMA_MEMBER)):
        q = conv.offered_first(conv.clarify_question(qid), None, conv.usual_choices(qid, definitions))
        tapped = q["choices"][0]
        answered = {"message": f"add a moving average. {tapped}", "answer": tapped}
        chosen = conv.answer_value(qid, answered, CHART)
        assert chosen is not None, (qid, tapped)
        assert chosen[0] == ("ema" if qid == "average_kind" else 21), (qid, chosen)


# ═══ 2. through the door ═════════════════════════════════════════════════════

def test_the_door_asks_with_the_usual_kind_first_and_never_builds_it_unasked(conv, clean_env, model):
    client = model([])
    r = conv.converse("add a 20 day moving average", user_id="u1", view=empty_view(0), chart=CHART,
                      saved=lambda _user: EMA_MEMBER)
    assert r["ok"] is True and r["disposition"] == "clarify" and len(client.calls) == 0       # asked, by the door, for nothing
    (q,) = r["envelope"]["questions"]
    assert q["choices"][0] == "Exponential (EMA) (your usual)" and "7 of your 9" in q["text"]
    assert r["envelope"]["ops"] == []                                                          # nothing was built


def test_a_member_with_no_habit_is_asked_the_plain_question_and_their_store_is_read_only_for_these_questions(conv, clean_env, model):
    model([])
    r = conv.converse("add a 20 day moving average", user_id="u1", view=empty_view(0), chart=CHART, saved=lambda _user: NO_HABIT)
    (q,) = r["envelope"]["questions"]
    assert q == conv.clarify_question("average_kind")
    # a turn that asks nothing never reads the member's indicators
    reads = []
    model([emits(env(0, [{"op": "create", "name": "EMA 20", "placement": "price",
                          "outputs": [{"key": "ma", "tree": call("ema", S("close"), num(20))}]}]))])
    r = conv.converse("add a 20 day EMA", user_id="u1", view=empty_view(0), chart=CHART,
                      saved=lambda user: reads.append(user) or EMA_MEMBER)
    assert r["ok"] is True and r["disposition"] == "change" and reads == []


def test_a_question_no_habit_can_answer_never_reads_the_members_indicators(conv, clean_env, model):
    reads = []
    model([])
    r = conv.converse("mark when price crosses the 50 day EMA", user_id="u1", view=empty_view(0), chart=CHART,
                      saved=lambda user: reads.append(user) or EMA_MEMBER)
    assert r["ok"] is True and r["disposition"] == "clarify"
    assert r["envelope"]["questions"][0]["id"] == "cross_meaning" and reads == []
    # CONTROL: the question a habit CAN answer reads them, once, for this member
    conv.converse("add a 20 day moving average", user_id="u7", view=empty_view(0), chart=CHART,
                  saved=lambda user: reads.append(user) or EMA_MEMBER)
    assert reads == ["u7"]


def test_a_saved_reader_that_fails_costs_the_habit_and_not_the_turn(conv, clean_env, model):
    model([])

    def broken(_user):
        raise RuntimeError("the store is down")
    r = conv.converse("add a 20 day moving average", user_id="u1", view=empty_view(0), chart=CHART, saved=broken)
    assert r["ok"] is True and r["envelope"]["questions"][0] == conv.clarify_question("average_kind")


# ═══ 3. Settings ═════════════════════════════════════════════════════════════

def test_settings_says_what_the_member_usually_uses_on_the_row_it_belongs_to(conv):
    view = conv.memory_view(memory_of(), EMA_MEMBER)
    rows = {r["id"]: r for r in view["questions"]}
    assert rows["average_kind"]["usual"] == (
        "From your saved indicators: Exponential (EMA), in 7 of 9 that use an average. Offered first when it asks, never "
        "used without you choosing; nothing is stored.")
    assert rows["average_length"]["usual"].startswith("From your saved indicators: 21 (in 4), 9 (in 3).")
    assert all(r["usual"] is None for qid, r in rows.items() if qid not in conv.HABIT_QUESTIONS)
    # no habit, or no indicators handed in: no line
    assert all(r["usual"] is None for r in conv.memory_view(memory_of(), NO_HABIT)["questions"])
    assert all(r["usual"] is None for r in conv.memory_view(memory_of())["questions"])
    # and it is not something remembered: the count of remembered choices is unchanged
    assert view["remembers"] == 0
