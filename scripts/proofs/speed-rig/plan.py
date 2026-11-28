"""The speed rig's SWEEP PLAN: which passes run, with which never-used tickers, in which parallel lanes.

THE PASSES are the owner-PC coverage passes (C:/uct-runs/rth-20261130/bin/coverage_passes.sh, 2026-11-27: "every
chart, every timeframe, every switch, any zoom or date: the full correct chart in one paint ... fully zoomed out,
every stocks, test using different ones each time to make sure they are cold"), one entry per pass, verbatim:
  (a) arrows over a fresh 13-ticker list and (b) 6 cold typed Enters, on every board (TEST D+D, TC2000 5m, 1m+15m,
      5m+1h, D+30m, 4h+2h, W+M), each at the DEFAULT zoom and FULLY ZOOMED OUT
  (c) board tabs TEST <-> TC2000, 20 switches, keep-alive as production has it (default and zoomed out)
  (d) typed D and W zoomed out to 2014 on a single chart
  (e) a past date (1/3/2006) through the Time Navigator on D and 15m, arrows and typed
  (f) memory after 50 arrows over a fresh 51-ticker list
41 passes, 443 tickers (37 + the 4 timeframe-change passes, lane C). Every pass gets its OWN tickers from the shared ledger (ledger.py), recorded there BEFORE
the sweep starts: no ticker is shared between two passes, two sweeps, or a sweep and any earlier PC run.

LANES. isolate=browser (default): one pass per lane, every lane in parallel on the ONE bench account (each pass's
board state lives in its own browser; rig.mjs header). isolate=account: N lanes for N bench accounts, a lane's passes
one after another (two passes on one account's real board collide).

    python scripts/proofs/speed-rig/plan.py --sweep-id <id> --out <dir> [--select REGEX] [--isolate browser|account]
        [--accounts N] [--max-parallel M] [--dry] [--limit K] [--ledger-file F] [--reuse-after-days D]
    python scripts/proofs/speed-rig/plan.py --self-check
Writes <out>/plan.json and <out>/matrix.json, and (in Actions) the step outputs matrix / max_parallel / passes.
--dry allocates from the ledger but never writes it (the pull-request dry run). Exit 0 ok, 1 refused, 2 git.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ledger as L  # noqa: E402

BOARDS_DIR = "scripts/proofs/speed-rig/boards"
#: the PC driver's common flags (owner_cov.sh `C=`), unchanged; the cloud adds --isolate and the planned tickers
COMMON = ["--port=9466", "--headless=1", "--light-sampler=1", "--pixels=1", "--console=rprobe", "--warmup=30000",
          "--set=base", "--drop-user=1", "--list=SmallCap 600"]
J = ["--jump-probe=2000", "--db-stats=1"]
FC = ["--focus-check=1", "--human-type=1"]
BOARDS = [("dd", "test-board"), ("tc", "tc2000-sw-board"), ("m1", "one-fifteen-board"), ("m5h1", "m5h1-board"),
          ("d30", "d30-board"), ("h4h2", "h4h2-board"), ("wm", "wm-board")]
#: a pass's wall time on the PC (2026-11-28 coverage run: ~85-95 s a switching pass, ~150 s the tab pass), for lanes
SECONDS = {"arrows": 90, "typed": 92, "tabs": 155, "zoom": 100, "date": 95, "mem": 175, "tf": 200}


def passes() -> list[dict]:
    out = []

    def add(name, args, lst, typed, kind, board=None, zoom="def"):
        out.append({"name": name, "args": args, "list": lst, "typed": typed, "kind": kind, "board": board, "zoom": zoom})
    for zk, za in (("def", []), ("zo", ["--zoom-out-max=1"])):
        for k, f in BOARDS:
            b = f"--board={BOARDS_DIR}/{f}.json"
            add(f"COV-{zk}-{k}-arrows", [b, "--pattern=down", "--flips=12", "--dwell=1000", *za, *J], 13, 0, "arrows", k, zk)
            add(f"COV-{zk}-{k}-typed", [b, "--pattern=typed", "--dwell=2500", *za, *J, *FC], 3, 6, "typed", k, zk)
        add(f"COV-{zk}-tabs", [f"--board={BOARDS_DIR}/test-board.json", f"--tab-b={BOARDS_DIR}/tc2000-board.json", "--tab-b-ids=own",
                               "--pattern=tabs", "--flips=20", "--dwell=2500", "--stale-check=1", "--tab-diag=1", "--mem-probe=1", *za, *J],
            3, 0, "tabs", "tabs", zk)
    add("COV-zoom-D", ["--tf=D", "--pattern=typed", "--dwell=2500", "--zoom-out-to=2014-01-02", *J, *FC, "--screencast=0,1,2"], 3, 6, "zoom", "zoom-D", "zoom")
    add("COV-zoom-W", ["--tf=W", "--pattern=typed", "--dwell=2500", "--zoom-out-to=2014-01-02", *J, *FC], 3, 6, "zoom", "zoom-W", "zoom")
    for tf in ("D", "15"):
        add(f"COV-date-{tf}-arrows", [f"--tf={tf}", "--pattern=down", "--flips=12", "--dwell=1000", "--go-to-date=1/3/2006", *J], 13, 0, "date", f"date-{tf}", "date")
        add(f"COV-date-{tf}-typed", [f"--tf={tf}", "--pattern=typed", "--dwell=2500", "--go-to-date=1/3/2006", *J, *FC], 3, 6, "date", f"date-{tf}", "date")
    # (lane C, 2026-11-28, goal A4) TIMEFRAME CHANGES: on 3 fresh rows in turn, every toolbar timeframe (1, 5, 15, 30, custom 45m,
    # 1h, custom 2h, custom 4h, D, W, M; a code the bar shed is pressed in its More timeframes menu), key = the click;
    # default, zoomed out, at a past date, and with NO list linked (the list on group B, each ticker typed in)
    for name, extra in (("def", []), ("zo", ["--zoom-out-max=1"]), ("date", ["--go-to-date=6/14/2016"]), ("nolist", ["--tf-nolist=1"])):
        add(f"COV-tf-{name}", ["--tf=D", "--pattern=tf", "--tf-syms=3", "--dwell=2500", *extra, *J], 4, 0, "tf", f"tf-{name}", "date" if name == "date" else ("zo" if name == "zo" else "def"))
    add("COV-MEM50", [f"--board={BOARDS_DIR}/one-fifteen-board.json", "--pattern=down", "--flips=50", "--dwell=1000", "--mem-probe=1", *J], 51, 0, "mem", "m1", "mem")
    return out


def allocate(sel: list[dict], led: dict, sweep: str, reuse_after_days=None) -> tuple[dict, dict]:
    """(tickers per pass, the ledger with this sweep's runs appended). Seeded by the sweep id, so a re-plan of the
    same sweep against the same ledger draws the same names; refuses rather than reuse a ticker."""
    taken = L.used(led, reuse_after_days)
    pool = [t.upper() for t in (led.get("pool") or {}).get("tickers", [])]
    free = [t for t in dict.fromkeys(pool) if t not in taken]
    need = sum(p["list"] + p["typed"] for p in sel)
    if len(free) < need:
        raise SystemExit(f"REFUSED: only {len(free)} never-used tickers left in a {len(pool)}-ticker pool for {need}: rebuild the pool "
                         "from a fresh quote read, or (owner decision) retire old runs with --reuse-after-days")
    rnd = random.Random(f"speed-rig:{sweep}")
    rnd.shuffle(free)
    picks, k = {}, 0
    at = L.now()
    for p in sel:
        lst, typed = free[k:k + p["list"]], free[k + p["list"]:k + p["list"] + p["typed"]]
        k += p["list"] + p["typed"]
        picks[p["name"]] = {"list": lst, "typed": typed}
        led.setdefault("runs", []).append({"id": f"cloud/{sweep}/{p['name']}", "at": at, "source": "cloud", "tickers": lst + typed})
    return picks, led


def lanes(sel: list[dict], isolate: str, accounts: int) -> list[dict]:
    if isolate == "browser":
        return [{"lane": f"L{i + 1:02d}", "slot": 1, "passes": [p["name"]]} for i, p in enumerate(sel)]
    n = max(1, accounts)
    acc = [{"lane": f"A{j + 1}", "slot": j + 1, "passes": [], "s": 0} for j in range(n)]
    for p in sorted(sel, key=lambda p: -SECONDS[p["kind"]]):   # longest first onto the least loaded account
        lane = min(acc, key=lambda a: a["s"])
        lane["passes"].append(p["name"])
        lane["s"] += SECONDS[p["kind"]]
    return [{k: v for k, v in a.items() if k != "s"} for a in acc if a["passes"]]


def build(args, led: dict) -> tuple[dict, dict]:
    allp = passes()
    sel = [p for p in allp if re.search(args.select, p["name"])]
    if args.limit:
        sel = sel[:args.limit]
    if not sel:
        raise SystemExit(f"REFUSED: --select {args.select!r} matches no pass")
    picks, led = allocate(sel, led, args.sweep_id, args.reuse_after_days)
    plan = {"sweep": args.sweep_id, "created": L.now(), "isolate": args.isolate, "dry": bool(args.dry), "common": COMMON,
            "passes": {}, "lanes": lanes(sel, args.isolate, args.accounts)}
    for p in sel:
        pk = picks[p["name"]]
        extra = [f"--isolate={args.isolate}", f"--run-id=cloud/{args.sweep_id}/{p['name']}"]
        if pk["list"]:
            extra.append("--fresh-list=" + ",".join(pk["list"]))
        if pk["typed"]:
            extra.append("--typed=" + ",".join(pk["typed"]))
        if p["kind"] == "tabs":
            extra.append(f"--tab-suffix={re.sub(r'[^0-9A-Za-z]', '', args.sweep_id)[-10:]}{p['zoom']}")
        if args.dry:
            extra = ["--dry=1"]
        plan["passes"][p["name"]] = {"args": [*COMMON, *p["args"], *extra], "kind": p["kind"], "board": p["board"], "zoom": p["zoom"],
                                     "tickers": pk}
    cap = 1 if args.isolate == "account" else 12
    plan["maxParallel"] = max(1, min(args.max_parallel, cap * (args.accounts if args.isolate == "account" else 1), len(plan["lanes"])))
    return plan, led


def self_check() -> None:
    allp = passes()
    names = [p["name"] for p in allp]
    assert len(names) == 41 and len(set(names)) == 41, len(names)
    need = sum(p["list"] + p["typed"] for p in allp)
    assert need == 443, need
    led = L.empty()
    led["pool"]["tickers"] = [f"T{i:04d}" for i in range(1000)]
    led["runs"] = [{"id": "pc/x", "at": L.now(), "tickers": [f"T{i:04d}" for i in range(100)]}]

    class A:
        sweep_id, select, limit, isolate, accounts, max_parallel, dry, reuse_after_days = "s1", ".*", 0, "browser", 1, 8, False, None
    plan, led2 = build(A, json.loads(json.dumps(led)))
    got = [t for p in plan["passes"].values() for t in p["tickers"]["list"] + p["tickers"]["typed"]]
    assert len(got) == 443 and len(set(got)) == 443, "two passes share a ticker"
    assert not set(got) & {f"T{i:04d}" for i in range(100)}, "a ticker an earlier run used was handed out"
    assert len(led2["runs"]) == 1 + 41 and len(plan["lanes"]) == 41 and plan["maxParallel"] == 8
    # a second sweep on the updated ledger never meets the first
    A.sweep_id = "s2"
    plan2, _ = build(A, json.loads(json.dumps(led2)))
    got2 = {t for p in plan2["passes"].values() for t in p["tickers"]["list"] + p["tickers"]["typed"]}
    assert not got2 & set(got)
    # and a third has too few names left: refused, never reused
    A.sweep_id = "s3"
    led3 = json.loads(json.dumps(led2))
    led3["runs"].append({"id": "s2-all", "at": L.now(), "tickers": sorted(got2)})
    try:
        build(A, led3)
        raise AssertionError("an exhausted pool was not refused")
    except SystemExit as e:
        assert "REFUSED" in str(e)
    # account lanes: every pass once, spread over the accounts, one at a time per account
    A.sweep_id, A.isolate, A.accounts = "s4", "account", 3
    plan4, _ = build(A, json.loads(json.dumps(led)))
    flat = [n for ln in plan4["lanes"] for n in ln["passes"]]
    assert sorted(flat) == sorted(names) and len(plan4["lanes"]) == 3 and plan4["maxParallel"] == 3
    print("plan self-check: ok (41 passes, 443 tickers, no ticker shared, exhaustion refused)")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sweep-id")
    ap.add_argument("--out")
    ap.add_argument("--select", default=".*")
    ap.add_argument("--isolate", default="browser", choices=["browser", "account"])
    ap.add_argument("--accounts", type=int, default=1)
    ap.add_argument("--max-parallel", type=int, default=8)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--ledger-file", default=None, help="plan against a ledger FILE (offline; nothing is pushed)")
    ap.add_argument("--reuse-after-days", type=float, default=None, help="OWNER decision: tickers of runs older than this are free again")
    ap.add_argument("--git-dir", default=None)
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args()
    if a.self_check:
        L.self_check()
        self_check()
        return 0
    if not (a.sweep_id and a.out):
        ap.error("--sweep-id and --out are required")
    os.makedirs(a.out, exist_ok=True)
    try:
        if a.ledger_file or a.dry:
            led = json.load(open(a.ledger_file, encoding="utf-8")) if a.ledger_file else L.read(a.git_dir)[1]
            plan, _ = build(a, led)
            commit = None
        else:
            holder = {}

            def fn(led):
                plan, new = build(a, led)
                holder["plan"] = plan
                return new, plan
            commit, _, plan = L.update(fn, f"speed-rig ledger: sweep {a.sweep_id} ({a.select})", a.git_dir)
    except L.GitError as e:
        print(str(e), file=sys.stderr)
        return 2
    except L.Conflict as e:
        print(str(e), file=sys.stderr)
        return 1
    plan["ledgerCommit"] = commit
    json.dump(plan, open(os.path.join(a.out, "plan.json"), "w", encoding="utf-8"), indent=1)
    matrix = {"include": [{"lane": ln["lane"], "slot": ln["slot"], "title": ln["passes"][0] if len(ln["passes"]) == 1 else f"{len(ln['passes'])} passes"} for ln in plan["lanes"]]}
    json.dump(matrix, open(os.path.join(a.out, "matrix.json"), "w", encoding="utf-8"))
    n_t = sum(len(p["tickers"]["list"]) + len(p["tickers"]["typed"]) for p in plan["passes"].values())
    print(f"sweep {a.sweep_id}: {len(plan['passes'])} passes in {len(plan['lanes'])} lanes, {plan['maxParallel']} at a time; "
          f"{n_t} never-used tickers{' (dry: the ledger is not written)' if a.dry or a.ledger_file else f', recorded in {L.REF} at {str(commit)[:12]}'}")
    gh = os.environ.get("GITHUB_OUTPUT")
    if gh:
        with open(gh, "a", encoding="utf-8") as f:
            f.write(f"matrix={json.dumps(matrix)}\nmax_parallel={plan['maxParallel']}\npasses={len(plan['passes'])}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
