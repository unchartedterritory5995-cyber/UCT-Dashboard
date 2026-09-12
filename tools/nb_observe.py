"""Wave Q1 — the unattended observation sampler.

⛔⛔ WHY A TOOL AND NOT A PERSON. The 7-day window's Sunday gate is a READ of a
table. A table somebody has to remember to fill is a table with holes in it, and
a hole is indistinguishable from a quiet interval — which is the exact shape this
wave has been burned by five times. This appends one row every two hours whether
anyone is awake or not.

⛔ IT DRIVES THE RIG'S ONE SIGNED-IN PROFILE. There is no unauthenticated view of
any of these figures: the telemetry counts are admin-gated (ADMIN_EMAILS) and the
note counts need the account. So this reuses the single persistent profile, and
`spawn_rig` REFUSES when that profile is locked — a collision with a manual
canary writes a SKIPPED row with its reason rather than corrupting anything.

⛔ THE RIG STAYS OPTED OUT. It never sets the flag, so it never fires an opt-in
event and never enters the denominator. That is deliberate: a rig that opted in
would resemble one fake member, and the count exists to size REAL ones.
"""
from __future__ import annotations

import datetime
import os
import pathlib
import sys
import traceback

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import window_check as wc                                    # noqa: E402

# ⛔ THE LOG PATH IS NOT TIED TO A WORKTREE. This sampler runs unattended for a
# week; a worktree can be removed in that time and the job would then fail with
# nothing but Task Scheduler's exit code to say so. `NB_OBSERVE_LOG` names the
# file explicitly; the fallback sits beside the script, wherever that is.
_env = os.environ.get("NB_OBSERVE_LOG", "").strip()
LOG = (pathlib.Path(_env) if _env
       else pathlib.Path(__file__).resolve().parent / "wave-q1-observation-log.md")
OPT_IN = "j2:notebook_offline_opt_in"

# ⛔⛔ ATTRIBUTION BY IDENTITY, NOT BY CLOCK. The gate excluded rig activity by
# CANARY TIMING alone, and on 2026-09-12 it reported the owner's own 14:00:28
# opt-in as "FIRST MEMBER OPT-IN" - 27 minutes from any canary, so the timing
# rule could not see it. The feed carries an email; use it.
#
#   unchartedterritory5995@gmail.com  the owner AND the rig share this account.
#                                     Canary runs, probes, and the owner's own
#                                     human browsing all land here. None of them
#                                     is an independent member.
#   smoke@uctintelligence.internal    another workstream's post-deploy smoke.
#
# ⭐ A MEMBER is an opt-in from NEITHER of these. That is the only number the
# "zero blocked-baseline events" claim may be divided by.
NOT_A_MEMBER = ("unchartedterritory5995@gmail.com", "smoke@uctintelligence.internal")
BLOCKED = "j2:notebook_blocked_no_baseline"

# ⚰️ THE SUBTRACTION THAT COULD ONLY EVER SAY ZERO.
#
# This began as `member = total - RIG_OPT_IN_BASELINE`, baseline 20, measured at
# 2026-09-12T05:17:56Z. Then the log showed total going 20 -> 19, and counts do
# not decrease: `/api/auth/admin/activity?limit=200` is a WINDOW, and old rows
# roll off it. So the subtraction is broken in the one direction that matters -
# a member event arriving while another rolls off leaves total unchanged and
# `member` reading 0, which is indistinguishable from nobody having come.
#
# ⛔ A COLUMN THAT CAN ONLY SAY ZERO IS NOT EVIDENCE. What is trustworthy in a
# windowed feed is the LATEST timestamp: it moves when something new arrives,
# whatever rolled off the back. The log now carries that, and the reader
# compares it against the known canary times rather than trusting a difference.
RIG_OPT_IN_BASELINE = 20

