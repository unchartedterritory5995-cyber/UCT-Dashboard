"""Where is each recent breadth session in the pipeline — and is any of them STUCK?

⭐ WHY (2026-10-12, owner). On Monday morning the Agent said "as of October 8 close" and it
took an investigation to establish that nothing was wrong: Oct 9 was collected on time and was
waiting, by design, for the next session's row (the V2 producer's D+1 hindsight gate). The
existing checks answer "is today's row stored?" (`breadth_alerts.check_eod_row`) and "do the
charts look right?" (`breadth_health`); neither says WHICH STAGE a missing session is at.

STAGES (per trading session D, newest `sessions`):
  raw        the day's EOD row is stored (collector push or the server write), with created_at
  gate       the next session's row exists — the producer's precondition for finalizing D
  us         D is finalized for the US universe (`breadth_authority.universe_dates("us")`)
  nyse/nasdaq D is finalized for the exchange universes (chained after US)

EXPECTED, never guessed:
  raw for D is expected by D's RAW_DEADLINE_ET (the server write runs from 20:00 ET).
  D is expected finalized once its gate row has existed for FINALIZE_GRACE_S — the producer
  ticks every 10 minutes and the exchange runner follows it; three hours is generous.
So D=Friday is NOT late on Monday morning: its gate (Monday's row) does not exist yet.

The producer's other precondition (the minute file) lives on the runner's volume and is not
visible from web; a session stuck with raw + gate present is reported as "stuck at
finalization", which is where that file would be the next thing to check.

READ-ONLY. Values never appear here — dates, counts, timestamps, statuses only.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")

SESSIONS = 10
RAW_DEADLINE_ET = 22 * 60          # minutes after midnight ET on D (server write from 20:00)
FINALIZE_GRACE_S = 3 * 3600
FINAL_UNIVERSES = ("us", "nyse", "nasdaq")


def _sessions_back(end: date, n: int) -> list:
    from api.services import session_calendar as sc
    out, d = [], end
    while len(out) < n:
        if sc.is_trading_day(d):
            out.append(d.isoformat())
        d -= timedelta(days=1)
    return sorted(out)


def _next_session(d: str) -> str:
    from api.services import session_calendar as sc
    x = date.fromisoformat(d) + timedelta(days=1)
    for _ in range(10):
        if sc.is_trading_day(x):
            break
        x += timedelta(days=1)
    return x.isoformat()


def _utc(ts) -> Optional[datetime]:
    if not ts:
        return None
    try:
        t = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)   # breadth_snapshots stores UTC


def status(now: Optional[datetime] = None, sessions: int = SESSIONS, raw: Optional[dict] = None,
           finalized: Optional[dict] = None) -> dict:
    """`raw` = {date: created_at} of stored EOD rows; `finalized` = {universe: [dates] | None}.
    Both are read from production stores when omitted (injectable for tests)."""
    now = now or datetime.now(_ET)
    days = _sessions_back(now.date(), sessions + 1)
    if raw is None:
        from api.services import breadth_monitor as bm
        raw = {d: r.get("created_at") for d, r in bm.pit_export(since=days[0]).items()}
    if finalized is None:
        finalized = _read_finalized(days[0])
    fin = {u: (set(v) if v is not None else None) for u, v in finalized.items()}

    rows, problems = [], {"collection": [], "finalization": []}
    for d in days:
        dd = date.fromisoformat(d)
        raw_at = _utc(raw.get(d)) if d in raw else None
        deadline = datetime.combine(dd, datetime.min.time(), tzinfo=_ET) + timedelta(minutes=RAW_DEADLINE_ET)
        nxt = _next_session(d)
        gate_at = _utc(raw.get(nxt)) if nxt in raw else None
        final = {u: (None if fin.get(u) is None else d in fin[u]) for u in FINAL_UNIVERSES}
        pending = [u for u, ok in final.items() if ok is False]
        if all(ok is None for ok in final.values()):
            stage = "unknown"                    # no finalized store readable — never "fine"
        elif not pending:
            stage = "finalized"
        elif d not in raw:
            stage = "stuck_collection" if now >= deadline else "awaiting_raw"
        elif gate_at is None:
            stage = "awaiting_next_session"
        elif (now - gate_at).total_seconds() < FINALIZE_GRACE_S:
            stage = "finalizing"
        else:
            stage = "stuck_finalization"
        row = {"date": d, "stage": stage,
               "raw_at": raw_at.isoformat() if raw_at else (None if d not in raw else "unknown"),
               "gate_session": nxt, "gate_at": gate_at.isoformat() if gate_at else None,
               "finalized": final, "pending": pending}
        rows.append(row)
        if stage == "stuck_collection":
            problems["collection"].append(f"{d}: no EOD row stored (deadline {deadline:%H:%M} ET passed)")
        elif stage == "stuck_finalization":
            hrs = (now - gate_at).total_seconds() / 3600
            problems["finalization"].append(
                f"{d}: collected, next-session row present {hrs:.1f} h, still not finalized for "
                + "/".join(x.upper() for x in pending))

    # the newest session each universe SHOULD have finalized by now, vs what it has
    expected = None
    for r in rows:
        if r["stage"] in ("finalized", "stuck_finalization"):
            expected = r["date"]
    latest = {u: (max(fin[u]) if fin.get(u) else None) for u in FINAL_UNIVERSES}
    return {"as_of": now.isoformat(timespec="seconds"), "expected_finalized": expected,
            "latest_finalized": latest, "latest_raw": max(raw) if raw else None,
            "sessions": rows[-sessions:], "problems": problems,
            "ok": not problems["collection"] and not problems["finalization"]}


def _read_finalized(since: str) -> dict:
    out: dict = {}
    try:
        from api.services import breadth_authority as ba
        out["us"] = ba.universe_dates("us", since)
    except Exception:                            # noqa: BLE001
        out["us"] = None
    try:
        from api.services import breadth_exchange_authority as ea
        for u in ("nyse", "nasdaq"):
            out[u] = ea.universe_dates(u, since)
    except Exception:                            # noqa: BLE001
        out.update(nyse=None, nasdaq=None)
    return out


def check(now: Optional[datetime] = None, post=None, **kw) -> dict:
    """Status + ONE #breadth-alerts message per stuck stage (cleared when it recovers)."""
    from api.services import breadth_alerts
    res = status(now, **kw)
    sent = {}
    for cls, title in (("collection", "Breadth session not collected"),
                       ("finalization", "Breadth session collected but not finalized")):
        items = res["problems"][cls]
        if not items:
            breadth_alerts.clear(f"pipeline:{cls}")
            continue
        sent[cls] = breadth_alerts.send(f"pipeline:{cls}", title, items[:10], post=post)
    res["sent"] = sent
    return res
