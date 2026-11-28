"""The deep-history proxy's circuit breaker (/api/bars-history -> the worker origin), 2026-11-28.

With a hung worker every request held a web connection for up to httpx's 15 s read on the one shared AsyncClient
(100-connection pool) before falling back to the shallow store; at 500 members' retries (~17 req/s) the pool saturates.
After a proxy failure or timeout the proxy is SKIPPED for `HISTORY_PROXY_BREAKER_SECONDS`: requests answer the shallow
store at once, still `partial` (no-store, marked). Then ONE request probes (half-open): success closes the breaker,
failure re-opens it. Synthetic store and a fake worker.
"""
from __future__ import annotations

import asyncio
import time
from contextlib import contextmanager
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from api.routers import bars as bars_mod
from api.routers.bars import router
from api.services import bars_fetch
from tests.authclients import sign_in_bars_caller

BARS = [{"t": "2020-01-02", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10},
        {"t": "2020-01-03", "o": 1, "h": 2, "l": 0.5, "c": 1.6, "v": 10}]


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    sign_in_bars_caller(monkeypatch)
    monkeypatch.setenv("BARS_HISTORY_PROXY_ENABLED", "1")
    monkeypatch.setenv("BARS_HISTORY_ORIGIN_URL", "http://worker.internal:8080")
    _reset = getattr(bars_mod, "_history_breaker_reset_for_tests", lambda: None)   # absent before the breaker landed
    _reset()
    yield
    _reset()


@contextmanager
def _web_store():
    with patch.object(bars_fetch._sqlite, "get_bars", return_value=[("row",)]), \
         patch("api.routers.bars._fmt_sqlite_bars", return_value=list(BARS)):
        yield


class _Worker:
    """A fake worker origin: `fail` raises (a timeout), else a deep answer; `hang` seconds before either."""

    def __init__(self, fail=True, hang=0.0):
        self.fail, self.hang, self.calls = fail, hang, 0

    async def __call__(self, ticker, tf, bars, v, d, origin):
        self.calls += 1
        if self.hang:
            await asyncio.sleep(self.hang)
        if self.fail:
            raise TimeoutError("worker read timed out")
        return JSONResponse(content={"ticker": ticker, "tf": tf, "bars": BARS, "sealed": True, "deep": True},
                            headers={"Cache-Control": "public, max-age=31536000, immutable"})


def _ask(client):
    return client.get("/api/bars-history/AAPL?tf=D&d=2020-01-03")


def _client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _assert_partial(r):
    assert r.status_code == 200
    assert r.headers.get("x-bars-history") == "partial" and r.headers.get("cache-control") == "no-store"
    assert r.json().get("partial") is True


def test_after_a_failure_the_proxy_is_skipped_and_the_shallow_store_answers_at_once(monkeypatch):
    worker = _Worker(fail=True)
    monkeypatch.setattr(bars_mod, "_proxy_bars_history_to_worker", worker)
    c = _client()
    with _web_store():
        _assert_partial(_ask(c))                                # the failure: falls back, and opens the breaker
        worker.hang = 5.0                                       # were it asked again, it would hold the request
        t0 = time.monotonic()
        for _ in range(3):
            _assert_partial(_ask(c))
        took = time.monotonic() - t0
    assert worker.calls == 1, f"the worker was asked {worker.calls} times while the breaker was open"
    assert took < 3.0, f"3 requests took {took:.2f} s with the breaker open"


def test_after_the_window_one_probe_that_succeeds_closes_the_breaker(monkeypatch):
    monkeypatch.setattr(bars_mod, "HISTORY_PROXY_BREAKER_SECONDS", 0.2)
    worker = _Worker(fail=True)
    monkeypatch.setattr(bars_mod, "_proxy_bars_history_to_worker", worker)
    c = _client()
    with _web_store():
        _assert_partial(_ask(c))
        time.sleep(0.3)
        worker.fail = False
        r = _ask(c)                                             # the probe
        assert r.json().get("deep") is True and "immutable" in r.headers.get("cache-control", "")
        r = _ask(c)                                             # closed: proxied again
        assert r.json().get("deep") is True
    assert worker.calls == 3


def test_a_failed_probe_re_opens_the_breaker(monkeypatch):
    monkeypatch.setattr(bars_mod, "HISTORY_PROXY_BREAKER_SECONDS", 0.2)
    worker = _Worker(fail=True)
    monkeypatch.setattr(bars_mod, "_proxy_bars_history_to_worker", worker)
    c = _client()
    with _web_store():
        _assert_partial(_ask(c))
        time.sleep(0.3)
        _assert_partial(_ask(c))                                # the probe fails
        _assert_partial(_ask(c))                                # open again: not asked
    assert worker.calls == 2


def test_half_open_lets_exactly_one_probe_through(monkeypatch):
    monkeypatch.setattr(bars_mod, "HISTORY_PROXY_BREAKER_SECONDS", 0.1)
    bars_mod._history_proxy_failed()
    assert bars_mod._history_proxy_allowed() is False          # inside the window
    time.sleep(0.15)
    assert bars_mod._history_proxy_allowed() is True           # the one probe
    assert bars_mod._history_proxy_allowed() is False          # every other request while it is out
    bars_mod._history_proxy_succeeded()
    assert bars_mod._history_proxy_allowed() is True and bars_mod._history_proxy_allowed() is True


def test_control_a_healthy_worker_is_always_proxied(monkeypatch):
    worker = _Worker(fail=False)
    monkeypatch.setattr(bars_mod, "_proxy_bars_history_to_worker", worker)
    c = _client()
    with _web_store():
        for _ in range(3):
            assert _ask(c).json().get("deep") is True
    assert worker.calls == 3
