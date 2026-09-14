"""Wisdom publish routes on the REAL app (stream S-F): mounted, gated, owner-only rulings.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a publish route unmounted from api.main:app.
2. an anonymous caller (401) or a signed-in member (403) reaching the queue, reports,
   dashboard or preview.
3. a SECOND admin ruling on a queue item (owner-only, 403), or the owner being refused.
4. the machine route answering without the PUSH_SECRET bearer, or to a blank secret.
5. the report preview running twice at once, or on the request path.

The identity is overridden (tests.authclients); the gates themselves always run.
"""
from __future__ import annotations

import threading
import time

import pytest

from api.services.wisdom.core import flags, store
from api.services.wisdom.publish import report as report_mod
from api.services.wisdom.publish import review
from tests.authclients import ADMIN, FREE_MEMBER, signed_in_as

OWNER = {"id": "owner-test", "email": "owner@example.test", "role": "admin", "plan": "free"}
BASE = "/api/admin/wisdom/publish"
INTERNAL = "/api/internal/wisdom/publish"


@pytest.fixture(scope="module")
def real_app():
    from api.main import app

    return app


@pytest.fixture
def client(real_app, tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan

    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    monkeypatch.setenv("ADMIN_EMAILS", "owner@example.test, admin@example.test")  # ADMIN is the SECOND admin
    store.init_db()
    saved = {dep: real_app.dependency_overrides.pop(dep, None)
             for dep in (get_current_user, get_current_user_with_plan)}
    yield TestClient(real_app, raise_server_exceptions=False)
    for dep, was in saved.items():
        if was is not None:
            real_app.dependency_overrides[dep] = was


@pytest.fixture
def item_id():
    with store.write() as conn:
        return review.enqueue(conn, tab="golden", subject_ref="golden:G-900", summary="label check",
                              old={"record_type": "MENTION"}, new={"record_type": "CALL"})["item_id"]


def _gated_requests(item: str):
    return [("get", f"{BASE}/queue", None), ("get", f"{BASE}/queue/counts", None),
            ("get", f"{BASE}/queue/{item}", None), ("post", f"{BASE}/queue/{item}/action", {"action": "accept"}),
            ("get", f"{BASE}/reports", None), ("get", f"{BASE}/reports/{'0' * 24}", None),
            ("post", f"{BASE}/reports/preview", None), ("get", f"{BASE}/dashboard", None)]


def _call(client, method, path, body):
    return getattr(client, method)(path, json=body) if body is not None else getattr(client, method)(path)


# ── 1. mounted ───────────────────────────────────────────────────────────────

def test_every_publish_route_is_mounted_on_the_real_app(real_app):
    paths = {getattr(r, "path", "") for r in real_app.routes}
    expected = {f"{BASE}/queue", f"{BASE}/queue/counts", f"{BASE}/queue/{{item_id}}",
                f"{BASE}/queue/{{item_id}}/action", f"{BASE}/reports", f"{BASE}/reports/{{report_id}}",
                f"{BASE}/reports/preview", f"{BASE}/dashboard", f"{INTERNAL}/golden-candidates"}
    assert not expected - paths, sorted(expected - paths)
    assert "/api/admin/wisdom/core/status" in paths  # control: the probe sees the neighbouring router


def _dependency_names(route) -> set:
    """Every dependency callable reachable from a mounted route, nested ones included."""
    dependant = getattr(route, "dependant", None)
    names, stack = set(), list(getattr(dependant, "dependencies", []) or [])
    while stack:
        dep = stack.pop()
        if dep.call is not None:
            names.add(getattr(dep.call, "__name__", str(dep.call)))
        stack.extend(dep.dependencies)
    return names


def _wisdom_routes(app, prefix: str) -> list:
    return [r for r in app.routes if getattr(r, "path", "").startswith(prefix)]


def test_every_mounted_wisdom_admin_route_carries_require_admin(real_app):
    """⛔ /api/admin/wisdom is NOT covered by AdminGuardMiddleware, so Depends(require_admin)
    IS the gate — and the enumerated per-route checks below are a HAND-WRITTEN list.

    This walks what is actually MOUNTED instead: a route added without the dependency
    is caught even though no test names it. It also covers the sub-routers stream S-F2
    mounts under /adapters at import time, which nothing else on this branch can see."""
    from api.middleware.admin_guard import GUARDED_PREFIXES

    assert not any(p.startswith("/api/admin/wisdom") for p in GUARDED_PREFIXES), \
        "the middleware now covers /api/admin/wisdom; this rail's premise changed"
    routes = _wisdom_routes(real_app, "/api/admin/wisdom")
    assert len(routes) >= 8, f"probe found only {len(routes)} admin wisdom routes"  # non-vacuity
    ungated = [(sorted(getattr(r, "methods", []) or []), r.path) for r in routes
               if not ({"require_admin", "require_owner"} & _dependency_names(r))]
    assert ungated == [], f"mounted /api/admin/wisdom routes with no admin gate: {ungated}"


def test_every_mounted_wisdom_internal_route_carries_the_push_secret(real_app):
    """The machine surface's mirror of the rule above (CONTRACTS §0 ruling 14)."""
    routes = _wisdom_routes(real_app, "/api/internal/wisdom")
    assert len(routes) >= 1, f"probe found only {len(routes)} internal wisdom routes"  # non-vacuity
    ungated = [(sorted(getattr(r, "methods", []) or []), r.path) for r in routes
               if "require_push_secret" not in _dependency_names(r)]
    assert ungated == [], f"mounted /api/internal/wisdom routes with no push secret: {ungated}"


def test_the_gate_probe_can_actually_see_a_missing_dependency(real_app):
    """CONTROL. Without this, both rails above pass by answering 'no' to everything —
    a _dependency_names that returned an empty set for every route would read green."""
    gated = [r for r in _wisdom_routes(real_app, "/api/admin/wisdom")
             if "require_admin" in _dependency_names(r)]
    assert gated, "the probe resolved require_admin on no route at all"
    # a route the probe must NOT claim is admin-gated
    health = [r for r in real_app.routes if getattr(r, "path", "") == "/api/health"]
    assert health, "control route /api/health is not mounted"
    assert "require_admin" not in _dependency_names(health[0])


# ── 2. anonymous and member callers ─────────────────────────────────────────

def test_an_anonymous_caller_is_refused_everywhere(client, item_id, monkeypatch):
    calls: list = []
    monkeypatch.setattr(report_mod, "generate_preview", lambda **kw: calls.append(kw) or {"report_id": "x"})
    for method, path, body in _gated_requests(item_id):
        assert _call(client, method, path, body).status_code == 401, (method, path)
    assert calls == []
    with store.read() as conn:
        assert review.get_item(conn, item_id)["status"] == "open"


def test_a_signed_in_member_is_refused_everywhere(client, real_app, item_id, monkeypatch):
    calls: list = []
    monkeypatch.setattr(report_mod, "generate_preview", lambda **kw: calls.append(kw) or {"report_id": "x"})
    with signed_in_as(FREE_MEMBER, real_app):
        for method, path, body in _gated_requests(item_id):
            assert _call(client, method, path, body).status_code == 403, (method, path)
    assert calls == []


# ── admin reads ──────────────────────────────────────────────────────────────

def test_an_admin_reads_the_queue_reports_and_dashboard(client, real_app, item_id):
    with signed_in_as(ADMIN, real_app):
        items = client.get(f"{BASE}/queue", params={"tab": "golden"}).json()
        counts = client.get(f"{BASE}/queue/counts").json()
        detail = client.get(f"{BASE}/queue/{item_id}")
        dash = client.get(f"{BASE}/dashboard")
        reports = client.get(f"{BASE}/reports")
        assert client.get(f"{BASE}/reports/{'0' * 24}").status_code == 404
        assert client.get(f"{BASE}/queue/{'0' * 24}").status_code == 404
        assert client.get(f"{BASE}/queue", params={"tab": "journal"}).status_code == 400
    assert [i["item_id"] for i in items["items"]] == [item_id]
    assert counts["tabs"]["golden"]["open"] == 1
    assert detail.status_code == 200 and detail.json()["can_act"] is False
    assert detail.json()["new"] == {"record_type": "CALL"}
    assert dash.status_code == 200 and reports.status_code == 200
    body = dash.json()
    assert {"metrics", "capture_health", "jobs", "budget", "flags", "chains", "queue_counts",
            "chain_catalogue", "scheduled_gates"} <= set(body)
    assert {"wisdom_daily_chain", "wisdom_weekly_chain", "wisdom_monthly_packet"} <= {
        j["job_id"] for j in body["jobs"]}
    assert len(body["flags"]) == len(flags.GATES) and body["d16b"] == "deferred"


# ── 3. owner-only rulings ────────────────────────────────────────────────────

def test_a_second_admin_cannot_rule_and_the_owner_can(client, real_app, item_id):
    with signed_in_as(ADMIN, real_app):
        refused = client.post(f"{BASE}/queue/{item_id}/action", json={"action": "accept"})
    assert refused.status_code == 403
    with store.read() as conn:
        assert review.get_item(conn, item_id)["status"] == "open"
    with signed_in_as(OWNER, real_app):
        assert client.get(f"{BASE}/queue/{item_id}").json()["can_act"] is True
        assert client.post(f"{BASE}/queue/{item_id}/action", json={"action": "delete"}).status_code == 400
        assert client.post(f"{BASE}/queue/{item_id}/action", json={}).status_code == 422
        ok = client.post(f"{BASE}/queue/{item_id}/action", json={"action": "accept", "note": "matches the text"})
        again = client.post(f"{BASE}/queue/{item_id}/action", json={"action": "veto"})
        missing = client.post(f"{BASE}/queue/{'0' * 24}/action", json={"action": "veto"})
    assert ok.status_code == 200 and ok.json()["status"] == "accepted" and ok.json()["golden_candidate_id"]
    assert again.status_code == 409 and missing.status_code == 404
    with store.read() as conn:
        got = review.get_item(conn, item_id)
    assert got["resolved_by"] == "owner@example.test" and got["golden_candidate"]["verified_by"] == "owner"


# ── 4. the machine route ─────────────────────────────────────────────────────

def test_the_machine_route_needs_the_push_secret_and_a_blank_secret_opens_nothing(client, item_id, monkeypatch):
    with store.write() as conn:
        review.act(conn, item_id, action="accept", actor="owner@example.test", actor_is_owner=True)
    monkeypatch.setenv("PUSH_SECRET", "")
    assert client.get(f"{INTERNAL}/golden-candidates", headers={"Authorization": "Bearer "}).status_code == 401
    monkeypatch.setenv("PUSH_SECRET", "synthetic-secret")
    assert client.get(f"{INTERNAL}/golden-candidates").status_code == 401
    assert client.get(f"{INTERNAL}/golden-candidates",
                      headers={"Authorization": "Bearer wrong"}).status_code == 401
    ok = client.get(f"{INTERNAL}/golden-candidates", headers={"Authorization": "Bearer synthetic-secret"})
    assert ok.status_code == 200 and ok.json()["count"] == 1


# ── 5. the preview thread ────────────────────────────────────────────────────

def test_the_report_preview_runs_on_a_thread_once_at_a_time(client, real_app, monkeypatch):
    from api.routers import wisdom_publish as wp

    release = threading.Event()
    entered = threading.Event()
    seen_threads: list = []

    def fake_preview(**kwargs):
        seen_threads.append(threading.current_thread().name)
        entered.set()
        release.wait(10)
        return {"report_id": "synthetic-preview"}

    monkeypatch.setattr(report_mod, "generate_preview", fake_preview)
    assert wp._PREVIEW["running"] is False
    with signed_in_as(ADMIN, real_app):
        first = client.post(f"{BASE}/reports/preview")
        assert first.status_code == 200 and first.json() == {"started": True}
        assert entered.wait(10)
        assert client.post(f"{BASE}/reports/preview").status_code == 409
        release.set()
        for _ in range(100):
            state = client.get(f"{BASE}/reports").json()["preview"]
            if not state["running"]:
                break
            time.sleep(0.05)
    assert state["running"] is False and state["report_id"] == "synthetic-preview" and state["error"] is None
    assert seen_threads == ["wisdom-report-preview"]
