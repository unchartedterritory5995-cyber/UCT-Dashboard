"""UCT Agent — planner v2 COST MEASUREMENT over the scripted acceptance set (W2-A2 cost follow-up). NO key, NO call.

The owner kept the $0.25 per-turn cap (2026-11-03) and asked for a cheaper planner, measured BEFORE any paid run.
This drives the REAL server loop (turn_v2.run_turn_v2) once per acceptance case, per tool layout, per model, with a
SCRIPTED model (the case's own steps — app/src/agent/__fixtures__/program/v2-acceptance.json — plus the owner's
flagship sentence) and a scripted browser (the statuses the acceptance run pins), and prices every request the loop
builds with the eval ledger's worst-case math (tools/agent_eval_ledger.worst_case_usd: every request byte as a token
+ 4000 framing, all billed as a 5-minute cache write, + max_tokens of output). Nothing is sent anywhere; the cost
guard's recorder is stubbed out, no ledger is opened.

  python tools/agent_v2_cost_measure.py            # the markdown tables
  python tools/agent_v2_cost_measure.py --json     # the same as JSON

Per case it reports: rounds used, request bytes per round (= the ledger's worst-case prompt tokens, before framing)
and a chars/3 token estimate, worst-case $ per round (max) and per turn (sum of every round's reservation), whether
the runtime caps (rounds, $ per turn checked BEFORE each call) let the turn finish, tool-search / load calls and
misses, and whether every step's action was reachable (in the member's manifest → in the index / the search catalog).

How the scripted model behaves (stated, because it decides the round count):
  * "search" layout (Wave 1): a round listing every domain it has not listed yet (parallel domain calls), then a
    round with the tool search (a hit) + the step call(s).
  * "index" layout (W2-A2): round 1 loads every action the case needs (one load_actions call), then the steps.
  * Both: steps that do not depend on the previous one's result go in ONE response (parallel tool_use, run in
    order): a step starts a new response after a query (its result is needed), after a proposal (the loop pauses),
    or when it targets something an earlier step in the same response creates. Then one final reply round.
These are structural measurements of the loop and the request sizes; how well a real model picks actions is NOT
measured here (that is the separately gated paid evaluation).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

ACCEPTANCE = os.path.join(ROOT, "app", "src", "agent", "__fixtures__", "program", "v2-acceptance.json")
MODELS = ("claude-haiku-4-5", "claude-haiku-5-5")
LAYOUTS = ("search", "index")
CREATORS = {"widget.addCharts", "watchlist.create", "widget.add"}

# the owner's flagship sentence (agentFlagshipV2.test.jsx), as the steps a model would plan for it
OWNER_FLAGSHIP = {
    "id": "FLAGSHIP", "title": "the owner's flagship sentence (screen → list (card) → top five → top two charted with 9/20 EMAs → save (card))",
    "say": ("Find stocks above their 20 EMA with volume twice average, drop anything under $10, put the top five by three-month change on "
            "a new list, open the top two in the bottom row with my 9/20 EMAs, and save this as Momentum Review"),
    "script": [
        {"action": "screener.run", "target": {"section": "screener"}, "args": {"filters": [{"field": "above_sma50", "op": "eq", "value": 1, "max": None, "values": None}, {"field": "rvol", "op": "gte", "value": 2, "max": None, "values": None}, {"field": "price", "op": "gte", "value": 10, "max": None, "values": None}], "sort_field": "perf_3m", "sort_dir": "desc", "mode": "new", "show": 5, "as": None, "within": None}},
        {"action": "watchlist.create", "target": {"section": "watchlistLibrary"}, "args": {"name": "Momentum Leaders", "as": "list1"}, "mode": "propose"},
        {"action": "watchlist.add", "target": {"alias": "list1"}, "args": {"symbols": ["AAA", "BBB", "CCC", "DDD", "EEE"]}},
        {"action": "widget.addCharts", "target": {"section": "workspace"}, "args": {"symbols": ["AAA", "BBB"], "timeframe": None, "chart_type": None, "exact": None}},
        {"action": "indicator.add", "target": {"added": "indicatorEdits", "index": 0}, "args": {"defId": "movingAverage", "inputs": [{"key": "period", "value": 9}, {"key": "maType", "value": "ema"}]}},
        {"action": "indicator.add", "target": {"added": "indicatorEdits", "index": 0}, "args": {"defId": "movingAverage", "inputs": [{"key": "period", "value": 20}, {"key": "maType", "value": "ema"}]}},
        {"action": "indicator.add", "target": {"added": "indicatorEdits", "index": 1}, "args": {"defId": "movingAverage", "inputs": [{"key": "period", "value": 9}, {"key": "maType", "value": "ema"}]}},
        {"action": "indicator.add", "target": {"added": "indicatorEdits", "index": 1}, "args": {"defId": "movingAverage", "inputs": [{"key": "period", "value": 20}, {"key": "maType", "value": "ema"}]}},
        {"action": "layout.saveAs", "target": {"section": "layouts"}, "args": {"name": "Momentum Review"}, "mode": "propose"},
        {"reply": "Momentum Review is saved."},
    ],
    "expect": {"results": ["query", "proposed", "done", "done", "done", "done", "done", "done", "proposed"], "resumes": [["s2", "done"], ["s9", "done"]]},
}


def _cases() -> list[dict]:
    with open(ACCEPTANCE, encoding="utf-8") as f:
        cases = [c for c in json.load(f)["cases"] if c.get("planner", "v2") == "v2"]
    return [OWNER_FLAGSHIP] + cases


def _resp(blocks: list, chars: int, stop: str = "tool_use"):
    """A scripted model response; its usage is an ESTIMATE (uncached input ≈ chars/3, 150 output tokens) — it only
    feeds the runtime's spent-so-far, the caps are checked against the worst case before every call."""
    return types.SimpleNamespace(content=blocks, stop_reason=stop, usage=types.SimpleNamespace(
        input_tokens=chars // 3, output_tokens=150, cache_read_input_tokens=0, cache_creation_input_tokens=0))


def _use(name, inp, uid):
    return types.SimpleNamespace(type="tool_use", id=uid, name=name, input=inp)


def _groups(steps: list[dict]) -> list[list[int]]:
    """Indices of the steps, grouped into model responses (see the module doc)."""
    out: list[list[int]] = []
    for i, st in enumerate(steps):
        t = st.get("target") or {}
        if out:
            prev = steps[out[-1][-1]]
            dependent = ("added" in t or "alias" in t) and any(steps[j]["action"] in CREATORS for j in out[-1])
            breaks = prev.get("mode") == "propose" or prev["action"].startswith(("screener.", "stock.", "news.")) or dependent \
                or "from" in json.dumps(st.get("args") or {})
            if not breaks:
                out[-1].append(i)
                continue
        out.append([i])
    return out


def measure_case(case: dict, layout: str, model: str, *, led, v2, t1, ctx: dict, manifest: list[dict]) -> dict:
    steps = [s for s in case["script"] if s.get("reply") is None]
    reply = next((s["reply"] for s in case["script"] if s.get("reply") is not None), "Done.")
    results = list((case.get("expect") or {}).get("results") or [])
    resumes = {sid: st for sid, st in ((case.get("expect") or {}).get("resumes") or [])}
    groups = _groups(steps)
    cap_names = {c["name"] for c in manifest}
    reachable = sum(1 for s in steps if s["action"] in cap_names)

    added_by_step: dict[int, list[dict]] = {}
    aliases: set = set()

    def target_of(i: int) -> str:
        t = steps[i].get("target") or {}
        if "literal" in t:
            return t["literal"]
        if "alias" in t:
            return t["alias"]
        if "section" in t:
            sec = ctx.get(t["section"])
            e = sec[t.get("index", 0)] if isinstance(sec, list) and len(sec) > t.get("index", 0) else (sec[0] if isinstance(sec, list) and sec else None)
            return (e or {}).get("ref", "missing")
        if "added" in t:
            pool = [a["ref"] for j in sorted(added_by_step) for a in added_by_step[j] if a["kind"] == t["added"]]
            return pool[t.get("index", 0)] if len(pool) > t.get("index", 0) else "missing"
        return "missing"

    # the scripted model: one response per call, built from what the loop has seen so far
    plan: list = []
    listed: set = set()
    if layout == "index" and steps:
        plan.append(("load", sorted({v2.tool_name(s["action"]) for s in steps})))
    for g in groups:
        if layout == "search":
            new = sorted({v2.domain_for(steps[i]["action"]) for i in g} - listed)
            if new:
                plan.append(("domains", new))
                listed |= set(new)
        plan.append(("steps", g))
    plan.append(("reply", None))

    calls: list[dict] = []
    seen_step = {"n": 0}

    def caller(**kw):
        calls.append(kw)
        k = len(calls) - 1
        if k >= len(plan):
            return _resp([types.SimpleNamespace(type="text", text=reply)], led.request_bytes(kw), "end_turn")
        kind, what = plan[k]
        chars = led.request_bytes(kw)
        if kind == "load":
            return _resp([_use(v2.LOAD_TOOL, {"names": what}, f"tl{k}")], chars)
        if kind == "domains":
            return _resp([_use(d, {}, f"td{k}{d}") for d in what], chars)
        if kind == "reply":
            return _resp([types.SimpleNamespace(type="text", text=reply)], chars, "end_turn")
        blocks = []
        if layout == "search":
            for i in what:
                tn = v2.tool_name(steps[i]["action"])
                blocks.append({"type": "server_tool_use", "id": f"st{k}{i}", "name": "tool_search_tool_regex", "input": {"pattern": f"^{tn}$"}})
                blocks.append({"type": "tool_search_tool_result", "tool_use_id": f"st{k}{i}",
                               "content": {"type": "tool_search_tool_search_result", "tool_references": [{"type": "tool_reference", "tool_name": tn}]}})
        for i in what:
            blocks.append(_use(v2.tool_name(steps[i]["action"]), {"target": target_of(i), "args": steps[i].get("args") or {}}, f"tu{i}"))
        return _resp(blocks, chars)

    def wait_step(step_id):
        n = seen_step["n"]
        seen_step["n"] += 1
        status = results[n] if n < len(results) else "done"
        res = {"id": step_id, "status": status, "receipt": "done" if status == "done" else None,
               "refusal": "refused" if status in ("refused", "failed") else None, "result": "3 stocks match." if status == "query" else None}
        if status == "done":
            res["added"] = _added_for(n)
        return res

    def _added_for(n: int) -> list[dict]:
        st = steps[n] if n < len(steps) else {}
        a = st.get("action")
        out = []
        if a == "widget.addCharts":
            syms = (st.get("args") or {}).get("symbols")
            k = len(syms) if isinstance(syms, list) else int(((syms or {}).get("top") or 2))
            base = 10 + 2 * n
            out = [{"ref": f"c{base + j}", "kind": "chart", "label": "Chart"} for j in range(k)] + \
                  [{"ref": f"i{base + j}", "kind": "indicatorEdits", "label": "Chart"} for j in range(k)]
        elif a == "watchlist.create":
            out = [{"ref": f"w{20 + n}", "kind": "watchlist", "label": "list"}]
        elif a == "widget.add":
            out = [{"ref": f"b{20 + n}", "kind": "board", "label": "widget"}]
        added_by_step[n] = out
        return out

    old_model = os.environ.get("UCT_AGENT_MODEL")
    os.environ["UCT_AGENT_MODEL"] = model
    os.environ[v2.TOOLS_ENV] = layout
    try:
        out = v2.run_turn_v2(message=case["say"], context=ctx, history=[], capabilities=manifest, caller=caller, wait_step=wait_step)
        pauses = 0
        while out.get("paused"):
            pauses += 1
            st = out["state"]
            sid = st["awaiting"]["step"]["id"]
            status = resumes.get(sid, "done")
            n = int(sid[1:]) - 1
            rr = {"id": sid, "status": status, "receipt": "done" if status == "done" else None,
                  "refusal": None if status == "done" else "the member did not approve it"}
            if status == "done":
                rr["added"] = _added_for(n)
            if seen_step["n"] <= n:
                seen_step["n"] = n + 1
            out = v2.run_turn_v2(message="", context={}, history=[], caller=caller, wait_step=wait_step, resume=st, resume_result=rr)
    finally:
        if old_model is None:
            os.environ.pop("UCT_AGENT_MODEL", None)
        else:
            os.environ["UCT_AGENT_MODEL"] = old_model
        os.environ.pop(v2.TOOLS_ENV, None)

    sizes = [led.request_bytes(kw) for kw in calls]
    worst = [led.worst_case_usd(kw) for kw in calls]
    usage = out["usage"]
    rails = usage.get("rails") or {}
    return {
        "case": case["id"], "layout": layout, "model": model, "steps": len(steps), "rounds": len(calls),
        "pauses": pauses, "completed": usage.get("stopped") is None,       # the turn reached its reply (no round / $ / timeout stop)
        "steps_sent": len(out["envelope"]["steps"]),           # fewer than `steps` = the server refused one (args off schema, unknown target)
        "stopped": usage.get("stopped"),
        "bytes_per_round": sizes, "tokens_est_per_round": [s // 3 for s in sizes],
        "worst_round_usd": round(max(worst or [0.0]), 4), "worst_turn_usd": round(sum(worst), 4),
        "tool_search_calls": rails.get("tool_search_calls", 0), "tool_search_misses": rails.get("tool_search_misses", 0),
        "unknown_actions": rails.get("unknown_actions", 0), "reachable_steps": reachable,
    }


def measure() -> dict:
    from tools import agent_eval_ledger as led
    from tools.agent_v2_cost_dryrun import _manifest, real_context
    from api.services.uct_agent import turn as t1, turn_v2 as v2
    t1._record_cost = lambda r: 0.0                  # never record a scripted response as spend
    ctx = real_context()
    manifest = _manifest()
    rows = []
    for case in _cases():
        for layout in LAYOUTS:
            for m in MODELS:
                rows.append(measure_case(case, layout, m, led=led, v2=v2, t1=t1, ctx=ctx, manifest=manifest))
    summary = {}
    for layout in LAYOUTS:
        for m in MODELS:
            rs = [r for r in rows if r["layout"] == layout and r["model"] == m]
            key = f"{layout}/{m}"
            fl = next(r for r in rs if r["case"] == "FLAGSHIP")
            f1 = next(r for r in rs if r["case"] == "F01")
            summary[key] = {
                "cases": len(rs), "completed": sum(r["completed"] for r in rs),
                "stopped": {k: sum(1 for r in rs if r["stopped"] == k) for k in sorted({r["stopped"] for r in rs if r["stopped"]})},
                "round1_bytes_median": sorted(r["bytes_per_round"][0] for r in rs)[len(rs) // 2],
                "worst_turn_usd_max": max(r["worst_turn_usd"] for r in rs),
                "worst_turn_usd_mean": round(sum(r["worst_turn_usd"] for r in rs) / len(rs), 4),
                "set_worst_usd": round(sum(r["worst_turn_usd"] for r in rs), 2),
                "under_turn_cap_worst": sum(1 for r in rs if r["worst_turn_usd"] <= 0.25),
                "tool_search_calls": sum(r["tool_search_calls"] for r in rs), "tool_search_misses": sum(r["tool_search_misses"] for r in rs),
                "reachable_steps": f"{sum(r['reachable_steps'] for r in rs)}/{sum(r['steps'] for r in rs)}",
                "flagship": {k: fl[k] for k in ("rounds", "completed", "stopped", "worst_round_usd", "worst_turn_usd")},
                "F01": {k: f1[k] for k in ("rounds", "completed", "stopped", "worst_round_usd", "worst_turn_usd")},
            }
    return {"about": "planner v2 cost measurement — scripted model + browser, real loop, ledger worst-case math; NO call was made",
            "turn_cap_usd": v2.turn_usd(), "rounds_cap": v2.rounds(), "summary": summary, "cases": rows}


def markdown(d: dict) -> str:
    L = [f"## Summary (per-turn cap ${d['turn_cap_usd']:.2f}, rounds cap {d['rounds_cap']}; worst = the ledger's reservation summed over the turn's rounds)", "",
         "| layout / model | finished (reply reached) | stopped | round-1 bytes (median) | worst $/turn max | worst $/turn mean | turns ≤ $0.25 worst | set worst $ | search/load calls | misses | reachable steps |",
         "|---|---|---|---|---|---|---|---|---|---|---|"]
    for k, s in d["summary"].items():
        L.append(f"| {k} | {s['completed']}/{s['cases']} | {s['stopped'] or '—'} | {s['round1_bytes_median']:,} | ${s['worst_turn_usd_max']:.4f} | "
                 f"${s['worst_turn_usd_mean']:.4f} | {s['under_turn_cap_worst']}/{s['cases']} | ${s['set_worst_usd']:.2f} | {s['tool_search_calls']} | {s['tool_search_misses']} | {s['reachable_steps']} |")
    L += ["", "## Flagships", "", "| layout / model | case | rounds | completed | stopped | worst $/round max | worst $/turn |", "|---|---|---|---|---|---|---|"]
    for k, s in d["summary"].items():
        for c in ("flagship", "F01"):
            f = s[c]
            L.append(f"| {k} | {'owner flagship' if c == 'flagship' else 'F01'} | {f['rounds']} | {f['completed']} | {f['stopped'] or '—'} | ${f['worst_round_usd']:.4f} | ${f['worst_turn_usd']:.4f} |")
    L += ["", "## Per case (Haiku 4.5)", "", "| case | layout | steps | rounds | pauses | completed | KB per round | est. tokens/round (chars/3) | worst $/round max | worst $/turn |", "|---|---|---|---|---|---|---|---|---|---|"]
    for r in d["cases"]:
        if r["model"] != "claude-haiku-4-5":
            continue
        kb = " ".join(f"{b / 1000:.0f}" for b in r["bytes_per_round"])
        tk = " ".join(f"{t / 1000:.1f}k" for t in r["tokens_est_per_round"])
        L.append(f"| {r['case']} | {r['layout']} | {r['steps']} | {r['rounds']} | {r['pauses']} | {'yes' if r['completed'] else 'no (' + str(r['stopped']) + ')'} | {kb} | {tk} | ${r['worst_round_usd']:.4f} | ${r['worst_turn_usd']:.4f} |")
    return "\n".join(L)


def main(argv=None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")       # Windows consoles: the tables carry ≤ / → / …
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    d = measure()
    print(json.dumps(d, indent=1) if a.json else markdown(d))
    return 0


if __name__ == "__main__":
    sys.exit(main())
