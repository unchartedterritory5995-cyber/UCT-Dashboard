"""
Out-of-band tape-freeze watchdog (2026-07-14 incident follow-up).

The consumer's own stale-connection watchdog lives ON the consumer's asyncio
loop — when that loop starves (divergence spiral under extreme feed volume,
7/14 incident), the watchdog starves with it and the tape stays frozen while
the process keeps serving HTTP. This module is the guard that cannot die with
its patient: a plain OS thread that watches flow.db insert progress from the
outside and force-exits the process on a true freeze, so Railway's
restartPolicy=ALWAYS brings up a fresh consumer within ~60s.

Freeze vs lag — CRITICAL distinction (learned 7/14):
  - FREEZE: MAX(id) in flow.db stops advancing during market hours. The
    consumer is wedged; a restart is the only recovery. -> exit.
  - LAG: rows keep inserting but their trade timestamps trail wall clock
    (consumer behind an extreme-volume feed). A restart makes lag WORSE
    (loses buffered backlog + reconnect gap). -> do nothing; the external
    freshness monitor alerts humans instead.

Guards against false exits:
  - Only fires inside 9:45 AM - 3:55 PM ET, Mon-Fri.
  - Only fires if the newest row is from TODAY (a holiday/closed session has
    no rows today, so the watchdog stays quiet instead of restart-looping).
  - Only fires after FLOW_FREEZE_WATCHDOG_MIN_UPTIME_SEC of process uptime.
  - Any internal error disables that check cycle, never the service.

Env:
  FLOW_FREEZE_WATCHDOG_ENABLED         default "1"
  FLOW_FREEZE_WATCHDOG_STALE_SEC       default "300"  (no inserts for this long -> exit)
  FLOW_FREEZE_WATCHDOG_MIN_UPTIME_SEC  default "300"
  DISCORD_ALERT_WEBHOOK                optional; best-effort alert before exit
"""

import logging
import os
import sqlite3
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")
ENABLED = os.environ.get("FLOW_FREEZE_WATCHDOG_ENABLED", "1") == "1"
STALE_SEC = float(os.environ.get("FLOW_FREEZE_WATCHDOG_STALE_SEC", "300"))
MIN_UPTIME_SEC = float(os.environ.get("FLOW_FREEZE_WATCHDOG_MIN_UPTIME_SEC", "300"))
CHECK_INTERVAL_SEC = 30.0
_ET = ZoneInfo("America/New_York")

_started = False
_start_lock = threading.Lock()
_live_hb = {"ts": 0.0}


def note_live_insert() -> None:
    """Heartbeat from the LIVE consumer's write path (review B5). The spool
    replay also advances flow.db's max rowid, which would otherwise mask a
    frozen live lane; when this heartbeat is being fed, row-id advance only
    counts as progress if the heartbeat moved too."""
    _live_hb["ts"] = time.time()


def _in_watch_window(now_et: datetime) -> bool:
    if now_et.weekday() >= 5:
        return False
    mins = now_et.hour * 60 + now_et.minute
    return (9 * 60 + 45) <= mins <= (15 * 60 + 55)


def _newest_row():
    """(max_id, created_date_str) of the newest STOCKS row, or (None, None).

    STOCKS-ONLY (2026-07-16 blind-spot fix): the 9:31 open-wedge froze the
    stocks pipeline while indexes rows kept inserting, so the any-source
    MAX(id) kept advancing and this watchdog never fired — the tape members
    watch was dead for 9+ minutes with the guard green. "The tape" = stocks."""
    conn = sqlite3.connect(DB_PATH, timeout=5)
    try:
        row = conn.execute(
            "SELECT id, CreatedDate FROM flow WHERE source='stocks' "
            "ORDER BY id DESC LIMIT 1"
        ).fetchone()
    finally:
        conn.close()
    return (row[0], row[1]) if row else (None, None)


def _any_source_today(today_str: str) -> bool:
    """True if ANY row (any source) has today's CreatedDate — i.e. the session
    is live and writers are up, even if the stocks lane never started."""
    conn = sqlite3.connect(DB_PATH, timeout=5)
    try:
        row = conn.execute(
            "SELECT CreatedDate FROM flow ORDER BY id DESC LIMIT 1").fetchone()
    finally:
        conn.close()
    return bool(row and row[0] == today_str)


def _today_mdyyyy(now_et: datetime) -> str:
    # flow.db CreatedDate format is M/D/YYYY with no zero padding.
    return f"{now_et.month}/{now_et.day}/{now_et.year}"


def _alert_discord(msg: str) -> None:
    url = (os.environ.get("DISCORD_ALERT_WEBHOOK") or "").strip()
    if not url:
        return
    try:
        import httpx
        httpx.post(url, json={"content": msg}, timeout=5.0,
                   headers={"User-Agent": "Mozilla/5.0 uct-flow-watchdog"})
    except Exception:
        pass  # alerting must never block the exit


