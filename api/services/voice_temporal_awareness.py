"""
Temporal awareness — what state is the market in, how fresh is our data,
when does the user usually trade.

Provides context for every voice session so the assistant doesn't
recommend an ORB at 1pm or pretend wire_data from 3 days ago is current.

Public API:
  - get_market_context() → dict with session_state, data_freshness,
    user_routine, narration
  - build_temporal_prompt_line(user_id) → compact line for system prompt
"""

import logging
from datetime import datetime, date, timedelta, timezone
from typing import Any

from api.services.auth_db import get_connection

_log = logging.getLogger(__name__)


def _et_now() -> datetime:
    """Current US/Eastern time. Naive DST handling: UTC-4 Mar-Oct, UTC-5 else.
    Good enough for session-state classification."""
    utc = datetime.now(timezone.utc)
    et_offset = -4 if 3 <= utc.month <= 10 else -5
    return utc + timedelta(hours=et_offset)


# ── Market holidays (NYSE) for the next year ────────────────────────────────
# Hard-coded since the schedule shifts predictably. Edit when needed.
_NYSE_HOLIDAYS_2026 = {
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03",  # Good Friday
    "2026-05-25", "2026-06-19", "2026-07-03",  # July 3rd (4th is Sat)
    "2026-09-07", "2026-11-26", "2026-12-25",
}
_NYSE_HOLIDAYS_2027 = {
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26",
    "2027-05-31", "2027-06-18", "2027-07-05",
    "2027-09-06", "2027-11-25", "2027-12-24",
}
_NYSE_HOLIDAYS = _NYSE_HOLIDAYS_2026 | _NYSE_HOLIDAYS_2027


def _is_market_holiday(d: date) -> bool:
    return d.isoformat() in _NYSE_HOLIDAYS


def _next_market_open(now_et: datetime) -> datetime:
    """Find the next 9:30 ET that isn't a weekend or holiday."""
    candidate = now_et.replace(hour=9, minute=30, second=0, microsecond=0)
    if candidate <= now_et:
        candidate += timedelta(days=1)
    while candidate.weekday() >= 5 or _is_market_holiday(candidate.date()):
        candidate += timedelta(days=1)
    return candidate


def _session_state(now_et: datetime) -> dict:
    """Classify current market session state."""
    today = now_et.date()
    is_weekend = now_et.weekday() >= 5
    is_holiday = _is_market_holiday(today)

    if is_weekend or is_holiday:
        reason = "weekend" if is_weekend else "market holiday"
        return {
            "state": "closed",
            "label": "Closed",
            "detail": f"{reason}. Next open: {_next_market_open(now_et).strftime('%a %b %d %I:%M %p ET').replace(' 0', ' ')}"
                      if hasattr(now_et, "strftime") else "next open ahead",
            "minutes_to_open": None,
            "minutes_to_close": None,
        }

    minute_of_day = now_et.hour * 60 + now_et.minute
    if minute_of_day < 9 * 60 + 30:
        mins_to = (9 * 60 + 30) - minute_of_day
        return {
            "state": "premarket",
            "label": "Pre-market",
            "detail": f"open in {mins_to} min",
            "minutes_to_open": mins_to,
            "minutes_to_close": None,
        }
    if minute_of_day < 16 * 60:
        mins_to_close = (16 * 60) - minute_of_day
        # First/last hour callouts
        if minute_of_day < 10 * 60:
            sub = "opening drive"
        elif minute_of_day < 11 * 60 + 30:
            sub = "morning continuation"
        elif minute_of_day < 14 * 60:
            sub = "lunch chop"
        elif minute_of_day < 15 * 60 + 30:
            sub = "afternoon trend"
        else:
            sub = "MOC window"
        return {
            "state": "rth",
            "label": f"Cash open ({sub})",
            "detail": f"close in {mins_to_close} min",
            "minutes_to_open": None,
            "minutes_to_close": mins_to_close,
        }
    if minute_of_day < 20 * 60:
        return {
            "state": "after_hours",
            "label": "After-hours",
            "detail": "RTH closed; AH spreads 3-10x wider",
            "minutes_to_open": None,
            "minutes_to_close": None,
        }
    return {
        "state": "closed",
        "label": "Closed",
        "detail": f"next open: {_next_market_open(now_et).strftime('%a %b %d %I:%M %p ET').replace(' 0', ' ')}",
        "minutes_to_open": None,
        "minutes_to_close": None,
    }


