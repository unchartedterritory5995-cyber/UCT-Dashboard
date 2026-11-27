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


def test_an_interactive_bars_ask_answers_while_the_default_pool_is_full(monkeypatch):
    """Both of the route's hops (the bars gate and the serve) are on its own limiter: with every token of the shared
    default pool held (other sync routes busy), a chart ask still answers."""
    gate, seen = threading.Event(), _seen()
    _fake_serve(monkeypatch, gate, seen)

    async def go():
        lim = anyio.to_thread.current_default_thread_limiter()
        holders = [object() for _ in range(int(lim.total_tokens))]
        for h in holders:
            await lim.acquire_on_behalf_of(h)
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=_app()), base_url="http://t") as c:
                return await asyncio.wait_for(c.get("/api/bars/AAPL?tf=5&bars=600"), 2.0)
        finally:
            for h in holders:
                lim.release_on_behalf_of(h)
    r = asyncio.run(go())
    gate.set()
    assert r.status_code == 200


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


# ── (review of #2752, HIGH-1) the warm share must leave threads for the warm cache-hit and shed branches ─────────────
# `serve_bars_http`'s warm path takes a warm-serve slot (`bars_fetch._warm_serve_sem`, `_WARM_SERVE_MAX`) without
# blocking; when every slot is held it serves a cheap cache hit or sheds a 503 the client retries. With the warm
# limiter EQUAL to the slots, six warms inside the serve held every warm thread too, so the 7th warm queued for a
# thread behind six provider fetches instead of reaching either branch. The state below is exactly six warms inside
# the serve: each holds one warm-serve slot and one warm thread.

@pytest.fixture
def _own_bars_store(tmp_path, monkeypatch):
    """This case's own empty bars.db, so AAPL is cold here whatever an earlier test wrote (see test_bars_warm_shed)."""
    from api.services import bars_sqlite
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    bars_sqlite.bump_db_epoch()
    bars_sqlite.init_db()
    yield
    bars_sqlite.bump_db_epoch()


def _seventh_warm(path, warm_up="/api/bars/ZZWARMHIT?tf=D&bars=200&warm=1"):
    from api.services import bars_fetch

    async def go():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=_app()), base_url="http://t", timeout=30) as c:
            slots = 0
            while bars_fetch._warm_serve_sem.acquire(blocking=False):
                slots += 1
            lim, holders = bars_router._bars_limiter(True), []
            try:
                # first-call costs (imports) paid before the clock starts, on the same cache branch (the slots are
                # full, so it never reaches a provider fetch)
                await c.get(warm_up)
                for _ in range(slots):
                    h = object()
                    await lim.acquire_on_behalf_of(h)
                    holders.append(h)
                t0 = time.monotonic()
                try:
                    r = await asyncio.wait_for(c.get(path), 2.0)
                except asyncio.TimeoutError:
                    r = None
                return r, time.monotonic() - t0, slots
            finally:
                for h in holders:
                    lim.release_on_behalf_of(h)
                for _ in range(slots):
                    bars_fetch._warm_serve_sem.release()
    return asyncio.run(go())


def _cache_hit_bars():
    from api.services.cache import cache
    cache.set("bars_ZZWARMHIT_D_200", {"ticker": "ZZWARMHIT", "tf": "D",
                                       "bars": [{"t": "2026-08-31", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10}]},
              ttl=60)


def test_with_six_warms_holding_the_serve_slots_a_7th_warm_answers_a_CACHE_HIT_at_once(_own_bars_store):
    _cache_hit_bars()
    r, took, slots = _seventh_warm("/api/bars/ZZWARMHIT?tf=D&bars=200&warm=1")
    assert slots == bars_router._bars_fetch._WARM_SERVE_MAX
    assert r is not None, "the 7th warm, already in the store, waited 2 s for a warm thread behind the six"
    assert r.status_code == 200 and r.json().get("bars"), (r.status_code, r.text[:200])
    assert took < 0.2, f"a cache-hit warm took {took * 1000:.0f} ms with the warm-serve slots full"


