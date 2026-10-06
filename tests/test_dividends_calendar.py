"""Tests for api/services/dividends_calendar.py + GET /api/calendar/dividends endpoint.

TERM-036 (2026-09-27): the feed reads Massive reference data through
`reference_corp_actions`, not yfinance. The vendor is faked at the adapter
boundary (`massive._get_client`) so the URL build and the parse both run and no
test touches the network.
"""
import concurrent.futures
import time
from datetime import date, timedelta
from unittest import mock

import pytest
from fastapi.testclient import TestClient
from api.main import app

client = TestClient(app)

# ── Helpers ────────────────────────────────────────────────────────────────────

def _day(offset: int) -> str:
    return (date.today() + timedelta(days=offset)).isoformat()


class _FakeMassive:
    """Answers /v3/reference/{dividends,splits} per ticker from fixtures."""
    _api_key = "k"

    def __init__(self, dividends=None, splits=None, fail=()):
        self.dividends = dividends or {}
        self.splits = splits or {}
        self.fail = set(fail)
        self.urls = []

    def _typed_get(self, url, *, timeout=None):
        # TERM-022: reads go through `massive_adapter` -> the typed transport.
        from urllib.parse import urlparse, parse_qs
        from api.services import massive as _m
        self.urls.append(url)
        tk = (parse_qs(urlparse(url).query).get("ticker") or [""])[0]
        if tk in self.fail:
            raise _m.MassiveTransient("HTTP 503", vendor="massive", status=503)
        if "/v3/reference/dividends" in url:
            return {"results": list(self.dividends.get(tk, []))}
        if "/v3/reference/splits" in url:
            return {"results": list(self.splits.get(tk, []))}
        raise AssertionError(url)


def _patch_massive(fake):
    return mock.patch("api.services.massive._get_client", return_value=fake)


def _div(sym, ex, cash):
    return {"ticker": sym, "ex_dividend_date": ex, "cash_amount": cash}


def _split(sym, ex, frm, to):
    return {"ticker": sym, "execution_date": ex, "split_from": frm, "split_to": to}


def _no_cache():
    return (mock.patch("api.services.dividends_calendar.cache.get", return_value=None),
            mock.patch("api.services.dividends_calendar.cache.set"))


# ── Service-level tests ────────────────────────────────────────────────────────

