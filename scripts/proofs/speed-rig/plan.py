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
the sweep starts: no ticker is shared between two passes of a sweep, nor between two sweeps (or a sweep and a PC run)
inside the REUSE WINDOW (REUSE_AFTER_DAYS, 14 by default, 2026-11-28): never-used tickers are handed out first, then
names whose last run is older than the window. A reused name is cold on the CLIENT (every pass's browser profile is
fresh) but maybe not on the server, so each pass names its reused tickers (--reused, the ledger run's `reused`) and
grade.py grades them apart from the never-used ones.

LANES. isolate=browser (default): each pass's board state lives in its own browser (rig.mjs header), so passes on one
account never collide on its board, but they DO share its rate limit: production's api/rate_limit_policy.py (enforced)
keys a signed-in caller as `member:<user id>`, one bucket per family per member, and the bars family
("market-data") allows 1200 requests a minute. One pass's browser peaks at ~120-425 market-data requests in a minute
(sweep 46113707532: the MEM50 pass 425, the switching passes 155-360), so 8 browsers on one account (~2,000-2,800 a
minute) were answered 429 by the limiter and the grade counted the instrument as product failures. So at most
--per-account browsers (default 2: two peaks, ~850, under the 1200) run on one account at a time: browser lanes are
accounts x per-account, each lane runs its passes one after another, and lane j signs in as account j % accounts
(BENCH_EMAIL, BENCH_EMAIL_2, ...). More accounts = more lanes at once. isolate=account: N lanes for N bench accounts,
a lane's passes one after another (two passes on one account's real board collide).

    python scripts/proofs/speed-rig/plan.py --sweep-id <id> --out <dir> [--select REGEX] [--isolate browser|account]
        [--accounts N] [--per-account P] [--max-parallel M] [--dry] [--limit K] [--ledger-file F] [--reuse-after-days D]
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


#: (the lead, 2026-11-28) a ticker is eligible again this many days after its last run: every pass's browser profile is
#: fresh, so the CLIENT side (IndexedDB, the HTTP cache, the bars pack) is cold again; the server-side stores (the
#: origin's bars, the edge, R2) may still be warm, so a reused ticker is recorded per pass and graded apart (grade.py
#: "TICKERS reused"), and never-used names are always handed out first. --reuse-after-days -1 = never reuse.
REUSE_AFTER_DAYS = 14.0


def allocate(sel: list[dict], led: dict, sweep: str, reuse_after_days=REUSE_AFTER_DAYS) -> tuple[dict, dict]:
    """(tickers per pass, the ledger with this sweep's runs appended). Seeded by the sweep id, so a re-plan of the
    same sweep against the same ledger draws the same names. NEVER-USED tickers first; then (reuse_after_days not
    None) tickers whose every run is older than that; refuses rather than reuse a recent one. Each pass's pick names
    its reused tickers (`reused`), and so does its ledger run."""
    ever = L.used(led, None)
    recent = ever if reuse_after_days is None else L.used(led, reuse_after_days)
    pool = [t.upper() for t in dict.fromkeys((led.get("pool") or {}).get("tickers", []))]
    never = [t for t in pool if t not in ever]
    again = [t for t in pool if t in ever and t not in recent]
    need = sum(p["list"] + p["typed"] for p in sel)
    if len(never) + len(again) < need:
        raise SystemExit(f"REFUSED: {len(never)} never-used and {len(again)} reusable (last used over {reuse_after_days} days ago) tickers "
                         f"in a {len(pool)}-ticker pool, for {need}: rebuild the pool (ledger.py repool) or wait for the reuse window")
    rnd = random.Random(f"speed-rig:{sweep}")
    rnd.shuffle(never)
    rnd.shuffle(again)
    free = never + again
    picks, k = {}, 0
    at = L.now()
    for p in sel:
        lst, typed = free[k:k + p["list"]], free[k + p["list"]:k + p["list"] + p["typed"]]
        k += p["list"] + p["typed"]
        reused = [t for t in lst + typed if t in ever]
        picks[p["name"]] = {"list": lst, "typed": typed, "reused": reused}
        run = {"id": f"cloud/{sweep}/{p['name']}", "at": at, "source": "cloud", "tickers": lst + typed}
        if reused:
            run["reused"] = reused
        led.setdefault("runs", []).append(run)
    return picks, led


#: browsers one bench account carries at once under isolate=browser (see LANES above: two pass peaks stay under the
#: market-data family's 1200 a minute per member)
PER_ACCOUNT = 2


