"""Durable run record + boot catch-up for the nightly universe pattern scan.

WHY THIS EXISTS (incident 2026-10-19). `_run_patterns_universe_scan` fires at
01:00 ET on the web pod. A master deploy booted a new pod ~11 minutes in, the
old process died mid-loop, and the scan had rewritten only the leaders plus
A..B of the cap universe. APScheduler's job store is IN MEMORY: the new pod
never learnt a run had been in flight, `misfire_grace_time` cannot see a fire
that belongs to a dead process, and ~80% of the universe kept the previous
run's rows until the next 01:00 ET. Nothing anywhere recorded that it died.

WHAT THIS MODULE OWNS
  * `pattern_scan_runs` (in patterns.db, next to the rows the scan writes):
    one row per run attempt -- slot, kind, status, started/heartbeat/finished,
    how far it got (`done_count` + `last_sym` over a fixed ordered list whose
    hash is stored with it).
  * A LEASE over that table: at most one universe run is `running` with a fresh
    heartbeat at any time. Acquired inside `BEGIN IMMEDIATE`, so two processes
    on the same file cannot both win; an in-process lock covers two threads of
    one scheduler (the cron job and the catch-up job) before SQLite is asked.
  * `plan_catch_up`: a PURE decision over (now, the run rows) -- resume, rerun,
    or nothing, and why.

SLOTS. The cron fires every day at 01:00 ET (weekends included). A run belongs
to the slot named by the ET date of the most recent 01:00 ET at or before its
start. A slot is DATA-BEARING when the day before it was an NYSE trading day:
only those slots can see a new daily bar. The Sat 01:00 slot carries Friday's
session; Sun/Mon 01:00 re-read the same bars.

THE CATCH-UP RULE (checked 6 min after boot, then every 15 min):
  1. disabled (either kill switch)                     -> nothing
  2. a run is live (fresh heartbeat)                   -> nothing, ask again later
  3. the next 01:00 ET is under SKIP_BEFORE_NEXT away  -> nothing, the cron owns it
  4. the newest slot already has a completed run       -> nothing
  5. the newest slot has an INTERRUPTED run            -> resume it from its
     checkpoint when that is provably safe (same slot, same ordered universe,
     checkpoint symbol matches), else rerun it whole
  6. no completed run at or after the latest DATA-BEARING slot -> full run
  7. otherwise (a non-data-bearing slot was missed but its data is covered)
                                                       -> nothing
  Attempts per slot are capped so a deterministic failure cannot loop forever.

ONE RUNNER. The scheduler itself only starts in the process that wins
`scheduler_lock` (one per container). Railway refuses to run two deployments
against one volume (docs/runbooks/deploy-windows.md), so two replicas cannot
share patterns.db -- but the DB lease would refuse the second runner anyway.
The only weakness is a live run that goes >STALE_SECONDS without a heartbeat
being declared dead; heartbeats are written between symbols, at most every
CHECKPOINT_SECONDS, so that needs one symbol to take >5 minutes.

MEMORY. Nothing here touches bars or detections. The runner in api/main.py
calls the SAME `_scan_patterns_daily` over the SAME ordered list (a resume is a
suffix slice of it), so a catch-up has the scheduled job's memory profile.
"""
from __future__ import annotations

import hashlib
import logging
import os
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Iterable, Optional
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

ET = ZoneInfo("America/New_York")

#: The cron's own fire time. api/main.py reads these when it builds the
#: CronTrigger -- one authority for "when the universe scan is due".
SLOT_HOUR_ET = 1
SLOT_MINUTE_ET = 0


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError:
        return default


