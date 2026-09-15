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
# GUARD 2 — THE CLOCK (owner ruling A2, 2026-09-14)
# ═════════════════════════════════════════════════════════════════════════════

#: The closed window, ET, on trading days. Half-open: 09:25:00 is refused,
#: 16:05:00 is allowed. Owner ruling A2, verbatim: "refuses any master push
#: between 09:25 and 16:05 ET on trading days".
RTH_GUARD_OPEN = (9, 25)
RTH_GUARD_CLOSE = (16, 5)

#: ⛔ AN EXACT VALUE, NOT `=1`. Typing this is an act; typing `1` is a reflex.
CLOCK_OVERRIDE_ENV = "UCT_DEPLOY_WINDOW_OVERRIDE"
CLOCK_OVERRIDE_VALUE = "I-ACCEPT-AN-RTH-RESTART"

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


def next_allowed_et(now_et: "dt.datetime") -> "dt.datetime":
    """The concrete instant this push stops being refused: today's 16:05 ET.

    A refusal only ever happens INSIDE the window on a trading day, so the next
    allowed instant is always the window's close on the same date."""
    return now_et.replace(hour=RTH_GUARD_CLOSE[0], minute=RTH_GUARD_CLOSE[1],
                          second=0, microsecond=0)


def _hhmm(t) -> str:
    return "%02d:%02d" % t


def decide_clock(clock: dict, paths) -> tuple[str, str]:
    """(verdict, reason). Pure — the tests drive it directly, no git and no import."""
    if clock.get("state") == UNREADABLE:
        # ⛔ THE LOAD-BEARING BRANCH. A guard that passes when it cannot tell the
        # time is not a guard — it reports "fine" precisely when it has stopped
        # working, which is how 15:49 became 16:00 in somebody's head.
        return REFUSE, ("cannot determine the market clock (%s). REFUSING: a guard that "
                        "passes when it cannot tell the time is not a guard.\n"
                        "  next allowed:   UNKNOWN — fix the clock, or override deliberately "
                        "with %s=%s" % (clock.get("why"), CLOCK_OVERRIDE_ENV, CLOCK_OVERRIDE_VALUE))

    now_et = clock["now_et"]
    stamp = now_et.strftime("%Y-%m-%d %H:%M:%S ET")

    # ⛔⛔ R18 — THE RTH DEPLOY WINDOW IS RETIRED, PROGRAMME-WIDE.
    # Owner ruling, stated in chat 2026-09-15, entered by Claude (chat): "there are no
    # mid-day deploy blocks." The 09:25-16:05 ET refusal is withdrawn. This function no
    # longer gates on the clock at all — it reads it, reports it, and returns OK.
    #
    # ⛔ WHAT DID **NOT** CHANGE, AND WHY THIS IS NOT A WEAKER GUARD. Every other clause
    # stands untouched, and they are the ones that were actually load-bearing:
    #   * the CADENCE rail (600 s recency + 3 commits/hour burst) — the clause that
    #     catches the real failure, a push landing inside another deploy's 3-5 min build
    #     and marking it REMOVED mid-flight (2026-09-12 and 2026-09-14, both measured);
    #   * last web deploy SUCCESS, and no deploy in flight;
    #   * fail-closed on an unreadable clock or unreadable deploy history.
    # ⭐ The window was a PROXY for "do not disturb members", and it was a bad one: it
    # blocked a docs push at 11:00 and permitted two stacked merges at 16:06. The cadence
    # rail measures the thing the window was guessing at.
    #
    # ⚠️ THE UNREADABLE-CLOCK BRANCH ABOVE IS DELIBERATELY KEPT, and it is now the only
    # consumer of the clock. R18 lists "fail-closed on unreadable clock" among the clauses
    # to leave intact, so it stays — but a reader should know the tension: a guard that
    # refuses on a clock it no longer gates on is stricter than it needs to be. That is the
    # ruling's call, recorded here rather than quietly "improved".
    #
    # ⚠️ `RTH_GUARD_OPEN`/`_CLOSE`, `uncleared_paths` and `CLEARED_PREFIXES` are KEPT: the
    # Tier classification is still read by `docs/runbooks/deploy-windows.md`,
    # `tools/flow_worker_watch_coverage.py` and the JSON output. They no longer REFUSE.
    if not clock.get("trading_day"):
        return OK, ("%s is not a trading day (session=%s) — and since R18 the RTH deploy "
                    "window is retired anyway." % (stamp, clock.get("session")))
    n_paths = "unknown" if paths is None else str(len(paths))
    return OK, ("%s — the %s-%s ET deploy window is RETIRED (R18, owner ruling "
                "2026-09-15). %s changed path(s); cadence and deploy-state clauses still "
                "apply." % (stamp, _hhmm(RTH_GUARD_OPEN), _hhmm(RTH_GUARD_CLOSE), n_paths))


