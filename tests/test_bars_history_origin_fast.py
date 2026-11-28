"""Deep W/M history is answered fast by its ORIGIN, and the web's fallback is never cached (2026-11-28 cloud sweep).

The sweep (run 46113707532) measured /api/bars-history W (bars=4000) and M (bars=1200) at 5-22 s of web app time on
cold URLs, while the same read costs 30-100 ms cold and 5-10 ms warm against a store copy, and the time did NOT
follow the rows (CS: 0 rows, 12.3 s; VET W: 845 rows, 72 ms): queueing, not work. The origin (the worker,
`BARS_HISTORY_ORIGIN_URL`) served it as a sync `def` behind a sync gate, two hops through anyio's DEFAULT 40-token
pool on a busy pod, and every concurrent ask of one URL rebuilt it.

Rails, each red on the code before this change:
  1. the worker origin answers while anyio's default pool is full (it waited behind it);
  2. the bars-api origin answers while anyio's default pool is full;
  3. concurrent asks of one URL build it ONCE (single-flight), and a repeat is served from the memo;
  4. a `no-store` answer is never memoized (a refusal or a breadth answer must be rebuilt every time);
  5. the web's own fallback (the deep origin failed) is `no-store` and marked `partial`, never `immutable`, even
     when its `d` matches its own last sealed bar (it was stamped immutable for a year under the deep URL).
All data synthetic.
"""
from __future__ import annotations

import asyncio
from contextlib import contextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import anyio
import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import bars as bars_mod
from api.services import bars_fetch
from tests.authclients import sign_in_bars_caller

SECRET = "origin-fast-secret"
BARS = [{"t": f"2020-01-{d:02d}", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10} for d in range(2, 30)]


@pytest.fixture(autouse=True)
def _fresh_memo():
    bars_mod._history_memo_clear()
    yield
    bars_mod._history_memo_clear()


@contextmanager
def _stored(rows):
    raw = [("row",)] if rows else []
    with patch.object(bars_fetch._sqlite, "get_bars", return_value=raw), \
         patch("api.routers.bars._fmt_sqlite_bars", return_value=list(rows)):
        yield


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


def _worker_app(monkeypatch):
    monkeypatch.setenv("BARS_HISTORY_ORIGIN_ENABLED", "1")
    monkeypatch.setenv("PUSH_SECRET", SECRET)
    from api.worker_main import _build_app
    return _build_app()


def _tier_app():
    from api.bars_api_main import _build_app
    return _build_app()


async def _ask(app, path, headers=None):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        return await asyncio.wait_for(c.get(path, headers=headers or {}), 3.0)


# ── 1-2: off the shared pool ─────────────────────────────────────────────────────────────────────────────────────

def test_the_WORKER_origin_answers_while_the_shared_thread_pool_is_full(monkeypatch):
    app = _worker_app(monkeypatch)
    with _stored(BARS):
        r = asyncio.run(_with_default_pool_full(lambda: _ask(
            app, "/api/bars-history/AAPL?tf=W&bars=4000", {"Authorization": f"Bearer {SECRET}"})))
    assert r.status_code == 200
    assert r.json()["count"] == len(BARS)


def test_the_WORKER_origin_still_refuses_without_the_service_token(monkeypatch):
    """The gate moved onto the event loop; it still decides (and still decides first)."""
    app = _worker_app(monkeypatch)
    with _stored(BARS):
        r = asyncio.run(_with_default_pool_full(lambda: _ask(app, "/api/bars-history/AAPL?tf=W&bars=4000")))
    assert r.status_code == 401


def test_the_TIER_origin_answers_while_the_shared_thread_pool_is_full():
    app = _tier_app()
    with _stored(BARS):
        r = asyncio.run(_with_default_pool_full(lambda: _ask(app, "/api/bars-history/AAPL?tf=M&bars=1200")))
    assert r.status_code == 200
    assert r.json()["count"] == len(BARS)


def test_control_a_sync_route_DOES_wait_while_the_default_pool_is_full():
    """Control: the condition the two rails above survive is real."""
    app = FastAPI()

    @app.get("/sync-probe")
    def _probe():
        return {"ok": True}

    with pytest.raises(asyncio.TimeoutError):
        asyncio.run(_with_default_pool_full(lambda: _ask(app, "/sync-probe")))


# ── 3-4: one build per URL, a short memo ─────────────────────────────────────────────────────────────────────────

