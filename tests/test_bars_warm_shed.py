"""Warm de-prioritization (instant-charts contention fix).

Best-effort background prefetch (`warm=1`: a theme/watchlist opening warms ~20 holdings at
once, across many browsers) must SHED under load so it can never starve the chart the user
actually CLICKED — a NON-warm request that always serves. This is the fix for the
theme-flood "the stock I click takes 5-6s" symptom: the warm flood used to queue ahead of
the click on the shared anyio threadpool.
"""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers.bars import router
from api.services import bars_fetch
from api.services.cache import cache


def _client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _fill_warm_slots():
    got = 0
    while bars_fetch._warm_serve_sem.acquire(blocking=False):
        got += 1
    return got


def _drain_warm_slots(n):
    for _ in range(n):
        bars_fetch._warm_serve_sem.release()


def test_warm_request_sheds_fast_when_slots_full():
    n = _fill_warm_slots()
    try:
        r = _client().get("/api/bars/AAPL?tf=D&bars=200&warm=1")
        assert r.status_code == 503, "a warm request must shed when the warm-serve slots are full"
        assert r.headers.get("Retry-After") == "4"
        body = r.json()
        assert body.get("warming") is True and body.get("bars") == []
    finally:
        _drain_warm_slots(n)


def test_the_clicked_chart_never_sheds_even_when_warm_slots_are_full():
    # A non-warm request (the chart the user clicked) must serve regardless of warm pressure.
    cache.set("bars_AAPL_D_200", {"ticker": "AAPL", "tf": "D", "bars": []}, ttl=60)
    n = _fill_warm_slots()
    try:
        r = _client().get("/api/bars/AAPL?tf=D&bars=200")   # no warm=1
        assert r.status_code == 200, "the clicked (non-warm) chart must serve even under warm-flood pressure"
    finally:
        _drain_warm_slots(n)


def test_warm_request_serves_and_RELEASES_its_slot_when_one_is_free():
    cache.set("bars_AAPL_D_200", {"ticker": "AAPL", "tf": "D", "bars": []}, ttl=60)
    # Ensure all slots are free to start.
    freed = _fill_warm_slots()
    _drain_warm_slots(freed)

    r = _client().get("/api/bars/AAPL?tf=D&bars=200&warm=1")
    assert r.status_code == 200, "a warm request must serve when a slot is free"

    # The slot must have been released in the finally — we can still take every slot.
    n = _fill_warm_slots()
    try:
        assert n == bars_fetch._WARM_SERVE_MAX, "the warm serve must release its slot after serving"
    finally:
        _drain_warm_slots(n)
