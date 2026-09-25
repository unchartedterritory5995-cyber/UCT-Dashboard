"""The series API: dark by default, same entitlement as /api/bars, ETag/304,
explicit 400/404, missing series listed, Beta from UCT bars."""
from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.bars_auth import require_bars_access
from api.routers import fundamentals_pit as R
from api.services.fundamentals_pit import derive as D, serving

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


def _synthetic_closes(beta=1.5, n=400):
    import random
    rnd = random.Random(5)
    spy, stock, px, sx = [], [], 100.0, 50.0
    d0 = date(2022, 1, 3)
    for i in range(n):
        r = rnd.gauss(0, 0.01)
        px *= 1 + r
        sx *= 1 + beta * r
        spy.append((d0 + timedelta(days=i), px))
        stock.append((d0 + timedelta(days=i), sx))
    return spy, stock


def test_beta_is_precomputed_on_the_worker_and_the_request_only_reads(app, tmp_path, monkeypatch):
    """OWNER RULING: no synchronous historical Beta on a member request. The
    worker computes (beta_store.refresh); the route reads. A request with the
    close source rigged to explode must still serve the precomputed series."""
    from api.services.fundamentals_pit import beta_store as B, store as S
    monkeypatch.setenv("FUNDAMENTALS_PIT_ENABLED", "1")
    spy, stock = _synthetic_closes()
    calls = []
    def closes(sym):
        calls.append(sym)
        return spy if sym == "SPY" else stock
    conn = S.connect(str(tmp_path / "pit.db"))
    first = B.refresh(conn, [CIK], closes_fn=closes, now=1)
    again = B.refresh(conn, [CIK], closes_fn=closes, now=2)          # idempotent: inputs unchanged
    assert first["built"] == 1 and again == {"built": 0, "unchanged": 1, "no_ticker": 0, "no_prices": 0}
    conn.close()
    serving.clear_cache()
    import api.services.fundamentals_pit.beta as beta_mod
    monkeypatch.setattr(beta_mod, "rolling_beta", lambda *a, **k: (_ for _ in ()).throw(AssertionError("computed on request")))
    monkeypatch.setattr(B, "bars_closes", lambda s: (_ for _ in ()).throw(AssertionError("read closes on request")))
    body = _authed(app).get("/api/fundamentals/pit/series/TST?series=beta_1y_spy").json()
    pts = body["metrics"]["beta_1y_spy"]
    assert abs(pts[-1][1] - 1.5) < 1e-6 and len(pts[-1]) == 2


def test_beta_rebuilds_when_a_new_session_arrives(tmp_path):
    from api.services.fundamentals_pit import beta_store as B, store as S
    from .test_pipeline import _run
    _run(tmp_path)
    spy, stock = _synthetic_closes()
    conn = S.connect(str(tmp_path / "pit.db"))
    B.refresh(conn, [CIK], closes_fn=lambda s: spy if s == "SPY" else stock, now=1)
    n0 = len(B.read(conn, CIK)["points"])
    spy2, stock2 = _synthetic_closes(n=401)
    r = B.refresh(conn, [CIK], closes_fn=lambda s: spy2 if s == "SPY" else stock2, now=2)
    doc = B.read(conn, CIK)
    assert r["built"] == 1 and len(doc["points"]) == n0 + 1
    assert doc["methodology"]["benchmark"] == "SPY" and doc["methodology"]["subtitle"] == "1Y daily · Benchmark: SPY"
    # no lookahead: every point is stamped at its own session's close, ascending
    ts = [p[0] for p in doc["points"]]
    assert ts == sorted(ts)


def test_the_api_preserves_a_gap_as_null_end_to_end(app, tmp_path, monkeypatch):
    """Gap contract, API link: a stored gap reaches the member payload as
    [t, null, period_end, 'gap'] -- never dropped, never a number."""
    from datetime import date, datetime, timezone
    from api.services.fundamentals_pit import store as S
    from api.services.fundamentals_pit.series import GAP, Point
    monkeypatch.setenv("FUNDAMENTALS_PIT_ENABLED", "1")
    conn = S.connect(str(tmp_path / "pit.db"))
    pts = S.read_series(conn, CIK, D.DERIVATION_VERSION, ["revenue_ttm"])["revenue_ttm"]
    last = pts[-1]
    t_gap = datetime.fromtimestamp(last[0] + 86400 * 90, timezone.utc)
    rows = [Point(datetime.fromtimestamp(t, timezone.utc), v, date.fromisoformat(pe), (), m) for t, v, pe, m in pts]
    rows.append(Point(t_gap, float("nan"), date(2099, 3, 31), (), GAP))
    with S.tx(conn):
        S.replace_series(conn, CIK, D.DERIVATION_VERSION, {"revenue_ttm": rows}, "h", {})
    conn.close()
    serving.clear_cache()
    body = _authed(app).get("/api/fundamentals/pit/series/TST?series=revenue_ttm").json()
    got = body["metrics"]["revenue_ttm"]
    assert got[-1][1] is None and got[-1][3] == GAP and got[-1][0] == int(t_gap.timestamp())
    assert all(p[1] is not None for p in got[:-1])
