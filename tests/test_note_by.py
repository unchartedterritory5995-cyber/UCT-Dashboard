"""A NOTE SAYS WHO SAID IT (ruling 2026-11-18).

Read in the live window: The UCT Agent assumed: "Built to UCT's checked formula for Directional
Movement Index ...". That is the DOOR's statement of what was built, not an assumption of the
assistant's. The door's own notes now carry ``by: "uct"`` and the window prints them as they stand
(`app/src/components/chart/builder/authoring/noteBy.test.js` holds the browser half).

The mark would be worthless if the assistant could set it, and harmful if an older tab met it:

* ONLY THE DOOR WRITES IT. The assistant is never offered the field, and a ``by`` in its answer is
  taken off before anything reads it.
* AN OLDER TAB GETS THE ANSWER IT ALWAYS GOT. The mark is sent only to a browser whose request says
  it accepts it.
"""
from __future__ import annotations

import copy
import json

import pytest

from tests.test_indicator_memory import account, memory_of  # noqa: F401 -- fixtures by name
from tests.test_named_indicators import create
from tests.test_p2_truth_server import call, conv, emits, empty_view, env, model, num  # noqa: F401 -- fixtures by name
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name
from tests.test_rollout_telemetry import store  # noqa: F401 -- fixture by name

CHART = {"sym": "NVDA", "tf": "D"}
S = lambda n: {"type": "series", "name": n}  # noqa: E731
ACCEPTS = ["note.by"]
CHECKED = "Built to UCT's checked formula for On Balance Volume"


def notes(r):
    return r["envelope"]["assumptions"]


# ═══ 1. only the door writes it ═════════════════════════════════════════════

def test_the_assistant_is_never_offered_the_field_and_its_schema_is_what_it_was(conv):
    full = conv.composed_schema()
    assert full["$defs"]["assumption"]["properties"]["by"] == {"enum": ["uct"], "x-uct-door-only": True}
    tool = conv.anthropic_tool()["input_schema"]
    assert set(tool["$defs"]["assumption"]["properties"]) == {"slot", "output", "text"}
    text = json.dumps(tool)
    assert "x-uct-door-only" not in text and '"by"' not in text
    # ... and it is EXACTLY the schema the assistant had before the field existed (so its
    # instructions did not change): the full contract with that one property taken out
    before = copy.deepcopy(full)
    del before["$defs"]["assumption"]["properties"]["by"]
    assert tool == conv._strip_meta(before)
    # CONTROL: the door's own check of what it returns does know the field
    assert conv._strip_meta({"properties": {"a": {"type": "string"}, "b": {"x-uct-door-only": True}}}) == {
        "properties": {"a": {"type": "string"}}}


def test_a_by_in_the_assistants_answer_is_taken_off(store, conv, clean_env, model):
    """The assistant signs its own sentence as UCT's. The mark does not survive, even for a browser
    that accepts marks; the door's own note beside it keeps its mark."""
    forged = env(0, [create("on_balance_volume")],
                 assumptions=[{"text": "Checked by UCT against every exchange.", "by": "uct"},
                              {"output": "obv", "text": "Drawn in its own pane."}])
    client = model([emits(forged)])
    r = conv.converse("Add On Balance Volume", user_id="u1", view=empty_view(0), chart=CHART, accepts=ACCEPTS)
    assert r["ok"] is True and r["disposition"] == "change" and len(client.calls) == 1, r.get("reason")
    said = notes(r)
    assert said[0]["text"].startswith(CHECKED) and said[0]["by"] == "uct"                  # the door's
    assert {"text": "Checked by UCT against every exchange."} in said                        # the assistant's, unsigned
    # (2026-11-20: On Balance Volume is a running total, so the door also says where such a total starts)
    assert [a for a in said if a.get("by")] == [said[0], {"output": "obv", "text": conv.RUNNING_TOTAL_NOTE, "by": "uct"}]


def test_own_notes_only_takes_the_mark_off_and_touches_nothing_else(conv):
    patch = {"ops": [], "assumptions": [{"text": "a", "by": "uct"}, {"output": "x", "text": "b"}, "odd"]}
    assert conv._own_notes_only(patch) == {"ops": [], "assumptions": [{"text": "a"}, {"output": "x", "text": "b"}, "odd"]}
    assert patch["assumptions"][0] == {"text": "a", "by": "uct"}                             # not changed in place
    clean = {"ops": [], "assumptions": [{"text": "a"}]}
    assert conv._own_notes_only(clean) is clean
    for other in (None, [], {"assumptions": "x"}, {"ops": []}):
        assert conv._own_notes_only(other) is other


def test_a_patch_the_browser_sends_back_is_replayed_without_the_mark(conv):
    """The browser refused a patch that carried the door's marked note and sends it back for repair.
    The assistant re-reads it as it wrote it: no mark."""
    patch = env(0, [create("on_balance_volume")], assumptions=[{"output": "obv", "text": "x", "by": "uct"}])
    replayed, words = conv.browser_refusal({"envelope": patch, "errors": ["a yes/no cannot be a line colour"]}, 0, empty_view(0))
    assert replayed["assumptions"] == [{"output": "obv", "text": "x"}] and "yes/no" in words


