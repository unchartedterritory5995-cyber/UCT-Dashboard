# tests/test_ssetf_router.py
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from api.middleware.auth_middleware import get_current_user, require_admin
from api.routers import single_stock_etfs as router_mod
from api.services import single_stock_etfs as ss

@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SSETF_DB_PATH", str(tmp_path / "ssetf.db"))
    import importlib; importlib.reload(ss)
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": "u1", "role": "user"}
    app.dependency_overrides[require_admin] = lambda: {"id": "a1", "role": "admin"}
    return TestClient(app)

def test_status_not_shadowed_by_symbol_wildcard(client):
    r = client.get("/api/single-stock-etfs/status")
    assert r.status_code == 200
    assert "etf_count" in r.json()          # status payload, NOT the family shape

def test_symbol_lookup_empty_shape(client):
    r = client.get("/api/single-stock-etfs/KO")
    assert r.status_code == 200
    assert r.json() == {"underlying": None, "long": [], "short": [],
                        "best_long": None, "best_short": None}

def test_rebuild_returns_started(client, monkeypatch):
    monkeypatch.setattr(ss, "_fetch_finviz_market", lambda: [])
    r = client.post("/api/single-stock-etfs/rebuild")
    assert r.status_code == 200 and r.json()["status"] == "started"

def _seed_nbis_family(monkeypatch):
    """Seed one NBIS family member so lookup('NBIS') returns a POPULATED family
    when enabled — makes the kill-switch test discriminate (flag-off must empty a
    non-empty family, not just echo an already-empty table)."""
    with ss._write_conn() as c:
        c.execute(
            "INSERT INTO etfs (etf_ticker, underlying, direction, factor, name, price,"
            " avg_volume, avg_dollar_vol, vol_source, updated_at)"
            " VALUES ('NBIU','NBIS','long',2.0,'Issuer 2x Long NBIS',50.0,1e6,5e7,'finviz',1)")
    ss.invalidate_cache()

def test_kill_switch_returns_empty(client, monkeypatch):
    # With the flag ON (default) a seeded family is returned...
    _seed_nbis_family(monkeypatch)
    on = client.get("/api/single-stock-etfs/NBIS").json()
    assert on["underlying"] == "NBIS" and on["best_long"] == "NBIU"
    # ...and with the flag OFF the SAME seeded table returns the empty shape.
    # (Discriminating: deleting the router's _enabled() guard makes this fail.)
    monkeypatch.setenv("SINGLE_STOCK_ETFS_ENABLED", "0")
    ss.invalidate_cache()
    off = client.get("/api/single-stock-etfs/NBIS").json()
    assert off["underlying"] is None and off["long"] == []

def test_anon_is_rejected(tmp_path, monkeypatch):
    monkeypatch.setenv("SSETF_DB_PATH", str(tmp_path / "s.db"))
    app = FastAPI(); app.include_router(router_mod.router)
    c = TestClient(app)
    assert c.post("/api/single-stock-etfs/rebuild").status_code in (401, 403)
    assert c.get("/api/single-stock-etfs/status").status_code in (401, 403)
    assert c.get("/api/single-stock-etfs/NBIS").status_code in (401, 403)
