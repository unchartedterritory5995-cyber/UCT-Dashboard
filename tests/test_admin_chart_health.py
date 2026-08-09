"""Tests for the admin chart-health router (audit + quarantine REST endpoints).

🔴 THESE TESTS USED TO OVERRIDE `require_admin` ITSELF, which made them
structurally blind to the one failure that matters here: a handler losing its
guard. Replacing the gate means the gate never runs, so a route declared
``def quarantine_remove(...)`` with no ``Depends(require_admin)`` at all behaves
identically to a guarded one under every case in this file — an admin dict was
going to be returned either way.

⭐ SO THE OVERRIDE MOVED TO THE GATE'S **INPUT**. `require_admin` depends on
`get_current_user`; that is what is faked now, and the real `require_admin` runs
on top of it. This is exactly what the paywall pass did across 13 files
(`get_current_user_with_plan`, never `require_paid`), and it is why those tests
can still fail when a gate disappears.

⛔ AND THE POINT IS NOT TIDINESS — IT IS THAT A TEST BECOMES POSSIBLE.
`test_a_NON_admin_is_refused_by_EVERY_route` can only be written this way: with
`require_admin` replaced there is no way to present a non-admin at all. It
enumerates the router's OWN route table rather than a typed list, so a new
endpoint added without a guard is red on the day it is written.
"""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch

from api.main import app
from api.middleware.auth_middleware import get_current_user


def _as(user: dict):
    """Present `user` to the REAL `require_admin`, by faking only its input."""
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


@pytest.fixture
def admin_client():
    """An authenticated ADMIN. The admin CHECK still runs — only the session does not."""
    client = _as({"id": 1, "role": "admin", "email": "admin@test"})
    yield client
    app.dependency_overrides.clear()


@pytest.fixture
def member_client():
    """An authenticated NON-admin. `require_admin` must refuse them."""
    client = _as({"id": 2, "role": "user", "email": "member@test"})
    yield client
    app.dependency_overrides.clear()


def test_get_latest_audit_when_none(admin_client):
    with patch("api.routers.admin_chart_health.bars_audit.latest_report", return_value=None):
        r = admin_client.get("/api/admin/bars/audit/latest")
    assert r.status_code == 200
    assert r.json() == {"report": None}


def test_get_latest_audit_returns_report(admin_client):
    fake = {"run_id": 7, "tickers_scanned": 100, "issues_found": 3}
    with patch("api.routers.admin_chart_health.bars_audit.latest_report", return_value=fake):
        r = admin_client.get("/api/admin/bars/audit/latest")
    assert r.status_code == 200
    assert r.json()["report"]["run_id"] == 7


def test_run_audit_kicks_off_background(admin_client):
    with patch("api.routers.admin_chart_health.bars_audit.audit_universe") as mock_run:
        mock_run.return_value = {"run_id": 8, "issues_found": 0}
        r = admin_client.post(
            "/api/admin/bars/audit/run",
            json={"tickers": ["QQQ", "SPY"], "tfs": ["30"], "bars_counts": [100], "parallelism": 2},
        )
    assert r.status_code == 200
    body = r.json()
    assert body.get("status") == "started"
    assert body.get("ticker_count") == 2


def test_run_audit_rejects_when_no_tickers_resolvable(admin_client):
    """If body omits tickers AND cap_universe.json is missing/empty, return 400."""
    with patch("api.routers.admin_chart_health._load_universe", return_value=[]):
        r = admin_client.post("/api/admin/bars/audit/run", json={})
    assert r.status_code == 400


def test_quarantine_count(admin_client):
    with patch("api.routers.admin_chart_health.bar_quarantine.count", return_value=42):
        r = admin_client.get("/api/admin/bars/quarantine/count")
    assert r.status_code == 200
    assert r.json() == {"count": 42}


def test_quarantine_list(admin_client):
    items = [{"ticker": "QQQ", "tf": "30", "bar_time": 123, "reason": "x", "source": None, "detected_at": 0}]
    with patch("api.routers.admin_chart_health.bar_quarantine.list_for_ticker", return_value=items):
        r = admin_client.get("/api/admin/bars/quarantine/list?ticker=QQQ&tf=30")
    assert r.status_code == 200
    assert r.json() == {"items": items}


def test_quarantine_remove(admin_client):
    with patch("api.routers.admin_chart_health.bar_quarantine.remove") as mock_remove:
        r = admin_client.post(
            "/api/admin/bars/quarantine/remove",
            json={"ticker": "QQQ", "tf": "30", "bar_time": 123},
        )
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    mock_remove.assert_called_once_with("QQQ", "30", 123)


def test_admin_endpoints_require_auth_when_override_cleared():
    """Without the admin override, anonymous requests get 401."""
    client = TestClient(app)
    r = client.get("/api/admin/bars/quarantine/count")
    assert r.status_code in (401, 403)


# ── the rail the old override made impossible ───────────────────────────────

def _router_routes():
    """⛔ DERIVED FROM THE ROUTER'S OWN TABLE, never a typed list
    (`lesson_probe_names_must_be_derived_not_typed`). A hand-written list covers
    the endpoints somebody remembered; this covers the ones they did not."""
    from api.routers import admin_chart_health
    out = []
    for r in admin_chart_health.router.routes:
        path, methods = getattr(r, "path", None), getattr(r, "methods", set())
        if not path or "{" in path:
            continue  # path params need real values; the guard runs before them anyway
        for m in ("GET", "POST"):
            if m in methods:
                out.append((m, path))
    return out


def test_the_route_table_was_actually_read():
    """Non-vacuity floor: an empty enumeration would make the sweep below pass
    while measuring nothing at all."""
    assert len(_router_routes()) >= 10, _router_routes()


