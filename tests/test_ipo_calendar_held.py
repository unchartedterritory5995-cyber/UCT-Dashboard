"""`ipo_calendar_held.held_ipos()`: the READ ONLY reader of the IPO calendar the service holds for one range.

No network: both vendor readers are replaced by invented rows or by counters that fail the test when reached. Every
name, ticker and figure is invented. Pinned: nothing held is `not_held`, the rows the SERVICE stored come back
untouched with the time it stored them, the service's own both-vendors-failed record is `failed`, an entry for another
range or one that is not a list is `not_held`, and the reader never fetches and never writes to the cache, while the
service's own `get_ipos_with_status()` asks both vendors on the same cold cache (so the rail can fail).
"""
from __future__ import annotations

import time

import pytest

from api.services import fmp_client
from api.services import ipo_calendar as svc
from api.services import ipo_calendar_held as held
from api.services.cache import cache

RANGE = ("2026-11-09", "2026-11-27")
FH = [{"date": "2026-11-20", "exchange": "NASDAQ", "name": "Example Robotics Inc", "numberOfShares": 1000000,
       "price": "$10.00-$12.00", "status": "expected", "symbol": "EXRB", "totalSharesValue": 11000000}]


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    cache.delete_prefix("ipo_calendar_")
    monkeypatch.setattr(svc, "resolve_entity", lambda sym: ({"status": "resolved", "entityId": f"e-{sym}"}, sym))
    yield
    cache.delete_prefix("ipo_calendar_")


@pytest.fixture
def work(monkeypatch):
    """Counts the work the held reader must never cause: a vendor read, a fetch through the service, a cache write."""
    hits = []

    def boom(name):
        def f(*a, **kw):
            hits.append(name)
            raise AssertionError(f"{name} was reached by a held read")
        return f
    for name in ("_fh_ipo_get", "_fmp_ipo_get", "get_ipos_with_status", "get_ipos", "_build", "fh_get"):
        monkeypatch.setattr(svc, name, boom(name))
    monkeypatch.setattr(fmp_client, "get_ipo_calendar", boom("fmp_client.get_ipo_calendar"))
    monkeypatch.setattr(cache, "set", boom("cache.set"))
    return hits


def _hold(monkeypatch, fh=FH, fmp=None, rng=RANGE):
    monkeypatch.setattr(svc, "_fh_ipo_get", lambda f, t: fh)
    monkeypatch.setattr(svc, "_fmp_ipo_get", lambda f, t: fmp)
    return svc.get_ipos_with_status(*rng)


def test_nothing_held_is_not_held_and_nothing_is_fetched(work):
    assert held.held_ipos(*RANGE) == (None, None, "not_held")
    assert work == []


def test_the_rows_the_service_stored_come_back_untouched_with_the_time_it_stored_them(monkeypatch):
    before = time.time()
    rows, answered = _hold(monkeypatch)
    after = time.time()
    assert answered and rows and rows[0]["sym"] == "EXRB"
    got, stored_at, how = held.held_ipos(*RANGE)
    assert how == "held" and got is rows                                # the service's own list, untouched
    assert before - 1 <= stored_at <= after + 1                         # expiry less the service's own lifetime
    expires = [e for k, _v, e in cache.items_with_expiry() if k == held.rows_key(*RANGE)][0]
    assert stored_at == pytest.approx(expires - svc._CACHE_TTL)
    # an answered, empty calendar is held too: the service stores it
    cache.delete_prefix("ipo_calendar_")
    _hold(monkeypatch, fh=[], fmp=None)
    assert held.held_ipos(*RANGE)[0] == [] and held.held_ipos(*RANGE)[2] == "held"


def test_the_services_own_both_vendors_failed_record_is_failed(monkeypatch):
    before = time.time()
    rows, answered = _hold(monkeypatch, fh=None, fmp=None)
    assert (rows, answered) == ([], False) and svc.read_failed(*RANGE)
    got, stored_at, how = held.held_ipos(*RANGE)
    assert (got, how) == (None, "failed")
    assert stored_at == pytest.approx(before, abs=2)
    expires = [e for k, _v, e in cache.items_with_expiry() if k == held.failed_key(*RANGE)][0]
    assert stored_at == pytest.approx(expires - svc._CACHE_TTL_FAILED)


def test_another_range_an_expired_entry_and_an_entry_that_is_not_a_list_are_not_held(monkeypatch):
    _hold(monkeypatch, rng=("2026-11-16", "2026-11-20"))                # the Calendar page's week, not this range
    assert held.held_ipos(*RANGE)[2] == "not_held"
    cache.set(held.rows_key(*RANGE), FH, ttl=-1)                        # already past its expiry
    assert held.held_ipos(*RANGE)[2] == "not_held"
    for junk in ({}, "rows", 3):
        cache.set(held.rows_key(*RANGE), junk, ttl=svc._CACHE_TTL)
        assert held.held_ipos(*RANGE) == (None, None, "not_held"), junk


def test_the_reader_says_read_only_and_the_services_own_reader_asks_both_vendors_on_the_same_cold_cache(monkeypatch):
    assert held.held_ipos.__doc__.startswith("READ ONLY")
    asked = []
    monkeypatch.setattr(svc, "_fh_ipo_get", lambda f, t: asked.append("finnhub") or FH)
    monkeypatch.setattr(svc, "_fmp_ipo_get", lambda f, t: asked.append("fmp") or [])
    assert held.held_ipos(*RANGE)[2] == "not_held" and asked == []     # the held read: no work
    svc.get_ipos_with_status(*RANGE)                                    # the service's reader: both vendors
    assert asked == ["finnhub", "fmp"]
    assert held.held_ipos(*RANGE)[2] == "held"                          # and it stored what it read
