"""Regression tests for data-dependability C23:
`api/services/stock_brief/service.py` `_compute_stats` and `_earnings` each
cached their all-None/empty default at the same TTL as a real result on any
`except -> pass`.
"""
import time
from unittest import mock

from api.services.stock_brief import service as sb
from api.services.cache import cache


def _ttl_remaining(key: str) -> float:
    _, expires_at = cache._store[key]
    return expires_at - time.time()


class TestComputeStatsCacheGate:
    def setup_method(self):
        cache.invalidate("brief_stats_TEST")

    def test_bars_fetch_failure_gets_short_ttl(self):
        with mock.patch.object(sb, "_year_bars", side_effect=RuntimeError("bars down")):
            stats = sb._compute_stats("TEST")

        assert stats["ytd_gain_pct"] is None
        assert _ttl_remaining("brief_stats_TEST") <= sb._STATS_FAIL_TTL + 2
        assert _ttl_remaining("brief_stats_TEST") < sb._STATS_TTL

    def test_empty_bars_gets_short_ttl(self):
        with mock.patch.object(sb, "_year_bars", return_value=[]):
            sb._compute_stats("TEST")
        assert _ttl_remaining("brief_stats_TEST") <= sb._STATS_FAIL_TTL + 2

    def test_real_bars_get_the_full_ttl(self):
        bars = [
            {"o": 100.0, "c": 105.0, "l": 95.0, "h": 110.0, "v": 1_000_000},
            {"o": 105.0, "c": 120.0, "l": 100.0, "h": 125.0, "v": 2_000_000},
        ]
        with mock.patch.object(sb, "_year_bars", return_value=bars):
            stats = sb._compute_stats("TEST")

        assert stats["ytd_gain_pct"] == 20.0
        assert _ttl_remaining("brief_stats_TEST") > sb._STATS_TTL - 2


class TestEarningsCacheGate:
    def setup_method(self):
        cache.invalidate("brief_earn_TEST")

    def test_get_chart_markers_raising_gets_short_ttl(self):
        with mock.patch(
            "api.services.earnings_estimates.get_chart_markers",
            side_effect=RuntimeError("provider down"),
        ):
            rows = sb._earnings("TEST")

        assert rows == []
        assert _ttl_remaining("brief_earn_TEST") <= sb._EARN_FAIL_TTL + 2
        assert _ttl_remaining("brief_earn_TEST") < sb._EARN_TTL

    def test_successful_call_with_no_reported_quarters_gets_the_full_ttl(self):
        """Control: a young stock with <4 reported quarters is a legitimate
        empty result (the call itself succeeded) -- must NOT get the short
        retry TTL, or a fresh IPO would refetch constantly."""
        with mock.patch(
            "api.services.earnings_estimates.get_chart_markers",
            return_value={"earnings": []},
        ):
            rows = sb._earnings("TEST")

        assert rows == []
        assert _ttl_remaining("brief_earn_TEST") > sb._EARN_TTL - 2

    def test_successful_call_with_data_gets_the_full_ttl(self):
        with mock.patch(
            "api.services.earnings_estimates.get_chart_markers",
            return_value={"earnings": [
                {"date": "2026-05-01", "eps_actual": 1.5, "eps_surprise_pct": 5.0,
                 "revenue_actual": 1000, "revenue_surprise_pct": 2.0,
                 "fiscal_quarter": 1, "fiscal_year": 2026},
            ]},
        ):
            rows = sb._earnings("TEST")

        assert len(rows) == 1
        assert _ttl_remaining("brief_earn_TEST") > sb._EARN_TTL - 2
