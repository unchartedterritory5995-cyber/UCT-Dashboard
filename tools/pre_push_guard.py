#!/usr/bin/env python
"""Refuse a push to master while the last `web` deployment is not settled.

    python tools/pre_push_guard.py            # exit 0 = safe to push, 1 = refuse
    python tools/pre_push_guard.py --json

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

**Bypass** — deliberate, loud, and logged:

    UCT_SKIP_PREPUSH_GUARD=1 git push origin HEAD:master

Every bypass appends to `logs/pre-push-guard-bypass.log` with the user, the time
and the deployment state that was overridden, so a bypass is a record rather than
a silence.
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


def latest_deployment() -> dict:
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
    if not rows:
        return {"state": UNREADABLE, "why": "no deployments listed for service %r" % SERVICE}
    d = rows[0]
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


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--self-check", action="store_true",
                    help="prove the guard can refuse AND allow, without touching the CLI")
    # ⛔ argv is a PARAMETER, and under pytest it defaults to EMPTY rather than
    # `sys.argv`. Without that, argparse eats pytest's own flags and raises
    # SystemExit(2) — the test would be exercising argparse, not the guard.
    a = ap.parse_args([] if (argv is None and "pytest" in sys.modules) else argv)

    # ⛔ Before anything shells out: the self-check must not need the CLI.
    if a.self_check:
        return self_check()

    dep = latest_deployment()
    verdict, reason = decide(dep)

    if a.json:
        print(json.dumps({"verdict": verdict, "reason": reason, "deployment": dep}, indent=1))
        return 0 if verdict == OK else 1

    if os.environ.get(BYPASS_ENV, "").strip().lower() in ("1", "true", "yes"):
        _log_bypass(dep, reason)
        print("[pre-push] BYPASSED via %s — logged to %s" % (BYPASS_ENV, BYPASS_LOG))
        print("[pre-push] what was overridden: %s" % reason)
        return 0

    print("[pre-push] %s" % reason)
    if verdict != OK:
        print("[pre-push] ⛔ REFUSING THE PUSH. One master merge at a time, repo-wide.")
        print("[pre-push]    Wait, then push again. Deliberate override: %s=1" % BYPASS_ENV)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
