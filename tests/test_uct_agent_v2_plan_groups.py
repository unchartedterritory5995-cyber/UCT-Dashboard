"""V2-G2 (natural-language equivalence for planner v2; owner: "Put four charts on my screen", no phrase workaround).

Consecutive ordinary change steps of ONE model response form a PLAN GROUP the browser runs as ONE plan (what one v1
envelope's ops are). Scripted model and browser; no call. Pins: grouping rules, event shape, one result per step in
order, a refused member is told and the group goes on, a group that becomes a card pauses once and the card's outcome
settles every waiting step, a query / guarded step / Undo breaks the group, aliases declared inside the group may be
targeted inside it, and the index prompt tells the model to send changes that only work together in one response."""
from __future__ import annotations

import pytest

from api.services.uct_agent import turn, turn_v2 as v2
from tests.test_uct_agent_planner_v2 import ARGS, CAPS, CTX, resp, scripted, text, tool_use  # noqa: F401

ADD = {"name": "widget.add", "domain": "widget", "target": "workspace", "summary": "Add a widget.", "hints": None, "risk": "local",
       "reversible": True, "undo": "exact", "args": ARGS({"type": {"type": "string", "enum": ["chart", "news"]}, "as": {"type": ["string", "null"]}})}
ARRANGE = {"name": "widget.arrange", "domain": "widget", "target": "board", "summary": "Re-tile the board.", "hints": None, "risk": "local",
           "reversible": True, "undo": "exact", "args": ARGS({"layout": {"type": "string", "enum": ["grid"]}})}
UNDO = {"name": "agent.undo", "domain": "agent", "target": "about", "summary": "Undo.", "hints": None, "risk": "local", "reversible": True,
        "undo": "none", "query": True, "args": ARGS({"scope": {"type": "string", "enum": ["last", "all"]}, "about": {"type": ["string", "null"]}})}
CAPS_G = CAPS + [ADD, ARRANGE, UNDO]
CTX_G = {**CTX, "workspace": [{"ref": "w1", "label": "Workspace"}], "board": [{"ref": "b1", "label": "Board"}], "agent": [{"ref": "a1", "label": "Agent"}]}


