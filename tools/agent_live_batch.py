"""UCT Agent LIVE-MODEL batch (Phase 2, Milestone 1) — bounded, isolated, owner-approved only.

Sends the exact turn requests the panel builds (captured by app/src/agent/agentLiveCapture.test.jsx,
no model call there) to the REAL model through the server's own `turn.run_turn` — the same prompt,
schema, validation and research gate production uses — and scores each returned plan against what
the request asked for. Nothing is executed: no browser, no database, no workspace, no member data.

  python tools/agent_live_batch.py BODIES.json                       # DRY RUN (default): size + max cost
  python tools/agent_live_batch.py BODIES.json --run --max-usd 2.00  # real calls, hard dollar ceiling

⛔ --run needs ANTHROPIC_API_KEY in the environment and an explicit --max-usd. Before EVERY call the
worst case of that call (its prompt + max_tokens output) is added to the spend so far; if that could
pass the ceiling, the batch stops. Research (web search) is disabled for the batch.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.services import narrative_cost_guard  # noqa: E402
from api.services.uct_agent import turn  # noqa: E402

CHARS_PER_TOKEN = 3.0          # conservative (real ratio is higher → fewer tokens)


def prompt_tokens(body: dict) -> int:
    caps = turn.validate_manifest(body["capabilities"])
    route = turn.validate_routing(body.get("routing"))
    unselected = route["unselected"] if route else None
    compact = turn.compact_ops(caps)
    chars = (len(turn.system_prompt(caps, unselected, compact)) + len(json.dumps(turn.envelope_schema(caps, unselected, compact)))
             + len(turn._block("workspace_context", body["context"])) + len(body["message"]) + 400)
    return int(chars / CHARS_PER_TOKEN)


def worst_call_usd(tokens_in: int) -> float:
    # the whole prompt billed as a cache WRITE (1.25x input — the system prompt is cache_control'd)
    return narrative_cost_guard.estimate_cost(turn.model(), 0, turn.MAX_TOKENS, cache_creation_tokens=tokens_in)


#: run_turn's most calls for ONE request: the plan, a research round, a schema-refusal fallback.
MAX_CALLS_PER_REQUEST = 3


def score(item: dict, env: dict) -> dict:
    want = item["want"]
    actions = [o.get("action") for o in env.get("ops") or []]
    disp = env.get("disposition")
    ok = True
    notes = []
    if want.get("actions"):
        hit = any(a in actions for a in want["actions"])
        ok &= hit
        if not hit:
            notes.append(f"expected one of {want['actions']}")
    for k, v in (want.get("args") or {}).items():
        if not any((o.get("args") or {}).get(k) == v for o in env.get("ops") or []):
            ok = False
            notes.append(f"expected {k}={v}")
    if want.get("noClarify") and disp == "clarify":
        ok = False
        notes.append("asked instead of acting")
    if want.get("honest"):
        # a request a capability can't fully do: an honest partial / unsupported, never a faked default
        faked = any(a == "indicator.add" and (o.get("args") or {}).get("defId") == "movingAverage" and "20" not in json.dumps(o.get("args")) for a, o in zip(actions, env.get("ops") or []))
        ok &= not faked
        if faked:
            notes.append("added a default moving average as if it were a 20 EMA")
    return {"ok": bool(ok), "disposition": disp, "actions": actions, "notes": notes}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("bodies")
    ap.add_argument("--run", action="store_true")
    ap.add_argument("--max-usd", type=float, default=None)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    items = [b for b in json.load(open(a.bodies, encoding="utf-8")) if b.get("body")]
    sizes = {b["id"]: prompt_tokens(b["body"]) for b in items}
    worst = sum(worst_call_usd(t) for t in sizes.values())
    typical = sum(narrative_cost_guard.estimate_cost(turn.model(), t, 350) for t in sizes.values())
    print(f"model: {turn.model()}   requests: {len(items)}   one call each (research off; no reroute expected)")
    for b in items:
        print(f"  {b['id']:22} ~{sizes[b['id']]:>6} prompt tokens   worst ${worst_call_usd(sizes[b['id']]):.4f}")
    print(f"typical total ~ ${typical:.2f}   worst case, one call each at max_tokens ~ ${worst:.2f}   "
          f"absolute worst ({MAX_CALLS_PER_REQUEST} calls each) ~ ${worst * MAX_CALLS_PER_REQUEST:.2f}")
    print("the ceiling is enforced before EVERY API call (guarded caller), whatever the estimate says")
    if not a.run:
        print("DRY RUN — no model call was made.")
        return 0
    if a.max_usd is None or a.max_usd <= 0:
        print("refused: --run needs an explicit --max-usd ceiling")
        return 2
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("refused: ANTHROPIC_API_KEY is not set")
        return 2
    # ── isolation: no research (Perplexity is a second paid service), no cost-ledger writes ──
    turn._research = lambda *_a, **_k: {"results": [], "citations": [], "note": "research disabled for this batch"}
    turn._record_cost = lambda _resp: 0.0
    model = turn.model()
    budget = {"spent": 0.0, "calls": 0}

    class BudgetStop(Exception):
        pass

    def guarded(**kw):
        """⛔ THE CEILING, BEFORE EVERY API CALL. Worst case of THIS call: its whole prompt billed as
        a cache WRITE (1.25x input) + its full max_tokens output. run_turn may make up to three calls
        for one request (research round, schema fallback) — each one passes through here."""
        chars = len(json.dumps(kw.get("system"), default=str)) + len(json.dumps(kw.get("messages"), default=str)) \
            + len(json.dumps(kw.get("output_config"), default=str))
        worst = narrative_cost_guard.estimate_cost(model, 0, int(kw.get("max_tokens") or turn.MAX_TOKENS),
                                                   cache_creation_tokens=int(chars / CHARS_PER_TOKEN))
        if budget["spent"] + worst > a.max_usd:
            raise BudgetStop(f"${budget['spent']:.4f} spent + worst ${worst:.4f} for the next call would pass ${a.max_usd:.2f}")
        resp = turn._default_caller(**kw)
        u = getattr(resp, "usage", None)
        budget["spent"] += narrative_cost_guard.estimate_cost(
            model, int(getattr(u, "input_tokens", 0) or 0), int(getattr(u, "output_tokens", 0) or 0),
            cache_read_tokens=int(getattr(u, "cache_read_input_tokens", 0) or 0),
            cache_creation_tokens=int(getattr(u, "cache_creation_input_tokens", 0) or 0))
        budget["calls"] += 1
        return resp

    # the model must exist on this account (a free models lookup — not billed)
    try:
        from api.services.engine import _get_anthropic_client
        _get_anthropic_client().models.retrieve(model)
        print(f"model {model}: available on this account")
    except Exception as e:  # noqa: BLE001
        print(f"refused: model {model} is not available on this account ({type(e).__name__})")
        return 2

    def outcome_of(env: dict) -> str:
        """What UCT would have receipted for a planned turn (this batch never executes it)."""
        parts = []
        for o in env.get("ops") or []:
            args = o.get("args") or {}
            if o.get("action") == "watchlist.create":
                parts.append(f"Created the watchlist “{args.get('name')}”")
            elif o.get("action") == "screener.run":
                parts.append("Ran the screen")
            else:
                parts.append(str(o.get("action")))
        return " · ".join(parts)

    out = []
    history: dict[str, list] = {}
    for b in items:
        hist = history.get(b.get("history") or "", [])
        body = b["body"]
        calls0, spent0 = budget["calls"], budget["spent"]
        t0 = time.monotonic()
        try:
            r = turn.run_turn(message=body["message"], context=body["context"], history=hist,
                              capabilities=body["capabilities"], routing=body.get("routing"),
                              manifest_version=body.get("manifestVersion"), caller=guarded)
            env, err = r["envelope"], None
        except BudgetStop as e:
            print(f"STOP before the next call: {e}")
            break
        except turn.TurnError as e:
            env, err = {}, str(e)
        ms = int((time.monotonic() - t0) * 1000)
        cost = budget["spent"] - spent0
        s = score(b, env) if not err else {"ok": False, "notes": [err]}
        n = budget["calls"] - calls0
        print(f"{'PASS' if s['ok'] else 'FAIL'} {b['id']:22} {ms:>6} ms  {n} call(s)  ${cost:.4f}  {s.get('disposition')} {s.get('actions')} {'; '.join(s.get('notes') or [])}")
        out.append({"id": b["id"], "ms": ms, "calls": n, "cost_usd": cost, "envelope": env, "error": err, **s})
        done = outcome_of(env)
        history[b["id"]] = hist + [{"role": "member", "text": body["message"]},
                                   {"role": "agent", "text": env.get("reply") or ""}] \
            + ([{"role": "outcome", "text": done, "data": {"kind": "applied"}}] if done else [])
    spent = budget["spent"]
    print(f"spent ${spent:.4f} of ${a.max_usd:.2f}   passed {sum(1 for o in out if o['ok'])}/{len(out)}")
    if a.out:
        json.dump(out, open(a.out, "w", encoding="utf-8"), indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
