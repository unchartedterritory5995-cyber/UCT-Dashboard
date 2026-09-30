"""/api/rs-rankings never rebuilds the universe inside a request (stall 2026-09-30 08:08 ET)."""
from __future__ import annotations

import threading

import pytest

from api.routers import rs_ranking as route
from api.services import rs_ranking as svc
from api.services.cache import cache


@pytest.fixture
def cold(monkeypatch):
    cache.invalidate(svc._CACHE_KEY)
    calls = []
    gate = threading.Event()

    def slow_compute(force=False):
        calls.append(force)
        gate.wait(5)
        return []

    monkeypatch.setattr(svc, "compute_rs_scores", slow_compute)
    monkeypatch.setattr(svc, "_warm_inflight", False)
    yield calls, gate
    gate.set()
    cache.invalidate(svc._CACHE_KEY)


def test_a_cold_cache_answers_503_and_starts_ONE_rebuild_for_many_requests(cold):
    calls, gate = cold
    for _ in range(5):
        r = route.rs_rankings(_user={})
        assert r.status_code == 503
        assert r.headers["retry-after"] == "30"
    gate.set()
    for t in threading.enumerate():
        if t.name == "rs-rankings-kick":
            t.join(5)
    assert calls == [True]                       # one background rebuild, not five


def test_the_request_thread_itself_never_computes(cold, monkeypatch):
    calls, gate = cold
    monkeypatch.setattr(svc, "kick_background_warm", lambda: False)
    monkeypatch.setattr(route, "kick_background_warm", lambda: False)
    route.rs_rankings(_user={})
    assert calls == []


def test_a_warm_cache_is_served(monkeypatch):
    rows = [{"ticker": "NVDA", "rs_score": 1.0, "rs_rank": 99, "returns": {}}]
    cache.set(svc._CACHE_KEY, rows, ttl=60)
    try:
        r = route.rs_rankings(_user={})
        assert r.status_code == 200 and b"NVDA" in r.body
    finally:
        cache.invalidate(svc._CACHE_KEY)
