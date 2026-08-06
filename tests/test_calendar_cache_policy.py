"""Regression tests for the remaining data-dependability Phase 4 cache-poison
sweep sites in api/routers/calendar.py: C8 (day-metrics), C12 (calendar_weekly
raw-cache write bypassing `_weekly_payload_is_good`), C16 (enrichment with_em
collapse), and C27 (most-anticipated PNG).
"""
import time
from datetime import date, timedelta
from unittest import mock

import pytest

from api.routers import calendar as cal


def _ttl_remaining(key: str) -> float:
    _, expires_at = cal.cache._store[key]
    return expires_at - time.time()


# ── C12: calendar_weekly raw write must not outrun `_weekly_payload_is_good` ─

class TestWeeklyRawCacheGoodness:
    def setup_method(self):
        cal.cache.invalidate("calendar_weekly")

    def test_bad_build_gets_short_ttl_not_full_success_ttl(self, monkeypatch):
        """`_WEEKLY_STALE.serve()` checks the raw `calendar_weekly` TTL cache
        (`fresh()`) BEFORE ever consulting the last-known-good stale slot. An
        unconditional write there let a zero-reporter rebuild win over a real
        prior week for the full 10-min TTL, even though `_weekly_payload_is_
        good` exists specifically to keep a bad build out of the stale slot.
        """
        monkeypatch.setattr("api.services.engine._load_wire_data", lambda: None)
        monkeypatch.setattr(cal, "_build_live", mock.Mock(side_effect=RuntimeError("EW down")))
        monkeypatch.setattr(cal, "_backfill_past_days", lambda *a, **kw: None)
        monkeypatch.setattr(cal, "_patch_today_actuals", lambda *a, **kw: None)
        monkeypatch.setattr(cal, "_merge_sticky_actuals", lambda *a, **kw: None)
        monkeypatch.setattr(cal, "_curate_econ_events", lambda *a, **kw: None)
        monkeypatch.setattr(cal, "_attach_names", lambda *a, **kw: None)
        monkeypatch.setattr(cal, "_attach_date_moves", lambda *a, **kw: None)

        result = cal._build_current_week()

        assert cal._weekly_payload_is_good(result) is False
        assert _ttl_remaining("calendar_weekly") <= cal._CACHE_FAIL_TTL + 5
        assert _ttl_remaining("calendar_weekly") < cal._CACHE_TTL

    def test_good_build_still_gets_the_full_success_ttl(self, monkeypatch):
        """Control: a real week with reporters must still get the normal
        10-min TTL -- this predicate must not blanket-shorten everything."""
        today = cal._today_et()
        week_dates = cal._week_dates()

        def _fake_live(_wd, _today):
            return {
                d.strftime("%Y-%m-%d"): {"bmo": [{"sym": "AAPL"}] if i == 0 else [],
                                          "amc": [], "tbd": [], "econ": []}
                for i, d in enumerate(week_dates)
            }

        monkeypatch.setattr("api.services.engine._load_wire_data", lambda: None)
        monkeypatch.setattr(cal, "_build_live", _fake_live)
        monkeypatch.setattr(cal, "_backfill_past_days", lambda *a, **kw: None)
        monkeypatch.setattr(cal, "_patch_today_actuals", lambda *a, **kw: None)
        monkeypatch.setattr(cal, "_merge_sticky_actuals", lambda *a, **kw: None)
        monkeypatch.setattr(cal, "_curate_econ_events", lambda *a, **kw: None)
        monkeypatch.setattr(cal, "_attach_names", lambda *a, **kw: None)
        monkeypatch.setattr(cal, "_attach_date_moves", lambda *a, **kw: None)

        result = cal._build_current_week()

        assert cal._weekly_payload_is_good(result) is True
        assert _ttl_remaining("calendar_weekly") > cal._CACHE_TTL - 5


# ── C8: day-metrics — a total Finviz+Massive miss must not get the 24h TTL ──

