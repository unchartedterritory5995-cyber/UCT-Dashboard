"""`dividends_calendar_held.held_events()`: the READ ONLY reader of what the dividend calendar holds for ONE stock.

No network: the vendor's reference read is replaced by invented rows or by counters that fail the test when reached.
Every ticker, date and amount is invented. Pinned: nothing held is `not_held`, the events the SERVICE stored for that
stock alone come back untouched with the time it stored them, a read the service marked incomplete is `incomplete`
with the shorter lifetime, an entry for a set of several stocks or one that is not a list is `not_held`, and the
reader never fetches and never writes to the cache, while the service's own `get_events_with_status()` asks the vendor
on the same cold cache (so the rail can fail).
"""
from __future__ import annotations

import datetime as dt
import time

import pytest

from api.services import dividends_calendar as svc
from api.services import dividends_calendar_held as held
from api.services import reference_corp_actions as rca
from api.services.cache import cache

TODAY = dt.date(2026, 11, 19)
VENDOR = {"dividends": [{"ex_dividend_date": "2026-12-04", "cash_amount": 0.26}],
          "splits": [{"execution_date": "2027-01-15", "split_from": 1, "split_to": 4}]}


class _Today(dt.date):
    @classmethod
    def today(cls):
        return TODAY


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    cache.delete_prefix("dividends_calendar_")
    monkeypatch.setattr(svc, "date", _Today)
    monkeypatch.setattr(svc, "resolve_entity", lambda s: ({"status": "resolved", "entityId": f"e-{s}"}, s))
    yield
    cache.delete_prefix("dividends_calendar_")


@pytest.fixture
def work(monkeypatch):
    """Counts the work the held reader must never cause: a vendor read, a read through the service, a cache write."""
    hits = []

    def boom(name):
        def f(*a, **kw):
            hits.append(name)
            raise AssertionError(f"{name} was reached by a held read")
        return f
    for name in ("get_events_with_status", "get_events", "_get_forward_dividend", "_get_forward_splits"):
        monkeypatch.setattr(svc, name, boom(name))
    for name in ("_ticker_read", "fetch_ticker_dividends", "fetch_ticker_splits"):
        monkeypatch.setattr(rca, name, boom(f"reference_corp_actions.{name}"))
    monkeypatch.setattr(cache, "set", boom("cache.set"))
    return hits


def _hold(monkeypatch, syms=("AAA",), fail=None):
    def read(path, date_field, ticker, gte, lte):
        leg = "splits" if "splits" in path else "dividends"
        if leg == fail:
            raise rca.CorpActionsUnavailable("an invented vendor failure")
        return [{**r, "ticker": ticker} for r in VENDOR[leg]]
    monkeypatch.setattr(rca, "_ticker_read", read)
    return svc.get_events_with_status(list(syms))


def test_nothing_held_is_not_held_and_nothing_is_fetched(work):
    assert held.held_events("AAA") == (None, None, "not_held")
    assert work == []


def test_the_events_the_service_stored_for_one_stock_come_back_untouched_with_the_time_it_stored_them(monkeypatch):
    before = time.time()
    rows, complete = _hold(monkeypatch)
    after = time.time()
    assert complete and [r["type"] for r in rows] == ["dividend", "split"]
    got, stored_at, how = held.held_events("aaa")
    assert how == "complete" and got is rows                            # the service's own list, untouched
    assert before - 1 <= stored_at <= after + 1
    key = svc._syms_cache_key(["AAA"])
    expires = [e for k, _v, e in cache.items_with_expiry() if k == key][0]
    assert stored_at == pytest.approx(expires - svc._CACHE_TTL)


def test_a_read_the_service_marked_incomplete_is_incomplete_with_its_shorter_lifetime(monkeypatch):
    rows, complete = _hold(monkeypatch, fail="splits")
    assert not complete and svc.read_partial(["AAA"]) and [r["type"] for r in rows] == ["dividend"]
    got, stored_at, how = held.held_events("AAA")
    assert how == "incomplete" and got is rows
    expires = [e for k, _v, e in cache.items_with_expiry() if k == svc._syms_cache_key(["AAA"])][0]
    assert stored_at == pytest.approx(expires - svc._CACHE_TTL_PARTIAL)
    assert stored_at == pytest.approx(time.time(), abs=3)


def test_a_set_of_several_stocks_an_expired_entry_and_an_entry_that_is_not_a_list_are_not_held(monkeypatch):
    _hold(monkeypatch, syms=("AAA", "BBB"))                              # held for the SET, not for one stock alone
    assert held.held_events("AAA") == (None, None, "not_held")
    key = svc._syms_cache_key(["AAA"])
    cache.set(key, [], ttl=-1)                                          # already past its expiry
    assert held.held_events("AAA")[2] == "not_held"
    for junk in ({}, "rows", 3):
        cache.set(key, junk, ttl=svc._CACHE_TTL)
        assert held.held_events("AAA") == (None, None, "not_held"), junk


def test_the_reader_says_read_only_and_the_services_own_reader_asks_the_vendor_on_the_same_cold_cache(monkeypatch):
    assert held.held_events.__doc__.startswith("READ ONLY")
    asked = []
    monkeypatch.setattr(rca, "_ticker_read", lambda path, f, t, g, l: asked.append(path) or [])
    assert held.held_events("AAA")[2] == "not_held" and asked == []    # the held read: no work
    svc.get_events_with_status(["AAA"])                                 # the service's reader: the vendor, twice
    assert sorted(asked) == ["/v3/reference/dividends", "/v3/reference/splits"]
    assert held.held_events("AAA")[2] == "complete"                     # and it stored what it read
