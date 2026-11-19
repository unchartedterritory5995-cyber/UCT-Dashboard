"""Two deterministic mends before the door's check (`definition_conversation.mend`).

Measured through the production door on 2026-11-17: about one built turn in four paid a second
model call while the patch's maths was right. Two causes are mechanical and are mended in place:
an output read by its key, and an assumption pointed at a slot that is not there.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import copy
import json

from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    CLOSE, call, conv, emits, empty_view, env, model, num, op, out, view,
)

HIGH, LOW = {"type": "series", "name": "high"}, {"type": "series", "name": "low"}
EMA21 = call("ema", CLOSE, num(21))
ATR20 = call("atr", HIGH, LOW, CLOSE, num(20))
DIST = op("/", op("-", CLOSE, EMA21), ATR20)                # how many ATRs above the 21 EMA
REF = {"type": "series", "name": "atrDist"}                  # the output, read by its key
ASK = "How many ATRs is price above the 21 day EMA? Turn it red over 5."


def states(when):
    return {"op": "set_color_states", "output": "atrDist",
            "states": [{"when": when, "color": "#EF4444"}], "otherwise": "#9CA3AF"}


def built(when, **extra):
    return env(0, [{"op": "create", "name": "ATR distance", "placement": "pane",
                    "outputs": [{"key": "atrDist", "label": "ATR distance", "tree": DIST}]},
                   states(when)], reply="Built it.", **extra)


# ═══ an output read by its key ════════════════════════════════════════════════

def test_ASKED_red_over_5__ANSWERED_with_the_outputs_key__DID_one_call_with_the_expression_written_out(conv, model):
    """The measured shape (2026-11-17): `atrDist > 5` in a colour state. Before: `schema:name`
    and a second model call to write the same expression out. Now: one call."""
    client = model([emits(built(op(">", REF, num(5))))])
    r = conv.converse(ASK, user_id="u1", view=empty_view(0))
    assert r["ok"] is True and r["attempts"] == 1 and len(client.calls) == 1
    assert r["usage"]["repair_gate"] is None and r["usage"]["mended"] == "output-ref"
    when = r["envelope"]["ops"][1]["states"][0]["when"]
    assert when == op(">", DIST, num(5))                     # the same tree the key names
    assert "atrDist" not in json.dumps(when)
    assert r["envelope"]["ops"][0]["outputs"][0]["tree"] == DIST      # the output itself is untouched


def test_a_second_output_built_from_the_first_by_its_key_is_written_out_too(conv, model):
    e = env(0, [{"op": "create", "name": "x", "placement": "pane", "outputs": [
        {"key": "atrDist", "label": "ATR distance", "tree": DIST},
        {"key": "avg", "label": "Average", "tree": call("sma", REF, num(10))}]}], reply="Built it.")
    model([emits(e)])
    r = conv.converse(ASK, user_id="u1", view=empty_view(0))
    assert r["ok"] is True and r["attempts"] == 1 and r["usage"]["mended"] == "output-ref"
    assert r["envelope"]["ops"][0]["outputs"][1]["tree"] == call("sma", DIST, num(10))


def test_an_existing_outputs_key_read_in_a_refinement_is_written_out_from_the_view(conv, model):
    """"Colour it red above 5" on an indicator that already exists: the key names the VIEW's tree."""
    v = view(3, [out("atrDist", DIST)])
    e = env(3, [states(op(">", REF, num(5)))], reply="Coloured it.")
    model([emits(e)])
    r = conv.converse("colour it red above 5", user_id="u1", view=v)
    assert r["ok"] is True and r["attempts"] == 1 and r["usage"]["mended"] == "output-ref"
    assert r["envelope"]["ops"][0]["states"][0]["when"] == op(">", DIST, num(5))


def test_CONTROL_an_output_that_reads_ITSELF_is_not_written_out_and_is_refused_as_before(conv, model):
    loop = env(0, [{"op": "create", "name": "x", "placement": "pane",
                    "outputs": [{"key": "atrDist", "tree": op("+", REF, num(1))}]}], reply="Built it.")
    client = model([emits(loop), emits(loop)])
    r = conv.converse(ASK, user_id="u1", view=empty_view(0))
    assert r["ok"] is False and len(client.calls) == 2
    assert r["usage"]["mended"] is None


def test_CONTROL_a_name_that_is_no_output_is_still_refused_at_the_name_check(conv, model):
    bad = built(op(">", {"type": "series", "name": "nonesuch"}, num(5)))
    good = built(op(">", DIST, num(5)))
    client = model([emits(bad), emits(good)])
    r = conv.converse(ASK, user_id="u1", view=empty_view(0))
    assert r["ok"] is True and r["attempts"] == 2 and r["usage"]["mended"] is None
    assert r["usage"]["repair_gate"] is not None


def test_CONTROL_a_table_name_keeps_its_table_meaning_even_as_an_output_key(conv):
    """An output keyed `close` does not turn every read of `close` into that output."""
    e = {"ops": [{"op": "create", "name": "x", "outputs": [
        {"key": "close", "tree": op("*", CLOSE, num(2))}, {"key": "b", "tree": op(">", CLOSE, num(5))}]}]}
    work = copy.deepcopy(e)
    assert conv._mend_output_refs(work, None) == 0 and work == e


# ═══ one colour state on the candles or the background ════════════════════════════

NARROW = op("<=", op("-", HIGH, LOW), call("lowest", op("-", HIGH, LOW), num(7)))
NREF = {"type": "series", "name": "narrow"}
CANDLES = "Colour the candles yellow when the day's range is the narrowest of the last 7 days."


