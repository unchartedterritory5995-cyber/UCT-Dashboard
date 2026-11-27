"""An intraday row exists only inside its ET day's extended session (2026-11-25, the TradingView 4h diff of #2753).

TradingView's extended-hours bars cover 04:00 to 20:00 ET (17:00 on a half day). The store held 60m eth rows stamped
20:00 ET (prints at or after the session's end), which drew an extra hour and an extra 20:00 4h bar. The clamp sits in
`bars_fetch._fmt_sqlite_bars`, the chokepoint every stored answer flows through.
"""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from api.services import bars_fetch

_ET = ZoneInfo("America/New_York")


def _t(y, mo, d, h, mi) -> int:
    return int(datetime(y, mo, d, h, mi, tzinfo=_ET).timestamp())


def _row(t, p=10.0):
    return (t, p, p + 0.1, p - 0.1, p + 0.05, 100)


def _served(tf, ts, ticker="SPY"):
    return [b["t"] for b in bars_fetch._fmt_sqlite_bars([_row(t) for t in ts], tf, ticker)]


def test_a_row_at_or_after_20_00_et_is_not_served():
    day = (2026, 11, 11)                                   # a Wednesday, a full session
    ts = [_t(*day, 3, 45), _t(*day, 4, 0), _t(*day, 9, 30), _t(*day, 19, 45), _t(*day, 20, 0), _t(*day, 20, 15)]
    assert _served("15", ts) == [_t(*day, 4, 0), _t(*day, 9, 30), _t(*day, 19, 45)]


def test_the_60m_eth_hour_stamped_20_00_is_not_served():
    day = (2026, 11, 11)
    ts = [_t(*day, 4, 0), _t(*day, 19, 0), _t(*day, 20, 0)]
    assert _served("60", ts) == [_t(*day, 4, 0), _t(*day, 19, 0)]


def test_the_half_day_session_ends_at_17_00():
    day = (2026, 11, 27)                                   # the day after Thanksgiving: the regular close is 13:00
    ts = [_t(*day, 12, 45), _t(*day, 16, 45), _t(*day, 17, 0)]
    assert _served("15", ts) == [_t(*day, 12, 45), _t(*day, 16, 45)]


def test_a_row_on_a_non_trading_day_is_not_served_and_the_next_day_is():
    ts = [_t(2026, 11, 14, 10, 0), _t(2026, 11, 26, 10, 0), _t(2026, 11, 16, 10, 0)]   # a Saturday, Thanksgiving, a Monday
    assert _served("5", ts) == [_t(2026, 11, 16, 10, 0)]


def test_dst_days_keep_their_own_session():
    # 2026-03-09 (the Monday after the spring change) and 2026-11-02 (after the fall change)
    for day in ((2026, 3, 9), (2026, 11, 2)):
        ts = [_t(*day, 4, 0), _t(*day, 19, 59), _t(*day, 20, 0)]
        assert _served("1", ts) == [_t(*day, 4, 0), _t(*day, 19, 59)], day


def test_daily_and_breadth_series_are_untouched():
    assert [b["t"] for b in bars_fetch._fmt_sqlite_bars([_row(20261113)], "D", "SPY")] == ["2026-11-13"]
    ts = [_t(2026, 11, 11, 20, 0)]
    from api.services.breadth_symbols import is_breadth_symbol
    breadth = next((s for s in ("UCTA50", "UCTNH", "MMTW") if is_breadth_symbol(s)), None)
    if breadth:
        assert _served("15", ts, breadth) == ts, "a breadth pseudo-ticker is not an exchange session"


def test_a_24_hour_name_keeps_its_night_and_weekend_rows():
    ts = [_t(2026, 11, 11, 2, 0), _t(2026, 11, 11, 21, 0), _t(2026, 11, 14, 10, 0)]   # 02:00, 21:00, a Saturday
    assert _served("60", ts, "BTC-USD") == ts
