"""ET trading-day spine helpers.

Single source of truth for bucketing a stored j2 timestamp onto its ET
trading day and ET hour. Heterogeneous input forms (full UTC ISO, bare
date, naive ISO) are all handled; date-only intent (bare date or exact
UTC midnight) buckets to the literal typed day with a NULL hour.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover - py3.8 fallback, matches calendar.py
    from backports.zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
UTC = timezone.utc


def _parse(iso: str | None) -> datetime | None:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt


def _is_date_only(iso: str, dt: datetime) -> bool:
    if "T" not in str(iso):
        return True
    # Date-only manual/CSV entries are normalized to exact UTC midnight.
    utc_dt = dt.astimezone(UTC)
    return utc_dt.hour == 0 and utc_dt.minute == 0 and utc_dt.second == 0


def compute_trading_day_et(iso: str | None) -> str | None:
    if iso and "T" not in str(iso):
        s = str(iso).strip()
        try:
            datetime.fromisoformat(s)  # validate bare date
        except (ValueError, TypeError):
            return None
        return s
    dt = _parse(iso)
    if dt is None:
        return None
    if _is_date_only(iso, dt):
        return dt.astimezone(UTC).strftime("%Y-%m-%d")
    return dt.astimezone(ET).strftime("%Y-%m-%d")


def compute_hour_et(iso: str | None) -> int | None:
    dt = _parse(iso)
    if dt is None or _is_date_only(iso, dt):
        return None
    return dt.astimezone(ET).hour


# 09:30 ET, in minutes past ET midnight — the regular-session OPEN.
_OPEN_MINUTES_ET = 9 * 60 + 30


def session_day_et(iso: str | None) -> str | None:
    """The trading session a broker equity reading BELONGS to ('YYYY-MM-DD').

    NOT the same question as `compute_trading_day_et`, which buckets a stored
    timestamp onto its own ET calendar day. A balance sync runs ~03:40 ET,
    before the open, so the equity in that payload is the PREVIOUS session's
    close — filing it under the sync's own date puts Friday's close on
    Saturday and duplicates Thursday's (measured on prod 2026-08-29).

    The threshold is the OPEN, deliberately, not the close. Once a session has
    opened, a reading is that day's (intraday or final) and belongs to it;
    filing a 13:00 ET reading under the previous session would clobber a
    settled close with a live number. Before the open — or on a weekend — the
    only thing the broker can be reporting is the last closed session.

    Holidays are not modelled (no client- or server-side calendar exists): a
    holiday reading files under the holiday itself. That is the same exposure
    the rest of the app carries and it self-corrects on the next session's
    sync; it never moves a real session's value.

    Returns None when `iso` is absent or unparseable — callers must decide,
    never guess (history_backfill rows carry a `backfill:` marker, not a
    timestamp, and must be left where they are).
    """
    dt = _parse(iso)
    if dt is None:
        return None
    et = dt.astimezone(ET)
    day = et.date()
    if day.weekday() < 5 and (et.hour * 60 + et.minute) >= _OPEN_MINUTES_ET:
        return day.isoformat()
    while True:
        day -= timedelta(days=1)
        if day.weekday() < 5:
            return day.isoformat()
