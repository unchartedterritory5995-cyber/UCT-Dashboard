"""/api/bars-history answers gzip WITH a Content-Length, so Cloudflare Cache Reserve can keep it.

Cache Reserve (the persistent tier behind the edge) stores only responses with a Content-Length;
chunked ones are refused. In production a middleware inside GZipMiddleware re-streams every body in
several messages, so GZip took its streaming branch and the immutable deep history went out chunked
whenever the client asked for gzip (Cloudflare always does): measured 2026-11-19 against the origin,
gzip -> chunked with no length, identity -> content-length 873380. The deep daily history then lived
only in the ordinary edge cache and was evicted within hours (0 of 100 sweep-stocked tickers cached
at 10:00 ET). `bars.gzip_with_length` gzips the body once, with its length.

The middleware stack here reproduces production's order: GZip OUTSIDE a body-re-streaming
(BaseHTTPMiddleware) layer. A CONTROL route proves that stack really drops the length for an
ordinary large JSON response, so the main test cannot pass by the stack never streaming.
"""
import gzip
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.gzip import GZipMiddleware

from api.routers import bars as bars_mod
from api.routers.bars import router, gzip_with_length
from tests.authclients import sign_in_bars_caller


@pytest.fixture(autouse=True)
def _paid_bars_caller(monkeypatch):
    sign_in_bars_caller(monkeypatch)


BIG = json.dumps({"ticker": "KO", "tf": "D", "sealed": True,
                  "bars": [{"t": f"2001-01-{i % 28 + 1:02d}", "o": i, "h": i, "l": i, "c": i, "v": i} for i in range(4000)]}).encode()


class _Restream(BaseHTTPMiddleware):
    """Like production's inner middlewares: call_next re-streams the body in several messages."""
    async def dispatch(self, request, call_next):
        return await call_next(request)


def _stack_client():
    app = FastAPI()
    app.include_router(router)

    @app.get("/control/big")
    def _big():
        return JSONResponse(content=json.loads(BIG))

    app.add_middleware(_Restream)                    # inner
    app.add_middleware(GZipMiddleware, minimum_size=1000, compresslevel=5)   # outer, as in api/main.py
    return TestClient(app)


def _fake_worker():
    resp = MagicMock()
    resp.content = BIG
    resp.status_code = 200
    resp.headers = {"content-type": "application/json", "cache-control": "public, max-age=31536000, immutable",
                    "server-timing": 'bars;desc="history-read";dur=4000'}
    client = MagicMock()
    client.get = AsyncMock(return_value=resp)
    return client


def test_control_the_stack_drops_the_length_of_an_ordinary_gzip_response():
    r = _stack_client().get("/control/big", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert r.headers.get("content-encoding") == "gzip"
    assert "content-length" not in r.headers          # the production defect, reproduced


def test_proxied_deep_history_goes_out_gzip_with_its_length(monkeypatch):
    monkeypatch.setenv("BARS_HISTORY_PROXY_ENABLED", "1")
    monkeypatch.setenv("BARS_HISTORY_ORIGIN_URL", "http://worker.internal:8080")
    monkeypatch.setattr(bars_mod, "_bars_history_proxy_client", _fake_worker())
    r = _stack_client().get("/api/bars-history/KO?tf=D&bars=12500&d=2026-11-18", headers={"Accept-Encoding": "gzip, br"})
    assert r.status_code == 200
    assert r.headers.get("content-encoding") == "gzip"
    assert r.headers.get("content-length") is not None
    assert r.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert "accept-encoding" in r.headers.get("vary", "").lower()
    assert r.content == BIG                           # the client (httpx) inflates it: same bytes


def test_a_client_without_gzip_gets_the_plain_body_with_its_length(monkeypatch):
    monkeypatch.setenv("BARS_HISTORY_PROXY_ENABLED", "1")
    monkeypatch.setenv("BARS_HISTORY_ORIGIN_URL", "http://worker.internal:8080")
    monkeypatch.setattr(bars_mod, "_bars_history_proxy_client", _fake_worker())
    r = _stack_client().get("/api/bars-history/KO?tf=D&bars=12500&d=2026-11-18", headers={"Accept-Encoding": "identity"})
    assert r.status_code == 200
    assert r.headers.get("content-encoding") is None
    assert int(r.headers["content-length"]) == len(BIG)


def test_the_local_fallback_path_gets_the_length_too(monkeypatch):
    monkeypatch.delenv("BARS_HISTORY_PROXY_ENABLED", raising=False)
    with patch.object(bars_mod, "serve_bars_history",
                      return_value=JSONResponse(content=json.loads(BIG), headers={"Cache-Control": "public, max-age=31536000, immutable"})):
        r = _stack_client().get("/api/bars-history/KO?tf=D&bars=12500&d=2026-11-18", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert r.headers.get("content-encoding") == "gzip"
    assert r.headers.get("content-length") is not None
    assert r.json() == json.loads(BIG)


class TestGzipWithLength:
    def _json(self, body=BIG, status=200, **headers):
        r = JSONResponse(content=json.loads(body), status_code=status)
        for k, v in headers.items():
            r.headers[k.replace("_", "-")] = v
        return r

    def test_gzips_once_with_exact_length_and_keeps_headers(self):
        src = self._json(cache_control="public, max-age=31536000, immutable", etag='"abc"')
        out = gzip_with_length(src, "gzip, deflate, br")
        assert out.headers["content-encoding"] == "gzip"
        assert int(out.headers["content-length"]) == len(out.body)
        assert gzip.decompress(out.body) == src.body
        assert out.headers["cache-control"] == "public, max-age=31536000, immutable"
        assert out.headers["etag"] == '"abc"'

    def test_the_same_body_always_compresses_to_the_same_bytes(self):
        # mtime=0: one URL, one byte-identical object at every edge and in Cache Reserve
        assert gzip_with_length(self._json(), "gzip").body == gzip_with_length(self._json(), "gzip").body

    @pytest.mark.parametrize("ae", ["", "identity", "br"])
    def test_a_client_that_does_not_accept_gzip_is_untouched(self, ae):
        src = self._json()
        assert gzip_with_length(src, ae) is src

    def test_small_non_200_and_already_encoded_responses_are_untouched(self):
        small = JSONResponse(content={"bars": []})
        assert gzip_with_length(small, "gzip") is small
        not_ok = self._json(status=404)
        assert gzip_with_length(not_ok, "gzip") is not_ok
        enc = self._json(content_encoding="br")
        assert gzip_with_length(enc, "gzip") is enc
