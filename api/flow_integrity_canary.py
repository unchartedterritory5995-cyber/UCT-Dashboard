"""flow.db corruption canary — catch the ONSET, with logs around it.

⚰️ WHY THIS EXISTS (2026-11-09). flow.db corrupted TWICE in one day: the 17GB
original (first bad page written ~10:20 ET) and the 72MB replacement created to
escape it (clean for 3h20m, then dead from 15:51 ET). Both times the damage was
found HOURS later, by which point the logs had rolled past the onset minute — so
we still do not know what causes it.

What was ruled out that day, so nobody re-runs these:
  * the volume — 3,000,000 rows / 954MB written single-writer, integrity ok
  * multi-process write contention — 2,685,270 rows across 4 processes with a
    concurrent full-scan reader, integrity ok
  * fork-inherited connections — the scan pool uses mp.get_context("spawn")
  * durability settings — WAL + synchronous=NORMAL + busy timeout, all correct
  * the filesystem — local ext4 on a block device, not NFS

So the cause is still open, and the single most valuable missing artifact is
"what was the worker doing in the minute it went bad". This job SHOUTS the moment
the database stops reading cleanly, so the surrounding log lines are captured
while they still exist.

Deliberately read-only and fail-soft: a canary that can itself damage the
database, or that takes the worker down when it trips, is worse than no canary.

⛔⛔ THE FAST PATH DOES NOT RUN `PRAGMA quick_check`, AND THAT IS THE WHOLE DESIGN.
This module's first version ran `quick_check` plus `SELECT COUNT(*)` on EVERY tick at
`FLOW_CANARY_SEC=300`. **Measured 2026-11-09 against the live restored 10.7GB file:
`quick_check(1)` alone ran past 600 s without finishing.** quick_check has to verify
every page of every btree, so on a CLEAN multi-GB file it is a full-file scan — the
cheap-sounding `(1)` bounds how many ERRORS it reports, not how much it reads.

A 600 s+ probe on a 300 s interval with `coalesce=True` does not run every 5 minutes;
it runs CONTINUOUSLY, back to back, forever. That would have put a permanent 10.7GB
read loop next to the live OPRA write path, on the exact volume that corrupted twice
that day — a monitor heavy enough to be a suspect in what it is monitoring. It would
also have been self-defeating: the whole point is readable logs around the onset, and
a tick that never finishes never logs.

So the fast path is a **bounded write-head read** instead:
  * `MAX(id)` — index-only, measured in milliseconds on the same file
  * the newest `FLOW_CANARY_WINDOW_ROWS` rows via an explicit `id >= ? AND id < ?`
    window, which is the probe shape PR `ca9c5eb2b1` proved reads cleanly even on a
    damaged file (SQLite descends straight to those rowids instead of traversing
    across the damage)
  * one rotating OLDER window, so rot away from the write head is not invisible

⭐ The write head is the right place to look: BOTH corruptions on 2026-11-09 appeared
there, and the second file's last readable row was the newest one. A probe that reads
what the worker just wrote is the earliest possible detector and costs almost nothing.

The whole-file proof still exists as `full_check()`, scheduled ONCE DAILY at a quiet
hour by `flow_worker_main`, never on the tick path. Expect it to take many minutes.
"""
import logging
import os
import shutil
import random
import sqlite3
import time

log = logging.getLogger(__name__)

DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")
# quick_check(N) stops after N errors. 1 is enough to know it is bad. It does NOT
# bound how much of the file is read — see the module docstring.
_ERRORS_TO_REPORT = 1

# How many of the newest rows the cheap probe actually reads.
WINDOW_ROWS = int(os.environ.get("FLOW_CANARY_WINDOW_ROWS", "2000"))

