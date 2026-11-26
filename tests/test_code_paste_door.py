"""THE CODE-PASTE IMPORT DOOR (coordinator's ruling C, 2026-11-25). See api/services/code_paste.py.

Held here, with no paid call (every model call is the scripted stub):
  * detection, by the shared cases the browser's mirror also reads, and on the shape of real pastes;
  * the cap is DERIVED from the engine's script limit (moving that limit moves the door), and plain chat keeps its
    2,000 whatever the lane;
  * a pasted Deepvue indicator is TRANSLATED by the script turn: its code rides as DATA, and the answer says, in UCT's
    words, that it was not checked against Deepvue's values;
  * pasted Pine that passes the first look is the member's own script, opened with NO model call;
  * pasted code over ITS cap is refused in the member's words, never cut;
  * a secret in pasted code reaches neither the turn record nor the logs.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

import pytest

from api.services import code_paste, pine_authoring
from api.services import script_conversation as sc
from tests.test_p2_truth_server import conv, empty_view, model  # noqa: F401 -- fixtures by name
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name
from tests.test_rollout_telemetry import raw_dump, store  # noqa: F401 -- fixtures by name
from tests.test_script_conversation import ACCEPTS, CHART, ask, lane, writes  # noqa: F401 -- fixtures by name

CASES = json.loads((Path(__file__).parent / "fixtures" / "authoring" / "code_paste_cases.json").read_text(encoding="utf-8"))["cases"]
SECRET = "zanzibar-private-paste"


def deepvue_paste(chars: int, secret: str = "") -> str:
    head = ("Convert this Deepvue indicator so it works on this chart:\nglobalThis.indicator = {\n  name: 'Wide Range',\n"
            "  panel: 'overlay',\n  params: { len: { type: 'number', default: 10 } },\n  outputs: { r: { type: 'line' } },\n"
            "  compute(bar) {\n")
    tail = f"    // {secret}\n    return {{ r: bar.ta.highest('high', bar.params.len) }};\n  }},\n}};"
    pad = "    const unused = 0;\n"
    body = pad * max(0, (chars - len(head) - len(tail)) // len(pad))
    text = head + body + tail
    return text + " " * (chars - len(text)) if len(text) < chars else text


PINE = "//@version=5\nindicator(\"My Two EMAs\", overlay=true)\nfast = ta.ema(close, 9)\nslow = ta.ema(close, 21)\nplot(fast)\nplot(slow)\n"


@pytest.mark.parametrize("case", CASES, ids=lambda c: f"{c['kind']}:{c['text'][:24]}")
def test_detection_is_the_shared_cases(case):
    assert code_paste.kind_of(case["text"]) == case["kind"]


def test_the_cap_is_the_engines_script_limit_and_moves_with_it(monkeypatch):
    assert code_paste.import_max_chars() == pine_authoring.SCRIPT_MAX_CHARS
    monkeypatch.setattr(pine_authoring, "SCRIPT_MAX_CHARS", 9_000)
    assert code_paste.import_max_chars() == 9_000


def test_a_long_deepvue_paste_is_translated_with_its_code_as_data_and_says_it_is_unchecked(conv, clean_env, model, lane):
    paste = deepvue_paste(3262)
    assert len(paste) == 3262 and code_paste.kind_of(paste) == code_paste.DEEPVUE
    client = model([writes(reply="This draws the 10 bar high as a line.")])
    r = ask(conv, paste)
    assert [c["tools"][0]["name"] for c in client.calls] == [sc.TOOL_NAME]
    sent = client.calls[0]["messages"][0]["content"]
    assert "<uct_import_source>" in sent and "globalThis.indicator" in sent and code_paste.IMPORT_TASK in sent
    assert "<member_request>" not in sent
    assert r["ok"] is True and r["turn"] == "script"
    assert r["reply"].endswith(code_paste.IMPORT_LINE) and pine_authoring.UNCHECKED_LINE not in r["reply"]


def test_the_pine_inside_a_message_starts_at_its_version_line_wherever_it_stands():
    assert code_paste.pine_of("Convert this TradingView script: " + PINE) == PINE
    assert code_paste.pine_of("Here it is:\n" + PINE) == PINE


def test_pasted_pine_is_the_members_own_script_with_no_model_call(conv, clean_env, model, lane):
    client = model([])
    r = ask(conv, "Convert this TradingView script: " + PINE)
    assert client.calls == []
    assert r["ok"] is True and r["turn"] == "script" and r["attempts"] == 0 and r["cost_usd"] == 0.0
    assert r["script"]["pine"] == PINE and r["script"]["name"] == "My Two EMAs" and r["script"]["round"] == 0
    assert r["reply"] == code_paste.PINE_PASTE_REPLY and r["envelope"]["ops"] == []


def test_pasted_code_over_its_cap_is_refused_in_the_members_words(conv, clean_env, model, lane):
    client = model([])
    big = deepvue_paste(code_paste.import_max_chars() + 50)
    r = ask(conv, big)
    assert r["ok"] is False and r["gate"] == "converse:too-large" and client.calls == []
    # (the door counts the message as it reads it: stripped of the whitespace around it)
    assert f"{len(big.strip()):,} characters; the limit for pasted code is {code_paste.import_max_chars():,}" in r["reason"]


def test_plain_chat_keeps_its_limit(conv, clean_env, model, lane):
    client = model([])
    chat = ("Plot a 20 day moving average and color it green when the close is above it. " * 40)[:2400]
    assert code_paste.kind_of(chat) is None
    r = ask(conv, chat)
    assert r["ok"] is False and r["gate"] == "converse:too-large" and client.calls == []
    assert "2,400 characters; the limit is 2,000" in r["reason"]


def test_with_the_lane_closed_long_code_keeps_the_chat_limit(conv, clean_env, model):
    client = model([])
    r = ask(conv, deepvue_paste(3262))          # no `lane` fixture: the script lane is closed
    assert r["ok"] is False and r["gate"] == "converse:too-large" and client.calls == []


def test_a_secret_in_pasted_code_reaches_neither_the_record_nor_the_logs(store, conv, clean_env, model, lane, caplog):
    model([writes(reply="This draws the 10 bar high.")])
    with caplog.at_level(logging.DEBUG):
        ask(conv, deepvue_paste(3262, secret=SECRET))
    assert SECRET not in raw_dump()
    assert SECRET not in caplog.text and "globalThis.indicator" not in caplog.text
