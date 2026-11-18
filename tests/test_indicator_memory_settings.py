"""LEARN THE MEMBER, slice C: what a member can SEE, CHANGE and FORGET of what Create Indicator
remembers about them (Settings: "What Create Indicator remembers").

The rules proved here:

* the view lists EVERY question the door can remember an answer to, with this member's answer and
  WHERE it came from (an answer to a question, or set in Settings) and when;
* a member can only ever store one of a question's OWN choices (a length: a whole number in range);
  anything else is refused and NOTHING is written;
* forgetting one choice leaves the others; forgetting everything removes the row;
* what is set in Settings is what the door then uses, and says;
* through the routes: a member reads and changes only their own; the routes carry the same two
  gates as the conversation itself.

No model is called anywhere here except the one scripted turn that proves the door uses a choice set
in Settings.
"""
from __future__ import annotations

import pytest

from api.services import indicator_memory as im
from tests.test_indicator_memory import CHART, DAY, account, ema, memory_of  # noqa: F401 -- fixtures by name
from tests.test_p2_truth_server import conv, emits, empty_view, model  # noqa: F401 -- fixtures by name
from tests.test_p2x_truth_converse import MEMBER, MEMBER2, clean_env, http_as  # noqa: F401 -- fixtures by name

URL = "/api/user-definitions/assistant-memory"


def row(view, qid):
    return next(q for q in view["questions"] if q["id"] == qid)


# ═══ 1. the view ═════════════════════════════════════════════════════════════

def test_the_view_lists_every_question_the_door_can_remember_even_with_nothing_remembered(conv, account):
    view = conv.memory_view(memory_of(account))
    assert [q["id"] for q in view["questions"]] == list(conv.clarify_registry())
    assert view["remembers"] == 0 and all(q["remembered"] is None for q in view["questions"])
    for q in view["questions"]:
        registry = conv.clarify_registry()[q["id"]]
        assert q["title"] == registry["title"] and q["question"] == registry["text"]
        assert q["choices"], q["id"]
        # every choice is a label the door shows and a closed value it can store
        assert all(set(c) == {"label", "value"} and c["label"] in registry["choices"] for c in q["choices"])
        assert q["use"] == ("Used without asking, and said each time." if registry["remember"] == "default"
                            else "Asked each time, with yours listed first.")
    # no memory at all (a caller with none) reads the same as nothing remembered
    assert conv.memory_view(None) == view


def test_every_registry_question_has_a_title_for_settings(conv):
    """A question added to the registry without a title would show a blank row."""
    for qid, q in conv.clarify_registry().items():
        assert isinstance(q.get("title"), str) and 3 <= len(q["title"]) <= 40, qid
        assert q["title"][0].isupper() and not q["title"].isupper() and not q["title"].endswith("?"), qid


def test_the_view_says_where_each_choice_came_from_and_when(conv, account):
    memory = memory_of(account)
    memory.remember("average_kind", "ema", "Exponential (EMA)")              # an answer to its question
    assert conv.set_memory(memory, "cross_meaning", "touch") is True          # set in Settings
    view = conv.memory_view(memory)
    assert view["remembers"] == 2
    assert row(view, "average_kind")["remembered"] == {
        "label": "Exponential (EMA)", "value": "ema", "last": DAY.isoformat(), "times": 1, "from": "answer"}
    assert row(view, "cross_meaning")["remembered"] == {
        "label": "As soon as price trades through it", "value": "touch", "last": DAY.isoformat(), "times": 1,
        "from": "settings"}
    assert row(view, "average_length")["remembered"] is None


def test_an_entry_for_a_question_the_registry_no_longer_has_is_not_shown(conv, account):
    memory = memory_of(account)
    memory.remember("average_kind", "ema", "Exponential (EMA)")
    account["u1"] = account["u1"].replace("average_kind", "retired_question")
    view = conv.memory_view(memory)
    assert view["remembers"] == 0 and all(q["remembered"] is None for q in view["questions"])


# ═══ 2. the member's own edits ═══════════════════════════════════════════════

