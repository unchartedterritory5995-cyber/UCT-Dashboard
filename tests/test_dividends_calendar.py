"""Tests for api/services/dividends_calendar.py + GET /api/calendar/dividends endpoint."""
import concurrent.futures
import time
from datetime import date
from unittest import mock

import pytest
from fastapi.testclient import TestClient
from api.main import app

client = TestClient(app)

# ── Helpers ────────────────────────────────────────────────────────────────────

def _make_mock_ticker(calendar=None, dividends=None, splits=None):
    """Build a minimal mock yfinance.Ticker object."""
    import pandas as pd

    m = mock.MagicMock()

    # .calendar — dict or None
    m.calendar = calendar

    # .dividends — pd.Series with DatetimeIndex (tz-aware, ET) or empty Series
    if dividends is not None:
        m.dividends = dividends
    else:
        m.dividends = pd.Series([], dtype=float)

    # .splits — pd.Series with DatetimeIndex or empty Series
    if splits is not None:
        m.splits = splits
    else:
        m.splits = pd.Series([], dtype=float)

    return m


# ── Service-level tests ────────────────────────────────────────────────────────

class TestGetEventsService:
    def test_returns_empty_for_no_syms(self):
        from api.services.dividends_calendar import get_events
        result = get_events([])
        assert result == []

    def test_forward_dividend_included(self):
        """A ticker with an ex-div date in the future should appear as a dividend event."""
        import pandas as pd
        from api.services.dividends_calendar import get_events

        future_ex = date(2099, 12, 31)  # guaranteed future
        mock_ticker = _make_mock_ticker(
            calendar={"Ex-Dividend Date": future_ex},
            dividends=pd.Series([0.27], dtype=float),  # most recent dividend amount
        )

        with mock.patch("api.services.dividends_calendar.cache.get", return_value=None), \
             mock.patch("api.services.dividends_calendar.cache.set"), \
             mock.patch("yfinance.Ticker", return_value=mock_ticker):
            result = get_events(["AAPL"])

        assert len(result) == 1
        ev = result[0]
        assert ev["sym"] == "AAPL"
        assert ev["type"] == "dividend"
        assert ev["date"] == "2099-12-31"
        assert ev["amount"] == pytest.approx(0.27)

    def test_past_dividend_excluded(self):
        """An ex-div date in the past should not appear."""
        import pandas as pd
        from api.services.dividends_calendar import get_events

        past_ex = date(2000, 1, 1)  # guaranteed past
        mock_ticker = _make_mock_ticker(
            calendar={"Ex-Dividend Date": past_ex},
            dividends=pd.Series([0.25], dtype=float),
        )

        with mock.patch("api.services.dividends_calendar.cache.get", return_value=None), \
             mock.patch("api.services.dividends_calendar.cache.set"), \
             mock.patch("yfinance.Ticker", return_value=mock_ticker):
            result = get_events(["AAPL"])

        dividend_events = [e for e in result if e["type"] == "dividend"]
        assert dividend_events == []

    def test_no_calendar_key_produces_no_dividend(self):
        """If ticker.calendar has no Ex-Dividend Date, no dividend event emitted."""
        import pandas as pd
        from api.services.dividends_calendar import get_events

        mock_ticker = _make_mock_ticker(calendar={"Earnings Date": [date(2026, 7, 30)]})

        with mock.patch("api.services.dividends_calendar.cache.get", return_value=None), \
             mock.patch("api.services.dividends_calendar.cache.set"), \
             mock.patch("yfinance.Ticker", return_value=mock_ticker):
            result = get_events(["NVDA"])

        dividend_events = [e for e in result if e["type"] == "dividend"]
        assert dividend_events == []

    def test_forward_split_included(self):
        """A split with a future date should appear as a split event."""
        import pandas as pd
        from api.services.dividends_calendar import get_events

        # pandas Timestamp for a future date (tz-aware like yfinance returns)
        future_ts = pd.Timestamp("2099-12-01", tz="America/New_York")
        splits_series = pd.Series([4.0], index=pd.DatetimeIndex([future_ts]))

        mock_ticker = _make_mock_ticker(calendar={}, splits=splits_series)

        with mock.patch("api.services.dividends_calendar.cache.get", return_value=None), \
             mock.patch("api.services.dividends_calendar.cache.set"), \
             mock.patch("yfinance.Ticker", return_value=mock_ticker):
            result = get_events(["TSLA"])

        split_events = [e for e in result if e["type"] == "split"]
        assert len(split_events) == 1
        ev = split_events[0]
        assert ev["sym"] == "TSLA"
        assert ev["type"] == "split"
        assert ev["date"] == "2099-12-01"
        assert ev["ratio"] == "4:1"

    def test_past_split_excluded(self):
        """A split with a past date should not appear."""
        import pandas as pd
        from api.services.dividends_calendar import get_events

        past_ts = pd.Timestamp("2020-08-31", tz="America/New_York")
        splits_series = pd.Series([4.0], index=pd.DatetimeIndex([past_ts]))

        mock_ticker = _make_mock_ticker(calendar={}, splits=splits_series)

        with mock.patch("api.services.dividends_calendar.cache.get", return_value=None), \
             mock.patch("api.services.dividends_calendar.cache.set"), \
             mock.patch("yfinance.Ticker", return_value=mock_ticker):
            result = get_events(["AAPL"])

        split_events = [e for e in result if e["type"] == "split"]
        assert split_events == []

    def test_cached_result_returned_without_yfinance(self):
        """When cache is warm, yfinance.Ticker should not be called."""
        from api.services.dividends_calendar import get_events
        cached = [{"sym": "AAPL", "type": "dividend", "date": "2099-12-31", "amount": 0.27}]

        with mock.patch("api.services.dividends_calendar.cache.get", return_value=cached), \
             mock.patch("yfinance.Ticker") as mock_yf:
            result = get_events(["AAPL"])

        mock_yf.assert_not_called()
        assert result == cached

    def test_empty_safe_when_all_fails(self):
        """If yfinance raises for every sym, returns []."""
        from api.services.dividends_calendar import get_events

        with mock.patch("api.services.dividends_calendar.cache.get", return_value=None), \
             mock.patch("api.services.dividends_calendar.cache.set"), \
             mock.patch("yfinance.Ticker", side_effect=RuntimeError("network error")):
            result = get_events(["AAPL", "NVDA"])

        assert result == []

    def test_multiple_syms_merged(self):
        """Events from multiple tickers are all returned, sorted by date."""
        import pandas as pd
        from api.services.dividends_calendar import get_events

        def make_ticker(sym):
            future_ex = date(2099, 12, 1) if sym == "AAPL" else date(2099, 11, 15)
            return _make_mock_ticker(
                calendar={"Ex-Dividend Date": future_ex},
                dividends=pd.Series([0.27 if sym == "AAPL" else 0.65], dtype=float),
            )

        with mock.patch("api.services.dividends_calendar.cache.get", return_value=None), \
             mock.patch("api.services.dividends_calendar.cache.set"), \
             mock.patch("yfinance.Ticker", side_effect=lambda sym: make_ticker(sym)):
            result = get_events(["AAPL", "MSFT"])

        # Should get 2 dividend events; sorted → MSFT (Nov) before AAPL (Dec)
        assert len(result) == 2
        assert result[0]["sym"] == "MSFT"
        assert result[1]["sym"] == "AAPL"

    def test_event_fields_null_safe_no_dividends_series(self):
        """When .dividends raises, amount is None (not a crash)."""
        import pandas as pd
        from api.services.dividends_calendar import get_events

        future_ex = date(2099, 12, 31)
        mock_ticker = _make_mock_ticker(
            calendar={"Ex-Dividend Date": future_ex},
        )
        # Make .dividends raise
        type(mock_ticker).dividends = mock.PropertyMock(side_effect=RuntimeError)

        with mock.patch("api.services.dividends_calendar.cache.get", return_value=None), \
             mock.patch("api.services.dividends_calendar.cache.set"), \
             mock.patch("yfinance.Ticker", return_value=mock_ticker):
            result = get_events(["AAPL"])

        assert len(result) == 1
        assert result[0]["amount"] is None


