"""UCT Agent capability ROUTING — the server half (app/src/agent/routing.js is the browser half).

The browser may send only the action groups a message needs. The model is told which groups exist
but were not given; if it needs one it plans NOTHING and returns `need_groups`; the browser asks once
more (reroute) with those groups. These tests hold the server to: validated routing input, a schema
and prompt that name only real unselected groups, need_groups never carrying ops, no research on
such a call, and the reroute storing nothing twice.
"""
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import uct_agent as rx
from api.services import daily_counters
from api.services.uct_agent import store, turn
from tests.test_uct_agent import CAPS, CTX, OP, ADMIN, _resp, caller_of, env  # noqa: F401

ROUTING = {"version": 1, "groups": [{"id": "charts", "title": "Chart settings"}, {"id": "lists", "title": "Watchlists"},
                                    {"id": "agent", "title": "Questions about UCT Agent"}],
           "selected": ["charts", "agent"]}


def test_validate_routing_keeps_only_well_formed_groups():
    r = turn.validate_routing({"groups": [{"id": "charts", "title": "x"}, {"id": "Bad Id", "title": "y"}, {"id": "lists"}, "junk",
                                          {"id": "charts", "title": "dup"}], "selected": ["charts"]})
    assert r == {"unselected": [{"id": "lists", "title": "lists"}]}
    assert turn.validate_routing({"groups": [{"id": "charts"}], "selected": ["charts"]}) is None   # nothing withheld
    assert turn.validate_routing(None) is None and turn.validate_routing({"groups": "x"}) is None


def test_schema_and_prompt_name_only_the_withheld_groups():
    un = turn.validate_routing(ROUTING)["unselected"]
    schema = turn.envelope_schema(turn.validate_manifest(CAPS), un)
    assert schema["properties"]["need_groups"]["anyOf"][1]["items"]["enum"] == ["lists"]
    assert "need_groups" in schema["required"]
    prompt = turn.system_prompt(turn.validate_manifest(CAPS), un)
    assert "OTHER ACTION GROUPS" in prompt and "- lists: Watchlists" in prompt and "- charts:" not in prompt
    # without routing nothing changes
    assert "need_groups" not in turn.envelope_schema(turn.validate_manifest(CAPS))["properties"]
    assert "OTHER ACTION GROUPS" not in turn.system_prompt(turn.validate_manifest(CAPS))


def test_need_groups_plans_nothing_even_if_the_model_emitted_ops():
    c = caller_of(_resp({**env("apply", ops=[OP]), "need_groups": ["lists"]}))
    out = turn.run_turn(message="add NVDA to my semis list and make the chart bars", context=CTX, history=[],
                        capabilities=CAPS, caller=c, routing=ROUTING)
    e = out["envelope"]
    assert e["need_groups"] == ["lists"] and e["ops"] == [] and e["disposition"] == "clarify"


def test_need_groups_naming_a_group_that_was_given_or_unknown_is_ignored():
    c = caller_of(_resp({**env("apply", ops=[OP]), "need_groups": ["charts", "nonsense"]}))
    e = turn.run_turn(message="bars", context=CTX, history=[], capabilities=CAPS, caller=c, routing=ROUTING)["envelope"]
    assert "need_groups" not in e and e["ops"] == [OP]
    # and without routing, a stray need_groups is ignored entirely
    c = caller_of(_resp({**env("apply", ops=[OP]), "need_groups": ["lists"]}))
    e = turn.run_turn(message="bars", context=CTX, history=[], capabilities=CAPS, caller=c)["envelope"]
    assert "need_groups" not in e and e["ops"] == [OP]


def test_no_research_on_a_call_that_asks_for_more_groups(monkeypatch):
    called = []
    monkeypatch.setattr(turn, "_research", lambda q, r: called.append(q) or {"answer": "", "citations": []})
    c = caller_of(_resp({**env("answer", reply="x", research={"query": "nvda news", "recency": "day"}), "need_groups": ["lists"]}))
    e = turn.run_turn(message="why is NVDA up today? add it to my list", context=CTX, history=[], capabilities=CAPS,
                      caller=c, routing=ROUTING)["envelope"]
    assert called == [] and e["need_groups"] == ["lists"]
    assert len(c.calls) == 1


# ── the route: the reroute is bounded and stores nothing twice ──────────────────

@pytest.fixture
def client(monkeypatch):
    daily_counters.clear()
    store._reset_for_tests()
    monkeypatch.setattr(rx, "_et_day", lambda: "2026-10-08")
    monkeypatch.setattr(rx, "is_paid_user", lambda u: True)
    from api.middleware.auth_middleware import get_current_user_with_plan
    app = FastAPI()
    app.include_router(rx.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: ADMIN
    yield TestClient(app)
    daily_counters.clear()


def test_reroute_stores_the_member_message_once_and_no_plumbing_reply(client, monkeypatch):
    c = caller_of(_resp({**env("clarify"), "need_groups": ["lists"]}), _resp(env("apply", ops=[OP])))
    monkeypatch.setattr(turn, "_default_caller", c)
    first = client.post("/api/agent/turn", json={"message": "bars and add it to semis", "context": CTX, "capabilities": CAPS,
                                                  "routing": ROUTING}).json()
    assert first["envelope"]["need_groups"] == ["lists"] and first["turnId"] is None
    cid = first["conversationId"]
    second = client.post("/api/agent/turn", json={"conversationId": cid, "message": "bars and add it to semis", "context": CTX,
                                                   "capabilities": CAPS, "reroute": True,
                                                   "routing": {**ROUTING, "selected": ["charts", "lists", "agent"]}}).json()
    assert second["envelope"]["ops"] == [OP]
    conv = client.get(f"/api/agent/conversations/{cid}").json()
    assert [t["role"] for t in conv["turns"]] == ["member", "agent"]          # one member row, no plumbing row
    # the second model call saw the member message exactly once
    user_msgs = [m for m in c.calls[1]["messages"] if m["role"] == "user"]
    assert sum(json.dumps(m["content"]).count("bars and add it to semis") for m in user_msgs) == 1
    rows = store.telemetry_rows(ADMIN["id"])
    assert [(r["path"], r["disposition"]) for r in sorted(rows, key=lambda r: r["id"])] == [("routed", "need_groups"), ("reroute", "apply")]
