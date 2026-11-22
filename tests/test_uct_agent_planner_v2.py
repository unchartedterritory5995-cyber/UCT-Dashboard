"""Wave 1 A-04 — planner v2 (api/services/uct_agent/turn_v2.py, contract docs/agent/program/contracts/STEP-1.md).

Every model reply is SCRIPTED (tool_use blocks from a fake client); no network, no paid call. Pins: the happy
path, an unknown action refused (no step), args off schema refused, a confirm-risk step becomes `propose` and
PAUSES the loop (resume with the outcome), the round cap, the $ cap BEFORE the call, member 403 before any
call, isolated results value-free, and flag OFF = v1 byte-identical."""
from __future__ import annotations

import json
import queue
import threading
import time
import types

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import uct_agent as rx
from api.services import daily_counters, narrative_cost_guard
from api.services.uct_agent import budget, limits, store, turn, turn_v2 as v2

ADMIN = {"id": "38c023cf-0e81-4187-aa43-ac51a751a002", "plan": "pro", "role": "admin"}
MEMBER = {"id": "38c023cf-0e81-4187-aa43-ac51a751a003", "plan": "pro", "role": "member"}
CTX = {"surface": "charts", "charts": [{"ref": "c1", "label": "Chart (SPY)", "symbol": "SPY"}],
       "watchlists": [{"ref": "wl", "label": "Watchlists"}], "screener": [{"ref": "sc", "label": "Screener"}]}
ARGS = lambda props, req=None: {"type": "object", "properties": props, "required": req if req is not None else list(props), "additionalProperties": False}  # noqa: E731
CAPS = [
    {"name": "chart.setTimeframe", "domain": "chart", "target": "chart", "summary": "Change the timeframe.", "hints": None, "risk": "local",
     "reversible": True, "undo": "exact", "args": ARGS({"timeframe": {"type": "string", "enum": ["D", "W", "M"]}})},
    {"name": "watchlist.create", "domain": "watchlist", "target": "watchlistLibrary", "summary": "Create a saved watchlist.", "hints": None,
     "risk": "confirm", "reversible": False, "undo": "none", "args": ARGS({"name": {"type": "string"}, "as": {"type": ["string", "null"]}})},
    {"name": "watchlist.add", "domain": "watchlist", "target": "watchlist", "summary": "Add tickers.", "hints": None, "risk": "local",
     "reversible": True, "undo": "exact", "args": ARGS({"symbols": {"type": "array", "items": {"type": "string"}}})},
    {"name": "screener.run", "domain": "screener", "target": "screener", "summary": "Run a screen.", "hints": None, "risk": "local",
     "reversible": True, "undo": "none", "query": True, "args": ARGS({"show": {"type": ["integer", "null"]}})},
    {"name": "breadth.show", "domain": "breadth", "target": "breadth", "summary": "Breadth reading.", "hints": None, "risk": "local",
     "reversible": True, "undo": "none", "query": True, "localOnly": True, "args": ARGS({"universe": {"type": "string", "enum": ["us"]}})},
]


def tool_use(name, inp, id_="tu1"):
    return types.SimpleNamespace(type="tool_use", id=id_, name=name, input=inp)


def text(s):
    return types.SimpleNamespace(type="text", text=s)


def resp(*blocks, stop="tool_use", usage=(1000, 50)):
    if all(getattr(b, "type", None) == "text" for b in blocks):
        stop = "end_turn"
    return types.SimpleNamespace(content=list(blocks), stop_reason=stop,
                                 usage=types.SimpleNamespace(input_tokens=usage[0], output_tokens=usage[1],
                                                             cache_read_input_tokens=0, cache_creation_input_tokens=0))


def scripted(*resps):
    calls = []

    def caller(**kw):
        calls.append(kw)
        return resps[min(len(calls), len(resps)) - 1]
    caller.calls = calls
    return caller


def waiter(*results):
    """the browser's step_result per step, in order; records the step ids it was asked for"""
    seen = []

    def wait_step(step_id):
        seen.append(step_id)
        r = results[min(len(seen), len(results)) - 1]
        return None if r is None else {"id": step_id, **r}
    wait_step.seen = seen
    return wait_step


def run(caller, wait_step=None, events=None, caps=CAPS, message="switch to weekly", meter=None, **kw):
    return v2.run_turn_v2(message=message, context=CTX, history=[], capabilities=caps, caller=caller, meter=meter,
                          on_event=(events.append if events is not None else None), wait_step=wait_step, **kw)


