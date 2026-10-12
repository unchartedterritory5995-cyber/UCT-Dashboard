"""UCT Agent — REAL-MODEL SMOKE TEST for the Context + Breadth release (owner-approved: haiku-4-5, ≤ $0.25).

Sends the exact /api/agent/turn bodies the panel builds for six ordinary member questions (captured
with NO model call by app/src/agent/agentSmokeCapture.test.jsx) to the model through the server's own
`turn.run_turn` — the same prompt, schema, routing, validation, boundary and sanitizer production uses.
Nothing is executed: no browser, no backend, no database, no workspace, no market data. Breadth figures
exist only as a SYNTHETIC planted value (73.4567 / "73.5%") in question 2's stored history, so the
local-result boundary is proved on the real payload.

  python tools/agent_smoke_context_breadth.py BODIES.json                    # DRY RUN: sizes + worst cost
  python tools/agent_smoke_context_breadth.py BODIES.json --scripted         # free: canned plans, full checks
  python tools/agent_smoke_context_breadth.py BODIES.json --run --max-usd 0.25

⛔ --run needs ANTHROPIC_API_KEY ALREADY in this process's environment (never fetched from any store,
never printed) and --max-usd ≤ 0.25. Before EVERY call: (1) the request is searched for the planted
value — found → STOP, nothing is sent; (2) at most ONE model call per question — a second (research,
reroute, schema retry) → STOP; (3) spend so far + this call's worst case must stay under the ceiling.
Research (web) is disabled; the cost ledger is not written.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import conftest  # noqa: E402,F401 -- the census and the tripwire, before any api.* import (every *_DB_PATH → a sandbox)
from api.services import narrative_cost_guard  # noqa: E402
from api.services.uct_agent import turn  # noqa: E402

HARD_CEILING_USD = 0.25
CHARS_PER_TOKEN = 3.0
SENTINELS = ("73.4567", "73.457", "73.46", "73.5")
SYNTHETIC_ANSWER = ("US · % Above 50-Day: 73.5% on 2026-10-09. Prior session 2026-10-08: 61.0%.\n"
                    "Source: UCT Breadth — US. Finalized end-of-day data. (SYNTHETIC — planted value 73.4567)")
Q1_ARGS = {"mode": "value", "universe": "us", "metrics": ["pct_above_50sma"], "date": None,
           "compare_date": None, "start": None, "end": None}


class Stop(Exception):
    pass


def _ops(env):
    return [o for o in (env.get("ops") or []) if isinstance(o, dict)]


def _ref(body, key):
    sec = (body.get("context") or {}).get(key) or [{}]
    return sec[0].get("ref")


def score(qid: str, body: dict, env: dict, usage: dict) -> tuple[bool, list[str]]:
    """Routing accuracy for one question: the action UCT should plan, with the right arguments."""
    ops, notes = _ops(env), []
    acts = [o.get("action") for o in ops]
    one = lambda a: next((o for o in ops if o.get("action") == a), None)  # noqa: E731
    if qid in ("q1-breadth-value", "q2-breadth-compare", "q4-breadth-news"):
        b = one("breadth.show")
        if not b:
            return False, [f"expected breadth.show, got {acts or env.get('disposition')}"]
        a = b.get("args") or {}
        if "pct_above_50sma" not in (a.get("metrics") or []) and qid != "q4-breadth-news":
            notes.append(f"metrics {a.get('metrics')}")
        if a.get("universe") != "us":
            notes.append(f"universe {a.get('universe')}")
        if env.get("reply") and env.get("reply") not in turn.LOCAL_NOTICES:
            notes.append("a model reply was shown on a breadth plan")
        if qid == "q2-breadth-compare":
            other = a.get("compare_date") or a.get("start") or ""
            if a.get("mode") not in ("compare", "series") or not ("2026-09-01" <= str(other) <= "2026-09-16"):
                notes.append(f"expected a comparison with ~2026-09-09, got mode={a.get('mode')} {other!r}")
        if qid == "q4-breadth-news":
            if env.get("reply") not in (turn.LOCAL_NEWS_NOT_DONE, turn.LOCAL_NEWS_AND_EXPLAIN_NOT_DONE):
                notes.append("the not-searched notice is missing")
            if usage.get("research_calls"):
                notes.append("research ran")
    elif qid == "q3-breadth-page":
        o = one("app.open")
        if not o or (o.get("args") or {}).get("page") != "breadth":
            notes.append(f"expected app.open page=breadth, got {acts}")
        if "breadth.show" in acts:
            notes.append("navigation also planned a breadth lookup")
    elif qid == "q5-previous-layout":
        o = one("layout.open")
        lay = str((o or {}).get("args", {}).get("layout") or "")
        if not o or not (lay == "11" or re.search(r"\b(previous|last|other|prior|back)\b", lay, re.I)):
            notes.append(f"expected layout.open → previous (Main Trading, id 11), got {acts} {lay!r}")
    elif qid == "q6-this-chart-rsi":
        sel = next((c.get("ref") for c in (body.get("context") or {}).get("charts", []) if c.get("selected")), None)
        o = one("indicator.add")
        if not o:
            notes.append(f"expected indicator.add, got {acts or env.get('disposition')}")
        elif o.get("target") != sel:
            notes.append(f"RSI aimed at {o.get('target')!r}, the selected chart is {sel!r}")
    return not notes, notes


def scripted_plan(qid: str, body: dict) -> dict:
    """--scripted: the plan a correct model returns (no call) — proves the tool's checks end to end."""
    e = lambda ops, reply="": {"disposition": "apply", "reply": reply, "question": None, "ops": ops,  # noqa: E731
                               "unsupported_category": None, "research": None}
    b = _ref(body, "breadth")
    if qid == "q1-breadth-value":
        return e([{"action": "breadth.show", "target": b, "args": Q1_ARGS}], "Looking that up.")
    if qid == "q2-breadth-compare":
        return e([{"action": "breadth.show", "target": b, "args": {**Q1_ARGS, "mode": "compare", "compare_date": "2026-09-09"}}])
    if qid == "q3-breadth-page":
        cap = next(c for c in body["capabilities"] if c["name"] == "app.open")
        return e([{"action": "app.open", "target": _ref(body, "app"),
                   "args": {k: ("breadth" if k == "page" else None) for k in cap["args"]["properties"]}}])
    if qid == "q4-breadth-news":
        return {**e([{"action": "breadth.show", "target": b, "args": Q1_ARGS}]), "research": {"query": "NVDA news", "recency": "day"}}
    if qid == "q5-previous-layout":
        return e([{"action": "layout.open", "target": _ref(body, "layouts"), "args": {"layout": "previous"}}])
    sel = next(c["ref"] for c in body["context"]["charts"] if c.get("selected"))
    cap = next(c for c in body["capabilities"] if c["name"] == "indicator.add")
    args = {k: None for k in cap["args"]["properties"]}
    args.update({k: v for k, v in {"defId": "rsi", "indicator": "rsi"}.items() if k in args})
    return e([{"action": "indicator.add", "target": sel, "args": args}])