@pytest.fixture(autouse=True)
def _flags(monkeypatch):
    monkeypatch.setenv(v2.PLANNER_ENV, "v2")
    for k in (v2.ROUNDS_ENV, v2.TURN_USD_ENV, v2.TOOLS_ENV, "UCT_AGENT_EFFORT"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(turn, "_record_cost", lambda r: 0.0)


def browser(*statuses):
    seen = []

    def wait_step(step_id):
        seen.append(step_id)
        st = statuses[min(len(seen), len(statuses)) - 1]
        return {"id": step_id, **st}
    wait_step.seen = seen
    return wait_step


def go(c, w, ev=None, message="put four charts on my screen", step_groups=True):
    return v2.run_turn_v2(message=message, context=CTX_G, history=[], capabilities=CAPS_G, caller=c,
                          on_event=(ev.append if ev is not None else None), wait_step=w, step_groups=step_groups)


def four():
    return [tool_use("widget__add", {"target": "w1", "args": {"type": "chart", "as": None}}, f"a{i}") for i in range(3)] + \
           [tool_use("widget__arrange", {"target": "b1", "args": {"layout": "grid"}}, "r1")]


def test_GROUP_consecutive_changes_of_one_response_are_one_plan_group_with_one_result_each_in_order():
    ev, c = [], scripted(resp(*four()), resp(text("")))
    w = browser({"status": "done", "receipt": "Added 3 charts and arranged 4 widgets as grid"})
    out = go(c, w, ev)
    steps = [e for e in ev if e["t"] == "step"]
    assert [s["action"] for s in steps] == ["widget.add"] * 3 + ["widget.arrange"]
    assert {s["group"]["id"] for s in steps} == {"g1"} and [s["group"]["index"] for s in steps] == [0, 1, 2, 3]
    assert all(s["group"]["size"] == 4 for s in steps)
    assert w.seen == ["s1", "s2", "s3", "s4"]                                   # every result read, in step order
    told = c.calls[1]["messages"][-1]["content"]
    assert [r["tool_use_id"] for r in told] == ["a0", "a1", "a2", "r1"] and all(r["content"].startswith("done:") for r in told)
    assert [s["status"] for s in out["envelope"]["steps"]] == ["done"] * 4


def test_GROUP_a_single_change_carries_no_group_field():
    ev = []
    go(scripted(resp(tool_use("chart__setTimeframe", {"target": "c1", "args": {"timeframe": "W"}}, "t1")), resp(text(""))),
       browser({"status": "done", "receipt": "ok"}), ev, message="weekly")
    assert "group" not in [e for e in ev if e["t"] == "step"][0]


@pytest.mark.parametrize("breaker,first", [
    (tool_use("screener__run", {"target": "sc", "args": {"show": 5}}, "q1"), {"status": "query", "result": "r"}),
    (tool_use("watchlist__create", {"target": "wl", "args": {"name": "M", "as": None}}, "p1"), {"status": "done", "receipt": "ok"}),
    (tool_use("agent__undo", {"target": "a1", "args": {"scope": "last", "about": None}}, "u1"), {"status": "done", "receipt": "ok"}),
])
def test_GROUP_a_query_a_guarded_step_or_the_undo_breaks_the_group(breaker, first):
    ev = []
    c = scripted(resp(tool_use("chart__setTimeframe", {"target": "c1", "args": {"timeframe": "W"}}, "t1"), breaker,
                      tool_use("chart__setTimeframe", {"target": "c1", "args": {"timeframe": "D"}}, "t2")), resp(text("")))
    go(c, browser({"status": "done", "receipt": "ok"}, first, {"status": "done", "receipt": "ok"}), ev)
    steps = [e for e in ev if e["t"] == "step"]
    assert len(steps) == 3 and all("group" not in s for s in steps)


def test_GROUP_a_refused_member_is_told_and_the_rest_still_run_as_one_group():
    ev = []
    c = scripted(resp(tool_use("widget__add", {"target": "w1", "args": {"type": "chart", "as": None}}, "a0"),
                      tool_use("widget__add", {"target": "w1", "args": {"type": "spaceship", "as": None}}, "bad"),
                      tool_use("widget__arrange", {"target": "b1", "args": {"layout": "grid"}}, "r1")), resp(text("")))
    go(c, browser({"status": "done", "receipt": "ok"}), ev)
    steps = [e for e in ev if e["t"] == "step"]
    assert [s["action"] for s in steps] == ["widget.add", "widget.arrange"] and steps[0]["group"]["size"] == 2
    told = {r["tool_use_id"]: r for r in c.calls[1]["messages"][-1]["content"]}
    assert told["bad"]["is_error"] is True and "args off schema" in told["bad"]["content"]


def test_GROUP_an_alias_declared_inside_the_group_may_be_targeted_inside_it():
    ev = []
    c = scripted(resp(tool_use("widget__add", {"target": "w1", "args": {"type": "chart", "as": "new1"}}, "a0"),
                      tool_use("chart__setTimeframe", {"target": "new1", "args": {"timeframe": "W"}}, "t1")), resp(text("")))
    go(c, browser({"status": "done", "receipt": "ok"}), ev)
    steps = [e for e in ev if e["t"] == "step"]
    assert [s["target"] for s in steps] == ["w1", "new1"] and steps[1]["group"]["size"] == 2
    # outside a group an undeclared alias is still refused
    c2 = scripted(resp(tool_use("chart__setTimeframe", {"target": "new9", "args": {"timeframe": "W"}}, "t1")), resp(text("")))
    go(c2, browser({"status": "done"}))
    assert "unknown target" in c2.calls[1]["messages"][-1]["content"][0]["content"]


def test_GROUP_that_became_ONE_card_pauses_once_and_its_outcome_settles_every_step():
    c = scripted(resp(*four()), resp(text("")))
    out = go(c, browser({"status": "proposed"}))
    assert out["paused"] is True and out["state"]["awaiting"]["step"]["id"] == "s4"
    assert [o["step"]["id"] for o in out["state"]["awaiting"]["others"]] == ["s1", "s2", "s3"]
    out2 = v2.run_turn_v2(message="", context={}, history=[], caller=c, resume=out["state"], resume_result={"id": "s4", "status": "done", "receipt": "Added"})
    told = c.calls[1]["messages"][-1]["content"]
    assert sorted(r["tool_use_id"] for r in told) == ["a0", "a1", "a2", "r1"] and all(r["content"].startswith("done:") for r in told)
    assert [s["status"] for s in out2["envelope"]["steps"]] == ["done"] * 4
    # dismissed: every step of the card is refused
    c3 = scripted(resp(*four()), resp(text("")))
    o3 = go(c3, browser({"status": "proposed"}))
    o4 = v2.run_turn_v2(message="", context={}, history=[], caller=c3, resume=o3["state"], resume_result={"id": "s4", "status": "refused"})
    assert [s["status"] for s in o4["envelope"]["steps"]] == ["refused"] * 4


def test_GROUP_the_index_prompt_tells_the_model_changes_that_only_work_together_go_in_one_response():
    system = v2._start("x", CTX_G, [], CAPS_G, None, None, None, None, None)["system"][0]["text"]
    assert "run as ONE plan" in system and "re-arranging the board to make room" in system


def test_GROUP_only_for_a_browser_that_declared_support_otherwise_one_step_at_a_time_and_a_card_holds_the_rest():
    """review #782: an older browser (no stepGroups) gets the old stream: no `group`, and a card on step 1 pauses the
    turn BEFORE step 2 is ever sent."""
    ev, c = [], scripted(resp(*four()), resp(text("")))
    w = browser({"status": "proposed"})
    out = go(c, w, ev, step_groups=False)
    steps = [e for e in ev if e["t"] == "step"]
    assert len(steps) == 1 and "group" not in steps[0] and w.seen == ["s1"] and out["paused"] is True
    assert out["state"]["awaiting"].get("others") == []


def test_GROUP_the_router_passes_the_declared_capability_and_nothing_else():
    from api.routers import uct_agent as rx
    assert rx.TurnIn(message="x").stepGroups is False
    assert rx.TurnIn(message="x", stepGroups=True).stepGroups is True