# ⛔ 2026-11-12: the read probe said "ok" every 5 minutes while EVERY write failed for
# hours (index pages damaged, table pages fine), and a full disk was the cause. Two more
# senses, each shouting once per onset and re-arming on recovery:
#   * free disk under DISK_FLOOR_BYTES on the volume holding flow.db
#   * max_id not advancing for STALL_TICKS ticks inside regular trading hours
DISK_FLOOR_BYTES = int(float(os.environ.get("FLOW_CANARY_DISK_FLOOR_GB", "15")) * (1 << 30))
STALL_TICKS = int(os.environ.get("FLOW_CANARY_STALL_TICKS", "3"))

_state = {
    "disk_low": False,
    "stall_ticks": 0,
    "stalled": False,
    "last_seen_max_id": None,
    "last_ok_at": None,
    "last_ok_max_id": None,
    "tripped": False,
    "last_full_at": None,
    "last_full_ok": None,
    "last_full_elapsed_s": None,
}


def _connect():
    """Read-only connection. Never raises to the caller's benefit — returns None."""
    return sqlite3.connect("file:%s?mode=ro" % DB_PATH, uri=True, timeout=20)


def _max_id(conn):
    """Index-only, milliseconds even on a 10GB file. Replaces the COUNT(*) the first
    version ran every tick, which is a full table scan of 18M rows."""
    row = conn.execute("SELECT MAX(id) FROM flow").fetchone()
    return row[0] if row else None


def _read_window(conn, lo, hi) -> int:
    """Read every row in an explicit id window and return how many came back.

    ⛔ THE BOUNDED `id >= ? AND id < ?` SHAPE IS LOAD-BEARING, not stylistic. It is what
    PR `ca9c5eb2b1` measured as the only form that reads cleanly past a damaged region,
    because SQLite seeks straight to those rowids. A `LIMIT`-style scan reaches across
    the damage and dies — measured that day: `LIMIT 20000` still failed.

    ⛔ `SELECT *`, NOT `SELECT id`, AND NOT A NAMED COLUMN LIST. The whole row payload
    has to be faulted in: `SELECT id` can be answered from the index alone and would
    miss TABLE-page damage, which is precisely the kind this hunts — on 2026-11-09 all
    ten indexes probed clean and index-only `COUNT(*)` worked while every table read in
    the damaged region died. A named column list was the first version of this and it
    is a second authority over the schema: it broke the moment the probe met a `flow`
    table whose columns differed, and a canary that fails on schema drift reports
    corruption that is not there.
    """
    cur = conn.execute(
        "SELECT * FROM flow WHERE id >= ? AND id < ?", (lo, hi))
    n = 0
    for _ in cur:
        n += 1
    return n


def check_once() -> dict:
    """One CHEAP probe: newest-id + a bounded write-head read + one older window.

    Returns a small dict; never raises. Does NOT run quick_check — see the docstring.
    """
    t0 = time.time()
    out = {"ok": None, "detail": "", "elapsed_s": 0.0, "max_id": None,
           "head_rows": None, "older_rows": None}
    try:
        conn = _connect()
    except Exception as e:  # noqa: BLE001
        out["ok"] = False
        out["detail"] = "connect failed: %s: %s" % (type(e).__name__, e)
        out["elapsed_s"] = round(time.time() - t0, 3)
        return out
    try:
        mx = _max_id(conn)
        out["max_id"] = mx
        if mx is None:
            # An empty but valid table is healthy, not broken. A fresh/rotated db
            # looks like this for its first seconds and must not trip the alarm.
            out["ok"] = True
            out["detail"] = "ok (empty)"
        else:
            lo = max(1, int(mx) - WINDOW_ROWS + 1)
            out["head_rows"] = _read_window(conn, lo, int(mx) + 1)
            # One rotating older window so damage away from the write head is not
            # invisible. Cheap for the same reason the head probe is: a bounded seek.
            if lo > 1:
                o_lo = random.randint(1, lo - 1)
                out["older_rows"] = _read_window(
                    conn, o_lo, min(lo, o_lo + WINDOW_ROWS))
            out["ok"] = True
            out["detail"] = "ok"
    except Exception as e:  # noqa: BLE001
        # A malformed image raises here rather than returning a verdict.
        out["ok"] = False
        out["detail"] = "%s: %s" % (type(e).__name__, e)
    finally:
        try:
            conn.close()
        except Exception:  # noqa: BLE001
            pass
    out["elapsed_s"] = round(time.time() - t0, 3)
    return out


