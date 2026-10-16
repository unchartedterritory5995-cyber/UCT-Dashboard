# api/services/journal_two/earnings_followup.py
"""Tier 2 part B, item 11: the earnings follow-up NOTICE (spec §P2 Tier 2 item 11).

After the session that first traded the earnings result of a member's held, watched or flagged name
closes, the member's Notices box offers "<SYM> reported: write your follow-up". Its link opens a card
whose "Write follow-up" makes the note through the ONE styled-create door (followup_prefill.py).

THE RULES (R-T2B-1..6, 10):
* NEVER WRITES A NOTE (decision R5). This rings a bell; the member makes the note.
* WHO: paid members, over their OWN names (earnings_prep._member_sets: open positions, watchlists,
  flagged). One notice per (member, symbol, report date), however many sets hold the name.
* WHEN: the run on trading day T offers every report whose REACTION SESSION is T or earlier, among the
  reports dated from the previous trading day through T (`reaction_session`, F9). 16:45 ET and 18:00 ET
  mon-fri, plus a boot catch-up; a holiday is skipped INSIDE the run. The two switches
  (NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED and the journal styles switch, which the card's create needs) are read
  at every RUN, never at registration.
* `<=` AND NOT `==` (F9): a report whose time flips from unknown to known between two days (unknown reads
  as after the close, so its session is the next day; known as before the open, its session is the report
  day) would otherwise be offered on neither. The claim table's primary key, (member, symbol, report date),
  is what makes the second sight a no-op, so a report is offered exactly once however many days see it.
* CLAIM, THEN DELIVER (note_tasks' idiom): ONE atomic INSERT claims AND enforces DAILY_CAP per member
  per session day; a delivery that raises releases its claim.
* Inside the cap: largest |reaction| first, an unmeasured one last (a move counts only when MEASURED: the reacting
  session's close + 30 minutes had passed when UCT read it, followup_prefill.measured_move), then by symbol. The rest are
  counted (`capped`) and RECORDED in the claim table with status 'capped': capped is FINAL, the same
  primary key keeps every later pass, day and catch-up from delivering them (they never roll over to
  the next session). `session_day` is the DELIVERY day (the run's day, which is what the cap counts),
  not the session that reacted to the report. A 'capped' row takes no slot of the cap.
* It WARMS earnings_intel (get_earnings, on this scheduler thread) for every name it ranks, so the
  member's create reads what UCT already holds and never waits on a vendor (R-T2B-10). The warm has a
  wall-clock budget (WARM_BUDGET_S, F21): past it a name is not warmed, ranks as unmeasured, and is counted
  in the run ledger (`warm_skipped`). A copy read before the reacting session closed (+30 min) is REBUILT once,
  inside the same budget, and the rank uses the fresh copy (final fix C, I1: `refreshed`, `refresh_failed`,
  `refresh_skipped` in the ledger).
* WHO REPORTED IS THE CALENDAR BOARD UNION FINNHUB'S WHOLE DAY (final fix C, I2, `reporters_on`): the board keeps
  the top names per session only, so a smaller name comes from Finnhub's list. One Finnhub call per scanned day;
  a failed one leaves the board's answer and a PARTIAL day (the ledger says so).
* NO PROVIDER CONFIGURED IS INCONCLUSIVE, NEVER "NOBODY REPORTED" (V4): calendar_alerts answers
  `(set(), True)` for an unconfigured box exactly as it does for a quiet day, so the run looks for a key
  (`_reporters_configured`) and, finding none, records the run as `unconfigured` (not complete) and stops.
* SHARED HELPERS ARE IMPORTED, NEVER COPIED: trading-day arithmetic is reminder_block.add_trading_days,
  the day wording / numbers / event lookup / symbol shape are followup_prefill's, and the in-app bell is
  note_tasks.deliver_in_app (bound here to this job's own source).
"""
from __future__ import annotations

import json
import os
import time
from datetime import date, datetime, time as dtime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

from api.services import auth_db, session_calendar
from api.services.notebook_flags import flag_on
from api.services.journal_two.reminder_block import add_trading_days
from api.services.journal_two.timeutil import ET