class TestDayMetricsProviderMiss:
    def setup_method(self):
        cal.cache.invalidate("calendar_metrics_2026-07-20")

    def _mock_day(self, sym="AAPL"):
        return {"sym": sym}

    def test_both_providers_empty_handed_gets_short_ttl(self, monkeypatch):
        """FINVIZ_API_KEY unset (fv_ok always False) AND the Massive fallback
        also empty-handed is a total provider miss for a PAST date -- must not
        get the 24h TTL (blank price/avg-vol/mcap all day, and the vol/price/
        mcap filters silently exclude everything)."""
        past_date = "2026-07-20"
        monkeypatch.delenv("FINVIZ_API_KEY", raising=False)
        monkeypatch.delenv("FINVIZ_TOKEN", raising=False)
        monkeypatch.setattr(cal, "_days_for_date", lambda d: {"fake": "day"})
        monkeypatch.setattr(cal, "_day_entries", lambda day: [self._mock_day()])

        class _FakeClient:
            def get_batch_rich_snapshots(self, syms):
                return {}  # Massive also comes back empty

        monkeypatch.setattr("api.services.massive._get_client", lambda: _FakeClient())

        result = cal.get_day_metrics(date_str=past_date)

        assert result["AAPL"]["price"] is None
        key = f"calendar_metrics_{past_date}"
        assert _ttl_remaining(key) <= cal._METRICS_FAIL_TTL + 5
        assert _ttl_remaining(key) < 24 * 3600

    def test_massive_fallback_success_gets_the_normal_ttl(self, monkeypatch):
        """Control: when the Massive fallback DOES answer, the normal
        (longer, date-tiered) TTL still applies."""
        past_date = "2026-07-20"
        monkeypatch.delenv("FINVIZ_API_KEY", raising=False)
        monkeypatch.delenv("FINVIZ_TOKEN", raising=False)
        monkeypatch.setattr(cal, "_days_for_date", lambda d: {"fake": "day"})
        monkeypatch.setattr(cal, "_day_entries", lambda day: [self._mock_day()])

        class _FakeClient:
            def get_batch_rich_snapshots(self, syms):
                return {"AAPL": {"price": 210.5, "vol": 1_000_000}}

        monkeypatch.setattr("api.services.massive._get_client", lambda: _FakeClient())

        result = cal.get_day_metrics(date_str=past_date)

        assert result["AAPL"]["price"] == 210.5
        key = f"calendar_metrics_{past_date}"
        assert _ttl_remaining(key) > cal._METRICS_FAIL_TTL


# ── C16: enrichment with_em collapse must be flagged for a non-past date ────

class TestEnrichmentEmCollapse:
    def setup_method(self):
        pass

    def test_future_date_em_collapse_forces_short_ttl(self, monkeypatch):
        """A universe-wide yfinance option-chain outage collapses with_em to
        0 without moving the Finnhub denial counter (expected_move comes from
        yfinance, not Finnhub) -- must still force the short retry TTL."""
        target = (cal._today_et() + timedelta(days=1)).isoformat()
        ck = f"calendar_enrichment_{target}"
        cal.cache.invalidate(ck)

        monkeypatch.setattr(cal, "_days_for_date", lambda d: {"fake": "day"})
        monkeypatch.setattr(cal, "_day_entries", lambda day: [{"sym": "AAPL"}, {"sym": "MSFT"}])
        monkeypatch.setattr(cal, "_ENRICH_WINDOW_DAYS", 30)

        with mock.patch("api.services.earnings_enrichment.get_implied_move", return_value=None), \
             mock.patch("api.services.earnings_enrichment.get_historical_earnings_moves",
                       return_value=None), \
             mock.patch("api.services.earnings_estimates.get_earnings_intel", return_value=None), \
             mock.patch("api.services.earnings_estimates.fh_budget_denied_total", return_value=0):
            out = cal._build_enrichment_for_date(target)

        assert all(v.get("expected_move") is None for v in out.values())
        assert cal._ENRICH_STATS[target]["em_collapsed"] is True
        assert _ttl_remaining(ck) <= cal._ENRICH_TTL + 5
        assert _ttl_remaining(ck) < cal._ENRICH_TTL_FUTURE_WEEK

    def test_past_date_zero_em_is_not_flagged_as_collapse(self, monkeypatch):
        """Control: `expected_move` is BY DESIGN skipped for past dates
        (confident-garbage guard) -- with_em==0 there must NOT trip the new
        collapse flag, or every past day would falsely retry constantly."""
        target = (cal._today_et() - timedelta(days=3)).isoformat()
        # Land on a weekday to avoid the market-holiday/weekend edge.
        while date.fromisoformat(target).weekday() >= 5:
            target = (date.fromisoformat(target) - timedelta(days=1)).isoformat()
        ck = f"calendar_enrichment_{target}"
        cal.cache.invalidate(ck)

        monkeypatch.setattr(cal, "_days_for_date", lambda d: {"fake": "day"})
        monkeypatch.setattr(cal, "_day_entries", lambda day: [{"sym": "AAPL"}])
        monkeypatch.setattr(cal, "_ENRICH_WINDOW_DAYS", 30)

        with mock.patch("api.services.earnings_enrichment.get_implied_move", return_value=None), \
             mock.patch("api.services.earnings_enrichment.get_historical_earnings_moves",
                       return_value=None), \
             mock.patch("api.services.earnings_estimates.get_earnings_intel", return_value=None), \
             mock.patch("api.services.earnings_estimates.fh_budget_denied_total", return_value=0):
            cal._build_enrichment_for_date(target)

        assert cal._ENRICH_STATS[target]["em_collapsed"] is False
        assert _ttl_remaining(ck) > cal._ENRICH_TTL + 5  # the normal (longer) past-date TTL


