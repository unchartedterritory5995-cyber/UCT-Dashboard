"""NL-1 EVAL runner — the paid replay of captured requests, bounded and isolated. DRY RUN by default.

  # 1. capture (free):  AGENT_EVAL_OUT=bodies.json AGENT_EVAL_MODE=both npx vitest run src/agent/agentNl1EvalCapture.test.js
  # 2. estimate (free): python tools/agent_eval_run.py bodies.json --model claude-haiku-5-5 --mode nl1 [--keys trial]
  # 3. run (PAID, owner approval):
  #    UCT_AGENT_EVAL_API_KEY=... python tools/agent_eval_run.py bodies.json --model M --mode nl1 --keys trial --run --max-usd 0.50 --out r.json
  # 4. score (free):    AGENT_EVAL_BODIES=bodies.json AGENT_EVAL_RESULTS=r.json npx vitest run src/agent/agentNl1EvalScore.test.js

Each captured request goes through the server's OWN `turn.run_turn` — same prompt, schema, sanitizer, NL-1 gate and
repair as production — on a SEPARATE eval key. NL-1 requests carry the hybrid action selection the panel sends
(app/src/agent/nl1/selection.js); when the model asks for more action groups (`need_groups`), the panel's ONE reroute
is replayed with the groups the capture recorded for it (`reroutes`, assembled by `assemble_nl1` exactly as the
browser's `assembleNl1`), or ends as the panel's refusal when they cannot be supplied. Nothing is executed: no browser, database, workspace or member data,
no web research, no write to UCT's cost ledgers. The key is read from the environment only; it is never printed,
logged or written to any output file.

⛔ --run refuses unless ALL hold (owner decisions 2, 3 and 5, 2026-10-16):
  • tools/agent_eval_prices.json is `verified` and prices the model;
  • UCT_AGENT_EVAL_API_KEY is set and is NOT the production ANTHROPIC_API_KEY;
  • --max-usd is given. Before EVERY call its worst case (the whole prompt as a 5-minute cache write + the full
    max_tokens of output, at the HIGHER of this file's price and the server's conservative estimator) is added to
    the spend so far; if that could pass the ceiling, the run stops;
  • the model exists on the eval account (a free models lookup, made first).
ABORTS during a run (the run stops, results so far are written):
  • the ceiling (above);  • a call that cost more than its own pre-call worst case (the estimate is wrong);
  • 2 API errors or timeouts in a row;  • 2 calls ending in `refusal` or `max_tokens` (truncated by reasoning);
  • NL-1: no cache read on any of calls 2–3 (caching is not working, so the cost estimate is invalid).
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
TRIAL = os.path.join(HERE, "agent_eval_trial.json")
EVAL_KEY_ENV = "UCT_AGENT_EVAL_API_KEY"
CHARS_PER_TOKEN_LOW = 4.0      # typical English/JSON
CHARS_PER_TOKEN_HIGH = 3.0     # conservative (more tokens)
DEFAULT_TIMEOUT_S = 30.0


def load_prices(path: str = PRICES) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def trial_keys(path: str = TRIAL) -> set[tuple[str, str]]:
    with open(path, encoding="utf-8") as f:
        return {(k["key"], k["set"]) for k in json.load(f)["keys"]}


def prompt_parts(item: dict) -> dict:
    """The characters of one request: the system prompt + schema (cacheable) and the rest. NL-1's system prompt is
    split as run_turn sends it: `stable` (the core + rules + glossary, and the reference data) is the same on every
    request; `variable` (a routed request's other actions and the groups it was not given, and the schema) varies."""
    body = item["body"]
    nl1 = body.get("interpreter") == "nl1"
    limit = turn.MAX_CAPABILITIES_NL1 if nl1 else turn.MAX_CAPABILITIES
    caps = turn.validate_manifest(body["capabilities"], limit)
    route = turn.validate_routing(body.get("routing"))
    unselected = route["unselected"] if route else None
    compact = True if nl1 else turn.compact_ops(caps)
    schema = json.dumps(turn.envelope_schema(caps, unselected, compact, nl1=nl1))
    if nl1:
        texts = turn.nl1_system_texts(caps, unselected, turn.nl1_stable_names(body.get("routing"), body["capabilities"]))
        stable = texts[0] + (turn.reference_block(body.get("reference")) or "")
        variable = "".join(texts[1:]) + schema
    else:
        stable, variable = "", turn.system_prompt(caps, unselected, compact) + schema
    rest = (len(turn._block("workspace_context", body["context"])) + len(body["message"])
            + sum(len(str(h.get("text") or "")) + 20 for h in item.get("history") or []) + 400)
    return {"system": len(stable) + len(variable), "stable": stable, "variable": variable, "rest": rest}


def rates(prices: dict, model: str, prompt_tokens: int = 0) -> dict:
    p = prices["models"][model]
    return p["over_100k"] if prompt_tokens > 100_000 and "over_100k" in p else p


def usd(prices: dict, model: str, *, inp: int = 0, out: int = 0, cache_read: int = 0, cache_write: int = 0) -> float:
    r = rates(prices, model, inp + cache_read + cache_write)
    return (inp * r["input"] + out * r["output"] + cache_read * r["cache_read"] + cache_write * r["cache_write_5m"]) / 1_000_000


def estimate(items: list[dict], prices: dict, model: str, out_tokens: int = 350) -> dict:
    """Free token / cost estimate (chars → tokens at two ratios; caching assumed per distinct system prompt)."""
    rows = [prompt_parts(i) for i in items]
    n = len(rows)
    sys_lo = sum(r["system"] for r in rows) / CHARS_PER_TOKEN_LOW
    sys_hi = sum(r["system"] for r in rows) / CHARS_PER_TOKEN_HIGH
    rest_lo = sum(r["rest"] for r in rows) / CHARS_PER_TOKEN_LOW
    rest_hi = sum(r["rest"] for r in rows) / CHARS_PER_TOKEN_HIGH
    distinct = len({(r["stable"], r["variable"]) for r in rows}) or 1
    avg_sys_hi = sys_hi / max(n, 1)
    per_call_prompt_hi = int((sys_hi + rest_hi) / max(n, 1))
    uncached = sum(usd(prices, model, inp=int((r["system"] + r["rest"]) / CHARS_PER_TOKEN_HIGH), out=out_tokens) for r in rows)
    # cached, PER REQUEST (a price tier applies to one request's prompt, never to a run's total): the first request
    # with a given prefix writes it to the cache, every later one reads it — the stable part (NL-1's core block +
    # reference data) and, after it, the variable part (a routed request's other actions + schema) separately
    seen_stable: set[str] = set()
    seen_whole: set[tuple[str, str]] = set()
    cached = 0.0
    for r in rows:
        st_t, var_t = int(len(r["stable"]) / CHARS_PER_TOKEN_HIGH), int(len(r["variable"]) / CHARS_PER_TOKEN_HIGH)
        rest_t = int(r["rest"] / CHARS_PER_TOKEN_HIGH)
        new_stable = r["stable"] not in seen_stable
        new_whole = (r["stable"], r["variable"]) not in seen_whole
        seen_stable.add(r["stable"])
        seen_whole.add((r["stable"], r["variable"]))
        write = (st_t if new_stable else 0) + (var_t if new_whole else 0)
        read = (0 if new_stable else st_t) + (0 if new_whole else var_t)
        cached += usd(prices, model, inp=rest_t, out=out_tokens, cache_write=write, cache_read=read)
    worst_one = usd(prices, model, cache_write=per_call_prompt_hi, out=turn.MAX_TOKENS)
    return {"requests": n, "input_tokens_low": int(sys_lo + rest_lo), "input_tokens_high": int(sys_hi + rest_hi),
            "system_tokens_per_request_high": int(avg_sys_hi), "prompt_tokens_per_request_high": per_call_prompt_hi,
            "distinct_system_prompts": distinct, "usd_cached": round(cached, 4), "usd_uncached": round(uncached, 4),
            "usd_worst_per_call": round(worst_one, 4),
            # every request may make 2 calls (the one repair) — the worst case counts both
            "usd_worst_case": round(worst_one * n * 2, 4)}


def refusal(args, prices: dict) -> str | None:
    """Why --run must not start (None = it may)."""
    if args.max_usd is None or args.max_usd <= 0:
        return "--run needs an explicit --max-usd ceiling"
    if not prices.get("verified"):
        return "tools/agent_eval_prices.json is not verified: check the live prices first"
    if args.model not in prices.get("models", {}):
        return f"no verified price for {args.model}"
    key = os.environ.get(EVAL_KEY_ENV, "")
    if not key:
        return f"{EVAL_KEY_ENV} is not set (a separate, non-production eval key)"
    if key == os.environ.get("ANTHROPIC_API_KEY", ""):
        return f"{EVAL_KEY_ENV} is the production key: the eval never spends the production budget"
    return None


#: A reroute adds at most this many groups (app/src/agent/nl1/selection.js NL1_MAX_NEED).
MAX_NEED = 3
#: The panel's words when a reroute cannot be made or is not enough (useAgent): nothing runs.
TOO_MANY_PARTS = "That touches too many parts of UCT for one request. Try asking for one part at a time."
NEEDS_MORE = "That needs more of UCT than I can plan in one step. Try asking for one part at a time."


def catalogs_of(entries: list[dict]) -> dict:
    """The capture's catalog entries ({catalog, manifest, core, groupOf, groups}) by id."""
    return {e["catalog"]: e for e in entries
            if isinstance(e, dict) and "manifest" in e and "catalog" in e and "mode" not in e}


def assemble_nl1(catalog: dict, selected: list[str]) -> tuple[list[dict], dict | None]:
    """The browser's `assembleNl1` (nl1/selection.js), exactly: the whole catalog (routing None) when every present
    group is selected; else the core's actions first, then the other selected groups' — each in catalog order — and
    the routing (`stable` = how many leading actions are the core). Held to the browser by
    tests/fixtures/nl1_assemble_parity.json."""
    full, group_of, core, present = catalog["manifest"], catalog["groupOf"], catalog["core"], catalog["groups"]
    selected = list(dict.fromkeys([*core, *selected]))          # the core is always selected (and sent first)
    if all(g["id"] in selected for g in present):
        return full, None
    head = [c for c in full if group_of.get(c["name"]) in core]
    tail = [c for c in full if group_of.get(c["name"]) not in core
            and (group_of.get(c["name"]) is None or group_of.get(c["name"]) in selected)]
    routing = {"version": 1, "groups": [{"id": g["id"], "title": g["title"]} for g in present],
               "selected": [g["id"] for g in present if g["id"] in selected], "stable": len(head)}
    return head + tail, routing


def reroute_request(item: dict, catalogs: dict, need: list) -> dict | None:
    """The panel's ONE reroute (useAgent) for the groups the model asked for: the same request with the groups the
    capture recorded for them, or None when the panel would stop instead (more than MAX_NEED groups, or they do not
    fit beside the core under the 60-action limit)."""
    sel = item.get("selection") or {}
    need = sorted({str(g) for g in need or [] if g not in (sel.get("selected") or [])})
    if not need or len(need) > MAX_NEED:
        return None
    rr = (item.get("reroutes") or {}).get("+".join(need))
    cat = catalogs.get(item.get("catalog"))
    if not rr or not cat:
        return None
    manifest, routing = assemble_nl1(cat, rr["selected"])
    return {**item["body"], "capabilities": manifest, "routing": routing}


class CeilingMeter:
    """The /turn route's CALL CEILING for one member request (budget.py: 2 paid calls, a reroute included),
    without the ledgers: the replay makes exactly the calls production would — a reroute that is the request's
    second call is never repaired, and nothing makes a third. One instance per request."""

    def __init__(self, max_calls: int = 2):
        self.max_calls, self.calls = max_calls, 0

    def calls_left(self) -> int:
        return max(0, self.max_calls - self.calls)

    def call(self, category: str, fn, **kwargs):
        from api.services.uct_agent.budget import BudgetRefused
        if self.calls >= self.max_calls:
            raise BudgetRefused("call_limit", "This request reached its model-call limit.")
        self.calls += 1
        return fn(**kwargs)

    def research(self, fn):
        return fn()


def stopped_envelope(reply: str) -> dict:
    """What the member gets when the panel stops instead of rerouting: nothing runs."""
    return {"disposition": "answer", "reply": reply, "question": None, "ops": [], "unsupported_category": None}


def select(items: list[dict], mode: str, sets: str | None, keys: str | None) -> list[dict]:
    out = [i for i in items if i.get("mode") == mode and not i.get("exact")]   # exact Undo/Cancel never reach the model
    if sets:
        keep = set(sets.split(","))
        out = [i for i in out if i.get("set") in keep]
    if keys:
        want = trial_keys() if keys == "trial" else {tuple(k.split("@", 1)) if "@" in k else (k, None) for k in keys.split(",")}
        out = [i for i in out if (i["key"], i["set"]) in want or (i["key"], None) in want]
    if any(i.get("split") == "sealed" for i in out) and keys:
        raise SystemExit("refused: a key selection may name DEV cases only — sealed sets run whole or not at all")
    return out


class Monitor:
    """The abort conditions, fed one call at a time (pure: tested without any API)."""

    def __init__(self, nl1: bool):
        self.nl1, self.errors_in_row, self.bad_stops, self.calls, self.cache_reads = nl1, 0, 0, 0, []

    def after_call(self, *, worst: float, actual: float, stop_reason: str | None, cache_read: int) -> str | None:
        self.calls += 1
        self.errors_in_row = 0
        self.cache_reads.append(cache_read)
        if actual > worst * 1.0001:
            return f"a call cost ${actual:.5f}, more than its own worst case ${worst:.5f}: the estimate is wrong"
        if stop_reason in ("refusal", "max_tokens"):
            self.bad_stops += 1
            if self.bad_stops >= 2:
                return f"2 calls ended in refusal/max_tokens (last: {stop_reason})"
        if self.nl1 and self.calls == 3 and not any(self.cache_reads[1:3]):
            return "no cache read on calls 2-3: caching is not working, so the cost estimate is invalid"
        return None

    def after_error(self) -> str | None:
        self.errors_in_row += 1
        return "2 API errors or timeouts in a row" if self.errors_in_row >= 2 else None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("bodies")
    ap.add_argument("--model", required=True)
    ap.add_argument("--mode", choices=["nl1", "legacy"], required=True)
    ap.add_argument("--sets", default=None, help="comma-separated set files (default: all captured)")
    ap.add_argument("--keys", default=None, help="'trial' (tools/agent_eval_trial.json) or comma-separated dev keys")
    ap.add_argument("--effort", choices=["low", "medium", "high"], default=None, help="output_config.effort (not Haiku 4.5)")
    ap.add_argument("--timeout-s", type=float, default=DEFAULT_TIMEOUT_S)
    ap.add_argument("--catalog", choices=["full", "lean"], default="full", help="NL-1 catalog variant (lean: no usage hints)")
    ap.add_argument("--run", action="store_true")
    ap.add_argument("--max-usd", type=float, default=None)
    ap.add_argument("--out", default=None)
    a = ap.parse_args(argv)
    prices = load_prices()
    os.environ[turn.NL1_CATALOG_ENV] = a.catalog          # this process only (estimate and run use the same variant)
    if a.model not in prices["models"]:
        print(f"refused: no price for {a.model} in tools/agent_eval_prices.json")
        return 2
    captured = json.load(open(a.bodies, encoding="utf-8"))
    items = select(captured, a.mode, a.sets, a.keys)
    a.catalogs = catalogs_of(captured)
    est = estimate(items, prices, a.model)
    by_set: dict[str, int] = {}
    for i in items:
        by_set[i["set"]] = by_set.get(i["set"], 0) + 1
    print(f"model {a.model}  mode {a.mode}  catalog {a.catalog}  requests {est['requests']}  " + "  ".join(f"{k}:{v}" for k, v in sorted(by_set.items())))
    print(f"input tokens ~{est['input_tokens_low']:,}-{est['input_tokens_high']:,}  (prompt ~{est['prompt_tokens_per_request_high']:,}/request, "
          f"system ~{est['system_tokens_per_request_high']:,}, {est['distinct_system_prompts']} distinct)")
    print(f"cost  cached ~${est['usd_cached']}   uncached ~${est['usd_uncached']}   worst per call ${est['usd_worst_per_call']}   "
          f"worst case (2 calls each, full {turn.MAX_TOKENS} output) ${est['usd_worst_case']}   prices verified: {bool(prices.get('verified'))}")
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
    os.environ["UCT_AGENT_MODEL"] = a.model
    if a.mode == "nl1":
        os.environ[turn.NL1_ENV] = "1"          # this process only: the eval asks the server's NL-1 path
    client = anthropic.Anthropic(api_key=os.environ[EVAL_KEY_ENV], max_retries=0, timeout=a.timeout_s)
    try:
        client.models.retrieve(a.model)         # free lookup: the model exists on THIS account
    except Exception as e:  # noqa: BLE001
        print(f"refused: model {a.model} is not available on the eval account ({type(e).__name__})")
        return 2
    print(f"model {a.model}: available on the eval account")
    turn._research = lambda *_a, **_k: {"results": [], "citations": [], "note": "research disabled for the eval"}
    turn._record_cost = lambda _resp: 0.0
    spent = {"usd": 0.0, "calls": 0}
    mon = Monitor(a.mode == "nl1")
    calls: list[dict] = []

    class Stop(Exception):
        pass

    def caller(**kw):
        if a.effort and a.model != "claude-haiku-4-5":
            kw["output_config"] = {**kw["output_config"], "effort": a.effort}
        chars = len(json.dumps(kw.get("system"), default=str)) + len(json.dumps(kw.get("messages"), default=str)) \
            + len(json.dumps(kw.get("output_config"), default=str))
        tok = int(chars / CHARS_PER_TOKEN_HIGH)
        max_out = int(kw.get("max_tokens") or turn.MAX_TOKENS)
        worst = max(usd(prices, a.model, cache_write=tok, out=max_out),
                    narrative_cost_guard.estimate_cost(a.model, 0, max_out, cache_creation_tokens=tok))
        if spent["usd"] + worst > a.max_usd:
            raise Stop(f"${spent['usd']:.4f} spent + worst ${worst:.4f} for the next call would pass ${a.max_usd:.2f}")
        t0 = time.monotonic()
        try:
            resp = client.messages.create(**kw)
        except Exception as e:  # noqa: BLE001 -- an API error / timeout: counted, then re-raised to the turn
            why = mon.after_error()
            calls.append({"error": type(e).__name__, "ms": int((time.monotonic() - t0) * 1000)})
            if why:
                raise Stop(why) from e
            raise
        u = getattr(resp, "usage", None)
        details = getattr(u, "output_tokens_details", None)
        row = {"ms": int((time.monotonic() - t0) * 1000), "stop": getattr(resp, "stop_reason", None),
               "input": int(getattr(u, "input_tokens", 0) or 0), "output": int(getattr(u, "output_tokens", 0) or 0),
               "thinking": int(getattr(details, "thinking_tokens", 0) or 0) if details is not None else None,
               "cache_read": int(getattr(u, "cache_read_input_tokens", 0) or 0),
               "cache_write": int(getattr(u, "cache_creation_input_tokens", 0) or 0)}
        row["usd"] = usd(prices, a.model, inp=row["input"], out=row["output"], cache_read=row["cache_read"], cache_write=row["cache_write"])
        spent["usd"] += row["usd"]
        spent["calls"] += 1
        calls.append(row)
        print(f"    call {spent['calls']:>3}  {row['ms']:>6} ms  in {row['input']:>6}  read {row['cache_read']:>6}  write {row['cache_write']:>6}  "
              f"out {row['output']:>5} (thinking {row['thinking']})  {row['stop']}  ${row['usd']:.5f}")
        why = mon.after_call(worst=worst, actual=row["usd"], stop_reason=row["stop"], cache_read=row["cache_read"])
        if why:
            raise Stop(why)
        return resp

    out = []
    stopped = None

    def one(it, b, meter, reroute=False):
        return turn.run_turn(message=b["message"], context=b["context"], history=it.get("history") or [],
                             capabilities=b["capabilities"], routing=b.get("routing"), pending=b.get("pending"),
                             manifest_version=b.get("manifestVersion"), caller=caller, interpreter=b.get("interpreter"),
                             reference=b.get("reference"), reroute=reroute, meter=meter)

    for it in items:
        b = it["body"]
        t0 = time.monotonic()
        need, rerouted = [], False
        meter = CeilingMeter()
        try:
            r = one(it, b, meter)
            env, err, usage = r["envelope"], None, dict(r["usage"])
            need = list(env.get("need_groups") or []) if a.mode == "nl1" else []
            if need:
                # the panel's ONE reroute (useAgent), inside the request's 2-call ceiling
                b2 = reroute_request(it, a.catalogs, need) if meter.calls_left() >= 1 else None
                if b2 is None:
                    env = stopped_envelope(TOO_MANY_PARTS)
                else:
                    rerouted = True
                    r2 = one(it, b2, meter, reroute=True)
                    env = r2["envelope"] if not r2["envelope"].get("need_groups") else stopped_envelope(NEEDS_MORE)
                    for k in ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "model_calls"):
                        usage[k] = int(usage.get(k) or 0) + int(r2["usage"].get(k) or 0)
                    usage["repaired"] = usage.get("repaired") or r2["usage"].get("repaired")
        except Stop as e:
            stopped = str(e)
            print(f"ABORT: {e}")
            break
        except turn.TurnError as e:
            env, err, usage = {}, str(e), {}
        except Exception as e:  # noqa: BLE001 -- an API error on one request (the monitor decides whether to stop)
            env, err, usage = {}, f"{type(e).__name__}", {}
        out.append({"key": it["key"], "set": it["set"], "mode": it["mode"], "ms": int((time.monotonic() - t0) * 1000),
                    "envelope": env, "error": err, "need": sorted(set(need)), "rerouted": rerouted,
                    "usage": {k: usage.get(k) for k in ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "model_calls", "repaired")}})
    reads = [c for c in calls if "cache_read" in c]
    hit = sum(c["cache_read"] for c in reads) / max(1, sum(c["cache_read"] + c["cache_write"] + c["input"] for c in reads))
    thinking = [c["thinking"] for c in reads if c.get("thinking") is not None]
    print(f"done {len(out)}/{len(items)} requests, {spent['calls']} calls, spent ${spent['usd']:.4f} of ${a.max_usd:.2f}"
          f"   cache-read share of input {hit:.0%}   thinking tokens max {max(thinking) if thinking else 'n/a'}"
          f"   truncated {sum(1 for c in reads if c['stop'] == 'max_tokens')}" + (f"   ABORTED: {stopped}" if stopped else ""))
    if a.out:
        json.dump({"model": a.model, "mode": a.mode, "effort": a.effort, "spent_usd": spent["usd"], "aborted": stopped,
                   "calls": calls, "results": out}, open(a.out, "w", encoding="utf-8"), indent=1)
    return 1 if stopped else 0


if __name__ == "__main__":
    sys.exit(main())