@pytest.fixture(autouse=True)
def _flags(monkeypatch):
    monkeypatch.setenv(v2.PLANNER_ENV, "v2")
    monkeypatch.delenv(v2.ROUNDS_ENV, raising=False)
    monkeypatch.delenv(v2.TURN_USD_ENV, raising=False)
    monkeypatch.delenv("UCT_AGENT_EFFORT", raising=False)
    monkeypatch.setattr(turn, "_record_cost", lambda r: 0.0)


# ── tools from the manifest ───────────────────────────────────────────────────────────────────
def test_tools_are_built_from_the_manifest_per_STEP_1():
    caps = turn.validate_manifest(CAPS)
    tools = v2.build_tools(caps, research=True)
    assert tools[0] == {"type": "tool_search_tool_regex_20251119", "name": "tool_search_tool_regex"}
    domains = tools[1:13]
    assert [t["name"] for t in domains] == list(v2.DOMAIN_TOOLS)
    assert all(t["strict"] is True and "defer_loading" not in t and t["input_schema"]["additionalProperties"] is False for t in domains)
    deferred = tools[13:]
    assert [t["name"] for t in deferred] == ["chart__setTimeframe", "watchlist__create", "watchlist__add", "screener__run", "breadth__show", "research__web"]
    for t in deferred:
        assert t["defer_loading"] is True and t["strict"] is True and "." not in t["name"]
        assert t["input_schema"]["additionalProperties"] is False
        assert t["input_schema"]["required"] == (["target", "args"] if t["name"] != "research__web" else ["query", "recency"])
    assert deferred[0]["input_schema"]["properties"]["args"] == caps[0]["args"]
    assert "needs confirmation" in deferred[1]["description"] and "permanent -- no Undo" in deferred[1]["description"]
    assert tools[-1]["cache_control"] == {"type": "ephemeral"} and sum("cache_control" in t for t in tools) == 1
    assert v2.domain_for("chartSetup.saveTemplate") == "chart" and v2.domain_for("stock.profile") == "data" and v2.domain_for("breadth.show") == "history"
    assert "chart__setTimeframe" in v2.domain_listing("chart", caps) and "tool_search_tool_regex" in v2.domain_listing("chart", caps)


# ── the happy path ────────────────────────────────────────────────────────────────────────────
def test_HAPPY_PATH_domain_lookup_then_one_step_then_the_reply(monkeypatch):
    monkeypatch.setenv(v2.TOOLS_ENV, "search")                         # the Wave 1 layout (domain tools + tool search)
    c = scripted(resp(tool_use("chart", {})),
                 resp(tool_use("chart__setTimeframe", {"target": "c1", "args": {"timeframe": "W"}}, "tu2")),
                 resp(text("Weekly it is.")))
    events = []
    w = waiter({"status": "done", "receipt": "Switched Chart (SPY) to weekly"})
    out = run(c, w, events)
    assert len(c.calls) == 3
    kw = c.calls[0]
    assert kw["tools"][0]["name"] == "tool_search_tool_regex" and "tool_choice" not in kw and "temperature" not in kw
    assert kw["max_tokens"] == v2.V2_MAX_TOKENS == 1024 and "output_config" not in kw   # today's model, no effort set (W2-A2: v2 rounds reserve 1024)
    assert kw["system"][0]["cache_control"] == {"type": "ephemeral"} and "<member_request>switch to weekly</member_request>" in kw["messages"][-1]["content"]
    # round 1: the domain tool answered server-side (free), no step
    r1 = c.calls[1]["messages"][-1]["content"][0]
    assert r1["type"] == "tool_result" and r1["tool_use_id"] == "tu1" and "chart__setTimeframe" in r1["content"]
    # round 2: ONE step event, the browser's receipt went back as the tool result
    assert events == [{"t": "step", "turnId": out["turn_token"], "id": "s1", "round": 2, "action": "chart.setTimeframe", "target": "c1",
                       "args": {"timeframe": "W"}, "mode": "apply"}]
    assert w.seen == ["s1"]
    r2 = c.calls[2]["messages"][-1]["content"][0]
    assert r2 == {"type": "tool_result", "tool_use_id": "tu2", "content": "done: Switched Chart (SPY) to weekly"}
    env = out["envelope"]
    assert env["disposition"] == "answer" and env["ops"] == [] and env["reply"] == "Weekly it is."
    assert env["steps"] == [{"id": "s1", "action": "chart.setTimeframe", "target": "c1", "mode": "apply", "status": "done"}]
    assert out["paused"] is False and out["usage"]["rounds"] == 3 and out["usage"]["steps"] == 1 and out["usage"]["model_calls"] == 3
    assert out["usage"]["input_tokens"] == 3000 and out["usage"]["cost_usd"] > 0


