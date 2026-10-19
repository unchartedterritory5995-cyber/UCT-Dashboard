"""NL-1 proxy smoke tool (tools/agent_eval_proxy.py): dev cases only, and EXACTLY the messages run_turn sends."""
import json
import os

import pytest

from api.services.uct_agent import turn
from tests.test_uct_agent import _resp, caller_of
from tools import agent_eval_proxy as px


@pytest.fixture(autouse=True)
def _whole_catalog_limit(monkeypatch):
    # The shipped NL-1 limit is 60 (owner 2026-10-19), which NL-1's whole catalog is over: the runner refuses
    # such a request exactly as the server would. These tests check the runner's OTHER behaviour, so the
    # limit is lifted here only. The real eval needs the owner's limit decision first.
    monkeypatch.setattr(turn, "MAX_CAPABILITIES_NL1", 200)

GOLDEN = os.path.join(os.path.dirname(__file__), "..", "app", "src", "agent", "contract", "manifest.golden.json")
CAPS = json.load(open(GOLDEN, encoding="utf-8"))["capabilities"]


def _item(key="d-cas-01", set_="dev-nl1.json", split="dev"):
    body = {"message": "flip it to 15m", "context": {"surface": "charts", "charts": [{"ref": "c1", "label": "Chart (NVDA)"}]},
            "capabilities": CAPS, "routing": None, "manifestVersion": 1, "interpreter": "nl1", "pending": None}
    return {"key": key, "set": set_, "split": split, "mode": "nl1", "body": body,
            "history": [{"role": "member", "text": "switch to 5 minutes"}, {"role": "outcome", "text": "Changed timeframe to 5 min", "data": {"kind": "applied"}}]}


def test_select_takes_dev_sets_only():
    items = [_item(), _item(key="ref-01", set_="corpus.json"), _item(key="s3-x", set_="sealed-v3.json", split="sealed"),
             _item(key="h", set_="heldout-v2.json", split="sealed"), _item(key="v1", set_="heldout-v1.json", split="exposed")]
    got = px.select(items)
    assert {(i["set"], i["key"]) for i in got} == {("dev-nl1.json", "d-cas-01"), ("corpus.json", "ref-01")}


def test_the_proxy_sees_exactly_the_messages_run_turn_sends(monkeypatch):
    monkeypatch.setenv(turn.NL1_ENV, "1")
    it = _item()
    c = caller_of(_resp({"disposition": "answer", "reply": "ok", "question": None, "ops": [], "unsupported_category": None,
                         "research": None, "title": None, "correction": None, "wants_explanation": False}))
    b = it["body"]
    turn.run_turn(message=b["message"], context=b["context"], history=it["history"], capabilities=b["capabilities"],
                  caller=c, interpreter="nl1")
    assert px.messages_for(it) == c.calls[0]["messages"]