def lanes(sel: list[dict], isolate: str, accounts: int, per_account: int = PER_ACCOUNT) -> list[dict]:
    if isolate == "browser":
        n = max(1, min(len(sel), max(1, accounts) * max(1, per_account)))
        acc = [{"lane": f"L{j + 1:02d}", "slot": j % max(1, accounts) + 1, "passes": [], "s": 0} for j in range(n)]
    else:
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
    rad = getattr(args, "reuse_after_days", REUSE_AFTER_DAYS)
    picks, led = allocate(sel, led, args.sweep_id, None if rad is None or rad < 0 else rad)
    plan = {"sweep": args.sweep_id, "created": L.now(), "isolate": args.isolate, "dry": bool(args.dry), "common": COMMON,
            "passes": {}, "lanes": lanes(sel, args.isolate, args.accounts, getattr(args, "per_account", PER_ACCOUNT))}
    for p in sel:
        pk = picks[p["name"]]
        extra = [f"--isolate={args.isolate}", f"--run-id=cloud/{args.sweep_id}/{p['name']}"]
        if pk["list"]:
            extra.append("--fresh-list=" + ",".join(pk["list"]))
        if pk["typed"]:
            extra.append("--typed=" + ",".join(pk["typed"]))
        if pk.get("reused"):
            extra.append("--reused=" + ",".join(pk["reused"]))   # the rig records them; grade.py grades them apart
        if p["kind"] == "tabs":
            extra.append(f"--tab-suffix={re.sub(r'[^0-9A-Za-z]', '', args.sweep_id)[-10:]}{p['zoom']}")
        # --cpu-profile=i,j: a CPU profile of those switches (the rig's --cpuprofile: 1.5 s after a typed Enter or a tab
        # click, 700 ms after an arrow), written beside the record as <name>.flip<i>.cpuprofile and uploaded with it
        cp = getattr(args, "cpu_profile", "") or ""
        if cp:
            extra.append(f"--cpuprofile={cp}")
        if args.dry:
            extra = ["--dry=1"]
        plan["passes"][p["name"]] = {"args": [*COMMON, *p["args"], *extra], "kind": p["kind"], "board": p["board"], "zoom": p["zoom"],
                                     "tickers": pk}
    # every lane is bound to one account, and no account has more lanes than it may carry at once, so any number of
    # lanes at once keeps each account under its limit; 12 is the larger runner's ceiling
    plan["maxParallel"] = max(1, min(args.max_parallel, 12, len(plan["lanes"])))
    return plan, led


# at most this many profiled switches per pass: each profile is 1-4 MB (100 us samples for 1.5 s)
CPU_PROFILE_MAX = 6
CPU_PROFILE_RE = re.compile(r"\d{1,2}(,\d{1,2}){0," + str(CPU_PROFILE_MAX - 1) + r"}")


