"""Opportunistic deep-cold sampler for the breadth history reader.

Accumulates poolable production samples across settle windows until p95 is estimable,
without anyone watching. Session 11, Workstream B.

⛔⛔ SAMPLER LOAD IS PRODUCTION LOAD. Three refusals are enforced in code, not in a
comment, and each one is a rail in `tests/test_breadth_sampler.py`:

    1. pod settled (uptime >= MIN_UPTIME_S) — Session 7 measured 17,480 ms three minutes
                                     after boot against 224 ms settled; an unsettled
                                     sample is not a measurement of the reader.
                                     ⚰️ This read "uptime >= 600" while the constant had
                                     been 300 since SD-1.7 H0.2 — a comment asserting a
                                     value the code did not hold, which is the defect
                                     this programme has now found six times in its own
                                     tools. The floor is NAMED here, never restated:
                                     COLLECTION is 300 (more rows), and ANALYSIS
                                     re-applies 600 in breadth_pool_report.py, which is
                                     where the 300-600 bucket is measured to be ~23%
                                     slower at the median (n=73, rho=-0.303).
    2. daily cap                   — a runaway loop is a self-inflicted load test
    3. kill switch file            — one file, removable by anyone, no deploy

⚰️ THERE WAS A FOURTH, AND IT IS RETIRED. A clock refusal ("outside 09:25-16:05 ET")
stood here until 2026-09-15. Owner ruling (SD-1.1 A0): "we no longer have mid day blocks
ever" — the window was carried in from another programme's context and was never this
owner's rule. ⛔ Do not reintroduce it. The cap and the cadence bound load DIRECTLY;
a clock only guesses when load is affordable, and guessed wrong here for three sessions.

⛔ THE TIMEZONE COMES FROM `zoneinfo`, NEVER FROM `TZ=` OR LOCAL TIME. This box runs on
Central time, and `TZ=America/New_York date` in Git Bash printed the UTC hour — checked
2026-09-15. A guard that reads the wrong clock is worse than no guard, because it refuses
and permits at the wrong times while looking correct.

⛔ AN EMPTY RESULT IS A FAILED INVOCATION. A non-200, or a 200 with no `Server-Timing`,
is written to the log as a FAILURE row and backs the loop off — never as a zero, and
never silently skipped. A sample that cannot be attributed is not a fast sample.

Usage:
    python tools/breadth_sampler.py            # loop until the cap or the kill switch
    python tools/breadth_sampler.py --once     # one attempt, print the decision, exit
    python tools/breadth_sampler.py --dry-run 3  # three real samples, then stop
"""
from __future__ import annotations

import argparse
import datetime
import http.cookiejar
import json
import os
import pathlib
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

try:
    from zoneinfo import ZoneInfo
except Exception:                                        # pragma: no cover
    ZoneInfo = None

BASE = "https://uctintelligence.com"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/140.0 Safari/537.36")

REPO = pathlib.Path(__file__).resolve().parents[1]

#: THE POOL LIVES OUTSIDE EVERY WORKTREE (SD-1.2 B3.1, SD-1.5 E1.1).
#: It used to be `REPO / "logs"`, where REPO is derived from THIS FILE'S location --
#: so the pool's identity was "whichever checkout happened to run the sampler", and a
#: second checkout silently started a SECOND pool while both looked healthy. A pool is
#: a population, not a directory; it must not move when the code does. Same defect the
#: git-scope heartbeat log had, found the same night.
POOL_DIR = pathlib.Path(os.environ.get(
    "BREADTH_SAMPLER_DIR", "C:/Users/Patrick/uct-breadth-pool"))
LOG_PATH = pathlib.Path(os.environ.get(
    "BREADTH_SAMPLER_LOG", str(POOL_DIR / "breadth-samples.jsonl")))
SUMMARY_PATH = pathlib.Path(os.environ.get(
    "BREADTH_SAMPLER_SUMMARY", str(POOL_DIR / "breadth-summary.md")))
KILL_SWITCH = pathlib.Path(os.environ.get(
    "BREADTH_SAMPLER_KILL", str(POOL_DIR / "STOP-BREADTH-SAMPLER")))

