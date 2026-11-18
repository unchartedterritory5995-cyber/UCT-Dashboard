"""LEARN THE MEMBER: what Create Indicator remembers, and how the door uses it.

Owner direction, 2026-11-18: "Learn about the member and what they want and do." The first time a
choice that changes the maths is open, the door ASKS. The member's answer is remembered in their
own account (`api/services/indicator_memory.py`, one row of `user_preferences`), and from then on
the door uses it and SAYS so, instead of asking again.

Held here:
  * the store keeps ONLY closed values (a question's id, one of its own values or a number, the
    label tapped, a count, a date, a source); anything else is dropped on the way in AND out;
  * it never breaks a turn (reading fails open, writing fails quiet);
  * an ANSWER is remembered on its first use; a remembered `default` is used instead of asking,
    and the member is told; a remembered `offer` is asked again with their last answer first;
  * a different answer later replaces it; forgetting removes it;
  * one member's memory is never another's;
  * a turn given no memory remembers nothing and uses nothing.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``. The account
store is a dict here; the route test at the end goes through the real route with it.
"""
from __future__ import annotations

import datetime as dt
import json

import pytest

from api.services import indicator_memory as im
from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    call, conv, emits, empty_view, env, model, num, out, view,
)
from tests.test_p2x_truth_converse import MEMBER, MEMBER2, clean_env, http_as  # noqa: F401 -- fixtures by name

CHART = {"sym": "NVDA", "tf": "D"}
S = lambda n: {"type": "series", "name": n}  # noqa: E731
DAY = dt.date(2026, 11, 18)


@pytest.fixture
def account():
    """A stand-in for the members' `user_preferences` rows: {user id: stored text}."""
    return {}


def memory_of(account, user_id="u1", today=DAY):
    return im.Memory(user_id, reader=lambda u: account.get(u),
                     writer=lambda u, text: account.pop(u, None) if text is None else account.__setitem__(u, text),
                     today=lambda: today)


def ema(n):
    return env(0, [{"op": "create", "name": f"EMA {n}", "placement": "price",
                    "outputs": [{"key": "ma", "tree": call("ema", S("close"), num(n))}]}])


def ask_then(question):
    return lambda words: [{"role": "member", "text": words}, {"role": "assistant", "text": question}]


KIND = ask_then("Which kind of moving average?")
LENGTH = ask_then("How many bars should the average use?")
CROSS = ask_then("When should a cross count?")


# ═══ 1. the store ════════════════════════════════════════════════════════════

def test_it_is_one_row_of_the_members_own_account():
    assert im.KEY == "create_indicator_memory" and im.empty() == {"v": 1, "choices": {}}
    assert im.SOURCES == ("answer", "settings")


def test_remember_read_and_forget(account):
    mem = memory_of(account)
    assert mem.read() == im.empty() and mem.choice("average_kind") is None
    assert mem.remember("average_kind", "ema", "Exponential (EMA)") is True
    assert mem.choice("average_kind") == {"value": "ema", "label": "Exponential (EMA)", "times": 1,
                                          "last": "2026-11-18", "from": "answer"}
    assert mem.remember("average_kind", "ema", "Exponential (EMA)") and mem.choice("average_kind")["times"] == 2
    # the newest answer wins, and the count starts again
    assert mem.remember("average_kind", "sma", "Simple (SMA)")
    assert mem.choice("average_kind")["value"] == "sma" and mem.choice("average_kind")["times"] == 1
    assert mem.remember("average_length", 21, "21") and mem.choice("average_length")["value"] == 21
    # forget one; the other stays
    assert mem.forget("average_kind") is True and mem.choice("average_kind") is None
    assert mem.choice("average_length")["value"] == 21 and mem.forget("average_kind") is False
    # forget everything: the row is gone, nothing else holds a copy
    assert mem.forget() is True and account == {} and mem.read() == im.empty()
    # forgetting the last choice removes the row too
    mem.remember("average_kind", "ema", "Exponential (EMA)")
    assert mem.forget("average_kind") is True and account == {}


@pytest.mark.parametrize("stored, why", [
    ("not json", "not a document"),
    ('["a list"]', "not an object"),
    ('{"v":1}', "no choices"),
    ('{"v":1,"choices":["x"]}', "choices are not an object"),
])
def test_a_document_that_is_not_one_reads_as_nothing(account, stored, why):
    account["u1"] = stored
    assert memory_of(account).read() == im.empty(), why


