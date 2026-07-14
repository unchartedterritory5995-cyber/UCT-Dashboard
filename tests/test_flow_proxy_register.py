"""register_on(): the proxy mounts only when enabled, and its routes win
because they register BEFORE the local flow routers (FastAPI first-match)."""
import importlib

from fastapi import FastAPI
from fastapi.testclient import TestClient


def _reload(monkeypatch, enabled: str):
    monkeypatch.setenv("FLOW_READS_PROXY_ENABLED", enabled)
    monkeypatch.setenv("WORKER_INTERNAL_URL", "http://flow-worker.railway.internal:8080")
    from api import flow_proxy
    importlib.reload(flow_proxy)
    return flow_proxy


def test_register_on_disabled_is_noop(monkeypatch):
    fp = _reload(monkeypatch, "0")
    app = FastAPI()
    assert fp.register_on(app) is False
    paths = {getattr(r, "path", "") for r in app.routes}
    assert not any(p.startswith("/api/flow") for p in paths)


def test_register_on_enabled_mounts_and_wins(monkeypatch):
    fp = _reload(monkeypatch, "1")
    app = FastAPI()
    assert fp.register_on(app) is True

    @app.get("/api/flow/data")  # local route registered AFTER the proxy
    def local_flow_data():
        return {"src": "local"}

    paths = {getattr(r, "path", "") for r in app.routes}
    assert any(p.startswith("/api/flow") for p in paths)

    # First-match wins: the request resolves to the proxy handler (upstream is
    # unreachable in tests -> its honest 502), NOT the local route.
    c = TestClient(app, raise_server_exceptions=False)
    r = c.get("/api/flow/data")
    assert r.status_code == 502
    assert "local" not in r.text
