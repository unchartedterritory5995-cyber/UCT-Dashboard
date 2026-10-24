"""Notebook widgets wave 9 (Task 9.9): optional routine reminders through the alert bell.

One optional reminder per routine, OFF by default. A routine whose settings carry
`reminder = {"on": true, "time_et": "HH:MM"}` gets ONE bell alert per ET day, at that time, on a
session day it is scheduled and still open.

Rules this module keeps:
  * ⛔ Bell only. The one delivery is `api.services.alerts.add_alert(..., user_id=...)`: a private
    alert never reaches Discord and the alerts module sends no email. This module imports neither
    `watchlist_alert_service` nor any mail code.
  * Holiday-aware (a non-session day has no slot) and moved with an early close: a time after the
    close moves back by the gap (`16:00 - close`), so 15:45 on a 13:00 close fires at 12:45.
  * ⛔ A slot missed during a deploy is skipped, never sent late: `due()` returns a routine only
    while its slot is inside `(now - 5 min, now]`.
  * At most once per routine per ET day: the claim `INSERT OR IGNORE` into
    `j2_routine_reminder_claims` (PK user_id, routine_id, day) is taken BEFORE the alert, and a
    failed alert is logged and not retried.
  * Ruling W9-R8: on a `traded` schedule today is a scheduled session before the first trade, so
    a reminder can fire before it. `routine_days.day_state` answers that; this module never
    reads trades.
  * Ruling W9-R7: no zeros. The copy carries no count.
  * ⛔ The wave flag (`notebook_widgets_wave_on(9)`) is read at every RUN, never at registration,
    and with it off `run_due` opens no connection at all.
  * `due()` is not N+1: one query reads every member's routines with a reminder on, then ONE
    query per child table (chunked by `_CHUNK` ids) reads their schedules, today's ticks and
    skips. The number of statements does not grow with the number of members.
"""
from __future__ import annotations

import json
import logging
import sqlite3
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from api.services import session_calendar
from api.services.journal_two import routine_days, trading_days
from api.services.journal_two.timeutil import ET, compute_trading_day_et

__all__ = [
    "SLOT_MINUTES", "ALERT_TYPE", "JOB_ID", "slot_for", "due", "run_due",
    "register_routine_reminder_job",
]

_log = logging.getLogger(__name__)

SLOT_MINUTES = 5
ALERT_TYPE = "routine_reminder"
JOB_ID = "notebook_routine_reminders"
MESSAGE = "Your routine for today is ready."
WAVE = 9

_REGULAR_CLOSE = time(16, 0)
_CHUNK = 400          # ids per IN (...) list, under SQLite's old 999-variable floor
_MISFIRE_GRACE_S = 60


def _utc(now: datetime | None) -> datetime:
    ts = now or datetime.now(timezone.utc)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts


def slot_for(time_et: str, d: date) -> datetime | None:
    """The ET instant a reminder set for `time_et` fires on `d`, or None.

    None on a non-session day (weekend, holiday). On an early close, a time after the close moves
    back by the gap (`16:00 - close`); otherwise the stated time, ET-aware. A malformed time is
    None: a reminder that cannot be placed is never sent."""
    try:
        hh, mm = (int(x) for x in str(time_et).split(":"))
        at = time(hh, mm)
    except (TypeError, ValueError):
        return None
    if not trading_days.is_session(d):
        return None
    when = datetime.combine(d, at, tzinfo=ET)
    if session_calendar.is_half_day(d):
        close = session_calendar.close_time(d)
        if close is not None and when > close:
            gap = datetime.combine(d, _REGULAR_CLOSE, tzinfo=ET) - close
            when = when - gap
    return when


def _chunks(seq: list[str]):
    for i in range(0, len(seq), _CHUNK):
        yield seq[i:i + _CHUNK]


def _reminder_rows(conn: sqlite3.Connection) -> list[sqlite3.Row | tuple]:
    """Every live routine with a reminder on, all members, in ONE query."""
    base = ("SELECT id, user_id, name, items_json, settings_json, created_at FROM j2_routines"
            " WHERE archived_at IS NULL AND deleted_at IS NULL")
    try:
        return conn.execute(
            base + " AND json_extract(settings_json, '$.reminder.on') IN (1, 'true')").fetchall()
    except sqlite3.OperationalError:
        # No JSON1: read the live rows and let `_settings` decide.
        return conn.execute(base + " AND settings_json LIKE '%\"reminder\"%'").fetchall()


def _settings(raw: str | None) -> tuple[dict | None, float]:
    """(the reminder dict when it is on and well formed, done_share)."""
    try:
        s = json.loads(raw) if raw else {}
    except (TypeError, ValueError):
        return None, 1.0
    if not isinstance(s, dict):
        return None, 1.0
    share = s.get("done_share", 1.0)
    share = next((x for x in routine_days.DONE_SHARES
                  if isinstance(share, (int, float)) and not isinstance(share, bool)
                  and abs(float(share) - x) < 1e-9), 1.0)
    rem = s.get("reminder")
    if not isinstance(rem, dict) or rem.get("on") is not True or not isinstance(rem.get("time_et"), str):
        return None, share
    return rem, share


def _created_day(created_at: str | None) -> date:
    day = compute_trading_day_et(created_at)
    try:
        return date.fromisoformat(day) if day else date.min
    except ValueError:
        return date.min