def painted(states_op, extra_outputs=()):
    return env(0, [{"op": "create", "name": "Narrow range", "placement": "price", "outputs": [
        {"key": "narrow", "label": "Narrowest of 7", "tree": NARROW}, *extra_outputs]}, states_op], reply="Built it.")


def test_ASKED_colour_the_candles__ANSWERED_one_colour_state__DID_one_call_as_the_paint_it_means(conv, model):
    """Measured 2026-11-17, after the first two mends were served: this shape was two of the three
    repairs left. The door's own diagnostic said "use `set_paint` with that condition's output"."""
    for when in (NARROW, NREF):                               # written out, or read by its key
        one = {"op": "set_color_states", "channel": "barcolor", "states": [{"when": when, "color": "#FFEB3B"}]}
        client = model([emits(painted(one))])
        r = conv.converse(CANDLES, user_id="u1", view=empty_view(0))
        assert r["ok"] is True and r["attempts"] == 1 and len(client.calls) == 1, r
        assert r["envelope"]["ops"][1] == {"op": "set_paint", "output": "narrow", "channel": "barcolor", "color": "#FFEB3B"}
        assert "state-as-paint" in r["usage"]["mended"].split(",")
        assert len(r["envelope"]["ops"]) == 2 and r["envelope"]["ops"][0]["outputs"][0]["tree"] == NARROW


def test_the_background_is_the_same_mend(conv, model):
    one = {"op": "set_color_states", "channel": "bgcolor", "states": [{"when": NARROW, "color": "#F23645"}]}
    model([emits(painted(one))])
    r = conv.converse("red shading while the range is the narrowest of 7", user_id="u1", view=empty_view(0))
    assert r["ok"] is True and r["attempts"] == 1
    assert r["envelope"]["ops"][1] == {"op": "set_paint", "output": "narrow", "channel": "bgcolor", "color": "#F23645"}


def test_CONTROL_a_condition_that_is_no_output_of_the_answer_is_left_to_the_repair(conv):
    """A mend adds no output: with nothing to point the paint at, the op is untouched."""
    other = op(">", CLOSE, num(5))
    e = painted({"op": "set_color_states", "channel": "barcolor", "states": [{"when": other, "color": "#FFEB3B"}]})
    got, names = conv.mend(e, empty_view(0))
    assert got is e and names == []


def test_CONTROL_a_LINE_coloured_by_one_state_is_not_touched(conv):
    """What the other bars of a line should be is the model's to say (`otherwise`), not a mend's."""
    e = painted({"op": "set_color_states", "output": "narrow", "states": [{"when": NARROW, "color": "#FFEB3B"}]})
    got, names = conv.mend(e, empty_view(0))
    assert got is e and names == []


def test_CONTROL_two_colours_on_a_channel_are_already_valid_and_untouched(conv):
    for extra in ({"otherwise": "#9CA3AF"},
                  {"states": [{"when": NARROW, "color": "#FFEB3B"}, {"when": op(">", CLOSE, num(5)), "color": "#F23645"}]}):
        e = painted({"op": "set_color_states", "channel": "barcolor",
                     "states": [{"when": NARROW, "color": "#FFEB3B"}], **extra})
        got, names = conv.mend(e, empty_view(0))
        assert got is e and names == []


# ═══ what a mend never does ══════════════════════════════════════════════════

def test_a_mend_never_adds_removes_or_reorders_an_op_and_never_changes_a_number(conv):
    e = built(op(">", REF, num(5)), assumptions=[{"slot": "atrDist#9.9", "text": "Twenty-day ATR."}])
    got, names = conv.mend(e, empty_view(0))
    assert names == ["output-ref", "assumption-link"]
    assert [o["op"] for o in got["ops"]] == [o["op"] for o in e["ops"]]
    nums = lambda x: sorted(n["value"] for n in conv._walk(x) if n.get("type") == "num")  # noqa: E731
    assert nums(got["ops"][0]["outputs"][0]["tree"]) == nums(DIST)
    assert got["assumptions"] == [{"text": "Twenty-day ATR."}]
    assert e["assumptions"][0]["slot"] == "atrDist#9.9" and e["ops"][1]["states"][0]["when"]["args"][0] == REF  # the input is not mutated


def test_an_answer_that_needs_no_mend_is_returned_as_the_same_object(conv):
    e = built(op(">", DIST, num(5)))
    got, names = conv.mend(e, empty_view(0))
    assert got is e and names == []


def test_an_answer_outside_the_schema_is_left_for_the_check_to_refuse(conv):
    junk = {"ops": [{"op": "delete_everything"}], "assumptions": [{"slot": "x#1", "text": "y"}]}
    got, names = conv.mend(junk, empty_view(0))
    assert got is junk and names == []
    for odd in (None, 7, "x", {}, {"ops": "no"}):
        assert conv.mend(odd, None) == (odd, [])


def test_a_member_reads_nothing_about_a_mend(conv, model):
    model([emits(built(op(">", REF, num(5)), assumptions=[{"slot": "atrDist#9.9", "text": "Twenty-day ATR."}]))])
    r = conv.converse(ASK, user_id="u1", view=empty_view(0))
    assert r["ok"] is True and "diagnostic" not in r
    assert r["usage"]["mended"] == "output-ref,assumption-link"       # names only
    assert "atrDist#9.9" not in json.dumps(r)