def test_a_member_can_set_any_of_a_questions_own_choices(conv, account):
    for qid in conv.clarify_registry():
        for choice in conv.memory_choices(qid):
            memory = memory_of(account, user_id=f"{qid}-{choice['value']}")
            assert conv.set_memory(memory, qid, choice["value"]) is True, (qid, choice)
            kept = memory.choice(qid)
            assert kept["value"] == choice["value"] and kept["label"] == choice["label"] and kept["from"] == "settings"


@pytest.mark.parametrize("qid,value,why", [
    ("average_kind", "tma", "not one of the question's kinds"),
    ("average_kind", "Exponential (EMA)", "a label is not a value"),
    ("average_kind", 20, "a number is not a kind"),
    ("average_kind", "", "empty"),
    ("cross_meaning", "ema", "another question's value"),
    ("cross_meaning", True, "a yes/no is not a choice"),
    ("average_length", 0, "below the range"),
    ("average_length", 961, "above the range"),
    ("average_length", 20.5, "not a whole number"),
    ("average_length", "20", "text is not a number"),
    ("average_length", True, "a yes/no is not a number"),
    ("average_length", float("nan"), "not a number at all"),
    ("retired_question", "ema", "no such question"),
    (None, "ema", "no question"),
    (["average_kind"], "ema", "not a question id"),
])
def test_anything_else_is_refused_and_NOTHING_is_written(conv, account, qid, value, why):
    memory = memory_of(account)
    assert conv.set_memory(memory, qid, value) is False, why
    assert account == {}, why


def test_a_length_may_be_any_whole_number_in_range_not_only_the_listed_ones(conv, account):
    memory = memory_of(account)
    lo, hi = conv.MEMORY_LENGTH_RANGE
    for n in (lo, 21, 21.0, hi):
        assert conv.set_memory(memory, "average_length", n) is True
        kept = memory.choice("average_length")
        assert kept["value"] == int(n) and isinstance(kept["value"], int) and kept["label"] == str(int(n))


def test_setting_again_replaces_and_forgetting_one_leaves_the_others(conv, account):
    memory = memory_of(account)
    assert conv.set_memory(memory, "average_kind", "ema") and conv.set_memory(memory, "cross_meaning", "close")
    assert conv.set_memory(memory, "average_kind", "hma")
    assert memory.choice("average_kind")["value"] == "hma"
    assert memory.forget("average_kind") is True
    view = conv.memory_view(memory)
    assert row(view, "average_kind")["remembered"] is None and row(view, "cross_meaning")["remembered"]["value"] == "close"
    assert memory.forget() is True and account == {}                          # the row itself is gone


def test_what_is_set_in_settings_is_what_the_door_then_uses_and_says(conv, account, clean_env, model):
    memory = memory_of(account)
    assert conv.set_memory(memory, "average_kind", "ema")
    client = model([emits(ema(50))])
    r = conv.converse("Add a 50 day moving average", user_id="u1", view=empty_view(0), chart=CHART, memory=memory)
    assert r["disposition"] == "change" and len(client.calls) == 1             # not asked
    assert r["envelope"]["assumptions"][0] == {
        "text": "Using an exponential average, as you chose before. Name another kind to change it."}
    # forgotten: the door asks again, with no model call
    memory.forget("average_kind")
    client = model([])
    r = conv.converse("Add a 50 day moving average", user_id="u1", view=empty_view(0), chart=CHART, memory=memory)
    assert r["disposition"] == "clarify" and r["asked"] == "average_kind" and client.calls == []


# ═══ 3. through the routes: the member's OWN account, and no one else's ══════

@pytest.fixture
def stored(account, monkeypatch):
    monkeypatch.setattr(im, "_account_reader", lambda u: account.get(str(u)))
    monkeypatch.setattr(im, "_account_writer",
                        lambda u, text: account.pop(str(u), None) if text is None else account.__setitem__(str(u), text))
    return account