#: A `running` row whose heartbeat is older than this is a dead process.
STALE_SECONDS = _env_int("PATTERNS_UNIVERSE_STALE_S", 300)
#: Heartbeat/checkpoint cadence inside the loop (whichever comes first).
CHECKPOINT_EVERY = _env_int("PATTERNS_UNIVERSE_CHECKPOINT_EVERY", 25)
CHECKPOINT_SECONDS = _env_int("PATTERNS_UNIVERSE_CHECKPOINT_S", 20)
#: First catch-up check after boot. Larger than STALE_SECONDS on purpose: a
#: run killed by this pod's own deploy is already stale at the first look.
BOOT_DELAY_SECONDS = _env_int("PATTERNS_UNIVERSE_CATCHUP_BOOT_DELAY_S", 360)
#: Re-check cadence (covers a cron skipped for overlap, or a run that was
#: still live at the boot check).
CHECK_INTERVAL_MINUTES = _env_int("PATTERNS_UNIVERSE_CATCHUP_INTERVAL_MIN", 15)
#: Do not start a catch-up this close to the next cron fire.
SKIP_BEFORE_NEXT_MINUTES = _env_int("PATTERNS_UNIVERSE_CATCHUP_SKIP_BEFORE_NEXT_MIN", 60)
#: Total attempts (scheduled + catch-up) allowed per slot.
MAX_ATTEMPTS_PER_SLOT = _env_int("PATTERNS_UNIVERSE_MAX_ATTEMPTS", 4)
#: Rows older than this are deleted when a run begins (one row per day).
RETENTION_DAYS = 120

_SCHEMA = """
    CREATE TABLE IF NOT EXISTS pattern_scan_runs (
      run_id        TEXT PRIMARY KEY,
      kind          TEXT NOT NULL,      -- 'scheduled' | 'catchup'
      slot          TEXT NOT NULL,      -- ET date of the 01:00 ET slot, YYYY-MM-DD
      status        TEXT NOT NULL,      -- running | completed | failed | abandoned
      started_at    INTEGER NOT NULL,
      heartbeat_at  INTEGER NOT NULL,
      finished_at   INTEGER,
      total         INTEGER NOT NULL,   -- len(ordered universe)
      resume_offset INTEGER NOT NULL DEFAULT 0,
      done_count    INTEGER NOT NULL DEFAULT 0,  -- ordered[:done_count] finished
      last_sym      TEXT,               -- ordered[done_count-1]
      universe_hash TEXT NOT NULL,
      resumed_from  TEXT,
      scanned       INTEGER,
      stored        INTEGER,
      owner         TEXT,
      error         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_psr_slot   ON pattern_scan_runs(slot);
    CREATE INDEX IF NOT EXISTS idx_psr_status ON pattern_scan_runs(status);
"""

_OWNER = f"{os.environ.get('HOSTNAME') or os.environ.get('COMPUTERNAME') or 'host'}:{os.getpid()}"
_inproc_lock = threading.Lock()
_schema_paths: set[str] = set()


# -- switches -----------------------------------------------------------------

def scan_enabled() -> bool:
    """Kill switch for the universe scan itself (cron AND catch-up). Default ON."""
    return os.environ.get("PATTERNS_UNIVERSE_SCAN_ENABLED", "1") == "1"


def catchup_enabled() -> bool:
    """Kill switch for the boot/watchdog catch-up only. Default ON."""
    return scan_enabled() and os.environ.get("PATTERNS_UNIVERSE_CATCHUP_ENABLED", "1") == "1"


# -- clock / calendar (pure) --------------------------------------------------

def _as_et(now: Optional[datetime]) -> datetime:
    if now is None:
        return datetime.now(ET)
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    return now.astimezone(ET)


def is_trading_day(d: date) -> bool:
    if d.weekday() >= 5:
        return False
    try:
        from api.services.nyse_calendar import NYSE_HOLIDAYS_YYYYMMDD
        return int(d.strftime("%Y%m%d")) not in NYSE_HOLIDAYS_YYYYMMDD
    except Exception:  # noqa: BLE001 - calendar unavailable: weekdays trade
        return True


def slot_for(now: Optional[datetime] = None) -> date:
    """ET date of the most recent 01:00 ET at or before `now`."""
    n = _as_et(now)
    fire = n.replace(hour=SLOT_HOUR_ET, minute=SLOT_MINUTE_ET, second=0, microsecond=0)
    return n.date() if n >= fire else n.date() - timedelta(days=1)


def next_fire_after(now: Optional[datetime] = None) -> datetime:
    n = _as_et(now)
    s = slot_for(n) + timedelta(days=1)
    return datetime(s.year, s.month, s.day, SLOT_HOUR_ET, SLOT_MINUTE_ET, tzinfo=ET)