def due(conn: sqlite3.Connection, now: datetime) -> list[tuple[str, str, str, str]]:
    """`(user_id, routine_id, day, name)` for every routine that is not archived or deleted, has a
    reminder on, is scheduled today, is not done or skipped today, and whose slot falls in
    `(now - 5 min, now]`. A slot outside that window is never returned."""
    now = _utc(now)
    today = trading_days.today_et(now)
    day = today.isoformat()
    window_lo = now - timedelta(minutes=SLOT_MINUTES)

    # Cheap rejects first: nothing is read for a day with no session.
    if not trading_days.is_session(today):
        return []

    candidates = []
    for rid, uid, name, items_json, settings_json, created_at in _reminder_rows(conn):
        rem, share = _settings(settings_json)
        if rem is None:
            continue
        slot = slot_for(rem["time_et"], today)
        if slot is None or not (window_lo < slot <= now):
            continue
        candidates.append((rid, uid, name, items_json, created_at, share))
    if not candidates:
        return []

    rids = [c[0] for c in candidates]
    schedules: dict[str, list[tuple[str, dict]]] = {r: [] for r in rids}
    ticks: dict[str, dict[str, bool]] = {r: {} for r in rids}
    skipped: set[str] = set()
    for chunk in _chunks(rids):
        marks = ",".join("?" for _ in chunk)
        for rid, uid, eff, js in conn.execute(
                "SELECT routine_id, user_id, effective_from, schedule_json FROM j2_routine_schedules"
                f" WHERE routine_id IN ({marks}) AND effective_from <= ? ORDER BY effective_from",
                (*chunk, day)):
            try:
                sched = json.loads(js)
            except (TypeError, ValueError):
                continue
            if isinstance(sched, dict):
                schedules[rid].append((uid, eff, sched))
        for rid, uid, item_id, ticked in conn.execute(
                "SELECT routine_id, user_id, item_id, ticked FROM j2_routine_ticks"
                f" WHERE routine_id IN ({marks}) AND day = ?", (*chunk, day)):
            ticks[rid][(uid, item_id)] = bool(ticked)
        for rid, uid in conn.execute(
                "SELECT routine_id, user_id FROM j2_routine_days"
                f" WHERE routine_id IN ({marks}) AND day = ? AND skipped = 1", (*chunk, day)):
            skipped.add((rid, uid))

    out: list[tuple[str, str, str, str]] = []
    for rid, uid, name, items_json, created_at, share in candidates:
        # Ownership: only rows written under the routine's own member count.
        scheds = [(eff, s) for u, eff, s in schedules[rid] if u == uid]
        day_ticks = {item_id: t for (u, item_id), t in ticks[rid].items() if u == uid}
        try:
            raw_items = json.loads(items_json) if items_json else []
            items = routine_days.parse_items(raw_items if isinstance(raw_items, list) else [])
            state = routine_days.day_state(
                items=items, schedule=routine_days.schedule_on(scheds, today), ticks=day_ticks,
                skipped=(rid, uid) in skipped, day=today, today=today,
                created=_created_day(created_at), traded=frozenset(), done_share=share)
        except (KeyError, TypeError, ValueError):
            continue    # a routine whose stored body cannot be read is not reminded
        if state.state == "open":
            out.append((uid, rid, day, name))
    return out


def run_due(now: datetime | None = None) -> dict:
    """Send today's due reminders. `{"skipped": "flag off"}` with no read when wave 9 is off; else
    `{"claimed": n, "sent": n}`. ⛔ Claim, then deliver: the insert is the once-a-day guard, and a
    failed alert is logged and NOT retried."""
    from api.services.journal_two.notebook_widgets import notebook_widgets_wave_on
    if not notebook_widgets_wave_on(WAVE):
        return {"skipped": "flag off"}
    from api.services import alerts, auth_db
    now = _utc(now)
    claimed = sent = 0
    conn = auth_db.get_connection()
    try:
        for uid, rid, day, name in due(conn, now):
            cur = conn.execute(
                "INSERT OR IGNORE INTO j2_routine_reminder_claims (user_id, routine_id, day, claimed_at)"
                " VALUES (?, ?, ?, ?)",
                (uid, rid, day, now.astimezone(ET).isoformat(timespec="seconds")))
            conn.commit()
            if cur.rowcount != 1:
                continue
            claimed += 1
            try:
                alerts.add_alert(ALERT_TYPE, name, MESSAGE, severity="info",
                                 data={"routineId": rid, "day": day}, user_id=uid)
                sent += 1
            except Exception as e:  # noqa: BLE001 - one member must not stop the rest
                _log.warning("routine reminder for %s not delivered: %s", rid, e)
    finally:
        conn.close()
    return {"claimed": claimed, "sent": sent}


def register_routine_reminder_job(scheduler) -> bool:
    """Schedule `run_due` every five minutes, ET. For `api/main.py`'s scheduler block, beside
    `note_tasks.register_task_reminder_job`.

    ⛔ The wave flag is NOT read here; `run_due` reads it at every run, so flipping it needs no
    restart. ⛔ The job body looks `run_due` up at CALL time and never raises into the scheduler."""
    from apscheduler.triggers.cron import CronTrigger

    def body() -> None:
        try:
            result = run_due()
            if result.get("claimed"):
                print(f"[notebook-routine-reminders] {result}")
        except Exception as e:  # noqa: BLE001 - a failed run must never break the scheduler
            print(f"[notebook-routine-reminders] run failed: {e}")

    scheduler.add_job(
        body,
        CronTrigger(minute="*/5", timezone=ET),
        id=JOB_ID,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=_MISFIRE_GRACE_S,
        replace_existing=True,
    )
    return True
