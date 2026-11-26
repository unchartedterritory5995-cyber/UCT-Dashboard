"""/api/bars-history never waits behind /api/bars (2026-11-25 wide sweep, review of the paint builder's findings).

A pure SQLite read of 173 sealed rows took 6.3 s of app time (Server-Timing `app=6325`; another answer of 8,454 rows took
294 ms): the time is queueing, not work. The route took TWO hops through anyio's DEFAULT thread limiter (40 tokens), the
one every sync route shares: the sync `require_bars_access` dependency (FastAPI runs a sync dependency in that pool) and
`run_in_threadpool(serve_bars_history)`. Under a warm flood the pool is full of `/api/bars` serves waiting on provider
fetches (seconds each), and the cheapest read on the pod waits behind them. The route now takes both hops on its OWN
limiter, and gzips there too (off the event loop). Rail: with every default token held, the history answer still comes.
All data synthetic.
"""
import asyncio
from contextlib import contextmanager
from unittest.mock import patch

import anyio
import httpx
import pytest
from fastapi import FastAPI

from api.routers import bars as bars_router
from api.routers.bars import router
from api.services import bars_fetch
from tests.authclients import sign_in_bars_caller


@pytest.fixture(autouse=True)
def _paid_bars_caller(monkeypatch):
    sign_in_bars_caller(monkeypatch)


@contextmanager
def _stored(rows):
    raw = [("row",)] if rows else []
    with patch.object(bars_fetch._sqlite, "get_bars", return_value=raw), \
         patch("api.routers.bars._fmt_sqlite_bars", return_value=list(rows)):
        yield


BARS = [{"t": f"2020-01-{d:02d}", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10} for d in range(2, 30)]


def _app():
    app = FastAPI()
    app.include_router(router)
    return app


async def _with_default_pool_full(fn):
    """Run `fn()` while every token of anyio's default thread limiter is held (a pod whose shared pool is full)."""
    lim = anyio.to_thread.current_default_thread_limiter()
    holders = [object() for _ in range(int(lim.total_tokens))]
    for h in holders:
        await lim.acquire_on_behalf_of(h)
    try:
        return await fn()
    finally:
        for h in holders:
            lim.release_on_behalf_of(h)


def test_history_answers_while_the_shared_thread_pool_is_full():
    async def go():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=_app()), base_url="http://t") as c:
            async def ask():
                return await asyncio.wait_for(
                    c.get("/api/bars-history/AAPL?tf=D&bars=200"), 3.0)
            return await _with_default_pool_full(ask)
    with _stored(BARS):
        r = asyncio.run(go())
    assert r.status_code == 200
    assert r.json()["count"] == len(BARS)


def test_control_bars_waits_on_the_shared_pool_the_history_does_not():
    """Control: the condition is real (a sync route DOES wait while the default pool is full)."""
    app = _app()

    @app.get("/sync-probe")
    def _probe():
        return {"ok": True}

    async def go():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            async def ask():
                try:
                    await asyncio.wait_for(c.get("/sync-probe"), 0.5)
                    return "answered"
                except asyncio.TimeoutError:
                    return "waited"
            return await _with_default_pool_full(ask)
    assert asyncio.run(go()) == "waited"


def test_the_history_limiter_is_its_own_and_bounded():
    assert bars_router.BARS_HISTORY_THREADS >= 2

    async def go():
        lim = bars_router._history_limiter()
        assert lim is not anyio.to_thread.current_default_thread_limiter()
        return int(lim.total_tokens)
    assert asyncio.run(go()) == bars_router.BARS_HISTORY_THREADS