FLAG = "NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED"
FOLLOWUP_SOURCE = "notebook_earnings_followup"
FIRST_PASS = (16, 45)
SECOND_PASS = (18, 0)
MISFIRE_GRACE_S = 3600
CATCH_UP_DELAY_S = 120
DAILY_CAP = 3
#: Wall-clock seconds a run may spend warming earnings_intel (F21), counted from the first warm.
WARM_BUDGET_S = 120
#: The reporters lookup is configured when one of these keys is set (V4); calendar_alerts reads the same two.
PROVIDER_KEYS = ("FINNHUB_API_KEY", "FMP_API_KEY")
SAME_SESSION = frozenset({"bmo", "dmh"})
NOTEBOOK_PATH = "/journal/notebook"
_WALK = 15            # calendar days a trading-day walk may step: a long weekend and a holiday fit

_SCHEMA = """
CREATE TABLE IF NOT EXISTS j2_earnings_followup_log (
    user_id      TEXT NOT NULL,
    symbol       TEXT NOT NULL,
    report_date  TEXT NOT NULL,
    session_day  TEXT NOT NULL,      -- the day the run offered it (the cap counts this), not the reacting session
    created_at   TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'claimed',
    PRIMARY KEY (user_id, symbol, report_date)
);
CREATE INDEX IF NOT EXISTS idx_j2_followup_log_day ON j2_earnings_followup_log (user_id, session_day);
CREATE TABLE IF NOT EXISTS j2_earnings_followup_runs (
    day       TEXT NOT NULL,
    pass      TEXT NOT NULL,
    ran_at    TEXT NOT NULL,
    complete  INTEGER NOT NULL DEFAULT 0,
    result    TEXT NOT NULL,
    PRIMARY KEY (day, pass)
);
"""
_CLAIM = ("INSERT OR IGNORE INTO j2_earnings_followup_log"
          " (user_id, symbol, report_date, session_day, created_at, status)"
          " SELECT ?, ?, ?, ?, ?, 'claimed' WHERE (SELECT COUNT(*) FROM j2_earnings_followup_log"
          " WHERE user_id = ? AND session_day = ? AND status != 'capped') < ?")
_CAPPED = ("INSERT OR IGNORE INTO j2_earnings_followup_log"
           " (user_id, symbol, report_date, session_day, created_at, status) VALUES (?, ?, ?, ?, ?, 'capped')")


def enabled() -> bool:
    """The gate, read per call (default OFF): the job, the card and the server prefill."""
    return flag_on(FLAG, False)


def _now() -> datetime:
    return datetime.now(tz=ET)


def _mono() -> float:
    """The warm budget's clock. A function, looked up at CALL time, so a test can move it."""
    return time.monotonic()


def ensure_schema(conn) -> None:
    conn.executescript(_SCHEMA)


def prev_trading_day(d: date) -> date:
    for _ in range(_WALK):
        d -= timedelta(days=1)
        if session_calendar.is_trading_day(d):
            return d
    return d


def reaction_session(report_date: date, timing: str | None) -> date:
    """The session that first traded the result (R-T2B-2, R-T2B-3)."""
    if not session_calendar.is_trading_day(report_date):
        return add_trading_days(report_date, 1)
    if timing in SAME_SESSION:
        return report_date
    return add_trading_days(report_date, 1)


def _finnhub_day(day_iso: str) -> list[dict] | None:
    """Finnhub's WHOLE earnings day: the ONE Finnhub call per scanned day (R-T2B-4, the shared token bucket).
    The rows, or None when the call failed (fh_get answers None for a failure, an unset key and a cooldown alike;
    each is a day the job could not confirm). Never raises."""
    try:
        from api.services.finnhub_client import fh_get
        data = fh_get("/calendar/earnings", {"from": day_iso, "to": day_iso}, timeout=10)
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(data, dict):
        return None
    rows = data.get("earningsCalendar") or []
    return [r for r in rows if isinstance(r, dict)] if isinstance(rows, list) else None


def _row_symbol(row: dict) -> str:
    return str(row.get("symbol") or "").strip().upper()


def _fill_timing(found: dict, rows: list[dict]) -> None:
    """Finnhub's hour for each name that has no time yet; a time the board already names is kept, and only
    bmo / amc / dmh count as a time (an empty or unknown hour stays "after the close", R-T2B-3)."""
    for row in rows:
        sym = _row_symbol(row)
        hour = str(row.get("hour") or "").strip().lower()
        if sym in found and not found[sym] and hour in ("bmo", "amc", "dmh"):
            found[sym] = hour