@pytest.mark.parametrize("method,path", _router_routes())
def test_a_NON_admin_is_refused_by_EVERY_route(member_client, method, path):
    """🔴 THE CASE THAT GOES RED WHEN A HANDLER LOSES ITS GUARD.

    An authenticated member with `role != "admin"` reaches every one of these
    endpoints. `require_admin` is the only thing standing between them and the
    quarantine controls, and it is REAL here — so a route that drops
    `Depends(require_admin)` answers 200 and this fails, by name, for that route.

    ⚠️ A 405/404 is NOT accepted. Either would mean the sweep is knocking on a
    door that is not there, and a rail that passes because it missed is the
    `lesson_gate_that_cannot_fail` shape.
    """
    kw = {} if method == "GET" else {"json": {}}
    r = getattr(member_client, method.lower())(path, **kw)
    assert r.status_code == 403, (
        f"{method} {path} answered {r.status_code} to a NON-admin. Either the "
        "route lost its Depends(require_admin), or this sweep is not reaching it."
    )


def test_liveness_endpoint(admin_client):
    fake = {"QQQ": 5, "SPY": 12, "TSLA": 0}
    with patch("api.routers.admin_chart_health.realtime_stream.get_last_seen_ages", return_value=fake):
        r = admin_client.get("/api/admin/bars/liveness")
    assert r.status_code == 200
    assert r.json() == {"ages": fake}


def test_liveness_endpoint_empty(admin_client):
    with patch("api.routers.admin_chart_health.realtime_stream.get_last_seen_ages", return_value={}):
        r = admin_client.get("/api/admin/bars/liveness")
    assert r.status_code == 200
    assert r.json() == {"ages": {}}


def test_provenance_lookup_endpoint(admin_client):
    fake = {"ticker": "QQQ", "tf": "30", "bar_time": 1715080800,
            "source": "massive", "validated_at": 1715000000, "verified_at": None}
    with patch("api.routers.admin_chart_health.bar_provenance.get", return_value=fake):
        r = admin_client.get("/api/admin/bars/provenance?ticker=QQQ&tf=30&bar_time=1715080800")
    assert r.status_code == 200
    assert r.json()["provenance"]["source"] == "massive"


def test_provenance_lookup_returns_null_when_missing(admin_client):
    with patch("api.routers.admin_chart_health.bar_provenance.get", return_value=None):
        r = admin_client.get("/api/admin/bars/provenance?ticker=QQQ&tf=30&bar_time=1715080800")
    assert r.status_code == 200
    assert r.json()["provenance"] is None


def test_source_health_endpoint(admin_client):
    sources = {"massive": {"attempts": 100, "pass_rate": 0.99, "state": "ok"},
               "fmp": {"attempts": 30, "pass_rate": 0.85, "state": "degraded"}}
    by_source = {"massive": 8500, "fmp": 1200}
    with patch("api.routers.admin_chart_health.source_circuit_breaker.all_states", return_value=sources), \
         patch("api.routers.admin_chart_health.bar_provenance.count_by_source", return_value=by_source):
        r = admin_client.get("/api/admin/bars/source-health")
    body = r.json()
    assert body["sources"]["massive"]["state"] == "ok"
    assert body["sources"]["fmp"]["state"] == "degraded"
    assert body["by_source"]["massive"] == 8500


def test_force_heal_endpoint(admin_client):
    fake_result = {"status": "healed", "new_source": "fmp"}
    with patch("api.routers.admin_chart_health.bar_self_heal.try_heal", return_value=fake_result):
        r = admin_client.post(
            "/api/admin/bars/force-heal",
            json={"ticker": "QQQ", "tf": "30", "bar_time": 1715080800, "original_source": "massive"},
        )
    assert r.status_code == 200
    assert r.json() == fake_result


def test_quality_endpoint_with_explicit_tickers(admin_client):
    fake = {"QQQ": 95, "SPY": 92}
    with patch("api.routers.admin_chart_health.bar_quality_score.compute_universe", return_value=fake):
        r = admin_client.get("/api/admin/bars/quality?tickers=QQQ,SPY")
    assert r.status_code == 200
    assert r.json() == {"scores": fake}


def test_quality_endpoint_default_priority_tickers(admin_client):
    fake = {"QQQ": 95}
    with patch("api.main._resolve_priority_tickers", return_value=["QQQ"]), \
         patch("api.routers.admin_chart_health.bar_quality_score.compute_universe", return_value=fake):
        r = admin_client.get("/api/admin/bars/quality")
    assert r.status_code == 200
    assert r.json()["scores"] == fake


def test_alerts_endpoint(admin_client):
    fake = [{"alert_key": "x", "severity": "warning", "message": "test", "metadata": {}, "emitted_at": 1700000000}]
    with patch("api.routers.admin_chart_health.chart_health_alerts.list_recent", return_value=fake):
        r = admin_client.get("/api/admin/bars/alerts")
    assert r.status_code == 200
    assert r.json() == {"alerts": fake}


def test_hot_tier_endpoint(admin_client):
    with patch("api.routers.admin_chart_health.bars_hot_tier.size", return_value=42):
        r = admin_client.get("/api/admin/bars/hot-tier")
    assert r.status_code == 200
    assert r.json() == {"size": 42, "capacity": 500}


def test_smoke_endpoint_kicks_off_audit(admin_client):
    with patch("api.routers.admin_chart_health.bars_audit.audit_universe") as mock_audit:
        r = admin_client.post("/api/admin/bars/smoke")
    assert r.status_code == 200
    assert r.json().get("status") == "started"
    assert r.json().get("fixture_size") == 20
