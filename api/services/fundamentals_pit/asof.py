"""AS-OF projection: sparse PIT points -> a value at every chart bar.

This is deliberately NOT the `sym:` operator. `symbolProjection` joins two
series on EXACT bar time with no forward fill, which is right for two prices.
A fundamental is a DISCLOSURE: it stays in force from the instant it became
public until the next disclosure replaces it. So each bar takes the last point
whose `t_eff` is at or before the bar's REFERENCE TIME:

    daily bar D         D 16:00 ET  (the close the bar's price describes)
    weekly / monthly    16:00 ET of the bucket's LAST calendar day, capped at now
    intraday bar [a,b)  b, the bar's end (its close)

"Known by the bar's close" is one rule for every timeframe, and matches how the
price of that bar was formed. A 10-Q accepted 16:42 ET on D therefore first
applies to D+1's daily bar, and on a 5-minute chart to the 16:45 bar -- or,
without extended hours, to the next session's first bar.

STALENESS: a point stops being in force once its fiscal period is older than
`max_period_age` at the bar (default 200 days -- the longest normal gap is a
late filer's 10-K window plus the next 10-Q, ~150 days). A company that stops
filing (SMCI filed no 10-K from 2017 to May 2019) goes BLANK, not flat: a
two-year-old margin is not a current margin.
"""
from __future__ import annotations

import calendar
from bisect import bisect_right
from datetime import date, datetime, time, timedelta, timezone

from .filings import ET

CLOSE_ET = time(16, 0)
MAX_PERIOD_AGE = timedelta(days=200)


def close_utc(d: date) -> datetime:
    return datetime.combine(d, CLOSE_ET, tzinfo=ET).astimezone(timezone.utc)


def reference_time(bar_key, tf: str, now: datetime | None = None) -> datetime:
    """The instant a bar's value is 'as of'. `bar_key` is an ISO date string
    (D/W/M bars) or unix seconds (intraday bar START)."""
    if tf in ("D", "W", "M"):
        d = date.fromisoformat(bar_key) if isinstance(bar_key, str) else bar_key
        if tf == "W":
            d = d + timedelta(days=(4 - d.weekday()) % 7)          # that week's Friday
        elif tf == "M":
            d = date(d.year, d.month, calendar.monthrange(d.year, d.month)[1])
        ref = close_utc(d)
        return min(ref, now) if now is not None else ref
    minutes = {"1m": 1, "2m": 2, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240}[tf]
    return datetime.fromtimestamp(int(bar_key), tz=timezone.utc) + timedelta(minutes=minutes)


def project(points, bar_keys, tf: str, now: datetime | None = None,
            max_period_age: timedelta = MAX_PERIOD_AGE) -> list[float | None]:
    """points: ascending by t_eff, each with .t_eff (UTC), .v, .period_end."""
    ts = [p.t_eff for p in points]
    out: list[float | None] = []
    for k in bar_keys:
        ref = reference_time(k, tf, now)
        i = bisect_right(ts, ref)
        if not i:
            out.append(None)
            continue
        p = points[i - 1]
        age = ref.date() - p.period_end
        out.append(p.v if age <= max_period_age else None)
    return out