def _board_names(day_iso: str) -> tuple[set[str], bool]:
    """(the calendar board's names for `day_iso`, clean). The board is the `calendar_weekly` cache: a DISPLAY
    board that keeps EarningsWhispers' top names per session (40 for a coming day, 150 for a finished one), never
    a census, which is why reporters_on unions Finnhub's whole day into it (final fix C, I2). Cache read only,
    shape-checked by the week contract's one assertion; a malformed board is (no names, unclean). Never raises."""
    try:
        from api.services.cache import cache
        from api.services.calendar_week_contract import BUCKETS, week_days
        days = week_days(cache.get("calendar_weekly"),
                         reader="api.services.journal_two.earnings_followup._board_names") or {}
    except Exception:  # noqa: BLE001 -- a broken board is unclean, never a failed run
        return set(), False
    day = days.get(day_iso) or {}
    return {e["sym"].strip().upper() for b in BUCKETS for e in day.get(b) or [] if e["sym"].strip()}, True


def _reporters_configured() -> bool:
    """True when the reporters lookup has something to ask (V4). `calendar_alerts` answers `(set(), True)`
    for a box with no provider key and an empty cache, which is the answer for a quiet day too: so the
    run looks for the KEY. The walk's sandbox calendar file is its own source and needs none."""
    from api.services.journal_two import earnings_prep as ep
    if ep.sandbox_calendar_active():
        return True
    return any((os.environ.get(k) or "").strip() for k in PROVIDER_KEYS)


def reporters_on(day: date) -> tuple[dict[str, str | None], bool]:
    """({SYM: 'bmo'|'amc'|'dmh'|None}, clean) for reports dated `day`.

    THE BOARD UNION FINNHUB'S WHOLE DAY (final fix C, I2): the calendar board keeps only the top names per session,
    so a member's small name is found through Finnhub's full list for the day, with Finnhub's hour. ONE Finnhub call
    per scanned day, made whenever the day is looked up. When both come back empty, calendar_alerts' FMP leg is
    asked (its breadth leg for a throttled day). Clean only when every leg that ran answered cleanly: a failed
    Finnhub call leaves the board's answer and an unclean (partial) day, never a raise. The walk's sandbox
    calendar file is its own source and is read alone."""
    from api.services.journal_two import earnings_prep as ep
    iso = day.isoformat()
    if ep.sandbox_calendar_active():
        window, timing, partial, _ = ep._sandbox_window()
        return {s: timing.get(s) for s, d in window.items() if d == iso}, not partial
    board, ok = _board_names(iso)
    rows = _finnhub_day(iso)
    found = {s: ep._timing_from_calendar_cache(s, iso) for s in sorted(board)}
    for sym in (_row_symbol(r) for r in rows or []):
        if sym:
            found.setdefault(sym, None)
    if rows is None:
        ok = False
    else:
        _fill_timing(found, rows)
    if not found:
        from api.services import calendar_alerts
        fmp, fmp_ok = calendar_alerts._fmp_reporters_for_date_with_status(iso)
        found, ok = {s: None for s in sorted(fmp)}, ok and fmp_ok
    return found, ok


def todays_reports(day: date) -> tuple[dict[str, str], bool, int]:
    """({SYM: report date}, partial, unknown-time count) for the reports whose reaction session is `day`
    or earlier, among those dated from the previous trading day through `day` (F9)."""
    out: dict[str, str] = {}
    partial, unknown = False, 0
    d = prev_trading_day(day)
    while d <= day:
        found, ok = reporters_on(d)
        partial = partial or not ok
        for sym, timing in sorted(found.items()):
            if sym not in out and reaction_session(d, timing) <= day:
                out[sym] = d.isoformat()
                unknown += 0 if timing else 1
        d += timedelta(days=1)
    return out, partial, unknown


def _member_ids(conn) -> list[str]:
    return [str(r[0]) for r in conn.execute("SELECT id FROM users")]


def _member_sets(user_id: str) -> dict[str, list[str]]:
    from api.services.journal_two import earnings_prep
    return earnings_prep._member_sets(user_id)


def _paid(user_id: str, conn) -> bool:
    try:
        from api.middleware import auth_middleware as authmw
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if row is None:
            return False
        return bool(authmw.is_paid_user({**dict(row), "plan": authmw.get_user_plan(user_id)}))
    except Exception:  # noqa: BLE001 -- an unreadable plan is "not paid", never a failed run
        return False


