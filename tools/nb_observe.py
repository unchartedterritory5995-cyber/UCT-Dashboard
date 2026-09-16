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
CONFIG_SERVED = "j2:notebook_config_served"

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
# =============================================================================
# THREE POPULATIONS, NEVER ONE "members" FIGURE. Owner ruling 2026-09-13.
# =============================================================================
# !!!! THIS WAS TWO LISTS AND A ROW COUNT, AND IT REPORTED OUR OWN TEST ACCOUNT
# AS SEVEN INDEPENDENT MEMBERS.
#
# On 2026-09-13 the 15:00 ET row read `members 7`. Every one of the seven was
# the T-12 smoke account: `/api/auth/export-data` on that account shows exactly
# those seven `notebook_offline_opt_in` rows, 17:51:57 -> 18:14:46 UTC, matching
# the seven T-12 runs. Two faults let it happen:
#   1. the exclusion list held `smoke@...` but not `member-smoke@...` -- two
#      different accounts, 30 and 37 characters, one excluded and one not;
#   2. the count was `indep.length` -- ROWS, not identities -- while the
#      config-served column beside it is explicitly BY IDENTITY. One real
#      member with seven tabs would have read as seven members too.
#
# * So the sampler now reports THREE numbers, every time, and never adds them:
#
#   ORGANIC   a person who is not us. The ONLY number the K window's "zero
#             blocked-baseline events" claim may be divided by.
#   SYNTHETIC an account WE provisioned. It proves the path is reachable and
#             proves nothing about adoption, so it is counted and shown --
#             never excluded into invisibility, never folded into organic.
#   RIG/OWNER the instrument and the owner's own browsing. Never a member.
RIG_AND_OWNER = ("unchartedterritory5995@gmail.com",)

# !! BY FULL EMAIL, NEVER BY PREFIX. A `startswith("smoke")` test would have
# caught `member-smoke@` only by luck, and a substring test would silently
# swallow a real member whose address happened to contain one of these.
SYNTHETIC_MEMBERS = (
    "smoke@uctintelligence.internal",            # the post-deploy client smoke
    "member-smoke@uctintelligence.internal",     # T-12's independent-member view
)

# !!!! AN UNKNOWN ADDRESS ON OUR OWN INTERNAL DOMAIN IS FLAGGED, NOT COUNTED AS
# ORGANIC. `.internal` is reserved (RFC 8375) and unroutable, so nobody outside
# this programme can hold one -- a new one is a synthetic account somebody
# provisioned without telling this list. Counting it as organic would be the
# same defect arriving from a new address, and staying silent is how it
# arrives. It lands in its own bucket and says so.
INTERNAL_DOMAIN = "@uctintelligence.internal"

# Kept as the union, because several call sites still ask "is this a member at
# all" -- derived, so the two can never disagree.
NOT_A_MEMBER = RIG_AND_OWNER + SYNTHETIC_MEMBERS
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

⛔⛔ **THREE POPULATIONS, NEVER ONE `members` FIGURE** (owner ruling 2026-09-13).
Column 2 reads `organic N · synthetic M · rig/owner K`, counted **by distinct
identity** and never summed. **ORGANIC** is a person who is not us, and is the
only number the *zero blocked-baseline events* claim may be divided by.
**SYNTHETIC** is an account we provisioned: it proves the path is reachable and
says nothing about adoption. **RIG/OWNER** is the instrument and the owner's own
browsing.

⚰️ It was one number, counted by ROW, and on 2026-09-13 it reported our own T-12
smoke account as **seven independent members** — 7 events from 1 identity, and
that identity was not on the exclusion list because it is `member-smoke@…`, not
`smoke@…`. ⭐ **Seven opt-ins from seven fresh browser contexts is EXPECTED, not a
dedupe failure:** the opt-in dedupe marker is per tab/context by design.

⛔ An unknown address on `@uctintelligence.internal` is **flagged as an ANOMALY**,
never counted as organic. That domain is reserved and unroutable, so nobody
outside this programme can hold one — a new one is a synthetic account somebody
provisioned without declaring it.

⛔⛔ WAVE K COLUMN — `config-served (members)`. K-1 flips the compile-time
constant to `false` so an unreachable auth payload fails to OFF; its precondition
is a **config-served rate of 100%% over the K window, measured by identity, rig and
owner-browser excluded** (owner ruling 2026-09-12). The column reads
`served/total` over DISTINCT member identities, where a member is an identity that
is neither the shared owner+rig account nor the smoke account — the same exclusion
the opt-in column uses, because two exclusion lists over one question is how they
drift. ⛔ `0/0` is NOT 100%%: an empty population cannot satisfy a rate, and the
column prints `0/0` rather than a percentage so nobody can read it as one.

