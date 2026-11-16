"""Vectorised intraday bucket starts that EXACTLY match the app's.

The app's authority is ``api/services/bar_rollup.py``::

    tv_bucket_bounds(ts_ms, tf, session) -> (start_ms, end_ms)

This module is a numpy re-statement of that function for a whole array of
minute-bar start times (epoch SECONDS) from ONE ET calendar day. It imports
nothing from ``api/`` -- it has to run standalone on the build PC -- so the
equivalence is not by construction, it is by test:
``tests/test_history_lake_bucketing.py`` compares every minute of whole days
(normal, both DST transitions and the days around them, early closes) against
``tv_bucket_bounds`` for every tf and both grids, starts AND ends.

What ``tv_bucket_bounds`` does (line numbers are ``api/services/bar_rollup.py``
at the time of writing) and therefore what this module does:

* The timestamp is floored to its minute first (``:170``).
* tf 1 / 5 / 15 / 30: a plain floor of the EPOCH to the step (``:171-174``).
  ``session`` is ignored. Because ET is a whole number of hours from UTC this
  is also the ET clock floor, on every day including DST days. The bucket end
  is always ``start + step`` (a 30m bucket is never cut at the 16:00 close:
  16:00 is a multiple of 30 minutes).
* tf 60, grid ``eth``: the ET clock hour (``:143-145``). The 09:00 bucket spans
  the open (09:00-09:59).
* tf 60, grid ``rth`` (``:140-147``):
    - 09:30 <= minute < close  ->  buckets anchored at 09:30: 09:30, 10:30, ...
      14:30, and a HALF bar 15:30-16:00 (``end = min(start + 60, close)``).
      On a 13:00 early-close day the last RTH bucket is 12:30-13:00.
    - every other minute (pre-market, post-market, overnight) is NOT dropped
      and NOT merged into an RTH bar: it falls back to the ET CLOCK HOUR
      (``:144``). So on the rth grid pre-market bars are 04:00, 05:00, ...
      08:00 and a 09:00 bar that holds only 09:00-09:29 (its END is cut to
      09:30, ``:146-147``; its START is still 09:00), and post-market bars are
      16:00, 17:00, 18:00, 19:00 (13:00, 14:00, ... on an early-close day).
      A full day on the rth grid is therefore 17 bars:
      04,05,06,07,08,09 | 09:30,10:30,11:30,12:30,13:30,14:30,15:30 | 16,17,18,19.
* "close" is 16:00, or 13:00 when the ET date is in the NYSE early-close set
  (``_rth_close_min``, ``:116-130``). The app reads that set from
  ``app/src/lib/marketClock/market_calendar.json`` via ``nyse_calendar``;
  ``EARLY_CLOSE_YYYYMMDD`` below is a COPY of those dates, pinned against the
  app's by the test (set equality + every date 1999..2030).
  A date outside the copied coverage window is a full day -- exactly what the
  app answers for a date its dataset does not list.
* A bucket start/end expressed in ET wall minutes is turned back into an
  instant by building a wall-clock ``datetime`` with ``fold=0`` (``_at``,
  ``:149-154``). That only matters on the two DST Sundays:
    - fall back: BOTH 01:xx hours (EDT then EST) land in ONE bucket that starts
      at the first 01:00 (EDT) -- a two-hour bucket;
    - spring forward: the 01:00 bucket ends at the non-existent 02:00, which
      resolves to 03:00 EDT, so it is an ordinary one-hour bucket.
  An end of 24:00 is the next ET midnight (``:150-153``).
  This module reproduces both (the offset is resolved once per day with
  ``zoneinfo``, plus the transition instant on a DST day).

Nothing here "improves" the grid. If ``tv_bucket_bounds`` changes, the test
goes red and this file changes with it.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from functools import lru_cache
from typing import NamedTuple, Optional, Union
from zoneinfo import ZoneInfo

import numpy as np

ET = ZoneInfo("America/New_York")

#: Timeframes ``tv_bucket_bounds`` accepts (``bar_rollup.TF_TO_SECONDS``).
TF_SECONDS = {"1": 60, "5": 300, "15": 900, "30": 1800, "60": 3600}
#: Session grids (``bar_rollup.SESSIONS``).
GRIDS = ("rth", "eth")

#: History-lake series id -> (tf, grid).
SERIES = {
    "1": ("1", "rth"),
    "5": ("5", "rth"),
    "15": ("15", "rth"),
    "30": ("30", "rth"),
    "60": ("60", "rth"),
    "60e": ("60", "eth"),
}

RTH_OPEN_MIN = 9 * 60 + 30
RTH_CLOSE_MIN = 16 * 60
EARLY_CLOSE_MIN = 13 * 60

#: COPY of the app's NYSE 13:00 early-close dates
#: (``api.services.nyse_calendar.NYSE_EARLY_CLOSES_YYYYMMDD``, derived from
#: ``app/src/lib/marketClock/market_calendar.json`` v2026-09-29.1).
#: Pinned by ``tests/test_history_lake_bucketing.py``; refresh it from the JSON
#: when that test goes red, never by hand from memory.
EARLY_CLOSE_YYYYMMDD = frozenset((
    20000703, 20001124, 20010703, 20011123, 20011224, 20020705, 20021129,
    20021224, 20030703, 20031128, 20031224, 20031226, 20041126, 20051125,
    20060703, 20061124, 20070703, 20071123, 20071224, 20080703, 20081128,
    20081224, 20091127, 20091224, 20101126, 20111125, 20120703, 20121123,
    20121224, 20130703, 20131129, 20131224, 20140703, 20141128, 20141224,
    20151127, 20151224, 20161125, 20170703, 20171124, 20180703, 20181123,
    20181224, 20190703, 20191129, 20191224, 20201127, 20201224, 20211126,
    20221125, 20230703, 20231124, 20240703, 20241129, 20241224, 20250703,
    20251128, 20251224, 20261127, 20261224, 20271126, 20280703, 20281124,
))
#: The window the copied set is complete for (the dataset's coverage_start and
#: horizon). Outside it a date reads as a full day, as it does in the app.
CALENDAR_FROM_YYYYMMDD = 20000101
CALENDAR_THROUGH_YYYYMMDD = 20281231

DayLike = Union[int, str, date]


def to_ymd(day: DayLike) -> int:
    """``20261113`` from ``20261113`` / ``'2026-11-13'`` / ``date(2026, 11, 13)``."""
    if isinstance(day, datetime):
        raise TypeError("pass a date, an int YYYYMMDD or 'YYYY-MM-DD', not a datetime")
    if isinstance(day, date):
        return day.year * 10000 + day.month * 100 + day.day
    if isinstance(day, str):
        d = date.fromisoformat(day)
        return d.year * 10000 + d.month * 100 + d.day
    ymd = int(day)
    date(ymd // 10000, ymd // 100 % 100, ymd % 100)  # validates
    return ymd


def calendar_covers(day: DayLike) -> bool:
    """True when the copied early-close set is authoritative for ``day``."""
    return CALENDAR_FROM_YYYYMMDD <= to_ymd(day) <= CALENDAR_THROUGH_YYYYMMDD


def rth_close_minute(day: DayLike) -> int:
    """Regular-session close in minutes after ET midnight: 780 on an early-close
    day, else 960. Mirrors ``bar_rollup._rth_close_min``."""
    return EARLY_CLOSE_MIN if to_ymd(day) in EARLY_CLOSE_YYYYMMDD else RTH_CLOSE_MIN


class DayContext(NamedTuple):
    ymd: int
    mid0: int             # epoch s of this ET midnight
    mid1: int             # epoch s of the next ET midnight
    off0: int             # UTC offset (s) in effect at mid0
    off1: int             # UTC offset (s) in effect at the end of the day
    trans: Optional[int]  # epoch s of the DST transition inside the day, else None
    close_min: int        # RTH close, minutes after ET midnight


def _offset_at(ts: int) -> int:
    return int(datetime.fromtimestamp(ts, tz=ET).utcoffset().total_seconds())


@lru_cache(maxsize=4096)
def day_context(ymd: int) -> DayContext:
    """Everything the 60m grid needs about one ET calendar day, resolved once."""
    d = date(ymd // 10000, ymd // 100 % 100, ymd % 100)
    n = d + timedelta(days=1)
    mid0 = int(datetime(d.year, d.month, d.day, tzinfo=ET).timestamp())
    mid1 = int(datetime(n.year, n.month, n.day, tzinfo=ET).timestamp())
    off0 = _offset_at(mid0)
    off1 = _offset_at(mid1 - 60)
    trans = None
    if off0 != off1:
        # A DST day (two per year, both Sundays). Find the first minute that
        # carries the new offset; <= 1500 probes, cached.
        for ts in range(mid0, mid1, 60):
            if _offset_at(ts) == off1:
                trans = ts
                break
        if trans is None:  # pragma: no cover - zoneinfo contradiction
            raise RuntimeError(f"no DST transition found inside {ymd}")
    return DayContext(ymd, mid0, mid1, off0, off1, trans, rth_close_minute(ymd))


def et_date_of(ts_s: int) -> int:
    """ET calendar date (YYYYMMDD) of an epoch-seconds instant."""
    dt = datetime.fromtimestamp(int(ts_s), tz=ET)
    return dt.year * 10000 + dt.month * 100 + dt.day


def _minute_of_day(minute_ts: np.ndarray, ctx: DayContext) -> np.ndarray:
    """ET wall-clock minute-of-day (0..1439) of each instant."""
    if ctx.trans is None:
        return (minute_ts - ctx.mid0) // 60
    off = np.where(minute_ts < ctx.trans, ctx.off0, ctx.off1)
    return (minute_ts + off - (ctx.mid0 + ctx.off0)) // 60


def et_minute_of_day(ts_s, day: DayLike) -> np.ndarray:
    """ET wall-clock minute-of-day of each instant of ET calendar date ``day``."""
    ts = np.asarray(ts_s, dtype=np.int64)
    return _minute_of_day(ts // 60 * 60, day_context(to_ymd(day)))


def _wall_to_ts(mins: np.ndarray, ctx: DayContext) -> np.ndarray:
    """Instant of an ET wall minute-of-day, the way ``_at`` builds it:
    ``datetime(y, m, d, hh, mm, tzinfo=ET)`` with ``fold=0``; 24:00 (and beyond)
    is the next ET midnight."""
    if ctx.trans is None:
        ts = ctx.mid0 + mins * 60
    else:
        wall = ctx.mid0 + ctx.off0 + mins * 60       # wall seconds, as if UTC
        # fold=0: an ambiguous wall time takes the FIRST offset; a wall time in
        # the spring gap takes the PRE-transition offset too. Both reduce to:
        # the old offset applies to every wall time before the later of the two
        # wall readings of the transition instant.
        threshold = ctx.trans + max(ctx.off0, ctx.off1)
        ts = wall - np.where(wall < threshold, ctx.off0, ctx.off1)
    return np.where(mins >= 1440, ctx.mid1, ts)


def bucket_bounds(ts_s, tf: str, grid: str = "rth", day: Optional[DayLike] = None):
    """``(starts, ends)`` in epoch seconds for an array of bar start times.

    Element for element equal to ``tv_bucket_bounds(ts_s * 1000, tf, grid)``
    divided by 1000. ``ts_s`` must all fall on ONE ET calendar day when
    ``tf == '60'`` (``day`` names it; inferred from the first element when
    omitted); a timestamp outside that day raises ``ValueError``.
    """
    if tf not in TF_SECONDS:
        raise ValueError(f"Unsupported timeframe for rollup: {tf!r}")
    if grid not in GRIDS:
        raise ValueError(f"Unsupported session: {grid!r}")
    ts = np.asarray(ts_s, dtype=np.int64)
    minute = ts // 60 * 60
    if tf != "60":
        step = TF_SECONDS[tf]
        start = minute // step * step
        return start, start + step
    if ts.size == 0:
        return minute.copy(), minute.copy()

    ymd = to_ymd(day) if day is not None else et_date_of(int(minute.flat[0]))
    ctx = day_context(ymd)
    if int(minute.min()) < ctx.mid0 or int(minute.max()) >= ctx.mid1:
        raise ValueError(
            f"timestamps outside ET day {ymd}: "
            f"[{int(minute.min())}, {int(minute.max())}] vs [{ctx.mid0}, {ctx.mid1})")

    mod = _minute_of_day(minute, ctx)
    start = mod // 60 * 60                    # ET clock hour
    end = start + 60
    if grid == "rth":
        in_rth = (mod >= RTH_OPEN_MIN) & (mod < ctx.close_min)
        rth_start = RTH_OPEN_MIN + (mod - RTH_OPEN_MIN) // 60 * 60
        rth_end = np.minimum(rth_start + 60, ctx.close_min)
        # the 09:00 pre-market hour ENDS at the open; its start stays 09:00
        end = np.where((start < RTH_OPEN_MIN) & (RTH_OPEN_MIN < end), RTH_OPEN_MIN, end)
        start = np.where(in_rth, rth_start, start)
        end = np.where(in_rth, rth_end, end)
    return _wall_to_ts(start, ctx), _wall_to_ts(end, ctx)


def bucket_starts(ts_s, tf: str, grid: str = "rth", day: Optional[DayLike] = None) -> np.ndarray:
    """Bucket start (epoch seconds) of each bar start time. See ``bucket_bounds``."""
    return bucket_bounds(ts_s, tf, grid, day)[0]


def series_bucket_starts(ts_s, series: str, day: Optional[DayLike] = None) -> np.ndarray:
    """Bucket starts for a history-lake series id (``1 5 15 30 60 60e``)."""
    if series not in SERIES:
        raise ValueError(f"Unknown series: {series!r}")
    tf, grid = SERIES[series]
    return bucket_starts(ts_s, tf, grid, day)
