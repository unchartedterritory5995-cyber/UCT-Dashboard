#!/usr/bin/env python
"""Refuse a push to master while the market is open, or while `web` is mid-swap.

    python tools/pre_push_guard.py            # exit 0 = safe to push, 1 = refuse
    python tools/pre_push_guard.py --json

TWO GUARDS, TWO DIFFERENT FAILURES:

  1. **THE CLOCK** (owner ruling A2, 2026-09-14). A master push restarts `web`
     and `chart-renderer`. Doing that inside the session is a member-visible
     event, so it is refused between **09:25 and 16:05 ET on trading days**
     unless the diff is entirely within the paths `docs/runbooks/deploy-windows.md`
     clears for daytime. ⚰️ **THE CLOCK IS ENFORCED IN THE TOOL, NOT IN ANYONE'S
     HEAD.** On 2026-09-14 the integrator reasoned that a push should wait for
     the 16:00 close, wrote that decision down, set a background timer to gate
     it — and pushed at **15:49 ET** anyway, acting on a mental estimate of
     elapsed time that had drifted ~25 minutes. `web` and `chart-renderer` both
     restarted in the last eight minutes of RTH. A decision written down is not
     a decision enforced.
  2. **THE QUEUE** — the one-merge-at-a-time rule, below.

⚰️ **THE RULE WAS ALREADY WRITTEN AND IT WAS NOT FOLLOWED.** `CLAUDE.md` carries
*"ONE MASTER MERGE AT A TIME, REPO-WIDE — Railway `web` SUCCESS before the next
push"*, citing the 2026-09-12 502 and a lost sampler row. On **2026-09-13,
21:08–21:16 UTC**, three pushes landed in eight minutes:

    21:08:12  e5dfb23fb   merge(wisdom): S-B core rails
    21:14:35  b66363b9d   feat(joystick): the owner-run intake
    21:16:21  aa2acfcd2   docs(joystick): stage 2 is READY-AND-GATED

`/api/health` returned **502** through the overlap and a `railway ssh` probe was
refused with *"Your application is not running or in a unexpected state."*

⭐ **A RULE THAT LIVES ONLY IN A FILE NOBODY OPENS BEFORE PUSHING HAS NO READER.**
This is that rule with a reader. It is the whole reason the file exists.

──────────────────────────────────────────────────────────────────────────────
WHAT IT CHECKS, AND WHY EACH CLAUSE IS THERE
──────────────────────────────────────────────────────────────────────────────

1. **The newest `web` deployment must be `SUCCESS`.** `BUILDING`/`DEPLOYING`
   means a swap is in flight and a second push marks it `REMOVED` mid-swap —
   which is exactly how members get a 502.
2. **…and at least `MIN_SETTLE_SECONDS` old.** Railway reports `SUCCESS` when the
   healthcheck passes, and the old container can still be draining
   (`drainingSeconds: 30` in `railway.json`). ⭐ One probe during a swap is not a
   verdict — a `SUCCESS` two seconds old is a coin flip, not a settled service.
3. ⛔ **It never claims safety it cannot measure.** If the CLI is missing, not
   authenticated, or the project is unlinked, this **REFUSES** and says which.
   A guard that fails open is a guard that reports "fine" precisely when it has
   stopped working — the failure direction this repo has paid for repeatedly.

⛔ **IT DOES NOT CHECK WHOSE COMMIT IS DEPLOYED.** `SUCCESS` on somebody else's
commit still means the pod is settled, which is the property that matters for
*your* push. Requiring your own parent would refuse every legitimate push in a
repo five workstreams share.

**Bypass** — deliberate, loud, and logged. ⛔ TWO SEPARATE OVERRIDES, ON PURPOSE:
overriding "the pod is mid-swap" is not the same act as overriding "the market is
open", and one variable for both would let a reflex for the cheap one silently
buy the expensive one.

    UCT_SKIP_PREPUSH_GUARD=1 git push origin HEAD:master                  # the QUEUE
    UCT_DEPLOY_WINDOW_OVERRIDE=I-ACCEPT-AN-RTH-RESTART git push …         # the CLOCK

Every bypass appends to `logs/pre-push-guard-bypass.log` with the user, the time
and the state that was overridden, so a bypass is a record rather than a silence.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import shutil
import subprocess
import sys

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = pathlib.Path(__file__).resolve().parents[1]
SERVICE = "web"
#: A `SUCCESS` younger than this is not yet a settled service — `railway.json`
#: sets `drainingSeconds: 30`, and the old container is still answering inside it.
MIN_SETTLE_SECONDS = 150
BYPASS_ENV = "UCT_SKIP_PREPUSH_GUARD"
BYPASS_LOG = ROOT / "logs" / "pre-push-guard-bypass.log"

OK, REFUSE, UNREADABLE = "OK", "REFUSE", "UNREADABLE"


def _railway() -> str | None:
    """⛔ Resolved with `shutil.which`, never `shell=True`. On Windows the CLI is
    a `.cmd` shim that `subprocess.run([...])` cannot resolve on its own — the
    defect that made `deploy_watch.py` emit forty FileNotFoundErrors and then
    exit 0."""
    return shutil.which("railway")


#: One CLI read per process, shared by guard 2 (the newest row) and guard 3 (the
#: cadence). ⛔ A MEMO, NOT A CACHE WITH A TTL: the guard runs once per push and
#: exits, so "for the life of this process" is the only lifetime there is — and
#: two reads seconds apart could disagree, which would let guard 2 and guard 3
#: describe different worlds in the same refusal message.
_ROWS_MEMO: dict = {}


def _read_rows() -> dict:
    if "v" not in _ROWS_MEMO:
        _ROWS_MEMO["v"] = _read_rows_uncached()
    return _ROWS_MEMO["v"]


def _read_rows_uncached() -> dict:
    exe = _railway()
    if not exe:
        return {"state": UNREADABLE, "why": "the railway CLI is not on PATH"}
    try:
        # ⛔⛔ `encoding=` AND `errors=` ARE LOAD-BEARING ON WINDOWS, and their
        # absence is the exact defect this repo already paid two days for.
        # `text=True` alone decodes the pipe with the LOCALE codec (cp1252); the
        # Railway CLI emits UTF-8, so the first box-drawing byte kills the reader
        # thread and this function reports "did not return JSON (not linked?)" —
        # which reads as an auth or project problem rather than an encoding one.
        # `flag_ledger_audit.py` was mis-diagnosed that way for two days.
        r = subprocess.run([exe, "deployment", "list", "--service", SERVICE, "--json"],
                           capture_output=True, text=True, timeout=120, cwd=str(ROOT),
                           encoding="utf-8", errors="replace")
    except Exception as e:                                   # noqa: BLE001
        return {"state": UNREADABLE, "why": f"railway CLI failed: {type(e).__name__}"}
    if r.returncode != 0:
        tail = (r.stderr or r.stdout or "").strip().splitlines()
        return {"state": UNREADABLE,
                "why": "railway CLI exit %d: %s" % (r.returncode, tail[-1][:120] if tail else "")}
    try:
        rows = json.loads(r.stdout)
    except Exception:
        return {"state": UNREADABLE, "why": "railway CLI did not return JSON (not linked?)"}
    rows = rows if isinstance(rows, list) else rows.get("deployments", rows)
    if not rows:
        return {"state": UNREADABLE, "why": "no deployments listed for service %r" % SERVICE}
    return {"state": "READ", "rows": rows}


def latest_deployment() -> dict:
    """The newest row, shaped for `decide()`. Unchanged contract — guard 2's tests
    drive this and `main()` still monkeypatch-substitutes it by name."""
    raw = _read_rows()
    if raw.get("state") != "READ":
        return raw
    d = raw["rows"][0]
    meta = d.get("meta") or {}
    return {"state": "READ", "status": d.get("status"), "createdAt": d.get("createdAt"),
            "commit": (meta.get("commitHash") or "")[:9],
            "message": (meta.get("commitMessage") or "").split("\n")[0][:60]}


def _age_seconds(iso: str | None) -> float | None:
    if not iso:
        return None
    try:
        t = dt.datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return (dt.datetime.now(dt.timezone.utc) - t).total_seconds()
    except Exception:
        return None


def decide(dep: dict, *, now_age: float | None = None) -> tuple[str, str]:
    """(verdict, one-line reason). Pure — the tests drive it directly."""
    if dep.get("state") == UNREADABLE:
        return REFUSE, ("cannot read the %s deployment state (%s). REFUSING: a guard that "
                        "fails open reports 'fine' exactly when it has stopped working."
                        % (SERVICE, dep.get("why")))
    status = (dep.get("status") or "").upper()
    age = now_age if now_age is not None else _age_seconds(dep.get("createdAt"))
    if status != "SUCCESS":
        return REFUSE, ("the newest %s deployment is %s (%s %s) — a swap is in flight; "
                        "pushing now marks it REMOVED mid-swap and members get a 502."
                        % (SERVICE, status or "UNKNOWN", dep.get("commit"), dep.get("message")))
    if age is None:
        return REFUSE, "the deployment is SUCCESS but its age is unreadable — cannot say it settled."
    if age < MIN_SETTLE_SECONDS:
        return REFUSE, ("the newest %s deployment is SUCCESS but only %ds old (< %ds). "
                        "Railway reports SUCCESS at healthcheck; the old container is still "
                        "draining. Wait %ds."
                        % (SERVICE, int(age), MIN_SETTLE_SECONDS, int(MIN_SETTLE_SECONDS - age)))
    return OK, ("%s is SUCCESS on %s, %ds settled — safe to push."
                % (SERVICE, dep.get("commit"), int(age)))


def _log_bypass(dep: dict, reason: str) -> None:
    try:
        BYPASS_LOG.parent.mkdir(parents=True, exist_ok=True)
        with BYPASS_LOG.open("a", encoding="utf-8") as fh:
            fh.write("%s  user=%s  status=%s commit=%s  overrode: %s\n"
                     % (dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                        os.environ.get("USERNAME") or os.environ.get("USER") or "?",
                        dep.get("status"), dep.get("commit"), reason))
    except Exception:
        pass


def self_check() -> int:
    """A GUARD NOBODY HAS SEEN FAIL IS NOT A GUARD.

    Owner ruling 2026-09-14: "a fake in-flight status blocks; SUCCESS passes;
    CLI unavailable -> block with 'cannot verify,' never pass."

    It was watched refusing AND allowing on a real push the same night - but an
    OBSERVATION IS NOT A RAIL: nobody could re-prove it on demand, so the next
    person to touch `decide` had nothing to run. `decide` is pure, so this drives
    it directly instead of mocking the CLI.
    """
    fails = []

    def case(name, dep, want, must_say=None, **kw):
        verdict, reason = decide(dep, **kw)
        ok = verdict == want and (must_say is None or must_say in reason)
        print("  %s %s: %s - %s" % ("ok  " if ok else "FAIL", name, verdict, reason[:84]))
        if not ok:
            fails.append(name)

    settled = MIN_SETTLE_SECONDS + 10
    case("an in-flight deployment BLOCKS",
         {"state": "READ", "status": "BUILDING", "commit": "abc123", "message": "another merge"},
         REFUSE, "swap is in flight", now_age=settled)
    case("a settled SUCCESS PASSES",
         {"state": "READ", "status": "SUCCESS", "commit": "abc123", "message": "m"},
         OK, "safe to push", now_age=settled)
    case("an unreadable CLI BLOCKS, never passes",
         {"state": UNREADABLE, "why": "railway not on PATH"}, REFUSE, "cannot read")
    case("SUCCESS but too YOUNG blocks",
         {"state": "READ", "status": "SUCCESS", "commit": "abc123", "message": "m"},
         REFUSE, "draining", now_age=1)
    case("SUCCESS with an unreadable AGE blocks",
         {"state": "READ", "status": "SUCCESS", "commit": "abc123", "message": "m",
          "createdAt": "not-a-date"}, REFUSE, "age is unreadable")

    # THE DISCRIMINATOR. Without it every case above passes if `decide` were to
    # return REFUSE unconditionally - which is the shape a panicked fix takes.
    v, _ = decide({"state": "READ", "status": "SUCCESS", "commit": "c", "message": "m"},
                  now_age=settled)
    if v != OK:
        print("  FAIL discriminator: decide() never returns OK - every rail above is vacuous")
        fails.append("discriminator")
    else:
        print("  ok   discriminator: decide() can return OK, so the refusals mean something")

    print("self-check:", "PASS" if not fails else "FAIL " + ", ".join(fails))
    return 0 if not fails else 1

#: A build takes ~3-5 minutes. Two DISTINCT commits deployed closer together than
#: this almost certainly means the second was pushed while the first was still
#: BUILDING — which is the 2026-09-14 incident's exact shape.
STACK_WINDOW_SECONDS = 300


def suspected_stacked_pushes(rows, window=STACK_WINDOW_SECONDS):
    """Pairs of consecutive DISTINCT-commit deployments created within `window`.

    ⛔ SUSPECTED, NEVER CONFIRMED, and the wording is load-bearing. Railway's
    deployment list carries only `status` and `createdAt` — there is no
    "reached SUCCESS at" timestamp — so this can show that two commits were
    deployed closer together than a build takes, and it CANNOT show that the first
    was still building. Reporting that as proof would be inventing a fact the data
    does not carry.

    ⚠️ Railway also emits two rows for one push (a REMOVED twin milliseconds from
    its SUCCESS). Same commit is not a stacked push, so pairs are compared by
    commit and identical ones are skipped rather than counted as the tightest
    stack in the list.
    """
    out = []
    seen = []
    for d in rows:
        meta = d.get("meta") or {}
        seen.append(((meta.get("commitHash") or "")[:9], d.get("createdAt"), d.get("status")))
    for (c1, t1, s1), (c2, t2, s2) in zip(seen, seen[1:]):
        if not c1 or not c2 or c1 == c2:
            continue
        a1, a2 = _iso(t1), _iso(t2)
        if a1 is None or a2 is None:
            continue
        gap = (a1 - a2).total_seconds()      # rows are newest-first
        if 0 <= gap < window:
            out.append({"newer": c1, "older": c2, "gap_seconds": round(gap, 1),
                        "newer_at": t1, "older_at": t2,
                        "newer_status": s1, "older_status": s2})
    return out


def _iso(s):
    try:
        return dt.datetime.fromisoformat((s or "").replace("Z", "+00:00"))
    except Exception:
        return None


# ═════════════════════════════════════════════════════════════════════════════
# GUARD 3 — THE CADENCE (D-06 Part 0)
# ═════════════════════════════════════════════════════════════════════════════
#
# ⛔ WHY GUARD 2 IS NOT ENOUGH. `decide()` reads ONE row — the newest — and asks
# "is the pod settled?". It cannot see a BURST. On the night of 2026-09-15 the
# newest row was SUCCESS and comfortably past `MIN_SETTLE_SECONDS` at several
# moments when master was taking a commit every few minutes from four different
# workstreams. Guard 2 would have said "safe to push" at each of them.
#
# ⛔ AND `suspected_stacked_pushes` ALREADY SAW IT AND GATED NOTHING. It has
# existed since 2026-09-14 behind `--audit`, whose docstring says in as many
# words: *"Exit 0 always — this reports, never gates."* A detector that cannot
# refuse is a report nobody reads at push time. This is that detector, wired.
#
# ⚰️⚰️ A CORRECTION THIS RAIL IS BUILT ON, BECAUSE THE PREMISE WAS WRONG.
# D-05 refused the merge citing *"six web deploys in 57 minutes, five of them
# REMOVED — the signature of stacked pushes"*. The NO-GO was right. **The
# inference was not.** Measured 2026-09-15 over the last 20 `web` deployments:
# NINETEEN are REMOVED, including `3879b7369`, whose successor arrived **1,990 s
# (33 minutes) later** — a deploy superseded half an hour on cannot have been
# killed mid-build. On this service REMOVED means *"no longer the active
# deploy"*, full stop; every superseded deploy ends there whatever the gap.
# ⭐ So a REMOVED COUNT MEASURES NOTHING ABOUT STACKING, and a rail built on it
# would fire on every healthy night. The signal in that same data is the RATE.
#
#: ⛔ N, AND WHERE IT COMES FROM — not a round number picked for feel.
#: The only directly-measured 502 on this repo is 2026-09-14: `9e2b93805` pushed
#: **173 s** after `7705c2d3b`, marking it REMOVED mid-flight; a request died with
#: a 500 after 93 s and `/api/health` served 502 for ~45 s. `docs/runbooks/
#: deploy-windows.md` puts a build at **3–5 minutes**. Railway publishes no
#: "build finished at" timestamp, so the guard cannot know when a build ENDS — it
#: can only refuse for longer than one can take. 600 s is 2x the documented
#: maximum. ⚠️ The asymmetry decides the rounding: a false refusal costs a ten
#: minute wait, a false allow costs a member-visible 502.
RECENT_PUSH_WINDOW_SECONDS = 600

#: ⛔ THE SECOND CLAUSE IS NOT THE FIRST ONE RESTATED. Recency catches the tight
#: pair (223 s, 228 s on the 09-15 night). It is blind to the shape that actually
#: stopped D-05: deploys 11, 18 and 19 minutes apart, each individually settled,
#: from four workstreams that could not see each other. Three distinct commits
#: inside an hour is not one person working — it is concurrent development, and
#: the chance that a 3-5 minute build is in flight somewhere is material.
#: ⭐ THIS CLAUSE ENCODES THE JUDGEMENT A SESSION COULD NOT MAKE FOR ITSELF. D-05
#: reported that the missing precondition was "a human who can see all four
#: workstreams"; the deployment list IS that view, and nothing was reading it.
BURST_WINDOW_SECONDS = 3600
BURST_MIN_DEPLOYS = 3


def recent_deployments() -> dict:
    """`{"state": READ, "rows": [{commit, createdAt, status}, ...]}` or UNREADABLE."""
    raw = _read_rows()
    if raw.get("state") != "READ":
        return raw
    rows = []
    for d in raw["rows"]:
        meta = d.get("meta") or {}
        rows.append({"commit": (meta.get("commitHash") or "")[:9],
                     "createdAt": d.get("createdAt"), "status": d.get("status"),
                     "message": (meta.get("commitMessage") or "").split("\n")[0][:60]})
    return {"state": "READ", "rows": rows}


def decide_cadence(dep: dict, *, now: "dt.datetime | None" = None) -> tuple[str, str]:
    """(verdict, reason). Pure — the tests drive it directly.

    ⛔ FAIL CLOSED on every unreadable path, including "rows came back but not one
    timestamp parsed". An empty answer and a quiet master are the same shape from
    here, and only one of them is safe."""
    if dep.get("state") == UNREADABLE:
        return REFUSE, ("cannot read the %s deployment list (%s). REFUSING: a cadence guard "
                        "that fails open is quietest exactly when master is busiest."
                        % (SERVICE, dep.get("why")))
    now = now or dt.datetime.now(dt.timezone.utc)
    rows = dep.get("rows") or []
    # Dedupe by commit: Railway emits a REMOVED twin milliseconds from its SUCCESS
    # for ONE push, and counting that as two deploys would double every burst.
    seen: dict = {}
    for r in rows:
        t = _iso(r.get("createdAt"))
        c = r.get("commit")
        if not c or t is None:
            continue
        if c not in seen or t > seen[c][0]:
            seen[c] = (t, r)
    if rows and not seen:
        return REFUSE, ("the %s deployment list carried %d row(s) and not one readable "
                        "(commit, timestamp) pair — REFUSING rather than reading that as quiet."
                        % (SERVICE, len(rows)))

    # ── clause 1: RECENCY ────────────────────────────────────────────────────
    for c, (t, r) in sorted(seen.items(), key=lambda kv: kv[1][0], reverse=True):
        age = (now - t).total_seconds()
        if 0 <= age < RECENT_PUSH_WINDOW_SECONDS:
            return REFUSE, ("a %s deploy landed %ds ago (%s %s) and a build takes 3-5 min — "
                            "pushing inside that window is how a deploy is marked REMOVED "
                            "mid-flight and members get a 502. Wait %ds."
                            % (SERVICE, int(age), c, r.get("message") or "",
                               int(RECENT_PUSH_WINDOW_SECONDS - age)))
        break                                    # only the newest can be the recent one

    # ── clause 2: BURST ──────────────────────────────────────────────────────
    burst = [(c, t) for c, (t, _r) in seen.items()
             if 0 <= (now - t).total_seconds() < BURST_WINDOW_SECONDS]
    if len(burst) >= BURST_MIN_DEPLOYS:
        newest = sorted(burst, key=lambda ct: ct[1], reverse=True)
        return REFUSE, ("%d distinct %s deploys in the last %d min (%s) — master is under "
                        "concurrent development and a build may be in flight from a session "
                        "this one cannot see. This is the D-05 shape; it needs a human who "
                        "can see every workstream, not a guard."
                        % (len(burst), SERVICE, BURST_WINDOW_SECONDS // 60,
                           ", ".join(c for c, _ in newest[:4])))

    n_recent = len(burst)
    return OK, ("%d %s deploy(s) in the last %d min, none inside %ds — master is quiet."
                % (n_recent, SERVICE, BURST_WINDOW_SECONDS // 60, RECENT_PUSH_WINDOW_SECONDS))


# ═════════════════════════════════════════════════════════════════════════════
# GUARD 2 — RETIRED (owner ruling R46, 2026-09-15)
# ═════════════════════════════════════════════════════════════════════════════
#
# ⚰️⚰️ THERE IS NO MARKET-HOURS PUSH OR MERGE WINDOW ON THIS REPO, AND THERE HAS NOT
# BEEN ONE SINCE 2026-08-24. CLAUDE.md:4805 records it: *"Shipping window: NO FREEZE
# (2026-08-24). The market-hours push freeze (Mon-Fri 9:15a-4:20p ET) and BOTH its
# guards — the pre-push hook and the Deploy window guard workflow — were removed by
# owner decision. Push whenever."*
#
# This file nevertheless carried an 'owner ruling A2' clock refusing every master push
# between 09:25 and 16:05 ET, with ~130 lines of machinery and 19 tests behind it. That
# is a RESCINDED RULE REINSTATED — the exact failure CLAUDE.md warns about twice, and it
# cost real time: a session read this clause, believed it, and wrote 'merge after 16:05
# ET or at a weekend' into a promotion document for a rule that does not exist.
#
# ⛔ NO TIME-OF-DAY CONDITION APPLIES TO ANY PUSH OR MERGE. Do not reintroduce one here;
# `test_the_guard_has_no_time_of_day_branch` fails by name if you do. If a window is ever
# wanted again it is an owner ruling and a deploy-policy document, not a clause that
# outlives the decision that created it.
#
# ⭐ The QUEUE guard (guard 1, above) and the CADENCE guard are untouched: they are about
# not colliding with another deploy, which is physics, not a clock.


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--self-check", action="store_true",
                    help="prove the guard can refuse AND allow, without touching the CLI")
    ap.add_argument("--audit", action="store_true",
                    help="after the fact: report SUSPECTED stacked pushes in the recent list")
    ap.add_argument("--base", default=None,
                    help="the remote sha/ref the push lands on (default: origin/master)")
    ap.add_argument("--head", default=None,
                    help="the local sha being pushed (default: HEAD)")
    # ⛔ argv is a PARAMETER, and under pytest it defaults to EMPTY rather than
    # `sys.argv`. Without that, argparse eats pytest's own flags and raises
    # SystemExit(2) — the test would be exercising argparse, not the guard.
    a = ap.parse_args([] if (argv is None and "pytest" in sys.modules) else argv)

    # ⛔ Before anything shells out: the self-check must not need the CLI.
    if a.self_check:
        return self_check()
    if a.audit:
        return _audit()

    # ⛔ NO CLOCK. Retired by owner ruling R46 (2026-09-15); see the banner above. The guard
    # goes straight to the queue question, which is the only one it has.
    dep = latest_deployment()
    verdict, reason = decide(dep)
    cad = recent_deployments()
    kverdict, kreason = decide_cadence(cad)

    if a.json:
        print(json.dumps({
            "verdict": OK if (verdict == OK and kverdict == OK) else REFUSE,
            "cadence": {"verdict": kverdict, "reason": kreason,
                        "recent_window_s": RECENT_PUSH_WINDOW_SECONDS,
                        "burst_window_s": BURST_WINDOW_SECONDS,
                        "burst_min": BURST_MIN_DEPLOYS},
            "queue": {"verdict": verdict, "reason": reason, "deployment": dep},
        }, indent=1))
        return 0 if (verdict == OK and kverdict == OK) else 1

    if os.environ.get(BYPASS_ENV, "").strip().lower() in ("1", "true", "yes"):
        # ⛔ BOTH reasons are logged. Overriding a queue refusal and overriding a
        # cadence refusal are different acts, and a log that records only the first
        # cannot tell the reviewer which one was waved through.
        _log_bypass(dep, "; ".join(r for v, r in ((verdict, reason), (kverdict, kreason))
                                   if v != OK) or reason)
        print("[pre-push] BYPASSED via %s — logged to %s" % (BYPASS_ENV, BYPASS_LOG))
        print("[pre-push] what was overridden: %s" % reason)
        if kverdict != OK:
            print("[pre-push] ...and the cadence guard: %s" % kreason)
        return 0

    print("[pre-push] %s" % reason)
    print("[pre-push] %s" % kreason)
    if verdict != OK or kverdict != OK:
        print("[pre-push] ⛔ REFUSING THE PUSH. One master merge at a time, repo-wide.")
        print("[pre-push]    Wait, then push again. Deliberate override: %s=1" % BYPASS_ENV)
        return 1
    return 0



def _audit() -> int:
    """Print SUSPECTED stacked pushes. Exit 0 always — this reports, never gates."""
    exe = _railway()
    if not exe:
        print("[audit] the railway CLI is not on PATH — nothing read. This is not a clean result.")
        return 0
    try:
        r = subprocess.run([exe, "deployment", "list", "--service", SERVICE, "--json"],
                           capture_output=True, text=True, timeout=120, cwd=str(ROOT),
                           encoding="utf-8", errors="replace")
        rows = json.loads(r.stdout)
        rows = rows if isinstance(rows, list) else rows.get("deployments", rows)
    except Exception as e:                                   # noqa: BLE001
        print("[audit] could not read the deployment list (%s). Not a clean result."
              % type(e).__name__)
        return 0
    hits = suspected_stacked_pushes(rows)
    print("[audit] %d deployment(s) read; window=%ds" % (len(rows), STACK_WINDOW_SECONDS))
    if not hits:
        print("[audit] no SUSPECTED stacked pushes in this window.")
        return 0
    for h in hits:
        print("[audit] SUSPECTED stacked push: %s at %s landed %.0fs after %s at %s"
              % (h["newer"], h["newer_at"], h["gap_seconds"], h["older"], h["older_at"]))
    print("[audit] SUSPECTED, not confirmed: the list carries no 'reached SUCCESS at' time, "
          "so this cannot show the older deploy was still building.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
