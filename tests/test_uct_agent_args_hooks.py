"""UCT Agent — W2-A3: the args normalizer at its two doors (compact ops in v1, tool-use steps in v2) and the catalog
example. The live shapes from LT-3 now expand; what cannot be made valid is still refused with the member's
fixed sentence (v1) or an explicit reason + the example shape for the model (v2). No model call."""
from __future__ import annotations

import json
import types

import pytest

from api.services.uct_agent import turn, turn_v2 as v2

ARGS = lambda props, req=None: {"type": "object", "properties": props, "required": req if req is not None else list(props), "additionalProperties": False}  # noqa: E731
CAPS = [
    {"name": "chart.setSetting", "domain": "chart", "target": "chart", "summary": "Change one display setting.", "hints": "value = true/false for on/off settings",
     "risk": "local", "reversible": True, "undo": "exact",
     "args": ARGS({"setting": {"type": "string", "enum": ["grid.visible", "textSize", "bgGradient.top"]}, "value": {"type": ["string", "number", "boolean"]}})},
    {"name": "chart.replay", "domain": "chart", "target": "chart", "summary": "Replay from a date.", "hints": None, "risk": "local", "reversible": True, "undo": "exact",
     "args": ARGS({"date": {"type": ["string", "null"]}})},
    {"name": "screener.run", "domain": "screener", "target": "screener", "summary": "Run a screen.", "hints": None, "risk": "local", "reversible": True, "undo": "none", "query": True,
     "args": ARGS({"filters": {"type": "array", "items": {"type": "object", "properties": {"field": {"type": "string"}, "op": {"type": "string", "enum": ["gt", "gte"]},
                                                                                           "value": {"type": ["number", "null"]}}, "required": ["field", "op", "value"], "additionalProperties": False}},
                   "sort_field": {"type": ["string", "null"]}, "sort_dir": {"type": ["string", "null"], "enum": ["asc", "desc", None]},
                   "mode": {"type": "string", "enum": ["new", "refine"]}, "show": {"type": ["integer", "null"]}})},
    {"name": "widget.addCharts", "domain": "widget", "target": "workspace", "summary": "Add charts.", "hints": None, "risk": "local", "reversible": True, "undo": "exact",
     "args": ARGS({"symbols": {"anyOf": [{"type": "array", "items": {"type": "string"}}, {"type": "object", "properties": {"from": {"type": "string"}, "top": {"type": ["integer", "null"]}}, "required": ["from", "top"], "additionalProperties": False}]},
                   "timeframe": {"type": ["string", "null"], "enum": ["D", "W", None]}, "chart_type": {"type": ["string", "null"], "enum": ["candles", "bars", None]}, "exact": {"type": ["boolean", "null"]}})},
]
CTX = {"surface": "charts", "charts": [{"ref": "c1", "label": "Chart (SPY)", "symbol": "SPY"}], "screener": [{"ref": "s1", "label": "Screener"}], "workspace": [{"ref": "w1", "label": "Workspace"}]}


def compact(action, target, args):
    return {"disposition": "apply", "reply": "", "question": None, "unsupported_category": None, "research": None,
            "ops": [{"action": action, "target": target, "args_json": json.dumps(args)}]}


@pytest.fixture(autouse=True)
def _no_cost(monkeypatch):
    monkeypatch.setattr(turn, "_record_cost", lambda r: 0.0)


# ── v1: expand_compact_ops ────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("action,given,want", [
    ("chart.setSetting", {"setting": "grid.visible", "value": "false"}, {"setting": "grid.visible", "value": False}),
    ("chart.setSetting", {"bgGradient.top": False}, {"setting": "bgGradient.top", "value": False}),
    ("chart.setSetting", {"setting": "textSize", "value": "14"}, {"setting": "textSize", "value": 14}),
    ("chart.replay", {}, {"date": None}),
    ("chart.replay", {"date": "null"}, {"date": None}),
    ("screener.run", {"sort_field": "perf_3m", "sort_dir": "DESC", "mode": "refine"}, {"filters": [], "sort_field": "perf_3m", "sort_dir": "desc", "mode": "refine", "show": None}),
    ("screener.run", {"filters": [{"field": "price", "op": "gte", "value": "10"}], "mode": "new"}, {"filters": [{"field": "price", "op": "gte", "value": 10}], "sort_field": None, "sort_dir": None, "mode": "new", "show": None}),
    ("widget.addCharts", {"symbols": {"from": "lastScreen", "top": "2"}, "timeframe": "d", "chart_type": "Candles", "exact": "false"}, {"symbols": {"from": "lastScreen", "top": 2}, "timeframe": "D", "chart_type": "candles", "exact": False}),
    ("widget.addCharts", {"symbol": "NVDA"}, {"symbols": ["NVDA"], "timeframe": None, "chart_type": None, "exact": None}),
])
def test_the_live_shapes_now_expand_in_v1(action, given, want):
    caps = turn.validate_manifest(CAPS)
    env = turn.expand_compact_ops(compact(action, "c1", given), caps)
    assert env["ops"] == [{"action": action, "target": "c1", "args": want}]
    assert turn.args_match({c["name"]: c for c in caps}[action]["args"], env["ops"][0]["args"])


