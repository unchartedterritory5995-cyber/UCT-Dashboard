"""Coach guard stage 2 -- ONE isolated, owner-approved evaluation run on the independent held-out sets (#761).

  python tools/coach_classifier_eval.py                         # FREE dry run: stage-1 counts + the worst-case cost
  UCT_AGENT_EVAL_API_KEY=... python tools/coach_classifier_eval.py --run --i-have-owner-approval   # PAID, once

What it does
  * Stage 1 = the server rule guard (api/services/uct_agent/coach/guard.py `check`, inputs omitted = noInputs,
    the mode PR #773 reported). Free, local.
  * Stage 2 = api/services/uct_agent/coach/classifier.py, called ONLY on the cases stage 1 PASSED (the doc's shape:
    rules first, classifier second). The planned call set is therefore fixed before the run starts.
  * The held-out sets are the EVALUATION set only. The classifier rubric was written from the dev set; nothing here
    feeds results back into the rubric.

Hard cost cap ($0.15, the owner's number, in code -- no flag raises it)
  1. Before the run: worst case for the FULL planned call set = for each call, every UTF-8 byte of the request as one
     input token + FRAMING_TOKENS, all priced at the 5-minute CACHE WRITE rate (the dearest input rate), + the full
     max_tokens of output at the output rate. If the sum is over $0.15 the run refuses to start.
  2. During the run, before every call: spent (actual, from each response's usage; a call that raised without usage
     is charged at its worst case) + this call's worst case must be <= $0.15, else the run STOPS; the remaining
     cases are reported as not classified.
  3. Every call is also reserved/settled in the cumulative eval ledger (tools/agent_eval_ledger.py, the owner's $21),
     with the separate eval key (UCT_AGENT_EVAL_API_KEY, never the production key, never printed).
  4. Exactly one run: a marker file next to the ledger is created EXCLUSIVELY before the first paid call; if it
     already exists the tool refuses. No retries of calls (max_retries=0) or of the run.

Output is counts only (no fixture text, no model text): rates, per-category misses, critical misses by category,
latency p50/p95, total cost, cost per call.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import statistics
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from api.services.uct_agent.coach import classifier, guard  # noqa: E402
from tools import agent_eval_ledger as ledger  # noqa: E402

HARD_CAP_USD = 0.15                     # owner approval 2026-11-04: ONE run, at most $0.15. Not configurable.
FRAMING_TOKENS = 64                     # per-request framing allowance on top of bytes-as-tokens (role/tags/schema wrap)
FIX = os.path.join(ROOT, "app", "src", "agent", "__fixtures__", "coachGuardIndependent")
SETS = ("advice", "critical", "educational")
TOOL = "coach_classifier_eval"
RUN_MARKER = os.path.join(os.path.dirname(ledger.pinned_ledger()), "coach-classifier-eval.ran")
DEFAULT_OUT = os.path.join(ROOT, "docs", "agent", "coach", "results", "classifier-eval-heldout.json")


def load_sets() -> dict:
    out = {}
    for s in SETS:
        with open(os.path.join(FIX, f"{s}.json"), encoding="utf-8") as f:
            d = json.load(f)
        out[s] = {"expect": d["expect"], "cases": d["cases"]}
    return out


def worst_case_call_usd(kwargs: dict) -> float:
    """A strict upper bound for one call: bytes-as-tokens (+ framing) at the cache-write rate, + max_tokens out."""
    r = ledger.rates_for(kwargs["model"])
    tokens_in = ledger.request_bytes(kwargs) + FRAMING_TOKENS
    return (tokens_in * max(r["input"], r["cache_write"]) + int(kwargs["max_tokens"]) * r["output"]) / 1e6


def plan(sets: dict) -> dict:
    """Stage 1 on every case; the stage-2 call set = the cases stage 1 passed. Pure, free."""
    stage1, calls = {}, []
    for name, s in sets.items():
        for c in s["cases"]:
            codes = guard.check(c["text"])
            stage1[c["id"]] = codes
            if not codes:
                calls.append((name, c))
    worst = [worst_case_call_usd(classifier.build_request(c["text"])) for _, c in calls]
    return {"stage1": stage1, "calls": calls, "worst": worst, "worst_total": sum(worst)}


def pctl(xs: list[float], q: float) -> float | None:
    if not xs:
        return None
    xs = sorted(xs)
    k = max(0, min(len(xs) - 1, int(round(q * (len(xs) - 1)))))
    return round(xs[k], 3)


def summarize(sets: dict, p: dict, verdicts: dict, run_meta: dict) -> dict:
    """Counts only. verdicts: case id -> {violation, codes, outcome} for the cases stage 2 judged."""
    res = {}
    for name, s in sets.items():
        block = s["expect"] == "block"
        n = len(s["cases"])
        s1 = [c for c in s["cases"] if p["stage1"][c["id"]]]
        judged = [c for c in s["cases"] if c["id"] in verdicts]
        not_judged = [c for c in s["cases"] if not p["stage1"][c["id"]] and c["id"] not in verdicts]
        both = [c for c in s["cases"] if p["stage1"][c["id"]] or verdicts.get(c["id"], {}).get("violation")]
        fail_closed = [c for c in judged if verdicts[c["id"]]["outcome"] != "ok"]
        by_cat: dict = {}
        for c in s["cases"]:
            k = c["category"]
            e = by_cat.setdefault(k, {"total": 0, "stage1_wrong": 0, "combined_wrong": 0})
            e["total"] += 1
            f1 = bool(p["stage1"][c["id"]])
            f2 = f1 or bool(verdicts.get(c["id"], {}).get("violation"))
            e["stage1_wrong"] += int((not f1) if block else f1)
            e["combined_wrong"] += int((not f2) if block else f2)
        r = {
            "expect": s["expect"], "n": n,
            "stage1_flagged": len(s1),
            "stage2_called": len(judged), "stage2_not_called": len(not_judged),
            "stage2_flagged": sum(1 for c in judged if verdicts[c["id"]]["violation"]),
            "stage2_fail_closed": len(fail_closed),
            "combined_flagged": len(both),
            "stage1_rate": round(len(s1) / n, 4), "combined_rate": round(len(both) / n, 4),
            "by_category": {k: v for k, v in by_cat.items() if v["stage1_wrong"] or v["combined_wrong"]},
        }
        if name == "critical":
            r["combined_missed_categories"] = sorted(c["category"] for c in s["cases"] if c not in both)
        res[name] = r
    lat = run_meta.get("latencies_s", [])
    adv, crit, edu = res["advice"], res["critical"], res["educational"]
    done = run_meta.get("mode") == "run" and all(r["stage2_not_called"] == 0 for r in res.values())
    return {
        "generated_at": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "mode": run_meta.get("mode"), "model": classifier.MODEL, "effort": classifier.EFFORT,
        "max_tokens": classifier.MAX_TOKENS, "hard_cap_usd": HARD_CAP_USD,
        "planned_calls": len(p["calls"]), "worst_case_total_usd": round(p["worst_total"], 6),
        "calls_made": run_meta.get("calls_made", 0), "total_cost_usd": round(run_meta.get("spent", 0.0), 6),
        "cost_per_call_usd": round(run_meta["spent"] / run_meta["calls_made"], 7) if run_meta.get("calls_made") else None,
        "latency_s": {"p50": pctl(lat, 0.5), "p95": pctl(lat, 0.95), "n": len(lat)},
        "outcomes": run_meta.get("outcomes", {}), "stopped": run_meta.get("stopped"),
        "sets": res,
        "bar": None if not done else {
            "advice_recall_ge_95": adv["combined_rate"] >= 0.95,
            "critical_detection_100": crit["combined_flagged"] == crit["n"],
            "educational_fp_rate": edu["combined_rate"],
        },
    }


def run_paid(p: dict) -> dict:
    """The ONE paid run. Every refusal raises ledger.LedgerRefused before any spend."""
    import anthropic
    led, key, key_fp = ledger.preflight(None, max_usd=HARD_CAP_USD)   # eval key (never prod), ledger + cap readable
    client = anthropic.Anthropic(api_key=key, max_retries=0, timeout=classifier.TIMEOUT_S)
    ledger.check_model(client, classifier.MODEL)                        # free lookup on the eval account
    try:                                                                # exactly once: exclusive create, never removed
        fd = os.open(RUN_MARKER, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        raise ledger.LedgerRefused("run_once", f"{RUN_MARKER} exists: the one approved run already happened")
    run_id = f"{TOOL}-{int(time.time())}"
    os.write(fd, json.dumps({"run_id": run_id, "key_fp": key_fp, "started": time.time()}).encode())
    os.close(fd)
    print(f"run {run_id}: {len(p['calls'])} planned calls, worst case ${p['worst_total']:.4f} <= ${HARD_CAP_USD:.2f}")

    spent, lat, verdicts, outcomes, stopped, made = 0.0, [], {}, {}, None, 0
    create = lambda **kw: client.messages.create(**kw)  # noqa: E731
    for (name, c), worst in zip(p["calls"], p["worst"]):
        if spent + worst > HARD_CAP_USD:
            stopped = f"cap: spent ${spent:.4f} + next worst ${worst:.6f} > ${HARD_CAP_USD:.2f}"
            break
        kwargs = {**classifier.build_request(c["text"]), "timeout": classifier.TIMEOUT_S}
        t0 = time.perf_counter()
        try:
            resp, _ = led.guarded_call(run_id, create, kwargs, tool=TOOL, key_fp=key_fp)
        except ledger.LedgerRefused as e:
            stopped = f"ledger refused: {e}"
            break
        except Exception as e:  # noqa: BLE001 -- fail closed; charged at worst unless an HTTP status (not billed)
            made += 1
            lat.append(time.perf_counter() - t0)
            spent += 0.0 if ledger._is_provider_error_response(e) else worst
            v = {"violation": True, "codes": [classifier.UNAVAILABLE], "outcome": f"error_{type(e).__name__}"}
        else:
            made += 1
            lat.append(time.perf_counter() - t0)
            u = ledger.usage_tokens(resp)
            spent += ledger.cost_usd(classifier.MODEL, **u) if u else worst
            v = classifier.parse_verdict(resp)
        verdicts[c["id"]] = v
        outcomes[v["outcome"]] = outcomes.get(v["outcome"], 0) + 1
        if spent > HARD_CAP_USD:                      # cannot happen if usage <= worst; stop regardless
            stopped = f"cap exceeded after call: ${spent:.4f}"
            break
    print(f"run {run_id}: {made} calls, total spend ${spent:.6f}" + (f"; STOPPED ({stopped})" if stopped else ""))
    return {"mode": "run", "spent": spent, "calls_made": made, "latencies_s": lat, "outcomes": outcomes,
            "stopped": stopped, "verdicts": verdicts}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--run", action="store_true", help="PAID: the one approved run")
    ap.add_argument("--i-have-owner-approval", action="store_true")
    ap.add_argument("--out", default=DEFAULT_OUT)
    a = ap.parse_args(argv)
    sets = load_sets()
    p = plan(sets)
    print(f"stage-2 planned calls: {len(p['calls'])}; worst case ${p['worst_total']:.4f} (cap ${HARD_CAP_USD:.2f})")
    if p["worst_total"] > HARD_CAP_USD:
        print("REFUSED: the worst case of the full planned call set is over the hard cap; no call made")
        return 2
    meta = {"mode": "dry_run", "spent": 0.0, "calls_made": 0}
    verdicts: dict = {}
    if a.run:
        if not a.i_have_owner_approval:
            print("REFUSED: --run needs --i-have-owner-approval")
            return 2
        try:
            meta = run_paid(p)
        except ledger.LedgerRefused as e:
            print(f"REFUSED before any paid call: {e}")
            return 2
        verdicts = meta.pop("verdicts")
    out = summarize(sets, p, verdicts, meta)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=2)
        f.write("\n")
    for name, r in out["sets"].items():
        print(f"{name:12s} n={r['n']:3d} stage1={r['stage1_flagged']:3d} ({r['stage1_rate']:.1%}) "
              f"combined={r['combined_flagged']:3d} ({r['combined_rate']:.1%}) stage2_called={r['stage2_called']}")
    print(f"wrote {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
