"""UCT Agent — REAL-MODEL LATENCY PROBE (paid; run only with the owner's authorization).

Sends the /api/agent/turn bodies the latency benchmark captured (synthetic board, synthetic data — made
with NO model call by app/src/agent/agentLatency.test.jsx, AGENT_LATENCY_BODIES=<file>) through the
server's own `turn.run_turn`, once PLAIN and once STREAMED, and reports per request: time to the first
streamed reply text, total model time, model calls, input/output/cached tokens and cost. Nothing is
executed: no browser, no backend, no database, no workspace, no market data, no web search.

  python tools/agent_latency_probe.py BODIES.json                        # DRY RUN: sizes + worst cost
  python tools/agent_latency_probe.py BODIES.json --run --max-usd 0.50   # paid

⛔ --run needs ANTHROPIC_API_KEY ALREADY in this process's environment (never fetched, never printed) and
--max-usd ≤ 1.00. Before EVERY call, spend so far + that call's worst case must stay under the ceiling,
or the probe STOPS. Research is disabled (a request that asks for it gets "research unavailable" — the
second call still runs and is counted). Replies are never printed — only timings, counts and costs.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import conftest  # noqa: E402,F401 -- every *_DB_PATH → a sandbox, before any api.* import
from api.services.uct_agent import turn  # noqa: E402

HARD_CEILING_USD = 1.00
CHARS_PER_TOKEN = 3.0
IN_USD, OUT_USD = 1.00 / 1e6, 5.00 / 1e6          # claude-haiku-4-5 list prices (cache reads cheaper)


def worst_cost(body: dict) -> float:
    est_in = len(json.dumps(body)) / CHARS_PER_TOKEN + 9000 / CHARS_PER_TOKEN * 3   # + system prompt headroom
    return est_in * IN_USD + turn.MAX_TOKENS * OUT_USD


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("bodies")
    ap.add_argument("--run", action="store_true")
    ap.add_argument("--max-usd", type=float, default=0.0)
    ap.add_argument("--cats", default="", help="comma-separated categories (default: one request per category)")
    ap.add_argument("--modes", default="plain,stream", help="plain,stream | stream")
    a = ap.parse_args()
    cats = {c.strip() for c in a.cats.split(",") if c.strip()}
    modes = [m for m in ("plain", "stream") if m in a.modes.split(",")]
    seen, reqs = set(), []
    for b in json.load(open(a.bodies, encoding="utf-8")):
        if b["cat"] not in seen and (not cats or b["cat"] in cats):   # one (cold) request per category
            seen.add(b["cat"])
            reqs.append(b)
    worst = sum(len(modes) * 2 * worst_cost(b["body"]) for b in reqs)     # per mode, ≤ 2 calls each
    print(f"requests={len(reqs)} modes={','.join(modes)} calls<= {2 * len(modes) * len(reqs)} worst_case_usd={worst:.3f}")
    for b in reqs:
        print(f"  {b['cat']}: body_chars={len(json.dumps(b['body']))} caps={len(b['body'].get('capabilities') or [])}")
    if not a.run:
        print("DRY RUN — nothing sent.")
        return 0
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("STOP: ANTHROPIC_API_KEY is not set in this process.")
        return 2
    if not 0 < a.max_usd <= HARD_CEILING_USD:
        print(f"STOP: --max-usd must be in (0, {HARD_CEILING_USD}].")
        return 2
    turn._research = lambda q, r: {"answer": "research unavailable right now", "citations": []}
    spent = 0.0
    real_caller, real_stream = turn._default_caller, turn._default_stream_caller

    def guard(est):
        if spent + est > a.max_usd:
            raise SystemExit(f"STOP: the next call could pass the ${a.max_usd} ceiling (spent ${spent:.4f}).")

    print("cat|mode|first_text_ms|model_ms|calls|in_tok|out_tok|cache_read|cost_usd|disposition")
    for b in reqs:
        body = b["body"]
        for mode in modes:
            est = worst_cost(body)
            calls = {"n": 0}

            def caller(**kw):
                nonlocal spent
                guard(est)
                calls["n"] += 1
                return real_caller(**kw)

            def stream_caller(on_text, **kw):
                guard(est)
                calls["n"] += 1
                return real_stream(on_text, **kw)

            first = {"t": None}
            t0 = time.perf_counter()

            def on_event(e):
                if e.get("t") == "delta" and first["t"] is None:
                    first["t"] = time.perf_counter()

            try:
                out = turn.run_turn(message=body["message"], context=body.get("context") or {}, history=[],
                                    capabilities=body.get("capabilities"), manifest_version=body.get("manifestVersion"),
                                    routing=body.get("routing"), conversation_title="(no name yet)",
                                    caller=caller if mode == "plain" else None,
                                    on_event=on_event if mode == "stream" else None,
                                    stream_caller=stream_caller if mode == "stream" else None)
            except turn.TurnError as e:
                print(f"{b['cat']}|{mode}|-|-|{calls['n']}|-|-|-|-|refused ({type(e).__name__})")
                continue
            u = out["usage"]
            spent += float(u.get("cost_usd") or 0.0) or (u["input_tokens"] * IN_USD + u["output_tokens"] * OUT_USD)
            ft = round((first["t"] - t0) * 1000) if first["t"] else "-"
            print(f"{b['cat']}|{mode}|{ft}|{sum(u['stages']['model'])}|{u['model_calls']}|{u['input_tokens']}|"
                  f"{u['output_tokens']}|{u.get('cache_read_tokens')}|{u.get('cost_usd'):.5f}|{out['envelope']['disposition']}")
    print(f"spent_usd~{spent:.4f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
