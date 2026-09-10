"""One driver for every scheduled roll-gate step. Appends to report.txt.

Usage:  python gate_step.py <step>
Steps:  sampler_check | probe | bump | read | summary | final

EVERY line written carries an ET timestamp. The machine runs CT, so ET is
computed explicitly rather than assumed -- Task Scheduler start times are LOCAL
(CT) and the brief's times are ET, which is a one-hour trap this project has
been bitten by before.

⛔ NO SECRET IS STORED ON DISK. The service token is read from Railway at run
time via the CLI, used for one request, and never written to report.txt.
"""
import datetime
import json
import os
import shutil
import subprocess
import sys
import urllib.request

D = os.path.dirname(os.path.abspath(__file__))
REPORT = os.path.join(D, "report.txt")
RAW = os.path.join(D, "captures.jsonl")
SAMPLER = os.path.join(D, "sample_flow_gate.py")
SUMMARY = os.path.join(D, "summary.py")
LINKED = r"C:\Users\Patrick\uct-dashboard-flow-rollgate"   # railway-linked dir
BASE = "https://uctintelligence.com"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")


def et_now():
    return (datetime.datetime.now(datetime.timezone.utc)
            - datetime.timedelta(hours=4))


def log(*lines):
    stamp = et_now().strftime("%m-%d %H:%M:%S ET")
    with open(REPORT, "a", encoding="utf-8") as f:
        for ln in lines:
            f.write("[%s] %s\n" % (stamp, ln))
    for ln in lines:
        print("[%s] %s" % (stamp, ln))


def service_token():
    """Read PUSH_SECRET from Railway at run time. Never persisted."""
    try:
        # ⛔ RESOLVE THE FULL PATH. The CLI is a .CMD shim on Windows and a bare
        # "railway" in a subprocess argv raises WinError 2 - which this step
        # reports as "no service token", i.e. it would have looked like an AUTH
        # problem at 08:00 tomorrow instead of a PATH one. Caught by running it.
        exe = shutil.which("railway") or "railway"
        out = subprocess.run(
            [exe, "variables", "-s", "flow-worker", "--json"],
            cwd=LINKED, capture_output=True, text=True, timeout=120, shell=False)
        if out.returncode != 0:
            return None, "railway exit %d" % out.returncode
        d = json.loads(out.stdout)
        if len(d) < 5:
            return None, "only %d vars returned - suspect unlinked dir" % len(d)
        tok = d.get("PUSH_SECRET")
        return (tok, None) if tok else (None, "PUSH_SECRET absent")
    except Exception as e:
        return None, "%s: %s" % (type(e).__name__, str(e)[:80])


def call(path, method="GET", token=None):
    req = urllib.request.Request(BASE + path, method=method,
                                 data=b"" if method == "POST" else None)
    req.add_header("User-Agent", UA)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.status, r.read().decode("utf-8", "replace")[:400]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:300]
    except Exception as e:
        return None, "%s: %s" % (type(e).__name__, str(e)[:120])


def sampler_alive():
    """Fresh capture within 5 min == alive. Cheaper and more honest than
    process introspection: it proves the sampler is WORKING, not merely running."""
    if not os.path.exists(RAW):
        return False, "no captures file"
    last = None
    with open(RAW, encoding="utf-8") as f:
        for line in f:
            last = line
    if not last:
        return False, "captures file empty"
    try:
        at = json.loads(last).get("at", 0)
    except Exception:
        return False, "last capture unparseable"
    age = (datetime.datetime.now(datetime.timezone.utc).timestamp() - at)
    return age < 300, "last capture %ds ago" % int(age)


def run_summary():
    out = subprocess.run([sys.executable, SUMMARY], capture_output=True,
                         text=True, timeout=120)
    return (out.stdout or "") + (out.stderr or "")


def step_sampler_check():
    ok, why = sampler_alive()
    if ok:
        log("sampler ALIVE (%s)" % why)
        return
    log("sampler DEAD (%s) - restarting" % why)
    try:
        subprocess.Popen([sys.executable, SAMPLER], cwd=D,
                         creationflags=getattr(subprocess, "DETACHED_PROCESS", 0)
                         | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
                         stdout=open(os.path.join(D, "sampler_restart.log"), "a"),
                         stderr=subprocess.STDOUT)
        log("sampler restart issued (append-only files: only the gap is lost)")
    except Exception as e:
        log("sampler restart FAILED: %s: %s" % (type(e).__name__, str(e)[:100]))