def _refresh_due(symbol: str, report_date: str, intel: Any, now: datetime) -> bool:
    """True when the held copy is UNMEASURED and the reacting session has, by `now`, closed (+MEASURE_BUFFER): a
    fresh build would be measured. Both halves are followup_prefill's own gate (reacting_session,
    reaction_is_measured, _measured_after); nothing is restated here. A MEASURED copy is never rebuilt."""
    from api.services.journal_two import followup_prefill as fp
    if not isinstance(intel, dict):
        return False
    session, _ = fp.reacting_session(symbol, report_date)
    if session is None or fp.reaction_is_measured(report_date, intel.get("meta"), session):
        return False
    return now >= fp._measured_after(session)


def _count(tally: dict | None, key: str) -> None:
    if tally is not None:
        tally[key] = tally.get(key, 0) + 1


def _reaction_pct(symbol: str, report_date: str, now: datetime | None = None, may_refresh=None,
                  tally: dict | None = None) -> float | None:
    """The reaction for ranking, and the WARM of earnings_intel for the member's create (R-T2B-10).

    ⛔ Only a MEASURED move (followup_prefill.measured_move: the same gate the note's "Reaction:" line uses). A
    payload read before the reacting session closed (+30 min) holds the pre-news session's move, and ranking by it
    would fix a wrong order for good (capped is final), so an unmeasured move ranks as no move.
    ⛔ get_earnings serves a copy read before the close for its whole TTL (24 h once the next report is far), so
    a warm alone cannot move it (final fix C, I1). When the copy is unmeasured and the session HAS closed by `now`
    (`_refresh_due`), ONE fresh build runs through earnings_intel.refresh_earnings and the rank uses it. Inside the
    warm budget: `may_refresh()` is asked first, and a refused or failed refresh ranks as unmeasured (counted in
    `tally` as refresh_skipped / refresh_failed; a good one as refreshed). Never raises."""
    try:
        from api.services import earnings_intel
        from api.services.journal_two import followup_prefill as fp
        intel = earnings_intel.get_earnings(symbol)
        move = fp.measured_move(symbol, report_date, intel)
        if move is not None or not _refresh_due(symbol, report_date, intel, now or _now()):
            return move
    except Exception:  # noqa: BLE001
        return None
    if may_refresh is not None and not may_refresh():
        _count(tally, "refresh_skipped")
        return None
    try:
        fresh = earnings_intel.refresh_earnings(symbol)
    except Exception:  # noqa: BLE001 -- refresh_earnings never raises; a broken seam still must not
        fresh = None
    if fresh is None:
        _count(tally, "refresh_failed")
        return None
    _count(tally, "refreshed")
    try:
        return fp.measured_move(symbol, report_date, fresh)
    except Exception:  # noqa: BLE001
        return None


def followup_url(symbol: str, report_date: str) -> str:
    return f"{NOTEBOOK_PATH}?{urlencode({'followup': symbol, 'reportDate': report_date})}"


def notice_copy(symbol: str, report_date: date, sources: list[str]) -> tuple[str, str]:
    """The bell's title and message. ⛔ The reason is the MOST SPECIFIC source: positions, then flagged, then
    watchlist. The Flagged list is a watchlist row (member_interest._watchlist_syms joins it), so a flagged name
    always carries "watchlist" too; testing watchlist first made "You flagged it." unreachable (final fix C, M1)."""
    from api.services.journal_two.followup_prefill import _day_words
    if "positions" in sources:
        why = "You hold it."
    elif "flagged" in sources:
        why = "You flagged it."
    else:
        why = "It is on your watchlist."
    return (f"{symbol} reported: write your follow-up",
            f"{symbol} reported earnings on {_day_words(report_date)}. {why} "
            "Compare what you expected with what happened.")


