"""Edge deep-history: the web's /api/bars-history reverse-proxy to the WORKER origin.

Spec: docs/superpowers/specs/2026-08-31-edge-deep-history. The web pod holds only shallow
history; the worker holds the deep 20 GB db. When BARS_HISTORY_PROXY_ENABLED=1 + an origin
URL is set, the web must FORWARD to the worker (so Cloudflare caches the DEEP response) —
and on any upstream failure it must FALL BACK to its own shallow history, never a 5xx.
"""
from contextlib import contextmanager
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers.bars import router
from api.routers import bars as bars_mod
from api.services import bars_fetch


def _client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


@contextmanager
def _stored(bars):
    raw = [("row",)] if bars else []
    with patch.object(bars_fetch._sqlite, "get_bars", return_value=raw), \
         patch("api.routers.bars._fmt_sqlite_bars", return_value=list(bars)):
        yield


def _fake_worker(content: bytes, cache_control: str):
    """A fake worker origin: an httpx-style AsyncClient whose .get returns `content`."""
    resp = MagicMock()
    resp.content = content
    resp.status_code = 200
    resp.headers = {"content-type": "application/json",
                    "cache-control": cache_control,
                    "server-timing": 'bars;desc="history-read";dur=5000'}
    client = MagicMock()
    client.get = AsyncMock(return_value=resp)
    return client


def test_proxy_off_serves_the_webs_own_history(monkeypatch):
    monkeypatch.delenv("BARS_HISTORY_PROXY_ENABLED", raising=False)
    bars = [{"t": "2020-01-02", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10},
            {"t": "2020-01-03", "o": 1, "h": 2, "l": 0.5, "c": 1.6, "v": 10}]
    with _stored(bars):
        r = _client().get("/api/bars-history/AAPL?tf=D&d=2020-01-03")
    assert r.status_code == 200
    body = r.json()
    assert body["sealed"] is True and body["last_sealed"] == "2020-01-03"
    assert "immutable" in r.headers.get("cache-control", "")


def test_proxy_on_forwards_to_the_worker_and_preserves_cache_headers(monkeypatch):
    monkeypatch.setenv("BARS_HISTORY_PROXY_ENABLED", "1")
    monkeypatch.setenv("BARS_HISTORY_ORIGIN_URL", "http://worker.railway.internal:8080/")
    # The worker returns DEEP history (back to 2006) — the point of the edge origin.
    worker = _fake_worker(
        b'{"ticker":"AMZN","tf":"D","bars":[{"t":"2006-06-19","c":40}],"sealed":true,'
        b'"last_sealed":"2006-06-19","count":1}',
        "public, max-age=31536000, immutable")
    monkeypatch.setattr(bars_mod, "_bars_history_proxy_client", worker)
    # If the web tried to serve locally it would read SQLite — make that blow up so the test
    # fails unless the request was truly proxied.
    with patch.object(bars_fetch._sqlite, "get_bars", side_effect=AssertionError("must not read local db when proxying")):
        r = _client().get("/api/bars-history/AMZN?tf=D&bars=60000&d=2006-06-19")
    assert r.status_code == 200
    body = r.json()
    assert body["bars"][0]["t"] == "2006-06-19", "did not serve the worker's deep response"
    # Cloudflare must see the immutable directive from the worker.
    assert r.headers.get("cache-control") == "public, max-age=31536000, immutable"
    # It actually forwarded to the worker origin URL (trailing slash normalized).
    assert worker.get.await_count == 1
    called_url = worker.get.call_args.args[0]
    assert called_url == "http://worker.railway.internal:8080/api/bars-history/AMZN"


def test_proxy_error_falls_back_to_local_never_5xx(monkeypatch):
    monkeypatch.setenv("BARS_HISTORY_PROXY_ENABLED", "1")
    monkeypatch.setenv("BARS_HISTORY_ORIGIN_URL", "http://worker.railway.internal:8080")
    broken = MagicMock()
    broken.get = AsyncMock(side_effect=Exception("worker unreachable"))
    monkeypatch.setattr(bars_mod, "_bars_history_proxy_client", broken)
    bars = [{"t": "2020-01-02", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10}]
    with _stored(bars):
        r = _client().get("/api/bars-history/AAPL?tf=D&d=2020-01-02")
    assert r.status_code == 200, "an upstream failure must degrade to local, not 5xx"
    assert r.json()["sealed"] is True   # served the web's own shallow history instead
