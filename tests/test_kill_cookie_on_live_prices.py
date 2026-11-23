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
Review of #2583:
    LP6b a kill that cannot be read never costs the OTHER kill its cookie (each kill read in its own try) (LOW-2)
    LP7  the route's error answers (the two 400s, the 503 of a vendor outage with nothing cached) carry the kill too:
         FastAPI merges the injected response's headers only into answers it builds, never into a returned
         JSONResponse (LOW-1)
    LP8  ONE mapping, two writers: a kill added to `auth._kill_cookie_values` reaches the poll (set while in force,
         nothing otherwise) AND the auth path (set, or cleared) (LOW-2)
    LP9  the wire through `api.main.app`, its whole middleware stack (LOW-3)
The fixture polls through a FRESH cache (monkeypatched), never the module's shared one (LOW-3).

Mutation proof (run before calling these done):
    1. the route does not call the setter                 -> LP2, LP3, LP4, LP5, LP6b, LP7, LP9 RED
    2. the setter clears when there is no kill (the auth helper) -> LP1, LP5 RED
    3. the setter ignores the device kill                 -> LP2, LP4, LP5 RED
    4. the error answers carry nothing                    -> LP7 RED
    5. one try around both kills                          -> LP6b RED
    6. the poll writer restates the mapping               -> LP8, LP6b RED
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
from api.services.cache import TTLCache

ENVS = ("CHART_SPEED_ENABLED", "DEVICE_STORE_ENABLED")
MEMBER = {"id": "u1", "email": "m@example.com", "role": "member"}
WHOLE_KEY = f"live_prices_{hashlib.md5('AAPL'.encode()).hexdigest()}"
PAYLOAD = {"AAPL": {"price": 101.5, "change_pct": 0.4}}


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
def fresh_cache(monkeypatch):
    """The poll's whole-request cache answers it (no vendor call), in a cache of this test's own: the module's shared
    `lp.cache` is never written."""
    c = TTLCache(max_size=64)
    c.set(WHOLE_KEY, PAYLOAD, ttl=600)
    monkeypatch.setattr(lp, "cache", c)
    return c


@pytest.fixture
def client(fresh_cache):
    app = FastAPI()
    app.include_router(lp.router)
    app.dependency_overrides[get_current_user] = lambda: MEMBER
    return TestClient(app)


def _kill_cookies(resp):
    return [h for h in resp.headers.get_list("set-cookie") if h.startswith(("uct_chart_speed=", "uct_device_store="))]


def _poll(client):
    r = client.get("/api/live-prices", params={"tickers": "AAPL"})
    assert r.status_code == 200
    assert r.json()["AAPL"]["price"] == 101.5
    return r


def _auth_path_set_cookies():
    """The kill cookies the auth path writes for the current environment, sorted: the reference for the poll."""
    ref = Response()
    auth._set_chart_speed_cookie(ref)
    return sorted(h for h in ref.headers.getlist("set-cookie") if h.startswith(("uct_chart_speed=", "uct_device_store=")))


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
    want = _auth_path_set_cookies()
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


def test_LP6b_a_kill_that_cannot_be_read_never_costs_the_other_its_cookie(client, monkeypatch):
    """Chart speed is read FIRST: one try around both kills would lose the device kill behind it."""
    def boom():
        raise RuntimeError("env unreadable")
    monkeypatch.setattr(auth, "_chart_speed_enabled", boom)
    os.environ["DEVICE_STORE_ENABLED"] = "purge"
    assert [c.split(";")[0] for c in _kill_cookies(_poll(client))] == ["uct_device_store=purge"]


ERROR_ANSWERS = {
    "empty": ({"tickers": " , "}, 400),
    "too_many": ({"tickers": ",".join(f"T{i}" for i in range(lp._MAX_TICKERS + 1))}, 400),
    "vendor_503": ({"tickers": "ZZZQ"}, 503),       # not cached, and no client: the outage answer
}


@pytest.mark.parametrize("case", sorted(ERROR_ANSWERS))
def test_LP7_the_error_answers_carry_the_kill_too(client, monkeypatch, case):
    params, status = ERROR_ANSWERS[case]
    monkeypatch.setattr(lp, "_get_client", lambda: None)
    r = client.get("/api/live-prices", params=params)
    assert r.status_code == status, r.text
    assert r.headers.get_list("set-cookie") == [], "no kill in force: the error answer gains no header"
    os.environ["DEVICE_STORE_ENABLED"] = "purge"
    os.environ["CHART_SPEED_ENABLED"] = "0"
    r = client.get("/api/live-prices", params=params)
    assert r.status_code == status, r.text
    want = _auth_path_set_cookies()
    assert len(want) == 2
    assert sorted(_kill_cookies(r)) == want


def test_LP8_one_mapping_a_kill_added_once_reaches_both_writers(monkeypatch):
    """The mapping "which kill cookies does the environment call for" is stated ONCE (`auth._kill_cookie_values`): a
    kill planted there reaches the poll's writer and the auth path's writer, each with its own rule for a kill not in
    force (the poll: nothing; the auth path: a deletion)."""
    monkeypatch.setattr(auth, "_kill_cookie_values", lambda: [("uct_planted", "1"), ("uct_planted_off", None)])
    poll, sign_in = Response(), Response()
    auth.set_kill_cookies_when_killed(poll)
    auth._set_chart_speed_cookie(sign_in)
    assert [h.split(";")[0] for h in poll.headers.getlist("set-cookie")] == ["uct_planted=1"]
    got = sign_in.headers.getlist("set-cookie")
    assert [h.split("=", 1)[0] for h in got] == ["uct_planted", "uct_planted_off"]
    assert got[0].startswith("uct_planted=1;")
    assert "max-age=0" in got[1].lower(), f"the auth path clears a kill not in force: {got[1]}"


def test_LP9_the_wire_through_the_main_app(fresh_cache):
    """No other test drives this route's Set-Cookie through `api.main.app`'s middleware stack (GZip, CORS, the rate
    limit policy, the guards, timing)."""
    from api.main import app as main_app
    main_app.dependency_overrides[get_current_user] = lambda: MEMBER
    try:
        c = TestClient(main_app)
        assert _kill_cookies(_poll(c)) == []
        os.environ["DEVICE_STORE_ENABLED"] = "purge"
        os.environ["CHART_SPEED_ENABLED"] = "0"
        want = _auth_path_set_cookies()
        assert len(want) == 2
        assert sorted(_kill_cookies(_poll(c))) == want
    finally:
        main_app.dependency_overrides.pop(get_current_user, None)