# ── Deadline-shed completeness (data-dependability C10) ────────────────────────
#
# The 25s deadline shed in get_events is correct (bounds the request path
# against a hung yfinance call) -- caching the SHED result at the 12h success
# TTL is not: the missing symbols' events become indistinguishable from
# "pays no dividend, no splits." A deterministic FakeExecutor stands in for
# ThreadPoolExecutor so the test proves the `completed < len(futures)`
# predicate without a real 25s wait or a timing-race.

class _FakeFuture:
    def __init__(self, value=None, raise_timeout=False):
        self._value = value
        self._raise_timeout = raise_timeout

    def result(self, timeout=None):
        if self._raise_timeout:
            raise concurrent.futures.TimeoutError()
        return self._value


class _FakeExecutor:
    """Replaces ThreadPoolExecutor: runs `fn` synchronously (deterministic,
    no real concurrency) and returns a future that times out for any symbol
    named in `slow_syms`."""
    def __init__(self, slow_syms, *a, **kw):
        self._slow_syms = set(slow_syms)

    def submit(self, fn, sym):
        if sym in self._slow_syms:
            return _FakeFuture(raise_timeout=True)
        return _FakeFuture(value=fn(sym))

    def shutdown(self, wait=False, cancel_futures=False):
        pass


class TestDeadlineShedCompleteness:
    def setup_method(self):
        from api.services.dividends_calendar import _syms_cache_key
        # Clear any real cache entries these keys might collide with.
        from api.services.cache import cache as _cache
        _cache.invalidate(_syms_cache_key(["AAPL"]))
        _cache.invalidate(_syms_cache_key(["AAPL", "MSFT"]))

    def _run_with_shed(self, syms, slow_syms):
        import pandas as pd
        from api.services import dividends_calendar as dc

        future_ex = date(2099, 12, 31)

        def _mk_ticker(sym):
            return _make_mock_ticker(
                calendar={"Ex-Dividend Date": future_ex},
                dividends=pd.Series([1.0], dtype=float),
            )

        with mock.patch("yfinance.Ticker", side_effect=lambda s: _mk_ticker(s)), \
             mock.patch("concurrent.futures.ThreadPoolExecutor",
                       lambda *a, **kw: _FakeExecutor(slow_syms)):
            return dc.get_events(syms)

    def test_shed_symbol_gets_short_ttl_and_result_still_served(self):
        """One symbol times out (shed by the 25s deadline). The OTHER
        symbol's real result is still served (a partial is worth serving),
        but the cache write must use the short partial TTL, not the 12h one."""
        from api.services.dividends_calendar import (
            _syms_cache_key, _CACHE_TTL, _CACHE_TTL_PARTIAL,
        )
        from api.services.cache import cache as _cache

        result = self._run_with_shed(["AAPL", "MSFT"], slow_syms={"MSFT"})

        # The completed symbol's dividend is still in the served result.
        assert any(e["sym"] == "AAPL" for e in result)
        # The shed symbol's absence must not look like "verified no dividend."
        assert not any(e["sym"] == "MSFT" for e in result)

        key = _syms_cache_key(["AAPL", "MSFT"])
        _, expires_at = _cache._store[key]
        ttl_remaining = expires_at - time.time()
        assert ttl_remaining <= _CACHE_TTL_PARTIAL + 5
        assert ttl_remaining < _CACHE_TTL  # never the full 12h

    def test_all_completed_gets_full_ttl(self):
        """Control: nothing shed -> the normal 12h success TTL applies, even
        though the completeness predicate changed."""
        from api.services.dividends_calendar import _syms_cache_key, _CACHE_TTL
        from api.services.cache import cache as _cache

        result = self._run_with_shed(["AAPL"], slow_syms=set())

        assert any(e["sym"] == "AAPL" for e in result)
        key = _syms_cache_key(["AAPL"])
        _, expires_at = _cache._store[key]
        ttl_remaining = expires_at - time.time()
        assert ttl_remaining > _CACHE_TTL - 5  # ~12h, not the short partial one

    def test_all_completed_but_genuinely_empty_still_gets_full_ttl(self):
        """A fully-completed batch that legitimately has no dividends/splits
        is NOT a failure -- it must still get the long TTL (this is the
        honest-emptiness-vs-failure distinction, not a truthiness check)."""
        from api.services.dividends_calendar import _syms_cache_key, _CACHE_TTL
        from api.services.cache import cache as _cache
        import pandas as pd
        from api.services import dividends_calendar as dc

        empty_ticker = _make_mock_ticker(calendar={})  # no Ex-Dividend Date, no splits

        with mock.patch("yfinance.Ticker", return_value=empty_ticker), \
             mock.patch("concurrent.futures.ThreadPoolExecutor",
                       lambda *a, **kw: _FakeExecutor(set())):
            result = dc.get_events(["NFLX"])

        assert result == []
        key = _syms_cache_key(["NFLX"])
        _, expires_at = _cache._store[key]
        ttl_remaining = expires_at - time.time()
        assert ttl_remaining > _CACHE_TTL - 5