class TestGetEventsService:
    def _run(self, fake, syms):
        from api.services.dividends_calendar import get_events
        g, s = _no_cache()
        with g, s, _patch_massive(fake):
            return get_events(syms)

    def test_returns_empty_for_no_syms(self):
        from api.services.dividends_calendar import get_events
        assert get_events([]) == []

    def test_forward_dividend_included(self):
        """A ticker with a declared future ex-date appears as a dividend event."""
        result = self._run(_FakeMassive(dividends={"AAPL": [_div("AAPL", "2099-12-31", 0.27)]}),
                           ["AAPL"])
        assert len(result) == 1
        ev = result[0]
        assert ev["sym"] == "AAPL"
        assert ev["type"] == "dividend"
        assert ev["date"] == "2099-12-31"
        assert ev["amount"] == pytest.approx(0.27)
        assert ev["source"] == "massive"

    def test_past_dividend_excluded(self):
        """An ex-date in the past does not appear (defensive client-side filter too)."""
        result = self._run(_FakeMassive(dividends={"AAPL": [_div("AAPL", "2000-01-01", 0.25)]}),
                           ["AAPL"])
        assert [e for e in result if e["type"] == "dividend"] == []

    def test_only_the_NEXT_forward_dividend_is_emitted(self):
        """Massive can return several declared ex-dates; the feed keeps its
        one-next-dividend-per-symbol shape."""
        fake = _FakeMassive(dividends={"KO": [_div("KO", _day(10), 0.51),
                                              _div("KO", _day(100), 0.53)]})
        result = self._run(fake, ["KO"])
        assert [(e["date"], e["amount"]) for e in result] == [(_day(10), 0.51)]

    def test_no_dividend_rows_produces_no_dividend(self):
        result = self._run(_FakeMassive(), ["NVDA"])
        assert [e for e in result if e["type"] == "dividend"] == []

    def test_forward_split_included(self):
        """A split with a future execution date appears as a split event."""
        result = self._run(_FakeMassive(splits={"TSLA": [_split("TSLA", "2099-12-01", 1, 4)]}),
                           ["TSLA"])
        split_events = [e for e in result if e["type"] == "split"]
        assert len(split_events) == 1
        ev = split_events[0]
        assert ev["sym"] == "TSLA"
        assert ev["date"] == "2099-12-01"
        assert ev["ratio"] == "4:1"
        assert ev["source"] == "massive"

    def test_reverse_split_reads_one_for_n(self):
        result = self._run(_FakeMassive(splits={"XYZ": [_split("XYZ", "2099-12-01", 10, 1)]}),
                           ["XYZ"])
        assert [e["ratio"] for e in result] == ["1:10"]

    def test_past_split_excluded(self):
        result = self._run(_FakeMassive(splits={"AAPL": [_split("AAPL", "2020-08-31", 1, 4)]}),
                           ["AAPL"])
        assert [e for e in result if e["type"] == "split"] == []

    def test_cached_result_returned_without_calling_massive(self):
        from api.services.dividends_calendar import get_events
        cached = [{"sym": "AAPL", "type": "dividend", "date": "2099-12-31", "amount": 0.27}]
        fake = _FakeMassive()
        with mock.patch("api.services.dividends_calendar.cache.get", return_value=cached), \
             _patch_massive(fake):
            result = get_events(["AAPL"])
        assert fake.urls == []
        assert result == cached

    def test_empty_safe_when_all_fails(self):
        """Massive failing for every sym returns [] and never raises."""
        assert self._run(_FakeMassive(fail={"AAPL", "NVDA"}), ["AAPL", "NVDA"]) == []

    def test_multiple_syms_merged(self):
        """Events from multiple tickers are all returned, sorted by date."""
        fake = _FakeMassive(dividends={"AAPL": [_div("AAPL", "2099-12-01", 0.27)],
                                       "MSFT": [_div("MSFT", "2099-11-15", 0.65)]})
        result = self._run(fake, ["AAPL", "MSFT"])
        assert [e["sym"] for e in result] == ["MSFT", "AAPL"]

    def test_unparseable_cash_amount_is_None_not_a_crash(self):
        result = self._run(_FakeMassive(dividends={"AAPL": [_div("AAPL", "2099-12-31", "n/a")]}),
                           ["AAPL"])
        assert len(result) == 1
        assert result[0]["amount"] is None


# ── Deadline-shed completeness (data-dependability C10) ────────────────────────
#
# The 25s deadline shed in get_events is correct (bounds the request path
# against a hung vendor call) -- caching the SHED result at the 12h success
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
        from api.services.cache import cache as _cache
        for syms in (["AAPL"], ["AAPL", "MSFT"], ["NFLX"]):
            _cache.invalidate(_syms_cache_key(syms))

    def _run_with_shed(self, syms, slow_syms):
        from api.services import dividends_calendar as dc
        fake = _FakeMassive(dividends={s: [_div(s, "2099-12-31", 1.0)] for s in syms})
        with _patch_massive(fake), \
             mock.patch("concurrent.futures.ThreadPoolExecutor",
                        lambda *a, **kw: _FakeExecutor(slow_syms)):
            return dc.get_events(syms)

    def test_shed_symbol_gets_short_ttl_and_result_still_served(self):
        """One symbol times out (shed by the 25s deadline). The OTHER
        symbol's real result is still served, but the cache write uses the
        short partial TTL, not the 12h one."""
        from api.services.dividends_calendar import (
            _syms_cache_key, _CACHE_TTL, _CACHE_TTL_PARTIAL,
        )
        from api.services.cache import cache as _cache

        result = self._run_with_shed(["AAPL", "MSFT"], slow_syms={"MSFT"})

        assert any(e["sym"] == "AAPL" for e in result)
        # The shed symbol's absence must not look like "verified no dividend."
        assert not any(e["sym"] == "MSFT" for e in result)

        _, expires_at = _cache._store[_syms_cache_key(["AAPL", "MSFT"])]
        ttl_remaining = expires_at - time.time()
        assert ttl_remaining <= _CACHE_TTL_PARTIAL + 5
        assert ttl_remaining < _CACHE_TTL

    def test_all_completed_gets_full_ttl(self):
        """Control: nothing shed -> the normal 12h success TTL applies."""
        from api.services.dividends_calendar import _syms_cache_key, _CACHE_TTL
        from api.services.cache import cache as _cache

        result = self._run_with_shed(["AAPL"], slow_syms=set())

        assert any(e["sym"] == "AAPL" for e in result)
        _, expires_at = _cache._store[_syms_cache_key(["AAPL"])]
        assert expires_at - time.time() > _CACHE_TTL - 5

    def test_all_completed_but_genuinely_empty_still_gets_full_ttl(self):
        """A fully-answered batch that legitimately has no dividends/splits
        is NOT a failure -- it still gets the long TTL (honest emptiness vs
        failure, not a truthiness check)."""
        from api.services.dividends_calendar import _syms_cache_key, _CACHE_TTL
        from api.services.cache import cache as _cache
        from api.services import dividends_calendar as dc

        with _patch_massive(_FakeMassive()), \
             mock.patch("concurrent.futures.ThreadPoolExecutor",
                        lambda *a, **kw: _FakeExecutor(set())):
            result = dc.get_events(["NFLX"])

        assert result == []
        _, expires_at = _cache._store[_syms_cache_key(["NFLX"])]
        assert expires_at - time.time() > _CACHE_TTL - 5


