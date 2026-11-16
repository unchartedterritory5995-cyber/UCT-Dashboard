"""tools/history_lake/bucketing.py must equal api.services.bar_rollup.tv_bucket_bounds
for EVERY minute, every tf, both grids -- starts and ends. Zero differences allowed.

Run: python -m pytest tests/test_history_lake_bucketing.py -q -p no:cacheprovider
"""
from datetime import date, datetime, timedelta
import random

import numpy as np
import pytest

from api.services import bar_rollup
from api.services import nyse_calendar
from api.services import session_calendar
from tools.history_lake import bucketing as B

ET = B.ET
TFS = ("1", "5", "15", "30", "60")
GRIDS = ("rth", "eth")

# normal day, both DST transitions with the days around them, early closes
# (day after Thanksgiving, Christmas Eve, July 3rd), a holiday and a weekend.
DAYS = [
    "2026-11-13",                               # normal (EST)
    "2026-07-15",                               # normal (EDT)
    "2026-03-06", "2026-03-08", "2026-03-09",   # spring forward: Fri, the Sunday, Mon
    "2026-10-30", "2026-11-01", "2026-11-02",   # fall back: Fri, the Sunday, Mon
    "2025-03-09", "2025-11-02", "2012-11-04",   # other DST Sundays
    "2026-11-27", "2025-11-28",                 # day after Thanksgiving (13:00 close)
    "2026-12-24", "2024-12-24", "2012-12-24",   # Christmas Eve (13:00 close)
    "2025-07-03", "2003-12-26",                 # other early closes
    "2026-11-26", "2026-11-14",                 # a holiday, a Saturday
    "2029-11-23",                               # past the calendar horizon
]


def _day_minutes(day: str) -> np.ndarray:
    """Every minute of the ET calendar day (1380 / 1440 / 1500 of them)."""
    ctx = B.day_context(B.to_ymd(day))
    return np.arange(ctx.mid0, ctx.mid1, 60, dtype=np.int64)


def _reference(minutes: np.ndarray, tf: str, grid: str):
    pairs = [bar_rollup.tv_bucket_bounds(int(t) * 1000, tf, grid) for t in minutes]
    s = np.array([p[0] for p in pairs], dtype=np.int64)
    e = np.array([p[1] for p in pairs], dtype=np.int64)
    assert not (s % 1000).any() and not (e % 1000).any()
    return s // 1000, e // 1000


def _hhmm(ts: int) -> str:
    return datetime.fromtimestamp(int(ts), tz=ET).strftime("%H:%M")


