"""THE REPLAY WITHIN THE DAY (2026-11-08). The owner, on the workbench: "Think we should tick by tick so each day has
multiuple ticks like using each 30 min or hourly close to show how everyday moved essentially", and "in between the main
lesson days can be a bit faster of a speed through on the tick by tick".

A chart's run-on is daily candles. This module is the pure half of the replay within the day: a day's regular-session
30-minute (or hourly) bars, grouped by session and CHECKED against the daily candle the chart already draws, so the
replay never builds a day toward any candle but the one on the chart. A day that does not add up is left out, and the
run-on shows that day whole, as it always has. Nothing here fetches. The fill step (scripts/study/fill_replay_intraday.py)
fetches once, on the server, and stores what passes (study_store.upsert_intraday); a member's run-on reads only what was
stored (B3: no provider call while anyone plays).
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime
from typing import Iterable, Optional
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
OPEN_MIN = 9 * 60 + 30
CLOSE_MIN = 16 * 60
#: The provider's intraday floor (bars_fetch._fetch_intraday_range: "~2003-09-10"); a chart before it keeps the daily replay.
INTRADAY_FLOOR = 20030910
#: How closely a day's intraday bars must agree with its daily candle. The last bar's close against the day's close (the
#: closing auction can print a little off the last trade); the session's high and low may not pass the candle's by more
#: than this (the daily candle may include trades outside the session, so inside it is always fine); the first bar's open
#: against the day's open (the first trade of the day can come before 9:30).
TOL_CLOSE = 0.01
TOL_RANGE = 0.01
TOL_OPEN = 0.03
#: A day with fewer bars than this is too thin to play (a halt, a gap in the provider's record).
MIN_TICKS = {30: 4, 60: 3}


def day_key(t) -> Optional[int]:
    """YYYYMMDD of a bar: a daily bar's own key (20240319 or "2024-03-19"), or the ET session date of a unix second."""
    s = str(t).strip()
    digits = s.replace("-", "")[:8]
    if len(s) >= 10 and s[4] == "-" and digits.isdigit():
        return int(digits)
    if s.isdigit() and len(s) == 8:
        return int(s)
    try:
        return int(datetime.fromtimestamp(int(float(s)), tz=ET).strftime("%Y%m%d"))
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def session_days(bars: Iterable[dict], tf_minutes: int) -> dict[int, list[dict]]:
    """Regular-session bars by ET session date, in time order: a bar counts when it starts at 9:30 or later and ends by
    16:00 (the provider's 30-minute bars also cover the hours before and after the session)."""
    out: dict[int, list[dict]] = {}
    for b in bars or []:
        try:
            ts = int(b["t"])
            dt = datetime.fromtimestamp(ts, tz=ET)
        except (KeyError, TypeError, ValueError, OverflowError, OSError):
            continue
        m = dt.hour * 60 + dt.minute
        if m < OPEN_MIN or m + tf_minutes > CLOSE_MIN:
            continue
        out.setdefault(int(dt.strftime("%Y%m%d")), []).append(b)
    for k in out:
        out[k].sort(key=lambda x: int(x["t"]))
    return out


def check_day(daily: dict, ticks: list[dict], tf_minutes: int) -> Optional[str]:
    """None when the day's bars add up to its daily candle; else the reason they do not."""
    if len(ticks) < MIN_TICKS.get(tf_minutes, 3):
        return "thin"
    try:
        do, dh, dl, dc = (float(daily[k]) for k in ("o", "h", "l", "c"))
        hi = max(float(b["h"]) for b in ticks)
        lo = min(float(b["l"]) for b in ticks)
        o0, cl = float(ticks[0]["o"]), float(ticks[-1]["c"])
    except (KeyError, TypeError, ValueError):
        return "bad_bar"
    if min(do, dh, dl, dc) <= 0 or min(hi, lo, o0, cl) <= 0:
        return "bad_bar"
    if abs(cl / dc - 1.0) > TOL_CLOSE:
        return "close"
    if hi > dh * (1.0 + TOL_RANGE) or lo < dl * (1.0 - TOL_RANGE):
        return "range"
    if abs(o0 / do - 1.0) > TOL_OPEN:
        return "open"
    return None


def pack(ticks: list[dict]) -> list[list]:
    """[[t, o, h, l, c, v], ...]: compact for storage and the wire."""
    r = lambda x: round(float(x), 4)  # noqa: E731
    return [[int(b["t"]), r(b["o"]), r(b["h"]), r(b["l"]), r(b["c"]), int(float(b.get("v") or 0))] for b in ticks]


def build(forward: list[dict], intraday: list[dict], tf_minutes: int) -> dict:
    """The stored replay for one chart: its forward days that add up, keyed "YYYYMMDD", with how many passed and why
    the rest did not. `forward` is the chart's own daily forward strip (study router `_forward_bars`)."""
    by_day = session_days(intraday, tf_minutes)
    days: dict[str, list] = {}
    why: Counter = Counter()
    for bar in forward or []:
        k = day_key(bar.get("t"))
        if k is None:
            why["bad_day"] += 1
            continue
        ticks = by_day.get(k)
        if not ticks:
            why["missing"] += 1
            continue
        reason = check_day(bar, ticks, tf_minutes)
        if reason:
            why[reason] += 1
            continue
        days[str(k)] = pack(ticks)
    return {"days": days, "passed": len(days), "failed": sum(why.values()), "why": dict(why)}