def test_parallel_tool_uses_run_in_order_and_answer_in_ONE_user_message():
    c = scripted(resp(tool_use("chart__setTimeframe", {"target": "c1", "args": {"timeframe": "W"}}, "a"),
                      tool_use("watchlist__add", {"target": "wl", "args": {"symbols": ["SPY"]}}, "b")),
                 resp(text("Both done.")))
    w = waiter({"status": "done", "receipt": "weekly"}, {"status": "refused", "refusal": "no such list"})
    out = run(c, w)
    msg = c.calls[1]["messages"][-1]
    assert msg["role"] == "user" and [r["tool_use_id"] for r in msg["content"]] == ["a", "b"]
    assert msg["content"][1]["is_error"] is True and msg["content"][1]["content"] == "refused: no such list"
    assert [s["status"] for s in out["envelope"]["steps"]] == ["done", "refused"]


# ── refusals before any step ──────────────────────────────────────────────────────────────────
def test_an_UNKNOWN_action_is_refused_to_the_model_and_NO_step_is_sent():
    c = scripted(resp(tool_use("account__delete", {"target": "c1", "args": {}})), resp(text("I can't do that.")))
    events, w = [], waiter({"status": "done"})
    out = run(c, w, events)
    r = c.calls[1]["messages"][-1]["content"][0]
    assert r["is_error"] is True and "unknown action" in r["content"]
    assert events == [] and w.seen == [] and out["envelope"]["steps"] == []


def test_args_OFF_SCHEMA_and_an_UNKNOWN_TARGET_fail_closed_without_a_step():
    c = scripted(resp(tool_use("chart__setTimeframe", {"target": "c1", "args": {"timeframe": "5"}}, "a"),
                      tool_use("chart__setTimeframe", {"target": "c9", "args": {"timeframe": "W"}}, "b"),
                      tool_use("chart__setTimeframe", {"target": "c1", "args": {"tf": "W"}}, "c")),
                 resp(text("Sorry.")))
    events, w = [], waiter({"status": "done"})
    run(c, w, events)
    rs = c.calls[1]["messages"][-1]["content"]
    assert [r["is_error"] for r in rs] == [True, True, True]
    assert "args off schema" in rs[0]["content"] and "unknown target" in rs[1]["content"] and "args off schema" in rs[2]["content"]
    assert events == [] and w.seen == []


def test_an_alias_declared_by_a_DONE_step_is_a_valid_target_afterwards():
    c = scripted(resp(tool_use("watchlist__create", {"target": "wl", "args": {"name": "Momentum", "as": "new1"}}, "a")),
                 resp(tool_use("watchlist__add", {"target": "new1", "args": {"symbols": ["SPY"]}}, "b")),
                 resp(text("Done.")))
    w = waiter({"status": "proposed"}, {"status": "done", "receipt": "Added SPY"})
    out = run(c, w)
    assert out["paused"] is True
    out2 = v2.run_turn_v2(message="", context={}, history=[], caller=c, wait_step=w, resume=out["state"],
                          resume_result={"id": "s1", "status": "done", "receipt": "Created Momentum"})
    assert [s["status"] for s in out2["envelope"]["steps"]] == ["done", "done"]
    assert c.calls[2]["messages"][-1]["content"][0]["content"] == "done: Added SPY"


# ── approval: a confirm-risk step is PROPOSED and PAUSES the loop ─────────────────────────────
def test_a_CONFIRM_RISK_step_is_mode_propose_and_PAUSES_until_resume(monkeypatch):
    c = scripted(resp(tool_use("watchlist__create", {"target": "wl", "args": {"name": "Momentum", "as": None}}, "tu1")),
                 resp(text("Your list is ready.")))
    events = []
    w = waiter({"status": "proposed"})
    out = run(c, w, events)
    assert events[0]["mode"] == "propose" and events[1] == {"t": "paused", "turnId": out["turn_token"], "id": "s1"}
    assert out["paused"] is True and out["envelope"]["paused"] is True and out["envelope"]["ops"] == []
    assert len(c.calls) == 1                                           # nothing is asked of the model while the card waits
    state = out["state"]
    assert state["awaiting"]["tool_use_id"] == "tu1" and state["expires"] > time.time()
    # "do it": the receipt resumes the loop as the tool result
    out2 = v2.run_turn_v2(message="", context={}, history=[], caller=c, wait_step=w, resume=state,
                          resume_result={"id": "s1", "status": "done", "receipt": "Created the watchlist “Momentum”"})
    assert len(c.calls) == 2
    assert c.calls[1]["messages"][-1]["content"] == [{"type": "tool_result", "tool_use_id": "tu1", "content": "done: Created the watchlist “Momentum”"}]
    assert out2["paused"] is False and out2["envelope"]["reply"] == "Your list is ready." and out2["envelope"]["steps"][0]["status"] == "done"
    # a resumed state cannot be resumed twice
    with pytest.raises(turn.TurnError):
        v2.run_turn_v2(message="", context={}, history=[], caller=c, resume=state, resume_result={"id": "s1", "status": "done"})


