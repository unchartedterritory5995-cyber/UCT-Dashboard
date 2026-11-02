"""SAT-1 section B (owner: agent-sc): the discovery corpus through the REAL planner, as one command.

    # what a run WOULD do and cost: no model, no network, no key, no data dir
    python -m api.services.uct_agent.scan.sat.section_b
    # a real, metered run -- ONLY with an owner-approved DEVELOPMENT credential (SAT-1 instructions §B)
    python -m api.services.uct_agent.scan.sat.section_b --run --i-have-owner-approval \
        --data-dir C:\\data-sat1 --max-usd 1.00 --out <dir>

WHAT IS REPLAYED. Not a Python re-derivation of the browser: the exact /api/agent/turn body the real panel sends for
each question (routing, context, manifest), captured by app/src/agent/agentScanSat1Requests.test.jsx into
section_b_requests.json, and passed to `turn.run_turn` the way api/routers/uct_agent.py does. When the model asks for
the screener group (`need_groups`), the browser's ONE reroute of the same request is replayed from the same capture;
a reroute to any other group was not captured and is reported as such, never improvised.

SPEND. A real run is metered by `budget.Meter` exactly like the /turn route: every call reserves its worst case
against the Agent's $5/ET-day ledger and is refused while the shared $15 ledger is spent (READ-ONLY there, by the
owner's Gate A option 1: Agent spend is never written into the shared ledger), with the 2-call ceiling per question.
On top of that, `--max-usd` (default $1.00) caps THIS run: a question starts only if what the run has spent plus the
question's worst case (both calls, when it may reroute) fits. Prices: `budget.worst_case_usd` /
`narrative_cost_guard._PRICES` (published rates, pinned by tests/test_narrative_cost_guard_prices.py) for the
configured model, `turn.model()` (UCT_AGENT_MODEL). No network lookup.

EVIDENCE FIRST (R-RAW). Every question's raw record (request, envelope, usage, dollars, calls) is appended to
<out>/raw.jsonl as it completes, BEFORE any summary is computed; the summary goes to <out>/summary.json last. The
planner's screener ops are turned into a candidate in the screener's own spec language so agent-qa's scorer
(tests/test_uct_agent_qa_scan_corpus.py) can grade the recorded run offline, with no further paid call.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Callable

HERE = Path(__file__).resolve().parent
REQUESTS = HERE / "section_b_requests.json"
CORPUS = HERE.parent / "eval" / "discovery.json"
LEDGER_USER = "sat1-section-b"
DEFAULT_MAX_USD = 1.00
#: dry-run ESTIMATE only (the bound is exact; this is not): ~4 UTF-8 bytes per input token, and a typical
#: envelope's output. Labelled as an estimate everywhere it is printed.
EST_BYTES_PER_TOKEN = 4
EST_OUTPUT_TOKENS = 500


class _Captured(Exception):
    """Raised by the dry-run caller: the request was built, nothing was sent."""

    def __init__(self, kwargs: dict):
        super().__init__("captured")
        self.kwargs = kwargs


def load_requests(path: Path = REQUESTS) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def load_corpus(path: Path = CORPUS) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def body_args(body: dict, manifests: dict) -> dict:
    """The /turn body -> run_turn's keyword arguments, as api/routers/uct_agent.py maps them (history is empty: each
    question is a fresh conversation, and a reroute's repeated member message is dropped by the router too)."""
    return {"message": body["message"], "context": body.get("context") or {}, "history": [],
            "capabilities": manifests[body["capabilities_ref"]], "pending": body.get("pending"),
            "recent_outcome": body.get("recentOutcome"), "manifest_version": body.get("manifestVersion"),
            "routing": body.get("routing"), "conversation_title": None, "reroute": bool(body.get("reroute")),
            "interpreter": body.get("interpreter"), "repair": body.get("repair"), "reference": body.get("reference")}


# ── dry run: the exact requests, priced ─────────────────────────────────────────────────────────────
def capture_kwargs(args: dict) -> dict:
    """Build the Messages request run_turn would send, without sending it."""
    from api.services.uct_agent import turn

    def caller(**kwargs):
        raise _Captured(kwargs)
    try:
        turn.run_turn(**args, caller=caller, meter=None)
    except _Captured as c:
        return c.kwargs
    raise RuntimeError("run_turn returned without calling the model")      # cannot happen for a planner request


