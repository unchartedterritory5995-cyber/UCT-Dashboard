"""A table cell points at an OUTPUT, and this door says so before the browser does.

Measured on production, 2026-11-17, in a multi-turn conversation as a member: "a position size
calculator table with account size, risk percent, entry and stop as settings, showing shares to
buy" came back with cells pointing at the SETTINGS (`entry`, `stop`). The door answered ok; the
browser refused the whole patch ("There is no output "entry" for a table cell to show"), and the
member read a red error for a request that had been built.

  1. a cell pointing at a setting is refused here, with the way out in the diagnostic, and the
     repair (a hidden output that reads the setting) is accepted: two calls, a built calculator;
  2. a cell pointing at nothing is refused with the valid output keys;
  3. a cell colour that follows a name which is not an output is refused the same way;
  4. never stricter than the browser: the order of ops is not judged, a cell that points at an
     output of the view or of this answer passes, and a text cell is not looked at;
  5. the instructions say a cell can never point at a setting, and that "the bars" of an
     indicator with bars of its own are that output's bars, not the price candles.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import pytest

from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    call, conv, emits, empty_view, env, model, num, op, out, view,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

S = lambda n: {"type": "series", "name": n}  # noqa: E731
GATE = "envelope:reference"
INPUTS = [{"key": "entry", "label": "Entry", "default": 0}, {"key": "stop", "label": "Stop", "default": 0}]
RISK = call("abs", op("-", S("entry"), S("stop")))


def _calc(cells, extra_outputs=()):
    return env(0, [
        {"op": "create", "name": "Position Size", "placement": "price", "inputs": INPUTS,
         "outputs": [{"key": "risk", "tree": RISK, "hidden": True}, *extra_outputs]},
        {"op": "set_table", "position": "top_right", "cells": cells}])


TO_A_SETTING = [{"row": 0, "col": 0, "text": "Entry"}, {"row": 0, "col": 1, "output": "entry"},
                {"row": 1, "col": 0, "text": "Risk"}, {"row": 1, "col": 1, "output": "risk"}]
REPAIRED = [{"row": 0, "col": 0, "text": "Entry"}, {"row": 0, "col": 1, "output": "entryShown"},
            {"row": 1, "col": 0, "text": "Risk"}, {"row": 1, "col": 1, "output": "risk"}]
ENTRY_OUTPUT = {"key": "entryShown", "tree": S("entry"), "hidden": True}


def _refusal(conv, e, v=None, revision=0):
    with pytest.raises(conv._Refused) as exc:
        conv.check_envelope(e, revision, v if v is not None else empty_view(0))
    assert exc.value.gate == GATE
    return exc.value.detail


def test_a_cell_pointing_at_a_setting_is_refused_with_the_way_out(conv):
    detail = _refusal(conv, _calc(TO_A_SETTING))
    assert "points at the setting 'entry'" in detail
    assert "add a hidden output whose tree is the series 'entry'" in detail
    assert "row 0, column 1" in detail


def test_the_repair_is_accepted_and_the_member_gets_the_calculator(conv, clean_env, model):
    client = model([emits(_calc(TO_A_SETTING)), emits(_calc(REPAIRED, [ENTRY_OUTPUT]))])
    r = conv.converse("a position size calculator table", user_id="u1", view=empty_view(0))
    assert r["ok"] is True and r["attempts"] == 2 and len(client.calls) == 2
    assert r["usage"]["repair_gate"] == GATE
    told = str(client.calls[1]["messages"][-1]["content"][0]["content"])
    assert "hidden output" in told and "entry" in told           # the model is told how to fix it


def test_a_cell_pointing_at_nothing_names_the_outputs_there_are(conv):
    detail = _refusal(conv, _calc([{"row": 0, "col": 0, "output": "shares"}]))
    assert "points at 'shares', which is not an output" in detail
    assert "The outputs are: risk" in detail


def test_a_cell_colour_must_follow_an_output_too(conv):
    cells = [{"row": 0, "col": 0, "output": "risk", "colorWhen": {"output": "bullish", "true": "#089981", "false": "#F23645"}}]
    detail = _refusal(conv, _calc(cells))
    assert "'bullish'" in detail and "colorWhen" in detail


def test_never_stricter_than_the_browser(conv):
    # an output of this answer, declared AFTER the table op: the order is not judged here
    late = env(0, [
        {"op": "create", "name": "T", "placement": "price", "outputs": [{"key": "a", "tree": call("sma", S("close"), num(20))}]},
        {"op": "set_table", "position": "top_right", "cells": [{"row": 0, "col": 0, "output": "b"}]},
        {"op": "add_output", "key": "b", "tree": call("sma", S("close"), num(50)), "hidden": True}])
    assert conv.check_envelope(late, 0, empty_view(0))["ops"][1]["op"] == "set_table"
    # an output the VIEW already has
    v = view(1, [out("value", call("sma", S("close"), num(20)), label="SMA 20")])
    table = env(1, [{"op": "set_table", "position": "top_left", "cells": [
        {"row": 0, "col": 0, "text": "Average"}, {"row": 0, "col": 1, "output": "value"}]}])
    assert conv.check_envelope(table, 1, v)["ops"][0]["op"] == "set_table"
    # the repaired calculator itself
    assert conv.check_envelope(_calc(REPAIRED, [ENTRY_OUTPUT]), 0, empty_view(0))


def test_an_output_this_answer_removes_is_not_there_for_a_cell(conv):
    v = view(1, [out("value", call("sma", S("close"), num(20)), label="SMA 20"),
                 out("sig", call("sma", S("close"), num(50)), label="SMA 50")])
    e = env(1, [{"op": "remove_output", "output": "sig"},
                {"op": "set_table", "position": "top_left", "cells": [{"row": 0, "col": 0, "output": "sig"}]}])
    detail = _refusal(conv, e, v, revision=1)
    assert "'sig', which is not an output" in detail and "The outputs are: value" in detail


def test_the_instructions_say_a_cell_never_points_at_a_setting_and_whose_bars_the_bars_are():
    from api.services import definition_conversation as dcv
    text = dcv.system_prompt()
    assert "a cell can NEVER point at a setting" in text
    assert "add a hidden output whose tree is that setting's series" in text
    # the same round: "color the bars blue when volume is more than twice the average", asked of a
    # volume indicator, painted the PRICE candles
    assert "are THAT OUTPUT's bars" in text
    assert "`barcolor` paints the PRICE candles: only when the member says candles or price bars" in text
