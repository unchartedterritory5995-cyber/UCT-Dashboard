#!/usr/bin/env python
"""Refuse a push to master while `web` is mid-swap, or while master is busy.

    python tools/pre_push_guard.py            # exit 0 = safe to push, 1 = refuse
    python tools/pre_push_guard.py --json

TWO GUARDS, TWO DIFFERENT FAILURES:

  1. ⚰️ **THE CLOCK — DELETED. There is no market-hours window.**
     Owner ruling 2026-09-17: *"I am sick of the no push window during market
     hours. Remove that from whatever is causing this every day. Remove that
     permanently."* R18 had retired the REFUSAL in 2026-09-15 while keeping the
     constants, the override env var and a log line that all still named
     09:25–16:05 — so every session reading this file re-learned a rule that no
     longer existed, and every prompt reading their output re-inherited it.
     Presence was the problem, not the predicate. All of it is now gone, and
     `tests/test_no_market_hours_window.py` fails the gate if it returns.

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

**Bypass** — deliberate, loud, and logged. ONE override, because there is one
thing left to override: the deploy queue.

    UCT_SKIP_PREPUSH_GUARD=1 git push origin HEAD:master                  # the QUEUE

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

#: R66 (D-18) — the GLOBAL levers are retired, because on 2026-09-17 the wrong one was reachable
#: and it got pulled. The guard already carried R19's SCOPED attestation (burst only, never
#: recency or in-flight, `pre_push_guard.py:635`), fully tested — including
#: `test_an_attestation_NEVER_satisfies_the_in_flight_clause`. It was not used. A global
#: `UCT_SKIP_PREPUSH_GUARD=1` was, and it waived every clause: the push landed while another
#: workstream's deploy was BUILDING, and a 502 was observed at 22:16:50Z.
#: ⭐ THE FIX IS NOT MORE CARE, IT IS FEWER LEVERS. A correct scoped mechanism beside a global
#: one is a correct mechanism nobody reaches for under time pressure.
WINDOW_OVERRIDE_ENV = "UCT_DEPLOY_WINDOW_OVERRIDE"
ROLLBACK_REASON_ENV = "UCT_ROLLBACK_REASON"


def _deploy_identity(dep: "dict | None") -> str:
    """R67: what makes two reads 'the same deploy state'. ⛔ id AND status AND timestamp — a
    deploy that flipped BUILDING→SUCCESS between the reads is a different world, and an identity
    that watched only the id would call it unchanged.

    ⚰️ THE KEY NAMES ARE `latest_deployment`'s, AND THE FIRST DRAFT INVENTED TWO OF THEM. It read
    `id` and `created_at` where the payload carries `id` and **`createdAt`**, so every SUCCESS
    row hashed to the same `-|SUCCESS|-` and the comparison could only ever see a STATUS change.
    A second read that cannot distinguish two different successful deploys is the proxy failure
    this guard exists to catch, wearing the costume of the fix."""
    d = dep or {}
    return "%s|%s|%s" % (d.get("id") or "-", d.get("status") or "-", d.get("createdAt") or "-")


def _head_message(head: "str | None") -> str:
    """The commit message of what is being pushed. Empty on any failure — unreadable is never a
    pass, and the caller treats empty as 'not a revert'."""
    exe = shutil.which("git")          # ⛔ resolved, never shell=True (the .cmd-shim trap)
    if not exe:
        return ""
    try:
        out = subprocess.run([exe, "-C", str(ROOT), "log", "-1", "--format=%B", head or "HEAD"],
                             capture_output=True, text=True, errors="replace", timeout=20)
        return out.stdout if out.returncode == 0 else ""
    except Exception:  # noqa: BLE001
        return ""


def window_override_present() -> bool:
    """⛔ The deploy WINDOW it overrode was retired by owner ruling (R18, 2026-09-15). A variable
    that overrides a gate which no longer exists is a loaded lever pointing at the gates that DO:
    its presence is now an error, not a no-op."""
    return bool((os.environ.get(WINDOW_OVERRIDE_ENV) or "").strip())


def rollback_intent(head_message: str, production_commit: "str | None") -> dict:
    """R66: `UCT_SKIP_PREPUSH_GUARD` survives for ONE purpose — reverting what is live right now.

    ⛔ Three conditions, all required, because any two of them are satisfiable by an ordinary
    push in a hurry: a stated reason, a commit that says in its own body which commit it reverts,
    and that commit being the one PRODUCTION IS SERVING. A revert of something that is not live
    is an ordinary change and waits like one.

    ⭐ The production commit comes from the deploy record, not from a branch name — `origin/
    production` can move under us, and what matters is what members are being served."""
    reason = (os.environ.get(ROLLBACK_REASON_ENV) or "").strip()
    if not reason:
        return {"ok": False, "why": "%s is not set — a bypass with no stated reason is not a "
                                    "rollback, it is a bypass" % ROLLBACK_REASON_ENV}
    if not production_commit:
        return {"ok": False, "why": "the live commit could not be read, so 'reverts what is live' "
                                    "cannot be established — unreadable is never a pass"}
    body = head_message or ""
    marker = "This reverts commit "
    reverted = ""
    for line in body.splitlines():
        if line.strip().startswith(marker):
            reverted = line.strip()[len(marker):].strip().rstrip(".")
            break
    if not reverted:
        return {"ok": False, "why": "HEAD does not say %r — git writes that line for a real "
                                    "revert, and a hand-written message is not one" % marker.strip()}
    n = min(len(reverted), len(production_commit), 12)
    if reverted[:n].lower() != production_commit[:n].lower():
        return {"ok": False, "why": "HEAD reverts %s but production is serving %s — a revert of "
                                    "something that is not live waits like any other change"
                                    % (reverted[:12], production_commit[:12])}
    return {"ok": True, "why": "rollback of the live commit %s: %s" % (production_commit[:12], reason),
            "reason": reason, "reverts": reverted[:12]}
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


def _forget_rows() -> None:
    """R67's second read must reach the CLI, not the memo.

    ⚰️ Without this the second read is STRUCTURALLY VACUOUS: `latest_deployment()` goes through
    `_read_rows()`, the memo answers from the first call's bytes, the two identities are equal by
    construction, and the guard prints nothing while proving nothing. The unit tests could never
    have seen it — they monkeypatch `latest_deployment` itself, so the memo is not in their path
    at all. ⭐ The memo's own reason (guard 2 and guard 3 must describe ONE world in one refusal
    message) is still right and is why this is an explicit, narrow forget rather than its
    deletion: the deliberate re-read happens after both of those have spoken."""
    _ROWS_MEMO.clear()


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
            # ⛔ `id` is carried for R67's second read ONLY. `decide()` does not look at it, and
            # must not: two deploys of the SAME commit are two different deploys.
            "id": d.get("id"),
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


#: R19 — the BURST clause's documented exit. Two variables, because an attestation is
#: a statement by a person at a time, and half of it is not a statement.
ATTEST_BY_ENV = "UCT_BURST_ATTESTED_BY"
ATTEST_AT_ENV = "UCT_BURST_ATTESTED_AT"
#: How stale an attestation may be. An owner who looked at the queue twenty minutes ago
#: has not looked at THIS queue — three other workstreams push to this repo.
ATTEST_MAX_AGE_SECONDS = 900


def read_attestation(now: "dt.datetime | None" = None) -> dict:
    """The owner's burst attestation, validated. Pure — the tests drive it directly.

    ⛔⛔ THIS EXITS THE BURST CLAUSE AND NOTHING ELSE. The burst refusal's own text asks
    for "a human who can see every workstream, not a guard" — this is that human saying
    they looked. It can never satisfy recency (a build really is in flight), the
    in-flight/SUCCESS clause, or any fail-closed path: those are measurements of the
    world, and no amount of looking changes them.

    ⭐ TWO VARIABLES ON PURPOSE. A name alone is a standing grant that would sit in a
    shell profile forever; a time alone is anonymous. Together they are a statement by a
    named person at a named minute, which is what a log entry has to carry to be worth
    keeping."""
    now = now or dt.datetime.now(dt.timezone.utc)
    by = (os.environ.get(ATTEST_BY_ENV) or "").strip()
    at_raw = (os.environ.get(ATTEST_AT_ENV) or "").strip()
    if not by and not at_raw:
        return {"state": "ABSENT", "why": "no attestation offered"}
    if not by or not at_raw:
        missing = ATTEST_BY_ENV if not by else ATTEST_AT_ENV
        return {"state": "INVALID", "why": "%s is set without %s — half an attestation is "
                                           "not an attestation" % (
                                               ATTEST_AT_ENV if not by else ATTEST_BY_ENV, missing)}
    at = _iso(at_raw)
    if at is None:
        return {"state": "INVALID", "why": "%s=%r is not an ISO timestamp" % (ATTEST_AT_ENV, at_raw[:40])}
    age = (now - at).total_seconds()
    if age > ATTEST_MAX_AGE_SECONDS:
        return {"state": "STALE", "by": by, "at": at,
                "why": "attested %dm ago; an attestation older than %dm is not about THIS queue"
                       % (int(age // 60), ATTEST_MAX_AGE_SECONDS // 60)}
    if age < -60:
        return {"state": "INVALID", "by": by, "at": at,
                "why": "attested %ds in the FUTURE — a clock disagreement, not an attestation"
                       % int(-age)}
    return {"state": "VALID", "by": by, "at": at,
            "why": "attested by %s at %s (%ds ago)" % (by, at.isoformat(timespec="seconds"), int(max(0, age)))}


def _log_bypass(dep: dict, reason: str, *, code: str = "") -> None:
    """⭐ R20 — `reason_code` is MACHINE-READABLE and sits beside the prose.

    The prose says what was overridden in words a person reads; the code says which
    clause in a token a script can count. A log that only carries prose cannot answer
    "how many window overrides last month" without someone grepping sentences that
    change whenever the message is reworded."""
    try:
        BYPASS_LOG.parent.mkdir(parents=True, exist_ok=True)
        with BYPASS_LOG.open("a", encoding="utf-8") as fh:
            fh.write("%s  user=%s  status=%s commit=%s  reason_code=%s  overrode: %s\n"
                     % (dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                        os.environ.get("USERNAME") or os.environ.get("USER") or "?",
                        dep.get("status"), dep.get("commit"), code or "UNSPECIFIED", reason))
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


def decide_cadence(dep: dict, *, now: "dt.datetime | None" = None,
                   clause: "dict | None" = None) -> tuple[str, str]:
    """(verdict, reason). Pure — the tests drive it directly.

    ⛔ FAIL CLOSED on every unreadable path, including "rows came back but not one
    timestamp parsed". An empty answer and a quiet master are the same shape from
    here, and only one of them is safe.

    ⭐ `clause` is an optional OUT-DICT naming WHICH clause decided, filled with
    `{"name": "unreadable"|"unparsable"|"recency"|"burst"|"quiet"}`. R19 lets the owner
    attest past the BURST clause and nothing else, and a caller cannot honour that
    distinction by reading prose. Same idiom as the breadth drill-list `members`
    out-dict: the decision and its label come from ONE pass, so they cannot drift."""
    def _clause(name):
        if clause is not None:
            clause["name"] = name
        return name

    if dep.get("state") == UNREADABLE:
        _clause("unreadable")
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
        _clause("unparsable")
        return REFUSE, ("the %s deployment list carried %d row(s) and not one readable "
                        "(commit, timestamp) pair — REFUSING rather than reading that as quiet."
                        % (SERVICE, len(rows)))

    # ── clause 1: RECENCY ────────────────────────────────────────────────────
    for c, (t, r) in sorted(seen.items(), key=lambda kv: kv[1][0], reverse=True):
        age = (now - t).total_seconds()
        if 0 <= age < RECENT_PUSH_WINDOW_SECONDS:
            _clause("recency")
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
        _clause("burst")
        newest = sorted(burst, key=lambda ct: ct[1], reverse=True)
        return REFUSE, ("%d distinct %s deploys in the last %d min (%s) — master is under "
                        "concurrent development and a build may be in flight from a session "
                        "this one cannot see. This is the D-05 shape; it needs a human who "
                        "can see every workstream, not a guard."
                        % (len(burst), SERVICE, BURST_WINDOW_SECONDS // 60,
                           ", ".join(c for c, _ in newest[:4])))

    n_recent = len(burst)
    _clause("quiet")
    return OK, ("%d %s deploy(s) in the last %d min, none inside %ds — master is quiet."
                % (n_recent, SERVICE, BURST_WINDOW_SECONDS // 60, RECENT_PUSH_WINDOW_SECONDS))


# ═════════════════════════════════════════════════════════════════════════════
# GUARD 2 — THE CLOCK (owner ruling A2, 2026-09-14)
# ═════════════════════════════════════════════════════════════════════════════


# ⛔⛔ DERIVED FROM `docs/runbooks/deploy-windows.md`, NOT INVENTED. The runbook is
# the single authority on push timing; these two lines are quoted from it verbatim
# (lines 13-14 at 2026-09-14):
#
#     ### Tier 1 — push any time
#     Docs, markdown, `tests/**`, `tools/**`, `scripts/**`, and frontend (`app/**`).
#
# and the sentence under them that says what that costs:
#
#     These restart **web only** (and only if web's watch paths match — see below). Cost:
#     `/api/*` blips for roughly a minute […] Acceptable.
#
# "Docs, markdown" is two clauses, so BOTH are honoured: anything under `docs/`,
# and any `.md` file wherever it lives. ⚠️ If the runbook's Tier 1 list moves, this
# tuple is wrong the same day — `tests/test_pre_push_guard.py` reads the runbook and
# fails when the two disagree, so the drift is caught rather than inherited.
CLEARED_PREFIXES = ("docs/", "tests/", "tools/", "scripts/", "app/")
CLEARED_SUFFIXES = (".md",)


def _freshness():
    """THE market clock — `api/services/discord_render/freshness.py`.

    ⛔⛔ IMPORTED, NEVER COPIED. A second "is the market open" is the defect this
    repo has paid for repeatedly (`lesson_a_second_authority_over_one_value`), and
    the holiday set in particular has exactly one owner: `freshness.is_holiday`
    imports `bars_fetch._NYSE_HOLIDAYS_YYYYMMDD` rather than keeping a table.

    ⭐ THE IMPORT IS LAZY AND THAT IS THE WHOLE COST STORY. Importing `freshness`
    itself is 0.05 s / ~100 modules — nothing. But `session_state` calls
    `is_holiday`, which pulls `api.services.bars_fetch` (and through it fastapi,
    httpx, the massive client): **1.26 s and ~1,200 modules, measured**. That is
    paid once per weekday guard run and is the price of asking the real clock
    instead of writing a second one. It is deliberately NOT paid at module import,
    so `--audit` and the unit tests never touch it.

    ⚠️ Those modules compute `/data/...` paths at import; none of them OPEN a file,
    so this import is filesystem-inert (audited by AST, 2026-09-14). If that ever
    stops being true, this becomes the wrong door and the right answer is to move
    the holiday set, not to copy it.
    """
    root = str(ROOT)
    if root not in sys.path:
        sys.path.insert(0, root)
    from api.services.discord_render import freshness
    return freshness


def read_clock(now: "dt.datetime | None" = None) -> dict:
    """What the market clock says, or UNREADABLE and why.

    ⛔ It answers exactly ONE question from `freshness`: *is today a trading day?*
    The 09:25/16:05 window is this guard's own deploy policy and is deliberately
    NOT `session_state == "rth"` — the window is wider than the session on both
    ends, and re-deriving the session here would be the second copy."""
    try:
        fr = _freshness()
        state = fr.session_state(now)
        # `_et` is freshness's own naive/aware normaliser. Re-implementing the two
        # lines it contains would put a second authority on "what time is it in ET".
        now_et = fr._et(now)
        trading = state not in (fr.WEEKEND, fr.HOLIDAY)
    except Exception as e:                                   # noqa: BLE001
        return {"state": UNREADABLE,
                "why": "%s: %s" % (type(e).__name__, str(e)[:160] or "no detail")}
    return {"state": "READ", "session": state, "trading_day": trading, "now_et": now_et}


def changed_paths(base: str | None = None, head: str | None = None) -> "list[str] | None":
    """Repo-relative paths this push would land on master, or **None** when git
    could not say.

    ⛔⛔ `None` AND `[]` ARE DIFFERENT AND THE DIFFERENCE IS THE GUARD. An empty
    result is a failed invocation until proven otherwise: a diff that comes back
    empty because the pathspec resolved wrong, or because the range was nonsense,
    would otherwise read as "nothing outside the cleared list" — i.e. the exemption
    would fire hardest exactly when the measurement broke."""
    exe = shutil.which("git")
    if not exe:
        return None
    rng = "%s...%s" % (base or "origin/master", head or "HEAD")
    try:
        r = subprocess.run([exe, "-C", str(ROOT), "diff", "--name-only", "--no-renames", rng],
                           capture_output=True, text=True, timeout=60,
                           encoding="utf-8", errors="replace")
    except Exception:                                        # noqa: BLE001
        return None
    if r.returncode != 0:
        return None
    return sorted({ln.strip() for ln in (r.stdout or "").splitlines() if ln.strip()})


def is_cleared(path: str) -> bool:
    """Is one path cleared for a daytime push by the runbook's Tier 1 list?"""
    p = path.replace("\\", "/").lstrip("./")
    return p.startswith(CLEARED_PREFIXES) or p.lower().endswith(CLEARED_SUFFIXES)


