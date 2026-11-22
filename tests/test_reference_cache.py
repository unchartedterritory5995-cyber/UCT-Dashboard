"""Which reference answers the member's own browser may keep (api/services/reference_cache.py)."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.responses import Response

from api.routers import delisted as delisted_router
from api.routers import earnings as earnings_router
from api.routers import single_stock_etfs as ssetf_router
from api.routers import ticker_meta as meta_router
from api.services import reference_cache as rc


@pytest.fixture(autouse=True)
def on(monkeypatch):
    monkeypatch.delenv(rc.SWITCH, raising=False)


def _cc(resp) -> str | None:
    return resp.headers.get("cache-control")


# ── the helper ────────────────────────────────────────────────────────────────

def test_allow_marks_private_with_the_time_and_never_public():
    r = Response()
    rc.allow(r, 300)
    assert _cc(r) == "private, max-age=300"


@pytest.mark.parametrize("off", ["0", "false", "OFF", "no"])
def test_the_switch_leaves_the_answer_untouched(monkeypatch, off):
    monkeypatch.setenv(rc.SWITCH, off)
    r = Response()
    rc.allow(r, 300)
    assert _cc(r) is None


def test_allow_never_raises_and_ignores_a_zero_time():
    rc.allow(None, 300)
    r = Response()
    rc.allow(r, 0)
    assert _cc(r) is None


def test_no_time_is_longer_than_a_day():
    times = [rc.DELISTED_S, rc.TICKER_IPO_FINAL_S, rc.SINGLE_STOCK_ETFS_S, rc.TICKER_META_S, rc.CHART_MARKERS_S]
    assert all(0 < t <= 86400 for t in times)


# ── through the real routes: the header reaches the wire ──────────────────────

def test_delisted_is_kept_for_both_answers_over_http(monkeypatch):
    app = FastAPI()
    app.include_router(delisted_router.router)
    app.dependency_overrides[delisted_router.require_paid] = lambda: {"id": 1}
    monkeypatch.setattr(delisted_router.delisted_registry, "resolve",
                        lambda sym: {"ticker": "OLDCO", "year": 2008} if sym == "OLDCO" else None)
    client = TestClient(app)
    gone, live = client.get("/api/delisted/OLDCO"), client.get("/api/delisted/NVDA")
    assert gone.json()["delisted"] is True and live.json() == {"ticker": "NVDA", "delisted": False}
    assert _cc(gone) == _cc(live) == "private, max-age=%d" % rc.DELISTED_S


def test_delisted_refused_without_a_plan_is_not_kept():
    app = FastAPI()
    app.include_router(delisted_router.router)
    r = TestClient(app).get("/api/delisted/NVDA")
    assert r.status_code in (401, 402, 403) and "max-age" not in (_cc(r) or "")


# ── each handler marks only a complete answer ─────────────────────────────────

def test_single_stock_etfs_kept_when_on_and_never_when_switched_off(monkeypatch):
    monkeypatch.setattr(ssetf_router.ss, "_enabled", lambda: True)
    monkeypatch.setattr(ssetf_router.ss, "lookup", lambda s: {"symbol": s, "long": ["NVDL"]})
    r = Response()
    assert ssetf_router.ssetf_lookup("NVDA", response=r, user={})["long"] == ["NVDL"]
    assert _cc(r) == "private, max-age=%d" % rc.SINGLE_STOCK_ETFS_S
    monkeypatch.setattr(ssetf_router.ss, "_enabled", lambda: False)
    r = Response()
    ssetf_router.ssetf_lookup("NVDA", response=r, user={})
    assert _cc(r) is None


def test_ticker_meta_kept_only_when_it_names_the_company(monkeypatch):
    monkeypatch.setattr(meta_router, "get_ticker_meta", lambda t: {"name": "NVIDIA", "sector": "Tech", "industry": "Semis"})
    r = Response()
    meta_router.ticker_meta("nvda", response=r)
    assert _cc(r) == "private, max-age=%d" % rc.TICKER_META_S

    monkeypatch.setattr(meta_router, "get_ticker_meta", lambda t: {"name": None, "sector": None, "industry": None})
    r = Response()
    meta_router.ticker_meta("zzzz", response=r)
    assert _cc(r) is None, "an empty answer may be a provider that has not answered yet"

    def boom(t):
        raise RuntimeError("provider down")
    monkeypatch.setattr(meta_router, "get_ticker_meta", boom)
    r = Response()
    assert meta_router.ticker_meta("nvda", response=r) == {"name": None, "sector": None, "industry": None}
    assert _cc(r) is None


def test_ticker_ipo_kept_only_when_the_first_trade_day_is_final(monkeypatch):
    monkeypatch.setattr(meta_router, "get_ipo_date", lambda t: {"symbol": t, "list_date": "1999-01-22",
                                                                "first_trade_date": "1999-01-22", "first_trade_final": True})
    r = Response()
    meta_router.ticker_ipo("nvda", response=r)
    assert _cc(r) == "private, max-age=%d" % rc.TICKER_IPO_FINAL_S

    monkeypatch.setattr(meta_router, "get_ipo_date", lambda t: {"symbol": t, "list_date": "1999-01-22",
                                                                "first_trade_date": "1999-01-22", "first_trade_final": False})
    r = Response()
    meta_router.ticker_ipo("nvda", response=r)
    assert _cc(r) is None, "a non-final day is polled until the resolve lands"

    def boom(t):
        raise RuntimeError("x")
    monkeypatch.setattr(meta_router, "get_ipo_date", boom)
    r = Response()
    assert meta_router.ticker_ipo("nvda", response=r) == {"symbol": "NVDA", "list_date": None}
    assert _cc(r) is None


def test_chart_markers_kept_only_when_a_history_was_built(monkeypatch):
    import api.services.earnings_estimates as ee
    monkeypatch.setattr(ee, "get_chart_markers", lambda t: {"earnings": [{"date": "2999-01-01"}], "splits": [], "dividends": []})
    r = Response()
    assert earnings_router.chart_markers_endpoint("nvda", days=730, response=r)["earnings"]
    assert _cc(r) == "private, max-age=%d" % rc.CHART_MARKERS_S

    monkeypatch.setattr(ee, "get_chart_markers", lambda t: {})
    r = Response()
    assert earnings_router.chart_markers_endpoint("nvda", days=730, response=r) == {"earnings": [], "splits": [], "dividends": []}
    assert _cc(r) is None, "an empty answer may be a build that has not finished"
