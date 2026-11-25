"""/api/bars runs on its own thread limiters, warms on a smaller share (2026-11-25, scale and reliability).

#2741's diagnosis: the route took its thread hops (the sync `require_bars_access` dependency, `run_in_threadpool(
serve_bars_http)`) through anyio's DEFAULT limiter, 40 tokens shared by EVERY sync route on the pod (auth, notebook,
screener...). A flood of chart warms, each waiting on a provider fetch, could hold the whole pool: an interactive chart
ask and any unrelated sync route then queued behind it. Now /api/bars (full, `since=`, `to=`) has its own limiters: an
interactive one (BARS_THREADS) and a SMALLER one for warms (`warm=1`, BARS_WARM_THREADS), so a warm flood can take
neither the interactive share nor the default pool. Server-Timing shows the wait (`bars-wait`). All data synthetic.
"""
import asyncio
import threading
import time

import anyio
import httpx
import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from api.routers import bars as bars_router
from tests.authclients import sign_in_bars_caller

N_WARMS = 60          # more than the default pool's 40 tokens


@pytest.fixture(autouse=True)
def _paid_bars_caller(monkeypatch):
    sign_in_bars_caller(monkeypatch)
    monkeypatch.delenv("BARS_ORIGIN_URL", raising=False)


def _app():
    app = FastAPI()
    app.include_router(bars_router.router)

    @app.get("/unrelated-sync-route")
    def _unrelated():
        return {"ok": True}
    return app


def _fake_serve(monkeypatch, gate, seen):
    def serve(ticker, tf, bars=200, since="", to="", warm=0, session=""):
        with seen["lock"]:
            seen["warm_now" if warm else "live_now"] += 1
            seen["warm_max"] = max(seen["warm_max"], seen["warm_now"])
        try:
            if warm:
                gate.wait(20)                                  # a warm waiting on a provider fetch
            return JSONResponse(content={"ticker": ticker, "tf": tf, "bars": []})
        finally:
            with seen["lock"]:
                seen["warm_now" if warm else "live_now"] -= 1
    monkeypatch.setattr(bars_router, "serve_bars_http", serve)


def _seen():
    return {"lock": threading.Lock(), "warm_now": 0, "live_now": 0, "warm_max": 0}


async def _flood_then(c, ask, gate, seen):
    warms = [asyncio.ensure_future(c.get(f"/api/bars/W{i:03d}?tf=5&bars=600&warm=1")) for i in range(N_WARMS)]
    for _ in range(100):                                     # until the flood holds every thread it can get
        await asyncio.sleep(0.02)
        if seen["warm_now"] >= min(N_WARMS, 8):
            break
    await asyncio.sleep(0.2)
    try:
        return await ask()
    finally:
        gate.set()
        await asyncio.gather(*warms, return_exceptions=True)


def test_a_warm_flood_never_stalls_an_interactive_bars_ask_or_an_unrelated_sync_route(monkeypatch):
    gate, seen = threading.Event(), _seen()
    _fake_serve(monkeypatch, gate, seen)

    async def go():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=_app()), base_url="http://t", timeout=30) as c:
            async def ask():
                t0 = time.monotonic()
                live = await asyncio.wait_for(c.get("/api/bars/AAPL?tf=5&bars=600"), 2.0)
                t_live = time.monotonic() - t0
                t0 = time.monotonic()
                other = await asyncio.wait_for(c.get("/unrelated-sync-route"), 2.0)
                return live, t_live, other, time.monotonic() - t0
            return await _flood_then(c, ask, gate, seen)
    live, t_live, other, t_other = asyncio.run(go())
    assert live.status_code == 200 and t_live < 1.0, f"the interactive ask waited {t_live:.2f} s behind the warms"
    assert other.status_code == 200 and t_other < 1.0, f"an unrelated sync route waited {t_other:.2f} s"
    assert "bars-wait" in live.headers.get("server-timing", ""), live.headers.get("server-timing")


def test_the_warm_share_is_bounded_and_smaller_than_the_interactive_share(monkeypatch):
    assert 1 <= bars_router.BARS_WARM_THREADS < bars_router.BARS_THREADS
    gate, seen = threading.Event(), _seen()
    _fake_serve(monkeypatch, gate, seen)

    async def go():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=_app()), base_url="http://t", timeout=30) as c:
            async def ask():
                return seen["warm_max"]
            return await _flood_then(c, ask, gate, seen)
    assert asyncio.run(go()) <= bars_router.BARS_WARM_THREADS


def test_control_an_unrelated_sync_route_does_wait_when_the_default_pool_is_full():
    """Control: the condition the first rail guards is real (a sync route waits while the default pool is full)."""
    async def go():
        lim = anyio.to_thread.current_default_thread_limiter()
        holders = [object() for _ in range(int(lim.total_tokens))]
        for h in holders:
            await lim.acquire_on_behalf_of(h)
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=_app()), base_url="http://t") as c:
                try:
                    await asyncio.wait_for(c.get("/unrelated-sync-route"), 0.5)
                    return "answered"
                except asyncio.TimeoutError:
                    return "waited"
        finally:
            for h in holders:
                lim.release_on_behalf_of(h)
    assert asyncio.run(go()) == "waited"