def _counting_serve(calls, cache_control=None, delay=0.05):
    real = bars_mod.serve_bars_history

    def serve(*a, **kw):
        calls.append(a)
        import time
        time.sleep(delay)            # long enough that the concurrent asks overlap
        out = real(*a, **kw)
        if cache_control:
            out.headers["Cache-Control"] = cache_control
        return out
    return serve


def test_concurrent_asks_of_one_URL_build_it_ONCE_and_a_repeat_is_memoized(monkeypatch):
    calls = []
    monkeypatch.setattr(bars_mod, "serve_bars_history", _counting_serve(calls))

    async def go():
        rs = await asyncio.gather(*[bars_mod.serve_bars_history_origin("AAPL", "W", 4000, "", "", "gzip")
                                    for _ in range(8)])
        again = await bars_mod.serve_bars_history_origin("AAPL", "W", 4000, "", "", "gzip")
        return rs, again

    with _stored(BARS):
        rs, again = asyncio.run(go())
    assert len(calls) == 1, f"{len(calls)} builds for 8 concurrent asks and a repeat of one URL"
    bodies = {bytes(r.body) for r in rs + [again]}
    assert len(bodies) == 1
    assert all(r.status_code == 200 for r in rs + [again])
    assert all(r.headers.get("cache-control") == rs[0].headers.get("cache-control") for r in rs + [again])


def test_a_DIFFERENT_url_is_a_different_build(monkeypatch):
    calls = []
    monkeypatch.setattr(bars_mod, "serve_bars_history", _counting_serve(calls, delay=0))

    async def go():
        await bars_mod.serve_bars_history_origin("AAPL", "W", 4000, "", "", "")
        await bars_mod.serve_bars_history_origin("AAPL", "M", 1200, "", "", "")
        await bars_mod.serve_bars_history_origin("AAPL", "W", 4000, "", "2020-01-29", "")
    with _stored(BARS):
        asyncio.run(go())
    assert len(calls) == 3


def test_a_NO_STORE_answer_is_never_memoized(monkeypatch):
    calls = []
    monkeypatch.setattr(bars_mod, "serve_bars_history", _counting_serve(calls, cache_control="no-store", delay=0))

    async def go():
        await bars_mod.serve_bars_history_origin("AAPL", "W", 4000, "", "", "")
        await bars_mod.serve_bars_history_origin("AAPL", "W", 4000, "", "", "")
    with _stored(BARS):
        asyncio.run(go())
    assert len(calls) == 2


# ── 5: the web's fallback is never cached ────────────────────────────────────────────────────────────────────────

@pytest.fixture
def _paid(monkeypatch):
    sign_in_bars_caller(monkeypatch)


def _web_client():
    app = FastAPI()
    app.include_router(bars_mod.router)
    return TestClient(app)


def test_the_webs_FALLBACK_is_no_store_and_marked_partial_never_immutable(monkeypatch, _paid):
    monkeypatch.setenv("BARS_HISTORY_PROXY_ENABLED", "1")
    monkeypatch.setenv("BARS_HISTORY_ORIGIN_URL", "http://worker.railway.internal:8080")
    broken = MagicMock()
    broken.get = AsyncMock(side_effect=Exception("worker timed out"))
    monkeypatch.setattr(bars_mod, "_bars_history_proxy_client", broken)
    with _stored(BARS):
        # d == the web store's own last sealed bar: before this change this was stamped immutable for a year.
        r = _web_client().get("/api/bars-history/AAPL?tf=D&d=2020-01-29")
    assert r.status_code == 200
    cc = r.headers.get("cache-control", "")
    assert "immutable" not in cc and "max-age" not in cc and "no-store" in cc, cc
    assert r.headers.get("x-bars-history") == "partial"
    assert r.json()["partial"] is True and r.json()["count"] == len(BARS)


def test_control_the_same_web_read_WITHOUT_a_proxy_failure_is_still_immutable(monkeypatch, _paid):
    """Control: the fallback rail is not passing because immutability broke for everyone."""
    monkeypatch.delenv("BARS_HISTORY_PROXY_ENABLED", raising=False)
    with _stored(BARS):
        r = _web_client().get("/api/bars-history/AAPL?tf=D&d=2020-01-29")
    assert "immutable" in r.headers.get("cache-control", "")
    assert "partial" not in r.json()
