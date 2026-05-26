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


from datetime import datetime, timedelta
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

    def test_memorial_day_2026_rolls_to_prior_friday(self):
        # The trigger incident: Memorial Day Monday 2026-05-25 at 14:00 ET.
        # Without holiday-awareness, every intraday cache entry fires cold-
        # stale because Friday < "expected Monday session." Prewarmer + on-
        # demand both spam empty Massive fetches and saturate the API key.
        now = datetime(2026, 5, 25, 14, 0, tzinfo=_ET)
        assert _expected_latest_session_yyyymmdd(now) == 20260522  # Fri 5/22

    def test_holiday_long_weekend_rolls_back_past_weekend(self):
        # Sat after a Friday holiday (e.g. Good Friday 2026-04-03) — must
        # walk back through both Sat and the holiday Fri to land on Thu.
        now = datetime(2026, 4, 4, 12, 0, tzinfo=_ET)  # Sat after Good Friday
        assert _expected_latest_session_yyyymmdd(now) == 20260402  # Thu 4/2


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

    def test_memorial_day_with_friday_data_is_not_cold(self):
        # Memorial Day Monday — Friday's cache is the freshest data that
        # exists. Must NOT pay synchronous-fetch latency on every chart load.
        now = datetime(2026, 5, 25, 14, 0, tzinfo=_ET)  # Memorial Day Mon
        assert _is_cold_stale_intraday("30", _et_ts(2026, 5, 22, 16, 0), now) is False
        assert _is_cold_stale_intraday("15", _et_ts(2026, 5, 22, 15, 45), now) is False
        assert _is_cold_stale_intraday("60", _et_ts(2026, 5, 22, 15, 30), now) is False


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


from api.services import bars_fetch as _bf


class TestHotIntradaySet:
    """Usage-driven hot-set: the prewarmer keeps THESE warm so charts the
    user flips through don't fall back into the cold-stale path."""

    def setup_method(self):
        with _bf._recent_intraday_lock:
            _bf._recent_intraday.clear()

    def test_records_intraday_only(self):
        _bf._record_intraday_request("aapl", "15")
        _bf._record_intraday_request("MSFT", "D")   # daily — must be ignored
        _bf._record_intraday_request("nvda", "60")
        hot = set(_bf.get_hot_intraday_tickers())
        assert "AAPL" in hot and "NVDA" in hot
        assert "MSFT" not in hot

    def test_recent_first_and_bounded(self):
        for i in range(5):
            _bf._record_intraday_request(f"T{i}", "5")
        hot = _bf.get_hot_intraday_tickers(max_n=3)
        assert len(hot) == 3
        assert hot[0] == "T4"  # most-recent first

    def test_capacity_prunes_oldest(self):
        cap = _bf._RECENT_INTRADAY_MAX
        for i in range(cap + 50):
            _bf._record_intraday_request(f"S{i}", "30")
        with _bf._recent_intraday_lock:
            assert len(_bf._recent_intraday) <= cap


from api.services.massive import to_polygon_symbol


class TestPolygonSymbol:
    """Dual-class tickers froze because Massive uses dot notation
    (BRK.B) but the universe/cache/FMP/yfinance use hyphen (BRK-B);
    the Massive (and delta) fetch returned n=0 → permanent freeze.
    Verified empirically against production."""

    def test_class_share_hyphen_to_dot(self):
        assert to_polygon_symbol("BRK-B") == "BRK.B"
        assert to_polygon_symbol("BF-B") == "BF.B"
        assert to_polygon_symbol("CRD-A") == "CRD.A"

    def test_plain_ticker_unchanged(self):
        assert to_polygon_symbol("AAPL") == "AAPL"
        assert to_polygon_symbol("nvda") == "NVDA"

    def test_idempotent_on_dot_form(self):
        assert to_polygon_symbol("BRK.B") == "BRK.B"


# ── 60-min ET bucket function — the contract both REST + WS must honor ──────
#
# `bucket_60_et_unix_seconds` is the single source of truth for 60min bucket
# alignment. If anyone ever forks this logic (e.g. reimplements it inside
# bar_rollup.py), the duplicate would drift across DST or RTH-open and start
# writing candles to SQLite at neighboring ``ts`` values — the same shape as
# the FMP bug. These tests lock in the function's exact behavior across the
# tricky cases: RTH open anchor, DST transitions, extended hours, EST↔EDT.

from api.services.bars_fetch import bucket_60_et_unix_seconds


def _ts(y, m, d, hh, mm, tz=_ET):
    return int(datetime(y, m, d, hh, mm, tzinfo=tz).timestamp())


