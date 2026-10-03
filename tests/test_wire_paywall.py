"""⭐ OWNER RULING 2026-10-02 (TERM-081 / OI-12): "Everything is paywall."

The server half of "the Morning Wire is paid like everything else". The client
half (FREE_PAGES empty; a free member who opens /morning-wire reads the upgrade
screen) is `app/src/constants/freePages.paywallAll.test.jsx`.

Rail, in one place, on the REAL app:
  * a FREE (signed-in, unpaid) session gets 402 with the router's own sentence on
    every Wire route (today's rundown, its Read-Aloud text, and the archive);
  * a PAID session gets 200 on the same routes (the gate is a paywall, not an
    outage). The engine read is patched, so no wire_data is needed;
  * an anonymous caller still gets 401.

⚠️ The overrides are on `get_current_user` / `get_current_user_with_plan`, never
on `require_paid`: overriding the gate would mean the gate never runs.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan

SENTENCE = "The daily wire surface requires a paid plan"
FREE_USER = {"id": "wire-free-1", "email": "wirefree@example.test", "role": "member", "plan": "free"}
PAID_USER = {"id": "wire-paid-1", "email": "wirepaid@example.test", "role": "member", "plan": "pro"}

#: Every route that serves the Morning Wire's content. Checked to EXIST on the
#: real app below, so a rename fails loudly rather than emptying this file.
WIRE_ROUTES = ("/api/rundown", "/api/rundown/speech-text",
               "/api/wire/archive", "/api/wire/archive/2026-10-01")
WIRE_TEMPLATES = ("/api/rundown", "/api/rundown/speech-text",
                  "/api/wire/archive", "/api/wire/archive/{ymd}")

MOCK_RUNDOWN = {"html": "<p>Today's wire</p>", "date": "2026-10-02"}


@pytest.fixture(scope="module")
def app():
    from api.main import app as real_app
    return real_app


@pytest.fixture
def client_as(app):
    def make(user):
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_current_user_with_plan, None)
        if user is not None:
            app.dependency_overrides[get_current_user] = lambda: dict(user)
            app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
        c = TestClient(app, raise_server_exceptions=False)
        if user is not None:
            c.cookies.set("uct_session", "test-session")
        return c
    yield make
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_current_user_with_plan, None)


def test_every_wire_route_named_here_EXISTS_on_the_real_app(app):
    served = {getattr(r, "path", None) for r in app.routes}
    missing = [t for t in WIRE_TEMPLATES if t not in served]
    assert not missing, f"Wire routes no longer served: {missing}"


def test_a_FREE_session_gets_402_on_every_wire_route(client_as):
    client = client_as(FREE_USER)
    with patch("api.routers.engine_data.get_rundown", return_value=MOCK_RUNDOWN):
        for path in WIRE_ROUTES:
            resp = client.get(path)
            assert resp.status_code == 402, (
                f"{path} answered a FREE member {resp.status_code}: {resp.text[:200]}")
            assert resp.json()["detail"] == SENTENCE, resp.text[:200]


def test_a_PAID_session_gets_200_on_today_s_wire(client_as):
    client = client_as(PAID_USER)
    with patch("api.routers.engine_data.get_rundown", return_value=MOCK_RUNDOWN):
        r = client.get("/api/rundown")
        assert r.status_code == 200, r.text[:200]
        assert r.json()["html"] == MOCK_RUNDOWN["html"]
        s = client.get("/api/rundown/speech-text")
        assert s.status_code == 200, s.text[:200]
        assert s.json()["date"] == MOCK_RUNDOWN["date"]


def test_a_PAID_session_gets_200_on_the_archive(client_as):
    client = client_as(PAID_USER)
    assert client.get("/api/wire/archive").status_code == 200
    # a date the archive does not hold is still a 200 with held:false
    r = client.get("/api/wire/archive/2026-10-01")
    assert r.status_code == 200, r.text[:200]


def test_an_ANONYMOUS_caller_is_still_refused_401(client_as):
    client = client_as(None)
    for path in WIRE_ROUTES:
        assert client.get(path).status_code == 401, path