def test_through_the_routes_a_member_sees_changes_and_forgets_their_own(conv, stored, http_as):
    mine = http_as(MEMBER)
    view = mine.get(URL).json()
    assert view["remembers"] == 0 and [q["id"] for q in view["questions"]] == list(conv.clarify_registry())

    view = mine.put(URL, json={"question": "average_kind", "value": "ema"}).json()
    assert row(view, "average_kind")["remembered"]["value"] == "ema" and row(view, "average_kind")["remembered"]["from"] == "settings"
    view = mine.put(URL, json={"question": "average_length", "value": 21}).json()
    assert row(view, "average_length")["remembered"]["value"] == 21 and view["remembers"] == 2
    assert set(stored) == {MEMBER["id"]}

    # another member sees none of it, and their own change touches only their own row
    theirs = http_as(MEMBER2)
    assert theirs.get(URL).json()["remembers"] == 0
    theirs.put(URL, json={"question": "average_kind", "value": "sma"})
    assert im.parse(stored[MEMBER["id"]])["choices"]["average_kind"]["value"] == "ema"
    assert im.parse(stored[MEMBER2["id"]])["choices"]["average_kind"]["value"] == "sma"
    assert theirs.delete(URL).json()["remembers"] == 0 and set(stored) == {MEMBER["id"]}

    # forget one, then everything
    mine = http_as(MEMBER)
    view = mine.delete(URL, params={"question": "average_kind"}).json()
    assert row(view, "average_kind")["remembered"] is None and row(view, "average_length")["remembered"]["value"] == 21
    assert mine.delete(URL).json()["remembers"] == 0 and stored == {}


@pytest.mark.parametrize("body,status", [
    ({"question": "average_kind", "value": "tma"}, 400),
    ({"question": "average_length", "value": 5000}, 400),
    ({"question": "nope", "value": "ema"}, 400),
    ({"question": "average_kind"}, 422),
    ({"value": "ema"}, 422),
    ({"question": "average_kind", "value": {"a": 1}}, 422),
    ({"question": "x" * 33, "value": "ema"}, 422),
])
def test_through_the_route_a_value_that_is_not_the_questions_own_is_refused_and_nothing_is_written(
        conv, stored, http_as, body, status):
    r = http_as(MEMBER).put(URL, json=body)
    assert r.status_code == status, r.text
    assert stored == {}
    if status == 400:
        assert r.json()["detail"] == "That is not one of this question's choices."


def test_forgetting_a_question_that_is_not_remembered_changes_nothing(conv, stored, http_as):
    mine = http_as(MEMBER)
    mine.put(URL, json={"question": "average_kind", "value": "ema"})
    before = dict(stored)
    for q in ("cross_meaning", "nope", ""):
        r = mine.delete(URL, params={"question": q})
        assert r.status_code == 200 and r.json()["remembers"] == 1, q
    assert stored == before


def test_the_three_routes_carry_the_same_two_gates_as_the_conversation():
    """Paid, and admitted to Create Indicator: read from the route table, so a route added or
    re-declared without them fails here."""
    from api.routers import user_definitions as router_mod

    def gates(path, method):
        (route,) = [r for r in router_mod.router.routes
                    if getattr(r, "path", "").endswith(path) and method in getattr(r, "methods", ())]
        return {d.call for d in route.dependant.dependencies}

    want = gates("/converse", "POST")
    assert {router_mod.require_paid, router_mod.require_admin_dark_rollout} <= want
    for method in ("GET", "PUT", "DELETE"):
        assert {router_mod.require_paid, router_mod.require_admin_dark_rollout} <= gates("/assistant-memory", method), method


def test_the_memory_routes_are_declared_before_the_one_that_takes_an_id():
    """`/{def_id}` would otherwise answer `/assistant-memory` as a definition id."""
    from api.routers import user_definitions as router_mod
    paths = [getattr(r, "path", "") for r in router_mod.router.routes]
    first_id = next(i for i, p in enumerate(paths) if p.endswith("/{def_id}"))
    assert all(i < first_id for i, p in enumerate(paths) if p.endswith("/assistant-memory"))
