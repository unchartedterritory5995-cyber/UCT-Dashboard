"""Perf wave 2 (2026-10-08): /api/catalysts/explain took 9-22 s on a ticker's FIRST lookup
because the full source pull (identical for every ticker) was cached per ticker. The pull is
now shared per market date, single-flight, with stale-while-revalidate past its TTL."""
from __future__ import annotations

import threading
import time

import pytest

from api.routers import catalysts as cr
from api.services.catalyst import curator, filters, scoring, sources, tagging

MD = "2026-10-08"


@pytest.fixture(autouse=True)
def _iso(monkeypatch):
    for c in (cr._explain_cache, cr._explain_inflight, cr._pool_cache, cr._pool_refreshing):
        c.clear()
    monkeypatch.setattr(curator, "get_curation", lambda md: {})
    monkeypatch.setattr(curator, "curator_ran", lambda md: True)
    monkeypatch.setattr(filters, "quality_gate", lambda c: (True, ""))
    monkeypatch.setattr(filters, "is_real_catalyst", lambda c: (True, ""))
    monkeypatch.setattr(tagging, "assign_tag", lambda c: "Catalyst")
    monkeypatch.setattr(scoring, "score", lambda c: 1.0)
    yield
    for c in (cr._explain_cache, cr._explain_inflight, cr._pool_cache, cr._pool_refreshing):
        c.clear()


def _counting(monkeypatch, delay=0.0):
    calls = []

    def fake(*a, **k):
        calls.append(1)
        time.sleep(delay)
        return [{"ticker": "AAA"}, {"ticker": "BBB"}]
    monkeypatch.setattr(sources, "collect_all", fake)
    return calls


def test_two_tickers_share_ONE_source_pull(monkeypatch):
    calls = _counting(monkeypatch)
    assert cr._explain_cached("AAA", MD)["found"] is True
    assert cr._explain_cached("ZZZ", MD)["verdict"] == "not_evaluated"   # absent: a lookup, no pull
    assert cr._explain_cached("BBB", MD)["found"] is True
    assert len(calls) == 1


def test_concurrent_first_lookups_of_different_tickers_pull_once(monkeypatch):
    calls = _counting(monkeypatch, delay=0.2)
    ts = [threading.Thread(target=cr._explain_cached, args=(s, MD)) for s in ("AAA", "BBB", "CCC", "DDD")]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert len(calls) == 1


def test_a_stale_pool_answers_at_once_and_refreshes_in_the_background(monkeypatch):
    calls = _counting(monkeypatch)
    cr._explain_cached("AAA", MD)
    # age the pool past its TTL but inside the stale window
    at, pool = cr._pool_cache[MD]
    cr._pool_cache[MD] = (at - cr.POOL_TTL_SECONDS - 5, pool)
    cr._explain_cache.clear()
    gate = threading.Event()

    def slow(*a, **k):
        gate.wait(5)
        calls.append(1)
        return [{"ticker": "AAA"}]
    monkeypatch.setattr(sources, "collect_all", slow)
    t0 = time.time()
    res = cr._explain_cached("BBB", MD)
    assert time.time() - t0 < 1.0            # did not wait on the slow pull
    assert res["found"] is True              # answered from the stale pool
    gate.set()
    for _ in range(50):
        if MD not in cr._pool_refreshing:
            break
        time.sleep(0.05)
    assert len(calls) == 2                   # exactly one background refresh


def test_a_shared_pool_is_never_mutated_by_one_tickers_scoring(monkeypatch):
    _counting(monkeypatch)
    cr._explain_cached("AAA", MD)
    assert all("tag" not in c and "score" not in c for c in cr._pool_cache[MD][1])
