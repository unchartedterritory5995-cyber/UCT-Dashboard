"""How many archive calls would get a Desk session link? Offline, never touches production.

Uses the SAME rule the server uses (api/services/wisdom/archive/call_moments.py: candidate_dates
and match), so the number is the product's number, not a re-derivation.

Two modes:
  * EXACT, given a sessions export (a JSON list of edu_videos rows with id, youtube_id, title,
    media_started_at, ticker_moments - e.g. the output of education_service.session_moment_rows()):
        python tools/wisdom/call_moments_estimate.py --calls <ledger>/scored/calls.jsonl --sessions rows.json
  * UPPER BOUND, given only a session calendar (every NYSE trading day in --start..--end is assumed
    to have had a recorded session): counts the calls whose posted time maps to an eligible session
    date at all, i.e. the count IF every called ticker were discussed in that session. The real
    number is this times the (unmeasured offline) share of called tickers the session names.
        python tools/wisdom/call_moments_estimate.py --calls ... --start 2026-06-24 --end 2026-10-16

Prints JSON. Reads only the files named; imports no store.
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _calls(path: str) -> list:
    out = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                r = json.loads(line)
                out.append({"call_id": r.get("call_id"), "ticker": r.get("ticker") or r.get("symbol"),
                            "posted": r.get("posted")})
    return out


def _calendar(start: dt.date, end: dt.date) -> list:
    from api.services.wisdom.core import timeutil

    days, d = [], start
    while d <= end:
        if timeutil.is_trading_day(d):
            days.append(d)
        d += dt.timedelta(days=1)
    return days


def upper_bound(calls: list, session_dates: list) -> dict:
    from api.services.wisdom.archive import call_moments as cm

    dates = sorted(set(session_dates))
    lo, hi = dates[0], dates[-1]
    by_rel: collections.Counter = collections.Counter()
    by_month: collections.Counter = collections.Counter()
    in_window = eligible = 0
    for c in calls:
        when, day = cm.parse_posted(c["posted"])
        if day is None or not (lo - dt.timedelta(days=cm.NEXT_SESSION_MAX_DAYS) <= day <= hi):
            continue
        in_window += 1
        cands = cm.candidate_dates(when, day, dates)
        if not cands:
            continue
        # an after-close call's same-day candidate needs a clocked evening show: the calendar mode
        # has no clock, so only its next-session candidate counts (the server would do the same).
        rels = [r for _, r in cands if r != cm.SAME_DAY_AFTER_CLOSE]
        if not rels:
            continue
        eligible += 1
        by_rel[rels[0]] += 1
        by_month[day.strftime("%Y-%m")] += 1
    return {"mode": "upper_bound", "session_days": len(dates), "window": [lo.isoformat(), hi.isoformat()],
            "calls_in_window": in_window, "calls_with_an_eligible_session": eligible,
            "by_relation": dict(by_rel), "by_month": dict(sorted(by_month.items()))}


def exact(calls: list, rows: list) -> dict:
    from api.services.wisdom.archive import call_moments as cm

    sessions = cm.sessions_from_videos(rows)
    links = cm.match(calls, sessions)
    linked = {lk.call_id for lk in links}
    return {"mode": "exact", "sessions": len(sessions), "calls": len(calls), "links": len(links),
            "calls_linked": len(linked),
            "by_relation": dict(collections.Counter(lk.relation for lk in links)),
            "by_confidence": dict(collections.Counter(cm.label(lk.confidence) for lk in links))}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--calls", required=True, help="the ledger's scored/calls.jsonl")
    ap.add_argument("--sessions", help="JSON list of edu_videos rows with ticker_moments (EXACT mode)")
    ap.add_argument("--start", help="first session day, YYYY-MM-DD (UPPER BOUND mode)")
    ap.add_argument("--end", help="last session day, YYYY-MM-DD (UPPER BOUND mode)")
    a = ap.parse_args(argv)
    calls = _calls(a.calls)
    if a.sessions:
        rows = json.loads(pathlib.Path(a.sessions).read_text(encoding="utf-8"))
        print(json.dumps(exact(calls, rows), indent=1))
        return 0
    if not (a.start and a.end):
        ap.error("give --sessions (exact) or --start and --end (upper bound)")
    dates = _calendar(dt.date.fromisoformat(a.start), dt.date.fromisoformat(a.end))
    if not dates:
        ap.error("no trading days in that window")
    print(json.dumps(upper_bound(calls, dates), indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
