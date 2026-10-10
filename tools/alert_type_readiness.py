#!/usr/bin/env python
"""TERM-025 / FT-034: which shadow alert trigger types are READY TO FLIP.

    python tools/alert_type_readiness.py --db /data/alert_taxonomy.db          # on the web pod
    python tools/alert_type_readiness.py --db <copy>.db --dispositions d.json  # with dispositions
    python tools/alert_type_readiness.py --db <copy>.db --json                 # machine-readable

The owner action for TERM-025 is RUNNING THIS TOOL (ruling T-11, 2026-10-07): "No
per-type owner ruling. Each type flips when its own shadow log meets ADR-0036's
clause (`new_only == 0`, every excluded predicate dispositioned) over >=10
consecutive trading sessions." This tool reads every shadow type's comparison log
and prints, per type, READY TO FLIP or NOT READY with every reason.

IT FLIPS NOTHING. It sets no variable and writes no row of its own. It reads each
type's log through that type's own `report()` (via `alert_taxonomy.dark_report`),
so its counts are the same counts every gate packet already quotes; the only write
on that path is each module's idempotent `CREATE TABLE IF NOT EXISTS`, which is a
no-op on a store that already has the table. It refuses to run against a store
that does not exist, so it can never create one.

THE BAR, PER TYPE (ADR-0036 clauses 1-3, T-11's session count, and one guard):

  0. SOMETHING WAS OBSERVED. A log with zero agreed / new_only / legacy_only prints
     exactly what perfect agreement prints, so it is NOT READY ("nothing observed"),
     never ready by default. (The programme's NO DATA / QUIET rule, applied here.)
  1. `new_only == 0` across EVERY predicate of the type. An EXTRA alert is the
     direction that harms a member.
  2. `legacy_only == 0` across every predicate STILL ACCUMULATING SESSIONS. A
     predicate whose newest session is 5 or more trading sessions behind the type's
     newest session is EXCLUDED, named, with its counter printed beside it.
  3. Every excluded predicate is DISPOSITIONED (`--dispositions`) as one of
     `confirmed_inactive` or `confirmed_correct_suppression`. Missing or
     `unexplained` BLOCKS.
  4. The type's sessions hold a run of >= 10 CONSECUTIVE trading sessions (NYSE
     calendar, `api.services.session_calendar`) ending at its newest session, and
     that newest session is at most 1 trading session before today (a log that
     stopped is not a log that passed).

`--dispositions` is JSON: {"<type>": {"<predicate_id>": "<disposition>"}}.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

MIN_CONSECUTIVE_SESSIONS = 10          # T-11 (2026-10-07): matches TERM-042's bar
EXCLUDE_AFTER_STALLED_SESSIONS = 5     # ADR-0036 clause 2
MAX_LOG_LAG_SESSIONS = 1               # the newest session must be today or the last one
OK_DISPOSITIONS = ("confirmed_inactive", "confirmed_correct_suppression")
ALL_DISPOSITIONS = OK_DISPOSITIONS + ("unexplained",)


def _is_trading_day(d: date) -> bool:
    try:
        from api.services import session_calendar
        return session_calendar.is_trading_day(d)
    except Exception:  # noqa: BLE001 - a missing calendar degrades to weekdays
        return d.weekday() < 5


def _prev_trading_day(d: date) -> date:
    d -= timedelta(days=1)
    while not _is_trading_day(d):
        d -= timedelta(days=1)
    return d


def trading_sessions_between(older: date, newer: date) -> int:
    """How many trading sessions after `older` up to and including `newer`."""
    n, d = 0, newer
    while d > older:
        if _is_trading_day(d):
            n += 1
        d -= timedelta(days=1)
    return n


def consecutive_run_ending_at_newest(sessions: list[str]) -> tuple[int, str | None]:
    """(length of the run of consecutive trading sessions ending at the newest
    session, the newest session). Session keys are YYYY-MM-DD strings."""
    days = sorted({date.fromisoformat(s[:10]) for s in sessions if s})
    if not days:
        return 0, None
    have = set(days)
    run, d = 1, days[-1]
    while True:
        p = _prev_trading_day(d)
        if p in have:
            run, d = run + 1, p
        else:
            break
    return run, days[-1].isoformat()


def assess_type(alert_type: str, reports: list[dict], *, dispositions: dict | None = None,
                today: date | None = None) -> dict:
    """Pure: one type's readiness from its predicates' `report()` dicts."""
    today = today or date.today()
    dispositions = dispositions or {}
    totals = {"agreed": 0, "new_only": 0, "legacy_only": 0, "not_comparable": 0}
    all_sessions: list[str] = []
    for r in reports:
        for k in totals:
            totals[k] += int(r.get(k) or 0)
        all_sessions.extend(r.get("sessions_covered") or [])
    run, newest = consecutive_run_ending_at_newest(all_sessions)

    excluded, active_legacy = [], 0
    if newest:
        newest_d = date.fromisoformat(newest)
        for r in reports:
            mine = [date.fromisoformat(s[:10]) for s in (r.get("sessions_covered") or []) if s]
            stalled = (trading_sessions_between(max(mine), newest_d) if mine
                       else EXCLUDE_AFTER_STALLED_SESSIONS)
            if stalled >= EXCLUDE_AFTER_STALLED_SESSIONS:
                pid = r.get("predicate_id")
                disp = dispositions.get(pid)
                excluded.append({"predicate_id": pid, "legacy_only": int(r.get("legacy_only") or 0),
                                 "stalled_sessions": stalled, "disposition": disp})
            else:
                active_legacy += int(r.get("legacy_only") or 0)

    reasons: list[str] = []
    observed = totals["agreed"] + totals["new_only"] + totals["legacy_only"]
    if not reports:
        reasons.append("NO DATA: the shadow log holds no predicate for this type")
    elif observed == 0:
        reasons.append("NOTHING OBSERVED: every count is zero, which says nothing about the two rules")
    if totals["new_only"]:
        reasons.append(f"clause 1: new_only = {totals['new_only']} (must be 0)")
    if active_legacy:
        reasons.append(f"clause 2: legacy_only = {active_legacy} on predicates still accumulating sessions")
    for e in excluded:
        if e["disposition"] not in OK_DISPOSITIONS:
            reasons.append(f"clause 3: excluded predicate {e['predicate_id']} is "
                           f"{e['disposition'] or 'not dispositioned'} (legacy_only {e['legacy_only']})")
    if run < MIN_CONSECUTIVE_SESSIONS:
        reasons.append(f"sessions: {run} consecutive trading session(s), needs {MIN_CONSECUTIVE_SESSIONS}")
    if newest:
        lag = trading_sessions_between(date.fromisoformat(newest), today)
        if lag > MAX_LOG_LAG_SESSIONS:
            reasons.append(f"stale log: newest session {newest} is {lag} trading sessions before {today}")
    return {"alert_type": alert_type, "ready": not reasons, "reasons": reasons,
            "predicates": len(reports), **totals, "consecutive_sessions": run,
            "newest_session": newest, "excluded": excluded}


def load_reports(db_path: str) -> dict[str, list[dict]]:
    from api.services.alert_taxonomy import dark_report
    return {t: dark_report.dark_report(t, db_path=db_path)["predicates"]
            for t in dark_report.known_types()}


def render(results: list[dict]) -> str:
    lines = ["ALERT TYPE READINESS (ADR-0036 clause v3 + T-11: >= 10 consecutive trading sessions)",
             "This tool flips nothing. A READY type is flipped by its own per-type step.", ""]
    for r in results:
        head = "READY TO FLIP" if r["ready"] else "NOT READY"
        lines.append(f"{r['alert_type']:<24} {head}")
        lines.append(f"    predicates {r['predicates']}  agreed {r['agreed']}  new_only {r['new_only']}  "
                     f"legacy_only {r['legacy_only']}  not_comparable {r['not_comparable']}")
        lines.append(f"    consecutive sessions {r['consecutive_sessions']}  newest {r['newest_session'] or '-'}")
        for e in r["excluded"]:
            lines.append(f"    excluded {e['predicate_id']}: stalled {e['stalled_sessions']} sessions, "
                         f"legacy_only {e['legacy_only']}, disposition {e['disposition'] or 'NONE'}")
        for why in r["reasons"]:
            lines.append(f"    - {why}")
        lines.append("")
    ready = [r["alert_type"] for r in results if r["ready"]]
    lines.append(f"READY TO FLIP: {', '.join(ready) if ready else 'none'}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--db", help="path to alert_taxonomy.db (required off a Railway pod)")
    ap.add_argument("--dispositions", help="JSON file of excluded-predicate dispositions")
    ap.add_argument("--today", help="YYYY-MM-DD (default: today)")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)

    db = a.db
    if not db:
        if not os.environ.get("RAILWAY_ENVIRONMENT"):
            print("refusing: pass --db. Off a Railway pod the default /data path is the "
                  "owner's live data on this machine.", file=sys.stderr)
            return 2
        from api.services.alert_taxonomy import db as _db
        db = _db.DB_PATH
    if not Path(db).is_file():
        print(f"refusing: {db} does not exist (this tool never creates a store)", file=sys.stderr)
        return 2
    disp: dict = {}
    if a.dispositions:
        disp = json.loads(Path(a.dispositions).read_text(encoding="utf-8"))
        for t, m in disp.items():
            for pid, v in (m or {}).items():
                if v not in ALL_DISPOSITIONS:
                    print(f"refusing: {t}/{pid} has disposition {v!r}; one of {ALL_DISPOSITIONS}",
                          file=sys.stderr)
                    return 2
    today = date.fromisoformat(a.today) if a.today else date.today()
    reports = load_reports(db)
    results = [assess_type(t, reports[t], dispositions=disp.get(t), today=today)
               for t in sorted(reports)]
    if a.json:
        print(json.dumps(results, indent=1))
    else:
        print(render(results))
    return 0


if __name__ == "__main__":
    sys.exit(main())
