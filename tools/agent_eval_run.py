"""NL-1 EVAL runner — the paid replay of captured requests, bounded and isolated. DRY RUN by default.

  # 1. capture (free):  AGENT_EVAL_OUT=bodies.json AGENT_EVAL_MODE=both npx vitest run src/agent/agentNl1EvalCapture.test.js
  # 2. estimate (free): python tools/agent_eval_run.py bodies.json --model claude-haiku-5-5 --mode nl1
  # 3. run (PAID, owner approval):
  #    UCT_AGENT_EVAL_API_KEY=... python tools/agent_eval_run.py bodies.json --model M --mode nl1 --run --max-usd 5 --out results.json
  # 4. score (free):    AGENT_EVAL_BODIES=bodies.json AGENT_EVAL_RESULTS=results.json npx vitest run src/agent/agentNl1EvalScore.test.js

Each captured request goes through the server's OWN `turn.run_turn` — same prompt, schema, sanitizer and NL-1
gate as production — with a fake-free caller on a SEPARATE eval key. Nothing is executed: no browser, no
database, no workspace, no member data, no web research, no write to UCT's cost ledgers.

⛔ --run refuses unless ALL hold (owner decisions 3 and 5, 2026-10-16):
  • tools/agent_eval_prices.json is marked `verified` (prices checked live, not assumed);
  • UCT_AGENT_EVAL_API_KEY is set (a separate, non-production key) and is NOT the production ANTHROPIC_API_KEY;
  • --max-usd is given; before EVERY call its worst case (prompt as a cache write + full max_tokens output, at the
    HIGHER of this file's price and the server's own conservative estimator) is added to the spend so far, and
    the run stops if that could pass the ceiling;
  • the model exists on the eval account (a free models lookup).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import conftest  # noqa: E402,F401 -- the census and the tripwire, before any api.* import (every *_DB_PATH → a sandbox)
from api.services import narrative_cost_guard  # noqa: E402
from api.services.uct_agent import turn  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PRICES = os.path.join(HERE, "agent_eval_prices.json")
EVAL_KEY_ENV = "UCT_AGENT_EVAL_API_KEY"
CHARS_PER_TOKEN_LOW = 4.0      # typical English/JSON
CHARS_PER_TOKEN_HIGH = 3.0     # conservative (more tokens)


def load_prices(path: str = PRICES) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def prompt_parts(item: dict) -> dict:
    """The characters of one request, split into the cacheable prefix (system prompt) and the rest."""
    body = item["body"]
    nl1 = body.get("interpreter") == "nl1"
    limit = turn.MAX_CAPABILITIES_NL1 if nl1 else turn.MAX_CAPABILITIES
    caps = turn.validate_manifest(body["capabilities"], limit)
    route = None if nl1 else turn.validate_routing(body.get("routing"))
    unselected = route["unselected"] if route else None
    compact = True if nl1 else turn.compact_ops(caps)
    system = turn.system_prompt(caps, unselected, compact, nl1=nl1)
    schema = json.dumps(turn.envelope_schema(caps, unselected, compact, nl1=nl1))
    rest = (len(turn._block("workspace_context", body["context"])) + len(body["message"])
            + sum(len(str(h.get("text") or "")) + 20 for h in item.get("history") or []) + 400)
    return {"system": len(system) + len(schema), "rest": rest}


def usd(prices: dict, model: str, *, inp: int = 0, out: int = 0, cache_read: int = 0, cache_write: int = 0) -> float:
    p = prices["models"][model]
    m = 1_000_000
    return (inp * p["input"] + out * p["output"] + cache_read * p["cache_read"]
            + cache_write * p["input"] * prices.get("cache_write_multiplier", 1.25)) / m


def estimate(items: list[dict], prices: dict, model: str, out_tokens: int = 350) -> dict:
    """Free token / cost estimate for a run (chars → tokens at two ratios; caching assumed per request shape)."""
    rows = [prompt_parts(i) for i in items]
    sys_lo = sum(r["system"] for r in rows) / CHARS_PER_TOKEN_LOW
    sys_hi = sum(r["system"] for r in rows) / CHARS_PER_TOKEN_HIGH
    rest_lo = sum(r["rest"] for r in rows) / CHARS_PER_TOKEN_LOW
    rest_hi = sum(r["rest"] for r in rows) / CHARS_PER_TOKEN_HIGH
    n = len(rows)
    # uncached: everything billed as input; cached: the first request of each distinct system prompt writes,
    # the rest read (a run is fast enough to stay inside the 5-minute cache window)
    distinct = len({r["system"] for r in rows}) or 1
    avg_sys_hi = sys_hi / max(n, 1)
    uncached = usd(prices, model, inp=int(sys_hi + rest_hi), out=n * out_tokens)
    cached = usd(prices, model, inp=int(rest_hi), out=n * out_tokens,
                 cache_write=int(avg_sys_hi * distinct), cache_read=int(avg_sys_hi * max(n - distinct, 0)))
    worst = usd(prices, model, cache_write=int(sys_hi + rest_hi), out=n * turn.MAX_TOKENS)
    return {"requests": n, "input_tokens_low": int(sys_lo + rest_lo), "input_tokens_high": int(sys_hi + rest_hi),
            "system_tokens_per_request_high": int(avg_sys_hi), "distinct_system_prompts": distinct,
            "usd_uncached": round(uncached, 2), "usd_cached": round(cached, 2), "usd_worst_case": round(worst, 2)}


def refusal(args, prices: dict) -> str | None:
    """Why --run must not start (None = it may)."""
    if args.max_usd is None or args.max_usd <= 0:
        return "--run needs an explicit --max-usd ceiling"
    if not prices.get("verified"):
        return "tools/agent_eval_prices.json is not verified: check the live prices and model list first"
    if args.model not in prices.get("models", {}):
        return f"no verified price for {args.model}"
    key = os.environ.get(EVAL_KEY_ENV, "")
    if not key:
        return f"{EVAL_KEY_ENV} is not set (a separate, non-production eval key)"
    if key == os.environ.get("ANTHROPIC_API_KEY", ""):
        return f"{EVAL_KEY_ENV} is the production key: the eval never spends the production budget"
    return None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("bodies")
    ap.add_argument("--model", required=True)
    ap.add_argument("--mode", choices=["nl1", "legacy"], required=True)
    ap.add_argument("--sets", default=None, help="comma-separated set files (default: all captured)")
    ap.add_argument("--effort", choices=["low", "medium", "high"], default=None, help="output_config.effort (models that support it)")
    ap.add_argument("--run", action="store_true")
    ap.add_argument("--max-usd", type=float, default=None)
    ap.add_argument("--out", default=None)
    a = ap.parse_args(argv)
    prices = load_prices()
    items = [i for i in json.load(open(a.bodies, encoding="utf-8")) if i.get("mode") == a.mode]
    if a.sets:
        keep = set(a.sets.split(","))
        items = [i for i in items if i.get("set") in keep]
    if a.model not in prices["models"]:
        print(f"refused: no price for {a.model} in tools/agent_eval_prices.json")
        return 2
    est = estimate(items, prices, a.model)
    by_set: dict[str, int] = {}
    for i in items:
        by_set[i["set"]] = by_set.get(i["set"], 0) + 1
    print(f"model {a.model}  mode {a.mode}  requests {est['requests']}  " + "  ".join(f"{k}:{v}" for k, v in sorted(by_set.items())))
    print(f"input tokens ~{est['input_tokens_low']:,}–{est['input_tokens_high']:,}  (system prompt ~{est['system_tokens_per_request_high']:,}/request, "
          f"{est['distinct_system_prompts']} distinct)")
    print(f"cost  cached ~${est['usd_cached']}   uncached ~${est['usd_uncached']}   worst case ~${est['usd_worst_case']}"
          f"   prices verified: {bool(prices.get('verified'))}")
    if not a.run:
        print("DRY RUN — no model call was made.")
        return 0
    why = refusal(a, prices)
    if why:
        print(f"refused: {why}")
        return 2
    return _run(a, items, prices)


def _run(a, items: list[dict], prices: dict) -> int:  # pragma: no cover - paid path, exercised only with owner approval
    import anthropic
    from api.services import llm_timeouts
    os.environ["UCT_AGENT_MODEL"] = a.model
    if a.mode == "nl1":
        os.environ[turn.NL1_ENV] = "1"          # this process only: the eval asks the server's NL-1 path
    client = anthropic.Anthropic(api_key=os.environ[EVAL_KEY_ENV], max_retries=0,
                                 timeout=llm_timeouts.seconds("UCT_AGENT_TIMEOUT_S", llm_timeouts.REQUEST_PATH))
    try:
        client.models.retrieve(a.model)         # free lookup: the model exists on THIS account
    except Exception as e:  # noqa: BLE001
        print(f"refused: model {a.model} is not available on the eval account ({type(e).__name__})")
        return 2
    turn._research = lambda *_a, **_k: {"results": [], "citations": [], "note": "research disabled for the eval"}
    turn._record_cost = lambda _resp: 0.0
    spent = {"usd": 0.0, "calls": 0}

    class Stop(Exception):
        pass

    def caller(**kw):
        if a.effort and a.model != "claude-haiku-4-5":
            kw["output_config"] = {**kw["output_config"], "effort": a.effort}
        chars = len(json.dumps(kw.get("system"), default=str)) + len(json.dumps(kw.get("messages"), default=str)) \
            + len(json.dumps(kw.get("output_config"), default=str))
        tok = int(chars / CHARS_PER_TOKEN_HIGH)
        worst = max(usd(prices, a.model, cache_write=tok, out=int(kw.get("max_tokens") or turn.MAX_TOKENS)),
                    narrative_cost_guard.estimate_cost(a.model, 0, int(kw.get("max_tokens") or turn.MAX_TOKENS), cache_creation_tokens=tok))
        if spent["usd"] + worst > a.max_usd:
            raise Stop(f"${spent['usd']:.4f} spent + worst ${worst:.4f} for the next call would pass ${a.max_usd:.2f}")
        resp = client.messages.create(**kw)
        u = getattr(resp, "usage", None)
        spent["usd"] += usd(prices, a.model, inp=int(getattr(u, "input_tokens", 0) or 0), out=int(getattr(u, "output_tokens", 0) or 0),
                            cache_read=int(getattr(u, "cache_read_input_tokens", 0) or 0),
                            cache_write=int(getattr(u, "cache_creation_input_tokens", 0) or 0))
        spent["calls"] += 1
        return resp

    out = []
    for it in items:
        b = it["body"]
        t0 = time.monotonic()
        try:
            r = turn.run_turn(message=b["message"], context=b["context"], history=it.get("history") or [],
                              capabilities=b["capabilities"], routing=b.get("routing"), pending=b.get("pending"),
                              manifest_version=b.get("manifestVersion"), caller=caller, interpreter=b.get("interpreter"))
            env, err, usage = r["envelope"], None, r["usage"]
        except Stop as e:
            print(f"STOP before the next call: {e}")
            break
        except turn.TurnError as e:
            env, err, usage = {}, str(e), {}
        out.append({"key": it["key"], "set": it["set"], "mode": it["mode"], "ms": int((time.monotonic() - t0) * 1000),
                    "envelope": env, "error": err, "usage": {k: usage.get(k) for k in ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "model_calls")}})
        if len(out) % 25 == 0:
            print(f"  {len(out)}/{len(items)}  spent ${spent['usd']:.4f}")
    print(f"done {len(out)}/{len(items)} requests, {spent['calls']} calls, spent ${spent['usd']:.4f} of ${a.max_usd:.2f}")
    if a.out:
        json.dump({"model": a.model, "mode": a.mode, "effort": a.effort, "spent_usd": spent["usd"], "results": out},
                  open(a.out, "w", encoding="utf-8"), indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