# ── Endpoint tests ─────────────────────────────────────────────────────────────

class TestDividendsEndpoint:
    """Tests for GET /api/calendar/dividends.

    The endpoint requires auth; we mock the auth dependency + the service.
    """

    def _authed_client(self):
        """Return a TestClient that overrides get_current_user."""
        from api.middleware.auth_middleware import get_current_user
        app.dependency_overrides[get_current_user] = lambda: {"id": "test-user-123", "email": "t@example.com"}
        return client

    def teardown_method(self):
        app.dependency_overrides.clear()

    def test_endpoint_with_explicit_syms(self):
        self._authed_client()
        with mock.patch("api.routers.calendar._get_div_events",
                        return_value=[{"sym": "AAPL", "type": "dividend",
                                       "date": "2099-12-31", "amount": 0.27}]):
            r = client.get("/api/calendar/dividends?syms=AAPL,MSFT")
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body, list)
        assert body[0]["sym"] == "AAPL"
        assert body[0]["type"] == "dividend"

    def test_endpoint_defaults_to_my_stocks(self):
        """Without syms param, uses user's My-Stocks set."""
        self._authed_client()
        with mock.patch("api.services.calendar_personalization.get_user_ticker_sets",
                        return_value={"all_mine": {"NVDA", "AAPL"}, "watchlist": set(),
                                      "flagged": set(), "positions": set(), "uct20": set()}), \
             mock.patch("api.routers.calendar._get_div_events", return_value=[]) as mock_ev:
            r = client.get("/api/calendar/dividends")
        assert r.status_code == 200
        # Service should have been called with the all_mine syms (sorted)
        mock_ev.assert_called_once()
        call_syms = mock_ev.call_args[0][0]
        assert set(call_syms) == {"AAPL", "NVDA"}

    def test_endpoint_empty_safe(self):
        self._authed_client()
        with mock.patch("api.routers.calendar._get_div_events", return_value=[]):
            r = client.get("/api/calendar/dividends?syms=AAPL")
        assert r.status_code == 200
        assert r.json() == []

    def test_endpoint_requires_auth(self):
        """No auth override → endpoint returns 401 or redirects."""
        app.dependency_overrides.clear()  # ensure no override
        r = client.get("/api/calendar/dividends?syms=AAPL")
        # Could be 401 or 422 depending on auth middleware; must not be 200 with no auth
        assert r.status_code in (401, 403, 422)
