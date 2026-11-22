"""Extended session on its own (owner 11-14, the Watchlist's RTH · EXT switch).

EXT mode shows ONLY the current extended session: pre-market 04:00-09:30 ET or
after-hours 16:00-20:00 ET, fresh each session. These rails pin the three pieces the
additive live-price fields are built from: when a session starts, whether an ext print
belongs to it, and the session-only volume split.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

import api.routers.live_prices as lp

ET = ZoneInfo("America/New_York")


def _et(y, mo, d, h, mi=0):
    return datetime(y, mo, d, h, mi, tzinfo=ET)


# 2026-11-13 is a Friday.
def test_pre_market_starts_at_four_today():
    start = lp._ext_session_start("pre_market", _et(2026, 11, 12, 6, 30))
    assert start == _et(2026, 11, 12, 4).timestamp()


def test_after_hours_starts_at_four_pm_today_after_the_bell():
    start = lp._ext_session_start("post_market", _et(2026, 11, 12, 17, 5))
    assert start == _et(2026, 11, 12, 16).timestamp()


def test_overnight_after_hours_belongs_to_the_previous_weekday():
    start = lp._ext_session_start("post_market", _et(2026, 11, 13, 2, 0))   # Fri 2am
    assert start == _et(2026, 11, 12, 16).timestamp()                       # Thu 4pm


def test_weekend_after_hours_is_fridays():
    start = lp._ext_session_start("post_market", _et(2026, 11, 15, 12, 0))  # Sunday
    assert start == _et(2026, 11, 13, 16).timestamp()                       # Fri 4pm


def test_regular_session_has_no_extended_start():
    assert lp._ext_session_start("regular", _et(2026, 11, 12, 11, 0)) is None


def test_last_nights_after_hours_print_is_not_a_fresh_pre_market_print():
    start = _et(2026, 11, 12, 4).timestamp()
    stale_ns = int(_et(2026, 11, 11, 19, 58).timestamp() * 1e9)
    assert lp._ext_price_fresh(101.5, {"p": 101.5, "t": stale_ns}, {}, start) is False
    fresh_ns = int(_et(2026, 11, 12, 4, 12).timestamp() * 1e9)
    assert lp._ext_price_fresh(101.7, {"p": 101.7, "t": fresh_ns}, {}, start) is True


def test_minute_close_freshness_uses_the_minute_time():
    start = _et(2026, 11, 12, 16).timestamp()
    m_ms = int(_et(2026, 11, 12, 16, 3).timestamp() * 1e3)
    # lastTrade pinned to the 4pm close (stale) → the price came from min.c, judged by min.t
    assert lp._ext_price_fresh(50.25, {"p": 50.0, "t": 1}, {"c": 50.25, "t": m_ms}, start) is True
    before_ms = int(_et(2026, 11, 12, 15, 59).timestamp() * 1e3)
    assert lp._ext_price_fresh(50.25, {"p": 50.0, "t": 1}, {"c": 50.25, "t": before_ms}, start) is False


def test_session_volume_splits_at_nine_thirty_and_four():
    def bar(h, mi, v):
        return {"t": int(_et(2026, 11, 12, h, mi).timestamp() * 1e3), "v": v}
    bars = [bar(4, 0, 10), bar(9, 0, 20), bar(9, 30, 1000), bar(15, 30, 500), bar(16, 0, 7), bar(19, 30, 3)]
    assert lp._split_session_volume(bars) == (30, 10)


def test_session_volume_is_served_only_for_its_own_day_and_session():
    lp._EXSESS_LAST["ZZZ"] = (20261112, 30, 10)
    try:
        assert lp._ext_session_volume("ZZZ", "pre_market", 20261112) == 30
        assert lp._ext_session_volume("ZZZ", "post_market", 20261112) == 10
        assert lp._ext_session_volume("ZZZ", "regular", 20261112) is None
        assert lp._ext_session_volume("ZZZ", "post_market", 20261113) is None   # yesterday's split
    finally:
        lp._EXSESS_LAST.pop("ZZZ", None)
