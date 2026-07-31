"""The ET session date a print belongs to.

This is the wire's PRIMARY KEY and (Phase 3) its alert-dedup key. `date.today()`
is wrong here — the box runs Central, and a 16:05 ET print must land on the ET
session regardless of host timezone.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

from api.services.wire.session import market_session_date

ET = ZoneInfo("America/New_York")


def test_amc_print_belongs_to_that_weekday():
    """16:05 ET Friday is Friday's AMC session."""
    assert market_session_date(datetime(2026, 7, 31, 16, 5, tzinfo=ET)) == "2026-07-31"


def test_bmo_print_belongs_to_its_own_day():
    """06:30 ET Monday is Monday's BMO session, not Friday's."""
    assert market_session_date(datetime(2026, 8, 3, 6, 30, tzinfo=ET)) == "2026-08-03"


def test_weekend_resolves_back_to_the_last_weekday():
    """Opening the wire on Saturday shows Friday's session, not an empty Saturday."""
    assert market_session_date(datetime(2026, 8, 1, 11, 0, tzinfo=ET)) == "2026-07-31"
    assert market_session_date(datetime(2026, 8, 2, 11, 0, tzinfo=ET)) == "2026-07-31"


def test_naive_datetime_is_treated_as_ET_not_UTC():
    """A naive datetime must not silently shift the session by the UTC offset."""
    assert market_session_date(datetime(2026, 7, 31, 16, 5)) == "2026-07-31"


def test_a_utc_instant_is_converted_not_truncated():
    """21:05 UTC on 7/31 is 17:05 ET the SAME day — must not roll to 8/1."""
    assert market_session_date(
        datetime(2026, 7, 31, 21, 5, tzinfo=ZoneInfo("UTC"))) == "2026-07-31"
    # 01:30 UTC on 8/1 is 21:30 ET on 7/31 — must roll BACK a day.
    assert market_session_date(
        datetime(2026, 8, 1, 1, 30, tzinfo=ZoneInfo("UTC"))) == "2026-07-31"