# ── Endpoint tests ─────────────────────────────────────────────────────────────

class TestDividendsEndpoint:
    """Tests for GET /api/calendar/dividends.

    The endpoint requires auth; we mock the auth dependency + the service.
    """

    def _authed_client(self, plan="pro"):
        """Return a TestClient standing in for a PAID member.

        ⚠️ REPAIRED 2026-08-09 — `/api/calendar/dividends` became `require_paid`
        with the rest of the calendar's personalized routes. This helper supplied
        a session with no plan and the tests asserted 200, which proved only that
        a SESSION got the data — and signup is open and free, so that was the
        hole, not the gate.

        ⛔ The override is on `get_current_user_with_plan`, the gate's INPUT.
        Overriding `require_paid` would mean the tests never run the gate
        (`lesson_injected_dependency_hides_the_fetch`)."""
        from api.middleware.auth_middleware import (
            get_current_user, get_current_user_with_plan,
        )
        who = {"id": "test-user-123", "email": "t@example.com",
               "role": "member", "plan": plan}
        app.dependency_overrides[get_current_user] = lambda: dict(who)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(who)
        return client

    def test_a_logged_in_FREE_member_is_refused(self):
        """🔴 THE ASSERTION THAT WAS MISSING."""
        c = self._authed_client(plan="free")
        assert c.get("/api/calendar/dividends?syms=AAPL").status_code == 402

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


# ── Quality pass 2026-10-05: a failed read is labelled, never served as "no dividends" ──

class TestDividendFailedReadIsLabelled:
    def teardown_method(self):
        app.dependency_overrides.clear()

    def test_a_failed_symbol_marks_the_answer_partial_and_a_clean_one_does_not(self):
        from api.services import dividends_calendar as dc
        store = {}

        def _set(k, v, ttl):
            store[k] = v
        with mock.patch.object(dc.cache, "get", side_effect=store.get), \
             mock.patch.object(dc.cache, "set", side_effect=_set), \
             mock.patch.object(dc.cache, "invalidate", side_effect=lambda k: store.pop(k, None)), \
             mock.patch("api.services.cache_policy.cache.set", side_effect=_set), \
             _patch_massive(_FakeMassive(fail={"AAPL"})):
            rows, complete = dc.get_events_with_status(["AAPL"])
            assert complete is False
            assert dc.read_partial(["aapl"]) is True
        store.clear()
        with mock.patch.object(dc.cache, "get", side_effect=store.get), \
             mock.patch.object(dc.cache, "set", side_effect=_set), \
             mock.patch.object(dc.cache, "invalidate", side_effect=lambda k: store.pop(k, None)), \
             mock.patch("api.services.cache_policy.cache.set", side_effect=_set), \
             _patch_massive(_FakeMassive()):
            rows, complete = dc.get_events_with_status(["AAPL"])
            assert complete is True
            assert dc.read_partial(["AAPL"]) is False

    def test_the_route_labels_failed_and_partial_reads(self):
        TestDividendsEndpoint._authed_client(self)
        cases = (([], True, "failed"),
                 ([{"sym": "KO", "type": "dividend", "date": "2099-01-01"}], True, "partial"),
                 ([], False, None))
        for rows, partial, header in cases:
            with mock.patch("api.routers.calendar._get_div_events", return_value=rows), \
                 mock.patch("api.routers.calendar._div_read_partial", return_value=partial):
                r = client.get("/api/calendar/dividends?syms=AAPL")
            assert r.status_code == 200
            assert r.headers.get("x-calendar-read") == header