def test_a_DISMISSED_proposal_resumes_as_a_refusal_the_model_is_told_about():
    c = scripted(resp(tool_use("watchlist__create", {"target": "wl", "args": {"name": "M", "as": None}}, "tu1")),
                 resp(text("Okay, nothing was created.")))
    out = run(c, waiter({"status": "proposed"}))
    out2 = v2.run_turn_v2(message="", context={}, history=[], caller=c, resume=out["state"], resume_result={"id": "s1", "status": "refused"})
    r = c.calls[1]["messages"][-1]["content"][0]
    assert r["is_error"] is True and r["content"].startswith("refused:")
    assert out2["envelope"]["steps"][0]["status"] == "refused"
    # the reply may not claim the step that never ran
    c2 = scripted(resp(tool_use("watchlist__create", {"target": "wl", "args": {"name": "M", "as": None}}, "tu1")),
                  resp(text("Created your Momentum watchlist.")))
    o = run(c2, waiter({"status": "proposed"}))
    o2 = v2.run_turn_v2(message="", context={}, history=[], caller=c2, resume=o["state"], resume_result={"id": "s1", "status": "refused"})
    assert o2["envelope"]["reply"] == turn.NOTHING_DONE


def test_RAILS_count_tool_search_misses_unknown_names_rounds_dollars_and_pauses_value_free():
    """W2-A2: usage.rails carries per-turn counts only (no args, targets or results)."""
    search = types.SimpleNamespace(type="server_tool_use", id="st1", name="tool_search_tool_regex", input={"pattern": "chart__set"})
    hit = types.SimpleNamespace(type="tool_search_tool_result", tool_use_id="st1",
                                content={"type": "tool_search_tool_search_result", "tool_references": [{"type": "tool_reference", "tool_name": "chart__setTimeframe"}]})
    search2 = types.SimpleNamespace(type="server_tool_use", id="st2", name="tool_search_tool_regex", input={"pattern": "nope"})
    miss = types.SimpleNamespace(type="tool_search_tool_result", tool_use_id="st2",
                                 content={"type": "tool_search_tool_search_result", "tool_references": []})
    c = scripted(resp(search, hit, search2, miss, tool_use("chart__nope", {"target": "c1", "args": {}}, "tu0")),
                 resp(tool_use("watchlist__create", {"target": "wl", "args": {"name": "M", "as": None}}, "tu1")),
                 resp(text("Done.")))
    out = run(c, waiter({"status": "proposed"}))
    r = out["usage"]["rails"]
    assert (r["tool_search_calls"], r["tool_search_misses"], r["unknown_actions"], r["paused"], r["resumed"]) == (2, 1, 1, 1, 0)
    assert r["rounds"] == 2 and r["usd"] > 0 and r["worst_round_usd"] > 0
    out2 = v2.run_turn_v2(message="", context={}, history=[], caller=c, resume=out["state"], resume_result={"id": "s1", "status": "done"})
    r2 = out2["usage"]["rails"]
    assert r2["resumed"] == 1 and r2["paused"] == 1 and r2["rounds"] == 3
    assert set(r2) == set(v2.new_rails())
    assert all(isinstance(v, (int, float)) for v in r2.values())         # value-free: numbers only


