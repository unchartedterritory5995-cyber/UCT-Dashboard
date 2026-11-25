"""`/api/live-prices` answers are never cacheable (2026-11-25, review of PR #2733).

The poll's `Date` header is the page's sample of the server's clock for every chart roll decision
(app/src/lib/serverClock.js). A cached answer carries its ORIGINAL `Date`, so the client refuses any answer a cache could
have served or kept. This route is the steady sample source, so a future cache rule on it would silently cost every
member the server clock. `Cache-Control: no-store` says so on the wire, on every answer:
    NS1 a normal answer (the whole-request cache path)
    NS2 the error answers (the two 400s, the vendor 503), which are returned JSONResponses FastAPI does not merge into
Mutation proof: drop the route's header -> NS1 RED; drop `_error_answer`'s -> NS2 RED.
"""
from __future__ import annotations

import hashlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user
from api.routers import live_prices as lp
from api.services.cache import TTLCache

MEMBER = {"id": "u1", "email": "m@example.com", "role": "member"}
WHOLE_KEY = f"live_prices_{hashlib.md5('AAPL'.encode()).hexdigest()}"
PAYLOAD = {"AAPL": {"price": 101.5, "change_pct": 0.4}}


@pytest.fixture
def client(monkeypatch):
    c = TTLCache(max_size=64)
    c.set(WHOLE_KEY, PAYLOAD, ttl=600)
    monkeypatch.setattr(lp, "cache", c)   # a cache of this test's own: the module's shared one is never written
    app = FastAPI()
    app.include_router(lp.router)
    app.dependency_overrides[get_current_user] = lambda: MEMBER
    return TestClient(app)


def test_NS1_a_normal_answer_is_no_store(client):
    r = client.get("/api/live-prices", params={"tickers": "AAPL"})
    assert r.status_code == 200
    assert r.json()["AAPL"]["price"] == 101.5
    assert r.headers.get("cache-control") == "no-store"


@pytest.mark.parametrize("params, status", [
    ({"tickers": " , "}, 400),
    ({"tickers": ",".join(f"T{i}" for i in range(lp._MAX_TICKERS + 1))}, 400),
    ({"tickers": "ZZZQ"}, 503),
])
def test_NS2_the_error_answers_are_no_store_too(client, monkeypatch, params, status):
    monkeypatch.setattr(lp, "_get_client", lambda: None)   # not cached, no client: the outage answer
    r = client.get("/api/live-prices", params=params)
    assert r.status_code == status
    assert r.headers.get("cache-control") == "no-store"