def test_with_six_warms_holding_the_serve_slots_a_7th_COLD_warm_is_shed_at_once(_own_bars_store):
    from api.services.cache import cache
    _cache_hit_bars()
    try:
        cache.invalidate("bars_AAPL_D_200")
    except Exception:
        pass
    r, took, slots = _seventh_warm("/api/bars/AAPL?tf=D&bars=200&warm=1")
    assert r is not None, "the 7th cold warm waited 2 s for a warm thread instead of the fast 503 the client retries"
    assert r.status_code == 503 and r.headers.get("X-Bars-Shed") == "warm-shed", (r.status_code, dict(r.headers))
    assert took < 0.2, f"the shed took {took * 1000:.0f} ms"


# ── (review of #2752, MEDIUM-1) tier down: the cheap shed check never waits behind the serves it exists to avoid ─────
# Tier unreachable => every ask falls to the web's local serve, the interactive threads fill with provider fetches,
# and `_tier_down_cold_tail` (one indexed read: shed a cold-stale intraday tail instead of a provider fetch) must still
# answer at once, as must the gate's hop before it.

def _tier_down(monkeypatch, cold: bool):
    monkeypatch.setenv("BARS_ORIGIN_URL", "http://tier.invalid")
    monkeypatch.setattr(bars_router, "_bars_proxy_should_route", lambda ticker, warm: True)

    async def _unreachable(*a, **k):
        raise httpx.ConnectError("tier down")
    monkeypatch.setattr(bars_router, "_proxy_bars_to_tier", _unreachable)
    monkeypatch.setattr(bars_router._bars_fetch._sqlite, "get_last_ts", lambda ticker, tf: 1_700_000_000)
    monkeypatch.setattr(bars_router._bars_fetch, "_is_cold_stale_intraday", lambda tf, ts, now=None: cold)


def _ask_with_interactive_full(path, wait_s):
    async def go():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=_app()), base_url="http://t", timeout=30) as c:
            lim = bars_router._bars_limiter(False)
            holders = [object() for _ in range(int(lim.total_tokens))]
            for h in holders:
                await lim.acquire_on_behalf_of(h)
            try:
                t0 = time.monotonic()
                try:
                    r = await asyncio.wait_for(c.get(path), wait_s)
                except asyncio.TimeoutError:
                    r = None
                return r, time.monotonic() - t0
            finally:
                for h in holders:
                    lim.release_on_behalf_of(h)
    return asyncio.run(go())


def test_tier_down_a_COLD_TAIL_ask_is_shed_at_once_while_every_interactive_thread_is_busy(monkeypatch):
    gate, seen = threading.Event(), _seen()
    _fake_serve(monkeypatch, gate, seen)
    _tier_down(monkeypatch, cold=True)
    r, took = _ask_with_interactive_full("/api/bars/AAPL?tf=5&bars=600", 2.0)
    gate.set()
    assert r is not None, "tier down, the cold-tail shed waited 2 s behind the busy interactive serves"
    assert r.status_code == 503 and r.headers.get("X-Bars-Shed") == "tier-unreachable", (r.status_code, r.text[:200])
    assert took < 0.2, f"the tier-down shed took {took * 1000:.0f} ms"


def test_control_tier_down_a_FRESH_tail_ask_does_wait_for_an_interactive_thread(monkeypatch):
    """Control: the rail above holds every interactive thread for real (an ask that needs a serve waits)."""
    gate, seen = threading.Event(), _seen()
    _fake_serve(monkeypatch, gate, seen)
    _tier_down(monkeypatch, cold=False)
    r, _took = _ask_with_interactive_full("/api/bars/AAPL?tf=5&bars=600", 0.5)
    gate.set()
    assert r is None, "an ask that needs a local serve answered with every interactive thread held"