def _offer(conn, uid: str, sym: str, report_date: str, day: date, sources: list[str], deliver,
           result: dict) -> None:
    stamp = datetime.now(tz=ET).isoformat(timespec="seconds")
    cur = conn.execute(_CLAIM, (uid, sym, report_date, day.isoformat(), stamp, uid, day.isoformat(), DAILY_CAP))
    conn.commit()
    if cur.rowcount == 0:
        held = conn.execute("SELECT status FROM j2_earnings_followup_log WHERE user_id = ? AND symbol = ?"
                            " AND report_date = ?", (uid, sym, report_date)).fetchone()
        if held is None:        # over the cap: final. Written, so no later pass or day can deliver it.
            conn.execute(_CAPPED, (uid, sym, report_date, day.isoformat(), stamp))
            conn.commit()
        result["capped" if held is None or held[0] == "capped"
               else ("already_sent" if held[0] == "sent" else "in_flight")] += 1
        return
    title, message = notice_copy(sym, date.fromisoformat(report_date), sources)
    data = {"source": FOLLOWUP_SOURCE, "research_url": followup_url(sym, report_date), "symbol": sym,
            "reportDate": report_date, "sessionDay": day.isoformat(), "sources": list(sources)}
    try:
        deliver(uid, title, message, data)
    except Exception:  # noqa: BLE001 -- one member must not stop the rest; a later pass retries
        conn.execute("DELETE FROM j2_earnings_followup_log WHERE user_id = ? AND symbol = ? AND report_date = ?"
                     " AND status = 'claimed'", (uid, sym, report_date))
        conn.commit()
        result["failed"] += 1
        return
    conn.execute("UPDATE j2_earnings_followup_log SET status = 'sent' WHERE user_id = ? AND symbol = ?"
                 " AND report_date = ?", (uid, sym, report_date))
    conn.commit()
    result["delivered"] += 1


def _record_run(conn, result: dict, when: datetime) -> None:
    complete = int(result["failed"] == 0 and result["in_flight"] == 0 and not result["partial"]
                   and result["skipped"] is None)
    conn.execute("INSERT OR REPLACE INTO j2_earnings_followup_runs (day, pass, ran_at, complete, result)"
                 " VALUES (?, ?, ?, ?, ?)",
                 (result["day"], result["pass"], when.isoformat(timespec="seconds"), complete,
                  json.dumps(result, sort_keys=True)))
    conn.commit()


def _within_budget(clock: dict) -> bool:
    """True while the run's warm budget (WARM_BUDGET_S, counted from the first warm) has time left."""
    if clock["start"] is None:
        clock["start"] = _mono()
    return _mono() - clock["start"] < WARM_BUDGET_S


def _warm(reactions: dict, mine: dict, reports: dict, clock: dict, result: dict) -> None:
    """Fill `reactions` for the names in `mine` not yet read. Past WARM_BUDGET_S (counted from the first warm
    of the run) a name is NOT warmed: it ranks as unmeasured and is counted (F21). The same budget bounds a
    name's one refresh (I1)."""
    for s in mine:
        if s in reactions:
            continue
        if not _within_budget(clock):
            reactions[s] = None
            result["warm_skipped"] += 1
            continue
        reactions[s] = _reaction_pct(s, reports[s], clock["now"], lambda: _within_budget(clock), result)
        result["warmed"] += 1


def _scan(conn, day: date, deliver, result: dict, when: datetime | None = None) -> None:
    from api.services.journal_two import followup_prefill as fp
    reports, result["partial"], result["timing_unknown"] = todays_reports(day)
    reports = {s: d for s, d in reports.items() if fp.valid_symbol(s)}
    result["candidates"] = len(reports)
    reactions: dict[str, float | None] = {}
    clock: dict[str, Any] = {"start": None, "now": when or _now()}
    if not reports:
        return
    for uid in _member_ids(conn):
        try:
            if not _paid(uid, conn):          # first: an unpaid member's sets are never read (M6)
                continue
            mine = {s: src for s, src in _member_sets(uid).items() if s in reports}
            if not mine:
                continue
        except Exception:  # noqa: BLE001 -- one member's unreadable sets must not stop the rest
            result["failed"] += 1
            continue
        result["members"] += 1
        _warm(reactions, mine, reports, clock, result)
        order = sorted(mine, key=lambda s: (reactions[s] is None, -abs(reactions[s] or 0.0), s))
        try:
            for s in order:
                _offer(conn, uid, s, reports[s], day, mine[s], deliver, result)
        except Exception:  # noqa: BLE001 -- e.g. a locked database on the claim: this member only
            try:
                conn.rollback()
            except Exception:  # noqa: BLE001
                pass
            result["failed"] += 1