def _retired_rth_refusal(clock, paths):  # pragma: no cover - retained for history
    """⚰️ THE REFUSAL R18 RETIRED. Kept as a record of what the window used to say, and
    deliberately unreachable: `decide_clock` no longer calls it. Deleting it outright would
    leave the next reader unable to see what the rule WAS when they find R18 in a ledger."""
    now_et = clock["now_et"]
    stamp = now_et.strftime("%Y-%m-%d %H:%M:%S ET")
    if paths is None:
        why = ("the changed-path set could not be read (git did not answer), so the diff "
               "CANNOT be shown to be cleared")
        listed = "  not cleared:    UNKNOWN — git did not answer; an unread diff is never exempt"
    else:
        unclear = uncleared_paths(paths)
        if not paths:
            why = ("the diff is EMPTY, which is a failed measurement rather than a cleared "
                   "one — an empty result is a failed invocation until proven otherwise")
            listed = "  not cleared:    UNKNOWN — the diff came back empty; that is not the same as clean"
        else:
            shown = unclear[:6]
            more = "" if len(unclear) <= 6 else " (+%d more)" % (len(unclear) - 6)
            why = ("%d of %d changed path(s) are NOT cleared for a daytime push"
                   % (len(unclear), len(paths)))
            listed = "  not cleared:    %s%s" % (", ".join(shown), more)

    nxt = next_allowed_et(now_et)
    secs = max(0, int((nxt - now_et).total_seconds()))
    return REFUSE, "\n".join([
        "REFUSING A MASTER PUSH — the market is open and this diff is not cleared for daytime.",
        "  refused:        a push whose destination is master (it restarts web and chart-renderer)",
        "  now:            %s  (session=%s, a trading day)" % (stamp, clock.get("session")),
        "  window:         %s-%s ET on trading days" % (_hhmm(RTH_GUARD_OPEN), _hhmm(RTH_GUARD_CLOSE)),
        "  why:            %s" % why,
        listed,
        "  next allowed:   %s  — in %dm %02ds" % (nxt.strftime("%Y-%m-%d %H:%M:%S ET"),
                                                  secs // 60, secs % 60),
        "  cleared today:  docs/markdown, tests/**, tools/**, scripts/**, app/**  "
        "(docs/runbooks/deploy-windows.md, Tier 1)",
        "  deliberate override: %s=%s" % (CLOCK_OVERRIDE_ENV, CLOCK_OVERRIDE_VALUE),
    ])


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
    clock = read_clock()
    paths = changed_paths(a.base, a.head)
    cverdict, creason = decide_clock(clock, paths)
    clock_overridden = (cverdict != OK
                        and os.environ.get(CLOCK_OVERRIDE_ENV, "").strip() == CLOCK_OVERRIDE_VALUE)

    if cverdict != OK and not clock_overridden and not a.json:
        # ⛔ Return BEFORE asking Railway anything. A refused push has no queue
        # question to answer, and a guard that still spends 2s on the CLI teaches
        # everyone that the refusal is slow rather than that it is right.
        print("[pre-push] %s" % creason)
        return 1

    dep = latest_deployment()
    verdict, reason = decide(dep)
    cad = recent_deployments()
    kverdict, kreason = decide_cadence(cad)

    if a.json:
        print(json.dumps({
            "verdict": OK if (verdict == OK and cverdict == OK and kverdict == OK) else REFUSE,
            "cadence": {"verdict": kverdict, "reason": kreason,
                        "recent_window_s": RECENT_PUSH_WINDOW_SECONDS,
                        "burst_window_s": BURST_WINDOW_SECONDS,
                        "burst_min": BURST_MIN_DEPLOYS},
            "clock": {"verdict": cverdict, "reason": creason,
                      "session": clock.get("session"), "trading_day": clock.get("trading_day"),
                      "now_et": clock["now_et"].isoformat() if clock.get("now_et") else None,
                      "changed_paths": paths,
                      "uncleared": None if paths is None else uncleared_paths(paths)},
            "queue": {"verdict": verdict, "reason": reason, "deployment": dep},
        }, indent=1))
        return 0 if (verdict == OK and cverdict == OK and kverdict == OK) else 1

    if clock_overridden:
        # ⛔ LOUD. A window override is a member-visible restart during the session;
        # it should never scroll past unread.
        _log_bypass({"status": "CLOCK-WINDOW", "commit": clock.get("session")}, creason)
        print("=" * 78)
        print("[pre-push] ⚠️  DEPLOY WINDOW OVERRIDDEN via %s" % CLOCK_OVERRIDE_ENV)
        print("[pre-push] ⚠️  RESTARTING web AND chart-renderer DURING THE SESSION.")
        print("[pre-push] ⚠️  Logged to %s" % BYPASS_LOG)
        print("[pre-push] what was overridden:\n%s" % creason)
        print("=" * 78)
    else:
        print("[pre-push] %s" % creason)

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
