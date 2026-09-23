"""The series API: dark by default, same entitlement as /api/bars, ETag/304,
explicit 400/404, missing series listed, Beta from UCT bars."""
from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.bars_auth import require_bars_access
from api.routers import fundamentals_pit as R
from api.services.fundamentals_pit import serving

from .test_pipeline import CIK, _run


@pytest.fixture
def app(tmp_path, monkeypatch):
    _run(tmp_path)                                     # builds pit.db with TESTCO / TST
    monkeypatch.setenv("FUNDAMENTALS_PIT_SOURCE", "db")
    monkeypatch.setenv("FUNDAMENTALS_PIT_DB_PATH", str(tmp_path / "pit.db"))
    serving.clear_cache()
    a = FastAPI()
    a.include_router(R.router)
    return a


def _authed(app):
    app.dependency_overrides[require_bars_access] = lambda: {"id": 1}
    return TestClient(app)


def test_dark_unless_enabled(app, monkeypatch):
    monkeypatch.delenv("FUNDAMENTALS_PIT_ENABLED", raising=False)
    c = _authed(app)
    assert c.get("/api/fundamentals/pit/catalog").status_code == 404
    assert c.get("/api/fundamentals/pit/series/TST?series=revenue_ttm").status_code == 404


def test_requires_the_chart_data_entitlement(app, monkeypatch):
    monkeypatch.setenv("FUNDAMENTALS_PIT_ENABLED", "1")
    assert TestClient(app).get("/api/fundamentals/pit/series/TST?series=revenue_ttm").status_code == 401


def test_series_payload_etag_and_304(app, monkeypatch):
    monkeypatch.setenv("FUNDAMENTALS_PIT_ENABLED", "1")
    c = _authed(app)
    r = c.get("/api/fundamentals/pit/series/tst?series=revenue_ttm,revenue_q,net_margin_ttm")
    assert r.status_code == 200 and r.headers["cache-control"].startswith("private")
    body = r.json()
    assert body["cik"] == CIK and body["symbol"] == "TST"
    assert body["metrics"]["revenue_q"][-1][1:3] == [130, "2023-12-31"]
    assert "net_margin_ttm" in body["missing"]                       # no net income filed
    again = c.get("/api/fundamentals/pit/series/TST?series=revenue_ttm,revenue_q,net_margin_ttm",
                  headers={"If-None-Match": r.headers["etag"]})
    assert again.status_code == 304


def test_unknown_series_and_symbol(app, monkeypatch):
    monkeypatch.setenv("FUNDAMENTALS_PIT_ENABLED", "1")
    c = _authed(app)
    assert c.get("/api/fundamentals/pit/series/TST?series=forward_pe").status_code == 400
    assert c.get("/api/fundamentals/pit/series/NOPE?series=revenue_ttm").status_code == 404


def test_catalog_route_serves_only_ready_metrics(app, monkeypatch):
    monkeypatch.setenv("FUNDAMENTALS_PIT_ENABLED", "1")
    body = _authed(app).get("/api/fundamentals/pit/catalog").json()
    ids = {m["id"] for m in body["metrics"]}
    assert {"revenue_ttm", "net_margin", "beta_1y_spy", "market_cap"} <= ids and "forward_pe" not in ids


def test_beta_is_computed_from_uct_bars(app, monkeypatch):
    monkeypatch.setenv("FUNDAMENTALS_PIT_ENABLED", "1")
    import random
    rnd = random.Random(5)
    spy, stock, px, sx = [], [], 100.0, 50.0
    d0 = date(2022, 1, 3)
    for i in range(400):
        r = rnd.gauss(0, 0.01)
        px *= 1 + r
        sx *= 1 + 1.5 * r
        spy.append((d0 + timedelta(days=i), px))
        stock.append((d0 + timedelta(days=i), sx))
    monkeypatch.setattr(serving, "_default_closes", lambda s: spy if s == "SPY" else stock)
    body = _authed(app).get("/api/fundamentals/pit/series/TST?series=beta_1y_spy").json()
    pts = body["metrics"]["beta_1y_spy"]
    assert abs(pts[-1][1] - 1.5) < 1e-6 and pts[-1][3] == "rolling_252d"
