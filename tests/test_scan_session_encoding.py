"""A bar's session, whichever encoding its timestamp arrived in.

─── 🔴 WHY THIS FILE EXISTS ─────────────────────────────────────────────────

`_normalize_bar_time` collapses ISO onto YYYYMMDD and passes a YYYYMMDD int and
an EPOCH int through verbatim — "already unambiguous", in its own words. That is
true of telling them apart and FALSE of comparing them, and
`_last_confirmed_index` compared them.

⛔⛔ SO ON AN INTRADAY TIMEFRAME EVERY SYMBOL DROPPED. A daily bar keys 20260730;
a five-minute bar inside that same session keys 1785439800. An epoch never equals
a YYYYMMDD, so the lookup returned `None` for every symbol, the caller filed
`stale-bars` for each, and the receipt would have read as a market-wide blackout
on a day when every bar was present and correct.

⭐ IT WAS RECORDED AND NOT FIXED. `_wrong_tf_reason`'s docstring names this as the
first of two correctness walls standing in front of intraday scanning, "both free
to find" — and the second (`live_bars_for` having no intraday forming bucket) is
still open. This closes the first; it does not open the gate.

⚠️ AND THE BOUNDARY IS BORROWED, NOT INVENTED. `scan_store._AS_OF_MIN/_MAX`
already bracket the YYYYMMDD range and its comment already names what lies
outside ("unix seconds, most likely"). A second threshold here would be a second
authority over one encoding question.
"""
from __future__ import annotations

import datetime
from zoneinfo import ZoneInfo

from api.services.screener import scan_evaluator as se
from api.services.screener import scan_store

_ET = ZoneInfo("America/New_York")


def _at(y, m, d, hh, mm) -> int:
    return int(datetime.datetime(y, m, d, hh, mm, tzinfo=_ET).timestamp())


SESSION = 2026_07_30


def test_an_intraday_session_is_found_at_all():
    """The defect itself: five-minute bars inside the run's own session."""
    bars = [{"t": _at(2026, 7, 30, h, m)} for h, m in
            ((9, 30), (9, 35), (9, 40), (15, 50), (15, 55))]
    assert se._last_confirmed_index(bars, SESSION) == 4, (
        "intraday bars inside the run's session were not found. Before the fix "
        "this returned None and every symbol dropped `stale-bars`.")


def test_the_daily_lane_is_untouched():
    """⛔ THE CONTROL. A fix that made intraday work by loosening the daily
    comparison would pass the case above and publish the wrong session here."""
    daily = [{"t": 2026_07_29}, {"t": SESSION}, {"t": 2026_07_31}]
    assert se._last_confirmed_index(daily, SESSION) == 1
    assert se._last_confirmed_index(daily, 2026_08_03) is None


def test_a_bar_from_the_NEXT_session_is_not_this_session():
    """Otherwise "the run's own session" would mean "the newest bar", which is
    the `-1` the function's own docstring rejects."""
    bars = [{"t": _at(2026, 7, 30, 15, 55)}, {"t": _at(2026, 7, 31, 9, 35)}]
    assert se._last_confirmed_index(bars, SESSION) == 0


def test_a_late_ET_bar_stays_in_ITS_OWN_session_not_the_UTC_one():
    """⭐⭐ THE TRAP THIS WOULD HAVE FALLEN INTO SILENTLY.

    20:30 ET on 30 July is 00:30 UTC on 31 July. Mapping the epoch in UTC would
    file the last hours of a New York afternoon under TOMORROW — every day, for
    every symbol — and the result looks like sparse data rather than a bug.
    """
    late = [{"t": _at(2026, 7, 30, 20, 30)}]
    assert datetime.datetime.fromtimestamp(late[0]["t"], tz=datetime.timezone.utc).day == 31, (
        "this fixture no longer straddles the UTC date line, so it cannot catch "
        "a UTC-vs-ET mapping — pick another hour")
    assert se._last_confirmed_index(late, SESSION) == 0
    assert se._last_confirmed_index(late, 2026_07_31) is None


def test_the_encoding_boundary_is_scan_stores_and_not_a_second_one():
    """⛔ Pins the BORROWING. If someone inlines a threshold here, the two can
    drift and a date near the boundary is classified two ways in one lane."""
    assert scan_store._AS_OF_MAX < 1_0000_0000 <= _at(2026, 7, 30, 9, 30)
    # a YYYYMMDD is read as itself…
    assert se._session_of_bar_time(2026_07_30) == SESSION
    # …and an epoch as the ET day it lands in.
    assert se._session_of_bar_time(_at(2026, 7, 30, 9, 30)) == SESSION
    # …and an ISO string, which `_normalize_bar_time` already owned.
    assert se._session_of_bar_time("2026-07-30") == SESSION