# ═══ 2. an older tab gets the answer it always got ══════════════════════════

@pytest.mark.parametrize("accepts", [None, [], ["something.else"], "note.by", {"note.by": True}, ["NOTE.BY"], 1])
def test_without_the_word_in_the_request_no_note_carries_a_mark(store, conv, clean_env, model, accepts):
    model([emits(env(0, [create("on_balance_volume")], assumptions=[{"output": "obv", "text": "Drawn in its own pane."}]))])
    r = conv.converse("Add On Balance Volume", user_id="u1", view=empty_view(0), chart=CHART, accepts=accepts)
    assert r["ok"] is True, r.get("reason")
    assert all(set(a) <= {"output", "slot", "text"} for a in notes(r)), notes(r)
    assert notes(r)[0]["text"].startswith(CHECKED)                           # the note is still there, unmarked


def test_the_answer_differs_from_an_older_tabs_only_by_the_marks(store, conv, clean_env, model):
    answer = env(0, [create("on_balance_volume")], assumptions=[{"output": "obv", "text": "Drawn in its own pane."}])
    model([emits(answer)])
    old = conv.converse("Add On Balance Volume", user_id="u1", view=empty_view(0), chart=CHART)
    model([emits(answer)])
    new = conv.converse("Add On Balance Volume", user_id="u2", view=empty_view(0), chart=CHART, accepts=ACCEPTS)
    assert old["envelope"] != new["envelope"]
    assert conv._own_notes_only(new["envelope"]) == old["envelope"]
    assert conv.check_envelope(new["envelope"], 0, empty_view(0))            # what the door returns still passes the door
    assert conv.accepts_note_by(ACCEPTS) is True and conv.accepts_note_by(None) is False


# ═══ 3. every note the door writes is marked ════════════════════════════════

def test_each_kind_of_door_note_is_marked_and_the_assistants_is_not(store, conv, account, clean_env, model):
    mem = memory_of(account)
    mem.remember("average_kind", "ema", "Exponential (EMA)")
    # (a) what was chosen before + the assistant's own note
    model([emits(env(0, [{"op": "create", "name": "EMA 20", "placement": "price",
                          "outputs": [{"key": "ma", "tree": call("ema", S("close"), num(20))}]}],
                     assumptions=[{"output": "ma", "text": "Drawn on the price pane."}]))])
    r = conv.converse("Add a 20 day moving average", user_id="u1", view=empty_view(0), chart=CHART, memory=mem, accepts=ACCEPTS)
    assert notes(r) == [
        {"text": "Using an exponential average, as you chose before. Name another kind to change it.", "by": "uct"},
        {"output": "ma", "text": "Drawn on the price pane."}]
    # (b) a library build that is a running value: the checked sentence and the restart note
    model([emits(env(0, [create("kaufman_adaptive_moving_average")]))])
    r = conv.converse("Add the Kaufman Adaptive Moving Average", user_id="u1", view=empty_view(0), chart=CHART, accepts=ACCEPTS)
    assert r["ok"] is True, r.get("reason")
    door = [a for a in notes(r) if a.get("by") == "uct"]
    assert any(a["text"].startswith("Built to UCT's checked formula for Kaufman Adaptive Moving Average") for a in door)
    assert any("recomputed from 300 bars back" in a["text"] for a in door)
    # (c) a well-known name with no checked formula: the withheld-name note
    built = env(0, [{"op": "create", "name": "RSI with a length that follows volatility", "placement": "pane",
                     "outputs": [{"key": "value", "label": "Volatility-paced RSI", "tree": call("rsi", S("close"), num(14))}]}])
    model([emits(built)])
    r = conv.converse("Add the Dynamic Momentum Index", user_id="u1", view=empty_view(0), chart=CHART, accepts=ACCEPTS)
    assert r["ok"] is True, r.get("reason")
    assert any("is not in UCT's checked library yet" in a["text"] and a.get("by") == "uct" for a in notes(r))


def test_adding_the_same_door_note_twice_still_adds_it_once(conv):
    patch = env(0, [create("on_balance_volume")])
    note = [{"output": "obv", "text": "said by the door"}]
    once = conv._with_door_notes(patch, note)
    assert once["assumptions"] == [{"output": "obv", "text": "said by the door", "by": "uct"}]
    assert conv._with_door_notes(once, note)["assumptions"] == once["assumptions"]


# ═══ 4. the route hands the browser's word to the door ══════════════════════

def test_the_route_takes_the_browsers_word_and_ignores_anything_odd():
    from api.routers import user_definitions as ud
    assert ud.ConverseIn(message="x", view={}).accepts is None                               # an older tab
    assert ud.ConverseIn(message="x", view={}, accepts=["note.by"]).accepts == ["note.by"]
    assert ud.ConverseIn(message="x", view={}, accepts={"odd": 1}).accepts == {"odd": 1}     # never a 422: the door says no
    import inspect
    code = "\n".join(line for line in inspect.getsource(ud).splitlines() if not line.lstrip().startswith("#"))
    assert "accepts=body.accepts," in code