def history_for(qid: str, q1_env: dict | None) -> list[dict]:
    """Question 2's stored conversation: question 1, its plan, and the LOCAL answer the member saw —
    holding the planted value. The boundary must replay it as a note; the value must never be sent."""
    if qid != "q2-breadth-compare":
        return []
    plan = q1_env or {"disposition": "apply", "reply": "", "ops": [{"action": "breadth.show", "target": "breadth", "args": Q1_ARGS}]}
    return [{"role": "member", "text": "What % of US stocks are above their 50-day?"},
            {"role": "agent", "text": plan.get("reply") or "", "data": {"envelope": plan}},
            {"role": "outcome", "text": SYNTHETIC_ANSWER,
             "data": {"kind": "answered", "actions": ["breadth.show"], "local": True, "requests": [Q1_ARGS]}}]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("bodies")
    ap.add_argument("--run", action="store_true")
    ap.add_argument("--scripted", action="store_true")
    ap.add_argument("--max-usd", type=float, default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--leak-control", action="store_true",
                    help="scripted only: a deliberately LEAKY history door — the run must STOP at q2, nothing sent")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    items = json.load(open(a.bodies, encoding="utf-8"))
    model = turn.model()
    print(f"model: {model}   questions: {len(items)}   one call each; research off; ledger off")
    if a.run:
        if a.max_usd is None or a.max_usd <= 0 or a.max_usd > HARD_CEILING_USD:
            print(f"refused: --run needs --max-usd in (0, {HARD_CEILING_USD}]")
            return 2
        if not os.environ.get("ANTHROPIC_API_KEY"):
            print("refused: ANTHROPIC_API_KEY is not in this process's environment (never fetched from a store)")
            return 2
    elif not a.scripted:
        worst_total = 0.0
        for it in items:
            b = it["body"]
            caps = turn.validate_manifest(b["capabilities"])
            route = turn.validate_routing(b.get("routing"))
            uns = route["unselected"] if route else None
            comp = turn.compact_ops(caps)
            chars = (len(turn.system_prompt(caps, uns, comp)) + len(json.dumps(turn.envelope_schema(caps, uns, comp)))
                     + len(turn._block("workspace_context", b["context"])) + len(b["message"]) + 1200)
            w = narrative_cost_guard.estimate_cost(model, 0, turn.MAX_TOKENS, cache_creation_tokens=int(chars / CHARS_PER_TOKEN))
            worst_total += w
            print(f"  {it['id']:22} ~{int(chars / CHARS_PER_TOKEN):>6} prompt tokens   worst ${w:.4f}")
        print(f"worst case, one call each at max_tokens: ${worst_total:.4f} (ceiling ${HARD_CEILING_USD:.2f}; enforced per call)")
        print("DRY RUN — no model call was made. Use --scripted (free) or --run --max-usd 0.25 (paid).")
        return 0
    if a.leak_control and not a.scripted:
        print("refused: --leak-control is for --scripted only")
        return 2
    if a.leak_control:
        turn.outcome_for_model = lambda t: f"[UCT] {t['text']}"          # the boundary, deliberately broken

    def _research(*_a, **_k):
        raise Stop("research was attempted (it is disabled for this smoke test)")
    turn._research = _research
    turn._record_cost = lambda _resp: 0.0
    budget = {"spent": 0.0, "calls": 0, "q_calls": 0}
    current = {"qid": None, "body": None}
    ceiling = a.max_usd if a.run else HARD_CEILING_USD

    def guarded(**kw):
        blob = json.dumps(kw, default=str, ensure_ascii=False)
        member = (current["body"] or {}).get("message") or ""
        leaks = [s for s in SENTINELS if s in blob.replace(member, "")]
        if leaks:
            raise Stop(f"{current['qid']}: the planted value {leaks} is in the model request — NOT sent")
        if budget["q_calls"] >= 1:
            raise Stop(f"{current['qid']}: an unexpected second model call — NOT sent")
        chars = len(json.dumps(kw.get("system"), default=str)) + len(json.dumps(kw.get("messages"), default=str)) \
            + len(json.dumps(kw.get("output_config"), default=str))
        worst = narrative_cost_guard.estimate_cost(model, 0, int(kw.get("max_tokens") or turn.MAX_TOKENS),
                                                   cache_creation_tokens=int(chars / CHARS_PER_TOKEN))
        if budget["spent"] + worst > ceiling:
            raise Stop(f"${budget['spent']:.4f} spent + worst ${worst:.4f} would pass ${ceiling:.2f} — NOT sent")
        budget["q_calls"] += 1
        budget["calls"] += 1
        if a.scripted:
            import types
            env = scripted_plan(current["qid"], current["body"])
            if "args_json" in json.dumps(kw.get("output_config"), default=str):     # the COMPACT op schema
                env = {**env, "ops": [{"action": o["action"], "target": o["target"], "args_json": json.dumps(o["args"])}
                                      for o in env["ops"]]}
            return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=json.dumps(env))],
                                         stop_reason="end_turn", usage=types.SimpleNamespace(input_tokens=0, output_tokens=0))
        resp = turn._default_caller(**kw)
        u = getattr(resp, "usage", None)
        budget["spent"] += narrative_cost_guard.estimate_cost(
            model, int(getattr(u, "input_tokens", 0) or 0), int(getattr(u, "output_tokens", 0) or 0),
            cache_read_tokens=int(getattr(u, "cache_read_input_tokens", 0) or 0),
            cache_creation_tokens=int(getattr(u, "cache_creation_input_tokens", 0) or 0))
        return resp

    if a.run:
        try:
            from api.services.engine import _get_anthropic_client
            _get_anthropic_client().models.retrieve(model)          # a free lookup, not billed
        except Exception as e:  # noqa: BLE001
            print(f"refused: model {model} is not available on this account ({type(e).__name__})")
            return 2

    out, q1_env, stopped = [], None, None
    for it in items:
        qid, body = it["id"], it["body"]
        current.update(qid=qid, body=body)
        budget["q_calls"] = 0
        spent0, t0 = budget["spent"], time.monotonic()
        try:
            r = turn.run_turn(message=body["message"], context=body["context"], history=history_for(qid, q1_env),
                              capabilities=body["capabilities"], routing=body.get("routing"),
                              manifest_version=body.get("manifestVersion"), caller=guarded)
            env, usage, err = r["envelope"], r["usage"], None
        except Stop as e:
            stopped = str(e)
            print(f"STOP: {stopped}")
            break
        except turn.TurnError as e:
            env, usage, err = {}, {}, str(e)
        if qid == "q1-breadth-value":
            q1_env = env
        ok, notes = score(qid, body, env, usage) if not err else (False, [err])
        cost = budget["spent"] - spent0
        instant = (it.get("instantInProduct") or {}).get("kind")
        print(f"{'PASS' if ok else 'FAIL'} {qid:22} {int((time.monotonic() - t0) * 1000):>6} ms  ${cost:.4f}  "
              f"{env.get('disposition')} {[o.get('action') for o in _ops(env)]}  instant-in-product={instant or '-'}  "
              f"{'; '.join(notes)}")
        out.append({"id": qid, "ok": ok, "notes": notes, "cost_usd": cost, "instant_in_product": instant,
                    "envelope": env, "research_calls": usage.get("research_calls", 0)})
    print(f"calls {budget['calls']}   spent ${budget['spent']:.4f} of ${ceiling:.2f}   "
          f"passed {sum(1 for o in out if o['ok'])}/{len(items)}   leaks 0{'' if not stopped else '   STOPPED: ' + stopped}")
    if a.out:
        json.dump({"results": out, "stopped": stopped, "spent_usd": budget["spent"], "calls": budget["calls"]},
                  open(a.out, "w", encoding="utf-8"), indent=2)
    return 1 if stopped else 0


if __name__ == "__main__":
    sys.exit(main())