def _run(service_name: str) -> None:
    boot_ts = time.time()
    last_max_id = None
    last_advance_ts = time.time()
    warned_half = False
    stocks_dead_since = None    # day-start blind-spot timer (review A8)
    last_hb_seen = 0.0          # live-write heartbeat tracker (review B5)

    logger.info("[flow-watchdog] started (service=%s stale=%.0fs interval=%.0fs)",
                service_name, STALE_SEC, CHECK_INTERVAL_SEC)
    while True:
        time.sleep(CHECK_INTERVAL_SEC)
        try:
            now_et = datetime.now(_ET)
            if not _in_watch_window(now_et):
                last_max_id = None  # reset across sessions/overnight
                continue
            if time.time() - boot_ts < MIN_UPTIME_SEC:
                continue

            max_id, created_date = _newest_row()
            if max_id is None:
                continue
            today_str = _today_mdyyyy(now_et)
            if created_date != today_str:
                # Newest STOCKS row isn't from today. Two very different cases
                # (review A8): if NOTHING wrote today it's a closed session /
                # holiday — stay quiet. But if OTHER sources ARE writing today,
                # the stocks lane died before its first insert of the day (the
                # 7/14 shape) — that's a freeze this watchdog exists to catch.
                if _any_source_today(today_str):
                    if stocks_dead_since is None:
                        stocks_dead_since = time.time()
                    dead_for = time.time() - stocks_dead_since
                    if dead_for >= STALE_SEC / 2 and not warned_half:
                        warned_half = True
                        _alert_discord(
                            f"⚠️ **[{service_name}] flow-watchdog: NO stocks "
                            f"inserts today for {int(dead_for)}s while other "
                            f"sources write** — stocks lane may have died "
                            f"before its first insert.")
                    if dead_for >= STALE_SEC:
                        msg = (f":rotating_light: **[{service_name}] "
                               f"flow-watchdog: stocks lane NEVER STARTED "
                               f"today** ({int(dead_for)}s dead while other "
                               f"sources write). Force-exiting for restart.")
                        logger.critical("[flow-watchdog] %s", msg)
                        _alert_discord(msg)
                        time.sleep(2)
                        os._exit(43)
                else:
                    stocks_dead_since = None
                continue
            stocks_dead_since = None

            hb = _live_hb["ts"]
            if last_max_id is None or max_id != last_max_id:
                last_max_id = max_id
                # B5: when the live write path feeds the heartbeat, a rowid
                # advance only counts as live progress if the heartbeat moved
                # too — a spool replay writing rows must not mask a frozen
                # live lane. Fallback to rowid-only when hb was never fed.
                if hb == 0 or hb > last_hb_seen:
                    last_advance_ts = time.time()
                    warned_half = False
                last_hb_seen = hb
                continue
            last_hb_seen = hb

            frozen_for = time.time() - last_advance_ts
            # Half-threshold early warning (manrav 7/16): if lag/flush cadence
            # ever creeps toward STALE_SEC, force-exiting a slow-but-alive
            # consumer would cause a restart spiral (restarts make lag worse).
            # Surface the approach in Discord BEFORE the exit fires so a human
            # sees it while there's still time to raise the threshold.
            if frozen_for >= STALE_SEC / 2 and not warned_half:
                warned_half = True
                _alert_discord(
                    f"⚠️ **[{service_name}] flow-watchdog: stocks inserts "
                    f"quiet for {int(frozen_for)}s** (half of the {int(STALE_SEC)}s "
                    f"force-exit threshold). If this is pipeline LAG rather than a "
                    f"freeze, raise FLOW_FREEZE_WATCHDOG_STALE_SEC before the exit "
                    f"fires and causes a restart spiral.")
            if frozen_for >= STALE_SEC:
                msg = (f":rotating_light: **[{service_name}] flow-watchdog: tape FROZEN** — "
                       f"no flow.db inserts for {int(frozen_for)}s during market hours "
                       f"(max_id stuck at {max_id}). Force-exiting so Railway restarts "
                       f"the consumer.")
                logger.critical("[flow-watchdog] %s", msg)
                _alert_discord(msg)
                # Give the log/webhook a beat to flush, then hard-exit. Railway
                # restartPolicy=ALWAYS restarts the container.
                time.sleep(2)
                os._exit(43)
        except Exception as e:
            logger.warning("[flow-watchdog] check failed (non-fatal): %s", e)


def start(service_name: str) -> bool:
    """Start the watchdog thread. No-op unless this service owns the consumer
    (MASSIVE_WS_ENABLED=1) and the watchdog is enabled. Idempotent."""
    global _started
    if not ENABLED:
        logger.info("[flow-watchdog] disabled via FLOW_FREEZE_WATCHDOG_ENABLED")
        return False
    if os.environ.get("MASSIVE_WS_ENABLED", "0").lower() not in ("1", "true", "yes"):
        return False
    with _start_lock:
        if _started:
            return True
        threading.Thread(target=_run, args=(service_name,),
                         name="flow-freeze-watchdog", daemon=True).start()
        _started = True
    return True
