"""
Journal 2.0 — celebration moments (P6-7).

Tasteful positive reinforcement: a milestone becomes a `sev:'success'` ROW inside
the existing CoachStrip (NOT a new band, NOT confetti, NOT emoji). Four achievements
are recognised:

  - goal:       any goal_progress period whose progress >= 1.0 (goal hit)
  - streak:     winStreakCount >= the win threshold
  - discipline: a clean session — traded, NO intervention fired today, not
                currently locked, day effectively done
  - adherence:  a closed trade whose adherencePct == 1.0 (every rule followed)

Each achievement fires EXACTLY ONCE ever — durable + cross-device — via the shared
`calendar_seen` once-per gate (item_type='celebration'). A candidate whose key is
already seen is dropped; survivors are marked seen and returned. So a given key is
returned at most once, ever.

`detect()` takes the already-loaded aggregates (goal_progress / nudges / discipline /
adherence / today) as params so the caller (overview.get_overview) passes only what it
already has — no heavy new queries here. Any missing/None input simply doesn't emit its
achievement type; the function never raises.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from api.services import calendar_seen


_SEEN_TYPE = "celebration"

# lowercase key -> Title label used in the goal message
_PERIOD_LABELS = {
    "daily": "Daily",
    "weekly": "Weekly",
    "monthly": "Monthly",
    "yearly": "Yearly",
}


def _money(v: Any) -> str:
    """Format a dollar amount for a celebration message. Defensive: never raises."""
    try:
        return f"${float(v):,.0f}"
    except (TypeError, ValueError):
        return "$0"


def _resolve_today(today_date: str | None) -> date:
    """ET-agnostic best-effort: parse the caller's YYYY-MM-DD, else local today."""
    if today_date:
        try:
            return date.fromisoformat(str(today_date)[:10])
        except (ValueError, TypeError):
            pass
    return datetime.now().date()


def _period_id(period: str, today: date) -> str:
    """Stable per-period identifier so a goal celebration fires once PER period
    (e.g. this week's weekly goal can be re-earned next week under a fresh key)."""
    if period == "weekly":
        iso = today.isocalendar()  # (iso_year, iso_week, iso_weekday)
        return f"{iso[0]}-W{int(iso[1]):02d}"
    if period == "monthly":
        return f"{today.year}-{today.month:02d}"
    if period == "yearly":
        return str(today.year)
    # daily (and any unknown) — the calendar day itself
    return today.isoformat()


def detect(
    user_id: str,
    account_id: str,
    *,
    overview: dict | None = None,
    goal: dict | None = None,
    nudges: dict | None = None,
    discipline: dict | None = None,
    adherence: dict | None = None,
    today_date: str | None = None,
    traded_today: bool | None = None,
    day_complete: bool = False,
    intervention_fired_today: bool = False,
) -> list[dict]:
    """Return the celebrations newly earned on this call (each at most once ever).

    Each returned item is a plain ``{key, kind, message}`` dict; the frontend maps it
    to a ``sev:'success'`` CoachStrip row. The once-per gate (`calendar_seen`) is the
    load-bearing anti-spam: a key already marked seen is never returned again.
    """
    today = _resolve_today(today_date)
    candidates: list[dict] = []

    # ── goal hit ─────────────────────────────────────────────────────────────
    try:
        periods = (goal or {}).get("periods") or {}
        for pkey, plabel in _PERIOD_LABELS.items():
            p = periods.get(pkey) or {}
            progress = p.get("progress")
            if progress is not None and float(progress) >= 1.0:
                pid = _period_id(pkey, today)
                candidates.append({
                    "key": f"goal_{pkey}_{pid}",
                    "kind": "goal",
                    "message": f"{plabel} goal hit — {_money(p.get('pnl'))}. Bank it.",
                })
    except Exception:
        pass

    # ── win streak ───────────────────────────────────────────────────────────
    try:
        if nudges:
            n = int(nudges.get("winStreakCount") or 0)
            win_th = int((nudges.get("thresholds") or {}).get("win") or 0)
            if win_th > 0 and n >= win_th:
                candidates.append({
                    "key": f"winstreak_{n}",
                    "kind": "streak",
                    "message": f"{n} wins in a row — the process is working.",
                })
    except Exception:
        pass

    # ── clean discipline day ─────────────────────────────────────────────────
    # Only when: traded today, NO intervention fired today, not currently locked,
    # AND the caller signals the market day is effectively done (day_complete).
    # `intervention_fired_today` (caller-supplied, today-bounded) is the load-bearing
    # honesty check: cooling-off / no-trade-window locks EXPIRE by EOD, so a day
    # that breached one earlier — now unlocked — must NOT read as clean. Derives
    # tradedToday from overview.today when the caller doesn't pass it explicitly.
    try:
        if discipline is not None:
            traded = traded_today
            if traded is None and overview:
                tc = (overview.get("today") or {}).get("trade_count")
                traded = bool(tc and int(tc) > 0)
            if (
                traded
                and day_complete
                and not intervention_fired_today
                and not bool(discipline.get("locked"))
            ):
                candidates.append({
                    "key": f"cleanday_{today.isoformat()}",
                    "kind": "discipline",
                    "message": "Full session, no discipline breaches. That's the edge.",
                })
    except Exception:
        pass

    # ── 100%-adherence trade ─────────────────────────────────────────────────
    try:
        if adherence:
            for trade_ref, rec in adherence.items():
                pct = (rec or {}).get("adherencePct")
                if pct is not None and float(pct) >= 1.0:
                    candidates.append({
                        "key": f"adherence100_{trade_ref}",
                        "kind": "adherence",
                        "message": "Followed every rule on that trade.",
                    })
    except Exception:
        pass

    if not candidates:
        return []

    # ── once-per gate (durable, cross-device) ────────────────────────────────
    try:
        seen = calendar_seen.get_seen(user_id, _SEEN_TYPE)
    except Exception:
        # Gate unavailable → emit nothing rather than risk firing every render.
        return []

    fresh: list[dict] = []
    for c in candidates:
        key = c["key"]
        if key in seen:
            continue
        try:
            calendar_seen.mark_seen(user_id, _SEEN_TYPE, key)
        except Exception:
            continue  # couldn't durably record it → don't surface (avoid re-fire spam)
        seen.add(key)  # guard against duplicate keys within a single batch
        fresh.append(c)
    return fresh
