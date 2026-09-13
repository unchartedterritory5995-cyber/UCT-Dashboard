"""LAYER 1 — `terminal-next-monitor`: the programme watches itself.

    TERMINAL_NEXT_MONITOR_ENABLED=1  python -m api.terminal_next_monitor_main
    …                                python -m api.terminal_next_monitor_main --once ticking

⭐ **IT RUNS NO MEASUREMENT OF ITS OWN.** Every number it posts comes from a tool
that is already the authority — `--ticking`, `terminal_next_gate_check`, the
F-CAT-1 `catalyst_runs` receipt — fetched from `web` over the Railway private
network. A monitor that recomputed anything would be a second authority over the
numbers it reports, and the first disagreement would be unresolvable.

⛔⛔ **WHY HTTP AND NOT A SHARED VOLUME.** A Railway volume mounts to **exactly
one service**. `/data` belongs to `web`, so this service cannot read the stores
directly — read-only or otherwise. The supported cross-service path is the
private network (`web.railway.internal`), the same idiom `WORKER_INTERNAL_URL`
already uses. **That is the choice, and it is the runbook's.**

⛔⛔ **THE ADMIN CHANNEL, NEVER THE MEMBER OR PUBLIC ONE.** Posts go to
`DISCORD_WEBHOOK_URL` — the admin webhook, the same one signups and
`curator_health` use. `DISCORD_TSDR_WEBHOOK_URL` is the **public ~750-member TSDR
channel** and is never read by this module; `tests/test_terminal_next_monitor.py`
asserts the name does not appear in this file's code at all. An operational
alert in a member channel is an incident, not a notification.

⚠️ **UNREADABLE IS NOT ZERO, EVERYWHERE.** A store that cannot be opened, a
report that times out, a `web` that will not answer — each posts as UNREADABLE
with its reason. A monitor that turns a failed read into a confident zero is
worse than no monitor: it reads as coverage.

⭐ **EVERY POST CARRIES THE RUNNING COMMIT AND THE TIMESTAMP**, because a reading
without the build it came from cannot be compared to the next one.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.request
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")

FLAG = "TERMINAL_NEXT_MONITOR_ENABLED"
#: ⛔ THE ADMIN WEBHOOK. Never DISCORD_TSDR_WEBHOOK_URL (public, ~750 members).
ADMIN_WEBHOOK_ENV = "DISCORD_WEBHOOK_URL"
WEB_URL_ENV = "WEB_INTERNAL_URL"          # e.g. http://web.railway.internal:8080
DEFAULT_WEB_URL = "http://web.railway.internal:8080"

ALERT = "ALERT"


def enabled() -> bool:
    return os.environ.get(FLAG, "").strip().lower() in ("1", "true", "yes")


def running_commit() -> str:
    for k in ("RAILWAY_GIT_COMMIT_SHA", "RAILWAY_DEPLOYMENT_ID", "GIT_COMMIT"):
        v = os.environ.get(k)
        if v:
            return v[:9]
    return "unknown"


def _now() -> str:
    return dt.datetime.now(_ET).strftime("%Y-%m-%d %H:%M ET")


def _fetch(path: str, timeout: int = 260) -> dict:
    base = (os.environ.get(WEB_URL_ENV) or DEFAULT_WEB_URL).rstrip("/")
    secret = os.environ.get("PUSH_SECRET", "")
    if not secret:
        return {"exit": 125, "stdout": "", "stderr": "UNREADABLE: PUSH_SECRET unset on the monitor"}
    req = urllib.request.Request(base + path,
                                 headers={"Authorization": "Bearer " + secret})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except Exception as e:                                   # noqa: BLE001
        # ⛔ web being unreachable is a FINDING, not a zero — and it is exactly
        # the condition a monitor living inside web could never report.
        return {"exit": 126, "stdout": "",
                "stderr": "UNREADABLE: cannot reach %s (%s: %s)" % (base, type(e).__name__, e)}


def post(title: str, body: str, *, alert: bool = False) -> bool:
    """Post to the ADMIN Discord channel. Never raises."""
    url = os.environ.get(ADMIN_WEBHOOK_ENV, "")
    prefix = (ALERT + " ") if alert else ""
    text = "**%s%s**  ·  commit `%s`  ·  %s\n```\n%s\n```" % (
        prefix, title, running_commit(), _now(), body.strip()[:3400] or "(no output)")
    if not url:
        print("[monitor] NO ADMIN WEBHOOK SET — would have posted:\n" + text)
        return False
    try:
        req = urllib.request.Request(
            url, data=json.dumps({"content": text}).encode("utf-8"),
            headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=30).read()
        return True
    except Exception as e:                                   # noqa: BLE001
        print("[monitor] discord post failed: %s: %s" % (type(e).__name__, e))
        return False


# ──────────────────────────────────────────────────────────── the four jobs

def job_ticking() -> tuple[str, str, bool]:
    """Weekdays 09:12 ET — the liveness of all seven dark sweeps."""
    r = _fetch("/api/terminal-next/report/ticking")
    out = r.get("stdout") or r.get("stderr") or "(empty)"
    code = int(r.get("exit", 126))
    verdicts = [ln for ln in out.splitlines() if ln and not ln.startswith("  ")]
    stalled = [ln for ln in verdicts if " NO " in ln or ln.strip().endswith(" NO")]
    alert = code != 0 or bool(stalled) or code in (124, 125, 126)
    head = ("A SWEEP IS NOT TICKING INSIDE ITS WINDOW" if stalled else
            "report unreadable" if code >= 124 else "all sweeps answered")
    return ("--ticking (exit %d) — %s" % (code, head), out, alert)


def job_catalyst_receipt() -> tuple[str, str, bool]:
    """Weekdays 07:20 ET — F-CAT-1: did the engine spend and persist?"""
    r = _fetch("/api/terminal-next/catalyst-receipt")
    if "market_date" not in r:
        return ("F-CAT-1 receipt — UNREADABLE", json.dumps(r)[:1200], True)
    closed = r.get("market_closed")
    persisted = int(r.get("rows_persisted") or 0)
    spent = float(r.get("spend_usd") or 0.0)
    lines = ["market_date   : %s" % r.get("market_date"),
             "market closed : %s (%s)" % (closed, r.get("closed_reason")),
             "runs today    : %s" % r.get("runs"),
             "rows persisted: %s" % persisted,
             "spend_usd     : %s" % spent]
    if closed:
        # ⛔ A CLOSED MARKET IS NOT A FAULT, and alerting on it every weekend is
        # how a monitor gets muted.
        lines.append("-> market closed; no run expected. NOT an alert.")
        return ("F-CAT-1 receipt — market closed", "\n".join(lines), False)
    if persisted > 0:
        lines.append("-> healthy: the engine persisted rows today.")
        return ("F-CAT-1 receipt — healthy", "\n".join(lines), False)
    lines.append("-> ZERO ROWS PERSISTED on an open market day."
                 + (" AND IT SPENT $%.4f." % spent if spent > 0 else
                    " (no spend recorded either — the engine may not have run at all.)"))
    return ("F-CAT-1 receipt — NO ROWS PERSISTED", "\n".join(lines), True)


def job_gate_check() -> tuple[str, str, bool]:
    """Daily 16:30 ET — gate states with their numbers."""
    r = _fetch("/api/terminal-next/report/gate-check")
    out = r.get("stdout") or r.get("stderr") or "(empty)"
    code = int(r.get("exit", 126))
    tail = [ln for ln in out.splitlines() if "READY" in ln or "UNREADABLE" in ln]
    return ("gate check (exit %d)" % code, "\n".join(tail) or out, code >= 124)


def job_weekly() -> tuple[str, str, bool]:
    """Saturday 08:00 ET — the full comparison across all seven types + D2."""
    parts = []
    rep = _fetch("/api/terminal-next/report/report")
    parts.append("=== COMPARISON (exit %s) ===" % rep.get("exit"))
    parts.append(rep.get("stdout") or rep.get("stderr") or "(empty)")
    gate = _fetch("/api/terminal-next/report/gate-check")
    parts.append("\n=== GATE CHECK (exit %s) — the next authorization line ===" % gate.get("exit"))
    parts.append(gate.get("stdout") or gate.get("stderr") or "(empty)")
    bad = any(int(x.get("exit", 126)) >= 124 for x in (rep, gate))
    return ("WEEKLY READ — seven types + the D2 sample gate", "\n".join(parts), bad)


#: (job, weekday-predicate, ET hour, ET minute). ⛔ THE SCHEDULE IS IN **ET**,
#: decided here, because Railway cron is **UTC** and ET is UTC-4 in summer and
#: UTC-5 in winter. A UTC crontab expressing "09:12 ET" silently becomes 10:12 ET
#: the day DST ends — the sweeps would be checked an hour after they started, and
#: nothing would say so. The cron therefore fires a SUPERSET and this table is the
#: authority on what is actually due.
SCHEDULE = (
    ("catalyst",   lambda d: d < 5, 7, 20),    # weekdays 07:20 ET — before the open
    ("ticking",    lambda d: d < 5, 9, 12),    # weekdays 09:12 ET — sweeps live
    ("gate-check", lambda d: True,  16, 30),   # daily 16:30 ET
    ("weekly",     lambda d: d == 5, 8, 0),    # Saturday 08:00 ET
)

#: The Railway cron that must cover every row above, in UTC, both halves of the
#: year. ⭐ A SUPERSET ON PURPOSE: 16 firings a day, of which 4 are due. The
#: alternative — four services with four crons — is four things to forget.
RAILWAY_CRON_UTC = "0,12,20,30 11,12,13,14,20,21 * * *"


def due_jobs(now: dt.datetime | None = None) -> list[str]:
    """Which jobs are due at this ET minute. Empty on a firing that is not one."""
    n = now or dt.datetime.now(_ET)
    return [name for name, when, h, m in SCHEDULE
            if when(n.weekday()) and n.hour == h and n.minute == m]


JOBS = {
    "ticking": job_ticking,
    "catalyst": job_catalyst_receipt,
    "gate-check": job_gate_check,
    "weekly": job_weekly,
}


def run_job(name: str) -> int:
    fn = JOBS.get(name)
    if fn is None:
        print("[monitor] unknown job %r; known: %s" % (name, sorted(JOBS)))
        return 2
    title, body, alert = fn()
    post(title, body, alert=alert)
    print("[monitor] %s -> %s%s" % (name, "ALERT " if alert else "", title))
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--once", help="run one job and exit: " + ", ".join(sorted(JOBS)))
    a = ap.parse_args([] if (argv is None and "pytest" in sys.modules) else argv)

    if not enabled():
        print("[monitor] %s is not set — nothing to do." % FLAG)
        return 0
    if a.once:
        return run_job(a.once)
    # ⛔ NO INTERNAL SCHEDULER. Railway's own cron invokes this with --once, so
    # the schedule lives in ONE place (the service config) instead of two that
    # can disagree. A container that slept between crons would also bill for the
    # sleeping.
    due = due_jobs()
    if not due:
        # ⛔ NOT AN ERROR. The cron fires a superset; a firing with nothing due is
        # the normal case and must cost nothing and say nothing.
        print("[monitor] nothing due at %s — exiting quietly." % _now())
        return 0
    rc = 0
    for name in due:
        rc = max(rc, run_job(name))
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