#: ⛔⛔ THERE IS NO SAMPLING WINDOW. Owner ruling 2026-09-15 (SD-1.1 A0): "we no longer
#: have mid day blocks ever". A 09:25-16:05 ET refusal used to live here; it was carried
#: in from another programme's context and is RETIRED. Do not reintroduce it.
#: The load bound is the CAP and the CADENCE, which bound load directly rather than by
#: guessing when load is affordable.
#: Session 7's settle floor. Below this the pod is racing its own prewarmers.
#: 300 IS THE STANDING VALUE (SD-1.7 final ratification, 2026-09-16), and it is a
#: MEASURED value, not a convenience. Session 7 set 600 on the reasoning that a fresh
#: pod races its own prewarmers; at n=34 that reasoning is not visible in the data:
#: Spearman rho(uptime, total) = +0.09, the 300-600 s bucket (n=8) medians 327.0 ms
#: against 313.4 ms for >=600 s (n=26) -- 4.3% apart. A pod settled 300 s reads the
#: same as one settled 600 s, and the stricter floor was costing collection for
#: nothing against a ~1-per-11-min deploy cadence.
#: Every row still carries its uptime, so this stays falsifiable: if a future pool
#: shows an effect, the analysis can re-apply 600 to rows already collected. Loosen
#: COLLECTION, tighten at ANALYSIS -- never the reverse, which discards rows that
#: cannot be re-collected.
MIN_UPTIME_S = int(os.environ.get("BREADTH_SAMPLER_MIN_UPTIME", "300"))
#: A runaway loop is a self-inflicted load test. 60 deep reads a day is ~1 per 24 min.
#: Raisable for a SUPERVISED in-session run only (SD-1.6 F1.1 lifted it to 150 for the
#: close-out night). The default is the unattended value and must stay 60.
DAILY_CAP = int(os.environ.get("BREADTH_SAMPLER_CAP", "60"))

#: What WE believe the reader flag is set to, for this run. It is an ASSERTION, not
#: evidence -- the pod's own phase keys are the evidence, and `flag_observed` below is
#: derived from them. Recording both is the point: if they ever disagree, the pool is
#: mixing two configurations and the disagreement must be visible in the row rather
#: than reasoned about afterwards.
FLAG_DECLARED = os.environ.get("BREADTH_SAMPLER_FLAG_DECLARED", "unknown")
#: The phase the resident-recon reader adds. Its presence in a sample's timing is the
#: pod telling us which reader served the request.
RESIDENT_PHASE = "rf_resident"


def flag_evidence(timing: dict) -> dict:
    """Per-row flag evidence: what we declared, and what the pod's phases show."""
    keys = sorted(k for k in (timing or {}) if isinstance(k, str))
    observed = "on" if RESIDENT_PHASE in keys else ("off" if keys else "unknown")
    return {"flag_declared": FLAG_DECLARED,
            "flag_observed": observed,
            "flag_agrees": (FLAG_DECLARED in ("unknown", observed)),
            "phase_keys": keys}
#: Deep reads are expensive; never faster than this.
MIN_CADENCE_S = 35
#: On a failure, stop hammering something that is already unwell.
BACKOFF_S = 600
#: Every Nth sample also takes a warm days=365 read for the P-B4 question.
WARM_EVERY = 10
#: Distinct span per sample so every read is a forced cache miss. Walks downward.
SPAN_HI = 7300
SPAN_LO = 6400


# ── decisions: pure functions, so the rails can feed them fake inputs ────────

def et_now(now_utc: datetime.datetime | None = None) -> datetime.datetime:
    """⛔ zoneinfo, never TZ= and never local time. See the module docstring."""
    now_utc = now_utc or datetime.datetime.now(datetime.timezone.utc)
    if ZoneInfo is None:                                  # pragma: no cover
        raise RuntimeError("zoneinfo unavailable — refusing to guess the ET offset")
    return now_utc.astimezone(ZoneInfo("America/New_York"))