| at (ET) | opt-ins by population (UTC) | opt-in (windowed) | config-served (members) | blocked-baseline | sync-conflict notes | outbox (rig only, layer off — structurally 0) | console errors (rig) | flag |
|---|---|---|---|---|---|---|---|---|
""" % RIG_OPT_IN_BASELINE


def et_now() -> str:
    # ⛔ ET, because the Sunday gate is stated in ET and a log in UTC invites the
    # reader to do arithmetic at the moment they least want to.
    return datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=-4))).strftime("%Y-%m-%d %H:%M ET")


def row(at, latest, total, served, blocked, conflicts, outbox, errors, flag) -> str:
    return f"| {at} | {latest} | {total} | {served} | {blocked} | {conflicts} | {outbox} | {errors} | {flag} |\n"


def render_config_served(cs) -> str:
    """`served/total` over distinct MEMBER identities. PURE, so a rail drives it.

    ⛔⛔ 0/0 IS NOT 100%. A rate over an empty population is undefined, and the
    one way this measurement gets faked is to render it as a percentage anyway —
    at which point K-1's precondition reads SATISFIED on a window in which no
    member ever opened the Notebook. It prints both numbers and lets the reader
    see the denominator.

    ⛔ And `absent` is not `off`: a browser talking to a pod that predates K
    reports `served: false`, counted in the denominator and NOT in the numerator.
    That asymmetry IS the precondition.
    """
    if not isinstance(cs, dict):
        return "ERR"
    if cs.get("err"):
        return f"ERR ({cs['err']})"
    served, total = cs.get("served", 0), cs.get("total", 0)
    if not total:
        return "0/0 — no member reported"
    return f"**{served}/{total}**" + ("" if served == total else "  ⛔ NOT 100%")


def _column_line(header: str) -> str:
    """The `| at (ET) | … |` line — the part a schema change actually changes.

    ⚰️ THE DETECTOR USED TO READ `HEADER.split("|")[0]`, WHICH IS THE PROSE ABOVE
    THE TABLE. Adding a column while leaving that prose alone would have appended
    MISALIGNED ROWS UNDER THE OLD HEADER — silently, in the one file whose whole
    purpose is that a hole stays visible. Found 2026-09-12 while adding the Wave K
    column, by reading the guard before relying on it.
    """
    # ⛔ THE FIRST TABLE LINE, whatever it is called. An earlier version of
    # this matched `"| at ("` specifically, which refuses a header whose
    # first column is ever renamed — and the rail that drives a schema
    # change with DIFFERENT columns caught it immediately. A guard that only
    # works for the schema in front of it is not a guard.
    for ln in header.splitlines():
        if ln.startswith("|") and not ln.startswith("|--"):
            return ln
    raise SystemExit("⛔ the header has no column line — refusing to guess at the schema")


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
    elif _column_line(HEADER) not in existing:
        # ⭐ Schema changed: a NEW header block, appended. Old rows stay readable
        # and stay labelled by the header that was above them when written.
        with LOG.open("a", encoding="utf-8") as fh:
            fh.write(chr(10) + HEADER)
    with LOG.open("a", encoding="utf-8") as fh:
        fh.write(line)


OPTIN_JS = """async ({rigOwner, synthetic, internalDomain}) => {
  const r = await fetch('/api/auth/admin/activity?limit=200', {credentials:'include'});
  if (!r.ok) return {err: 'HTTP ' + r.status};
  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return {err: 'not JSON (deploy blip?)'};
  const j = await r.json();
  const rows = Array.isArray(j) ? j : (j.rows || j.activity || []);
  const hits = rows.filter(x => String(x.action).includes('notebook_offline_opt_in'));

  // BY IDENTITY, not by row -- the same rule the config-served column already
  // uses. Seven opt-ins from one account is ONE account, however many browser
  // contexts produced them.
  const bucket = {organic: new Map(), synthetic: new Map(), rigOwner: new Map(), unknownInternal: new Map()};
  for (const x of hits) {
    const email = String(x.email || '').toLowerCase();
    const when = x.created_at;
    let key = 'organic';
    if (rigOwner.includes(email)) key = 'rigOwner';
    else if (synthetic.includes(email)) key = 'synthetic';
    else if (email.endsWith(internalDomain)) key = 'unknownInternal';
    const b = bucket[key];
    if (!b.has(email)) b.set(email, {events: 0, latest: when});
    const e = b.get(email);
    e.events += 1;
    if (!e.latest || String(when) > String(e.latest)) e.latest = when;
  }
  const mask = (m) => m.split('@')[0].slice(0, 12) + '@' + m.split('@')[1];
  const summarise = (b) => ({
    identities: b.size,
    events: [...b.values()].reduce((a, v) => a + v.events, 0),
    latest: [...b.values()].map(v => v.latest).sort().pop() || null,
    who: [...b.keys()].map(mask),
  });
  return {
    total: hits.length,
    latest: hits.length ? hits[0].created_at : null,
    // ! A FULL PAGE IS A CAP, NOT A COUNT. Say so, or "we found N" reads as
    // "there are N" while the oldest rows sit outside the window.
    capped: rows.length >= 200,
    organic: summarise(bucket.organic),
    synthetic: summarise(bucket.synthetic),
    rigOwner: summarise(bucket.rigOwner),
    unknownInternal: summarise(bucket.unknownInternal),
  };
}"""

CONFIG_SERVED_JS = """async (excluded) => {
  const r = await fetch('/api/auth/admin/activity?limit=200', {credentials:'include'});
  if (!r.ok) return {err: 'HTTP ' + r.status};
  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return {err: 'not JSON (deploy blip?)'};
  const j = await r.json();
  const rows = Array.isArray(j) ? j : (j.rows || j.activity || []);
  const hits = rows.filter(x => String(x.action).includes('notebook_config_served'));
  // BY IDENTITY, not by row: one member with six tabs is one member.
  const byEmail = new Map();
  for (const x of hits) {
    const email = String(x.email || '').toLowerCase();
    if (excluded.includes(email)) continue;        // the rig+owner account, and the smoke account
    let served = false;
    try { served = !!JSON.parse(x.details || '{}').served } catch { served = false }
    // ANY served:true in the window counts that identity as served; a member
    // whose FIRST tab predated the deploy must not be held against the rate
    // forever by that one row.
    byEmail.set(email, (byEmail.get(email) || false) || served);
  }
  const total = byEmail.size;
  let served = 0;
  for (const v of byEmail.values()) if (v) served += 1;
  return {total, served, rows: hits.length};
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
            append(row(at, "—", "—", "—", "—", "—", "—", "—",
                       f"**SKIPPED** — rig profile busy ({', '.join(held)})"))
            print("SKIPPED: profile busy")
            return 0
    except Exception as e:                                   # noqa: BLE001
        append(row(at, "—", "—", "—", "—", "—", "—", "—", f"**SKIPPED** — {type(e).__name__}"))
        return 0

    from playwright.sync_api import sync_playwright
    errors: list[str] = []
    http_fail: list[str] = []
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
            # ⛔⛔ "2 console errors" IS NOT ACTIONABLE. Owner ruling 2026-09-14,
            # after three consecutive ANOMALY rows whose entire content was
            # "Failed to load resource: the server responded with a status of 401 ()".
            # A resource-load console message does NOT carry the URL in its text --
            # the URL is in the message's LOCATION, and the method and status are only
            # on the response. So three listeners, not one.
            def _on_console(m):
                if m.type != "error":
                    return
                loc = m.location or {}
                where = str(loc.get("url") or "")
                line = loc.get("lineNumber")
                # ⭐ the location of a resource-load error is the JS that ISSUED it,
                # which is the closest thing to an initiator the page will give us.
                tail = f"  [issued by {where[:110]}:{line}]" if where else "  [no location]"
                errors.append(f"console.error: {m.text}{tail}")

            def _on_response(r):
                # ⛔ Recorded BESIDE the console count, never added to it: trigger 4
                # reads that count and widening it would change the gate's meaning
                # while claiming to improve its logging.
                try:
                    if r.status >= 400:
                        http_fail.append(f"{r.request.method} {r.url[:120]} -> {r.status}")
                except Exception:  # noqa: BLE001
                    pass

            def _on_requestfailed(r):
                try:
                    http_fail.append(f"{r.method} {r.url[:120]} -> FAILED ({r.failure})")
                except Exception:  # noqa: BLE001
                    pass

            page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
            page.on("console", _on_console)
            page.on("response", _on_response)
            page.on("requestfailed", _on_requestfailed)

            page.goto(wc.PROD + "/journal/notebook", wait_until="domcontentloaded")
            page.wait_for_timeout(9000)

            act = page.evaluate(wc.ACTIVITY_JS, [OPT_IN, BLOCKED])
            total = (act.get(OPT_IN) or {}).get("count", "ERR")
            oi = page.evaluate(OPTIN_JS, {
                "rigOwner": [e.lower() for e in RIG_AND_OWNER],
                "synthetic": [e.lower() for e in SYNTHETIC_MEMBERS],
                "internalDomain": INTERNAL_DOMAIN,
            })
            latest = oi.get("latest") or "—"
            org = oi.get("organic") or {}
            syn = oi.get("synthetic") or {}
            rig = oi.get("rigOwner") or {}
            unk = oi.get("unknownInternal") or {}
            members = org.get("identities", "ERR")
            member_latest = (org.get("latest") or syn.get("latest") or "—")
            blocked = (act.get(BLOCKED) or {}).get("count", "ERR")
            # ⛔ WAVE K — the same exclusion list as the opt-in column, passed to
            # the same admin feed. Two lists over one question is how they drift.
            served_txt = render_config_served(
                page.evaluate(CONFIG_SERVED_JS, [e.lower() for e in NOT_A_MEMBER]))
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
                append(row(at, "—", "—", "—", "—", "—", "—", len(errors),
                           "**SKIPPED** — production unreachable (HTTP 5xx, deploy in flight); "
                           "not a finding, and not evidence of a clean interval either"))
                print(f"{at}  SKIPPED - production 5xx")
                return 0

            reasons = []
            if errors or http_fail:
                # ⭐ The COUNT stays the console/page count (trigger 4's column).
                # The HTTP failures are named beside it so the row can be acted on
                # without taking a rig window to reproduce it.
                bits = []
                if errors:
                    bits.append(errors[0][:150])
                if http_fail:
                    seen, uniq = set(), []
                    for h in http_fail:
                        if h not in seen:
                            seen.add(h)
                            uniq.append(h)
                    more = f" (+{len(uniq) - 3} more)" if len(uniq) > 3 else ""
                    bits.append("HTTP: " + " ; ".join(uniq[:3]) + more)
                # ⛔ NEVER EMIT THE TABLE DELIMITER INTO A CELL. This joined with "  |  "
                # for one night and made the row UNPARSEABLE: the flag cell carried a
                # pipe, so the row read as 10 cells under a 9-column header and the
                # gate DROPPED it - silently losing the only row that carried the URL
                # the whole change was made to record.
                # ⭐ The reader was also made tolerant, but a writer that emits its
                # own delimiter is a hazard for every other reader too.
                reasons.append(f"{len(errors)} console/page error(s): " + "  ·  ".join(bits))
            if unk.get("identities"):
                reasons.append(
                    f"UNKNOWN INTERNAL identity opted in ({unk.get('identities')}): "
                    f"{', '.join(unk.get('who') or [])} \u2014 an unroutable .internal address "
                    f"nobody declared. Add it to SYNTHETIC_MEMBERS or explain it; it is "
                    f"NOT organic exposure")
            if isinstance(blocked, int) and blocked > 0:
                reasons.append(f"blocked-baseline events = {blocked}")
            flag = "OK" if not reasons else "**ANOMALY** — " + " · ".join(reasons)

            # THREE NUMBERS, ALWAYS, AND NEVER SUMMED. A single "members"
            # figure is what let our own test account read as seven members.
            who = lambda d: (" [" + ", ".join(d.get("who") or []) + "]") if d.get("identities") else ""
            cell = (f"{latest} \u00b7 organic {org.get('identities', 'ERR')}"
                    f"{who(org)}"
                    f" \u00b7 synthetic {syn.get('identities', 0)}"
                    + (f" ({syn.get('events', 0)} events{who(syn)})" if syn.get("identities") else "")
                    + f" \u00b7 rig/owner {rig.get('identities', 0)}"
                    + (f" \u00b7 \u26d4 UNKNOWN INTERNAL {unk.get('identities')}{who(unk)}"
                       if unk.get("identities") else ""))
            append(row(at, cell,
                       total, served_txt, blocked, conflicts, 0, len(errors), flag))
            print(f"{at}  organic={org.get('identities')} synthetic={syn.get('identities')} rig={rig.get('identities')} total={total} config-served={served_txt} "
                  f"blocked={blocked} conflicts={conflicts} errors={len(errors)} {flag}")
    except Exception as e:                                   # noqa: BLE001
        append(row(at, "—", "—", "—", "—", "—", "—", "—",
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