def test_ONLY_closed_values_survive_on_the_way_in_and_on_the_way_out(account):
    """A value written into the account by hand cannot reach the door: no sentence, no long
    string, no unknown shape."""
    account["u1"] = json.dumps({"v": 1, "choices": {
        "average_kind": {"value": "ema", "label": "Exponential (EMA)", "times": 3, "last": "2026-11-18", "from": "answer"},
        "sentence": {"value": "I trade the open and usually buy the first pullback", "label": "x"},
        "Bad Id": {"value": "ema", "label": "x"},
        "no_label": {"value": "ema"},
        "long_label": {"value": "ema", "label": "x" * 200},
        "a_bool": {"value": True, "label": "x"},
        "a_list": {"value": ["ema"], "label": "x"},
        "nan": {"value": float("inf"), "label": "x"},
        "odd_extras": {"value": 21, "label": "21", "times": -4, "last": "yesterday", "from": "the model", "note": "free text"},
    }})
    got = memory_of(account).read()["choices"]
    assert set(got) == {"average_kind", "odd_extras"}
    assert got["odd_extras"] == {"value": 21, "label": "21", "times": 1, "last": None, "from": "answer"}   # extras dropped
    assert "note" not in json.dumps(got) and "pullback" not in im.dump({"v": 1, "choices": got})
    mem = memory_of(account)
    for value, label in (("I usually use the exponential one", "x"), ("ema", ""), ("ema", "y" * 81), (None, "x"), ({"a": 1}, "x")):
        assert mem.remember("average_kind", value, label) is False
    assert mem.remember("Not An Id", "ema", "Exponential (EMA)") is False
    assert mem.choice("average_kind")["value"] == "ema"                    # nothing was overwritten by a refused write


def test_it_is_bounded(account):
    account["u1"] = json.dumps({"v": 1, "choices": {f"q{'a' * i}": {"value": "ema", "label": "x"} for i in range(1, 31)}})
    assert len(memory_of(account).read()["choices"]) == im.MAX_CHOICES


def test_it_never_breaks_a_turn():
    def boom(*_a):
        raise RuntimeError("the account store is down")
    dead = im.Memory("u1", reader=boom, writer=boom)
    assert dead.read() == im.empty() and dead.choice("average_kind") is None      # fails open
    assert dead.remember("average_kind", "ema", "Exponential (EMA)") is False       # fails quiet
    assert dead.forget() is False and dead.forget("average_kind") is False


def test_one_members_memory_is_never_anothers(account):
    memory_of(account, "u1").remember("average_kind", "ema", "Exponential (EMA)")
    assert memory_of(account, "u2").read() == im.empty()
    memory_of(account, "u2").remember("average_kind", "sma", "Simple (SMA)")
    assert memory_of(account, "u1").choice("average_kind")["value"] == "ema"
    assert set(account) == {"u1", "u2"}


# ═══ 2. what an answer IS ════════════════════════════════════════════════════

@pytest.mark.parametrize("asked, words, answer, want", [
    (KIND, "Add a 50 day moving average", "Exponential (EMA)", ("ema", "Exponential (EMA)")),
    (KIND, "Add a 50 day moving average", "simple please", ("sma", "Simple (SMA)")),
    (KIND, "Add a 50 day moving average", "the hull one", ("hma", "Hull (HMA)")),
    (KIND, "Add a 50 day moving average", "Kaufman adaptive (KAMA)", ("kama", "Kaufman adaptive (KAMA)")),
    (LENGTH, "Add an EMA", "50", (50, "50")),
    (LENGTH, "Add an EMA", "make it 21 bars", (21, "21")),
    (LENGTH, "Add an EMA", "21 (your last)", (21, "21")),
    (CROSS, "mark where price crosses above the 50 day EMA", "When the bar closes across it", ("close", "When the bar closes across it")),
    (CROSS, "mark where price crosses above the 50 day EMA", "on the close", ("close", "When the bar closes across it")),
    (CROSS, "mark where price crosses above the 50 day EMA", "As soon as price trades through it", ("touch", "As soon as price trades through it")),
])
def test_the_value_of_an_answer_is_one_of_the_questions_own(conv, asked, words, answer, want):
    got = conv.pending_answer(answer, asked(words), CHART)
    assert got is not None, (words, answer)
    assert conv.answer_value(got["question"], got, CHART) == want
    registry = conv.clarify_registry()[got["question"]]
    if "values" in registry:
        assert want[0] in registry["values"].values() and want[1] in registry["choices"]


