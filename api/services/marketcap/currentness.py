"""Market Cap V1 CURRENTNESS -- two clocks, four states, computed at READ time (HTTP 200 never means CURRENT).

CLOCKS
  market   latest_valued_session (the last session the authority values) vs the EXPECTED session: the latest NYSE
           session whose refresh is due. A session D is due at D+1 calendar day, MCAP_PIT_DUE_ET (06:00 ET): SEC's
           nightly bulk files appear ~00:30 ET (measured 2026-10-03: submissions.zip 04:35Z, companyfacts.zip 04:27Z),
           the refresh starts after them and a full rebuild finishes well inside that window (Phase 6 measurement).
  filing   filing_knowledge_cutoff (newest filing public instant the build knew) vs the expected session's close:
           a build that values D must have considered every filing public by D 16:00 ET.

STATES
  CURRENT                 both clocks at the expected session.
  DEGRADED_UPSTREAM_LATE  one session behind, inside the grace window (MCAP_PIT_GRACE_HOURS, 6 h after due) or the
                          refresh heartbeat reports it is running / waiting for an upstream input.
  BUILD_FAILED            behind, and the refresh run for the expected session FAILED or failed its gates
                          (the previous authority is still served).
  STALE                   behind beyond the grace window, or more than one session behind, or the filing clock lags.

PROLONGED STALENESS (the contract): the authority keeps being served -- its history is still true point-in-time --
with state STALE and `lag_sessions` growing; every member response carries this block, so no consumer can present a
stale value as current. Nothing is ever back-filled with a guess and no value is ever dropped to 0. Ending a prolonged
STALE is a refresh (new build) or an operator decision (pin / rollback), never a silent switch.
"""
from __future__ import annotations

import json
import os
from datetime import date, datetime, time as dtime, timedelta, timezone
from zoneinfo import ZoneInfo

from . import release_contract as C

ET = ZoneInfo("America/New_York")
DUE_ET = os.environ.get("MCAP_PIT_DUE_ET", "06:00")
GRACE_HOURS = float(os.environ.get("MCAP_PIT_GRACE_HOURS", "6"))


def _cal():
    from api.services import session_calendar as S
    return S


def _due(d: date) -> datetime:
    hh, mm = (int(x) for x in DUE_ET.split(":"))
    return datetime.combine(d + timedelta(days=1), dtime(hh, mm), ET)


def expected_session(now: datetime) -> date:
    S = _cal()
    d = now.astimezone(ET).date()
    for _ in range(15):
        if S.is_trading_day(d) and _due(d) <= now:
            return d
        d -= timedelta(days=1)
    raise RuntimeError("no trading session in 15 days")


def sessions_between(a: date, b: date) -> int:
    """Trading sessions in (a, b]."""
    S = _cal()
    n, d = 0, a + timedelta(days=1)
    while d <= b:
        n += S.is_trading_day(d)
        d += timedelta(days=1)
    return n


def _close(d: date) -> datetime:
    S = _cal()
    return S.close_time(d) or datetime.combine(d, dtime(16, 0), ET)


def _parse_dt(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


# a heartbeat that says "in progress" but has not moved for this long is a DEAD run (a killed worker leaves
# in_progress=true behind): it no longer excuses lateness. Above the scheduler's child-process timeout (6 h).
HEARTBEAT_DEAD_HOURS = float(os.environ.get("MCAP_PIT_HEARTBEAT_DEAD_HOURS", "6.5"))


def _live(hb: dict, now: datetime) -> bool:
    if not hb.get("in_progress"):
        return False
    try:
        return (now - _parse_dt(hb["at"])).total_seconds() / 3600 <= HEARTBEAT_DEAD_HOURS
    except Exception:  # noqa: BLE001 -- an unreadable heartbeat excuses nothing
        return False


def evaluate(manifest: dict, *, heartbeat: dict | None = None, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    k = manifest["knowledge"]
    latest = date.fromisoformat(k["latest_valued_session"])
    exp = expected_session(now)
    lag = sessions_between(latest, exp) if exp > latest else 0
    cutoff = _parse_dt(k["filing_knowledge_cutoff"])
    filing_ok = cutoff >= _close(exp) if lag == 0 else cutoff >= _close(latest)
    reasons = []
    hb = heartbeat or {}
    last = hb.get("last_run") or {}
    if lag == 0 and filing_ok:
        state = "CURRENT"
    else:
        if lag:
            reasons.append(f"market clock {lag} session(s) behind (valued {latest}, expected {exp})")
        if not filing_ok:
            reasons.append(f"filing clock behind (knowledge cutoff {k['filing_knowledge_cutoff']})")
        overdue_h = (now - _due(exp)).total_seconds() / 3600
        # the refresh attempt FOR the expected session (any run finishing after that session closed) failed
        failed_for_expected = last.get("state") in ("FAILED", "GATES_FAILED") and last.get("finished_at") and \
            _parse_dt(last["finished_at"]) >= _close(exp)
        if failed_for_expected:
            state = "BUILD_FAILED"
            reasons.append(f"refresh {last.get('run_id')} FAILED at {last.get('stage')}: {str(last.get('error'))[:160]}")
        elif lag <= 1 and filing_ok is not False and (overdue_h <= GRACE_HOURS or _live(hb, now)
                                                      or last.get("state") == "WAITING_UPSTREAM"):
            state = "DEGRADED_UPSTREAM_LATE"
        else:
            state = "STALE"
    return {"state": state, "latest_valued_session": latest.isoformat(), "expected_session": exp.isoformat(),
            "lag_sessions": lag, "filing_knowledge_cutoff": k["filing_knowledge_cutoff"],
            "latest_harvest_at": k.get("latest_harvest_at"), "build_finished_at": manifest["build"].get("finished_at"),
            "authority_build_id": manifest["build_id"], "reasons": reasons,
            "contract": {"due_et": DUE_ET, "grace_hours": GRACE_HOURS}}


def read_status(reader) -> dict | None:
    """The refresh heartbeat (status.json); None when unreadable. Never authority -- it only explains state."""
    try:
        b = reader(C.STATUS_KEY)
        return json.loads(b) if b else None
    except Exception:  # noqa: BLE001
        return None