def full_check() -> dict:
    """Whole-file `PRAGMA quick_check`. SLOW BY NATURE — budget many minutes.

    ⛔ NEVER CALL THIS FROM THE TICK PATH. Measured 2026-11-09 on the live 10.7GB
    flow.db: past 600 s without finishing. It exists because a bounded read probe
    cannot prove the parts it does not read, and that proof is worth having once a day
    at a quiet hour — not every five minutes next to the write path.
    """
    t0 = time.time()
    out = {"ok": None, "detail": "", "elapsed_s": 0.0}
    try:
        conn = _connect()
    except Exception as e:  # noqa: BLE001
        out["ok"] = False
        out["detail"] = "connect failed: %s: %s" % (type(e).__name__, e)
        out["elapsed_s"] = round(time.time() - t0, 2)
        return out
    try:
        res = conn.execute("PRAGMA quick_check(%d)" % _ERRORS_TO_REPORT).fetchone()
        verdict = (res[0] if res else "") or ""
        out["ok"] = (verdict.strip().lower() == "ok")
        out["detail"] = verdict[:500]
    except Exception as e:  # noqa: BLE001
        out["ok"] = False
        out["detail"] = "%s: %s" % (type(e).__name__, e)
    finally:
        try:
            conn.close()
        except Exception:  # noqa: BLE001
            pass
    out["elapsed_s"] = round(time.time() - t0, 2)
    _state["last_full_at"] = time.time()
    _state["last_full_ok"] = out["ok"]
    _state["last_full_elapsed_s"] = out["elapsed_s"]
    return out


def _shout(msg: str) -> None:
    log.error(msg)
    try:
        from api import flow_backup
        flow_backup._post_discord(msg)
    except Exception:  # noqa: BLE001 -- the canary never raises
        pass


def _in_regular_session(now=None) -> bool:
    """09:35-16:00 ET on a trading day (5 minutes of grace after the open)."""
    try:
        from datetime import datetime
        from zoneinfo import ZoneInfo
        from api import flow_gap_autofill as gf
        et = now or datetime.now(ZoneInfo("America/New_York"))
        if not gf._is_trading_day(et.date()):
            return False
        mins = et.hour * 60 + et.minute
        return 9 * 60 + 35 <= mins < 16 * 60
    except Exception:  # noqa: BLE001
        return False


def check_disk(free_bytes=None) -> None:
    """Shout once when the volume holding flow.db falls under DISK_FLOOR_BYTES."""
    try:
        free = shutil.disk_usage(os.path.dirname(DB_PATH) or "/").free if free_bytes is None else free_bytes
    except Exception:  # noqa: BLE001
        return
    if free < DISK_FLOOR_BYTES:
        if not _state["disk_low"]:
            _state["disk_low"] = True
            _shout("[flow-canary] ⛔ flow-worker volume LOW: %.1f GB free (floor %.0f GB). A full "
                   "disk corrupted flow.db on 2026-11-11/12; free space before anything else."
                   % (free / (1 << 30), DISK_FLOOR_BYTES / (1 << 30)))
    elif _state["disk_low"] and free > DISK_FLOOR_BYTES + (2 << 30):
        _state["disk_low"] = False
        log.warning("[flow-canary] volume free space recovered: %.1f GB", free / (1 << 30))


