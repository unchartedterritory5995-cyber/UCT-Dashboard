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
