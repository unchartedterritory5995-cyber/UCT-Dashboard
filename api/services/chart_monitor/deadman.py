"""Dead-man switch for the chart-data monitor — runs on the WEB pod.

The monitor lives on the worker; a process cannot report its own death. So after every cycle it
POSTs a heartbeat ({at, next_due_s, phase, ...}) to ``POST /api/internal/chart-monitor/heartbeat``
on this pod (PUSH_SECRET service bearer), which ``record`` stores on the web volume.
A web scheduler job (``register``) runs ``check`` every 5 minutes: when the newest beat is older
than ``max(STALE_FACTOR × next_due_s, MIN_STALE_S)`` it pages the ops channel ONCE (hysteresis via
``alerting.step``) and posts a resolve when beats resume.

⛔ NEVER-SEEN IS NOT STALE. Until the first beat ever arrives (fresh deploy of the web pod before
the worker, or the monitor never deployed) nothing pages — otherwise every web deploy that precedes
a worker deploy would page. A beat with ``disabled: true`` (kill switch thrown) also stops paging.

Kill switch: ``CHART_MONITOR_DEADMAN_ENABLED=0``.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Optional

from api.services.chart_monitor import alerting

_log = logging.getLogger("chart_monitor.deadman")

STALE_FACTOR = 3.0
MIN_STALE_S = 900
KEY = "monitor_heartbeat|-"
JOB_ID = "chart_monitor_deadman"


def enabled() -> bool:
    return os.environ.get("CHART_MONITOR_DEADMAN_ENABLED", "1") != "0"


def _path() -> str:
    return alerting.state_path("chart_monitor_deadman.json")


def record(payload: dict, now: Optional[float] = None, path: Optional[str] = None) -> dict:
    """Store one heartbeat. Only numeric/flag fields are kept (nothing else is trusted)."""
    now = time.time() if now is None else now
    p = path or _path()
    st = alerting.load_state(p)
    try:
        nd = float(payload.get("next_due_s") or 300)
    except (TypeError, ValueError):
        nd = 300.0
    try:
        open_alerts = max(0, int(payload.get("open_alerts") or 0))
    except (TypeError, ValueError):
        open_alerts = 0
    st["beat"] = {"received_at": now, "next_due_s": max(60.0, min(nd, 6 * 3600.0)),
                  "disabled": bool(payload.get("disabled")), "open_alerts": open_alerts,
                  "phase": str(payload.get("phase") or "")[:8]}
    alerting.save_state(p, st)
    return st["beat"]


def evaluate(beat: Optional[dict], now: float) -> Optional[tuple[bool, str]]:
    """(failing, detail) for the heartbeat key, or None when there is nothing to judge."""
    if not beat or beat.get("disabled"):
        return None
    age = now - float(beat.get("received_at") or 0)
    limit = max(STALE_FACTOR * float(beat.get("next_due_s") or 300), MIN_STALE_S)
    if age > limit:
        return True, (f"no heartbeat for {int(age // 60)}m (expected every "
                      f"{int(float(beat.get('next_due_s') or 300) // 60)}m) — the chart monitor on "
                      f"the worker is not running")
    return False, f"last beat {int(age)}s ago"


def check(now: Optional[float] = None, path: Optional[str] = None, post=alerting.post) -> list:
    now = time.time() if now is None else now
    p = path or _path()
    st = alerting.load_state(p)
    obs = evaluate(st.get("beat"), now)
    if obs is None:
        return []
    keys, events = alerting.step(st.get("keys") or {}, {KEY: obs}, now, n_fail=1, n_clear=1,
                                 remind_s=6 * 3600)
    st["keys"] = keys
    msg = alerting.format_events(events, now, title="Chart monitor dead-man")
    if msg:
        post(msg)
    alerting.save_state(p, st)
    return events


def status(path: Optional[str] = None) -> dict:
    st = alerting.load_state(path or _path())
    beat = st.get("beat") or {}
    ra = beat.get("received_at")
    return {"seen": bool(beat), "age_s": None if ra is None else int(time.time() - float(ra)),
            "next_due_s": beat.get("next_due_s"), "disabled": beat.get("disabled"),
            "open_alerts": beat.get("open_alerts"), "phase": beat.get("phase"),
            "deadman_open": bool((st.get("keys") or {}).get(KEY, {}).get("open"))}


def register(scheduler) -> bool:
    """Add the dead-man job to the web pod's APScheduler. Returns True when registered."""
    if not enabled():
        _log.info("[chart-monitor] dead-man disabled (CHART_MONITOR_DEADMAN_ENABLED=0)")
        return False

    def _job():
        try:
            check()
        except Exception as e:  # noqa: BLE001
            _log.warning("[chart-monitor] dead-man check failed: %s", type(e).__name__)

    scheduler.add_job(_job, trigger="interval", minutes=5, id=JOB_ID, max_instances=1,
                      coalesce=True, misfire_grace_time=600, replace_existing=True)
    return True
