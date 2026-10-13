"""Breadth alerts — the owner's #breadth-alerts Discord channel, and the checks that feed it.

⭐ WHY (2026-10-11, owner). The breadth audit found that no breadth failure reached a human:
every regression since August was found by someone looking at a chart. The first check here
guards the EOD switch (`breadth_eod_source`, server mode from 2026-10-14): if the day's
official breadth row is not stored by the evening, say so.

DESTINATION. `DISCORD_BREADTH_WEBHOOK_URL` (the channel the owner created for this), falling
back to the OPS destination (`alert_destination.ops_webhook`) when it is unset, so a missing
variable never silences an alert.

DEDUP. One post per key per `COOLDOWN_S`, remembered on the data volume — a redeploy must
not re-post the same alert, and a stuck condition must not post every run.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from datetime import date, datetime, timedelta
from typing import Callable, Optional
from zoneinfo import ZoneInfo

_log = logging.getLogger("breadth_alerts")
_ET = ZoneInfo("America/New_York")

WEBHOOK_ENV = "DISCORD_BREADTH_WEBHOOK_URL"
COOLDOWN_S = 6 * 3600
_lock = threading.Lock()


def _state_path() -> str:
    return os.environ.get("BREADTH_ALERTS_STATE") or os.path.join(
        os.environ.get("DATA_DIR", "/data"), "breadth_alerts_state.json")


def _load() -> dict:
    try:
        with open(_state_path()) as fh:
            return json.load(fh)
    except Exception:
        return {}


def _save(state: dict) -> None:
    try:
        tmp = _state_path() + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(state, fh)
        os.replace(tmp, _state_path())
    except Exception as e:                         # noqa: BLE001
        _log.warning("[breadth-alerts] state write failed: %s", e)


def webhook() -> str:
    url = (os.environ.get(WEBHOOK_ENV) or "").strip()
    if url:
        return url
    try:
        from api.services import alert_destination
        return alert_destination.ops_webhook("critical", producer="breadth_alerts")
    except Exception:
        return ""


def send(key: str, title: str, lines: list, post: Optional[Callable] = None,
         now: Optional[float] = None) -> dict:
    """Post one alert (deduplicated per key for COOLDOWN_S). Never raises."""
    now = time.time() if now is None else now
    with _lock:
        state = _load()
        last = float(state.get(key) or 0)
        if last and now - last < COOLDOWN_S:
            return {"sent": False, "reason": "cooldown"}
        url = webhook()
        if not url:
            _log.warning("[breadth-alerts] no webhook configured: %s", title)
            return {"sent": False, "reason": "no webhook"}
        body = "\n".join([f"**{title}**", *[f"• {ln}" for ln in lines][:15]])[:1900]
        try:
            if post is None:
                import requests
                post = requests.post
            r = post(url, json={"content": body, "allowed_mentions": {"parse": []}}, timeout=10)
            ok = 200 <= int(getattr(r, "status_code", 0)) < 300
        except Exception as e:                     # noqa: BLE001
            _log.warning("[breadth-alerts] post failed: %s", e)
            return {"sent": False, "reason": f"post failed: {type(e).__name__}"}
        if ok:
            state[key] = now
            _save(state)
        return {"sent": ok, "reason": None if ok else f"http {getattr(r, 'status_code', '?')}"}


def resolve(key: str, title: str, lines: list, post: Optional[Callable] = None) -> dict:
    """The condition behind `key` is over: if it ALERTED, post one resolution and forget the
    key (a recurrence then alerts at once); if it never alerted, do nothing. A failed post
    keeps the key so the next healthy check retries the resolution. Never raises."""
    with _lock:
        if not _load().get(key):
            return {"sent": False, "reason": "not alerted"}
    url = webhook()
    if not url:
        return {"sent": False, "reason": "no webhook"}
    body = "\n".join([f"✅ **{title}**", *[f"• {ln}" for ln in lines][:15]])[:1900]
    try:
        if post is None:
            import requests
            post = requests.post
        r = post(url, json={"content": body, "allowed_mentions": {"parse": []}}, timeout=10)
        ok = 200 <= int(getattr(r, "status_code", 0)) < 300
    except Exception as e:                         # noqa: BLE001
        _log.warning("[breadth-alerts] resolve post failed: %s", e)
        return {"sent": False, "reason": f"post failed: {type(e).__name__}"}
    if ok:
        clear(key)
    return {"sent": ok, "reason": None if ok else f"http {getattr(r, 'status_code', '?')}"}


def clear(key: str) -> None:
    """Forget a key once its condition is resolved, so a recurrence alerts at once."""
    with _lock:
        state = _load()
        if state.pop(key, None) is not None:
            _save(state)


# ── check 1: the day's official breadth row ─────────────────────────────────

def _session_for(now: datetime, morning: bool) -> Optional[str]:
    """The session the check is about: today in the evening run, the previous
    trading day in the morning run. None when it was not a trading day."""
    from api.services import session_calendar as sc
    d = now.date()
    if morning:
        d -= timedelta(days=1)
        for _ in range(10):
            if sc.is_trading_day(d):
                return d.isoformat()
            d -= timedelta(days=1)
        return None
    return d.isoformat() if sc.is_trading_day(d) else None


#: The EOD writer's own "not yet — retry next tick" outcomes: the session's daily bars are not
#: complete yet (`insufficient_coverage`) or bars.db cannot support it yet (`unavailable`).
#: Anything else (`refused_degraded`, `store_failed`, a stalled job) is a real failure.
RETRYABLE_EOD = ("insufficient_coverage", "unavailable")
#: The writer ticks every 15 min; a job silent longer than this is stalled, not retrying.
EOD_JOB_STALE_S = 45 * 60


def check_eod_row(now: Optional[datetime] = None, morning: bool = False,
                  post: Optional[Callable] = None) -> dict:
    """Is the official breadth row for the session stored — and, once the server owns it
    (`server_writes`), is it the SERVER's? Alerts with the EOD job's own last reason.

    ⭐ (2026-10-13, owner) PENDING IS NOT MISSING. On 2026-10-12 the 21:30 run said "today's
    official row is missing" while the writer was only waiting for the day's bars to complete
    (`insufficient_coverage`); it wrote the row at 21:33. In the EVENING run, when the PC
    collector's row is in place and the writer's latest result for the session is a retryable
    wait with the job still ticking, the alert is a softer PENDING note that says the PC row is
    serving meanwhile. Real failures — and anything still unwritten at the morning re-check —
    keep the full alert. When the row lands, ONE resolution is posted (`resolve_eod_row`, from
    the writer's tick and from a healthy re-check), and only if an alert went out."""
    from api.services import breadth_monitor as bm
    from api.services import breadth_eod_source as eod
    now = now or datetime.now(_ET)
    d = _session_for(now, morning)
    if d is None:
        return {"checked": False, "reason": "not a trading day"}
    row = bm.raw_row(d)
    server_owned = eod.server_writes(d)
    problem = None
    if row is None:
        problem = "no breadth row stored"
    elif server_owned and row.get("_source") != "server":
        problem = "the server did not write the row (only the PC collector's row is there)"
    if problem is None:
        res = resolve_eod_row(d, post=post)
        return {"checked": True, "session": d, "ok": True,
                "source": (row or {}).get("_source") or "collector", "resolved": res}
    st = eod.status()
    job = st.get("job") or {}
    mine = [r for r in job.get("last_results") or [] if r.get("date") == d]
    reasons = [f"{r.get('date')}: {r.get('status')}" + (f" — {r.get('reason')}" if r.get('reason') else "")
               for r in mine][:4]
    mode_line = (f"EOD source mode: {st.get('mode')}"
                 + (f", server from {st.get('server_from')}" if st.get("server_from") else ""))
    last_tick = job.get("last_tick")
    ticking = bool(last_tick) and (now.timestamp() - float(last_tick)) < EOD_JOB_STALE_S
    pending = (not morning and row is not None and ticking and mine
               and all(r.get("status") in RETRYABLE_EOD for r in mine))
    if pending:
        lines = [f"Session {d}: the server has not written its row yet — it is waiting for the "
                 f"day's data and retrying every 15 minutes.",
                 mode_line, *reasons,
                 "The PC collector's row is in place meanwhile, so charts are not missing the day.",
                 "A follow-up message will confirm when the server row lands; the morning check "
                 "re-verifies."]
        res = send(f"eod_row_pending:{d}", "Breadth: today's server row is pending (retrying)",
                   lines, post=post)
        return {"checked": True, "session": d, "ok": False, "pending": True,
                "problem": problem, **res}
    tail = ("The PC collector's row is serving meanwhile; the server-owned row is missing."
            if row is not None else
            "Charts keep the live/provisional bar; the sealed day is missing until this is fixed.")
    if not ticking:
        reasons.append("the EOD job has not ticked in over 45 minutes (stalled)")
    lines = [f"Session {d}: {problem}.", mode_line,
             *(reasons or ["The EOD job has no result for this session yet."]), tail]
    res = send(f"eod_row:{d}", "Breadth: today's official row is missing" if not morning
               else "Breadth: yesterday's official row is still missing", lines, post=post)
    return {"checked": True, "session": d, "ok": False, "problem": problem, **res}


def resolve_eod_row(session: str, post: Optional[Callable] = None) -> dict:
    """The session's row is in place: resolve whichever EOD alert went out for it (missing or
    pending) with ONE post each; nothing is posted when no alert was sent."""
    out = {}
    for key, title in ((f"eod_row:{session}", f"Breadth: the official row for {session} is now stored"),
                       (f"eod_row_pending:{session}", f"Breadth: the server row for {session} has landed")):
        out[key] = resolve(key, title, ["No action needed."], post=post)
    return out