@pytest.mark.parametrize("action,given", [
    ("chart.setSetting", {"gradient": False}),
    ("chart.setSetting", {"setting": "grid.visible"}),
    ("chart.replay", {"exit": True}),
    ("widget.addCharts", {"symbols": ["NVDA"], "timeframe": "D", "chart_type": None, "exact": None, "indicators": ["EMA 9"]}),
    ("screener.run", {"filters": [], "mode": "new", "show": "all"}),
])
def test_what_cannot_be_made_valid_is_still_refused_with_the_members_sentence(action, given, caplog):
    caps = turn.validate_manifest(CAPS)
    with pytest.raises(turn.TurnError) as e:
        turn.expand_compact_ops(compact(action, "c1", given), caps)
    assert "couldn't fill in the details of one of the steps" in str(e.value)
    assert e.value.reason == "unreadable:args_schema"
    # the log says why, by shape (no member words)
    assert any("args_schema" in r.getMessage() and "why" in r.getMessage() for r in caplog.records)


def test_args_already_as_declared_are_untouched_and_not_logged(caplog):
    caps = turn.validate_manifest(CAPS)
    env = turn.expand_compact_ops(compact("chart.setSetting", "c1", {"setting": "grid.visible", "value": False}), caps)
    assert env["ops"][0]["args"] == {"setting": "grid.visible", "value": False}
    assert not any("args normalized" in r.getMessage() for r in caplog.records)


def test_the_compact_shape_is_forced_for_this_check(monkeypatch):
    monkeypatch.setattr(turn, "compact_ops", lambda caps, force=False: True)
    env = compact("chart.setSetting", "c1", {"setting": "grid.visible", "value": "false"})

    def caller(**kw):
        return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=json.dumps(env))], stop_reason="end_turn",
                                     usage=types.SimpleNamespace(input_tokens=10, output_tokens=5))
    out = turn.run_turn(message="turn the grid off", context=CTX, history=[], capabilities=CAPS, caller=caller)
    assert out["envelope"]["disposition"] == "apply"
    assert out["envelope"]["ops"] == [{"action": "chart.setSetting", "target": "c1", "args": {"setting": "grid.visible", "value": False}}]


# ── v2: the tool-use step ─────────────────────────────────────────────────────────────────────
def tool_use(name, inp, id_="tu1"):
    return types.SimpleNamespace(type="tool_use", id=id_, name=name, input=inp)


def text(s):
    return types.SimpleNamespace(type="text", text=s)


def resp(*blocks):
    stop = "end_turn" if all(getattr(b, "type", None) == "text" for b in blocks) else "tool_use"
    return types.SimpleNamespace(content=list(blocks), stop_reason=stop,
                                 usage=types.SimpleNamespace(input_tokens=100, output_tokens=5, cache_read_input_tokens=0, cache_creation_input_tokens=0))


def scripted(*resps):
    calls = []

    def caller(**kw):
        calls.append(kw)
        return resps[min(len(calls), len(resps)) - 1]
    caller.calls = calls
    return caller


def waiter(*results):
    seen = []

    def wait_step(step_id):
        seen.append(step_id)
        r = results[min(len(seen), len(results)) - 1]
        return {"id": step_id, **r}
    wait_step.seen = seen
    return wait_step


@pytest.fixture(autouse=True)
def _v2(monkeypatch):
    monkeypatch.setenv(v2.PLANNER_ENV, "v2")
    monkeypatch.delenv("UCT_AGENT_EFFORT", raising=False)


def test_a_v2_step_with_a_live_shape_runs_with_the_normalized_args():
    c = scripted(resp(tool_use("chart__setSetting", {"target": "c1", "args": {"setting": "grid.visible", "value": "false"}})), resp(text("Grid off.")))
    events, w = [], waiter({"status": "done", "receipt": "Grid hidden"})
    out = v2.run_turn_v2(message="turn the grid off", context=CTX, history=[], capabilities=CAPS, caller=c, on_event=events.append, wait_step=w)
    assert events[0]["args"] == {"setting": "grid.visible", "value": False}
    assert out["envelope"]["steps"][0]["status"] == "done"
    assert out["usage"]["rails"] == {"args_normalized": 1, "args_refused": 0}


def test_a_v2_step_that_cannot_be_made_valid_tells_the_model_why_and_the_example_shape():
    c = scripted(resp(tool_use("widget__addCharts", {"target": "w1", "args": {"symbols": ["NVDA"], "timeframe": "D", "chart_type": None, "exact": None, "indicators": ["EMA 9"]}})),
                 resp(text("Sorry.")))
    events, w = [], waiter({"status": "done"})
    out = v2.run_turn_v2(message="open nvda with the 9 ema", context=CTX, history=[], capabilities=CAPS, caller=c, on_event=events.append, wait_step=w)
    r = c.calls[1]["messages"][-1]["content"][0]
    assert r["is_error"] is True
    assert "args off schema for widget.addCharts: unexpected argument indicators" in r["content"]
    assert 'e.g. {"symbols":["NVDA","AMD"],"timeframe":"D","chart_type":"candles","exact":null}' in r["content"]
    assert events == [] and w.seen == []
    assert out["usage"]["rails"] == {"args_normalized": 0, "args_refused": 1}


def test_the_v2_tool_description_carries_the_example_too():
    caps = turn.validate_manifest(CAPS)
    tools = {t["name"]: t for t in v2.build_tools(caps, research=False)}
    assert 'e.g. args {"setting":"grid.visible","value":1}' in tools["chart__setSetting"]["description"]