def should_sample(et: datetime.datetime, uptime_s, taken_today: int,
                  kill_switch_present: bool, cap: int = DAILY_CAP) -> tuple[bool, str]:
    """The whole refusal policy in one place, with no I/O.

    Returns (may_sample, reason). The reason is logged whether or not it sampled —
    a refusal nobody can see is indistinguishable from a sampler that died.

    ⚠️ `et` NO LONGER DECIDES ANYTHING. The clock refusal was retired by owner ruling
    (SD-1.1 A0) and the parameter is kept only so the timestamp stays available to the
    caller's log line. It is deliberately NOT removed from the signature in the same
    change that removes the rule, so a reviewer can see that the clock stopped being a
    gate rather than having quietly moved somewhere else.
    """
    if kill_switch_present:
        return False, "kill_switch_present"
    if uptime_s is None:
        return False, "uptime_unknown"
    if uptime_s < MIN_UPTIME_S:
        return False, f"pod_unsettled_uptime_{int(uptime_s)}s"
    if taken_today >= cap:
        return False, f"daily_cap_reached_{taken_today}"
    return True, "ok"


def parse_server_timing(header: str) -> dict:
    """⛔ Returns {} for a missing or unparseable header, and the caller treats {} as a
    FAILURE rather than as a sample with no phases."""
    out = {}
    for part in (header or "").split(","):
        part = part.strip()
        if ";dur=" not in part:
            continue
        k, v = part.split(";dur=", 1)
        try:
            out[k.strip()] = float(v.strip())
        except ValueError:
            continue
    return out


def samples_taken_today(log_path: pathlib.Path, et: datetime.datetime) -> int:
    """Counts SUCCESSFUL samples stamped with today's ET date. Failures do not consume
    the cap — otherwise an outage would silently exhaust the day's budget."""
    if not log_path.exists():
        return 0
    day = et.strftime("%Y-%m-%d")
    n = 0
    with log_path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except Exception:
                continue
            if row.get("ok") and row.get("et_date") == day:
                n += 1
    return n


# ── I/O ─────────────────────────────────────────────────────────────────────

def health() -> dict:
    r = urllib.request.Request(f"{BASE}/api/health", headers={"User-Agent": UA})
    return json.load(urllib.request.urlopen(r, timeout=30))


def deployed_sha(cache: dict) -> str | None:
    """⛔ /api/health DOES NOT EXPOSE THE DEPLOYED SHA, and it cannot be made to in this
    branch: it lives in `api/main.py`, which is ON the measured request path, and M12's
    gate forbids touching it. So the SHA is resolved locally from the Railway CLI —
    this sampler runs on the operator's box, beside the linked worktree.

    Refreshed only when the pod's uptime goes BACKWARDS (a new boot) or after an hour,
    because the call costs seconds and the answer changes only on a deploy.
    """
    rw = shutil.which("railway")
    if not rw:
        return None
    try:
        p = subprocess.run([rw, "deployment", "list", "--service", "web", "--json"],
                           capture_output=True, cwd=str(REPO), encoding="utf-8",
                           errors="replace", timeout=180)
        if p.returncode != 0 or not (p.stdout or "").strip():
            return None
        rows = sorted(json.loads(p.stdout.strip()), key=lambda x: x["createdAt"])
        for row in reversed(rows):
            if row.get("status") == "SUCCESS":
                return (row.get("meta", {}).get("commitHash") or "")[:9] or None
    except Exception:
        return None
    return None


def login():
    jar = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    op.addheaders = [("User-Agent", UA)]
    op.open(urllib.request.Request(
        f"{BASE}/api/auth/login",
        data=json.dumps({"email": os.environ["SMOKE_EMAIL"],
                         "password": os.environ["SMOKE_PASSWORD"]}).encode(),
        headers={"Content-Type": "application/json"}), timeout=60).read()
    return op