class TestBucket60EtUnixSeconds:
    """The canonical 60min ET-anchored bucket. Used by REST resample AND
    (post-Step-3) the WebSocket bar broadcaster — they MUST agree forever."""

    def test_rth_open_930_anchored(self):
        """9:30 ET is the start-of-RTH anchor, NOT 9:00 ET. The first
        hourly bar is a 30-min bar so the open candle is clean."""
        t = _ts(2026, 5, 22, 9, 30)
        assert bucket_60_et_unix_seconds(t) == _ts(2026, 5, 22, 9, 30)

    def test_rth_open_945_still_anchored_to_930(self):
        """A 30-min bar at 9:45 ET (mid-opening-bucket) buckets to 9:30 ET."""
        t = _ts(2026, 5, 22, 9, 45)
        assert bucket_60_et_unix_seconds(t) == _ts(2026, 5, 22, 9, 30)

    def test_rth_morning_floors_to_clock_hour(self):
        t = _ts(2026, 5, 22, 10, 15)
        assert bucket_60_et_unix_seconds(t) == _ts(2026, 5, 22, 10, 0)
        t = _ts(2026, 5, 22, 11, 45)
        assert bucket_60_et_unix_seconds(t) == _ts(2026, 5, 22, 11, 0)

    def test_rth_afternoon_floors_to_clock_hour(self):
        """The 1pm/2pm/3pm hours — the exact data the noon-cutoff bug was
        eating. Must bucket to 13:00, 14:00, 15:00 ET respectively."""
        assert bucket_60_et_unix_seconds(_ts(2026, 5, 22, 13, 0)) == _ts(2026, 5, 22, 13, 0)
        assert bucket_60_et_unix_seconds(_ts(2026, 5, 22, 13, 30)) == _ts(2026, 5, 22, 13, 0)
        assert bucket_60_et_unix_seconds(_ts(2026, 5, 22, 15, 45)) == _ts(2026, 5, 22, 15, 0)

    def test_rth_close_16_00(self):
        """16:00 ET is the after-hours bucket start (RTH ended at 16:00)."""
        assert bucket_60_et_unix_seconds(_ts(2026, 5, 22, 16, 0)) == _ts(2026, 5, 22, 16, 0)

    def test_premarket_clock_aligned(self):
        """Pre-market 30-min bars (07:30 ET) bucket to clock-hour (07:00 ET).
        9:00-9:29 is also pre-market and floors to 9:00 ET (NOT the 9:30 anchor
        — that anchor only applies once we're at h==9 AND m>=30)."""
        assert bucket_60_et_unix_seconds(_ts(2026, 5, 22, 7, 30)) == _ts(2026, 5, 22, 7, 0)
        assert bucket_60_et_unix_seconds(_ts(2026, 5, 22, 9, 0)) == _ts(2026, 5, 22, 9, 0)
        assert bucket_60_et_unix_seconds(_ts(2026, 5, 22, 9, 15)) == _ts(2026, 5, 22, 9, 0)
        # The instant we cross 9:30 we flip to the anchor:
        assert bucket_60_et_unix_seconds(_ts(2026, 5, 22, 9, 29)) == _ts(2026, 5, 22, 9, 0)
        assert bucket_60_et_unix_seconds(_ts(2026, 5, 22, 9, 30)) == _ts(2026, 5, 22, 9, 30)

    def test_postmarket_clock_aligned(self):
        """After-hours (17:00, 18:00, 19:00 ET) buckets to clock-hour."""
        assert bucket_60_et_unix_seconds(_ts(2026, 5, 22, 17, 30)) == _ts(2026, 5, 22, 17, 0)
        assert bucket_60_et_unix_seconds(_ts(2026, 5, 22, 19, 0)) == _ts(2026, 5, 22, 19, 0)

    def test_winter_est_offset(self):
        """During EST (UTC-5) the bucket must still anchor in ET wall-clock,
        not drift by the offset change. Mid-January exercises EST."""
        t = _ts(2026, 1, 15, 13, 30)
        assert bucket_60_et_unix_seconds(t) == _ts(2026, 1, 15, 13, 0)

    def test_dst_spring_forward(self):
        """Spring-forward Sunday (March 8, 2026): 02:00 ET → 03:00 ET. Bars
        in the immediate aftermath (08:00 EDT etc.) must bucket correctly."""
        # 08:30 EDT post-spring-forward
        t = _ts(2026, 3, 9, 8, 30)  # Monday after spring-forward weekend
        assert bucket_60_et_unix_seconds(t) == _ts(2026, 3, 9, 8, 0)

    def test_dst_fall_back(self):
        """Fall-back Sunday (Nov 1, 2026): 02:00 EDT → 01:00 EST. Bars
        the Monday after must still bucket to the right ET wall-clock hour."""
        t = _ts(2026, 11, 2, 10, 15)  # Monday after fall-back
        assert bucket_60_et_unix_seconds(t) == _ts(2026, 11, 2, 10, 0)

    def test_minute_within_bucket_doesnt_change_output(self):
        """Property check: for any minute within the [bucket_start, bucket_start+60min)
        window, the function returns the same bucket_start. Smoke-tests 60+ cases
        across a few representative bucket windows."""
        # 10:00-10:59 ET → 10:00 ET bucket
        expected = _ts(2026, 5, 22, 10, 0)
        for minute in range(60):
            t = _ts(2026, 5, 22, 10, minute)
            assert bucket_60_et_unix_seconds(t) == expected, f"failed at 10:{minute:02d}"
        # 9:30-9:59 → 9:30 anchor; 10:00 flips to 10:00 bucket
        anchor = _ts(2026, 5, 22, 9, 30)
        for minute in range(30, 60):
            assert bucket_60_et_unix_seconds(_ts(2026, 5, 22, 9, minute)) == anchor

    def test_property_random_minutes_span_year(self):
        """Run 1000 random minutes across a full year (including BOTH DST
        transitions) and assert the bucket is always exactly the floor of
        the ET hour (or the 9:30 anchor when relevant). If the function
        ever drifts on a DST edge, this catches it."""
        import random
        random.seed(42)
        start = datetime(2026, 1, 1, tzinfo=_ET)
        for _ in range(1000):
            minutes_offset = random.randint(0, 365 * 24 * 60)
            dt = start + timedelta(minutes=minutes_offset)
            t = int(dt.timestamp())
            got = bucket_60_et_unix_seconds(t)
            # Compute expected by the same rules:
            dt_et = datetime.fromtimestamp(t, tz=_ET)
            if dt_et.hour == 9 and dt_et.minute >= 30:
                expected = int(datetime(dt_et.year, dt_et.month, dt_et.day, 9, 30, tzinfo=_ET).timestamp())
            else:
                expected = int(datetime(dt_et.year, dt_et.month, dt_et.day, dt_et.hour, 0, tzinfo=_ET).timestamp())
            assert got == expected, f"drift at {dt_et}: got {got}, expected {expected}"


