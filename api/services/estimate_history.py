"""COV-07 -- estimate history: how the consensus EPS / revenue estimate for each
upcoming fiscal quarter has moved, day by day. The Research > Estimate history tab.

Why our own snapshots. FMP's `/stable/historical-analyst-estimates` answered 404
on this plan (live probe 2026-10-02), and `/stable/analyst-estimates` returns
only TODAY's consensus. So the history is built here: a scheduled job reads the
current quarterly consensus for each tracked symbol once a day and appends it,
keyed (symbol, snapshot date, fiscal period end). History therefore begins on
the first snapshot and `covers_from` says so; it is never back-filled or
implied to be longer.

Honesty rules, each railed in tests/test_research_cov_05_07_09.py:
  * a revision is shown only once a period has n >= 2 snapshots; with one, the
    period says "collecting" and names the date it started;
  * every point names its source and snapshot date;
  * a day whose read failed is recorded in `estimate_run` and counted as a gap,
    never silently skipped;
  * a symbol with no snapshot is `collecting` with the reason, never an empty table.

Request path: reads the local SQLite store only (plus registering the symbol as
tracked, a local write). No vendor call. DARK behind ESTIMATE_HISTORY_ENABLED:
unset, the route 404s and the daily job does nothing.

WHEN, AND THE CATCH-UP (2026-11-23). The scheduler calls `run_scheduled` on weekday
evenings at `RUN_AT_ET` (18:20 New York time, `RUN_DAYS`), in the busy span by design.
A fire that lands while the pod restarts for a deploy is lost (the new container
schedules the NEXT evening), which left a permanent one-day hole in EEH and EEHSC. So
`catch_up` (a DATE job `CATCHUP_BOOT_DELAY_S` after boot and a daily retry at
`CATCHUP_AT_ET`) takes the missed snapshot, through the same run, but ONLY while it
still stands for that session: after that evening's 18:20 and before the next
session's open (`target_session`, session_calendar's holidays and open). A snapshot
records the estimates as they stand, so it is labelled by the session it represents
(the slot's New York date) and never taken under an earlier date once the next
session has opened: past that, the hole stays, is recorded in `estimate_job` as
'missed' and is said (`history()['missed_days']`, and the catch-up's answer). The
catch-up keeps the JOB's window, not scan_period's quiet span. It reads only the
symbols no read has been tried for that session (a read that failed is not repeated),
and it runs one at a time with the 18:20 job (`_RUN_LOCK`).
"""
from __future__ import annotations

import contextlib
import json
import logging
import os
import sqlite3
import threading
import time
from datetime import date, datetime, time as dtime, timedelta, timezone
from typing import Any, Callable, Optional

_logger = logging.getLogger(__name__)

