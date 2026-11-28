"""Run ONE lane of a speed-rig sweep (one GitHub job): its passes one after another, each in a fresh browser profile,
each bracketed by the production build it ran against, then the scrub every artifact passes before upload.

    python scripts/proofs/speed-rig/lane.py --plan <plan.json> --lane L01 --out <dir>

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
TEXT = (".json", ".log", ".txt", ".md", ".jsonl")
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
            "colo": ray.rsplit("-", 1)[-1] if "-" in ray else None, "error": h.get("error")}


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
    os.makedirs(a.out, exist_ok=True)
    rig = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig.mjs")
    worst, leaks = 0, 0
    try:
        worst = run_passes(a, plan, lane, rig)
    finally:
        # ALWAYS, and after every pass too (run_passes): a lane that raises, or a pass that hangs until the job is
        # killed, never leaves an unscrubbed file for the upload step (which also skips a cancelled job)
        leaks = scrub_dir(a.out)
    if leaks:
        print(f"SCRUB: {leaks} file(s) still held a credential after redaction and were DELETED", flush=True)
        return 3
    return worst


def run_passes(a, plan, lane, rig) -> int:
    worst = 0
    for name in lane["passes"]:
        spec = plan["passes"][name]
        h0, t0, sess = production(), time.time(), session_now()
        print(f"{datetime.now(timezone.utc):%H:%M:%SZ} start {name} [{sess}] production api {h0['apiCommit']} web {h0['webBuild']} colo {h0['colo']}", flush=True)
        log = open(os.path.join(a.out, f"{name}.log"), "w", encoding="utf-8")
        try:
            p = subprocess.run(["node", rig, os.path.join(a.out, f"{name}.json"), *spec["args"]], stdout=log, stderr=subprocess.STDOUT, timeout=PASS_TIMEOUT_S)
            rc = p.returncode
        except subprocess.TimeoutExpired:
            rc = 124
        finally:
            log.close()
        h1 = production()
        health = {"pass": name, "lane": a.lane, "exit": rc, "seconds": round(time.time() - t0), "session": sess, "before": h0, "after": h1,
                  "deployDuring": bool(h0.get("apiCommit") and h1.get("apiCommit") and h0["apiCommit"] != h1["apiCommit"])
                  or bool(isinstance(h0.get("apiUptime"), (int, float)) and isinstance(h1.get("apiUptime"), (int, float)) and h1["apiUptime"] < h0["apiUptime"])}
        json.dump(health, open(os.path.join(a.out, f"{name}.health.json"), "w", encoding="utf-8"), indent=1)
        tail = open(os.path.join(a.out, f"{name}.log"), encoding="utf-8", errors="replace").read().splitlines()[-6:]
        print(f"{datetime.now(timezone.utc):%H:%M:%SZ} {name} exit {rc} in {health['seconds']} s{' (A DEPLOY LANDED DURING IT)' if health['deployDuring'] else ''}", flush=True)
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
        return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