def run_followups(now: datetime | None = None, *, pass_label: str = "manual", conn=None, deliver=None) -> dict:
    """One pass for the session day of `now` (ET). Safe to run twice, and twice at once."""
    when = (now or _now()).astimezone(ET)
    day = when.date()
    result: dict[str, Any] = {"day": day.isoformat(), "pass": pass_label, "skipped": None, "members": 0,
                              "candidates": 0, "delivered": 0, "already_sent": 0, "in_flight": 0, "capped": 0,
                              "failed": 0, "timing_unknown": 0, "partial": False, "warmed": 0,
                              "warm_skipped": 0, "refreshed": 0, "refresh_failed": 0, "refresh_skipped": 0}
    from api.services.journal_two import journal_styles
    if not (enabled() and journal_styles.enabled()):
        result["skipped"] = "switched-off"
        return result
    if not session_calendar.is_trading_day(day):
        result["skipped"] = "not-a-trading-day"
        return result
    deliver = deliver or _deliver_in_app
    owned = conn is None
    conn = conn or auth_db.get_connection()
    try:
        ensure_schema(conn)
        if not _reporters_configured():
            result["skipped"] = "unconfigured"          # V4: inconclusive, never "nobody reported"
            _record_run(conn, result, when)
            return result
        try:
            _scan(conn, day, deliver, result, when)
        except Exception as e:  # noqa: BLE001 -- whatever broke, the run is still ledgered, as incomplete
            result["failed"] += 1
            result["error"] = type(e).__name__
        _record_run(conn, result, when)
        return result
    finally:
        if owned:
            conn.close()


def catch_up_target(now: datetime) -> date:
    """Today once its first pass time has passed; otherwise the trading day before."""
    when = now.astimezone(ET)
    d = when.date()
    if session_calendar.is_trading_day(d) and (when.hour, when.minute) >= FIRST_PASS:
        return d
    return prev_trading_day(d)


def catch_up_followups(now: datetime | None = None, conn=None, deliver=None) -> dict:
    """The boot catch-up: run the latest session day whose first pass has passed, unless a pass for that
    day completed (no failure, nothing in flight, every source clean)."""
    target = catch_up_target(now or _now())
    if not enabled():
        return {"ran": False, "reason": "disabled", "day": target.isoformat()}
    owned = conn is None
    conn = conn or auth_db.get_connection()
    try:
        ensure_schema(conn)
        done = conn.execute("SELECT 1 FROM j2_earnings_followup_runs WHERE day = ? AND complete = 1",
                            (target.isoformat(),)).fetchone()
        if done:
            return {"ran": False, "reason": "already-complete", "day": target.isoformat()}
        at = datetime.combine(target, dtime(*SECOND_PASS), tzinfo=ET)
        return {"ran": True, **run_followups(now=at, pass_label="catch-up", conn=conn, deliver=deliver)}
    finally:
        if owned:
            conn.close()


def register_followup_jobs(scheduler) -> bool:
    """16:45 and 18:00 ET mon-fri, each with a one-hour misfire grace, and a one-shot boot catch-up.
    ⛔ The switch is NOT read here (read at every run). ⛔ Each body looks its run up at CALL time."""
    from zoneinfo import ZoneInfo
    from apscheduler.triggers.cron import CronTrigger
    from apscheduler.triggers.date import DateTrigger
    et = ZoneInfo("America/New_York")

    def _boundary(label: str, run):
        def body() -> None:
            try:
                print(f"[notebook-earnings-followup] {label}: {run()}")
            except Exception as e:  # noqa: BLE001 -- a failed run must never break the scheduler
                print(f"[notebook-earnings-followup] {label} failed: {e}")
        return body

    for job_id, (h, m), label in (("notebook_earnings_followup", FIRST_PASS, "16:45"),
                                  ("notebook_earnings_followup_second", SECOND_PASS, "18:00")):
        scheduler.add_job(
            _boundary(f"{label} pass", lambda label=label: run_followups(pass_label=label)),
            CronTrigger(day_of_week="mon-fri", hour=h, minute=m, timezone=et),
            id=job_id, max_instances=1, coalesce=True, misfire_grace_time=MISFIRE_GRACE_S, replace_existing=True,
        )
    scheduler.add_job(
        _boundary("boot catch-up", lambda: catch_up_followups()),
        DateTrigger(run_date=datetime.now(tz=timezone.utc) + timedelta(seconds=CATCH_UP_DELAY_S)),
        id="notebook_earnings_followup_catch_up", max_instances=1, misfire_grace_time=MISFIRE_GRACE_S,
        replace_existing=True,
    )
    return True


def _deliver_in_app(user_id: str, title: str, message: str, data: dict) -> None:
    """The in-app bell ONLY, through note_tasks' one helper, bound to this job's own source."""
    from api.services.journal_two.note_tasks import deliver_in_app
    deliver_in_app(FOLLOWUP_SOURCE, user_id, title, message, data)