def test_INDEX_layout_is_the_default_round_one_carries_the_index_and_load_actions_only():
    """W2-A2 cost: the default layout sends a compact action index in the system prompt and ONE fixed tool (load_actions);
    a capability's strict tool definition rides only the rounds after the model loaded it."""
    c = scripted(resp(tool_use("load_actions", {"names": ["chart__setTimeframe", "chart__nope"]}, "tu1")),
                 resp(tool_use("chart__setTimeframe", {"target": "c1", "args": {"timeframe": "W"}}, "tu2")),
                 resp(text("Weekly it is.")))
    w = waiter({"status": "done", "receipt": "Switched Chart (SPY) to weekly"})
    out = run(c, w)
    first, second = c.calls[0], c.calls[1]
    assert [t["name"] for t in first["tools"]] == ["load_actions"] and first["tools"][-1]["cache_control"] == {"type": "ephemeral"}
    system = first["system"][0]["text"]
    assert "<action_index>" in system and all(v2.tool_name(a["name"]) in system for a in CAPS)
    assert "tool_search_tool_regex" not in json.dumps(first["tools"])
    # the load: the known name is appended (strict, not deferred); the unknown one is told back and counted as a miss
    assert [t["name"] for t in second["tools"]] == ["load_actions", "chart__setTimeframe"]
    loaded = second["tools"][1]
    assert loaded["strict"] is True and "defer_loading" not in loaded and loaded["input_schema"]["required"] == ["target", "args"]
    told = second["messages"][-1]["content"][0]["content"]
    assert "loaded: chart__setTimeframe" in told and "chart__nope" in told
    assert out["envelope"]["steps"][0]["status"] == "done" and out["envelope"]["reply"] == "Weekly it is."
    r = out["usage"]["rails"]
    assert (r["tool_search_calls"], r["tool_search_misses"], r["rounds"]) == (1, 1, 3)
    # the first request is a fraction of the Wave 1 layout's (every capability deferred in every request)
    assert budget.request_bytes(first) < budget.request_bytes({"tools": v2.build_tools(turn.validate_manifest(CAPS, 200), False)}) * 2


def test_INDEX_a_load_of_nothing_known_is_an_error_result_and_loads_nothing():
    state = {"tools": v2.build_index_tools(False), "caps": {a["name"]: a for a in turn.validate_manifest(CAPS, 200)}}
    text_, err, misses = v2.load_actions(state, ["nope__x"])
    assert err is True and misses == 1 and len(state["tools"]) == 1 and "nope__x" in text_
    text_, err, misses = v2.load_actions(state, [])
    assert err is True and misses == 1
    text_, err, misses = v2.load_actions(state, ["watchlist.add", "watchlist__add"])          # dotted or tool name; never twice
    assert err is False and misses == 0 and [t["name"] for t in state["tools"]] == ["load_actions", "watchlist__add"]


# ── caps BEFORE the call ──────────────────────────────────────────────────────────────────────
def test_the_ROUND_CAP_ends_the_turn_after_N_calls(monkeypatch):
    c = scripted(resp(tool_use("chart", {})))                           # a model that never finishes
    out = run(c, waiter({"status": "done"}))
    assert len(c.calls) == v2.DEFAULT_ROUNDS == 6
    assert out["envelope"]["reply"] == v2.ROUND_LIMIT and out["usage"]["stopped"] == "round_limit"
    monkeypatch.setenv(v2.ROUNDS_ENV, "2")
    c = scripted(resp(tool_use("chart", {})))
    run(c, waiter({"status": "done"}))
    assert len(c.calls) == 2


def test_the_DOLLAR_CAP_stops_BEFORE_the_call_that_could_pass_it(monkeypatch):
    monkeypatch.setenv(v2.TURN_USD_ENV, "0.001")
    c = scripted(resp(text("hi")))
    out = run(c)
    assert c.calls == [] and out["envelope"]["reply"] == v2.TURN_CAP and out["usage"]["stopped"] == "turn_cap"
    # the default cap: a first call fits; the SPENT total counts against the rest
    monkeypatch.delenv(v2.TURN_USD_ENV)
    big = scripted(resp(tool_use("chart", {}), usage=(230_000, 2000)), resp(text("hi")))
    out = run(big, waiter({"status": "done"}))
    assert len(big.calls) == 1 and out["usage"]["stopped"] == "turn_cap"           # $0.24 spent: the next call's worst case does not fit


def test_the_daily_ledger_RESERVES_every_round_through_the_meter(monkeypatch):
    class M:
        def __init__(self):
            self.cats = []

        def call(self, category, fn, **kw):
            self.cats.append(category)
            return fn(**kw)

        def calls_left(self):
            return 1

        def research(self, fn):
            return fn()
    m = M()
    c = scripted(resp(tool_use("chart", {})), resp(text("ok")))
    run(c, waiter({"status": "done"}), meter=m)
    assert m.cats == ["v2_round", "v2_round"]

    class Refusing(M):
        def call(self, category, fn, **kw):
            raise budget.BudgetRefused("agent_cap", budget.AGENT_EXHAUSTED)
    with pytest.raises(budget.BudgetRefused):
        run(scripted(resp(text("x"))), meter=Refusing())


