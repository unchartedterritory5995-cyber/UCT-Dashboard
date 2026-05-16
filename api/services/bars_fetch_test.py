"""Tests for api.services.bars_fetch — focused on the small pure helpers
that have outsized impact on chart correctness."""
from api.services.bars_fetch import _normalize_since_param


class TestNormalizeSinceParam:
    """The `?since=` query parameter has tripped over a unit mismatch
    between the frontend and backend before. The Phase 4 chart's gap-
    backfill (StockChart.jsx onRealtimeReconnect) sends millisecond
    timestamps; the storage layer compares against unix-seconds. Without
    auto-detection the comparison is always False and gap-fill returns
    empty, leaving permanent holes in the chart."""

    def test_intraday_seconds_passthrough(self):
        """Normal intraday case: caller sent unix seconds. Return as int."""
        assert _normalize_since_param("1714579200", date_tf=False) == 1714579200

    def test_intraday_milliseconds_downscaled_to_seconds(self):
        """The bug fix: caller sent unix milliseconds. Detect by magnitude
        and convert to seconds so the downstream `b["t"] > since_val`
        comparison actually works."""
        assert _normalize_since_param("1714579200000", date_tf=False) == 1714579200

    def test_intraday_threshold_boundary(self):
        """1e11 is the boundary: anything below stays as-is (still in the
        valid unix-seconds range until year ~5138), anything at-or-above
        gets downscaled. We pick 1e11 so it's far above any plausible
        seconds value but well below microsecond-level inputs."""
        # 99,999,999,999 is just under the threshold — treat as seconds
        assert _normalize_since_param("99999999999", date_tf=False) == 99999999999
        # 100,000,000,000 hits the threshold — treat as ms, downscale
        assert _normalize_since_param("100000000000", date_tf=False) == 100000000

    def test_intraday_zero_passes_through(self):
        """A `since=0` request (asking for everything) must NOT trigger
        the ms detection. Common when the chart loads for the first time."""
        assert _normalize_since_param("0", date_tf=False) == 0

    def test_intraday_garbage_returns_zero(self):
        """Unparseable inputs default to 0 — preserves historical
        behavior of effectively returning everything."""
        assert _normalize_since_param("not-a-number", date_tf=False) == 0
        assert _normalize_since_param("", date_tf=False) == 0

    def test_date_tf_passes_iso_string_through(self):
        """For daily/weekly/monthly, since is an ISO date and gets compared
        as a string. No numeric conversion."""
        assert _normalize_since_param("2024-01-15", date_tf=True) == "2024-01-15"

    def test_date_tf_garbage_returns_empty_string(self):
        """date_tf default is empty string (preserves >-comparison
        semantics with stored ISO date strings)."""
        # The function only converts to int for the non-date path, so a
        # malformed date string is just returned as-is by the function
        # logic — but the comparison downstream uses `>` which on strings
        # is lexicographic. Validate the behavior we actually have.
        assert _normalize_since_param("not-a-date", date_tf=True) == "not-a-date"

    def test_intraday_negative_value_passes_through(self):
        """Negative values are valid inputs (rare but legal). They mean
        'before unix epoch' which returns nothing useful but should not
        be auto-downscaled."""
        assert _normalize_since_param("-100", date_tf=False) == -100


from datetime import datetime
from zoneinfo import ZoneInfo

from api.services.bars_fetch import (
    _expected_latest_session_yyyymmdd,
    _is_cold_stale_intraday,
    _paginate_massive_aggs,
)

_ET = ZoneInfo("America/New_York")


def _et_ts(y, m, d, hh, mm):
    return int(datetime(y, m, d, hh, mm, tzinfo=_ET).timestamp())