def test_an_answer_that_is_none_of_the_choices_is_not_remembered(conv, account, clean_env, model):
    """"alma" is a kind of average the door reads, and it is no choice of the question: it settles
    the question for this request and teaches nothing."""
    got = conv.pending_answer("alma", KIND("Add a 50 day moving average"), CHART)
    assert got is not None and conv.answer_value("average_kind", got, CHART) is None
    mem = memory_of(account)
    model([emits(env(0, [{"op": "create", "name": "ALMA", "placement": "price",
                          "outputs": [{"key": "ma", "tree": call("alma", S("close"), num(50), num(0.85), num(6))}]}]))])
    conv.converse("alma", user_id="u1", view=empty_view(0), chart=CHART, snippets=KIND("Add a 50 day moving average"), memory=mem)
    assert account == {}
    # a length outside what a formula can use is not remembered either
    far = conv.pending_answer("5000", LENGTH("Add an EMA"), CHART)
    assert far is None or conv.answer_value("average_length", far, CHART) is None


# ═══ 3. the door: ask once, then use it and say so ═══════════════════════════

def test_the_first_time_it_asks_the_answer_is_remembered_and_next_time_it_is_used_and_SAID(conv, account, clean_env, model):
    mem = memory_of(account)
    # 1. the first time: asked
    client = model([])
    r = conv.converse("Add a 50 day moving average", user_id="u1", view=empty_view(0), chart=CHART, memory=mem)
    assert r["disposition"] == "clarify" and r["asked"] == "average_kind" and client.calls == [] and account == {}
    # 2. the answer builds, and is remembered on this first use
    client = model([emits(ema(50))])
    r = conv.converse("Exponential (EMA)", user_id="u1", view=empty_view(0), chart=CHART,
                      snippets=KIND("Add a 50 day moving average"), memory=mem)
    assert r["ok"] is True and r["disposition"] == "change" and len(client.calls) == 1
    assert mem.choice("average_kind")["value"] == "ema" and "remembered" not in r
    assert not any("as you chose before" in a.get("text", "") for a in r["envelope"].get("assumptions") or [])
    # 3. the next request that leaves the kind open: NOT asked; built with it; and the member is told
    client = model([emits(ema(20))])
    r = conv.converse("Add a 20 day moving average", user_id="u1", view=empty_view(0), chart=CHART, memory=mem)
    assert r["ok"] is True and r["disposition"] == "change" and len(client.calls) == 1, r
    assert r["remembered"] == ["average_kind"]
    assert r["envelope"]["assumptions"][0] == {
        "text": "Using an exponential average, as you chose before. Name another kind to change it."}
    sent = json.dumps(client.calls[0]["messages"][0]["content"])
    assert "Add a 20 day moving average. Exponential (EMA)" in sent          # the assistant is told the kind, as words
    assert conv.check_envelope(r["envelope"], 0, empty_view(0))


def test_naming_another_kind_is_never_overridden_by_the_memory(conv, account, clean_env, model):
    mem = memory_of(account)
    mem.remember("average_kind", "ema", "Exponential (EMA)")
    sma = env(0, [{"op": "create", "name": "SMA 20", "placement": "price",
                   "outputs": [{"key": "ma", "tree": call("sma", S("close"), num(20))}]}])
    client = model([emits(sma)])
    r = conv.converse("Add a 20 day simple moving average", user_id="u1", view=empty_view(0), chart=CHART, memory=mem)
    assert r["ok"] is True and "remembered" not in r
    assert "Exponential" not in json.dumps(client.calls[0]["messages"][0]["content"])
    assert not any("as you chose before" in a.get("text", "") for a in r["envelope"].get("assumptions") or [])
    assert mem.choice("average_kind")["value"] == "ema"                      # a named kind is not an ANSWER: nothing learned


def test_a_different_answer_later_replaces_the_remembered_one(conv, account, clean_env, model):
    mem = memory_of(account)
    mem.remember("cross_meaning", "close", "When the bar closes across it")
    mem.forget("cross_meaning")
    words = "mark where price crosses above the 50 day EMA"
    client = model([])
    assert conv.converse(words, user_id="u1", view=empty_view(0), chart=CHART, memory=mem)["asked"] == "cross_meaning"
    cross = env(0, [{"op": "create", "name": "Cross", "placement": "pane",
                     "outputs": [{"key": "x", "tree": call("crossOver", S("high"), call("ema", S("close"), num(50)))}]}])
    model([emits(cross)])
    conv.converse("As soon as price trades through it", user_id="u1", view=empty_view(0), chart=CHART,
                  snippets=CROSS(words), memory=mem)
    assert mem.choice("cross_meaning")["value"] == "touch"
    model([emits(cross)])
    r = conv.converse(words, user_id="u1", view=empty_view(0), chart=CHART, memory=mem)
    assert r["remembered"] == ["cross_meaning"]
    assert r["envelope"]["assumptions"][0]["text"] == (
        "A cross counts as soon as price trades through it, as you chose before. Say otherwise to change it.")