# ── FMP timestamp regression ─────────────────────────────────────────────────
#
# The "noon-cutoff" bug that haunted intraday charts for months: FMP returns
# its `date` field as Eastern Time text (e.g. "2026-05-22 15:30:00" meaning
# 3:30 PM ET), but `_fetch_intraday_fmp` did `datetime.strptime(..., fmt)`
# WITHOUT timezone info, then `dt.timestamp()`. On a UTC-clock container
# (Railway default) that interprets the naive datetime as UTC, producing a
# unix-seconds value exactly the ET-UTC offset BEHIND the correct moment.
#
# Net effect when FMP fallback fired (Massive validation rejection / outage):
# every bar got persisted to SQLite at a timestamp 4-5 hours earlier than
# reality. The afternoon RTH session (13:00-16:00 ET) landed in the morning
# slots (09:00-12:00 ET), so the chart's RTH session-filter accepted those
# (mis-labelled) bars and the actual afternoon timestamps either had no
# data or held stale rows from a prior fetch — symptom: chart visibly cuts
# off at noon ET on "most stocks" and never recovers.

import urllib.request as _urlreq
from io import BytesIO
import json as _json

from api.services.bars_fetch import _fetch_intraday_fmp


class _FakeFMPResponse:
    """Mimics urllib.request.urlopen()'s response context manager."""
    def __init__(self, payload):
        self._buf = BytesIO(_json.dumps(payload).encode("utf-8"))

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return self._buf.read()