def test_reference_reads_the_calendar():
    """Control: the app's function is really half-day aware in this process. If its
    calendar import silently fell back to a full day, every comparison below on an
    early-close day would be measuring the fallback."""
    assert bar_rollup._rth_close_min(20261127) == 13 * 60
    assert bar_rollup._rth_close_min(20261113) == 16 * 60
    s, e = bar_rollup.tv_bucket_bounds(
        int(datetime(2026, 11, 27, 12, 45, tzinfo=ET).timestamp()) * 1000, "60", "rth")
    assert (_hhmm(s // 1000), _hhmm(e // 1000)) == ("12:30", "13:00")


@pytest.mark.parametrize("day", DAYS)
def test_every_minute_of_the_day_matches_tv_bucket_bounds(day):
    minutes = _day_minutes(day)
    assert len(minutes) in (1380, 1440, 1500)
    # 04:00-20:00 ET is inside what is compared (the whole day is)
    compared = 0
    for tf in TFS:
        for grid in GRIDS:
            ref_s, ref_e = _reference(minutes, tf, grid)
            got_s, got_e = B.bucket_bounds(minutes, tf, grid, day)
            bad = np.flatnonzero((got_s != ref_s) | (got_e != ref_e))
            assert bad.size == 0, (
                f"{day} tf={tf} grid={grid}: {bad.size} differences, first at "
                f"{_hhmm(minutes[bad[0]])} ET: got {_hhmm(got_s[bad[0]])}-{_hhmm(got_e[bad[0]])} "
                f"want {_hhmm(ref_s[bad[0]])}-{_hhmm(ref_e[bad[0]])}")
            assert np.array_equal(B.bucket_starts(minutes, tf, grid, day), ref_s)
            compared += len(minutes)
    assert compared == len(minutes) * 10


@pytest.mark.parametrize("day", ["2026-11-13", "2026-11-27", "2026-11-01", "2026-03-08"])
def test_series_ids_map_to_the_right_grid(day):
    minutes = _day_minutes(day)
    for series, (tf, grid) in B.SERIES.items():
        ref_s, _ = _reference(minutes, tf, grid)
        assert np.array_equal(B.series_bucket_starts(minutes, series, day), ref_s), series
    assert B.SERIES["60"] == ("60", "rth") and B.SERIES["60e"] == ("60", "eth")
    # the two hourly grids really differ (a test that cannot tell them apart proves nothing)
    assert not np.array_equal(B.series_bucket_starts(minutes, "60", day),
                              B.series_bucket_starts(minutes, "60e", day))


@pytest.mark.parametrize("day", ["2026-11-13", "2026-11-01", "2026-03-08"])
def test_sub_hourly_grid_also_equals_the_legacy_bucket_start(day):
    """``bar_rollup.bucket_start`` (the older rollup helper) is the same epoch floor
    for 1/5/15/30. Its 60 branch delegates to ``bars_fetch`` -> ``tv_bucket_start(.., 'rth')``
    and is not imported here (``bars_fetch`` pulls the whole service in)."""
    minutes = _day_minutes(day)
    for tf in ("1", "5", "15", "30"):
        want = np.array([bar_rollup.bucket_start(int(t) * 1000, tf) // 1000 for t in minutes])
        for grid in GRIDS:
            assert np.array_equal(B.bucket_starts(minutes, tf, grid, day), want), (tf, grid)


def test_day_is_inferred_from_the_first_timestamp():
    minutes = _day_minutes("2026-11-27")
    assert np.array_equal(B.bucket_starts(minutes, "60", "rth"),
                          B.bucket_starts(minutes, "60", "rth", "2026-11-27"))


def test_seconds_inside_a_minute_floor_like_the_app():
    base = _day_minutes("2026-11-13")[9 * 60 + 29: 9 * 60 + 32]
    for extra in (1, 37, 59):
        ts = base + extra
        for tf in TFS:
            for grid in GRIDS:
                want = np.array([bar_rollup.tv_bucket_bounds(int(t) * 1000 + 999, tf, grid)[0] // 1000
                                 for t in ts])
                assert np.array_equal(B.bucket_starts(ts, tf, grid, "2026-11-13"), want)


def test_hand_written_60m_grids():
    """Independent of the app: the grid a reader expects, typed out."""
    def labels(day, series, lo=4 * 60, hi=20 * 60):
        minutes = _day_minutes(day)[lo:hi]
        return [_hhmm(t) for t in np.unique(B.series_bucket_starts(minutes, series, day))]

    assert labels("2026-11-13", "60") == [
        "04:00", "05:00", "06:00", "07:00", "08:00", "09:00",
        "09:30", "10:30", "11:30", "12:30", "13:30", "14:30", "15:30",
        "16:00", "17:00", "18:00", "19:00"]
    assert labels("2026-11-13", "60e") == [f"{h:02d}:00" for h in range(4, 20)]
    # 13:00 early close: the last RTH bar is 12:30, post-market is clock hours from 13:00
    assert labels("2026-11-27", "60") == [
        "04:00", "05:00", "06:00", "07:00", "08:00", "09:00",
        "09:30", "10:30", "11:30", "12:30",
        "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00"]
    assert labels("2026-11-27", "60e") == [f"{h:02d}:00" for h in range(4, 20)]

    m = _day_minutes("2026-11-13")
    s, e = B.bucket_bounds(m, "60", "rth", "2026-11-13")
    at = lambda hh, mm: hh * 60 + mm
    assert (_hhmm(s[at(9, 15)]), _hhmm(e[at(9, 15)])) == ("09:00", "09:30")     # pre-market stub
    assert (_hhmm(s[at(9, 30)]), _hhmm(e[at(9, 30)])) == ("09:30", "10:30")
    assert (_hhmm(s[at(15, 45)]), _hhmm(e[at(15, 45)])) == ("15:30", "16:00")   # half bar
    assert (_hhmm(s[at(16, 0)]), _hhmm(e[at(16, 0)])) == ("16:00", "17:00")
    se, ee = B.bucket_bounds(m, "60", "eth", "2026-11-13")
    assert (_hhmm(se[at(9, 45)]), _hhmm(ee[at(9, 45)])) == ("09:00", "10:00")   # spans the open
    assert e[at(23, 30)] == B.day_context(20261113).mid1                        # 24:00 = next midnight


def test_random_minutes_across_25_years():
    rng = random.Random(20261115)
    first = date(2003, 1, 1).toordinal()
    last = date(2030, 12, 31).toordinal()
    checked = 0
    for _ in range(400):
        d = date.fromordinal(rng.randint(first, last))
        ctx = B.day_context(B.to_ymd(d))
        n = (ctx.mid1 - ctx.mid0) // 60
        minutes = np.array(sorted(ctx.mid0 + 60 * rng.randrange(n) for _ in range(40)), dtype=np.int64)
        for grid in GRIDS:
            ref_s, ref_e = _reference(minutes, "60", grid)
            got_s, got_e = B.bucket_bounds(minutes, "60", grid, d)
            assert np.array_equal(got_s, ref_s) and np.array_equal(got_e, ref_e), (d, grid)
            checked += len(minutes)
    assert checked == 400 * 40 * 2


def test_early_close_copy_is_pinned_to_the_apps_calendar():
    """The copied set cannot drift silently: equal as a set, equal coverage window,
    and equal answer for every date across 32 years."""
    assert B.EARLY_CLOSE_YYYYMMDD == nyse_calendar.NYSE_EARLY_CLOSES_YYYYMMDD
    assert len(B.EARLY_CLOSE_YYYYMMDD) >= 63
    cal = session_calendar.calendar()
    assert B.CALENDAR_FROM_YYYYMMDD == nyse_calendar.NYSE_CALENDAR_FROM_YYYYMMDD
    assert B.CALENDAR_THROUGH_YYYYMMDD == B.to_ymd(cal.horizon)
    # every early close in the dataset is 13:00 (the module assumes one early-close minute)
    assert set(cal.early_closes.values()) == {B.EARLY_CLOSE_MIN}

    d, end, n, early = date(1999, 1, 1), date(2030, 12, 31), 0, 0
    while d <= end:
        ymd = B.to_ymd(d)
        assert B.rth_close_minute(ymd) == bar_rollup._rth_close_min(ymd), d
        early += B.rth_close_minute(ymd) == 780
        n += 1
        d += timedelta(days=1)
    assert n == 11688 and early == len(B.EARLY_CLOSE_YYYYMMDD)
    assert B.calendar_covers("2026-11-13") and not B.calendar_covers("2029-01-02")
    assert not B.calendar_covers("1999-12-31")


def test_rejects_bad_input_like_the_app():
    minutes = _day_minutes("2026-11-13")
    with pytest.raises(ValueError):
        B.bucket_starts(minutes, "2", "rth", "2026-11-13")
    with pytest.raises(ValueError):
        B.bucket_starts(minutes, "60", "pre", "2026-11-13")
    with pytest.raises(ValueError):
        B.series_bucket_starts(minutes, "60x", "2026-11-13")
    with pytest.raises(ValueError):          # a minute from the next ET day
        B.bucket_starts(np.append(minutes, minutes[-1] + 60), "60", "rth", "2026-11-13")
    with pytest.raises(ValueError):          # the whole array is another day
        B.bucket_starts(minutes, "60", "rth", "2026-11-12")
    assert B.bucket_starts(np.array([], dtype=np.int64), "60", "rth", "2026-11-13").size == 0