def uncleared_paths(paths) -> list[str]:
    return sorted(p for p in paths if not is_cleared(p))




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

    # ── THE CLOCK first: it costs no network, and it is the one the owner ruled on.
    # ⛔ THERE IS NO CLOCK GATE. `read_clock` is kept for REPORTING only (the JSON's
    # session/trading_day fields); nothing here refuses on the time of day, and nothing
    # prints a window. Owner ruling 2026-09-17, permanent. See the module docstring.
    clock = read_clock()
    paths = changed_paths(a.base, a.head)


    dep = latest_deployment()
    verdict, reason = decide(dep)
    cad = recent_deployments()
    kclause: dict = {}
    kverdict, kreason = decide_cadence(cad, clause=kclause)

    # ── R19: the owner may attest past the BURST clause, and nothing else ──────
    attest = read_attestation()
    burst_attested = (kverdict != OK
                      and kclause.get("name") == "burst"
                      and verdict == OK            # in-flight / SUCCESS, independently
                      and attest.get("state") == "VALID")
    if burst_attested:
        kverdict = OK
        kreason = ("BURST ATTESTED by %s — %s | the burst clause asked for a human who "
                   "can see every workstream; this is that human. Recency and in-flight "
                   "passed on their own and were NOT overridden."
                   % (attest["by"], kreason.splitlines()[0]))

    if a.json:
        print(json.dumps({
            "verdict": OK if (verdict == OK and kverdict == OK) else REFUSE,
            "cadence": {"verdict": kverdict, "reason": kreason,
                        "clause": kclause.get("name"),
                        "attestation": {k: (v.isoformat() if hasattr(v, "isoformat") else v)
                                        for k, v in attest.items()},
                        "recent_window_s": RECENT_PUSH_WINDOW_SECONDS,
                        "burst_window_s": BURST_WINDOW_SECONDS,
                        "burst_min": BURST_MIN_DEPLOYS},
            "clock": {"gate": "REMOVED (owner ruling 2026-09-17)",
                      "session": clock.get("session"), "trading_day": clock.get("trading_day"),
                      "now_et": clock["now_et"].isoformat() if clock.get("now_et") else None,
                      "changed_paths": paths,
                      "uncleared": None if paths is None else uncleared_paths(paths)},
            "queue": {"verdict": verdict, "reason": reason, "deployment": dep},
        }, indent=1))
        return 0 if (verdict == OK and kverdict == OK) else 1

    if burst_attested:
        # ⛔ LOGGED VERBATIM. An attestation nobody can review afterwards is a
        # permission that was never really asked for.
        _log_bypass(dep, "BURST attested: %s" % attest["why"], code="BURST-ATTESTED")
        print("=" * 78)
        print("[pre-push] ⚠️  BURST CLAUSE ATTESTED by %s" % attest["by"])
        print("[pre-push] ⚠️  %s" % attest["why"])
        print("[pre-push] ⚠️  recency and in-flight passed on their own — NOT overridden.")
        print("[pre-push] ⚠️  Logged to %s" % BYPASS_LOG)
        print("=" * 78)
    elif attest.get("state") == "VALID":
        # ⛔ VALID BUT NOT APPLICABLE IS NOT "REJECTED", and saying so would teach the
        # owner that their attestation was somehow malformed when it was fine — the
        # clause that refused simply is not the one an attestation can exit.
        print("[pre-push] attestation NOT APPLIED (%s) — it exits the BURST clause only, "
              "and the refusal here is %r." % (attest.get("why"), kclause.get("name")))
    elif attest.get("state") not in (None, "ABSENT"):
        print("[pre-push] attestation REJECTED (%s): %s"
              % (attest.get("state"), attest.get("why")))

    # ── R66: the retired global window override is an ERROR, never a no-op ────
    if window_override_present():
        print("[pre-push] ⛔ %s is set. The deploy WINDOW it overrode was retired (R18, "
              "2026-09-15), so this variable now only points at the gates that remain."
              % WINDOW_OVERRIDE_ENV)
        print("[pre-push]    Unset it. To pass a BURST-only refusal use the scoped attestation: "
              "%s and %s." % (ATTEST_BY_ENV, ATTEST_AT_ENV))
        return 1

    # ── R66: the global skip survives for ROLLBACK ONLY ───────────────────────
    if os.environ.get(BYPASS_ENV, "").strip().lower() in ("1", "true", "yes"):
        intent = rollback_intent(_head_message(a.head), (dep or {}).get("commit"))
        if not intent["ok"]:
            print("[pre-push] ⛔ %s is ROLLBACK-ONLY since D-18. %s"
                  % (BYPASS_ENV, intent["why"]))
            print("[pre-push]    ⚰️ On 2026-09-17 this lever waived EVERY clause — including the "
                  "in-flight one — and the push landed inside another workstream's swap.")
            print("[pre-push]    For a BURST-only refusal use the scoped attestation: %s and %s."
                  % (ATTEST_BY_ENV, ATTEST_AT_ENV))
            return 1
        # ⛔ BOTH reasons are logged. Overriding a queue refusal and overriding a
        # cadence refusal are different acts, and a log that records only the first
        # cannot tell the reviewer which one was waved through.
        _log_bypass(dep, "ROLLBACK: %s | %s" % (
            intent["reason"],
            "; ".join(r for v, r in ((verdict, reason), (kverdict, kreason)) if v != OK) or reason),
            code="ROLLBACK")
        print("[pre-push] ROLLBACK allowed via %s — logged to %s" % (BYPASS_ENV, BYPASS_LOG))
        print("[pre-push] %s" % intent["why"])
        return 0

    print("[pre-push] %s" % reason)
    print("[pre-push] %s" % kreason)
    if verdict != OK or kverdict != OK:
        print("[pre-push] ⛔ REFUSING THE PUSH. One master merge at a time, repo-wide.")
        if kclause.get("name") == "burst" and verdict == OK:
            print("[pre-push]    This is a BURST-only refusal with recency and in-flight passing "
                  "on their own. A human who can see every workstream may attest: set %s and %s "
                  "(ISO, within %dm) and push again."
                  % (ATTEST_BY_ENV, ATTEST_AT_ENV, ATTEST_MAX_AGE_SECONDS // 60))
        else:
            print("[pre-push]    Wait, then push again. ⛔ No lever waives this: an attestation "
                  "exits the BURST clause only, and %s is rollback-only." % BYPASS_ENV)
        return 1

    # ── R67: THE LAST ACT IS A SECOND READ, AND THE PUSH RIDES THIS SAME PROCESS ──
    # ⚰️ 2026-09-17: the guard was read, reported "710s settled — safe to push, nothing
    # building", and by the time the push executed another workstream's deploy had started and
    # was BUILDING. The first read was TRUE and USELESS — the world moved between the check and
    # the act. ⭐ Re-reading as the last statement before returning 0 does not remove the race
    # (nothing inside one process can), but it shrinks the window from "however long the human
    # took" to "one API round trip", and it REFUSES rather than guesses when the two disagree.
    _forget_rows()
    dep2 = latest_deployment()
    if _deploy_identity(dep2) != _deploy_identity(dep):
        print("[pre-push] ⛔ THE DEPLOY STATE CHANGED WHILE THIS GUARD RAN — refusing.")
        print("[pre-push]    first read : %s" % _deploy_identity(dep))
        print("[pre-push]    second read: %s" % _deploy_identity(dep2))
        print("[pre-push]    Something started deploying between the two reads. Wait for it.")
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