def price_request(kwargs: dict) -> dict:
    from api.services.uct_agent import budget
    nbytes = budget.request_bytes(kwargs)
    model = str(kwargs.get("model") or "")
    return {"model": model, "request_bytes": nbytes,
            "worst_usd": round(budget.worst_case_usd(kwargs), 6),
            "estimate_usd": round(budget._price(model, input=nbytes // EST_BYTES_PER_TOKEN, output=EST_OUTPUT_TOKENS), 6)}


def plan(requests: dict, ids: list[str] | None = None) -> dict:
    manifests = requests["manifests"]
    rows, worst, est = [], 0.0, 0.0
    for qid, body in requests["requests"].items():
        if ids and qid not in ids:
            continue
        if body is None:
            rows.append({"id": qid, "planner": False})
            continue
        first = price_request(capture_kwargs(body_args(body, manifests)))
        row = {"id": qid, "message": body["message"], "planner": True, "groups": (body.get("routing") or {}).get("selected"),
               "first": first, "worst_usd": first["worst_usd"], "estimate_usd": first["estimate_usd"]}
        if body.get("reroute_on"):
            second = price_request(capture_kwargs(body_args(body["reroute_on"]["body"], manifests)))
            row["reroute"] = second
            row["worst_usd"] = round(first["worst_usd"] + second["worst_usd"], 6)
        rows.append(row)
        worst += row["worst_usd"]
        est += row["estimate_usd"]
    model = next((r["first"]["model"] for r in rows if r.get("planner")), None)
    return {"model": model, "questions": rows, "planner_questions": sum(1 for r in rows if r.get("planner")),
            "may_reroute": sum(1 for r in rows if r.get("reroute")),
            "worst_usd": round(worst, 6), "estimate_usd": round(est, 6)}


# ── candidates: the planner's screener ops in the screener's own spec language ──────────────────────
def _leaf(f: dict) -> dict | None:
    key, op = f.get("field"), f.get("op")
    if not key or not op:
        return None
    if op in ("gt", "gte"):
        return {"key": key, "op": op, "min": f.get("value")}
    if op in ("lt", "lte"):
        return {"key": key, "op": op, "max": f.get("value")}
    if op == "between":
        return {"key": key, "op": "between", "min": f.get("value"), "max": f.get("max")}
    if op == "eq":
        return {"key": key, "op": "eq", "value": f.get("value")}
    if op in ("in", "not_in"):
        # ⚠️ the member's OWN words (the browser resolves them to the Screener's values at run time): recorded as
        # written, so "chips" stays "chips" — the scorer decides what that is worth
        return {"key": key, "op": op, "values": list(f.get("values") or [])}
    return {"key": key, "op": op}


def _op_args(op: dict) -> dict:
    if isinstance(op.get("args"), dict):
        return op["args"]
    try:
        return json.loads(op.get("args_json") or "{}")
    except (TypeError, ValueError):
        return {}


def candidate(envelope: dict | None) -> dict:
    """{refused, why} or {refused: False, logic, sort, action}. The FIRST screener op decides (one scan per turn)."""
    env = envelope or {}
    ops = [o for o in env.get("ops") or [] if isinstance(o, dict)]
    run = next((o for o in ops if o.get("action") == "screener.run"), None)
    if run is not None:
        a = _op_args(run)
        leaves = [x for x in (_leaf(f) for f in a.get("filters") or [] if isinstance(f, dict)) if x]
        sort = {"key": a["sort_field"], "dir": a.get("sort_dir") or "desc"} if a.get("sort_field") else None
        logic = (leaves[0] if len(leaves) == 1 else {"all": leaves}) if leaves else None
        return {"refused": False, "action": "screener.run", "logic": logic, "sort": sort, "planner_args": a}
    if any(o.get("action") == "screener.runSaved" for o in ops):
        return {"refused": False, "action": "screener.runSaved", "logic": None, "why": "ran a saved screen"}
    disp = env.get("disposition")
    q = env.get("question")
    why = str(env.get("reply") or (q.get("text") if isinstance(q, dict) else q) or "")[:200]
    return {"refused": True, "disposition": disp, "why": f"{disp}: {why}" if why else str(disp)}


# ── the real run ────────────────────────────────────────────────────────────────────────────────────
def _guard_run(ns) -> str:
    from api.services.uct_agent.scan.sat import seed
    if not ns.i_have_owner_approval:
        seed._refuse("--run needs --i-have-owner-approval: SAT-1 §B runs only with an owner-approved development "
                     "credential (relayed by agent-lead)")
    if not (os.environ.get("ANTHROPIC_API_KEY") or "").strip():
        seed._refuse("no ANTHROPIC_API_KEY in this shell; set the APPROVED development credential yourself — this "
                     "tool never reads, stores or prints one")
    data_dir = seed.check_data_dir(ns.data_dir)     # refuses Railway, the shared root, drive roots, missing dirs
    seed.pin(data_dir)                              # every census path into the sandbox; arms the tripwire
    if not (0 < ns.max_usd <= 5.0):
        seed._refuse("--max-usd must be above 0 and at most the Agent's $5 day")
    return data_dir


def run(requests: dict, ids: list[str] | None, max_usd: float, out: Path,
        caller: Callable[..., Any] | None = None, site_reader=None, clock=time.time) -> dict:
    """Metered replay. `caller`/`site_reader` are seams for tests (no model); left None they are the real ones."""
    from api.services.uct_agent import budget, turn
    manifests = requests["manifests"]
    out.mkdir(parents=True, exist_ok=True)
    raw = out / "raw.jsonl"
    raw.write_text("", encoding="utf-8")                 # claimed before any call: a dead run leaves an empty file,
    (out / "summary.json").write_text(json.dumps({"status": "INCOMPLETE (session did not finish)"}) + "\n",
                                      encoding="utf-8")  # never an older run's summary
    spent, results, stopped = 0.0, {}, None
    for qid, body in requests["requests"].items():
        if ids and qid not in ids:
            continue
        rec: dict = {"id": qid, "started_at": int(clock())}
        if body is None:
            rec.update(outcome="not_planner", candidate=None)
        else:
            # this question's bound: both calls when the browser may reroute it
            bound = price_request(capture_kwargs(body_args(body, manifests)))["worst_usd"]
            if body.get("reroute_on"):
                bound += price_request(capture_kwargs(body_args(body["reroute_on"]["body"], manifests)))["worst_usd"]
            if spent + bound > max_usd:
                stopped = f"--max-usd {max_usd:.2f}: {qid} could cost up to ${bound:.4f} with ${spent:.4f} spent"
                break
            rid = budget.open_request(LEDGER_USER, None, body["message"])
            meter = budget.Meter(user_id=LEDGER_USER, request_id=rid, site_reader=site_reader)
            calls: list[dict] = []
            try:
                o1 = turn.run_turn(**body_args(body, manifests), caller=caller, meter=meter)
                calls.append({"call": "first", "envelope": o1.get("envelope"), "usage": o1.get("usage")})
                env = o1.get("envelope") or {}
                need = [g for g in env.get("need_groups") or [] if g not in ((body.get("routing") or {}).get("selected") or [])]
                if need:
                    ro = body.get("reroute_on")
                    if ro and set(need) <= set(ro["need_groups"]):
                        o2 = turn.run_turn(**body_args(ro["body"], manifests), caller=caller, meter=meter)
                        calls.append({"call": "reroute", "need_groups": need, "envelope": o2.get("envelope"), "usage": o2.get("usage")})
                        env = o2.get("envelope") or {}
                    else:
                        rec["reroute_not_captured"] = need
                rec.update(outcome="ok", candidate=candidate(env))
            except budget.BudgetRefused as e:
                rec.update(outcome=f"budget_refused:{e.reason}", sentence=e.sentence, candidate=None)
                stopped = stopped or f"ledger refused ({e.reason})"
            except turn.TurnError as e:
                rec.update(outcome="turn_error", sentence=str(e), candidate={"refused": True, "why": f"turn_error: {e}"})
            rec["calls"] = calls
            rec["model_calls"] = budget.calls_used(rid) if rid is not None else None
            rec["spent_usd"] = round(meter.spent_usd, 6)
            spent += meter.spent_usd
        rec["finished_at"] = int(clock())
        with open(raw, "a", encoding="utf-8") as fh:              # R-RAW: written as it happens
            fh.write(json.dumps(rec, ensure_ascii=False, default=str) + "\n")
        results[qid] = rec
        if stopped and rec.get("outcome", "").startswith("budget_refused"):
            break
    summary = {"status": "STOPPED" if stopped else "COMPLETE", "stopped_because": stopped,
               "questions_run": len(results), "spent_usd": round(spent, 6), "max_usd": max_usd,
               "model_calls": sum(r.get("model_calls") or 0 for r in results.values()),
               "ledger_after": _ledger_view(budget)}
    (out / "summary.json").write_text(json.dumps(summary, indent=1) + "\n", encoding="utf-8")
    return summary


def _ledger_view(budget) -> dict:
    try:
        s = budget.state()
        return {"agent_committed_usd": s["committed_usd"], "agent_cap_usd": s["cap_usd"], "site": s.get("site")}
    except Exception as e:  # noqa: BLE001 -- a report, not a gate (the gate is reserve())
        return {"unreadable": str(e)[:120]}


# ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────
def _print_plan(p: dict, max_usd: float) -> None:
    print(f"SAT-1 section B -- DRY RUN (nothing sent). Model: {p['model']} (UCT_AGENT_MODEL).")
    print(f"Prices: narrative_cost_guard._PRICES, published rates pinned by tests/test_narrative_cost_guard_prices.py.")
    for r in p["questions"]:
        if not r.get("planner"):
            print(f"  {r['id']}  not sent to the planner (answered in the browser)")
            continue
        rr = f" + reroute ${r['reroute']['worst_usd']:.4f}" if r.get("reroute") else ""
        print(f"  {r['id']}  groups={','.join(r['groups'] or [])}  bound ${r['first']['worst_usd']:.4f}{rr}"
              f"  (est ${r['estimate_usd']:.4f})  {r['message']}")
    print(f"Questions to the planner: {p['planner_questions']}; may reroute for the screener group: {p['may_reroute']}.")
    print(f"Worst case (exact upper bound, every call): ${p['worst_usd']:.4f}.  "
          f"Estimate (~{EST_BYTES_PER_TOKEN} bytes/token, {EST_OUTPUT_TOKENS} output tokens, first calls only): ${p['estimate_usd']:.4f}.")
    print(f"This run's cap (--max-usd): ${max_usd:.2f}; the Agent's $5/day and the shared $15 ledger also apply.")
    print("A real run needs --run --i-have-owner-approval --data-dir <sandbox> and an APPROVED development credential.")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--run", action="store_true", help="make the metered model calls (default: dry run)")
    ap.add_argument("--i-have-owner-approval", action="store_true")
    ap.add_argument("--data-dir", default="")
    ap.add_argument("--max-usd", type=float, default=DEFAULT_MAX_USD)
    ap.add_argument("--only", default="", help="comma-separated question ids")
    ap.add_argument("--out", default="")
    ap.add_argument("--json", action="store_true", help="dry run: print the plan as JSON")
    ns = ap.parse_args(argv)
    ids = [s.strip() for s in ns.only.split(",") if s.strip()] or None
    requests = load_requests()
    if requests.get("corpus_version") != load_corpus().get("version"):
        print("REFUSED: section_b_requests.json was captured from another corpus version; recapture it", file=sys.stderr)
        return 2
    if not ns.run:
        p = plan(requests, ids)
        print(json.dumps(p, indent=1)) if ns.json else _print_plan(p, ns.max_usd)
        return 0
    _guard_run(ns)
    out = Path(ns.out) if ns.out else Path(ns.data_dir) / f"sat1-b-{time.strftime('%Y%m%dT%H%M%S')}"
    summary = run(requests, ids, ns.max_usd, out)
    print(json.dumps(summary, indent=1))
    print(f"raw records: {out / 'raw.jsonl'}")
    return 0 if summary["status"] == "COMPLETE" else 1


if __name__ == "__main__":
    raise SystemExit(main())