HEADER = """# Wave Q1 — observation log

Appended by `tools/nb_observe.py`, every 2 hours, unattended. **Numbers, not
hypotheses.** One row per run; a run that could not take the rig profile writes a
SKIPPED row with its reason, so a gap in this log is never silent.

⛔ **Outbox stuck >5 min is not observable fleet-wide and the rig runs opted out.
It is covered only by real-door canary runs (rig, layer on) and by member
reports. A canary any time this weekend fills that datapoint; the sampler does
not.**

⛔ **`opt-in (windowed)` IS NOT A LIFETIME COUNT.** It reads the last 200
population activity rows, so it can DECREASE as old events roll off — it did,
20 → 19, which is what exposed the original `member = total − %d` column as one
that could only ever say zero. **Read `latest opt-in` instead:** it moves when a
new event arrives regardless of roll-off. Every opt-in up to
`2026-09-12 05:17:56` was the rig opting itself in and out during canary runs;
the rig never opts in during a sampler run, so a latest NEWER than that, with no
canary running, is a REAL MEMBER.

| at (ET) | latest opt-in (UTC) | opt-in (windowed) | blocked-baseline | sync-conflict notes | outbox (rig only, layer off — structurally 0) | console errors (rig) | flag |
|---|---|---|---|---|---|---|---|
""" % RIG_OPT_IN_BASELINE


def et_now() -> str:
    # ⛔ ET, because the Sunday gate is stated in ET and a log in UTC invites the
    # reader to do arithmetic at the moment they least want to.
    return datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=-4))).strftime("%Y-%m-%d %H:%M ET")


def row(at, latest, total, blocked, conflicts, outbox, errors, flag) -> str:
    return f"| {at} | {latest} | {total} | {blocked} | {conflicts} | {outbox} | {errors} | {flag} |\n"


def append(line: str) -> None:
    """⛔⛔ NEVER TRUNCATES. This function used to rewrite the file whenever the
    header did not match the current one — which meant that CHANGING A COLUMN
    SILENTLY DESTROYED EVERY ROW ALREADY RECORDED. It did, on 2026-09-12: five
    rows of real observation data (01:20 through 09:00 ET) were replaced by a
    fresh header the moment the member column was corrected.

    ⛔ An append-only log that can rewrite itself is not append-only, and a log
    that loses history when its schema changes loses it exactly when someone is
    improving the instrument. The header is now written ONLY into a file that
    does not exist or is empty; a schema change appends a new header block and
    leaves everything above it alone.
    """
    LOG.parent.mkdir(parents=True, exist_ok=True)
    existing = LOG.read_text(encoding="utf-8") if LOG.exists() else ""
    if not existing.strip():
        LOG.write_text(HEADER, encoding="utf-8")
    elif HEADER.split("|")[0] not in existing:
        # ⭐ Schema changed: a NEW header block, appended. Old rows stay readable
        # and stay labelled by the header that was above them when written.
        with LOG.open("a", encoding="utf-8") as fh:
            fh.write(chr(10) + HEADER)
    with LOG.open("a", encoding="utf-8") as fh:
        fh.write(line)


OPTIN_JS = """async (excluded) => {
  const r = await fetch('/api/auth/admin/activity?limit=200', {credentials:'include'});
  if (!r.ok) return {err: 'HTTP ' + r.status};
  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return {err: 'not JSON (deploy blip?)'};
  const j = await r.json();
  const rows = Array.isArray(j) ? j : (j.rows || j.activity || []);
  const hits = rows.filter(x => String(x.action).includes('notebook_offline_opt_in'));
  const indep = hits.filter(x => !excluded.includes(String(x.email || '').toLowerCase()));
  return {
    total: hits.length,
    latest: hits.length ? hits[0].created_at : null,
    memberCount: indep.length,
    memberLatest: indep.length ? indep[0].created_at : null,
    memberWho: indep.length ? String(indep[0].email || '').split('@')[0] + '@…' : null,
  };
}"""

NOTES_JS = """async () => {
  const r = await fetch('/api/j2/notes?limit=300', {credentials:'include'});
  if (!r.ok) return {err: 'HTTP ' + r.status};
  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return {err: 'not JSON (deploy blip?)'};
  const j = await r.json();
  const notes = j.notes || j.items || [];
  return {conflicts: notes.filter(n => (n.tags||[]).includes('sync-conflict')).length};
}"""


