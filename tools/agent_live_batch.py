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
    return narrative_cost_guard.estimate_cost(turn.model(), tokens_in, turn.MAX_TOKENS)


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
    print(f"typical total ~ ${typical:.2f}   worst case (every call at max_tokens) ~ ${worst:.2f}")
    if not a.run:
        print("DRY RUN — no model call was made.")
        return 0
    if a.max_usd is None or a.max_usd <= 0:
        print("refused: --run needs an explicit --max-usd ceiling")
        return 2
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("refused: ANTHROPIC_API_KEY is not set")
        return 2
    turn._research = lambda *_a, **_k: {"results": [], "citations": [], "note": "research disabled for this batch"}
    spent = 0.0
    out = []
    history: dict[str, list] = {}
    for b in items:
        need = worst_call_usd(sizes[b["id"]])
        if spent + need > a.max_usd:
            print(f"STOP before {b['id']}: ${spent:.4f} spent + worst ${need:.4f} would pass the ${a.max_usd:.2f} ceiling")
            break
        hist = history.get(b.get("history") or "", [])
        body = b["body"]
        t0 = time.monotonic()
        try:
            r = turn.run_turn(message=body["message"], context=body["context"], history=hist,
                              capabilities=body["capabilities"], routing=body.get("routing"),
                              manifest_version=body.get("manifestVersion"))
            env = r["envelope"]
            cost = float(r["usage"].get("cost_usd") or 0.0)
            err = None
        except turn.TurnError as e:
            env, cost, err = {}, 0.0, str(e)
        ms = int((time.monotonic() - t0) * 1000)
        spent += cost
        s = score(b, env) if not err else {"ok": False, "notes": [err]}
        print(f"{'PASS' if s['ok'] else 'FAIL'} {b['id']:22} {ms:>6} ms  ${cost:.4f}  {s.get('disposition')} {s.get('actions')} {'; '.join(s.get('notes') or [])}")
        out.append({"id": b["id"], "ms": ms, "cost_usd": cost, "envelope": env, "error": err, **s})
        history[b["id"]] = hist + [{"role": "member", "text": body["message"]},
                                   {"role": "agent", "text": env.get("reply") or ""}]
    print(f"spent ${spent:.4f} of ${a.max_usd:.2f}   passed {sum(1 for o in out if o['ok'])}/{len(out)}")
    if a.out:
        json.dump(out, open(a.out, "w", encoding="utf-8"), indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