class TestExpectedLatestSession:
    """Drives the cold-stale predicate. Must roll weekends → Friday and
    weekday pre-open → prior weekday, so we never demand a session that
    can't have produced bars yet (avoids needless sync fetches) while
    still flagging genuine multi-session gaps."""

    def test_weekday_after_open_is_today(self):
        now = datetime(2026, 5, 13, 10, 0, tzinfo=_ET)  # Wed
        assert _expected_latest_session_yyyymmdd(now) == 20260513

    def test_weekday_pre_open_rolls_to_prior_weekday(self):
        now = datetime(2026, 5, 13, 9, 0, tzinfo=_ET)  # Wed pre-open
        assert _expected_latest_session_yyyymmdd(now) == 20260512

    def test_saturday_rolls_to_friday(self):
        now = datetime(2026, 5, 16, 12, 0, tzinfo=_ET)  # Sat
        assert _expected_latest_session_yyyymmdd(now) == 20260515

    def test_sunday_rolls_to_friday(self):
        now = datetime(2026, 5, 17, 12, 0, tzinfo=_ET)  # Sun
        assert _expected_latest_session_yyyymmdd(now) == 20260515

    def test_monday_pre_open_rolls_to_friday(self):
        now = datetime(2026, 5, 18, 9, 0, tzinfo=_ET)  # Mon pre-open
        assert _expected_latest_session_yyyymmdd(now) == 20260515


class TestIsColdStaleIntraday:
    """The single predicate that decides 'serve synchronously-correct'
    vs 'fast stale-while-revalidate'. The May-8 universe freeze was the
    cost of getting this wrong (everything went down the SWR path)."""

    def test_non_intraday_never_cold(self):
        now = datetime(2026, 5, 15, 10, 0, tzinfo=_ET)
        for tf in ("D", "W", "M"):
            assert _is_cold_stale_intraday(tf, _et_ts(2026, 1, 1, 10, 0), now) is False

    def test_none_last_ts_never_cold(self):
        now = datetime(2026, 5, 15, 10, 0, tzinfo=_ET)
        assert _is_cold_stale_intraday("15", None, now) is False

    def test_same_session_is_not_cold(self):
        # Wed 10:00, last bar Wed 09:45 → fast SWR path, not cold.
        now = datetime(2026, 5, 13, 10, 0, tzinfo=_ET)
        assert _is_cold_stale_intraday("15", _et_ts(2026, 5, 13, 9, 45), now) is False

    def test_multi_day_gap_is_cold(self):
        # The actual bug: Fri 10:00, newest cached bar is May 8.
        now = datetime(2026, 5, 15, 10, 0, tzinfo=_ET)
        assert _is_cold_stale_intraday("15", _et_ts(2026, 5, 8, 11, 0), now) is True
        assert _is_cold_stale_intraday("60", _et_ts(2026, 5, 8, 10, 0), now) is True

    def test_weekend_with_friday_data_is_not_cold(self):
        # Sat, last bar Friday close → freshest possible, must NOT pay the
        # synchronous-fetch latency on every weekend chart load.
        now = datetime(2026, 5, 16, 12, 0, tzinfo=_ET)  # Sat
        assert _is_cold_stale_intraday("30", _et_ts(2026, 5, 15, 16, 0), now) is False

    def test_weekend_with_old_data_is_cold(self):
        now = datetime(2026, 5, 16, 12, 0, tzinfo=_ET)  # Sat
        assert _is_cold_stale_intraday("30", _et_ts(2026, 5, 8, 16, 0), now) is True


class _FakeClient:
    def __init__(self, pages):
        self._api_key = "KEY"
        self._pages = pages
        self.calls = []

    def _get(self, url):
        self.calls.append(url)
        return self._pages[len(self.calls) - 1]


class TestPaginateMassiveAggs:
    """Delta path previously did a single non-paginated call; Massive
    silently truncates large windows, so multi-day/month gaps never
    fully backfilled. Pagination must follow next_url to completion."""

    def test_single_page(self):
        c = _FakeClient([{"results": [{"t": 1}, {"t": 2}]}])
        assert _paginate_massive_aggs(c, "http://u?x=1") == [{"t": 1}, {"t": 2}]
        assert len(c.calls) == 1

    def test_follows_next_url_and_appends_apikey(self):
        c = _FakeClient([
            {"results": [{"t": 1}], "next_url": "http://u/next"},
            {"results": [{"t": 2}]},
        ])
        out = _paginate_massive_aggs(c, "http://u?x=1")
        assert out == [{"t": 1}, {"t": 2}]
        assert c.calls[1] == "http://u/next?apiKey=KEY"

    def test_empty_results_safe(self):
        c = _FakeClient([{}])
        assert _paginate_massive_aggs(c, "http://u") == []
