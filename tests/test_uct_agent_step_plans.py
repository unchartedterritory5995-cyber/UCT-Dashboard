"""NLM-1 (d): STEP PLANS through the v1 planner schema (api/services/uct_agent/turn.py).

An op may carry an `id` (null unless a LATER op needs its result); a later op names that result as "$<id>.chart" (a
target) or "$<id>.indicator" (an indicator change's instance). The server:
  * puts `id` on every op of the output schema (embedded and compact), required and nullable (strict grammar);
  * drops a null id, so a plan that uses no results reaches the browser EXACTLY as before;
  * refuses the WHOLE plan when a reference names a later or missing step, or an id is malformed or reused;
  * accepts an earlier step's result as a target (never "Which one do you mean?");
  * tells the model about a bad reference in its repair round (nl1_plan_problems).
The browser (nlm1/stepPlans.js) checks the rest and runs the plan; nlm1StepPlans.test.jsx replays these shapes.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from api.services.uct_agent import turn

ROOT = Path(__file__).resolve().parents[1]
GOLDEN = json.loads((ROOT / "app/src/agent/contract/manifest.golden.json").read_text(encoding="utf-8"))["capabilities"]
BY = {c["name"]: c for c in GOLDEN}
NAMES = ["widget.add", "chart.setSymbol", "chart.setTimeframe", "indicator.add", "indicatorStyle.set"]
CAPS = turn.validate_manifest([BY[n] for n in NAMES])
CAP_NAMES = {c["name"] for c in CAPS}
REFS = {"workspace", "c1", "c2", "ixe:c1", "ixe:c2"}
MA21 = {"defId": "movingAverage", "inputs": [{"key": "period", "value": 21}, {"key": "maType", "value": "ema"}]}


def env(ops, disp="apply"):
    return {"disposition": disp, "reply": "", "question": None, "ops": ops, "unsupported_category": None,
            "research": None, "title": None}


def style(instance):
    return {"instance": instance, "property": "color", "value": "orange", "output": None}


# ── schema + prompt ─────────────────────────────────────────────────────────────────────────────────────────────
def test_every_op_shape_carries_a_required_nullable_id():
    emb = turn.envelope_schema(CAPS)
    assert not turn.compact_ops(CAPS)
    for v in emb["properties"]["ops"]["items"]["anyOf"]:
        assert v["properties"]["id"] == {"type": ["string", "null"]} and "id" in v["required"]
        assert v["additionalProperties"] is False
    comp = turn.envelope_schema(CAPS, compact=True)["properties"]["ops"]["items"]
    assert comp["properties"]["id"] == {"type": ["string", "null"]} and "id" in comp["required"]


def test_the_prompt_teaches_step_results_once():
    p = turn.system_prompt(CAPS)
    text = "".join(b.get("text", "") for b in p) if isinstance(p, list) else p
    assert text.count("STEP RESULTS.") == 1
    assert '"$s1.chart"' in text and '"$s1.indicator"' in text and "Never reference a later or missing id" in text


# ── backward compatible: no ids → exactly as before ─────────────────────────────────────────────────────────────
def test_a_plan_with_null_ids_reaches_the_browser_exactly_as_a_plan_without_ids():
    plain = [{"action": "chart.setTimeframe", "target": "c1", "args": {"timeframe": "W"}},
             {"action": "indicator.add", "target": "ixe:c1", "args": {"defId": "rsi", "inputs": None}}]
    with_nulls = [{**o, "id": None} for o in plain]
    a = turn.sanitize_envelope(env(plain), REFS, CAP_NAMES)
    b = turn.sanitize_envelope(env(with_nulls), REFS, CAP_NAMES)
    assert a == b and all("id" not in o for o in b["ops"])


def test_compact_ops_keep_a_string_id_and_drop_a_null_one():
    ops = [{"action": "chart.setTimeframe", "target": "c1", "args_json": json.dumps({"timeframe": "W"}), "id": "s1"},
           {"action": "chart.setTimeframe", "target": "c2", "args_json": json.dumps({"timeframe": "D"}), "id": None}]
    out = turn.expand_compact_ops(env(ops), CAPS)["ops"]
    assert out[0]["id"] == "s1" and "id" not in out[1]


# ── a valid step plan passes, results as targets / instances ─────────────────────────────────────────────────────
def test_a_valid_step_plan_passes_with_its_ids_and_references():
    ops = [{"id": "c", "action": "widget.add", "target": "workspace", "args": {"type": "chart", "as": None}},
           {"id": None, "action": "chart.setSymbol", "target": "$c.chart", "args": {"symbol": "AMD"}},
           {"id": "e", "action": "indicator.add", "target": "$c.chart", "args": MA21},
           {"id": None, "action": "indicatorStyle.set", "target": "$c.chart", "args": style("$e.indicator")}]
    out = turn.sanitize_envelope(env(ops), REFS, CAP_NAMES)
    assert out["disposition"] == "apply"
    assert [o.get("id") for o in out["ops"]] == ["c", None, "e", None]
    assert [o["target"] for o in out["ops"]] == ["workspace", "$c.chart", "$c.chart", "$c.chart"]
    assert out["ops"][3]["args"]["instance"] == "$e.indicator"


def test_the_realistic_compact_plan_converts_to_the_browser_shape():
    """ "add a chart for AMD, make it weekly, put the 21 EMA and RSI on it, then make the EMA orange" as the model
    writes it (compact) → what the browser receives (nlm1StepPlans P11 replays that shape through the real panel)."""
    def c(i, a, t, args):
        return {"id": i, "action": a, "target": t, "args_json": json.dumps(args)}
    model = env([c("c", "widget.add", "workspace", {"type": "chart", "as": None}),
                 c(None, "chart.setSymbol", "$c.chart", {"symbol": "AMD"}),
                 c(None, "chart.setTimeframe", "$c.chart", {"timeframe": "W"}),
                 c("e", "indicator.add", "$c.chart", MA21),
                 c(None, "indicator.add", "$c.chart", {"defId": "rsi", "inputs": None}),
                 c(None, "indicatorStyle.set", "$c.chart", style("$e.indicator"))])
    out = turn.sanitize_envelope(turn.expand_compact_ops(model, CAPS), REFS, CAP_NAMES)
    assert [(o["action"], o["target"], o.get("id")) for o in out["ops"]] == [
        ("widget.add", "workspace", "c"), ("chart.setSymbol", "$c.chart", None), ("chart.setTimeframe", "$c.chart", None),
        ("indicator.add", "$c.chart", "e"), ("indicator.add", "$c.chart", None), ("indicatorStyle.set", "$c.chart", None)]
    assert out["ops"][5]["args"]["instance"] == "$e.indicator"


# ── malformed step plans are refused WHOLE ──────────────────────────────────────────────────────────────────────
BAD = {
    "forward reference (target)": [
        {"id": None, "action": "chart.setTimeframe", "target": "$later.chart", "args": {"timeframe": "W"}},
        {"id": "later", "action": "widget.add", "target": "workspace", "args": {"type": "chart", "as": None}}],
    "forward reference (instance)": [
        {"id": None, "action": "indicatorStyle.set", "target": "ixe:c1", "args": style("$e.indicator")},
        {"id": "e", "action": "indicator.add", "target": "ixe:c1", "args": MA21}],
    "missing step": [
        {"id": "s1", "action": "chart.setSymbol", "target": "c1", "args": {"symbol": "AMD"}},
        {"id": None, "action": "chart.setTimeframe", "target": "$s2.chart", "args": {"timeframe": "W"}}],
    "self reference": [
        {"id": "s1", "action": "chart.setTimeframe", "target": "$s1.chart", "args": {"timeframe": "W"}}],
    "id used twice": [
        {"id": "a", "action": "chart.setSymbol", "target": "c1", "args": {"symbol": "AMD"}},
        {"id": "a", "action": "chart.setTimeframe", "target": "$a.chart", "args": {"timeframe": "W"}}],
    "malformed id": [
        {"id": "$bad id", "action": "chart.setSymbol", "target": "c1", "args": {"symbol": "AMD"}}],
}


@pytest.mark.parametrize("name", sorted(BAD))
def test_a_malformed_step_plan_is_refused_whole(name):
    with pytest.raises(turn.TurnError) as e:
        turn.sanitize_envelope(env(BAD[name]), REFS, CAP_NAMES)
    assert str(e.value) == turn.STEP_PLAN_REFUSED


@pytest.mark.parametrize("name", sorted(BAD))
def test_the_repair_round_hears_why(name):
    problems = turn.nl1_plan_problems(env(BAD[name]), CAPS, REFS)
    assert problems and any("EARLIER" in p or "id" in p for p in problems)


def test_the_repair_round_never_calls_an_earlier_steps_result_an_unknown_target():
    ops = [{"id": "s1", "action": "chart.setSymbol", "target": "c1", "args_json": json.dumps({"symbol": "AMD"})},
           {"id": None, "action": "chart.setTimeframe", "target": "$s1.chart", "args_json": json.dumps({"timeframe": "W"})}]
    assert turn.nl1_plan_problems(env(ops), CAPS, REFS) == []


def test_a_talk_reply_never_mutates_whatever_ids_it_carries():
    out = turn.sanitize_envelope({**env(BAD["id used twice"], disp="answer"), "reply": "Weekly shows the bigger trend."},
                                 REFS, CAP_NAMES)
    assert out["ops"] == []
