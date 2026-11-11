"""UCT Agent — REAL-MODEL LATENCY PROBE (paid; run only with the owner's authorization).

Sends the /api/agent/turn bodies the latency benchmark captured (synthetic board, synthetic data — made
with NO model call by app/src/agent/agentLatency.test.jsx, AGENT_LATENCY_BODIES=<file>) through the
server's own `turn.run_turn`, once PLAIN and once STREAMED, and reports per request: time to the first
streamed reply text, total model time, model calls, input/output/cached tokens and cost. Nothing is
executed: no browser, no backend, no database, no workspace, no market data, no web search.

  python tools/agent_latency_probe.py BODIES.json                        # DRY RUN: sizes + worst cost
  python tools/agent_latency_probe.py BODIES.json --run --max-usd 0.50   # paid

⛔ --run needs UCT_AGENT_EVAL_API_KEY ALREADY in this process's environment (the SEPARATE eval key — the
production ANTHROPIC_API_KEY is refused, never fetched, never printed) and --max-usd ≤ 1.00. Before EVERY
call (the second call of a turn included), spend so far + that call's worst case (the whole request as a
CACHE WRITE + max_tokens output) must stay under the ceiling AND be reserved in the cumulative ledger
(tools/agent_eval_ledger.py), or the probe STOPS; each call is settled from its usage. Research is stubbed
(a request that asks for it gets "research unavailable" — the second call still runs and is counted).
Replies are never printed — only timings, counts and costs.
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
from tools import agent_eval_ledger as ledger  # noqa: E402

HARD_CEILING_USD = 1.00
SYSTEM_HEADROOM_TOKENS = 9000


def worst_cost(body: dict, model: str | None = None) -> float:
    """One call's worst case (dry-run estimate): every body byte as a token + system-prompt headroom + framing, ALL
    billed as a CACHE WRITE at the verified price, + the full output ceiling. The run itself reserves the exact
    request's worst case per call (ledger.worst_case_usd), never this estimate."""
    m = model or turn.model()
    est_in = len(json.dumps(body)) + SYSTEM_HEADROOM_TOKENS + ledger.FRAMING_TOKENS
    return ledger.cost_usd(m, cache_write=int(est_in), output=turn.output_ceiling(m))


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
    if not 0 < a.max_usd <= HARD_CEILING_USD:
        print(f"STOP: --max-usd must be in (0, {HARD_CEILING_USD}].")
        return 2
    ledger.stub_research(turn)
    model = turn.model()
    try:
        led, key, key_fp = ledger.preflight(turn, max_usd=a.max_usd)
        import anthropic
        client = anthropic.Anthropic(api_key=key, max_retries=0, timeout=60.0)
        ledger.check_model(client, model)
    except ledger.LedgerRefused as e:
        print(f"STOP: {e}")
        return 2
    run_id = f"latency_probe-{int(time.time())}"
    spent = 0.0
    print(f"cumulative ledger: ${led.remaining():.4f} left of ${led.cap():.2f} (run {run_id})")

    def run_cap(worst: float) -> str | None:
        # re-read before EVERY call — the second call of a turn sees the first one's cost
        return f"the next call (worst ${worst:.4f}) could pass the ${a.max_usd} ceiling (spent ${spent:.4f})" if spent + worst > a.max_usd else None

    def metered(fn, kw):
        """reserve the worst case → call → settle from usage; this run's spend advances per CALL"""
        nonlocal spent
        try:
            resp, worst = led.guarded_call(run_id, fn, kw, tool="agent_latency_probe", key_fp=key_fp, per_run_cap=run_cap)
        except ledger.LedgerRefused as e:
            raise SystemExit(f"STOP: {e}") from e
        u = ledger.usage_tokens(resp)
        spent += ledger.cost_usd(model, **u) if u else worst
        return resp

    def real_caller(**kw):
        return client.messages.create(**kw)

    def real_stream(on_text, **kw):
        with client.messages.stream(**kw) as stream:
            for event in stream:
                if getattr(event, "type", None) == "text":
                    on_text(event.text)
            return stream.get_final_message()

    print("cat|mode|first_text_ms|model_ms|calls|in_tok|out_tok|cache_read|cost_usd|disposition")
    for b in reqs:
        body = b["body"]
        for mode in modes:
            calls = {"n": 0}

            def caller(**kw):
                calls["n"] += 1
                return metered(real_caller, kw)

            def stream_caller(on_text, **kw):
                calls["n"] += 1
                return metered(lambda **k: real_stream(on_text, **k), kw)

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
            ft = round((first["t"] - t0) * 1000) if first["t"] else "-"
            print(f"{b['cat']}|{mode}|{ft}|{sum(u['stages']['model'])}|{u['model_calls']}|{u['input_tokens']}|"
                  f"{u['output_tokens']}|{u.get('cache_read_tokens')}|{u.get('cost_usd'):.5f}|{out['envelope']['disposition']}")
    print(f"spent_usd~{spent:.4f}   cumulative ledger: ${led.remaining():.4f} left of ${led.cap():.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
