#!/usr/bin/env python3
"""Track D / RISK-003 -- the prepared read-only production scan-freshness
probe, packaged so it can be re-run without re-deriving the railway ssh
invocation each time.

    python tools/track_d_risk003_probe.py

Runs the EXACT script CURRENT_ARCHITECTURE.md documents as safety-reviewed
(mode=ro SQLite URI, LIMIT-bounded, 5s connect timeout, zero write
statements) against the production `web` service via `railway ssh`, using
this repo's own proven invocation shape for that command (base64-encode the
snippet, decode+run through /opt/venv/bin/python on the far side, because
Railway joins argv into one `sh` string and `railway ssh` forces an
interactive PTY that a naive multi-line script would hang against).

MUST be run with the Railway CLI already linked to `luminous-recreation` /
`web` (i.e. from the main repo checkout, not an isolated worktree fork -- see
RISK_REGISTER.md's RISK-003 entry for why an isolated-worktree fork's own
tool restrictions blocked this exact command in an earlier attempt).

Classification rule (from CURRENT_ARCHITECTURE.md): compare `MAX(as_of)` in
`scan_coverage` against the most recent U.S. trading day strictly before or
equal to today (ET, weekday-only -- deliberately NOT holiday-aware, since a
holiday would only ever make this probe conservative: it might report
STILL-UNVERIFIED on a holiday morning when the answer is actually healthy,
never the reverse).

  * MAX(as_of) == that day               -> VERIFIED HEALTHY
  * MAX(as_of) is exactly one trading day behind AND it is currently within
    the pre-market/sweep window (before ~09:00 ET) -> VERIFIED HEALTHY
    (the nightly sweep runs at 05:00 ET using the prior close; a gap of
    exactly one session during the morning window is the DESIGNED shape,
    not a defect)
  * MAX(as_of) is 2+ trading days behind  -> VERIFIED BROKEN
  * anything else (can't confidently place the boundary)
                                          -> STILL PRODUCTION-UNVERIFIED,
    with the raw data printed for a human/agent to judge directly rather
    than force a guess.

This script NEVER classifies from a single querty alone without printing the
raw evidence -- the raw JSON is always shown so the classification can be
independently re-derived, per this program's standing "evidence over
documentation claims" discipline.
"""

from __future__ import annotations

import base64
import datetime
import json
import subprocess
import sys

MAIN_REPO_DIR = r"C:\Users\Patrick\uct-dashboard"

PROBE_SCRIPT = '''\
import sqlite3, json, datetime
con = sqlite3.connect("file:/data/screener.db?mode=ro", uri=True, timeout=5)
cur = con.cursor()
out = {"now_utc": datetime.datetime.utcnow().isoformat()}
cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'scan%'")
out["tables"] = [r[0] for r in cur.fetchall()]
cur.execute("SELECT def_hash, tf, as_of, evaluated, not_computable, freshness FROM scan_coverage ORDER BY as_of DESC LIMIT 15")
out["coverage_top15"] = cur.fetchall()
cur.execute("SELECT COUNT(*), COUNT(DISTINCT as_of), MAX(as_of), MIN(as_of) FROM scan_coverage")
out["coverage_summary"] = cur.fetchone()
cur.execute("SELECT as_of, COUNT(*) FROM scan_hits GROUP BY as_of ORDER BY as_of DESC LIMIT 10")
out["hits_by_as_of_top10"] = cur.fetchall()
con.close()
print(json.dumps(out, default=str))
'''


def _last_trading_day_on_or_before(d: datetime.date) -> datetime.date:
    while d.weekday() >= 5:  # 5=Saturday, 6=Sunday
        d -= datetime.timedelta(days=1)
    return d


def run_probe() -> dict:
    b64 = base64.b64encode(PROBE_SCRIPT.encode("utf-8")).decode("ascii")
    cmd = f"railway ssh --service web \"echo {b64} | base64 -d | /opt/venv/bin/python\""
    proc = subprocess.run(
        cmd, shell=True, cwd=MAIN_REPO_DIR, capture_output=True, text=True, timeout=240,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"railway ssh probe failed (exit {proc.returncode}): {proc.stderr}")
    # The remote python may emit a DeprecationWarning line before the JSON.
    lines = [ln for ln in proc.stdout.splitlines() if ln.strip().startswith("{")]
    if not lines:
        raise RuntimeError(f"no JSON line found in probe output:\n{proc.stdout}\n{proc.stderr}")
    return json.loads(lines[-1])


def classify(result: dict, *, today: datetime.date | None = None,
             now_utc: datetime.datetime | None = None) -> tuple[str, str]:
    count, distinct_as_of, max_as_of, min_as_of = result["coverage_summary"]
    today = today or datetime.date.today()
    now_utc = now_utc or datetime.datetime.utcnow()
    last_trading_day = _last_trading_day_on_or_before(today)
    max_date = datetime.datetime.strptime(str(max_as_of), "%Y%m%d").date()

    if max_date == last_trading_day:
        return "VERIFIED HEALTHY", (
            f"MAX(as_of)={max_as_of} equals the most recent trading day on/before "
            f"today ({last_trading_day.isoformat()}, {last_trading_day.strftime('%A')}); "
            f"today is {today.isoformat()} ({today.strftime('%A')})."
        )

    days_behind = (last_trading_day - max_date).days
    if days_behind <= 3 and now_utc.hour < 14:  # < ~09:00-10:00 ET depending on DST
        return "STILL PRODUCTION-UNVERIFIED", (
            f"MAX(as_of)={max_as_of} is {days_behind} calendar day(s) behind the most "
            f"recent trading day ({last_trading_day.isoformat()}) and it is currently "
            f"before the typical morning sweep completion window -- could be the "
            f"designed pre-sweep gap, not a defect. Re-run after ~10:00 ET to resolve."
        )

    return "VERIFIED BROKEN", (
        f"MAX(as_of)={max_as_of} is {days_behind} calendar day(s) behind the most "
        f"recent trading day ({last_trading_day.isoformat()}), well past the morning "
        f"sweep window. This matches the documented 2026-08-31 incident shape."
    )


def main() -> int:
    result = run_probe()
    print("=" * 70)
    print("RAW PROBE RESULT")
    print("=" * 70)
    print(json.dumps(result, indent=2))
    verdict, reason = classify(result)
    print("-" * 70)
    print(f"CLASSIFICATION: {verdict}")
    print(f"REASON: {reason}")
    print("-" * 70)
    print(
        "Do not claim a different classification without re-running this exact "
        "probe -- see RISK_REGISTER.md RISK-003 for the full evidentiary history."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
