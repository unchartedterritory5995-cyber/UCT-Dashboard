"""Rails for the ETF holdings ROUTE — specifically that sector/industry get
attached from the universe-wide industry_map, not left null. See
api/routers/etf.py docstring for why the generic watchlist meta-batch path
(alphabetical + 100-cap) can't be trusted to cover a large ETF's holdings."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user
from api.routers import etf as router_mod
from api.services import etf_holdings, industry_map


def _client():
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": "u1", "role": "user"}
    return TestClient(app)


def test_holdings_route_attaches_sector_and_industry(monkeypatch):
    monkeypatch.setattr(
        etf_holdings, "get_holdings",
        lambda sym: [
            {"sym": "NVDA", "name": "Nvidia", "weight": 7.94},
            {"sym": "ZZUNMAPPED1", "name": "Unmapped", "weight": 0.01},
        ],
    )
    monkeypatch.setattr(
        industry_map, "get_groups",
        lambda tickers: {"NVDA": {"sector": "Technology", "industry": "Semiconductors"}},
    )
    r = _client().get("/api/etf/holdings/SPY")
    assert r.status_code == 200
    body = r.json()
    assert body["symbol"] == "SPY"
    by_sym = {h["sym"]: h for h in body["holdings"]}
    assert by_sym["NVDA"]["sector"] == "Technology"
    assert by_sym["NVDA"]["industry"] == "Semiconductors"
    # A holding the map hasn't classified yet (still warming) degrades to null,
    # never a KeyError / dropped row.
    assert by_sym["ZZUNMAPPED1"]["sector"] is None
    assert by_sym["ZZUNMAPPED1"]["industry"] is None


def test_holdings_route_bulk_call_covers_every_holding_not_just_first_100(monkeypatch):
    """The whole point of routing through get_groups() here instead of the
    generic meta-batch endpoint: it must be handed EVERY holding, not an
    alphabetically-sorted, 100-capped slice."""
    many = [{"sym": f"T{i:04d}", "name": None, "weight": 0.1} for i in range(503)]
    monkeypatch.setattr(etf_holdings, "get_holdings", lambda sym: many)

    seen = {}

    def _fake_get_groups(tickers):
        seen["tickers"] = list(tickers)
        return {t: {"sector": "S", "industry": "I"} for t in tickers}

    monkeypatch.setattr(industry_map, "get_groups", _fake_get_groups)
    r = _client().get("/api/etf/holdings/SPY")
    assert r.status_code == 200
    assert len(seen["tickers"]) == 503
    body = r.json()
    assert all(h["industry"] == "I" for h in body["holdings"])


def test_anon_is_rejected():
    app = FastAPI()
    app.include_router(router_mod.router)
    c = TestClient(app)
    assert c.get("/api/etf/holdings/SPY").status_code in (401, 403)
    assert c.get("/api/etf/symbols").status_code in (401, 403)
