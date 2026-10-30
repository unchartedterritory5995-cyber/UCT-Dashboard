"""UCT Agent PHASE 3 — model fallback reliability: an unreadable model reply is refused (nothing reaches the browser) with
a sentence that says WHAT went wrong and that nothing was changed — never the model's text, an action name or an
argument. The live acceptance failure of 2026-10-29 answered only "UCT Agent returned something unreadable"."""
from __future__ import annotations

import json
import logging
import types

import pytest

from api.services.uct_agent import turn
from tests.test_uct_agent import CTX, _resp, caller_of, env

NOTHING = "nothing was changed"


def _text(text, stop):
    return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=text)], stop_reason=stop,
                                 usage=types.SimpleNamespace(input_tokens=100, output_tokens=2048))


def test_a_plan_cut_off_at_the_token_ceiling_says_it_was_too_long_and_to_split_it(caplog):
    caplog.set_level(logging.WARNING)
    half = json.dumps(env("apply", ops=[{"action": "chart.setTimeframe", "target": "c1", "args": {"timeframe": "D"}}]))[:-20]
    with pytest.raises(turn.TurnError) as e:
        turn.run_turn(message="open four charts and …", context=CTX, history=[], caller=caller_of(_text(half, "max_tokens")))
    said = str(e.value)
    assert "longer plan than I can write in one go" in said and NOTHING in said and "smaller requests" in said
    assert e.value.reason == "unreadable:json:max_tokens"
    # the server log keeps the shape only (reason, stop reason, sizes) — never the member's words
    assert any("unreadable: json" in r.getMessage() and "max_tokens" in r.getMessage() for r in caplog.records)
    assert not any("open four charts" in r.getMessage() for r in caplog.records)


def test_a_malformed_reply_that_was_not_cut_off_says_the_plan_came_back_incomplete():
    with pytest.raises(turn.TurnError) as e:
        turn.run_turn(message="x", context=CTX, history=[], caller=caller_of(_text("{nope", "end_turn")))
    assert "came back incomplete" in str(e.value) and NOTHING in str(e.value)
    assert e.value.reason == "unreadable:json"


@pytest.mark.parametrize("reason,stop,want", [
    ("args_schema", None, "couldn't fill in the details of one of the steps"),
    ("args_json", None, "couldn't fill in the details of one of the steps"),
    ("json", "max_tokens", "longer plan than I can write in one go"),
    ("json", "end_turn", "came back incomplete"),
    ("disposition", None, "returned something unreadable"),
    ("empty_answer", None, "returned something unreadable"),
])
def test_every_reason_has_a_sentence_and_each_says_nothing_was_changed(reason, stop, want):
    s = turn.unreadable_sentence(reason, stop)
    assert want in s and NOTHING in s
    for internal in ("args_json", "args_schema", "disposition", "chart.", "indicator.", "{", "}"):
        assert internal not in s


def test_a_valid_reply_is_unchanged():
    out = turn.run_turn(message="x", context=CTX, history=[], caller=caller_of(_resp(env("answer", reply="Hello."))))
    assert out["envelope"]["reply"] == "Hello."
