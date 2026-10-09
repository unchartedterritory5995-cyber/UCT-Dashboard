"""Wave 4: a closed-market `/api/live-prices` row says WHEN its close happened.

The terminal's security headline could only say "at last close" on a weekend because the
closed-market fallback row (`_last_session_row`) carries `observed_at: None` by design
(Seam 8: observed_at is a vendor observation, never a derived time -- see
test_live_prices_observed_at.py, which still pins that). The row now carries an ADDITIVE
`session_close_at`: epoch seconds of the regular close of the session its price IS, taken
from the one session authority (session_calendar.close_time, so a half-day is 13:00), and
only when the settled grouped map agrees with the snapshot's prevDay (the same proof the %
change already needs). Otherwise it is None -- never a guess.
"""
from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from api.routers import live_prices as lp
from tests.test_live_prices_market_closed import _AAPL_FRIDAY, _ClosedClient, _closed_ticker

ET = ZoneInfo("America/New_York")


@pytest.fixture
def closes(monkeypatch):
    last: dict[str, float] = {}
    prior: dict[str, float] = {}
    monkeypatch.setattr(lp, "_session_closes", lambda: (last, prior))
    return last, prior


def _row(monkeypatch, day):
    monkeypatch.setattr(lp, "_session_closes_day", day)
    out = lp._fetch_snapshots(
        _ClosedClient(_closed_ticker("AAPL", _AAPL_FRIDAY)), ["AAPL"], "post_market")
    return out["AAPL"]


def test_a_proven_close_carries_its_4pm_et_timestamp(closes, monkeypatch):
    last, prior = closes
    last["AAPL"], prior["AAPL"] = 333.02, 321.66
    row = _row(monkeypatch, date(2026, 7, 24))
    assert row["market_closed"] is True
    assert row["session_close_at"] == int(datetime(2026, 7, 24, 16, 0, tzinfo=ET).timestamp())
    assert row["observed_at"] is None          # Seam 8 meaning unchanged


def test_a_half_day_close_is_1pm_et(closes, monkeypatch):
    last, prior = closes
    last["AAPL"], prior["AAPL"] = 333.02, 321.66
    row = _row(monkeypatch, date(2026, 11, 27))
    assert row["session_close_at"] == int(datetime(2026, 11, 27, 13, 0, tzinfo=ET).timestamp())


def test_no_timestamp_when_the_settled_close_disagrees(closes, monkeypatch):
    last, prior = closes
    last["AAPL"], prior["AAPL"] = 324.20, 318.00   # an older session
    row = _row(monkeypatch, date(2026, 7, 24))
    assert row["session_close_at"] is None


def test_no_timestamp_while_the_maps_are_still_warming(closes, monkeypatch):
    row = _row(monkeypatch, None)
    assert row["session_close_at"] is None


def test_the_dated_build_records_the_first_session_it_found(monkeypatch):
    days_with_data = {date(2026, 7, 24): {"AAPL": 333.02}, date(2026, 7, 23): {"AAPL": 321.66}}
    monkeypatch.setattr(lp, "_get_client", lambda: object())
    monkeypatch.setattr(lp, "_grouped_closes", lambda client, day: days_with_data.get(day, {}))

    class _Now(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 7, 26, 12, 0, tzinfo=ET)   # a Sunday

    monkeypatch.setattr(lp, "datetime", _Now)
    last, prior, day = lp._build_session_closes_dated()
    assert day == date(2026, 7, 24)
    assert last == {"AAPL": 333.02} and prior == {"AAPL": 321.66}
    assert lp._build_session_closes() == (last, prior)   # the old shape is unchanged