ENABLED_ENV = "ESTIMATE_HISTORY_ENABLED"
SOURCE = "FMP /stable/analyst-estimates (period=quarter), snapshotted daily by UCT"
MAX_SYMBOLS = int(os.environ.get("ESTIMATE_HISTORY_MAX_SYMBOLS", "600"))
PACE_S = float(os.environ.get("ESTIMATE_HISTORY_PACE_S", "1.0"))   # well under the FMP bucket
RUN_BUDGET_S = float(os.environ.get("ESTIMATE_HISTORY_RUN_BUDGET_S", "2700"))
LOOKBACK_DAYS = 95      # a quarter that ended this recently may not have reported yet
MAX_PERIODS = 4
FMP_LIMIT = 12
_WRITE_LOCK = threading.Lock()
#: THE SCHEDULE, read by `api/main.py` (`estimate_history_daily`) and by the catch-up: weekday evenings, New York
#: time. The cron knows no holidays (a holiday evening is snapshotted like any weekday evening).
RUN_AT_ET = (18, 20)
RUN_DAYS = "mon-fri"
#: The catch-up's boot check, this long after registration (after INS 600 s, IV rank 900 s, N-PORT 1200 s), and its
#: daily retry, after the evening run's budget. Both keep the job's own window (`target_session`).
CATCHUP_BOOT_DELAY_S = 1500
CATCHUP_AT_ET = (21, 5)
#: One run at a time, whichever door it came through (the 18:20 job, the boot check, the retry).
_RUN_LOCK = threading.Lock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS estimate_snapshot (
  symbol      TEXT NOT NULL,
  snap_date   TEXT NOT NULL,
  period_end  TEXT NOT NULL,
  eps_avg     REAL, eps_low REAL, eps_high REAL,
  rev_avg     REAL, rev_low REAL, rev_high REAL,
  n_eps       INTEGER, n_rev INTEGER,
  fetched_at  INTEGER NOT NULL,
  PRIMARY KEY (symbol, snap_date, period_end)
);
CREATE TABLE IF NOT EXISTS estimate_run (
  symbol     TEXT NOT NULL,
  snap_date  TEXT NOT NULL,
  status     TEXT NOT NULL,
  detail     TEXT,
  at         INTEGER NOT NULL,
  PRIMARY KEY (symbol, snap_date)
);
CREATE TABLE IF NOT EXISTS estimate_tracked (
  symbol    TEXT PRIMARY KEY,
  added_at  INTEGER NOT NULL,
  origin    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS estimate_job (
  session      TEXT PRIMARY KEY,
  state        TEXT NOT NULL,
  source       TEXT,
  started_at   INTEGER,
  finished_at  INTEGER,
  detail       TEXT
);
"""


def is_enabled() -> bool:
    return os.environ.get(ENABLED_ENV, "").strip() == "1"


def db_path() -> str:
    return os.environ.get("ESTIMATE_HISTORY_DB_PATH",
                          os.path.join(os.environ.get("DATA_DIR", "/data"), "estimate_history.db"))


@contextlib.contextmanager
def _conn():
    p = db_path()
    os.makedirs(os.path.dirname(p) or ".", exist_ok=True)
    c = sqlite3.connect(p, timeout=10)
    try:
        c.executescript(_SCHEMA)
        yield c
        c.commit()
    finally:
        c.close()


def _f(v: Any) -> Optional[float]:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _i(v: Any) -> Optional[int]:
    return int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


# ── tracking ────────────────────────────────────────────────────────────────

def track(sym: str, origin: str) -> bool:
    """Add a symbol to the daily snapshot universe. False when the universe is full."""
    with _WRITE_LOCK, _conn() as c:
        if c.execute("SELECT 1 FROM estimate_tracked WHERE symbol=?", (sym,)).fetchone():
            return True
        if c.execute("SELECT COUNT(*) FROM estimate_tracked").fetchone()[0] >= MAX_SYMBOLS:
            return False
        c.execute("INSERT INTO estimate_tracked VALUES (?,?,?)", (sym, int(time.time()), origin))
        return True


def tracked() -> list[str]:
    with _conn() as c:
        return [r[0] for r in c.execute("SELECT symbol FROM estimate_tracked ORDER BY added_at, symbol")]


# ── the daily snapshot ──────────────────────────────────────────────────────

def _fetch_fmp(sym: str) -> tuple[str, Any, Optional[str]]:
    from api.services import fmp_client
    try:
        res = fmp_client.get_analyst_estimates(sym, period="quarter", limit=FMP_LIMIT, timeout=15)
    except fmp_client.FMPNotFound:
        return "empty", [], "FMP returned no quarterly estimates"
    except Exception as exc:  # noqa: BLE001 -- recorded in estimate_run, never silent
        return "error", None, f"{type(exc).__name__}: {exc}"[:300]
    if res.degraded is not None:
        return "error", None, f"FMP endpoint degraded ({res.degraded})"
    return "ok", res.value, None


def snapshot_symbol(sym: str, snap_date: str, *, fetch: Optional[Callable] = None) -> str:
    """Read today's consensus for one symbol and append it. Returns the run status."""
    status, raw, detail = (fetch or _fetch_fmp)(sym)
    now = int(time.time())
    rows = []
    if status == "ok":
        for r in raw if isinstance(raw, list) else []:
            if not isinstance(r, dict) or not r.get("date"):
                continue
            rows.append((sym, snap_date, str(r["date"])[:10],
                         _f(r.get("epsAvg")), _f(r.get("epsLow")), _f(r.get("epsHigh")),
                         _f(r.get("revenueAvg")), _f(r.get("revenueLow")), _f(r.get("revenueHigh")),
                         _i(r.get("numAnalystsEps")), _i(r.get("numAnalystsRevenue")), now))
        if not rows:
            status, detail = "empty", "FMP answered with no dated rows"
    with _WRITE_LOCK, _conn() as c:
        c.executemany("INSERT OR REPLACE INTO estimate_snapshot VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", rows)
        c.execute("INSERT OR REPLACE INTO estimate_run VALUES (?,?,?,?,?)",
                  (sym, snap_date, status, detail, now))
    return status


def _seed_sp500() -> int:
    if os.environ.get("ESTIMATE_HISTORY_SEED_SP500", "1").strip() == "0":
        return 0
    from api.services import fmp_client
    try:
        res = fmp_client.get_sp500_constituents(timeout=15)
    except Exception as exc:  # noqa: BLE001
        _logger.warning("estimate_history: S&P 500 seed unavailable: %s", exc)
        return 0
    n = 0
    for r in res.value if isinstance(res.value, list) else []:
        s = (r.get("symbol") or "").upper().strip() if isinstance(r, dict) else ""
        if s and track(s, "sp500"):
            n += 1
    return n


def run_daily(*, today: Optional[date] = None, fetch: Optional[Callable] = None,
              sleep: Callable[[float], None] = time.sleep, seed: bool = True,
              reread_errors: bool = True) -> dict:
    """The snapshot run. Idempotent per day: a symbol already read OK today is
    skipped. Bounded by MAX_SYMBOLS, PACE_S between vendor calls and RUN_BUDGET_S.
    `reread_errors=False` (the catch-up) also skips a symbol whose read for the day
    failed: a catch-up repeats a MISSED read only, never a second one."""
    if not is_enabled():
        return {"skipped": "flag off"}
    snap_date = (today or datetime.now(timezone.utc).date()).isoformat()
    if seed:
        _seed_sp500()
    statuses = ("ok", "empty") if reread_errors else ("ok", "empty", "error")
    with _conn() as c:
        done = {r[0] for r in c.execute(
            "SELECT symbol FROM estimate_run WHERE snap_date=? AND status IN (%s)"
            % ",".join("?" * len(statuses)), (snap_date, *statuses))}
    started = time.monotonic()
    out = {"snap_date": snap_date, "ok": 0, "empty": 0, "error": 0, "skipped_done": 0, "budget_cut": 0}
    for i, sym in enumerate(tracked()[:MAX_SYMBOLS]):
        if sym in done:
            out["skipped_done"] += 1
            continue
        if time.monotonic() - started > RUN_BUDGET_S:
            out["budget_cut"] += 1
            continue
        out[snapshot_symbol(sym, snap_date, fetch=fetch)] += 1
        sleep(PACE_S)
    return out


# ── the schedule, the session a snapshot stands for, and the catch-up ───────

def last_slot(now: Optional[datetime] = None) -> datetime:
    """The most recent scheduled snapshot at or before `now` (New York), from the job's own schedule."""
    from api.services import catchup_slots as cs
    return cs.last_fire(cs.trigger(RUN_AT_ET, RUN_DAYS), now)


def next_open_after(moment: datetime) -> Optional[datetime]:
    """The first regular-session open strictly after `moment`: session_calendar's trading days (its holidays) and
    its open, never retyped. None when no session opens within a fortnight (never in practice)."""
    from api.services import session_calendar as sc
    m = moment.astimezone(sc.ET)
    open_min = sc.calendar().open_min
    d = m.date()
    for _ in range(15):
        if sc.is_trading_day(d):
            opens = datetime.combine(d, dtime(open_min // 60, open_min % 60), tzinfo=sc.ET)
            if opens > m:
                return opens
        d += timedelta(days=1)
    return None


def target_session(now: Optional[datetime] = None) -> Optional[str]:
    """The session a snapshot taken at `now` stands for: the New York date of the last 18:20 slot, while `now` is
    before the next session's open after that slot. None from that open on: the estimates have moved into the next
    session, so a snapshot taken then would put a later day's estimates under the earlier date."""
    from api.services import catchup_slots as cs
    now = cs.as_ny(now)
    slot = last_slot(now)
    if slot is None:
        return None
    opens = next_open_after(slot)
    if opens is None or now >= opens:
        return None
    return slot.date().isoformat()


def job_receipt(session: str) -> Optional[dict]:
    """The run receipt of one session ({session, state, source, started_at, finished_at, detail}), or None. state:
    'running' (started, not finished: a restart killed it, or it is still going), 'done', 'missed' (a hole)."""
    with _conn() as c:
        r = c.execute("SELECT session, state, source, started_at, finished_at, detail FROM estimate_job "
                      "WHERE session=?", (session,)).fetchone()
    if r is None:
        return None
    return dict(zip(("session", "state", "source", "started_at", "finished_at", "detail"), r))


def _mark(session: str, state: str, source: str, *, detail: Optional[str] = None) -> None:
    now = int(time.time())
    with _WRITE_LOCK, _conn() as c:
        if state == "running":
            c.execute("INSERT OR REPLACE INTO estimate_job VALUES (?,?,?,?,?,?)",
                      (session, state, source, now, None, detail))
        else:
            c.execute("INSERT INTO estimate_job VALUES (?,?,?,?,?,?) ON CONFLICT(session) DO UPDATE SET "
                      "state=excluded.state, source=excluded.source, finished_at=excluded.finished_at, "
                      "detail=excluded.detail",
                      (session, state, source, None, now if state == "done" else None, detail))


def read_counts(session: str) -> tuple[int, int]:
    """(read, unread): the tracked symbols (the first MAX_SYMBOLS, the run's own order) that a read was / was not
    tried for on `session`."""
    with _conn() as c:
        read, unread = c.execute(
            "SELECT COALESCE(SUM(seen), 0), COALESCE(SUM(1 - seen), 0) FROM (SELECT EXISTS (SELECT 1 FROM "
            "estimate_run r WHERE r.symbol = t.symbol AND r.snap_date = ?) AS seen FROM (SELECT symbol FROM "
            "estimate_tracked ORDER BY added_at, symbol LIMIT ?) t)", (session, MAX_SYMBOLS)).fetchone()
    return int(read), int(unread)


def unfinished(receipt: Optional[dict], read: int, unread: int) -> bool:
    """Pure: did the session's run never finish? A run a restart killed says 'running' (its unread symbols are what
    is missing); a fire lost to a restart left no receipt AND no read at all for the session. A session with reads
    and no receipt was taken before receipts existed: it ran. Nothing tracked, nothing missing."""
    state = (receipt or {}).get("state") if isinstance(receipt, dict) else None
    if state == "running":
        return unread > 0
    if state is None:
        return read == 0 and unread > 0
    return False                                   # 'done', or 'missed' (a hole already recorded)


def behind(receipt: Optional[dict], read: int, unread: int, now: Optional[datetime] = None) -> bool:
    """Pure: should the catch-up take the snapshot now? True while a session's window is open (`target_session`)
    and that session's run never finished (`unfinished`, from the session's own receipt and read counts). Outside
    every window it is False: a session missed past its window is a hole, never filled."""
    if target_session(now) is None:
        return False
    return unfinished(receipt, read, unread)


def run_scheduled(now: Optional[datetime] = None, *, source: str = "nightly", fetch: Optional[Callable] = None,
                  sleep: Callable[[float], None] = time.sleep) -> dict:
    """THE SCHEDULED ENTRY (`api/main.py`, weekdays at RUN_AT_ET; the catch-up comes through here too): one run for
    the session it stands for (`target_session`), labelled by that session, under `_RUN_LOCK`, its receipt marked
    'running' first and 'done' only when the run returns (a run that raises or is killed stays behind)."""
    if not is_enabled():
        return {"skipped": "flag off"}
    from api.services import catchup_slots as cs
    now = cs.as_ny(now)
    session = target_session(now)
    if session is None:
        return {"skipped": "no session window"}
    if not _RUN_LOCK.acquire(blocking=False):
        return {"skipped": "running"}
    try:
        _mark(session, "running", source)
        out = run_daily(today=date.fromisoformat(session), fetch=fetch, sleep=sleep,
                        reread_errors=(source == "nightly"))
        _mark(session, "done", source, detail=json.dumps(out, sort_keys=True))
        return out
    finally:
        _RUN_LOCK.release()


def catch_up(now: Optional[datetime] = None, *, fetch: Optional[Callable] = None,
             sleep: Callable[[float], None] = time.sleep) -> dict:
    """THE CATCH-UP ENTRY (`api/main.py`: a DATE job `CATCHUP_BOOT_DELAY_S` after boot and a daily retry at
    `CATCHUP_AT_ET`). Never on a member's request. Returns `{"started": bool, "reason": ..., "session": ...}`:
      off       ESTIMATE_HISTORY_ENABLED is not on (nothing read, nothing written)
      current   the session's run finished (or ran before receipts existed), or nothing is tracked
      running   the 18:20 run (or another catch-up) holds the lock
      missed    the window closed with the run unfinished: recorded as a hole, nothing taken
      started   the run for the session (`run_scheduled`), its counts under `run`"""
    if not is_enabled():
        return {"started": False, "reason": "off"}
    from api.services import catchup_slots as cs
    now = cs.as_ny(now)
    session = target_session(now)
    if session is None:
        return _close_window(now)
    if not behind(job_receipt(session), *read_counts(session), now):
        return {"started": False, "reason": "current", "session": session}
    if _RUN_LOCK.locked():
        return {"started": False, "reason": "running", "session": session}
    try:
        out = run_scheduled(now, source="catch_up", fetch=fetch, sleep=sleep)
    except Exception as exc:  # noqa: BLE001 -- said; the receipt stays 'running', so the session stays behind
        _logger.warning("estimate_history: catch-up for %s failed: %s", session, exc)
        return {"started": True, "reason": "behind", "session": session, "error": type(exc).__name__}
    if out.get("skipped"):
        return {"started": False, "reason": "running" if out["skipped"] == "running" else out["skipped"],
                "session": session}
    return {"started": True, "reason": "behind", "session": session, "run": out}


def _close_window(now: datetime) -> dict:
    """Past the window of the last slot's session: record it as a hole when its run never finished (`unfinished`).
    Nothing is read from the vendor."""
    slot = last_slot(now)
    if slot is None:
        return {"started": False, "reason": "current", "session": None}
    session = slot.date().isoformat()
    receipt = job_receipt(session) or {}
    if receipt.get("state") == "missed":
        return {"started": False, "reason": "missed", "session": session, "detail": receipt.get("detail")}
    if not unfinished(receipt or None, *read_counts(session)):
        return {"started": False, "reason": "current", "session": session}
    opens = next_open_after(slot)
    detail = (f"the {RUN_AT_ET[0]:02d}:{RUN_AT_ET[1]:02d} ET snapshot for {session} did not finish before the next "
              f"session opened ({opens.isoformat() if opens else 'unknown'}); a later day's estimates are never "
              "stored under that date")
    _mark(session, "missed", "catch_up", detail=detail)
    _logger.warning("estimate_history: %s", detail)
    return {"started": False, "reason": "missed", "session": session, "detail": detail}


def missed_days() -> list[dict]:
    """Every session recorded as a hole, oldest first: [{snap_date, detail}]."""
    with _conn() as c:
        return [{"snap_date": s, "detail": d} for s, d in c.execute(
            "SELECT session, detail FROM estimate_job WHERE state='missed' ORDER BY session")]


# ── the read (request path) ─────────────────────────────────────────────────

def _change(a: Optional[float], b: Optional[float]) -> dict:
    if a is None or b is None:
        return {"abs": None, "pct": None}
    return {"abs": round(b - a, 6), "pct": round((b - a) / abs(a) * 100, 2) if a else None}


def history(sym: str, *, today: Optional[date] = None, register: bool = True) -> dict:
    sym = (sym or "").upper().strip()
    today = today or datetime.now(timezone.utc).date()
    tracked_ok = track(sym, "viewed") if register else True
    with _conn() as c:
        snaps = c.execute(
            "SELECT snap_date, period_end, eps_avg, eps_low, eps_high, rev_avg, rev_low, rev_high, n_eps, n_rev "
            "FROM estimate_snapshot WHERE symbol=? ORDER BY period_end, snap_date", (sym,)).fetchall()
        runs = c.execute("SELECT snap_date, status, detail FROM estimate_run WHERE symbol=? ORDER BY snap_date",
                         (sym,)).fetchall()
    # The consensus is in the company's REPORTING currency (TSM: TWD), and FMP's
    # estimate rows do not say so. Cache-only: whatever reporting_currency.read()
    # already holds (EE/FA put it there). This route makes no vendor call, so an
    # uncached symbol is None, and None renders with no label, never a guess.
    from api.services.research import reporting_currency
    base = {"ticker": sym, "source": SOURCE, "tracked": tracked_ok,
            "currency": reporting_currency.peek(sym),
            "currency_source": reporting_currency.SOURCE + " (cached read; none when not yet read)"}
    gaps = [{"snap_date": d, "status": s, "detail": det} for d, s, det in runs if s == "error"]
    # Evenings the snapshot was never taken (a lost fire whose catch-up came after the next open): said, not filled.
    base["missed_days"] = missed_days()
    if not snaps:
        reason = ("not tracked: the daily snapshot universe is full" if not tracked_ok else
                  "no snapshot yet: the daily job adds one each evening, and history begins with the first")
        return {**base, "state": "collecting", "reason": reason, "covers_from": None,
                "snapshot_days": 0, "periods": [], "failed_days": gaps}
    dates = sorted({s[0] for s in snaps})
    floor = (today - timedelta(days=LOOKBACK_DAYS)).isoformat()
    by_period: dict[str, list] = {}
    for s in snaps:
        if s[1] >= floor:
            by_period.setdefault(s[1], []).append(s)
    periods = []
    for pe in sorted(by_period)[:MAX_PERIODS]:
        pts = [{"snap_date": s[0], "eps_avg": s[2], "eps_low": s[3], "eps_high": s[4],
                "rev_avg": s[5], "rev_low": s[6], "rev_high": s[7], "n_eps": s[8], "n_rev": s[9],
                "source": SOURCE} for s in by_period[pe]]
        p = {"period_end": pe, "n": len(pts), "first_snapshot": pts[0]["snap_date"], "points": pts}
        if len(pts) >= 2:
            p["state"] = "revisions"
            p["eps_change"] = _change(pts[0]["eps_avg"], pts[-1]["eps_avg"])
            p["rev_change"] = _change(pts[0]["rev_avg"], pts[-1]["rev_avg"])
        else:
            p["state"] = "collecting"
            p["reason"] = f"one snapshot so far ({pts[0]['snap_date']}); a revision needs two"
        periods.append(p)
    out = {**base, "state": "ok" if periods else "no_upcoming_periods", "covers_from": dates[0],
           "last_snapshot": dates[-1], "snapshot_days": len(dates), "periods": periods, "failed_days": gaps}
    if not periods:
        out["reason"] = "the snapshots hold no fiscal period ending after " + floor
    return out
