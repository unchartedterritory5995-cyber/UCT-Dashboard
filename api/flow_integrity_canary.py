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
"what was the worker doing in the minute it went bad". This job runs a cheap
`PRAGMA quick_check` on a schedule and SHOUTS the moment it stops returning ok,
so the surrounding log lines are captured while they still exist.

Deliberately read-only and fail-soft: a canary that can itself damage the
database, or that takes the worker down when it trips, is worse than no canary.
"""
import logging
import os
import sqlite3
import time

log = logging.getLogger(__name__)

DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")
# quick_check(N) stops after N errors. 1 is enough to know it is bad, and keeps
# the check cheap enough to run often on a multi-GB file.
_ERRORS_TO_REPORT = 1

_state = {"last_ok_at": None, "last_ok_rows": None, "tripped": False}


def _row_count(conn) -> int | None:
    try:
        return conn.execute("SELECT COUNT(*) FROM flow").fetchone()[0]
    except Exception:
        return None


def check_once() -> dict:
    """One integrity probe. Returns a small dict; never raises."""
    t0 = time.time()
    out = {"ok": None, "detail": "", "elapsed_s": 0.0, "rows": None}
    try:
        conn = sqlite3.connect("file:%s?mode=ro" % DB_PATH, uri=True, timeout=20)
    except Exception as e:  # noqa: BLE001
        out["ok"] = False
        out["detail"] = "connect failed: %s: %s" % (type(e).__name__, e)
        return out
    try:
        res = conn.execute("PRAGMA quick_check(%d)" % _ERRORS_TO_REPORT).fetchone()
        verdict = (res[0] if res else "") or ""
        out["ok"] = (verdict.strip().lower() == "ok")
        out["detail"] = verdict[:500]
        out["rows"] = _row_count(conn)
    except Exception as e:  # noqa: BLE001
        # A malformed image raises here rather than returning a verdict.
        out["ok"] = False
        out["detail"] = "%s: %s" % (type(e).__name__, e)
    finally:
        try:
            conn.close()
        except Exception:  # noqa: BLE001
            pass
    out["elapsed_s"] = round(time.time() - t0, 2)
    return out


def run_tick() -> None:
    """Scheduler entry point. Logs loudly on the FIRST failure and stays quiet
    afterwards so a broken database cannot flood the log it is meant to make
    readable."""
    r = check_once()
    if r["ok"]:
        if _state["tripped"]:
            # recovered (a rotation/restore), so re-arm for the next onset
            log.warning("[flow-canary] integrity is ok again (rows=%s) — re-arming", r["rows"])
        _state.update(tripped=False, last_ok_at=time.time(), last_ok_rows=r["rows"])
        log.info("[flow-canary] ok rows=%s in %ss", r["rows"], r["elapsed_s"])
        return

    if _state["tripped"]:
        return  # already shouted; do not spam

    _state["tripped"] = True
    since = ("%.1f min" % ((time.time() - _state["last_ok_at"]) / 60.0)
             if _state["last_ok_at"] else "unknown")
    log.error(
        "[flow-canary] ⛔ flow.db INTEGRITY FAILED — last ok %s ago (rows then=%s, now=%s). "
        "detail=%s :: THIS IS THE ONSET. Capture the surrounding log lines NOW — they are the "
        "evidence that was missing on 2026-11-09.",
        since, _state["last_ok_rows"], r["rows"], r["detail"])


def status() -> dict:
    """For an admin endpoint / manual poke."""
    return {
        "db": DB_PATH,
        "tripped": _state["tripped"],
        "last_ok_at": _state["last_ok_at"],
        "last_ok_rows": _state["last_ok_rows"],
    }
