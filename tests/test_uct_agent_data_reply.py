"""Hotfix 2026-11-03 (live): "when does nvda report" was served a model-written reply line that invented a next
report date and a beat ("NVDA's next earnings report is in January 2027 … beat both revenue and EPS estimates")
while the deterministic stock.earnings card said the date was not in UCT's data. The model writes `reply` BEFORE
anything is read, so on a plan made ONLY of data reads (turn.DATA_READ_ACTIONS) the served reply is empty and
UCT's card leads. A write plan keeps its reply; clarify / unsupported are unchanged. Scripted model, no network.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from api.services.uct_agent import turn
from tests.test_uct_agent import CAPS, CTX, OP, _resp, caller_of, env  # noqa: F401

OBJ = {"type": "object", "properties": {"symbol": {"type": "string"}}, "required": ["symbol"], "additionalProperties": False}


def _cap(name, domain, target):
    return {"name": name, "domain": domain, "target": target, "summary": name, "hints": None, "risk": "local",
            "reversible": True, "query": True, "args": OBJ}


EARN = _cap("stock.earnings", "stock", "market")
PROF = _cap("stock.profile", "stock", "market")
SCREEN = {**_cap("screener.run", "screener", "screener"),
          "args": {"type": "object", "properties": {"filters": {"type": "array"}}, "required": ["filters"],
                   "additionalProperties": False}}
ALL = CAPS + [EARN, PROF, SCREEN]
CTX2 = {**CTX, "stockData": [{"ref": "market", "label": "Market data"}], "screener": [{"ref": "screener", "label": "Screener"}]}

INVENTED_EARN = ("NVDA's next earnings report is in January 2027. The latest quarter beat both revenue and EPS "
                 "estimates, with revenue of $39.3B.")
INVENTED_PROF = "NVDA has a market cap of about $4.5T and trades at 50x earnings."
INVENTED_SCREEN = "Here are the 23 breakout stocks, led by NVDA up 4.2% today."


@pytest.fixture(autouse=True)
def _no_cost(monkeypatch):
    monkeypatch.setattr(turn, "_record_cost", lambda resp: 0.001)


def _run(message, envelope, interpreter=None):
    c = caller_of(_resp(envelope))
    return turn.run_turn(message=message, context=CTX2, history=[], capabilities=ALL, caller=c,
                         interpreter=interpreter)["envelope"]


@pytest.mark.parametrize("interpreter", [None, "nl1"])
@pytest.mark.parametrize("message,op,invented", [
    ("when does nvda report", {"action": "stock.earnings", "target": "market", "args": {"symbol": "NVDA"}}, INVENTED_EARN),
    ("what's nvda's market cap", {"action": "stock.profile", "target": "market", "args": {"symbol": "NVDA"}}, INVENTED_PROF),
    ("show me breakouts", {"action": "screener.run", "target": "screener", "args": {"filters": []}}, INVENTED_SCREEN),
])
def test_a_data_read_plan_never_serves_the_models_invented_facts(message, op, invented, interpreter):
    out = _run(message, env("apply", [op], reply=invented), interpreter)
    assert out["disposition"] == "apply"
    assert [o["action"] for o in out["ops"]] == [op["action"]]          # the card's read still runs (the card leads)
    assert out["reply"] == ""
    for s in ("2027", "January", "beat", "$", "4.2%", "23"):
        assert s not in out["reply"]


def test_a_streaming_data_read_plan_streams_nothing_and_serves_an_empty_reply():
    events = []
    op = {"action": "stock.earnings", "target": "market", "args": {"symbol": "NVDA"}}
    resp = _resp(env("apply", [op], reply=INVENTED_EARN))

    def stream_caller(feed, **kw):
        feed(resp.content[0].text)
        return resp
    out = turn.run_turn(message="when does nvda report", context=CTX2, history=[], capabilities=ALL,
                        caller=caller_of(resp), on_event=events.append, stream_caller=stream_caller)["envelope"]
    assert out["reply"] == "" and out["ops"]
    assert not any(e.get("t") == "delta" for e in events)


def test_sanitize_blanks_every_data_read_action_and_only_when_all_ops_are_reads():
    for name in sorted(turn.DATA_READ_ACTIONS):
        o = {"action": name, "target": "m", "args": {}}
        assert turn.sanitize_envelope(env("apply", [o], reply="Next report is Jan 2027."), {"m"})["reply"] == ""
    mixed = [{"action": "stock.earnings", "target": "m", "args": {}}, {"action": "chart.setType", "target": "m", "args": {}}]
    assert turn.sanitize_envelope(env("apply", mixed, reply="RSI measures momentum."), {"m"})["reply"] == "RSI measures momentum."
    # the post-research reply of a mixed request was written FROM the results (with sources), not before any read
    o = [{"action": "stock.earnings", "target": "m", "args": {}}]
    assert turn.sanitize_envelope(env("apply", o, reply="Per the results, it reports in February."), {"m"},
                                  grounded=True)["reply"] == "Per the results, it reports in February."


def test_a_write_plan_keeps_its_reply():
    out = _run("make it bars, what is a bar chart", env("apply", [OP], reply="A bar chart shows open, high, low and close."))
    assert out["reply"] == "A bar chart shows open, high, low and close." and out["ops"]


def test_clarify_and_unsupported_replies_are_unchanged():
    q = {"text": "Which stock do you mean?", "choices": []}
    out = _run("when do they report", env("clarify", reply="Which one?", question=q))
    assert out["disposition"] == "clarify" and out["question"]["text"] == "Which stock do you mean?" and out["reply"] == "Which one?"
    out = _run("buy me 100 nvda", env("unsupported", reply="I can't place trades.", cat="trading"))
    assert out["disposition"] == "unsupported" and out["reply"] == "I can't place trades."


def test_the_set_is_read_only_in_the_manifest_and_covers_every_market_read():
    man = json.loads((Path(__file__).resolve().parents[1] / "app/src/agent/contract/manifest.golden.json").read_text(encoding="utf-8"))
    caps = {c["name"]: c for c in man["capabilities"]}
    for name in turn.DATA_READ_ACTIONS & caps.keys():
        assert caps[name]["query"] is True, name                     # a read, never a write
    for c in caps.values():
        if c.get("query") and c.get("target") == "market":
            assert c["name"] in turn.DATA_READ_ACTIONS, c["name"]
    assert not (turn.DATA_READ_ACTIONS & turn.LOCAL_ONLY_ACTIONS)


def test_the_prompt_says_data_answers_state_no_figures():
    p = turn.system_prompt(ALL, None, False)
    assert "DATA ANSWERS." in p and "NEVER A FALSE LIMITATION" in p