def _data_freshness() -> dict:
    """
    How fresh is the morning wire data? Reads the cache key written
    on every /api/push. Returns staleness in hours + label.
    """
    try:
        from api.services.cache import cache
        wire = cache.get("wire_data")
    except Exception:
        wire = None

    if not wire:
        return {
            "wire_date": None,
            "hours_old": None,
            "label": "no morning wire data loaded",
            "is_fresh": False,
        }

    wire_date_str = wire.get("date") or wire.get("generated_at") or ""
    hours_old = None
    is_fresh = True
    try:
        # Try YYYY-MM-DD first
        if wire_date_str and len(wire_date_str) >= 10:
            wire_date = date.fromisoformat(wire_date_str[:10])
            today = _et_now().date()
            days_old = (today - wire_date).days
            hours_old = days_old * 24
            is_fresh = days_old == 0
            if days_old == 0:
                label = "today's wire (fresh)"
            elif days_old == 1:
                label = "yesterday's wire (1 trading day stale)"
            else:
                label = f"wire is {days_old} days old"
        else:
            label = "wire data present but no date"
            is_fresh = False
    except (ValueError, TypeError):
        label = "wire date couldn't be parsed"
        is_fresh = False

    return {
        "wire_date": wire_date_str[:10] if wire_date_str else None,
        "hours_old": hours_old,
        "label": label,
        "is_fresh": is_fresh,
    }


def _user_routine(user_id: str) -> dict:
    """
    Infer the user's typical voice-session schedule from voice_sessions
    timestamps. Returns most-common hour of day + day of week pattern.
    """
    if not user_id:
        return {"typical_hour_et": None, "common_days": [], "session_count_30d": 0}

    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT started_at FROM voice_sessions
                WHERE user_id = ? AND started_at >= ? AND mode = 'c'""",
            (user_id, cutoff),
        ).fetchall()
    finally:
        conn.close()

    if not rows:
        return {"typical_hour_et": None, "common_days": [], "session_count_30d": 0}

    from collections import Counter
    hour_counts: Counter = Counter()
    day_counts: Counter = Counter()
    for r in rows:
        try:
            ts = r["started_at"]
            if isinstance(ts, str):
                # Parse ISO; assume UTC if naive
                if ts.endswith("Z"):
                    ts = ts[:-1] + "+00:00"
                dt = datetime.fromisoformat(ts)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
            else:
                continue
            et_offset = -4 if 3 <= dt.month <= 10 else -5
            et_hour = (dt.hour + et_offset) % 24
            hour_counts[et_hour] += 1
            day_counts[dt.weekday()] += 1
        except Exception:
            continue

    typical_hour = hour_counts.most_common(1)[0][0] if hour_counts else None
    common_days_idx = [d for d, _ in day_counts.most_common(3)]
    day_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    common_days = [day_names[d] for d in common_days_idx]

    return {
        "typical_hour_et": typical_hour,
        "common_days": common_days,
        "session_count_30d": len(rows),
    }


# ── Public API ─────────────────────────────────────────────────────────────

def get_market_context(user_id: str | None = None) -> dict[str, Any]:
    """
    Compose temporal context for the assistant.
    Returns session_state, data_freshness, user_routine, narration.
    """
    now_et = _et_now()
    session = _session_state(now_et)
    freshness = _data_freshness()
    routine = _user_routine(user_id) if user_id else {
        "typical_hour_et": None, "common_days": [], "session_count_30d": 0,
    }

    # Compose narration
    parts = [f"Market is {session['label']} — {session['detail']}."]
    parts.append(f"Data: {freshness['label']}.")
    if routine.get("typical_hour_et") is not None:
        parts.append(
            f"You usually talk to me around {routine['typical_hour_et']}:00 ET "
            f"on {', '.join(routine['common_days']) or 'various days'}."
        )
    narration = " ".join(parts)

    return {
        "ok": True,
        "now_et_iso": now_et.isoformat(),
        "session_state": session,
        "data_freshness": freshness,
        "user_routine": routine,
        "narration": narration,
    }


def build_temporal_prompt_line(user_id: str | None = None) -> str:
    """Compact one-liner for system prompt injection at session start."""
    try:
        ctx = get_market_context(user_id)
    except Exception:
        return ""
    s = ctx["session_state"]
    f = ctx["data_freshness"]
    line_parts = [f"TEMPORAL CONTEXT: Market is {s['label']} ({s['detail']})"]
    if not f.get("is_fresh"):
        line_parts.append(
            f"⚠ {f['label']} — flag this if the user asks for current data"
        )
    else:
        line_parts.append(f"{f['label']}")
    return ". ".join(line_parts) + "."