def is_data_bearing(slot: date) -> bool:
    """True when the session before this slot was a trading day."""
    return is_trading_day(slot - timedelta(days=1))


def required_slot(now: Optional[datetime] = None) -> date:
    """Most recent DATA-BEARING slot at or before `now`."""
    s = slot_for(now)
    for _ in range(15):
        if is_data_bearing(s):
            return s
        s -= timedelta(days=1)
    return s


def universe_hash(ordered: Iterable[str]) -> str:
    return hashlib.sha1("\n".join(ordered).encode("utf-8")).hexdigest()


# -- store ----------------------------------------------------------------------

def _connect():
    from api.services.pattern_engine.pattern_db import _db_path, get_connection
    conn = get_connection()
    path = _db_path()
    if path not in _schema_paths:
        conn.executescript(_SCHEMA)
        conn.commit()
        _schema_paths.add(path)
    return conn


def list_runs(limit: int = 50) -> list[dict]:
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT * FROM pattern_scan_runs ORDER BY started_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def _is_live(row: dict, now_ts: int) -> bool:
    return row["status"] == "running" and (now_ts - int(row["heartbeat_at"])) <= STALE_SECONDS


# -- the decision (pure) ------------------------------------------------------

@dataclass(frozen=True)
class CatchUpPlan:
    action: str                      # 'none' | 'resume' | 'rerun'
    reason: str
    slot: Optional[date] = None
    resume_from: Optional[dict] = None   # the interrupted row a resume continues


def resume_offset_for(row: Optional[dict], ordered: list[str]) -> int:
    """How many leading symbols of `ordered` an interrupted run provably
    finished, or 0 when resuming would not be safe (different universe, a
    checkpoint that does not name the symbol at that position)."""
    if not row:
        return 0
    n = int(row.get("done_count") or 0)
    if n <= 0 or n > len(ordered):
        return 0
    if row.get("universe_hash") != universe_hash(ordered):
        return 0
    if row.get("last_sym") != ordered[n - 1]:
        return 0
    return n


def plan_catch_up(now: datetime, runs: list[dict]) -> CatchUpPlan:
    """Decide whether the universe scan must run now. Pure: `runs` are rows of
    pattern_scan_runs as dicts, `now` is tz-aware. The live-run check uses
    `now` for heartbeat age, so tests never need a wall clock."""
    if not catchup_enabled():
        return CatchUpPlan("none", "disabled")
    n = _as_et(now)
    now_ts = int(n.timestamp())

    live = [r for r in runs if _is_live(r, now_ts)]
    if live:
        return CatchUpPlan("none", f"run {live[0]['run_id']} is live")

    if next_fire_after(n) - n < timedelta(minutes=SKIP_BEFORE_NEXT_MINUTES):
        return CatchUpPlan("none", "next scheduled run is imminent")

    latest = slot_for(n)
    latest_s = latest.isoformat()
    this_slot = [r for r in runs if r["slot"] == latest_s]
    if any(r["status"] == "completed" for r in this_slot):
        return CatchUpPlan("none", f"slot {latest_s} completed")

    if len(this_slot) >= MAX_ATTEMPTS_PER_SLOT:
        return CatchUpPlan("none", f"slot {latest_s} gave up after {len(this_slot)} attempts")

    # An interrupted attempt at the newest slot: a stale `running` row (its
    # process died), or one that ended `failed`/`abandoned`.
    interrupted = sorted(
        (r for r in this_slot if r["status"] in ("running", "failed", "abandoned")),
        key=lambda r: int(r["started_at"]), reverse=True,
    )
    if interrupted:
        return CatchUpPlan("resume", f"slot {latest_s} was interrupted", latest, interrupted[0])

    req = required_slot(n).isoformat()
    if not any(r["status"] == "completed" and r["slot"] >= req for r in runs):
        return CatchUpPlan("rerun", f"no completed run since data-bearing slot {req}", latest)

    return CatchUpPlan("none", f"data-bearing slot {req} is covered")


# -- the lease ------------------------------------------------------------------

