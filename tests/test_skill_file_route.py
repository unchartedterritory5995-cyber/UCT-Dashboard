"""TERM-061 / BRK-06 / FT-040 -- the published skill file and whitelist (owner ruling T-16).

Built on a MINIMAL app (the real personal-API and Browser Capture routers, the skill router,
and two stand-in reads), never `api.main`, so the rails run in seconds.

The load-bearing rail is `test_the_published_list_IS_the_enforced_set`: it does not compare the
whitelist to a typed list. It MEASURES the enforced set on the wire, by sending a real personal
token to every route of the app, and requires the served whitelist to equal it exactly.
"""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw

GATE = "NOTEBOOK_PERSONAL_API_ENABLED"


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    try:
        os.unlink(tmp.name)
    except OSError:
        pass


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    from api.limiter import limiter
    from api.routers import skill_file
    limiter.reset()
    skill_file.reset_cache()
    monkeypatch.setenv(GATE, "1")
    yield
    limiter.reset()
    skill_file.reset_cache()


def _app() -> FastAPI:
    from api.middleware.auth_middleware import require_admin
    from api.routers import capture_auth as capture_router
    from api.routers import notebook_personal_api, skill_file

    fa = FastAPI()
    fa.include_router(notebook_personal_api.router)
    fa.include_router(capture_router.router)
    fa.include_router(skill_file.router)

    def require_paid(user: dict = Depends(authmw.get_current_user)) -> dict:
        return user

    @fa.get("/api/watchlists/demo-read")
    def member_read(_u: dict = Depends(authmw.get_current_user)):
        return {"ok": True}

    @fa.get("/api/screener/demo-paid/{sym}")
    def paid_read(sym: str, tf: str = "D", _u: dict = Depends(require_paid)):
        return {"ok": True}

    @fa.get("/api/screener/demo-admin")
    def admin_read(_u: dict = Depends(require_admin)):
        return {"ok": True}

    return fa


@pytest.fixture
def app(db_path):
    return _app()


@pytest.fixture
def client(app):
    return TestClient(app, raise_server_exceptions=False)


def _token(user_id: str = "u-skill-1") -> str:
    from api.services.journal_two import capture_auth
    return capture_auth.mint_personal_token(user_id, "Agent")["token"]


def _concrete(path: str) -> str:
    import re
    return re.sub(r"\{[^}]+\}", "x", path)


def _call(client, method, path, headers):
    body = {"title": "From an agent", "markdown": "hello"} if method in ("POST", "PUT") else None
    return client.request(method, _concrete(path), json=body, headers=headers)


def _enforced_set(app, client, token) -> set[tuple[str, str]]:
    """Measured, not read: every (method, path) that REFUSES an anonymous caller but ACCEPTS
    the personal token. Accept = anything but 401/403 (a 404 for a missing note is the route
    running with the token's member)."""
    out = set()
    for route in app.routes:
        for method in sorted(getattr(route, "methods", None) or ()):
            if method in ("HEAD", "OPTIONS"):
                continue
            anon = _call(client, method, route.path, {})
            if anon.status_code not in (401, 403):
                continue
            with_token = _call(client, method, route.path, {"Authorization": f"Bearer {token}"})
            if with_token.status_code not in (401, 403):
                out.add((method, route.path))
    return out


def test_the_skill_md_route_serves_markdown_with_a_cache_header(client):
    r = client.get("/api/skill.md")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/markdown")
    assert "max-age=300" in r.headers["cache-control"]
    assert r.text.startswith("# UCT Intelligence: skill file")
    assert "Authorization: Bearer <token>" in r.text
    assert "/api/j2/personal/daily/append" in r.text
    assert "There is no MCP server." in r.text


def test_the_skill_md_states_the_limits_the_code_enforces(client):
    from api import rate_limit_policy as rlp
    from api.routers import notebook_personal_api as papi_router
    text = client.get("/api/skill.md").text
    assert f"{papi_router._RATE} per token" in text
    # the stand-in paid read is in the screener family; its limit is read from FAMILIES
    assert f"| screener | {rlp.FAMILIES['screener'].limit} |" in text


def test_the_published_list_IS_the_enforced_set(app, client):
    token = _token()
    measured = _enforced_set(app, client, token)
    served = client.get("/api/skill/whitelist").json()["personal_token"]
    listed = {(e["method"], e["path"]) for e in served}
    assert measured, "non-vacuity: the token must be accepted somewhere, or the probe is broken"
    assert listed == measured, {"listed_only": listed - measured, "measured_only": measured - listed}
    assert listed == {
        ("POST", "/api/j2/personal/notes"),
        ("POST", "/api/j2/personal/notes/{note_id}/append"),
        ("POST", "/api/j2/personal/daily/append"),
    }


def test_an_unlisted_endpoint_refuses_a_personal_token(client):
    auth = {"Authorization": f"Bearer {_token()}"}
    listed = {e["path"] for e in client.get("/api/skill/whitelist").json()["personal_token"]}
    assert "/api/watchlists/demo-read" not in listed
    assert client.get("/api/watchlists/demo-read", headers=auth).status_code == 401
    assert "/api/j2/capture/destinations" not in listed
    assert client.get("/api/j2/capture/destinations", headers=auth).status_code == 403
    assert "/api/j2/personal/tokens" not in listed
    assert client.get("/api/j2/personal/tokens", headers=auth).status_code == 401
    # control: the same token on a listed door is accepted
    ok = client.post("/api/j2/personal/notes", json={"title": "t", "markdown": "m"}, headers=auth)
    assert ok.status_code == 200, ok.text


def test_session_reads_are_listed_with_tier_family_limit_and_params(client):
    from api import rate_limit_policy as rlp
    data = client.get("/api/skill/whitelist").json()
    by_path = {e["path"]: e for e in data["entries"]}
    assert by_path["/api/watchlists/demo-read"]["tier"] == "member"
    paid = by_path["/api/screener/demo-paid/{sym}"]
    assert paid["tier"] == "paid"
    assert paid["limit"] == rlp.FAMILIES[paid["rate_limit_family"]].limit
    assert paid["params"] == "{sym}, tf=D"
    assert "/api/screener/demo-admin" not in by_path
    # the skill routes themselves are open and never list themselves as member reads
    assert "/api/skill.md" not in by_path and "/api/skill/whitelist" not in by_path


def test_every_personal_door_has_its_documentation_and_nothing_else_does(app):
    from api.services import skill_whitelist as sw
    derived = {(e["method"], e["path"]) for e in sw.personal_token_routes(app)}
    assert derived, "non-vacuity"
    assert derived == set(sw.PERSONAL_DOOR_DOCS), (
        "a personal door was added or removed: document it in PERSONAL_DOOR_DOCS")


def test_the_served_documents_are_built_from_the_requesting_app(client, app):
    from api.routers import skill_file
    from api.services import skill_whitelist as sw
    assert client.get("/api/skill/whitelist").json() == sw.build(app)
    assert client.get("/api/skill.md").text == sw.to_skill_md(sw.build(app))
    assert len(skill_file._cache) == 1