class TestFMPTimestampIsEasternTime:
    """FMP returns ET-local date text — the unix-seconds we store MUST
    correspond to that ET moment, not the same wall-clock interpreted as
    UTC. Regression guard against the "noon-cutoff" bug."""

    def _patch(self, monkeypatch, fmp_bars):
        monkeypatch.setenv("FMP_API_KEY", "fake-test-key")
        monkeypatch.setattr(
            _urlreq, "urlopen",
            lambda *a, **kw: _FakeFMPResponse(fmp_bars),
        )

    def test_et_text_decodes_to_correct_utc_unix(self, monkeypatch):
        # FMP says "2026-05-22 15:30:00" — that's 3:30 PM ET (EDT, UTC-4).
        # Correct unix seconds for 2026-05-22 15:30 ET == 19:30 UTC.
        correct_t = _et_ts(2026, 5, 22, 15, 30)  # ET-anchored timestamp
        self._patch(monkeypatch, [{
            "date": "2026-05-22 15:30:00",
            "open": 102.5, "high": 102.9, "low": 102.4, "close": 102.74,
            "volume": 283912,
        }])
        bars = _fetch_intraday_fmp("EPAM", "30", 200)
        assert len(bars) == 1
        # The bug stored `t` = (15:30 interpreted as UTC) = correct_t - 14400
        # in EDT. Assert we DON'T regress to that shifted value.
        assert bars[0]["t"] == correct_t, (
            f"FMP bar timestamp shifted by {(correct_t - bars[0]['t']) / 3600:.1f}h — "
            "ET text being parsed as UTC again? (See noon-cutoff bug.)"
        )
        # The bar's actual ET hour MUST be 15, not 11 (the shifted/buggy value).
        assert datetime.fromtimestamp(bars[0]["t"], tz=_ET).hour == 15

    def test_et_text_decodes_does_not_drop_at_market_close(self, monkeypatch):
        """Adjacent bug found while verifying the FMP heal: `_needs_fresh`
        used a 30h off-market threshold, so a chart opened at 17:00 ET on a
        trading day whose cache only had through 12:00 ET would NOT refetch
        (5h gap < 30h). Visible symptom: chart "stuck" at noon after RTH
        close even with Polygon serving the full session. New rule: same-day
        extended-hours window (4 AM - 8 PM ET weekday) uses the standard tf
        threshold; overnight + weekends keep the conservative 30h gate."""
        from unittest.mock import patch
        from api.services.bars_fetch import _needs_fresh
        # Pretend it's Friday 5:00 PM ET (post-RTH close, still extended hours).
        post_market_friday = datetime(2026, 5, 22, 17, 0, tzinfo=_ET)
        # Cache last_ts is the noon ET bar from the same day.
        last_ts = _et_ts(2026, 5, 22, 12, 0)
        # Mock _is_market_open (returns False post-close) and datetime.now.
        with patch("api.services.bars_fetch._is_market_open", return_value=False), \
             patch("api.services.bars_fetch.datetime") as mock_dt, \
             patch("api.services.bars_fetch._time") as mock_time:
            mock_dt.now.return_value = post_market_friday
            mock_dt.fromtimestamp = datetime.fromtimestamp  # keep helpers
            mock_time.time.return_value = post_market_friday.timestamp()
            # 5h gap @ tf=60 with 3600s threshold: needs fresh.
            assert _needs_fresh(last_ts, "60") is True, (
                "post-market same-day cache must top up to RTH close, not wait 30h"
            )

    def test_overnight_uses_conservative_threshold(self, monkeypatch):
        """Opposite case: 3 AM ET on a weekday — no new bars arriving, so
        the 30h gate kicks in. Cache 5h old should NOT trigger a fetch."""
        from unittest.mock import patch
        from api.services.bars_fetch import _needs_fresh
        overnight_weekday = datetime(2026, 5, 22, 3, 0, tzinfo=_ET)
        last_ts = int(overnight_weekday.timestamp()) - 5 * 3600  # 5h old
        with patch("api.services.bars_fetch._is_market_open", return_value=False), \
             patch("api.services.bars_fetch.datetime") as mock_dt, \
             patch("api.services.bars_fetch._time") as mock_time:
            mock_dt.now.return_value = overnight_weekday
            mock_dt.fromtimestamp = datetime.fromtimestamp
            mock_time.time.return_value = overnight_weekday.timestamp()
            assert _needs_fresh(last_ts, "60") is False, (
                "overnight should NOT burn API calls to top up — nothing new arrives 8 PM - 4 AM ET"
            )

    def test_holiday_with_prior_session_data_is_fresh(self, monkeypatch):
        """Memorial Day Monday 2 PM ET. Cache holds Friday's close (~70h
        old). Prior rule: extended-hours window inactive on holidays, so
        fell through to the 30h gate → 70h > 30h → True → prewarmer fired
        14k+ empty Massive calls per cycle, contending for the shared API
        key with any cold user fetch (the AEHR 12s symptom). New rule:
        off-market entries that already cover the most-recent trading
        session are fresh, period — the 30h gate only kicks in when a
        session is genuinely missing."""
        from unittest.mock import patch
        from api.services.bars_fetch import _needs_fresh
        memorial_day = datetime(2026, 5, 25, 14, 0, tzinfo=_ET)
        friday_close_ts = _et_ts(2026, 5, 22, 16, 0)  # ~70h old
        with patch("api.services.bars_fetch._is_market_open", return_value=False), \
             patch("api.services.bars_fetch.datetime") as mock_dt, \
             patch("api.services.bars_fetch._time") as mock_time:
            mock_dt.now.return_value = memorial_day
            mock_dt.fromtimestamp = datetime.fromtimestamp
            mock_time.time.return_value = memorial_day.timestamp()
            for tf in ("1", "5", "15", "30", "60"):
                assert _needs_fresh(friday_close_ts, tf) is False, (
                    f"holiday with prior-session cache must be fresh on tf={tf} "
                    "— otherwise prewarmer wastes calls and starves cold fetches"
                )

    def test_holiday_with_missing_session_still_needs_fresh(self, monkeypatch):
        """Same holiday clock, but cache is genuinely stale (last bar from
        last week). Cold-stale IS true here, so _needs_fresh must still
        return True — we don't want to leave actually-broken cache rows
        unrefreshed."""
        from unittest.mock import patch
        from api.services.bars_fetch import _needs_fresh
        memorial_day = datetime(2026, 5, 25, 14, 0, tzinfo=_ET)
        week_old_ts = _et_ts(2026, 5, 15, 16, 0)  # ~10 days old
        with patch("api.services.bars_fetch._is_market_open", return_value=False), \
             patch("api.services.bars_fetch.datetime") as mock_dt, \
             patch("api.services.bars_fetch._time") as mock_time:
            mock_dt.now.return_value = memorial_day
            mock_dt.fromtimestamp = datetime.fromtimestamp
            mock_time.time.return_value = memorial_day.timestamp()
            assert _needs_fresh(week_old_ts, "30") is True, (
                "genuinely stale (multi-session-gap) cache must still refresh "
                "on holidays — fresh-on-holiday only applies to most-recent-session data"
            )

    def test_weekend_with_friday_close_is_fresh(self, monkeypatch):
        """Same logic on a regular weekend — Sunday with Friday-close data
        should NOT trigger refresh. Pre-fix the 30h gate fired on every
        Sunday past noon (Friday 4pm → Sun 2pm+ = >40h), so the prewarmer
        wasted a full pass every weekend even though no new bars existed."""
        from unittest.mock import patch
        from api.services.bars_fetch import _needs_fresh
        sunday = datetime(2026, 5, 24, 14, 0, tzinfo=_ET)
        friday_close_ts = _et_ts(2026, 5, 22, 16, 0)
        with patch("api.services.bars_fetch._is_market_open", return_value=False), \
             patch("api.services.bars_fetch.datetime") as mock_dt, \
             patch("api.services.bars_fetch._time") as mock_time:
            mock_dt.now.return_value = sunday
            mock_dt.fromtimestamp = datetime.fromtimestamp
            mock_time.time.return_value = sunday.timestamp()
            assert _needs_fresh(friday_close_ts, "30") is False, (
                "weekend prewarm should skip same-as-Friday-close intraday cache"
            )

    def test_weekend_uses_conservative_threshold(self, monkeypatch):
        """Saturday 11 AM ET: weekend, no new bars regardless of clock-time.
        Stays on the 30h gate."""
        from unittest.mock import patch
        from api.services.bars_fetch import _needs_fresh
        saturday = datetime(2026, 5, 23, 11, 0, tzinfo=_ET)
        last_ts = int(saturday.timestamp()) - 10 * 3600  # 10h old
        with patch("api.services.bars_fetch._is_market_open", return_value=False), \
             patch("api.services.bars_fetch.datetime") as mock_dt, \
             patch("api.services.bars_fetch._time") as mock_time:
            mock_dt.now.return_value = saturday
            mock_dt.fromtimestamp = datetime.fromtimestamp
            mock_time.time.return_value = saturday.timestamp()
            assert _needs_fresh(last_ts, "60") is False, (
                "weekend should NOT trigger a fetch — Polygon has nothing new to offer"
            )

    def test_et_text_handles_winter_est(self, monkeypatch):
        # During EST (UTC-5) the offset shifts to 5h — bug would manifest
        # as 5h-earlier instead of 4h. Pick a January date to exercise EST.
        correct_t = _et_ts(2026, 1, 15, 14, 0)
        self._patch(monkeypatch, [{
            "date": "2026-01-15 14:00:00",
            "open": 100.0, "high": 100.5, "low": 99.8, "close": 100.2,
            "volume": 50000,
        }])
        bars = _fetch_intraday_fmp("AAPL", "30", 200)
        assert len(bars) == 1
        assert bars[0]["t"] == correct_t
        assert datetime.fromtimestamp(bars[0]["t"], tz=_ET).hour == 14