def test_a_length_is_offered_first_never_applied(conv, account, clean_env, model):
    """A length a member used before is the likeliest again, but lengths change from one indicator
    to the next: it is asked again, with theirs first."""
    mem = memory_of(account)
    model([emits(ema(21))])
    conv.converse("21", user_id="u1", view=empty_view(0), chart=CHART, snippets=LENGTH("Add an EMA"), memory=mem)
    assert mem.choice("average_length") == {"value": 21, "label": "21", "times": 1, "last": "2026-11-18", "from": "answer"}
    client = model([])
    r = conv.converse("Add an EMA", user_id="u1", view=empty_view(0), chart=CHART, memory=mem)
    assert r["disposition"] == "clarify" and r["asked"] == "average_length" and client.calls == []
    assert r["envelope"]["questions"][0]["choices"] == ["21 (your last)", "10", "20", "50", "200"]
    # a remembered length that IS one of the usual choices is not listed twice
    mem.remember("average_length", 50, "50")
    r = conv.converse("Add an EMA", user_id="u1", view=empty_view(0), chart=CHART, memory=mem)
    assert r["envelope"]["questions"][0]["choices"] == ["50 (your last)", "10", "20", "200"]
    assert conv.check_envelope(r["envelope"], 0, empty_view(0))


def test_two_remembered_defaults_are_both_used_and_both_said(conv, account, clean_env, model):
    mem = memory_of(account)
    mem.remember("average_kind", "ema", "Exponential (EMA)")
    mem.remember("cross_meaning", "close", "When the bar closes across it")
    cross = env(0, [{"op": "create", "name": "Cross", "placement": "pane",
                     "outputs": [{"key": "x", "tree": call("crossOver", S("close"), call("ema", S("close"), num(50)))}]}])
    client = model([emits(cross)])
    r = conv.converse("mark where price crosses above its 50 day moving average", user_id="u1", view=empty_view(0),
                      chart=CHART, memory=mem)
    assert r["ok"] is True and r["remembered"] == ["average_kind", "cross_meaning"] and len(client.calls) == 1
    said = [a["text"] for a in r["envelope"]["assumptions"]]
    assert any("an exponential average, as you chose before" in t for t in said)
    assert any("when the bar closes across it, as you chose before" in t for t in said)


def test_a_remembered_choice_is_said_beside_the_assistants_own_note(conv, account, clean_env, model):
    """REGRESSION (found 2026-11-18, live): the door's "as you chose before" sentence has no `output`
    (it is about the whole indicator). On a turn whose patch ALREADY carried an assumption, adding
    it raised, and the member read "the UCT Agent hit an internal problem". Every earlier test here
    answered with a patch that carried none, which is how it shipped."""
    mem = memory_of(account)
    mem.remember("average_kind", "ema", "Exponential (EMA)")
    with_a_note = env(0, [{"op": "create", "name": "EMA 20", "placement": "price",
                           "outputs": [{"key": "ma", "tree": call("ema", S("close"), num(20))}]}],
                      assumptions=[{"output": "ma", "text": "Drawn on the price pane."}])
    client = model([emits(with_a_note)])
    r = conv.converse("Add a 20 day moving average", user_id="u1", view=empty_view(0), chart=CHART, memory=mem)
    assert r["ok"] is True and r["disposition"] == "change" and len(client.calls) == 1, (r.get("gate"), r.get("reason"))
    assert r["envelope"]["assumptions"] == [
        {"text": "Using an exponential average, as you chose before. Name another kind to change it."},
        {"output": "ma", "text": "Drawn on the price pane."}]


def test_a_remembered_choice_the_registry_no_longer_offers_is_not_used(conv, account, clean_env, model):
    mem = memory_of(account)
    mem.remember("average_kind", "tma", "Triangular")                        # not one of the choices
    client = model([])
    r = conv.converse("Add a 20 day moving average", user_id="u1", view=empty_view(0), chart=CHART, memory=mem)
    assert r["disposition"] == "clarify" and r["asked"] == "average_kind" and client.calls == []


