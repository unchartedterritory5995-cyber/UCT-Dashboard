"""UCT Agent — v1 vs v2 TOKEN and COST estimate per capability-regression intent (Mission 3). NO key, NO call.

Deterministic: the requests are the ACTUAL prompts each planner builds, priced without sending anything.
  * The browser side comes from tests/fixtures/agent_v2_corpus_requests.json (regenerate with
    `V2_COST_EXPORT=<path> V2_COST_STARTERS=<json of saved_screens.starters()> npx vitest run
    src/agent/agentPlannerV2CostExport.test.jsx`; the boards carry the REAL Screener section, the full catalog a screening
    request sends, so a non-screening intent reads slightly high, never low):
      - the manifest the browser builds;
      - per phrasing, the v1 ROUTED action list and routing block;
      - each fixture board's workspace context.
  * v1: `turn.run_turn` with a scripted caller.
      - The REAL system prompt, catalog lines and blocks for the routed manifest are captured, the planner's one
        call per turn.
      - The scripted reply is the intent's canonical envelope.
  * v2: `turn_v2.run_turn_v2`, the REAL loop.
      - The current default "index" layout; `--layout search` gives the Wave 1 layout.
      - The scripted model loads the actions, then calls each canonical op as ONE step per round (sequential, the
        worst case for rounds), then replies.
      - Every round's request is captured.
      - The scripted browser answers query / done / proposed → resumed done.

Pricing (claude-haiku-4-5 unless --model; narrative_cost_guard rates):
  * tokens ≈ a BPE-like approximation of the request text (approx_tokens): word pieces of ≤ 4 letters, digit groups
    of ≤ 3, one per punctuation character. Bytes are reported too.
  * expected $: approx input tokens at the input rate (no cache credit) + approx output tokens. A cached variant
    (system + tools prefix written once, read after) is reported for v2.
  * RUNTIME GATE (what actually stops a turn): turn_v2 checks `spent so far + budget.worst_case_usd(next request) ≤
    UCT_AGENT_TURN_USD (0.25)` BEFORE every call, where worst_case_usd bills every request BYTE as a cache-write token
    + 4,000 framing + max_tokens of output. `gate_peak` = the largest (spent + worst) over the turn's rounds; margin
    = 0.25 − gate_peak. v1 is one call: its gate figure is that call's worst case.

  AUTH_DB_PATH=$TEMP/v2cost.db python tools/agent_v2_corpus_cost.py          # markdown tables
  AUTH_DB_PATH=$TEMP/v2cost.db python tools/agent_v2_corpus_cost.py --json   # JSON
(it refuses to run unless AUTH_DB_PATH is under the temp directory, and never records a cost row)
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import os
import re
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
import conftest  # noqa: E402,F401 -- the shared-data-root census + tripwire (tests/test_tools_pin_the_root.py); inert on a Railway service

EXPORT = os.path.join(ROOT, "tests", "fixtures", "agent_v2_corpus_requests.json")
_TOK = re.compile(r"[A-Za-z]+|\d+|[^\sA-Za-z\d]")


def approx_tokens(text: str) -> int:
    """A BPE-like count with no tokenizer download: letters in pieces of ≤ 4, digits in groups of ≤ 3, one token per
    other non-space character (JSON punctuation, symbols)."""
    n = 0
    for m in _TOK.finditer(text):
        t = m.group(0)
        if t[0].isalpha():
            n += math.ceil(len(t) / 4)
        elif t[0].isdigit():
            n += math.ceil(len(t) / 3)
        else:
            n += 1
    return n


def _request_text(kw: dict) -> str:
    return json.dumps({k: kw.get(k) for k in ("system", "messages", "tools", "output_config")}, ensure_ascii=False, default=str)


def _prefix_text(kw: dict) -> str:
    return json.dumps({k: kw.get(k) for k in ("system", "tools")}, ensure_ascii=False, default=str)


def _resolve(target: str, ctx: dict) -> str | None:
    m = re.match(r"^\$([A-Za-z]+)(?:\[(\d+)\])?(?:\{\w+\})?$", str(target or ""))
    if not m:
        return target
    sec = ctx.get(m.group(1))
    i = int(m.group(2) or 0)
    if isinstance(sec, list) and len(sec) > i and isinstance(sec[i], dict):
        return sec[i].get("ref")
    if isinstance(sec, dict):
        return sec.get("ref")
    return None


def _fallback_ref(ctx: dict) -> str:
    for v in ctx.values():
        if isinstance(v, list) and v and isinstance(v[0], dict) and v[0].get("ref"):
            return v[0]["ref"]
        if isinstance(v, dict) and v.get("ref"):
            return v["ref"]
    return "c1"


def _resp(blocks: list, out_text: str, stop: str, in_tokens: int):
    return types.SimpleNamespace(content=blocks, stop_reason=stop, usage=types.SimpleNamespace(
        input_tokens=in_tokens, output_tokens=approx_tokens(out_text), cache_read_input_tokens=0, cache_creation_input_tokens=0))


def price(model: str, inp: int = 0, out: int = 0, cache_read: int = 0, cache_write: int = 0) -> float:
    from api.services import narrative_cost_guard
    return float(narrative_cost_guard.estimate_cost(model, inp, out, cache_read_tokens=cache_read, cache_creation_tokens=cache_write))


# ── v1 ──────────────────────────────────────────────────────────────────────────────────────────
def measure_v1(intent: dict, ph: dict, ctx: dict, manifest: list[dict], groups, model: str) -> dict:
    from api.services.uct_agent import budget, turn as t1
    routed = [c for c in manifest if c["name"] in set(ph["routed"])]
    routing = dict(ph["routing"], groups=groups) if ph.get("routing") else None
    ops = [{"action": o["action"], "target": _resolve(o["target"], ctx) or _fallback_ref(ctx), "args": o.get("args") or {}} for o in intent["ops"]]
    env = {"disposition": "apply", "reply": "", "question": None, "ops": ops, "unsupported_category": None, "research": None,
           "title": None, "correction": None, "wants_explanation": False}
    calls = []

    def caller(**kw):
        calls.append(kw)
        text = json.dumps(env)
        return _resp([types.SimpleNamespace(type="text", text=text)], text, "end_turn", approx_tokens(_request_text(kw)))
    try:
        t1.run_turn(message=ph["text"], context=ctx, history=[], capabilities=routed, routing=routing, caller=caller)
    except t1.TurnError:
        pass                                      # a refused plan still made (and priced) its one call
    kw = calls[0]
    tin, tout = approx_tokens(_request_text(kw)), approx_tokens(json.dumps(env))
    worst = budget.worst_case_usd(kw)
    return {"calls": len(calls), "routed": len(routed), "bytes": budget.request_bytes(kw), "tokens_in": tin, "tokens_out": tout,
            "expected_usd": round(price(model, tin, tout), 5), "worst_call_usd": round(worst, 5), "gate_peak_usd": round(worst, 5)}


# ── v2 ──────────────────────────────────────────────────────────────────────────────────────────
def measure_v2(intent: dict, ph: dict, ctx: dict, manifest: list[dict], model: str, layout: str) -> dict:
    from api.services.uct_agent import budget, turn as t1, turn_v2 as v2
    caps = {c["name"]: c for c in manifest}
    steps = [{"action": o["action"], "target": _resolve(o["target"], ctx) or _fallback_ref(ctx), "args": o.get("args") or {}} for o in intent["ops"]]
    plan: list = []
    if layout == "index":
        plan.append(("load", sorted({v2.tool_name(s["action"]) for s in steps})))
    else:
        plan.append(("domains", sorted({v2.domain_for(s["action"]) for s in steps})))
    plan += [("step", i) for i in range(len(steps))] + [("reply", None)]
    calls, rounds = [], []
    spent = {"usd": 0.0}

    def caller(**kw):
        calls.append(kw)
        k = len(calls) - 1
        kind, what = plan[k] if k < len(plan) else ("reply", None)
        tin = approx_tokens(_request_text(kw))
        if kind == "load":
            blocks = [types.SimpleNamespace(type="tool_use", id=f"tl{k}", name=v2.LOAD_TOOL, input={"names": what})]
        elif kind == "domains":
            blocks = [types.SimpleNamespace(type="tool_use", id=f"td{k}{d}", name=d, input={}) for d in what]
        elif kind == "step":
            s = steps[what]
            blocks = [types.SimpleNamespace(type="tool_use", id=f"tu{what}", name=v2.tool_name(s["action"]), input={"target": s["target"], "args": s["args"]})]
        else:
            blocks = [types.SimpleNamespace(type="text", text="Done — see the receipt above.")]
        out_text = json.dumps([vars(b) for b in blocks], default=str)
        r = _resp(blocks, out_text, "end_turn" if kind == "reply" else "tool_use", tin)
        worst = budget.worst_case_usd(kw)
        rounds.append({"bytes": budget.request_bytes(kw), "tokens_in": tin, "tokens_prefix": approx_tokens(_prefix_text(kw)),
                       "tokens_out": approx_tokens(out_text), "worst_usd": worst, "gate": spent["usd"] + worst})
        return r

    def wait_step(step_id):
        n = int(step_id[1:]) - 1
        cap = caps.get(steps[n]["action"]) if n < len(steps) else None
        if cap and cap.get("query") and cap["name"] != "agent.undo":
            return {"id": step_id, "status": "query", "result": "UCT showed the member the result (" + "x" * 160 + ")"}
        return {"id": step_id, "status": "done", "receipt": f"Done: {steps[n]['action']} (as the receipt words it)"}

    real_cost = v2._call_cost

    def tracked(model_id, resp):                  # the loop's own `spent` is what the gate adds the next worst case to
        c = real_cost(model_id, resp)
        spent["usd"] += c
        return c
    v2._call_cost = tracked
    old = {k: os.environ.get(k) for k in ("UCT_AGENT_MODEL", v2.TOOLS_ENV, v2.PLANNER_ENV)}
    os.environ.update({"UCT_AGENT_MODEL": model, v2.TOOLS_ENV: layout, v2.PLANNER_ENV: "v2"})
    try:
        out = v2.run_turn_v2(message=ph["text"], context=ctx, history=[], capabilities=manifest, caller=caller, wait_step=wait_step)
        while out.get("paused"):
            st = out["state"]
            sid = st["awaiting"]["step"]["id"]
            out = v2.run_turn_v2(message="", context={}, history=[], caller=caller, wait_step=wait_step, resume=st,
                                 resume_result={"id": sid, "status": "done", "receipt": "Done (approved)"})
    finally:
        v2._call_cost = real_cost
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
    tin = sum(r["tokens_in"] for r in rounds)
    tout = sum(r["tokens_out"] for r in rounds)
    first_prefix = rounds[0]["tokens_prefix"] if rounds else 0
    cached = sum(price(model, r["tokens_in"] - first_prefix, r["tokens_out"], cache_write=first_prefix) if i == 0
                 else price(model, max(r["tokens_in"] - first_prefix, 0), r["tokens_out"], cache_read=first_prefix)
                 for i, r in enumerate(rounds))
    return {"rounds": len(rounds), "steps": len(steps), "stopped": out["usage"].get("stopped"),
            "steps_done": sum(1 for s in out["envelope"]["steps"] if s["status"] in ("done", "query")),
            "bytes_round1": rounds[0]["bytes"] if rounds else 0, "tokens_in": tin, "tokens_out": tout,
            "tokens_round_max": max((r["tokens_in"] for r in rounds), default=0),
            "expected_usd": round(price(model, tin, tout), 5), "expected_cached_usd": round(cached, 5),
            "worst_round_usd": round(max((r["worst_usd"] for r in rounds), default=0.0), 5),
            "worst_sum_usd": round(sum(r["worst_usd"] for r in rounds), 5),
            "gate_peak_usd": round(max((r["gate"] for r in rounds), default=0.0), 5)}


def require_temp_db() -> None:
    """Refuse to run unless AUTH_DB_PATH points into the temp directory: nothing here may ever reach the real cost
    ledger (review #775: a scripted response recorded by the real cost guard would be a FAKE spend row)."""
    import tempfile
    db = os.environ.get("AUTH_DB_PATH") or ""
    tmp = os.path.normcase(os.path.realpath(tempfile.gettempdir()))
    if not db or not os.path.normcase(os.path.realpath(db)).startswith(tmp + os.sep):
        raise SystemExit("agent_v2_corpus_cost: refusing to run — set AUTH_DB_PATH to a throwaway DB under "
                         f"{tempfile.gettempdir()} (e.g. AUTH_DB_PATH=$TEMP/v2cost.db); the real ledger is never touched")


def measure(model: str = "claude-haiku-4-5", layout: str = "index", export: str = EXPORT) -> dict:
    require_temp_db()
    from api.services.uct_agent import turn as t1
    real_record = t1._record_cost
    t1._record_cost = lambda r: 0.0               # BEFORE any call (v1 first): a scripted response is never recorded
    real_disable = logging.root.manager.disable
    logging.disable(logging.WARNING)              # the scripted v1 reply is priced, not judged: its parse notes are noise here
    try:
        return _measure(model, layout, export)
    finally:                                      # both are process-wide: a caller's logging and recorder come back as they were
        logging.disable(real_disable)
        t1._record_cost = real_record


def _measure(model: str, layout: str, export: str) -> dict:
    from api.services.uct_agent import turn_v2 as v2
    with open(export, encoding="utf-8") as f:
        d = json.load(f)
    manifest, groups = d["manifest"], d.get("routing_groups")
    rows = []
    for intent in d["intents"]:
        ctx = d["boards"][intent["board"]]
        # v1's dearest phrasing = the one whose routed manifest is largest; v2's = the longest message (its manifest is whole)
        p1 = max(intent["phrasings"], key=lambda p: (len(p["routed"]), len(p["text"])))
        p2 = max(intent["phrasings"], key=lambda p: len(p["text"]))
        rows.append({"intent": intent["id"], "ops": [o["action"] for o in intent["ops"]],
                     "v1": measure_v1(intent, p1, ctx, manifest, groups, model), "v2": measure_v2(intent, p2, ctx, manifest, model, layout)})
    cap = v2.turn_usd()
    worst = max(rows, key=lambda r: r["v2"]["gate_peak_usd"])
    return {"about": "v1 vs v2 per corpus intent — actual prompts, approximate tokens, NO call made", "model": model, "layout": layout,
            "turn_cap_usd": cap, "rounds_cap": v2.rounds(), "manifest_actions": len(manifest), "rows": rows,
            "summary": {
                "v1_expected_usd_mean": round(sum(r["v1"]["expected_usd"] for r in rows) / len(rows), 5),
                "v2_expected_usd_mean": round(sum(r["v2"]["expected_usd"] for r in rows) / len(rows), 5),
                "v2_expected_cached_usd_mean": round(sum(r["v2"]["expected_cached_usd"] for r in rows) / len(rows), 5),
                "v1_tokens_in_mean": round(sum(r["v1"]["tokens_in"] for r in rows) / len(rows)),
                "v2_tokens_in_mean": round(sum(r["v2"]["tokens_in"] for r in rows) / len(rows)),
                "v1_worst_call_usd_max": max(r["v1"]["worst_call_usd"] for r in rows),
                "v2_gate_peak_usd_max": worst["v2"]["gate_peak_usd"], "v2_gate_peak_intent": worst["intent"],
                "v2_margin_usd": round(cap - worst["v2"]["gate_peak_usd"], 5),
                "v2_worst_sum_usd_max": max(r["v2"]["worst_sum_usd"] for r in rows),
                "v2_finished": sum(1 for r in rows if not r["v2"]["stopped"]), "intents": len(rows),
                "v2_stopped": sorted({r["v2"]["stopped"] for r in rows if r["v2"]["stopped"]}),
            }}


def markdown(d: dict) -> str:
    s = d["summary"]
    L = [f"Model {d['model']}, v2 layout `{d['layout']}`, per-turn cap ${d['turn_cap_usd']:.2f}, rounds cap {d['rounds_cap']}, "
         f"{d['manifest_actions']} actions in the v2 manifest. NO model call was made.", "",
         "| | v1 | v2 |", "|---|---|---|",
         f"| mean input tokens / turn (approx.) | {s['v1_tokens_in_mean']:,} | {s['v2_tokens_in_mean']:,} |",
         f"| mean expected $ / turn (no cache) | ${s['v1_expected_usd_mean']:.4f} | ${s['v2_expected_usd_mean']:.4f} (cached prefix: ${s['v2_expected_cached_usd_mean']:.4f}) |",
         f"| runtime gate peak (worst intent) | ${s['v1_worst_call_usd_max']:.4f} (one call) | ${s['v2_gate_peak_usd_max']:.4f} ({s['v2_gate_peak_intent']}) |",
         f"| margin under ${d['turn_cap_usd']:.2f} | ${d['turn_cap_usd'] - s['v1_worst_call_usd_max']:.4f} | ${s['v2_margin_usd']:.4f} |",
         f"| turns that finish (no cap stop) | {s['intents']}/{s['intents']} | {s['v2_finished']}/{s['intents']} {s['v2_stopped'] or ''} |", "",
         "| intent | ops | v1 routed | v1 tok in | v1 exp $ | v1 worst $ | v2 rounds | v2 tok in (sum) | v2 exp $ | v2 exp $ cached | v2 worst/round | v2 gate peak | v2 stop |",
         "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in d["rows"]:
        a, b = r["v1"], r["v2"]
        L.append(f"| {r['intent']} | {len(r['ops'])} | {a['routed']} | {a['tokens_in']:,} | ${a['expected_usd']:.4f} | ${a['worst_call_usd']:.4f} | "
                 f"{b['rounds']} | {b['tokens_in']:,} | ${b['expected_usd']:.4f} | ${b['expected_cached_usd']:.4f} | ${b['worst_round_usd']:.4f} | "
                 f"${b['gate_peak_usd']:.4f} | {b['stopped'] or '—'} |")
    return "\n".join(L)


def main(argv=None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--model", default="claude-haiku-4-5")
    ap.add_argument("--layout", default="index", choices=("index", "search"))
    a = ap.parse_args(argv)
    d = measure(a.model, a.layout)
    print(json.dumps(d, indent=1) if a.json else markdown(d))
    return 0


if __name__ == "__main__":
    sys.exit(main())
