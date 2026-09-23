"""Packet O CP1 -- GET /api/screener/methodology's first router-level test
coverage. Signed by the owner 2026-09-22 (fingerprint fd57fe079).

tests/test_screener_methodology.py already covers all_methods()/for_column()
directly at the service layer, including the load-bearing
test_the_published_weights_ARE_the_live_constant. These tests cover the
route itself: the paid gate and the two call shapes (bare + ?column=).
"""
import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan

FREE_USER = {"id": "meth-free-1", "email": "methfree@example.test", "role": "member", "plan": "free"}
PAID_USER = {"id": "meth-paid-1", "email": "methpaid@example.test", "role": "member", "plan": "pro"}


@pytest.fixture
def client_as():
    def _make(user):
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_current_user_with_plan, None)
        app.dependency_overrides[get_current_user] = lambda: dict(user)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
        return TestClient(app, raise_server_exceptions=False)
    yield _make
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_current_user_with_plan, None)


def test_free_user_is_refused_with_402(client_as):
    resp = client_as(FREE_USER).get("/api/screener/methodology")
    assert resp.status_code == 402


def test_anonymous_caller_is_refused(client_as):
    app.dependency_overrides.pop(get_current_user, None)
    resp = TestClient(app, raise_server_exceptions=False).get("/api/screener/methodology")
    assert resp.status_code in (401, 403)


def test_bare_call_returns_all_methods_including_the_composite(client_as):
    resp = client_as(PAID_USER).get("/api/screener/methodology")
    assert resp.status_code == 200
    body = resp.json()
    assert "methods" in body and "as_of_note" in body
    columns = [m["column"] for m in body["methods"]]
    assert "uct_composite" in columns
    assert "rs_rank" in columns
    assert "accdis" in columns
    composite = next(m for m in body["methods"] if m["column"] == "uct_composite")
    assert "caveat" in composite
    assert "not_claimed" in composite and len(composite["not_claimed"]) > 0


def test_column_param_returns_one_method(client_as):
    resp = client_as(PAID_USER).get("/api/screener/methodology", params={"column": "rs_rank"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["column"] == "rs_rank"
    assert "caveat" in body


def test_an_unknown_column_is_a_404_not_a_blank_shell(client_as):
    resp = client_as(PAID_USER).get("/api/screener/methodology", params={"column": "not_a_real_column"})
    assert resp.status_code == 404