class RunHandle:
    """A started run. `progress(i, sym)` is the scan loop's callback: called
    BEFORE symbol index `i` is processed, i.e. `i` symbols of THIS slice are
    done and `sym` is the last of them."""

    def __init__(self, run_id: str, offset: int, ordered: list[str]):
        self.run_id = run_id
        self.offset = offset
        self.ordered = ordered
        self._last_write = time.time()
        self._last_done = offset

    def progress(self, i: int, last_sym: Optional[str]) -> None:
        done = self.offset + i
        now = time.time()
        if (done - self._last_done) < CHECKPOINT_EVERY and (now - self._last_write) < CHECKPOINT_SECONDS:
            return
        self._write(done, last_sym, now)

    def _write(self, done: int, last_sym: Optional[str], now: float) -> None:
        try:
            conn = _connect()
            try:
                conn.execute(
                    "UPDATE pattern_scan_runs SET done_count=?, last_sym=?, heartbeat_at=? "
                    "WHERE run_id=? AND status='running'",
                    (done, last_sym, int(now), self.run_id),
                )
                conn.commit()
            finally:
                conn.close()
            self._last_write, self._last_done = now, done
        except Exception as e:  # noqa: BLE001 - a checkpoint must never kill the scan
            logger.warning("[patterns] universe run checkpoint failed: %s", e)


def begin_run(kind: str, slot: date, ordered: list[str], *, resume_from: Optional[dict] = None,
              now: Optional[float] = None) -> Optional[RunHandle]:
    """Take the lease and record the start. Returns None when another run is
    live (in this process or, via the table, in any process on this file).
    Marks dead `running` rows `abandoned` on the way. The caller MUST call
    `end_run` (use try/finally) -- it also releases the in-process lock."""
    if not _inproc_lock.acquire(blocking=False):
        return None
    try:
        ts = int(now if now is not None else time.time())
        offset = resume_offset_for(resume_from, ordered)
        run_id = uuid.uuid4().hex
        conn = _connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            rows = [dict(r) for r in conn.execute(
                "SELECT * FROM pattern_scan_runs WHERE status='running'").fetchall()]
            if any(_is_live(r, ts) for r in rows):
                conn.execute("ROLLBACK")
                _inproc_lock.release()
                return None
            conn.execute(
                "UPDATE pattern_scan_runs SET status='abandoned', "
                "error=COALESCE(error, 'heartbeat went stale (process died)') "
                "WHERE status='running'")
            conn.execute(
                "INSERT INTO pattern_scan_runs (run_id, kind, slot, status, started_at, "
                "heartbeat_at, total, resume_offset, done_count, last_sym, universe_hash, "
                "resumed_from, owner) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (run_id, kind, slot.isoformat(), "running", ts, ts, len(ordered), offset,
                 offset, ordered[offset - 1] if offset else None, universe_hash(ordered),
                 (resume_from or {}).get("run_id") if offset else None, _OWNER),
            )
            conn.execute("DELETE FROM pattern_scan_runs WHERE started_at < ?",
                         (ts - RETENTION_DAYS * 86400,))
            conn.execute("COMMIT")
        finally:
            conn.close()
        return RunHandle(run_id, offset, ordered)
    except Exception:
        _inproc_lock.release()
        raise


def end_run(handle: RunHandle, status: str, *, scanned: int = 0, stored: int = 0,
            error: Optional[str] = None) -> None:
    """Record the outcome and release the lease. Never raises."""
    try:
        now = int(time.time())
        conn = _connect()
        try:
            done = len(handle.ordered) if status == "completed" else None
            conn.execute(
                "UPDATE pattern_scan_runs SET status=?, finished_at=?, heartbeat_at=?, "
                "scanned=?, stored=?, error=?, "
                "done_count=COALESCE(?, done_count), "
                "last_sym=CASE WHEN ? IS NULL THEN last_sym ELSE ? END "
                "WHERE run_id=?",
                (status, now, now, scanned, stored, error, done,
                 done, handle.ordered[-1] if (done and handle.ordered) else None,
                 handle.run_id),
            )
            conn.commit()
        finally:
            conn.close()
    except Exception as e:  # noqa: BLE001
        logger.warning("[patterns] universe run end record failed: %s", e)
    finally:
        try:
            _inproc_lock.release()
        except RuntimeError:
            pass
