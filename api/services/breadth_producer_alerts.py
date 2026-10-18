"""The V2 producer's own failure states, said in #breadth-alerts the moment the runner sees them.

⭐ WHY (2026-10-17, owner). From 2026-10-13 to 2026-10-16 the producer parked 10-12..10-15 as
REVIEW_REQUIRED (the PIT gate stopped on a rewritten source row) and said so only in its own log
and `state.db`. Nothing reached a human for three days: the web checks (`breadth_pipeline`,
`breadth_health`) saw the SYMPTOMS a day or more later and named neither the state nor its cause.
This reads the producer's own store, on the runner, after every loop iteration.

CONDITIONS (each its own alert key, read from `state.db` / `v2_live.db`, never from a tick result):
  review    a session parked REVIEW_REQUIRED — the PIT gate STOPPED; needs an owner review
  failed    a session FAILED — retries exhausted; never retried automatically
  overdue   a session still not published past its expected time (the NEXT session's close +
            OVERDUE_GRACE_H): waiting on data, retrying, or parked by HOLD — this is "timed out"
  conflict  a rerun offered a different publication for an accepted session (the `conflict`
            table); the accepted one stands and nothing was republished

DEDUP (`breadth_alerts.send_on_change`): posts when the affected set CHANGES, reminds every
REMIND_S while it does not, and posts ONE resolution when the condition clears — only if it had
alerted. The state file lives on the runner's volume, so a redeploy does not re-post.

⛔ NEVER RAISES. `check()` is called from the runner loop after every tick; nothing here may
fail, delay or alter a tick. Values never appear — dates, states, reasons, sha prefixes only.
Kill switch: `BREADTH_PRODUCER_ALERTS_ENABLED=0` (unset = on).
"""
from __future__ import annotations

import datetime as dt
import logging
import os
import re
from typing import Callable, Optional
from zoneinfo import ZoneInfo

_log = logging.getLogger("breadth_producer_alerts")
_ET = ZoneInfo("America/New_York")

ENABLED_ENV = "BREADTH_PRODUCER_ALERTS_ENABLED"
REMIND_S = 24 * 3600
#: Hours after the NEXT session's 16:00 ET close by which session D is expected published. The
#: producer normally publishes D ~30 min after D+1's collector row (~16:15 ET), so 6 h is generous.
OVERDUE_GRACE_H = 6.0
CONDITIONS = ("review", "failed", "overdue", "conflict")
TITLES = {
    "review": "Breadth finalization parked for review (PIT gate stopped)",
    "failed": "Breadth finalization FAILED (retries exhausted)",
    "overdue": "Breadth finalization overdue",
    "conflict": "Breadth publication conflict (accepted session re-offered)",
}
RESOLVED = {
    "review": "Breadth finalization: no session is parked for review",
    "failed": "Breadth finalization: no session is in FAILED",
    "overdue": "Breadth finalization: no session is overdue",
    "conflict": "Breadth publication conflicts cleared",
}


def enabled() -> bool:
    return (os.environ.get(ENABLED_ENV) or "1").strip().lower() not in ("0", "false", "no", "off")


def _key(cond: str) -> str:
    return "producer:" + cond


# ── reads (the producer's own stores) ────────────────────────────────────────

def _store() -> dict:
    from api.services import breadth_v2_producer as prod
    with prod._state() as s:
        rows = s.execute("SELECT date, state, attempts, reason, updated_at FROM session").fetchall()
        conflicts = s.execute("SELECT date, offered_sha256, accepted_sha256, seen_at FROM conflict").fetchall()
    with prod._canon() as c:
        done = {r[0] for r in c.execute("SELECT date FROM v2_session")}
    return {"sessions": {r[0]: {"state": r[1], "attempts": r[2] or 0, "reason": r[3] or "",
                                "updated_at": r[4]} for r in rows},
            "conflicts": conflicts, "done": done,
            "hold": os.path.exists(os.path.join(prod.ROOT, "HOLD"))}


def _review_summary(reason: str) -> list:
    """The gate's report, condensed. The stored reason is JSON truncated to 4000 chars, so it is
    read with patterns, never parsed whole."""
    out = []
    m = re.search(r'"source_row_mutations":\s*\[([^\]]*)\]', reason or "")
    if m:
        dates = re.findall(r'"(\d{4}-\d{2}-\d{2})"', m.group(1))
        if dates:
            out.append("mutated source rows (an accepted collector row changed): " + ", ".join(dates))
    if re.search(r'"backfill_exclusion_unchanged":\s*false', reason or ""):
        out.append("the backfill exclusion changed")
    m = re.search(r'"export_sha256":\s*"([0-9a-f]{8})', reason or "")
    if m:
        out.append("PIT export sha %s…" % m.group(1))
    return out


def _deadline(d: str) -> dt.datetime:
    from api.services import breadth_v2_producer as prod
    nxt = dt.date.fromisoformat(prod._next_session(d))
    close = dt.datetime.combine(nxt, dt.time(16, 0), tzinfo=_ET)
    return close + dt.timedelta(hours=OVERDUE_GRACE_H)


