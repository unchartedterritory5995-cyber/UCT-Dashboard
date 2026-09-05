"""GET/POST/DELETE /api/alerts/taxonomy/* -- auth-gated, and the admin-only
manual sweep trigger."""
import pytest
from fastapi.testclient import TestClient

from api.services.entity_master import schema as em_schema
from api.services.entity_master import store as em_store
from api.services.alert_taxonomy import db as at_db
from api.services.alert_taxonomy import document_arrival as da


@pytest.fixture(autouse=True)
def _isolated_dbs(tmp_path, monkeypatch):
    monkeypatch.setattr(at_db, "DB_PATH", str(tmp_path / "alert_taxonomy.db"))
    em_db_path = str(tmp_path / "em_default.db")
    monkeypatch.setattr(em_schema, "DB_PATH", em_db_path)
    em_store._local.conns = {}
    em_store._ALIAS_CACHE.clear()
    em_store._CACHE_LOADED = False
    em_schema.init_db(db_path=em_db_path)
    da.register()
    yield
    em_store._local.conns = {}
    em_store._ALIAS_CACHE.clear()
    em_store._CACHE_LOADED = False


@pytest.fixture
def client():
    from api.main import app
    return TestClient(app)


def test_create_requires_auth(client):
    r = client.post("/api/alerts/taxonomy/document-arrival", json={"ticker": "AAPL"})
    assert r.status_code in (401, 403, 422)  # no cookie -> auth dependency rejects


def test_create_and_list_round_trip(client, monkeypatch):
    from api.main import app
    from api.middleware.auth_middleware import get_current_user
    app.dependency_overrides[get_current_user] = lambda: {"id": "u1", "role": "member"}
    monkeypatch.setattr(da.sec_filings, "recent_filings",
                        lambda t, form_type="", count=10: {
                            "ticker": "AAPL", "company": "Apple", "cik": "1", "form_filter": "ANY",
                            "count": 1, "filings": [{"form": "8-K", "filed": "2026-09-01", "period": "",
                                                     "accession": "acc-0", "url": "https://sec.gov/x"}],
                        })
    try:
        r = client.post("/api/alerts/taxonomy/document-arrival", json={"ticker": "AAPL", "form_type": "8-K"})
        assert r.status_code == 200
        pid = r.json()["predicate_id"]

        r2 = client.get("/api/alerts/taxonomy/document-arrival")
        assert r2.status_code == 200
        ids = [p["id"] for p in r2.json()["predicates"]]
        assert pid in ids
    finally:
        app.dependency_overrides.clear()


def test_create_rejects_an_unknown_ticker_with_422(client, monkeypatch):
    from api.main import app
    from api.middleware.auth_middleware import get_current_user
    app.dependency_overrides[get_current_user] = lambda: {"id": "u1", "role": "member"}
    monkeypatch.setattr(da.sec_filings, "recent_filings",
                        lambda t, form_type="", count=10: {"error": "ticker 'ZZZZ' not found in SEC CIK map"})
    try:
        r = client.post("/api/alerts/taxonomy/document-arrival", json={"ticker": "ZZZZ"})
        assert r.status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_list_active_only_default_hides_suspended_but_active_only_false_shows_it(client):
    from api.main import app
    from api.middleware.auth_middleware import get_current_user
    from api.services.alert_taxonomy import predicates as _predicates
    predicate_id = _predicates.register_predicate(
        "document-arrival", {"kind": "entity", "id": "AAPL", "symbol": "AAPL"}, {}, "u1",
    )
    _predicates.suspend_predicate(predicate_id, "u1")
    app.dependency_overrides[get_current_user] = lambda: {"id": "u1", "role": "member"}
    try:
        r_default = client.get("/api/alerts/taxonomy/document-arrival")
        assert r_default.status_code == 200
        assert predicate_id not in [p["id"] for p in r_default.json()["predicates"]], \
            "default (active_only=True) must not regress -- a suspended predicate stays hidden"

        r_all = client.get("/api/alerts/taxonomy/document-arrival?active_only=false")
        assert r_all.status_code == 200
        ids = [p["id"] for p in r_all.json()["predicates"]]
        assert predicate_id in ids, "active_only=false must surface the caller's own suspended predicate"
    finally:
        app.dependency_overrides.clear()


def test_suspend_is_ownership_scoped_at_the_route(client):
    from api.main import app
    from api.middleware.auth_middleware import get_current_user
    from api.services.alert_taxonomy import predicates as _predicates
    predicate_id = _predicates.register_predicate(
        "document-arrival", {"kind": "entity", "id": "AAPL", "symbol": "AAPL"}, {}, "owner-user",
    )
    app.dependency_overrides[get_current_user] = lambda: {"id": "someone-else", "role": "member"}
    try:
        r = client.delete(f"/api/alerts/taxonomy/document-arrival/{predicate_id}")
        assert r.status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_manual_sweep_trigger_requires_admin(client):
    from api.main import app
    from api.middleware.auth_middleware import get_current_user
    app.dependency_overrides[get_current_user] = lambda: {"id": "u1", "role": "member"}
    try:
        r = client.post("/api/admin/alerts/taxonomy/run-document-arrival-sweep")
        assert r.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_manual_sweep_trigger_runs_for_admin(client, monkeypatch):
    from api.main import app
    from api.middleware.auth_middleware import get_current_user
    app.dependency_overrides[get_current_user] = lambda: {"id": "admin1", "role": "admin"}
    try:
        r = client.post("/api/admin/alerts/taxonomy/run-document-arrival-sweep")
        assert r.status_code == 200
        assert "checked" in r.json()
    finally:
        app.dependency_overrides.clear()