def main() -> int:
    wc.use_profile(wc.resolve_profile())
    at = et_now()
    try:
        released, held = wc.profile_lock_released(timeout=5)
        if not released:
            append(row(at, "—", "—", "—", "—", "—", "—",
                       f"**SKIPPED** — rig profile busy ({', '.join(held)})"))
            print("SKIPPED: profile busy")
            return 0
    except Exception as e:                                   # noqa: BLE001
        append(row(at, "—", "—", "—", "—", "—", "—", f"**SKIPPED** — {type(e).__name__}"))
        return 0

    from playwright.sync_api import sync_playwright
    errors: list[str] = []
    proc = endpoint = None
    try:
        proc, endpoint, _ = wc.spawn_rig()
        with sync_playwright() as pw:
            b = pw.chromium.connect_over_cdp(endpoint)
            ctx = b.contexts[0]
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            # ⛔ ATTACHED BEFORE goto, so an exception thrown while the BUNDLE is
            # evaluating is caught. A broken flipped bundle fails before the
            # offline layer would ever run, and that is the 2am case this exists
            # to notice.
            page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
            page.on("console", lambda m: errors.append(f"console.error: {m.text}") if m.type == "error" else None)

            page.goto(wc.PROD + "/journal/notebook", wait_until="domcontentloaded")
            page.wait_for_timeout(9000)

            act = page.evaluate(wc.ACTIVITY_JS, [OPT_IN, BLOCKED])
            total = (act.get(OPT_IN) or {}).get("count", "ERR")
            oi = page.evaluate(OPTIN_JS, [e.lower() for e in NOT_A_MEMBER])
            latest = oi.get("latest") or "—"
            members = oi.get("memberCount", "ERR")
            member_latest = oi.get("memberLatest") or "—"
            blocked = (act.get(BLOCKED) or {}).get("count", "ERR")
            notes = page.evaluate(NOTES_JS)
            conflicts = notes.get("conflicts", f"ERR ({notes.get('err')})")


            # ⛔⛔ A READING THAT COULD NOT BE TAKEN IS NOT A FINDING.
            #
            # Production 502s for ~1-2 min on every Tier 1 deploy, and another
            # workstream pushes several times an hour. A sampler row taken during
            # one reads: every figure ERR, console full of "Failed to load
            # resource: 502". Flagged as ANOMALY, that row makes the Sunday gate
            # return REVERT - a rollback of a healthy product because someone
            # else deployed at 17:05. Same distinction the canary already needed
            # for its post-door read.
            unreachable = (not isinstance(total, int)) and any("502" in e or "503" in e for e in errors)
            if unreachable:
                append(row(at, "—", "—", "—", "—", "—", len(errors),
                           "**SKIPPED** — production unreachable (HTTP 5xx, deploy in flight); "
                           "not a finding, and not evidence of a clean interval either"))
                print(f"{at}  SKIPPED - production 5xx")
                return 0

            reasons = []
            if errors:
                reasons.append(f"{len(errors)} console/page error(s): {errors[0][:90]}")
            if isinstance(blocked, int) and blocked > 0:
                reasons.append(f"blocked-baseline events = {blocked}")
            flag = "OK" if not reasons else "**ANOMALY** — " + " · ".join(reasons)

            append(row(at, f"{latest} · members {members}" + ("" if members in (0, "ERR") else f" (latest {member_latest})"),
                       total, blocked, conflicts, 0, len(errors), flag))
            print(f"{at}  latest={latest} members={members} total={total} blocked={blocked} conflicts={conflicts} errors={len(errors)} {flag}")
    except Exception as e:                                   # noqa: BLE001
        append(row(at, "—", "—", "—", "—", "—", "—",
                   f"**SKIPPED** — {type(e).__name__}: {str(e)[:80]}"))
        traceback.print_exc()
    finally:
        try:
            wc.teardown()
        except Exception:                                    # noqa: BLE001
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