def check_stall(max_id, in_session=None) -> None:
    """Shout once when max_id has not moved for STALL_TICKS ticks during regular hours."""
    live = _in_regular_session() if in_session is None else in_session
    if not live or max_id is None:
        _state.update(stall_ticks=0, last_seen_max_id=max_id)
        return
    if _state["last_seen_max_id"] is not None and max_id == _state["last_seen_max_id"]:
        _state["stall_ticks"] += 1
    else:
        if _state["stalled"]:
            log.warning("[flow-canary] writes are landing again (max_id=%s)", max_id)
        _state.update(stall_ticks=0, stalled=False)
    _state["last_seen_max_id"] = max_id
    if _state["stall_ticks"] >= STALL_TICKS and not _state["stalled"]:
        _state["stalled"] = True
        _shout("[flow-canary] ⛔ NO NEW flow rows for %d checks during market hours (max_id=%s): "
               "the live tape is not being saved. Check `[massive-ws] DB write failed`."
               % (_state["stall_ticks"], max_id))


def run_tick() -> None:
    """Scheduler entry point for the CHEAP probe. Logs loudly on the FIRST failure and
    stays quiet afterwards so a broken database cannot flood the log it is meant to
    make readable."""
    r = check_once()
    check_disk()
    check_stall(r.get("max_id"))
    # ⛔ Tripwire (2026-11-13): a handle to a DELETED flow.db/-wal/-shm means two write-ahead logs
    # are in play; restart cleanly before damage builds (api/flow_db_guard.py).
    try:
        from api import flow_db_guard
        flow_db_guard.check_and_heal(DB_PATH)
    except Exception:  # noqa: BLE001
        pass
    # ⭐ Self-repair (2026-11-13): after consecutive FATAL failures the newest good backup is
    # swapped in. Fail-soft: the canary never raises.
    try:
        from api import flow_db_autorestore
        flow_db_autorestore.on_canary_result(r)
    except Exception:  # noqa: BLE001
        pass
    if r["ok"]:
        if _state["tripped"]:
            # recovered (a rotation/restore), so re-arm for the next onset
            log.warning("[flow-canary] reads are clean again (max_id=%s) — re-arming",
                        r["max_id"])
        _state.update(tripped=False, last_ok_at=time.time(),
                      last_ok_max_id=r["max_id"])
        log.info("[flow-canary] ok max_id=%s head=%s older=%s in %ss",
                 r["max_id"], r["head_rows"], r["older_rows"], r["elapsed_s"])
        return

    if _state["tripped"]:
        return  # already shouted; do not spam

    _state["tripped"] = True
    since = ("%.1f min" % ((time.time() - _state["last_ok_at"]) / 60.0)
             if _state["last_ok_at"] else "unknown")
    # ⛔ SHOUTED, not just logged (2026-11-13): the 07:46 ET onset that day was only in the
    # log, and nobody knew the live tape was dead until the open.
    _shout(
        "[flow-canary] ⛔ flow.db READ FAILED — last clean %s ago (max_id then=%s, "
        "now=%s). detail=%s :: THIS IS THE ONSET. Capture the surrounding log lines "
        "NOW — they are the evidence that was missing on 2026-11-09. Auto-restore runs after "
        "repeated fatal failures (flow_db_autorestore)."
        % (since, _state["last_ok_max_id"], r["max_id"], r["detail"]))


def run_full_tick() -> None:
    """Scheduler entry point for the DAILY whole-file check. Separate job, separate
    cadence, separate log line — and it must never share the tick path."""
    r = full_check()
    if r["ok"]:
        log.info("[flow-canary] full quick_check ok in %ss", r["elapsed_s"])
    else:
        log.error(
            "[flow-canary] ⛔ full quick_check FAILED in %ss: %s :: the bounded read "
            "probe may still be passing, which means damage AWAY from the write head.",
            r["elapsed_s"], r["detail"])


def status() -> dict:
    """For an admin endpoint / manual poke."""
    return {
        "db": DB_PATH,
        "tripped": _state["tripped"],
        "last_ok_at": _state["last_ok_at"],
        "last_ok_max_id": _state["last_ok_max_id"],
        "window_rows": WINDOW_ROWS,
        "last_full_at": _state["last_full_at"],
        "last_full_ok": _state["last_full_ok"],
        "last_full_elapsed_s": _state["last_full_elapsed_s"],
    }