def test_a_step_that_never_reports_back_ends_the_turn_honestly():
    c = scripted(resp(tool_use("chart__setTimeframe", {"target": "c1", "args": {"timeframe": "W"}})), resp(text("x")))
    out = run(c, waiter(None))
    assert len(c.calls) == 1 and out["envelope"]["reply"] == v2.STEP_TIMEOUT and out["envelope"]["steps"][0]["status"] == "timeout"


def test_the_step_limit_per_turn_is_twelve():
    uses = [tool_use("chart__setTimeframe", {"target": "c1", "args": {"timeframe": "W"}}, f"u{i}") for i in range(13)]
    c = scripted(resp(*uses), resp(text("done")))
    out = run(c, waiter({"status": "done", "receipt": "ok"}))
    rs = c.calls[1]["messages"][-1]["content"]
    assert len(out["envelope"]["steps"]) == 12 and rs[12]["is_error"] is True and "step limit" in rs[12]["content"]


# ── isolation (ADR-005 L6) ────────────────────────────────────────────────────────────────────
def test_ISOLATED_kinds_return_a_value_free_result_to_the_model():
    c = scripted(resp(tool_use("breadth__show", {"target": "c1", "args": {"universe": "us"}}, "a"),
                      tool_use("screener__run", {"target": "sc", "args": {"show": 5}}, "b")),
                 resp(text("Shown.")))
    w = waiter({"status": "query", "result": {"value": 73.4567, "text": "73.5% above"}},
               {"status": "query", "result": {"rows": [{"symbol": "AAA", "price": 12.5}], "isolated": True}})
    run(c, w)
    rs = c.calls[1]["messages"][-1]["content"]
    assert rs[0]["content"] == v2.ISOLATED_NOTE and rs[1]["content"] == v2.ISOLATED_NOTE
    blob = json.dumps(c.calls[1]["messages"])
    assert "73.4" not in blob and "73.5" not in blob and "AAA" not in blob and "12.5" not in blob
    # a plain query result (not isolated) passes, bounded
    c = scripted(resp(tool_use("screener__run", {"target": "sc", "args": {"show": 5}}, "b")), resp(text("ok")))
    run(c, waiter({"status": "query", "result": "42 stocks match (Price > $10)"}))
    assert c.calls[1]["messages"][-1]["content"][0]["content"] == "result: 42 stocks match (Price > $10)"


def test_research_is_one_metered_lookup_and_no_change_may_follow_it(monkeypatch):
    monkeypatch.setattr(turn, "_research", lambda q, r: {"answer": "NVDA reported.", "citations": ["https://x"]})

    class M:
        def call(self, category, fn, **kw):
            return fn(**kw)

        def calls_left(self):
            return 1

        def research(self, fn):
            return fn()
    c = scripted(resp(tool_use("research__web", {"query": "why is NVDA moving", "recency": "day"}, "r1")),
                 resp(tool_use("chart__setTimeframe", {"target": "c1", "args": {"timeframe": "W"}}, "s1")),
                 resp(text("NVDA moved on its report.")))
    events = []
    out = run(c, waiter({"status": "done"}), events, meter=M(), message="why is NVDA moving? make it weekly")
    assert "research_results" in c.calls[1]["messages"][-1]["content"][0]["content"]
    r = c.calls[2]["messages"][-1]["content"][0]
    assert r["is_error"] is True and r["content"] == v2.NO_CHANGE_AFTER_RESEARCH and events == []
    assert out["usage"]["research_calls"] == 1 and out["usage"]["citations"] == ["https://x"]


def test_a_refusal_stop_and_a_truncated_reply_are_fixed_sentences():
    with pytest.raises(turn.TurnError):
        run(scripted(types.SimpleNamespace(content=[], stop_reason="refusal", usage=None)))
    out = run(scripted(types.SimpleNamespace(content=[text("I was about")], stop_reason="max_tokens",
                                             usage=types.SimpleNamespace(input_tokens=1, output_tokens=1))))
    assert out["usage"]["stopped"] == "max_tokens"


def test_the_effort_switch_applies_to_v2_rounds_too(monkeypatch):
    monkeypatch.setenv("UCT_AGENT_EFFORT", "low")
    monkeypatch.setenv("UCT_AGENT_MODEL", "claude-haiku-5-5")
    c = scripted(resp(text("hi")))
    run(c)
    assert c.calls[0]["output_config"] == {"effort": "low"} and c.calls[0]["max_tokens"] == 4096


