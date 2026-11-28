"""Run ONE lane of a speed-rig sweep (one GitHub job): its passes one after another, each in a fresh browser profile,
each bracketed by the production build it ran against, then the scrub every artifact passes before upload.

    python scripts/proofs/speed-rig/lane.py --plan <plan.json> --lane L01 --out <dir>
        [--side A=production --side B=<dist dir> --label B=<ref>@<sha>]

A/B (2026-11-28, the workflow's base_ref / build_ref): with --side, every pass of the lane runs in ABBA order per
repetition (--reps, default 1: A B B A; the next repetition, and a pass at an odd plan position, B A A B), on the SAME
tickers, so neither side holds the first (server-cold) or the last place more often than the other over a sweep. A
side is a directory holding a `vite build` (rig.mjs --dist serves it in this browser only; the workflow builds BOTH
sides, so both meet the same interception and headers) or `production` (the site's own front end: not for comparing
builds, it is served another way). Each run's files go to <out>/<side>/<pass>@<k>.* (k = that side's run 1, 2, ...),
and grade.py grades the two sides side by side.

Per pass <name>: <name>.json (the rig's record) and .jump.json (its per-frame samples), <name>.log (what it printed),
<name>.health.json (production before and after, wall seconds, exit code, RTH or OFF-HOURS). Exit 0 when every pass
exited 0; 1 when one did not (2 = the rig's INCONCLUSIVE); 3 when the scrub found a credential it had to remove.

⛔ THE SCRUB. The repo is public and so are its artifacts: every text file of the lane is rewritten with each secret
value from the environment (BENCH_EMAIL / BENCH_PASSWORD and the numbered ones) and every token-like query or cookie
value replaced by [redacted], and then checked again: a file that still holds a secret is DELETED and the lane fails.
Standard library only.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36"
TOKENISH = re.compile(r"((?:token|access_token|auth|apikey|api_key|signature|secret|password|uct_session|uct_chart_edge|uct_chart_speed)=)[^&\"'\s;,]+", re.I)
TEXT = (".json", ".log", ".txt", ".md", ".jsonl", ".cpuprofile")   # a CPU profile is JSON: its URLs are scrubbed like any record
PASS_TIMEOUT_S = 900


def base() -> str:
    return os.environ.get("UCT_PROOF_BASE", "https://uctintelligence.com")


def get_json(path: str):
    try:
        req = urllib.request.Request(base() + path, headers={"User-Agent": UA, "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8")), dict(r.headers)
    except Exception as e:  # noqa: BLE001 -- a label never stops a lane
        return {"error": str(e)[:160]}, {}


def production() -> dict:
    h, hh = get_json("/api/health")
    b, _ = get_json("/build.json")
    ray = hh.get("cf-ray") or hh.get("CF-RAY") or ""
    return {"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "apiUptime": h.get("uptime_seconds"),
            "apiCommit": str(h.get("commit") or h.get("git_sha") or "")[:12] or None, "webBuild": str(b.get("commit") or "")[:12] or None,
            "webBuildId": b.get("build_id") or None,
            "colo": ray.rsplit("-", 1)[-1] if "-" in ray else None, "error": h.get("error")}


def deploys(h0: dict, h1: dict) -> list[str]:
    """What changed between a pass's start and end: 'api' (its commit, or its uptime fell: a restart) and/or 'front'
    (web-front's commit or build_id). The two deploy apart, so either one is A DEPLOY LANDED."""
    out = []
    if (h0.get("apiCommit") and h1.get("apiCommit") and h0["apiCommit"] != h1["apiCommit"]) or (
            isinstance(h0.get("apiUptime"), (int, float)) and isinstance(h1.get("apiUptime"), (int, float)) and h1["apiUptime"] < h0["apiUptime"]):
        out.append("api")
    if any(h0.get(k) and h1.get(k) and h0[k] != h1[k] for k in ("webBuild", "webBuildId")):
        out.append("front")
    return out


def session_now() -> str:
    t = datetime.now(timezone.utc)
    return "RTH" if t.isoweekday() <= 5 and "1430" <= t.strftime("%H%M") < "2100" else "OFF-HOURS"


def secrets() -> list[str]:
    vals = []
    for k, v in os.environ.items():
        if re.fullmatch(r"(BENCH|PROOF)_(EMAIL|PASSWORD)(_\d+)?", k) and v and len(v) >= 4:
            vals.append(v)
    return sorted(set(vals), key=len, reverse=True)


def scrub_dir(d: str) -> int:
    """Rewrite every text file with the secrets and token values redacted; delete any file that still holds one."""
    vals = secrets()
    leaks = 0
    for root, _dirs, files in os.walk(d):
        for f in files:
            p = os.path.join(root, f)
            if not f.endswith(TEXT):
                # binary (screencast PNGs, profiles): never holds page text; a secret in one is still searched for below
                try:
                    blob = open(p, "rb").read()
                except OSError:
                    continue
                if any(v.encode() in blob for v in vals):
                    os.remove(p)
                    leaks += 1
                continue
            try:
                s = open(p, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            t = s
            for v in vals:
                t = t.replace(v, "[redacted]")
                t = t.replace(json.dumps(v)[1:-1], "[redacted]")   # its JSON-escaped form too
            t = TOKENISH.sub(r"\1[redacted]", t)
            if t != s:
                tmp = p + ".scrub"
                open(tmp, "w", encoding="utf-8").write(t)
                os.replace(tmp, p)
            if any(v in t for v in vals):
                os.remove(p)
                leaks += 1
    return leaks


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan")
    ap.add_argument("--lane")
    ap.add_argument("--out")
    ap.add_argument("--side", action="append", default=[], help="A/B: NAME=production or NAME=<dist dir> (twice: A and B)")
    ap.add_argument("--label", action="append", default=[], help="A/B: NAME=<label> for a side (its ref@commit)")
    ap.add_argument("--reps", type=int, default=1, help="A/B: ABBA repetitions per pass (each is 4 runs)")
    ap.add_argument("--self-check", action="store_true", help="prove the scrub redacts, deletes and can fail")
    a = ap.parse_args()
    if a.self_check:
        return self_check()
    if not (a.plan and a.lane and a.out):
        ap.error("--plan, --lane and --out are required")
    plan = json.load(open(a.plan, encoding="utf-8"))
    lane = next((ln for ln in plan["lanes"] if ln["lane"] == a.lane), None)
    if not lane:
        print(f"no lane {a.lane} in the plan", file=sys.stderr)
        return 1
    try:
        sides = parse_sides(a.side, a.label)
    except ValueError as e:
        print(f"refused: {e}", file=sys.stderr)
        return 1
    os.makedirs(a.out, exist_ok=True)
    rig = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig.mjs")
    worst, leaks = 0, 0
    try:
        worst = run_passes(a, plan, lane, rig, sides, a.reps)
    finally:
        # ALWAYS, and after every pass too (run_passes): a lane that raises, or a pass that hangs until the job is
        # killed, never leaves an unscrubbed file for the upload step (which also skips a cancelled job)
        leaks = scrub_dir(a.out)
    if leaks:
        print(f"SCRUB: {leaks} file(s) still held a credential after redaction and were DELETED", flush=True)
        return 3
    return worst


SIDE_NAME = re.compile(r"[AB]")


def parse_sides(side_args: list[str], label_args: list[str]) -> list[dict]:
    """--side A=production --side B=<dir> [--label B=x]: [] (no A/B), else exactly A and B, in that order."""
    if not side_args:
        if label_args:
            raise ValueError("--label without --side")
        return []
    sides, labels = {}, {}
    for s in side_args:
        k, _, v = s.partition("=")
        if not SIDE_NAME.fullmatch(k) or not v or k in sides:
            raise ValueError(f"--side {s!r}: A=production or A=<dist dir>, B likewise, once each")
        if v != "production" and not os.path.isfile(os.path.join(v, "index.html")):
            raise ValueError(f"--side {k}: {v!r} holds no index.html (not a vite build)")
        sides[k] = v
    for s in label_args:
        k, _, v = s.partition("=")
        if k not in sides:
            raise ValueError(f"--label {s!r}: no side {k}")
        labels[k] = re.sub(r"[^\w.@/:-]", "", v)[:80]
    if sorted(sides) != ["A", "B"]:
        raise ValueError("an A/B run needs both sides, A and B")
    if sides["A"] == sides["B"]:
        raise ValueError("A and B are the same front end")
    return [{"side": k, "dist": None if sides[k] == "production" else sides[k],
             "label": labels.get(k) or ("production" if sides[k] == "production" else "dist")} for k in ("A", "B")]


def runs_of(plan: dict, lane: dict, sides: list[dict], reps: int = 1) -> list:
    """(pass, side, k) in the order they run: the lane's passes; with sides, `reps` repetitions of ABBA (BAAB when the
    pass's plan position plus the repetition is odd), k counting that side's runs of the pass from 1."""
    order = list(plan["passes"])
    out = []
    for name in lane["passes"]:
        if not sides:
            out.append((name, None, 0))
            continue
        a, b = sides
        k = {a["side"]: 0, b["side"]: 0}
        for r in range(max(1, reps)):
            x, y = (a, b) if (order.index(name) + r) % 2 == 0 else (b, a)
            for s_ in (x, y, y, x):
                k[s_["side"]] += 1
                out.append((name, s_, k[s_["side"]]))
    return out


def run_passes(a, plan, lane, rig, sides=(), reps: int = 1) -> int:
    worst = 0
    runs = runs_of(plan, lane, list(sides), reps)
    for position, (name, side, k) in enumerate(runs):
        spec = plan["passes"][name]
        d = os.path.join(a.out, side["side"]) if side else a.out
        os.makedirs(d, exist_ok=True)
        fname = f"{name}@{k}" if side else name
        extra = ([f"--dist={side['dist']}", f"--build-label={side['label']}"] if side and side["dist"] else [])
        h0, t0, sess = production(), time.time(), session_now()
        tag = f"{name} [{side['side']} run {k}: {side['label']}]" if side else name
        print(f"{datetime.now(timezone.utc):%H:%M:%SZ} start {tag} [{sess}] production api {h0['apiCommit']} front {h0['webBuild']} ({h0.get('webBuildId')}) colo {h0['colo']}", flush=True)
        log = open(os.path.join(d, f"{fname}.log"), "w", encoding="utf-8")
        try:
            p = subprocess.run(["node", rig, os.path.join(d, f"{fname}.json"), *spec["args"], *extra], stdout=log, stderr=subprocess.STDOUT, timeout=PASS_TIMEOUT_S)
            rc = p.returncode
        except subprocess.TimeoutExpired:
            rc = 124
        finally:
            log.close()
        h1 = production()
        health = {"pass": name, "run": k if side else None, "lane": a.lane, "side": side["side"] if side else None, "build": side["label"] if side else "production",
                  "position": position, "exit": rc, "seconds": round(time.time() - t0), "session": sess, "before": h0, "after": h1,
                  "deploys": deploys(h0, h1)}
        health["deployDuring"] = bool(health["deploys"])
        json.dump(health, open(os.path.join(d, f"{fname}.health.json"), "w", encoding="utf-8"), indent=1)
        tail = open(os.path.join(d, f"{fname}.log"), encoding="utf-8", errors="replace").read().splitlines()[-6:]
        print(f"{datetime.now(timezone.utc):%H:%M:%SZ} {tag} exit {rc} in {health['seconds']} s"
              f"{' (A DEPLOY LANDED DURING IT: ' + ', '.join(health['deploys']) + ')' if health['deployDuring'] else ''}", flush=True)
        for line in tail:
            line = TOKENISH.sub(r"\1[redacted]", line)
            for v in secrets():
                line = line.replace(v, "[redacted]")
            print(f"    {line[:300]}", flush=True)
        worst = max(worst, 0 if rc == 0 else (2 if rc == 2 else 1))
        if scrub_dir(a.out):
            worst = max(worst, 3)
            print(f"SCRUB: after {name}, a file still held a credential after redaction and was DELETED", flush=True)
        time.sleep(3)   # the previous browser's port and profile are released
    return worst


def self_check() -> int:
    """The scrub on a fake secret: redacts text, redacts token-like values, deletes a binary that holds the secret, and
    keeps a clean file. The control (no secret in the environment) must leave the secret in place: a scrub that
    'passes' without the secret known would prove nothing."""
    import tempfile
    fake = "Fake-Bench-Pw-9137!"
    with tempfile.TemporaryDirectory() as d:
        def put(name, data):
            with open(os.path.join(d, name), "wb") as f:
                f.write(data.encode() if isinstance(data, str) else data)
        put("a.log", f"signed in with {fake} then uct_session=abc123def; ok")
        put("b.json", json.dumps({"x": fake + '"q'}))
        put("c.png", b"PNG-bytes" + fake.encode())
        put("d.json", '{"clean": true}')
        old = os.environ.get("BENCH_PASSWORD")
        os.environ.pop("BENCH_PASSWORD", None)
        control = scrub_dir(d)
        if control != 0 or fake not in open(os.path.join(d, "a.log"), encoding="utf-8").read():
            print("self-check FAILED: the control (no secret known) changed a file it cannot know about")
            return 1
        os.environ["BENCH_PASSWORD"] = fake
        try:
            leaks = scrub_dir(d)
        finally:
            if old is None:
                os.environ.pop("BENCH_PASSWORD", None)
            else:
                os.environ["BENCH_PASSWORD"] = old
        a_log = open(os.path.join(d, "a.log"), encoding="utf-8").read()
        b_json = open(os.path.join(d, "b.json"), encoding="utf-8").read()
        ok = (leaks == 1 and not os.path.exists(os.path.join(d, "c.png")) and fake not in a_log and "abc123def" not in a_log
              and "uct_session=[redacted]" in a_log and fake not in b_json and os.path.exists(os.path.join(d, "d.json")))
        print(f"self-check {'ok' if ok else 'FAILED'}: leaks={leaks} a.log={a_log!r}")
        # a deploy of EITHER build mid-pass is flagged, and named
        a = {"apiCommit": "aaa", "apiUptime": 50, "webBuild": "fff", "webBuildId": "assets/index-1.js"}
        dk = [deploys(a, a), deploys(a, {**a, "webBuild": "ggg"}), deploys(a, {**a, "webBuildId": "assets/index-2.js"}),
              deploys(a, {**a, "apiUptime": 3}), deploys(a, {**a, "apiCommit": "bbb", "webBuild": "ggg"})]
        dok = dk == [[], ["front"], ["front"], ["api"], ["api", "front"]]
        print(f"self-check {'ok' if dok else 'FAILED'}: deploys {dk}")
        if not ok:
            return 1
        # the A/B sides: parsed, refused when half-given or pointing at no build, interleaved by plan position
        os.makedirs(os.path.join(d, "distB"))
        open(os.path.join(d, "distB", "index.html"), "w").write("<html></html>")
        sides = parse_sides(["A=production", f"B={os.path.join(d, 'distB')}"], ["B=master@abc123;rm"])
        ab_ok = sides[0]["dist"] is None and sides[1]["label"] == "master@abc123rm" and parse_sides([], []) == []
        for bad in (["A=production"], ["A=production", "B=production"], ["A=production", f"B={d}"], ["A=x", "C=production"]):
            try:
                parse_sides(bad, [])
                ab_ok = False
                print(f"self-check FAILED: sides {bad} were not refused")
            except ValueError:
                pass
        plan = {"passes": {"P0": {}, "P1": {}}}
        r0 = [(n, s and s["side"], k) for n, s, k in runs_of(plan, {"passes": ["P0", "P1"]}, sides)]
        ab_ok = ab_ok and r0 == [("P0", "A", 1), ("P0", "B", 1), ("P0", "B", 2), ("P0", "A", 2),
                                 ("P1", "B", 1), ("P1", "A", 1), ("P1", "A", 2), ("P1", "B", 2)] and runs_of(plan, {"passes": ["P1"]}, []) == [("P1", None, 0)]
        r2 = "".join(s["side"] for _n, s, _k in runs_of(plan, {"passes": ["P0"]}, sides, 2))
        ab_ok = ab_ok and r2 == "ABBABAAB"
        print(f"self-check {'ok' if ab_ok else 'FAILED'}: A/B sides {r0}")
        return 0 if ok and dok and ab_ok else 1


if __name__ == "__main__":
    sys.exit(main())