def test_a_turn_given_no_memory_remembers_nothing_and_uses_nothing(conv, account, clean_env, model):
    memory_of(account).remember("average_kind", "ema", "Exponential (EMA)")
    before = dict(account)
    client = model([])
    r = conv.converse("Add a 20 day moving average", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["disposition"] == "clarify" and r["asked"] == "average_kind"    # asked: no memory was handed in
    model([emits(ema(50))])
    conv.converse("Simple (SMA)", user_id="u1", view=empty_view(0), chart=CHART, snippets=KIND("Add a 50 day moving average"))
    assert account == before and client.calls == []


def test_a_memory_that_cannot_be_read_just_means_the_door_asks(conv, clean_env, model):
    def boom(*_a):
        raise RuntimeError("down")
    client = model([])
    r = conv.converse("Add a 20 day moving average", user_id="u1", view=empty_view(0), chart=CHART,
                      memory=im.Memory("u1", reader=boom, writer=boom))
    assert r["ok"] is True and r["asked"] == "average_kind" and client.calls == []


def test_the_pieces(conv, account):
    mem = memory_of(account)
    u = conv.understand_turn("Add a 20 day moving average", CHART)
    assert conv.remembered_defaults("Add a 20 day moving average", u, empty_view(0), CHART, None) == ("Add a 20 day moving average", u, [])
    assert conv.remembered_defaults("Add a 20 day moving average", u, empty_view(0), CHART, mem)[2] == []
    mem.remember("average_kind", "ema", "Exponential (EMA)")
    message, after, used = conv.remembered_defaults("Add a 20 day moving average.", u, empty_view(0), CHART, mem)
    assert message == "Add a 20 day moving average. Exponential (EMA)" and used == [("average_kind", "Exponential (EMA)")]
    assert conv.open_questions(after) == []
    # beside an indicator already on the chart nothing is asked, so nothing remembered is added
    on_chart = view(1, [out("ma", call("ema", S("close"), num(20)), type_="value")], name="20 EMA")
    assert conv.remembered_defaults("add a moving average beside it", conv.understand_turn("add a moving average beside it", CHART),
                                    on_chart, CHART, mem)[2] == []
    assert conv.offered_first(conv.clarify_question("average_kind"), mem) == conv.clarify_question("average_kind")
    assert conv.offered_first(conv.clarify_question("average_length"), None) == conv.clarify_question("average_length")
    assert conv.as_before_notes([]) == []
    for q in conv.clarify_registry().values():
        assert q["remember"] in ("default", "offer")
        if q["remember"] == "default":
            assert set(q["values"]) == set(q["choices"]) == set(q["said"]) and "{choice}" in q["as_before"]
            for label in q["choices"]:
                (note,) = conv.as_before_notes([(q["id"], label)])
                assert "as you chose before" in note["text"] and len(note["text"]) <= 300 and "{" not in note["text"]


# ═══ 4. through the route: the member's OWN account, and no one else's ═══════

def test_through_the_route_each_member_has_their_own(conv, account, clean_env, model, http_as, monkeypatch):
    monkeypatch.setattr(im, "_account_reader", lambda u: account.get(str(u)))
    monkeypatch.setattr(im, "_account_writer",
                        lambda u, text: account.pop(str(u), None) if text is None else account.__setitem__(str(u), text))
    base = {"view": empty_view(0), "chart": CHART}
    r = http_as(MEMBER).post("/api/user-definitions/converse", json={**base, "message": "Add a 50 day moving average"}).json()
    assert r["disposition"] == "clarify" and r["envelope"]["questions"][0]["id"] == "average_kind"
    model([emits(ema(50))])
    r = http_as(MEMBER).post("/api/user-definitions/converse", json={
        **base, "message": "Exponential (EMA)", "snippets": KIND("Add a 50 day moving average")}).json()
    assert r["ok"] is True and r["disposition"] == "change"
    assert set(account) == {MEMBER["id"]} and im.parse(account[MEMBER["id"]])["choices"]["average_kind"]["value"] == "ema"
    # the same member, next time: used and said
    model([emits(ema(20))])
    r = http_as(MEMBER).post("/api/user-definitions/converse", json={**base, "message": "Add a 20 day moving average"}).json()
    assert r["disposition"] == "change" and "as you chose before" in r["envelope"]["assumptions"][0]["text"]
    # ANOTHER member is asked: nothing of the first member's is theirs
    model([])
    r = http_as(MEMBER2).post("/api/user-definitions/converse", json={**base, "message": "Add a 20 day moving average"}).json()
    assert r["disposition"] == "clarify" and set(account) == {MEMBER["id"]}