# ── flag OFF = v1 byte-identical; the router dispatch ─────────────────────────────────────────
def _v1_call(monkeypatch):
    seen = []

    def caller(**kw):
        seen.append(kw)
        env = {"disposition": "answer", "reply": "hi", "question": None, "ops": [], "unsupported_category": None, "research": None, "title": None}
        return types.SimpleNamespace(content=[text(json.dumps(env))], stop_reason="end_turn",
                                     usage=types.SimpleNamespace(input_tokens=1, output_tokens=1))
    turn.run_turn(message="hello", context=CTX, history=[], capabilities=CAPS, caller=caller)
    return seen[0]


def test_FLAG_OFF_v1_request_is_byte_identical_and_the_flag_alone_changes_nothing_in_run_turn(monkeypatch):
    monkeypatch.delenv(v2.PLANNER_ENV)
    off = _v1_call(monkeypatch)
    monkeypatch.setenv(v2.PLANNER_ENV, "v2")
    on = _v1_call(monkeypatch)                      # run_turn without the router's `v2` argument: untouched
    assert json.dumps(on, default=str) == json.dumps(off, default=str)
    assert "tools" not in off and off["output_config"]["format"]["type"] == "json_schema"
    assert v2.planner() == "v2"
    monkeypatch.setenv(v2.PLANNER_ENV, "V2 ")
    assert v2.planner() == "v2"
    monkeypatch.setenv(v2.PLANNER_ENV, "on")
    assert v2.planner() == "v1"


@pytest.fixture
def app(monkeypatch):
    store._reset_for_tests()
    budget._reset_for_test()
    limits._reset_for_test()
    daily_counters.clear()
    narrative_cost_guard._reset_for_test(turn.COST_SURFACE)
    monkeypatch.setattr(budget, "site_spend_usd", lambda: (0.0, 15.0))
    monkeypatch.setattr(rx, "is_paid_user", lambda u: True)
    from api.middleware.auth_middleware import get_current_user_with_plan
    a = FastAPI()
    a.include_router(rx.router)
    a.state.user = ADMIN
    a.dependency_overrides[get_current_user_with_plan] = lambda: a.state.user
    yield a
    budget._reset_for_test()
    limits._reset_for_test()
    daily_counters.clear()


def test_config_reports_the_planner(app, monkeypatch):
    c = TestClient(app)
    assert c.get("/api/agent/config").json()["planner"] == "v2"
    monkeypatch.delenv(v2.PLANNER_ENV)
    assert c.get("/api/agent/config").json()["planner"] == "v1"


def test_MEMBER_403_before_any_provider_call_on_every_v2_route(app, monkeypatch):
    called = []
    monkeypatch.setattr(turn, "_default_caller", lambda **kw: called.append(kw))
    app.state.user = MEMBER
    c = TestClient(app)
    body = {"message": "switch to weekly", "context": CTX, "capabilities": CAPS}
    assert c.post("/api/agent/turn/stream", json=body).status_code == 403
    assert c.post("/api/agent/turn", json=body).status_code == 403
    assert c.post("/api/agent/turn/step", json={"turnId": "v2_x", "id": "s1", "status": "done"}).status_code == 403
    assert c.post("/api/agent/turn/resume", json={"turnId": "v2_x", "id": "s1", "status": "done"}).status_code == 403
    assert c.get("/api/agent/config").status_code == 403
    assert called == []


def _events(text_body: str) -> list[dict]:
    return [json.loads(l[6:]) for l in text_body.split("\n") if l.startswith("data: ")]