def self_check() -> None:
    # --cpu-profile: indices only, bounded; reaches each selected pass's rig arguments, and nothing when unset
    assert CPU_PROFILE_RE.fullmatch("3,4,5") and CPU_PROFILE_RE.fullmatch("0")
    for bad in ("", "3;rm -rf /", "1,2,3,4,5,6,7", "a", "3,", "--x"):
        assert not CPU_PROFILE_RE.fullmatch(bad), bad
    led0 = L.empty()
    led0["pool"]["tickers"] = [f"P{i:04d}" for i in range(1000)]

    class C:
        sweep_id, select, limit, isolate, accounts, max_parallel, dry, reuse_after_days, cpu_profile = "cp", "^COV-def-dd-typed$", 0, "browser", 1, 8, False, None, "3,4,5"
    pc, _ = build(C, json.loads(json.dumps(led0)))
    assert "--cpuprofile=3,4,5" in pc["passes"]["COV-def-dd-typed"]["args"], pc["passes"]
    C.cpu_profile, C.sweep_id = "", "cp2"
    pc2, _ = build(C, json.loads(json.dumps(led0)))
    assert not any(x.startswith("--cpuprofile") for x in pc2["passes"]["COV-def-dd-typed"]["args"])
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
    # browser lanes on ONE account: PER_ACCOUNT lanes, every pass once, never more lanes per account than it may carry
    flat1 = [n for ln in plan["lanes"] for n in ln["passes"]]
    assert len(led2["runs"]) == 1 + 41 and len(plan["lanes"]) == PER_ACCOUNT and plan["maxParallel"] == PER_ACCOUNT, plan["lanes"]
    assert sorted(flat1) == sorted(names) and {ln["slot"] for ln in plan["lanes"]} == {1}
    A.sweep_id, A.accounts = "s1b", 4
    planb, _ = build(A, json.loads(json.dumps(led)))
    per_slot = {}
    for ln in planb["lanes"]:
        per_slot[ln["slot"]] = per_slot.get(ln["slot"], 0) + 1
    assert len(planb["lanes"]) == 8 and planb["maxParallel"] == 8 and per_slot == {1: 2, 2: 2, 3: 2, 4: 2}, (per_slot, planb["maxParallel"])
    assert sorted(n for ln in planb["lanes"] for n in ln["passes"]) == sorted(names)
    A.accounts = 1
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
    # THE REUSE RULE: never-used names first; then names whose every run is older than the window, each pass naming
    # the ones it reuses (and its ledger run too); a name used inside the window is never handed out
    old = "2026-01-01T00:00:00+00:00"
    ledr = L.empty()
    ledr["pool"]["tickers"] = [f"R{i:04d}" for i in range(600)]
    ledr["runs"] = [{"id": "pc/old", "at": old, "tickers": [f"R{i:04d}" for i in range(0, 300)]},
                    {"id": "pc/recent", "at": L.now(), "tickers": [f"R{i:04d}" for i in range(300, 400)]},
                    {"id": "pc/both", "at": old, "tickers": ["R0350"]}]
    A.sweep_id, A.reuse_after_days = "r1", 14.0
    planr, ledr2 = build(A, json.loads(json.dumps(ledr)))
    allr = [t for p in planr["passes"].values() for t in p["tickers"]["list"] + p["tickers"]["typed"]]
    reused = [t for p in planr["passes"].values() for t in p["tickers"]["reused"]]
    nums = lambda ts: {int(t[1:]) for t in ts}  # noqa: E731
    assert len(allr) == 443 and len(set(allr)) == 443
    assert nums([t for t in allr if t not in reused]) == set(range(400, 600)), "the never-used names did not all go first"
    assert len(reused) == 243 and nums(reused) <= set(range(0, 300)), "a reused name was not an old one"
    assert not nums(allr) & set(range(300, 400)), "a name used inside the window was handed out"
    runs = {r["id"]: r for r in ledr2["runs"]}
    assert sum(len(r.get("reused", [])) for r in runs.values()) == 243
    for p in planr["passes"].values():
        if p["tickers"]["reused"]:
            assert any(a == "--reused=" + ",".join(p["tickers"]["reused"]) for a in p["args"]), "the rig is not told which names are reused"
    # with reuse off (-1 / None) the same ledger is refused
    A.sweep_id, A.reuse_after_days = "r2", None
    try:
        build(A, json.loads(json.dumps(ledr)))
        raise AssertionError("reuse off still reused")
    except SystemExit as e:
        assert "REFUSED" in str(e)
    A.reuse_after_days = None
    # account lanes: every pass once, spread over the accounts, one at a time per account
    A.sweep_id, A.isolate, A.accounts = "s4", "account", 3
    plan4, _ = build(A, json.loads(json.dumps(led)))
    flat = [n for ln in plan4["lanes"] for n in ln["passes"]]
    assert sorted(flat) == sorted(names) and len(plan4["lanes"]) == 3 and plan4["maxParallel"] == 3
    print("plan self-check: ok (41 passes, 443 tickers, no ticker shared, exhaustion refused, never-used first, reuse only past the window, at most 2 browsers per account)")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sweep-id")
    ap.add_argument("--out")
    ap.add_argument("--select", default=".*")
    ap.add_argument("--isolate", default="browser", choices=["browser", "account"])
    ap.add_argument("--accounts", type=int, default=1)
    ap.add_argument("--max-parallel", type=int, default=8)
    ap.add_argument("--per-account", type=int, default=PER_ACCOUNT, help="browser isolation: browsers one account carries at once")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--ledger-file", default=None, help="plan against a ledger FILE (offline; nothing is pushed)")
    ap.add_argument("--reuse-after-days", type=float, default=REUSE_AFTER_DAYS,
                    help="a ticker last used more than this many days ago is eligible again, after every never-used one (-1 = never)")
    ap.add_argument("--git-dir", default=None)
    ap.add_argument("--cpu-profile", default="", help="switch indices to CPU-profile in every selected pass (e.g. 3,4,5); empty = none")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args()
    if a.cpu_profile and not CPU_PROFILE_RE.fullmatch(a.cpu_profile):
        ap.error(f"--cpu-profile takes switch indices like 3,4,5 (at most {CPU_PROFILE_MAX}), not {a.cpu_profile!r}")
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
