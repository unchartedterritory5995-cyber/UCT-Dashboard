"""The kill reaches an OPEN charting page in seconds: `/api/live-prices` carries the kill cookies while a kill is in force.

Review of #2580. An operator's kill (DEVICE_STORE_ENABLED=0 / purge, or CHART_SPEED_ENABLED=0) reached an open page only
with its next auth answer (api/routers/auth.py `_set_chart_speed_cookie`: signup, login, the TOTP step, /me, smoke-login):
a tab becoming visible, or every 10 minutes while a bars stream is open (barsStreamManager EDGE_REFRESH_MS). A web
restart (which setting the variable causes) does not make a page re-auth: its streams just reconnect. Every live chart
already polls `/api/live-prices` on web every 2 s (30 s with the market fully closed) while visible
(hooks/livePriceStore, through useRealtimePrices), so that answer now SETS the same cookies, with the same attributes,
while a kill is in force, and touches nothing otherwise: with no kill no response changes for anyone (no deletion
either: clearing stays the auth answers' job).
    LP1 no kill: no kill cookie at all on the answer (not even a deletion)
    LP2 the device kill (0, purge): its cookie, and only it
    LP3 the chart speed kill: its cookie, and only it
    LP4 the cookie is byte-for-byte the one the auth path writes for the same kill
    LP5 read per request: a kill set between two polls is on the next one; lifted, the next one carries nothing
    LP6 a failure reading the kill never costs the poll its answer

Mutation proof (run before calling these done):
    1. the route does not call the setter                 -> LP2, LP3, LP4, LP5 RED
    2. the setter clears when there is no kill (the auth helper) -> LP1, LP5 RED
    3. the setter ignores the device kill                 -> LP2, LP4, LP5 RED
"""
from __future__ import annotations

import hashlib
import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.responses import Response

from api.middleware.auth_middleware import get_current_user
from api.routers import auth
from api.routers import live_prices as lp

ENVS = ("CHART_SPEED_ENABLED", "DEVICE_STORE_ENABLED")
MEMBER = {"id": "u1", "email": "m@example.com", "role": "member"}


@pytest.fixture(autouse=True)
def _restore_env():
    before = {k: os.environ.get(k) for k in ENVS}
    for k in ENVS:
        os.environ.pop(k, None)
    yield
    for k, v in before.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(lp.router)
    app.dependency_overrides[get_current_user] = lambda: MEMBER
    # the poll's whole-request cache answers it (no vendor call)
    whole_key = f"live_prices_{hashlib.md5('AAPL'.encode()).hexdigest()}"
    lp.cache.set(whole_key, {"AAPL": {"price": 101.5, "change_pct": 0.4}}, ttl=600)
    return TestClient(app)


def _kill_cookies(resp):
    return [h for h in resp.headers.get_list("set-cookie") if h.startswith(("uct_chart_speed=", "uct_device_store="))]


def _poll(client):
    r = client.get("/api/live-prices", params={"tickers": "AAPL"})
    assert r.status_code == 200
    assert r.json()["AAPL"]["price"] == 101.5
    return r


def test_LP1_no_kill_no_cookie_at_all(client):
    assert _kill_cookies(_poll(client)) == []
    os.environ["DEVICE_STORE_ENABLED"] = "1"
    os.environ["CHART_SPEED_ENABLED"] = "true"
    assert _kill_cookies(_poll(client)) == []


@pytest.mark.parametrize("value, cookie", [("0", "uct_device_store=0;"), ("purge", "uct_device_store=purge;"), ("off", "uct_device_store=0;")])
def test_LP2_the_device_kill_sets_its_cookie_only(client, value, cookie):
    os.environ["DEVICE_STORE_ENABLED"] = value
    got = _kill_cookies(_poll(client))
    assert len(got) == 1 and got[0].startswith(cookie), got


def test_LP3_the_chart_speed_kill_sets_its_cookie_only(client):
    os.environ["CHART_SPEED_ENABLED"] = "0"
    got = _kill_cookies(_poll(client))
    assert len(got) == 1 and got[0].startswith("uct_chart_speed=0;"), got


def test_LP4_the_same_cookie_the_auth_path_writes(client):
    os.environ["DEVICE_STORE_ENABLED"] = "purge"
    os.environ["CHART_SPEED_ENABLED"] = "0"
    ref = Response()
    auth._set_chart_speed_cookie(ref)
    want = sorted(h for h in ref.headers.getlist("set-cookie") if h.startswith(("uct_chart_speed=", "uct_device_store=")))
    assert len(want) == 2
    assert sorted(_kill_cookies(_poll(client))) == want


def test_LP5_read_per_request(client):
    assert _kill_cookies(_poll(client)) == []
    os.environ["DEVICE_STORE_ENABLED"] = "0"
    assert [c.split(";")[0] for c in _kill_cookies(_poll(client))] == ["uct_device_store=0"]
    os.environ.pop("DEVICE_STORE_ENABLED")
    assert _kill_cookies(_poll(client)) == []


def test_LP6_a_failure_reading_the_kill_never_costs_the_answer(client, monkeypatch):
    def boom():
        raise RuntimeError("env unreadable")
    monkeypatch.setattr(auth, "_device_store_kill", boom)
    monkeypatch.setattr(auth, "_chart_speed_enabled", boom)
    _poll(client)