def step_probe():
    tok, err = service_token()
    if not tok:
        log("PROBE: no service token (%s) - cannot pre-check admin path" % err)
        return
    code, body = call("/api/flow/_diag/pod", "GET", tok)
    if code == 200:
        log("PROBE: 200 - service-token admin path WORKS. Bump is cleared.")
    else:
        log("PROBE: %s - admin path NOT working. Body: %s" % (code, body[:150]))


def step_bump():
    tok, err = service_token()
    if not tok:
        log("BUMP SKIPPED: no service token (%s)" % err)
        return
    code, body = call("/api/flow/bump-version", "POST", tok)
    log("BUMP: HTTP %s  body=%s" % (code, body[:200]))


def _rolls():
    U = os.path.join(D, "rolls_union.jsonl")
    rows = []
    if os.path.exists(U):
        with open(U, encoding="utf-8") as f:
            for line in f:
                try:
                    rows.append(json.loads(line))
                except Exception:
                    pass
    return rows


def step_read(label="READ"):
    log("--- %s ---" % label, *run_summary().rstrip().splitlines())


def step_final():
    rows = _rolls()
    txt = run_summary()
    log("--- 16:05 FINAL ---", *txt.rstrip().splitlines())

    gens = sorted({r["generation"] for r in rows})
    fixed = [g for g in gens if g >= 1]
    steady = [r for r in rows if r["kind"] == "steady_state_roll"]
    obs = sorted(r["observed_s"] for r in rows if r.get("observed_s") is not None)
    verdict, why = "AMBIGUOUS", []

    if not obs:
        why.append("no rolls with timing at all")
    else:
        over = sum(1 for x in obs if x >= 60)
        med = obs[len(obs) // 2]
        if over:
            verdict = "FAIL"
            why.append("%d roll(s) observed_s >= 60s" % over)
        elif len(obs) < 20:
            why.append("only %d rolls (<20)" % len(obs))
        else:
            verdict = "PASS"
            why.append("n=%d median=%ss max=%ss" % (len(obs), med, obs[-1]))

    if not fixed:
        why.append("NO fixed-binary generation - ran on ff886d43, "
                   "catch-up count is uninformative; timing is the whole read")
        if verdict == "PASS":
            verdict = "PASS (timing only)"
    else:
        for g in fixed:
            c = sum(1 for r in rows
                    if r["generation"] == g and r["kind"] == "startup_catchup")
            if c > 1:
                verdict = "FAIL"
                why.append("gen %d has %d catch-ups (>1)" % (g, c))
            elif c == 1:
                why.append("gen %d catch-up == 1 OK" % g)

    if steady:
        why.append("%d steady-classified rolls" % len(steady))
    log("VERDICT: %s  (%s)" % (verdict, "; ".join(why)))
    log("Quote observed_s as 'sighting -> first paint', never 'data change -> first paint'.")


def step_morning():
    """07:45 ET: is the instrument alive, what does it hold, and will the bump
    path authenticate? Runs 15 min before the bump so a token failure surfaces
    with margin instead of at fire time."""
    step_sampler_check()
    step_read("07:45 PRE-OPEN READ")
    step_probe()


STEPS = {
    "morning": step_morning,
    "sampler_check": step_sampler_check,
    "probe": step_probe,
    "bump": step_bump,
    "read": step_read,
    "summary": step_read,
    "final": step_final,
}

if __name__ == "__main__":
    name = sys.argv[1] if len(sys.argv) > 1 else ""
    fn = STEPS.get(name)
    if not fn:
        print("usage: gate_step.py [%s]" % "|".join(STEPS))
        sys.exit(2)
    try:
        fn()
    except Exception as e:
        log("STEP %s CRASHED: %s: %s" % (name, type(e).__name__, str(e)[:200]))
        sys.exit(1)
