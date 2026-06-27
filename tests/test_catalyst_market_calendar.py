"""Open-market-days-only guard for the catalyst engine / Hunter."""
import datetime as dt
from zoneinfo import ZoneInfo

from api.services.catalyst.engine import _market_closed_today

_ET = ZoneInfo("America/New_York")


def test_weekend_is_closed():
    sat = dt.datetime(2026, 6, 27, 8, 0, tzinfo=_ET)   # Saturday
    closed, why = _market_closed_today(sat)
    assert closed and why == "weekend"


def test_nyse_holiday_weekday_is_closed():
    # 2026-11-26 = Thanksgiving (Thursday) — a weekday NYSE full closure.
    thanksgiving = dt.datetime(2026, 11, 26, 8, 0, tzinfo=_ET)
    closed, why = _market_closed_today(thanksgiving)
    assert closed and why == "market holiday"


def test_normal_weekday_is_open():
    wed = dt.datetime(2026, 11, 25, 8, 0, tzinfo=_ET)   # Wed before Thanksgiving
    closed, why = _market_closed_today(wed)
    assert closed is False and why == ""