def take_sample(op, span: int, kind: str) -> dict:
    t0 = time.perf_counter()
    status, st, nbytes, err = None, {}, None, None
    try:
        r = op.open(urllib.request.Request(
            f"{BASE}/api/breadth-monitor?days={span}",
            headers={"Accept-Encoding": "gzip"}), timeout=300)
        status = r.status
        body = r.read()
        nbytes = len(body)
        st = parse_server_timing(r.headers.get("Server-Timing") or "")
    except urllib.error.HTTPError as e:
        status, err = e.code, f"HTTPError {e.code}"
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
    wall = round((time.perf_counter() - t0) * 1000, 1)
    ok = status == 200 and bool(st)
    if status == 200 and not st:
        err = "200 but no Server-Timing — treated as a FAILURE, not a zero"
    return {"kind": kind, "span": span, "status": status, "ok": ok,
            "wall_ms": wall, "wire_bytes": nbytes, "error": err, "timing": st}


def write_row(row: dict):
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("a", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(row, sort_keys=True) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--dry-run", type=int, default=0,
                    help="take N real samples then stop")
    ap.add_argument("--cap", type=int, default=DAILY_CAP)
    args = ap.parse_args()

    op = None
    sha_cache = {"sha": None, "uptime": None, "at": 0.0}
    want = args.dry_run or (1 if args.once else 10 ** 9)
    taken = 0
    span = SPAN_HI

    while taken < want:
        et = et_now()
        try:
            h = health()
            uptime = h.get("uptime_seconds")
        except Exception as e:
            uptime, h = None, {}
            print(f"[sampler] health probe failed: {type(e).__name__}", flush=True)

        today = samples_taken_today(LOG_PATH, et)
        may, reason = should_sample(et, uptime, today, KILL_SWITCH.exists(), args.cap)
        if not may:
            print(f"[sampler] {et:%H:%M:%S} ET  REFUSED: {reason}", flush=True)
            write_row({"ts_utc": datetime.datetime.now(datetime.timezone.utc)
                                  .strftime("%Y-%m-%dT%H:%M:%SZ"),
                       "et_date": et.strftime("%Y-%m-%d"), "ok": False,
                       "refused": reason, "uptime_s": uptime})
            if args.once or args.dry_run:
                return 0
            time.sleep(BACKOFF_S if reason.startswith(("pod_unsettled", "uptime_unknown"))
                       else 300)
            continue

        # a new boot invalidates the cached SHA; so does an hour passing
        if (sha_cache["sha"] is None
                or (sha_cache["uptime"] is not None and uptime < sha_cache["uptime"])
                or time.time() - sha_cache["at"] > 3600):
            sha_cache = {"sha": deployed_sha(sha_cache), "uptime": uptime, "at": time.time()}

        if op is None:
            op = login()

        span = span - 1 if span > SPAN_LO else SPAN_HI
        s = take_sample(op, span, "deep_cold")
        row = {"ts_utc": datetime.datetime.now(datetime.timezone.utc)
                          .strftime("%Y-%m-%dT%H:%M:%SZ"),
               "et_date": et.strftime("%Y-%m-%d"),
               "sha": sha_cache["sha"], "uptime_s": uptime, "refused": None,
               **flag_evidence(s.get("timing")), **s}
        write_row(row)
        t = s["timing"]
        print(f"[sampler] {et:%H:%M:%S} ET  {'OK ' if s['ok'] else 'FAIL'} "
              f"span={span} total={t.get('total')} reader={t.get('reader')} "
              f"rf_fetch={t.get('rf_fetch')} syscr={t.get('io_syscr')} "
              f"pgcache={t.get('rf_pagecache')} sha={sha_cache['sha']}", flush=True)

        if not s["ok"]:
            print(f"[sampler] backing off {BACKOFF_S}s: {s['error']}", flush=True)
            if args.once or args.dry_run:
                return 1
            op = None
            time.sleep(BACKOFF_S)
            continue

        taken += 1
        if WARM_EVERY and taken % WARM_EVERY == 0:
            w = take_sample(op, 365, "warm_365")
            write_row({"ts_utc": datetime.datetime.now(datetime.timezone.utc)
                                  .strftime("%Y-%m-%dT%H:%M:%SZ"),
                       "et_date": et.strftime("%Y-%m-%d"),
                       "sha": sha_cache["sha"], "uptime_s": uptime, "refused": None,
                       **flag_evidence(w.get("timing")), **w})

        if taken < want:
            time.sleep(MIN_CADENCE_S)
    return 0


if __name__ == "__main__":
    sys.exit(main())
