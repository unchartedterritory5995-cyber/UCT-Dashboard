"""WHO receives a chart edge entitlement, and how it reaches the browser.

⭐ THE LIFECYCLE, NOT JUST THE CRYPTO. `test_chart_edge_token.py` proves a token
cannot be forged; this file proves the right people get one, the wrong people
never do, and a member who STOPS being entitled has it taken away on the next
poll — the only revocation the edge will ever have.
"""
from __future__ import annotations

import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api import chart_edge_token as cet  # noqa: E402
from tests.authclients import (  # noqa: E402
    ADMIN, FREE_MEMBER, PAID_MEMBER, signed_in_as,
)

SECRET = "mint-test-edge-secret"
COMPED = {"id": "comped-test", "email": "comped@example.test",
          "role": "member", "plan": "comped"}


@pytest.fixture(autouse=True)
def _secret(monkeypatch):
    monkeypatch.setenv("CHART_EDGE_SECRET", SECRET)
    monkeypatch.delenv("CHART_EDGE_TOKEN_TTL_SECONDS", raising=False)


@pytest.fixture
def app(monkeypatch):
    from api.main import app as real
    import api.routers.auth as auth_router
    monkeypatch.setattr(auth_router, "get_subscription", lambda _uid: None)
    return real


def _me(app, user, monkeypatch):
    """GET /api/auth/me as `user`; return (json, set-cookie headers)."""
    import api.routers.auth as auth_router
    monkeypatch.setattr(auth_router, "get_user_plan",
                        lambda _uid: user.get("plan", "free"))
    with signed_in_as(user, app):
        r = TestClient(app).get("/api/auth/me")
    assert r.status_code == 200, r.text
    return r.json(), r.headers.get_list("set-cookie")


def _edge_cookie(set_cookies):
    for raw in set_cookies:
        if raw.startswith(f"{cet.COOKIE_NAME}="):
            return raw
    return None


def _value(raw):
    return raw.split("=", 1)[1].split(";", 1)[0]


# ── who may mint ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("user", [PAID_MEMBER, ADMIN, COMPED],
                         ids=["paid", "admin", "comped"])
def test_an_ENTITLED_member_receives_a_VALID_token(app, monkeypatch, user):
    """⭐ `comped` IS IN THIS LIST ON PURPOSE — it is the account class that a
    second entitlement opinion (`paid_equiv`) would silently exclude."""
    _body, cookies = _me(app, user, monkeypatch)
    raw = _edge_cookie(cookies)
    assert raw, f"{user['plan']} received no chart edge cookie"
    assert cet.verify(_value(raw))[0] == "VALID"


def test_a_FREE_member_receives_NO_usable_token(app, monkeypatch):
    """⛔⛔ THE HEADLINE. A free account must never hold an artifact the edge
    would one day accept."""
    _body, cookies = _me(app, FREE_MEMBER, monkeypatch)
    raw = _edge_cookie(cookies)
    # Either nothing at all, or an explicit clear — never a usable token.
    if raw is not None:
        assert cet.verify(_value(raw))[0] != "VALID", (
            "a free member was handed a VALID chart entitlement")


def test_an_ANONYMOUS_caller_cannot_mint(app):
    """No session, no mint — `/api/auth/me` refuses before any token exists."""
    app.dependency_overrides.clear()
    r = TestClient(app).get("/api/auth/me")
    assert r.status_code in (401, 403)
    assert _edge_cookie(r.headers.get_list("set-cookie")) is None


def test_a_TRIAL_account_is_entitled(app, monkeypatch):
    import api.middleware.auth_middleware as am
    monkeypatch.setattr(am, "is_account_in_trial", lambda _u: True)
    _body, cookies = _me(app, dict(FREE_MEMBER), monkeypatch)
    raw = _edge_cookie(cookies)
    assert raw and cet.verify(_value(raw))[0] == "VALID"


# ── revocation ──────────────────────────────────────────────────────────────

def test_LOSING_entitlement_CLEARS_the_cookie(app, monkeypatch):
    """⛔⛔ THE ONLY REVOCATION THE EDGE GETS, AND IT IS NOT AUTOMATIC.

    A cancelled member keeps a signed token until it expires — the edge cannot
    consult a database. So the downgrade path must actively delete the cookie on
    the very next `/api/auth/me`, which the app polls. Without this the exposure
    is the cookie's max-age; with it, the TTL.
    """
    downgraded = dict(PAID_MEMBER, plan="free")
    _body, cookies = _me(app, downgraded, monkeypatch)
    raw = _edge_cookie(cookies)
    assert raw is not None, "no Set-Cookie at all — nothing removes a stale token"
    assert cet.verify(_value(raw))[0] != "VALID"
    assert 'Max-Age=0' in raw or '1970' in raw, (
        f"the cookie was not actively cleared: {raw}")


# ── transport ───────────────────────────────────────────────────────────────

def test_the_cookie_is_HTTPONLY_and_scoped_to_the_worker_route(app, monkeypatch):
    """⭐ HttpOnly means an XSS cannot read the entitlement; Path means it is not
    sent to the dozens of endpoints with no use for it — including the cached
    historical surfaces Phase 1 must not touch."""
    _body, cookies = _me(app, PAID_MEMBER, monkeypatch)
    raw = _edge_cookie(cookies)
    assert "HttpOnly" in raw, raw
    assert f"Path={cet.COOKIE_PATH}" in raw, raw
    assert "SameSite=lax" in raw.lower().replace("samesite=lax", "SameSite=lax") or \
           "samesite=lax" in raw.lower(), raw


def test_the_token_NEVER_appears_in_the_RESPONSE_BODY(app, monkeypatch):
    """⛔ The frontend has no use for a value only the edge verifies, and
    anything the frontend can read is something an XSS can exfiltrate."""
    body, cookies = _me(app, PAID_MEMBER, monkeypatch)
    raw = _edge_cookie(cookies)
    token = _value(raw)
    import json as _json
    assert token not in _json.dumps(body)
    assert cet.COOKIE_NAME not in _json.dumps(body)


def test_the_SECRET_never_appears_in_the_response(app, monkeypatch):
    body, cookies = _me(app, PAID_MEMBER, monkeypatch)
    import json as _json
    blob = _json.dumps(body) + "".join(cookies)
    assert SECRET not in blob


def test_the_cookie_MAX_AGE_matches_the_configured_TTL(app, monkeypatch):
    monkeypatch.setenv("CHART_EDGE_TOKEN_TTL_SECONDS", "300")
    _body, cookies = _me(app, PAID_MEMBER, monkeypatch)
    assert "Max-Age=300" in _edge_cookie(cookies)


# ── configuration failure ───────────────────────────────────────────────────

def test_NO_SECRET_CONFIGURED_still_serves_the_login_payload(app, monkeypatch):
    """⛔ AN OPTIMISATION MUST NEVER COST A LOGIN. With no secret the response
    is a normal 200 with the usual fields and simply no usable token."""
    monkeypatch.delenv("CHART_EDGE_SECRET", raising=False)
    body, cookies = _me(app, PAID_MEMBER, monkeypatch)
    assert body["plan"] == "pro"
    raw = _edge_cookie(cookies)
    if raw is not None:
        assert cet.verify(_value(raw))[0] != "VALID"


def test_a_MINTING_FAILURE_cannot_break_the_endpoint(app, monkeypatch):
    """The helper swallows its own errors on purpose; prove it, so a future
    refactor that lets one escape fails here rather than in production."""
    monkeypatch.setattr(cet, "mint", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    body, _cookies = _me(app, PAID_MEMBER, monkeypatch)
    assert body["plan"] == "pro"
