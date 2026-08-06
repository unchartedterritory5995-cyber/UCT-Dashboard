"""day-metrics-batch endpoint — one request for a whole week's price/vol/mcap
(app/src/pages/calendar/useCalendarData.js `useWeekMetrics`), which feeds the
Calendar Feed's importance tiering AND the $1B+/$10B+/$100B+ filter chips.

Regression (found live via a paid-member browser walkthrough of /calendar):
`get_day_metrics`'s real Python parameter is `date_str` — `Query(None,
alias="date")` only aliases it for FastAPI's own query-string binding, it does
NOT change the parameter name for a direct Python call. `get_day_metrics_batch`
called it as `get_day_metrics(date=d)`, which raised
`TypeError: get_day_metrics() got an unexpected keyword argument 'date'` for
EVERY date, on EVERY request — the endpoint 500'd unconditionally and every
week's importance ranking + market-cap filter silently ran with zero data.
"""
from api.routers.calendar import get_day_metrics_batch

# Far outside `_WEEK_HORIZON_WEEKS` (52) in every direction, so `_days_for_date`
# returns None on the horizon guard alone — no cache/DB/network dependency,
# and it reaches the exact `get_day_metrics(date=d)` call site that raised.
_OUT_OF_RANGE_DATE = "2099-01-05"


def test_batch_does_not_raise_for_an_out_of_range_date():
    out = get_day_metrics_batch(dates=_OUT_OF_RANGE_DATE)
    assert out == {_OUT_OF_RANGE_DATE: {}}


def test_batch_multiple_dates_all_resolve_without_raising():
    out = get_day_metrics_batch(dates=f"{_OUT_OF_RANGE_DATE},2099-01-06")
    assert set(out.keys()) == {_OUT_OF_RANGE_DATE, "2099-01-06"}
    assert out[_OUT_OF_RANGE_DATE] == {}
    assert out["2099-01-06"] == {}


def test_batch_empty_input():
    assert get_day_metrics_batch(dates=None) == {}
    assert get_day_metrics_batch(dates="") == {}
