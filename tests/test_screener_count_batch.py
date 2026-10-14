"""POST /api/screener/count/batch -- up to 30 counts in one request.

The screen menu shows a match count per screen; this lets it load them in one or
two requests. Every spec runs through exactly the path `/count` uses: same
`require_paid` gate, same user id source (the dependency, never the body).
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
from api.routers import screener as screener_mod
from api.services.screener import query as scr_query

PAID = {"id": "u1", "role": "member", "plan": "pro"}
FREE = {"id": "f1", "role": "member", "plan": "free"}
URL = "/api/screener/count/batch"


def _client(user):
    app = FastAPI()
    app.include_router(screener_mod.router)
    if user is not None:
        # Override what the gate DEPENDS ON, never the gate itself.
        app.dependency_overrides[get_current_user] = lambda: dict(user)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app)


@pytest.fixture
def paid(monkeypatch):
    calls = []

    def fake_preview(spec, user_id=None):
        calls.append((spec, user_id))
        for f in spec.get("filters") or []:
            if f.get("key") == "boom":
                raise ValueError("unknown filter boom")
            if f.get("key") == "crash":
                raise RuntimeError("secret internal path /data/screener.db")
        return {"count": 7, "as_of": "2026-10-12"}

    monkeypatch.setattr(scr_query, "preview_count", fake_preview)
    return _client(PAID), calls


def test_counts_in_order_and_errors_inline(paid):
    c, calls = paid
    body = {"specs": [{"filters": []}, {"filters": [{"key": "boom", "op": "gte", "min": 1}]}, {"filters": []}]}
    r = c.post(URL, json=body)
    assert r.status_code == 200
    out = r.json()["counts"]
    assert out[0] == {"count": 7, "as_of": "2026-10-12"}
    assert out[1] == {"error": "unknown filter boom"}
    assert out[2]["count"] == 7
    assert len(calls) == 3


def test_an_unexpected_failure_is_generic_and_leaks_nothing(paid):
    c, _ = paid
    out = c.post(URL, json={"specs": [{"filters": [{"key": "crash"}]}, {"filters": []}]}).json()["counts"]
    assert out[0] == {"error": "count failed"}
    assert "secret" not in str(out)
    assert out[1]["count"] == 7


def test_user_id_comes_from_the_dependency_not_the_body(paid):
    c, calls = paid
    c.post(URL, json={"specs": [{"filters": []}], "user_id": "someone-else"})
    assert [uid for _, uid in calls] == ["u1"]


def test_rejects_more_than_30(paid):
    c, calls = paid
    assert c.post(URL, json={"specs": [{"filters": []}] * 31}).status_code == 422
    assert calls == []


def test_accepts_exactly_30(paid):
    c, calls = paid
    r = c.post(URL, json={"specs": [{"filters": []}] * 30})
    assert r.status_code == 200 and len(r.json()["counts"]) == 30


def test_rejects_empty(paid):
    c, _ = paid
    assert c.post(URL, json={"specs": []}).status_code == 422


def test_a_free_member_is_refused_before_any_count_runs(monkeypatch):
    calls = []
    monkeypatch.setattr(scr_query, "preview_count", lambda spec, user_id=None: calls.append(spec) or {"count": 1})
    r = _client(FREE).post(URL, json={"specs": [{"filters": []}]})
    assert r.status_code == 402
    assert calls == []


def test_the_batch_route_is_not_shadowed_by_a_parametrised_one():
    """Registration order: no route registered before the batch route may match its path."""
    from starlette.routing import Match
    scope = {"type": "http", "method": "POST", "path": URL, "root_path": "", "query_string": b"", "headers": []}
    for route in screener_mod.router.routes:
        m, _ = route.matches(scope)
        if m == Match.FULL:
            assert route.path == URL, f"{route.path} would answer {URL}"
            break
    else:
        pytest.fail("no route matches the batch path")
