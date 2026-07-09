"""ET trading-day spine helpers.

Single source of truth for bucketing a stored j2 timestamp onto its ET
trading day and ET hour. Heterogeneous input forms (full UTC ISO, bare
date, naive ISO) are all handled; date-only intent (bare date or exact
UTC midnight) buckets to the literal typed day with a NULL hour.
"""
from __future__ import annotations

from datetime import datetime, timezone

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