def evaluate(now: Optional[dt.datetime] = None, store: Optional[dict] = None,
             last_result: Optional[dict] = None) -> dict:
    """{condition: {"dates": [...], "lines": [...], "sig": str}} for every condition that holds."""
    from api.services import breadth_authority as ba
    from api.services import breadth_v2_producer as prod
    now = now or dt.datetime.now(dt.timezone.utc)
    st = store if store is not None else _store()
    sess, done = st["sessions"], st["done"]
    out: dict = {}

    review = sorted(d for d, r in sess.items() if r["state"] == prod.REVIEW_REQUIRED and d not in done)
    if review:
        lines = ["sessions parked: " + ", ".join(review)]
        lines += _review_summary(sess[review[0]]["reason"])
        lines.append("clears when: an owner review in tools/breadth_v2/pit_reviewed_rejections.json "
                     "reaches the runner (redeploy); each parked session then re-tries once")
        out["review"] = {"dates": review, "lines": lines, "sig": ",".join(review)}

    failed = sorted(d for d, r in sess.items() if r["state"] == prod.FAILED and d not in done)
    if failed:
        lines = ["%s: %s attempts — %s" % (d, sess[d]["attempts"], sess[d]["reason"][:200]) for d in failed]
        lines.append("FAILED is never retried automatically: it needs an owner decision on the runner")
        out["failed"] = {"dates": failed, "lines": lines, "sig": ",".join(failed)}

    today_et = now.astimezone(_ET).date().isoformat()
    late = []
    for d in prod.trading_days(ba.LIVE_START, today_et):
        if d >= today_et or d in done:
            continue
        r = sess.get(d) or {}
        if r.get("state") in (prod.REVIEW_REQUIRED, prod.FAILED):
            continue                                   # said by its own, more specific alert
        if now >= _deadline(d):
            late.append(d)
    if late:
        lines = ["%s: %s — %s" % (d, (sess.get(d) or {}).get("state") or "never attempted",
                                  ((sess.get(d) or {}).get("reason") or "")[:160]) for d in late]
        if st["hold"]:
            lines.append("the producer is parked by ROOT/HOLD")
        err = (last_result or {}).get("error")
        if err:
            lines.append("last tick error: %s" % str(err)[:200])
        out["overdue"] = {"dates": late, "lines": lines, "sig": ",".join(late)}

    if st["conflicts"]:
        lines = ["%s: offered %s… vs accepted %s… (seen %s)" % (d, (o or "")[:8], (a or "")[:8], seen)
                 for d, o, a, seen in st["conflicts"][:10]]
        lines.append("the accepted publication stands; nothing was republished")
        sig = ",".join(sorted("%s:%s" % (d, (o or "")[:12]) for d, o, _a, _s in st["conflicts"]))
        out["conflict"] = {"dates": sorted({c[0] for c in st["conflicts"]}), "lines": lines, "sig": sig}
    return out


# ── the check ────────────────────────────────────────────────────────────────

def _resolution_lines(cond: str, st: dict) -> list:
    from api.services import breadth_alerts
    prior = [d for d in (breadth_alerts.signature(_key(cond)) or "").split(",") if re.match(r"\d{4}-", d)]
    out = []
    for d in sorted({p[:10] for p in prior}):
        state = "published" if d in st["done"] else ((st["sessions"].get(d) or {}).get("state") or "?")
        out.append("%s: %s" % (d, state))
    return out or ["no affected sessions remain"]


def check(now: Optional[dt.datetime] = None, post: Optional[Callable] = None,
          store: Optional[dict] = None, last_result: Optional[dict] = None) -> dict:
    """Evaluate every condition and alert / remind / resolve. NEVER RAISES."""
    try:
        if not enabled():
            return {"enabled": False}
        from api.services import breadth_alerts
        st = store if store is not None else _store()
        found = evaluate(now, st, last_result)
        sent = {}
        for cond in CONDITIONS:
            f = found.get(cond)
            if f:
                # A SHRINKING set is progress (sessions publishing one by one), not news: keep the
                # posted signature so only a NEW session re-posts before the reminder is due.
                sig, prior = f["sig"], breadth_alerts.signature(_key(cond))
                if prior and set(sig.split(",")) <= set(prior.split(",")):
                    sig = prior
                sent[cond] = breadth_alerts.send_on_change(
                    _key(cond), TITLES[cond], f["lines"], sig, REMIND_S, post=post,
                    now=now.timestamp() if now else None)
            else:
                lines = _resolution_lines(cond, st)
                r = breadth_alerts.resolve(_key(cond), RESOLVED[cond], lines, post=post)
                if r.get("sent"):
                    sent[cond] = r
        return {"enabled": True, "found": {k: v["dates"] for k, v in found.items()}, "sent": sent}
    except Exception as e:                             # noqa: BLE001 — never into the runner loop
        _log.warning("[breadth-producer-alerts] check failed: %s: %s", type(e).__name__, e)
        return {"error": "%s: %s" % (type(e).__name__, e)}
