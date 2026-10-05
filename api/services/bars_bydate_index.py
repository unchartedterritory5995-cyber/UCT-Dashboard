"""When the WEB pod may build `idx_ohlcv_daily_bydate` -- and when it may not.

⛔⛔ INCIDENT 2026-10-02 (docs/incidents/2026-10-02-web-boot-bydate-index.md).
The web lifespan used to start this build 90 s after EVERY boot. On a fresh R2
snapshot without the index that is a 31 GB CREATE INDEX at the network volume's
~40 MB/s, holding bars.db's write transaction for ~13 min; three deploys in a row
never reached "Application startup complete" inside the 600 s healthcheck and the
site was 502 for ~1h47m.

The index now ARRIVES with the snapshot (`data_sync._make_tarball` builds every
`bars_sqlite.BARS_INDEX_DDL` index on the copy before it ships). A web pod that
still lacks it serves correctly without it (`scan_period` checks
`daily_bydate_index_ready()` and falls back to per-ticker seeks). The web-side
build is therefore a FALLBACK with exactly two doors, neither of them a boot or a
request:

* the owner's ``POST /api/admin/bars/bydate-index/build`` (explicit, any hour);
* a scheduled attempt, OFF unless ``BARS_BYDATE_INDEX_BUILD_ENABLED=1``, that only
  fires inside a low-traffic ET window and never inside the post-boot grace.

Either way the build is `bars_sqlite.ensure_daily_bydate_index`: deduped, and it
waits at most `BYDATE_BUILD_BUSY_MS` for the write lock -- a writer already holding
it means "busy, retry later", never a queue.

⚠️ WHAT THE BUILD STILL DOES WHILE IT RUNS: SQLite's CREATE INDEX holds the write
transaction for the build's duration. Web `put_bars` fails fast (2 s) and retries
during that window, and the scan saturates the volume. That is why it is confined
to the owner's trigger and the overnight window, and why the real fix is upstream.
"""
from __future__ import annotations

import datetime as _dt
import os
import threading
import time
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")

#: Env gate for the SCHEDULED attempt. The admin trigger does not read it.
FLAG = "BARS_BYDATE_INDEX_BUILD_ENABLED"
#: "<start>-<end>" ET hours, end exclusive. Default 02:00-05:00 ET: after the
#: evening jobs, before pre-market traffic.
WINDOW_ENV = "BARS_BYDATE_INDEX_BUILD_WINDOW_ET"
DEFAULT_WINDOW = (2, 5)
#: Never attempt inside this many seconds of process start, whatever the clock
#: says -- a cold pod is the one state that must not also carry a full-table scan.
BOOT_GRACE_S = 30 * 60
#: How often the scheduled loop re-checks the window / index.
POLL_S = 15 * 60

_PROCESS_STARTED = time.time()
_started_lock = threading.Lock()
_scheduler_started = False
_manual_lock = threading.Lock()
_manual_running = False


def enabled() -> bool:
    return os.environ.get(FLAG, "0") == "1"


def window() -> tuple[int, int]:
    raw = os.environ.get(WINDOW_ENV, "").strip()
    try:
        a, b = (int(x) for x in raw.split("-", 1))
        if 0 <= a <= 23 and 1 <= b <= 24 and a < b:
            return a, b
    except Exception:
        pass
    return DEFAULT_WINDOW


def in_window(now: _dt.datetime | None = None) -> bool:
    now = now or _dt.datetime.now(_ET)
    if now.tzinfo is None:
        now = now.replace(tzinfo=_ET)
    hour = now.astimezone(_ET).hour
    a, b = window()
    return a <= hour < b


def past_boot_grace(now_epoch: float | None = None) -> bool:
    return ((now_epoch if now_epoch is not None else time.time()) - _PROCESS_STARTED) >= BOOT_GRACE_S


def scheduled_attempt_due(now: _dt.datetime | None = None,
                          now_epoch: float | None = None) -> bool:
    """Pure decision for one scheduled tick: flag on, past the boot grace, inside the window."""
    return enabled() and past_boot_grace(now_epoch) and in_window(now)


def _scheduled_loop() -> None:
    from api.services import bars_sqlite
    while True:
        time.sleep(POLL_S)
        try:
            if bars_sqlite.daily_bydate_index_ready():
                print("[bydate-index] present; scheduled builder exiting")
                return
            if scheduled_attempt_due():
                bars_sqlite.ensure_daily_bydate_index(trigger="scheduled-window")
        except Exception as e:  # never let a tick kill the loop
            print(f"[bydate-index] scheduled attempt error (non-fatal): {e}")


def start_scheduled_builder() -> bool:
    """Start the window-gated builder thread. No-op (False) unless the flag is on.

    Idempotent. Called from the lifespan; does no bars.db I/O itself -- the first
    check happens POLL_S later on the thread, and no build can start inside
    BOOT_GRACE_S of process start."""
    global _scheduler_started
    if not enabled():
        print(f"[startup] by-date index scheduled build OFF ({FLAG} unset); "
              "the index ships with the R2 snapshot; admin trigger available")
        return False
    with _started_lock:
        if _scheduler_started:
            return False
        _scheduler_started = True
    threading.Thread(target=_scheduled_loop, daemon=True, name="bydate-index-scheduled").start()
    a, b = window()
    print(f"[startup] by-date index scheduled build ARMED: window {a:02d}-{b:02d} ET, "
          f"not before +{BOOT_GRACE_S // 60} min, busy_timeout short")
    return True


def trigger_build_async() -> dict:
    """The owner's door: start one background build now. Never blocks the caller.

    Returns {"started": bool, "reason": str, "state": {...}}."""
    global _manual_running
    from api.services import bars_sqlite
    if bars_sqlite.daily_bydate_index_ready():
        return {"started": False, "reason": "already_present", "state": status()}
    with _manual_lock:
        if _manual_running or bars_sqlite.bydate_build_state().get("running"):
            return {"started": False, "reason": "already_running", "state": status()}
        _manual_running = True

    def _run():
        global _manual_running
        try:
            bars_sqlite.ensure_daily_bydate_index(trigger="admin")
        finally:
            with _manual_lock:
                _manual_running = False

    threading.Thread(target=_run, daemon=True, name="bydate-index-admin").start()
    return {"started": True, "reason": "started", "state": status()}


def status() -> dict:
    from api.services import bars_sqlite
    out = bars_sqlite.bydate_build_state()
    a, b = window()
    out.update({
        "scheduled_enabled": enabled(),
        "window_et": f"{a:02d}-{b:02d}",
        "in_window_now": in_window(),
        "past_boot_grace": past_boot_grace(),
        "boot_grace_s": BOOT_GRACE_S,
    })
    return out