# ── C27: most-anticipated PNG — an empty ranked list must not be pinned ─────

class TestAnticipatedPngEmptyRanked:
    def setup_method(self):
        cal.cache.invalidate("calendar_anticipated_png_2026-07-27")

    def test_empty_ranked_gets_short_ttl(self, monkeypatch):
        """An empty `ranked` list means the underlying get_calendar() build
        failed/came back empty -- a trading week with zero reporters doesn't
        happen. Must not get pinned for 1800s (or 6h for a past week)."""
        monday = date(2026, 7, 27)
        monkeypatch.setattr(cal, "_monday_of", lambda d: monday)
        monkeypatch.setattr(cal, "_week_dates", lambda: [monday + timedelta(days=i) for i in range(5)])
        monkeypatch.setattr(cal, "get_calendar", lambda week=None: {"days": {}})
        monkeypatch.setattr(cal, "_week_dates_for", lambda m: [m + timedelta(days=i) for i in range(5)])

        with mock.patch("api.services.calendar_anticipated_png.render_anticipated_png",
                       return_value=b"fake-png-bytes"):
            r = cal.most_anticipated_png(week="2026-07-27")

        assert r.status_code == 200
        key = "calendar_anticipated_png_2026-07-27"
        assert _ttl_remaining(key) <= cal._ANTICIPATED_PNG_FAIL_TTL + 5
        assert _ttl_remaining(key) < 1800

    def test_nonempty_ranked_gets_the_normal_ttl(self, monkeypatch):
        """Control: a real ranked list still gets the normal week-based TTL."""
        monday = date(2026, 7, 27)
        monkeypatch.setattr(cal, "_monday_of", lambda d: monday)
        monkeypatch.setattr(cal, "_week_dates", lambda: [monday + timedelta(days=i) for i in range(5)])
        monkeypatch.setattr(
            cal, "get_calendar",
            lambda week=None: {"days": {"2026-07-27": {"bmo": [{"sym": "AAPL", "mc_b": 3000}],
                                                        "amc": [], "tbd": []}}},
        )
        monkeypatch.setattr(cal, "_week_dates_for", lambda m: [m + timedelta(days=i) for i in range(5)])
        monkeypatch.setattr(cal, "get_day_metrics", lambda date=None: {})

        with mock.patch("api.services.calendar_anticipated_png.render_anticipated_png",
                       return_value=b"fake-png-bytes"):
            r = cal.most_anticipated_png(week="2026-07-27")

        assert r.status_code == 200
        key = "calendar_anticipated_png_2026-07-27"
        assert _ttl_remaining(key) > cal._ANTICIPATED_PNG_FAIL_TTL