def test_STREAM_route_runs_the_loop_the_step_route_feeds_it_and_the_transcript_gets_one_row(app, monkeypatch):
    c = scripted(resp(tool_use("chart__setTimeframe", {"target": "c1", "args": {"timeframe": "W"}}, "tu1")), resp(text("Weekly now.")))
    monkeypatch.setattr(turn, "_default_caller", c)
    client = TestClient(app)
    fed = []

    def browser():
        # the browser: the moment a step is waiting under some token, report it back through the STEP ROUTE
        for _ in range(200):
            with rx._V2_LOCK:
                tokens = list(rx._V2_STEPS)
            if tokens:
                r = client.post("/api/agent/turn/step", json={"turnId": tokens[0], "id": "s1", "status": "done", "receipt": "Switched to weekly",
                                                              "result": {"isolated": True, "value": 99.9}})
                fed.append(r.status_code)
                return
            time.sleep(0.02)
    th = threading.Thread(target=browser)
    th.start()
    r = client.post("/api/agent/turn/stream", json={"message": "switch to weekly", "context": CTX, "capabilities": CAPS})
    th.join(10)
    assert r.status_code == 200 and fed == [200]
    ev = _events(r.text)
    assert ev[0]["t"] == "step" and ev[0]["action"] == "chart.setTimeframe" and ev[0]["mode"] == "apply"
    final = ev[-1]
    assert final["t"] == "final" and final["envelope"]["reply"] == "Weekly now." and final["envelope"]["planner"] == "v2"
    assert final["turnId"] is not None and final["usage"]["rounds"] == 2 and final["usage"]["steps"] == 1
    assert "99.9" not in json.dumps(c.calls[1]["messages"])            # L6: the isolated value never reached the model
    rows = store.get_turns(ADMIN["id"], final["conversationId"])
    assert [t["role"] for t in rows] == ["member", "agent"] and rows[1]["text"] == "Weekly now."
    assert rx._V2_STEPS == {}                                          # the registry is cleaned up
    # a step for a turn that is not waiting (or not this member's) is 404
    assert client.post("/api/agent/turn/step", json={"turnId": "v2_nope", "id": "s1", "status": "done"}).status_code == 404


def test_PAUSE_and_RESUME_over_the_routes(app, monkeypatch):
    c = scripted(resp(tool_use("watchlist__create", {"target": "wl", "args": {"name": "Momentum", "as": None}}, "tu1")), resp(text("Ready.")))
    monkeypatch.setattr(turn, "_default_caller", c)
    client = TestClient(app)

    def browser():
        for _ in range(200):
            with rx._V2_LOCK:
                tokens = list(rx._V2_STEPS)
            if tokens:
                client.post("/api/agent/turn/step", json={"turnId": tokens[0], "id": "s1", "status": "proposed"})
                return
            time.sleep(0.02)
    th = threading.Thread(target=browser)
    th.start()
    r = client.post("/api/agent/turn/stream", json={"message": "make a Momentum list", "context": CTX, "capabilities": CAPS})
    th.join(10)
    ev = _events(r.text)
    assert [e["t"] for e in ev] == ["step", "paused", "final"]
    token = ev[1]["turnId"]
    assert ev[2]["envelope"]["paused"] is True and ev[2]["turnId"] is None and token in rx._V2_PAUSED
    assert len(c.calls) == 1
    # "do it": the browser applied the card and resumes with the receipt
    r2 = client.post("/api/agent/turn/resume", json={"turnId": token, "id": "s1", "status": "done", "receipt": "Created “Momentum”"})
    ev2 = _events(r2.text)
    assert ev2[-1]["t"] == "final" and ev2[-1]["envelope"]["reply"] == "Ready." and ev2[-1]["turnId"] is not None
    assert len(c.calls) == 2 and token not in rx._V2_PAUSED
    # resumed once: a second resume is gone
    r3 = client.post("/api/agent/turn/resume", json={"turnId": token, "id": "s1", "status": "done"})
    assert _events(r3.text)[-1] == {"t": "error", "status": 410, "detail": "That proposal's turn has expired (a proposal is good for 10 minutes). Ask again."}


def test_FLAG_OFF_the_stream_route_serves_v1_and_never_registers_a_step_turn(app, monkeypatch):
    monkeypatch.delenv(v2.PLANNER_ENV)
    seen = []

    def caller(**kw):
        seen.append(kw)
        env = {"disposition": "answer", "reply": "hi", "question": None, "ops": [], "unsupported_category": None, "research": None, "title": None}
        return types.SimpleNamespace(content=[text(json.dumps(env))], stop_reason="end_turn",
                                     usage=types.SimpleNamespace(input_tokens=1, output_tokens=1))
    monkeypatch.setattr(turn, "_default_caller", caller)
    monkeypatch.setattr(turn, "_default_stream_caller", lambda on_text, **kw: caller(**kw))
    client = TestClient(app)
    r = client.post("/api/agent/turn/stream", json={"message": "hello", "context": CTX, "capabilities": CAPS})
    ev = _events(r.text)
    assert ev[-1]["t"] == "final" and ev[-1]["envelope"]["reply"] == "hi" and "planner" not in ev[-1]["envelope"]
    assert "tools" not in seen[0] and rx._V2_STEPS == {}
    assert client.post("/api/agent/turn/resume", json={"turnId": "v2_x", "id": "s1", "status": "done"}).text.count('"status":404') == 1
