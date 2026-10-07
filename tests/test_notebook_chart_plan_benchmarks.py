"""Wave 13 lane 13H-2 -- the `/vs` benchmark choices (`chart_plan.benchmark_options` and
`GET /api/j2/chart-plan/benchmarks`).

The broad pair (SPY, QQQ) is fixed; the sector ETF and the theme ETF are LOOKED UP from tables
that already exist. These rails hold:
  * the sector ETF comes from `sector_strength.SECTOR_ETFS` (read here, never retyped), for both
    the provider spellings ("Healthcare", "Financial Services") and the GICS ones;
  * an unknown sector or a theme with no ETF yields NO option and a reason -- never a guess;
  * the stock is never compared against itself;
  * the route is behind the chart-plan gate (404 while off, before the session) and refuses a
    symbol that is not one.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.services.journal_two import chart_plan
from api.services.sector_strength import SECTOR_ETFS


def _opts(res):
    return {o["key"]: o["symbol"] for o in res["options"]}


def test_every_sector_in_the_one_table_resolves_to_its_own_etf():
    for name, etf in SECTOR_ETFS.items():
        assert chart_plan.sector_etf(name) == (etf, name), name
    # CONTROL: the table really is the source -- a name it does not hold resolves to nothing
    assert chart_plan.sector_etf("Shell Companies") is None


@pytest.mark.parametrize("provider_name,key", [
    ("Healthcare", "Healthcare"), ("Health Care", "Healthcare"),
    ("Financial Services", "Financials"), ("Consumer Cyclical", "Consumer Discretionary"),
    ("Consumer Defensive", "Consumer Staples"), ("Basic Materials", "Materials"),
    ("Information Technology", "Technology"), ("  technology ", "Technology"),
])
def test_provider_and_gics_spellings_land_on_the_same_row(provider_name, key):
    assert chart_plan.sector_etf(provider_name) == (SECTOR_ETFS[key], key)


def test_a_stock_gets_spy_qqq_its_sector_and_its_theme():
    res = chart_plan.benchmark_options("nvda", sector_fn=lambda s: "Technology",
                                       theme_fn=lambda s: ("SMH", "Semiconductors"))
    assert res["symbol"] == "NVDA"
    assert _opts(res) == {"SPY": "SPY", "QQQ": "QQQ", "sector": SECTOR_ETFS["Technology"], "theme": "SMH"}
    assert res["missing"] == {}


def test_an_unknown_sector_or_theme_is_a_reason_never_a_guess():
    res = chart_plan.benchmark_options("ZZZZ", sector_fn=lambda s: None, theme_fn=lambda s: None)
    assert set(_opts(res)) == {"SPY", "QQQ"}
    assert "sector" in res["missing"] and "theme" in res["missing"]
    # a lookup that RAISES is the same honest absence, not a 500
    def boom(_s):
        raise RuntimeError("provider down")
    res2 = chart_plan.benchmark_options("ZZZZ", sector_fn=boom, theme_fn=boom)
    assert set(_opts(res2)) == {"SPY", "QQQ"} and set(res2["missing"]) == {"sector", "theme"}


def test_a_stock_is_never_compared_against_itself():
    res = chart_plan.benchmark_options("SPY", sector_fn=lambda s: None, theme_fn=lambda s: None)
    assert "SPY" not in {o["symbol"] for o in res["options"]}
    res = chart_plan.benchmark_options("SMH", sector_fn=lambda s: None, theme_fn=lambda s: ("SMH", "Semis"))
    assert "SMH" not in {o["symbol"] for o in res["options"]}


def test_a_theme_etf_equal_to_the_sector_etf_is_offered_once():
    etf = SECTOR_ETFS["Technology"]
    res = chart_plan.benchmark_options("AAPL", sector_fn=lambda s: "Technology", theme_fn=lambda s: (etf, "Tech"))
    assert [o["symbol"] for o in res["options"]].count(etf) == 1


def test_a_symbol_that_is_not_one_answers_empty():
    assert chart_plan.benchmark_options("not a ticker!") == {"symbol": None, "options": [], "missing": {}}


@pytest.fixture
def client():
    from api.routers import notebook_chart_alerts
    app = FastAPI()
    app.include_router(notebook_chart_alerts.router)
    c = TestClient(app)
    c.app_ = app
    yield c
    app.dependency_overrides.clear()


def test_the_route_is_404_while_the_flag_is_off_then_asks_for_a_session(client, monkeypatch):
    monkeypatch.delenv(chart_plan.FLAG, raising=False)
    assert client.get("/api/j2/chart-plan/benchmarks?symbol=NVDA").status_code == 404
    monkeypatch.setenv(chart_plan.FLAG, "1")
    # CONTROL: with the gate open, the session is what answers (the 404 above was the gate)
    assert client.get("/api/j2/chart-plan/benchmarks?symbol=NVDA").status_code == 401


def test_the_route_answers_the_resolver_and_refuses_a_non_symbol(client, monkeypatch):
    monkeypatch.setenv(chart_plan.FLAG, "1")
    # Owner ruling 2026-10-02 (security review I-7): a member with no paid plan is refused.
    free = {"id": "m1", "role": "member", "plan": "free"}
    client.app_.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(free)
    refused = client.get("/api/j2/chart-plan/benchmarks?symbol=xom")
    assert refused.status_code == 402 and "paid plan" in refused.json()["detail"]
    user = {"id": "m1", "role": "member", "plan": "pro"}
    client.app_.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)
    monkeypatch.setattr(chart_plan, "_stock_sector", lambda s: "Energy")
    monkeypatch.setattr(chart_plan, "_stock_theme_etf", lambda s: None)
    r = client.get("/api/j2/chart-plan/benchmarks?symbol=xom")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["symbol"] == "XOM"
    assert _opts(body)["sector"] == SECTOR_ETFS["Energy"]
    assert "theme" in body["missing"]
    assert client.get("/api/j2/chart-plan/benchmarks?symbol=").status_code == 422
    assert client.get("/api/j2/chart-plan/benchmarks?symbol=no%20way").status_code == 422
