"""GET /api/modelbook/catalog (2026-10-17): every year's gallery list, gain stats and stored
recap in one answer, so opening Model Book is one request instead of ~100.

The load-bearing property is that each part EQUALS the per-year endpoint's answer: the page
files them under those endpoints' cache keys, so any difference would show a member a
different list than the per-year endpoint would.

⚠️ MODELBOOK_DB_PATH is isolated to a temp file; background warms and recap generation are
stubbed (they would reach the network).
"""
import os
import tempfile

import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
from api.routers import modelbook as mb
from api.services import modelbook_service as svc

FREE_USER = {"id": "mbc-free", "email": "mbcfree@example.test", "role": "member", "plan": "free"}
PAID_USER = {"id": "mbc-paid", "email": "mbcpaid@example.test", "role": "member", "plan": "pro"}


@pytest.fixture(autouse=True)
def _isolated(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(svc, "_DB_PATH", os.path.join(d, "modelbook.db"))
        svc._init_db()
        monkeypatch.setattr(mb, "_warm_year_async", lambda year: None)
        monkeypatch.setattr(mb, "_gen_recap_async", lambda year: None)
        yield


@pytest.fixture
def client_as():
    def _make(user):
        app.dependency_overrides[get_current_user] = lambda: dict(user)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
        return TestClient(app, raise_server_exceptions=False)
    yield _make
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_current_user_with_plan, None)


def _stock(year, symbol, order=1):
    return {"year": year, "symbol": symbol, "company": f"{symbol} Co", "sector": None,
            "industry": None, "sort_order": order, "thesis": "t", "gain_pct": 10.0}


def _seed():
    svc.create_stock(_stock(2020, "AAA", 1))
    svc.create_stock(_stock(2020, "BBB", 2))
    svc.create_stock(_stock(2013, "CCC", 1))
    svc.save_year_recap(2013, {"headline": "h13", "recap": "r13", "market_tone": "bull",
                               "trader_score": 8, "themes": ["x"]})
    svc.save_year_recap(1999, {"headline": "h99", "recap": "r99", "market_tone": "bull",
                               "trader_score": 9, "themes": []})        # a year with no stocks


def test_every_part_equals_the_per_year_endpoint(client_as):
    _seed()
    c = client_as(PAID_USER)
    cat = c.get("/api/modelbook/catalog").json()
    assert cat["years"] == c.get("/api/modelbook/years").json()["years"] == [2020, 2013]
    for y in cat["years"]:
        part = cat["by_year"][str(y)]
        assert part["stocks"] == c.get(f"/api/modelbook/stocks?year={y}").json()
        assert part["stats"] == c.get(f"/api/modelbook/year-stats?year={y}").json()
    for y, r in cat["recaps"].items():
        assert r == c.get(f"/api/modelbook/year-recap?year={y}").json()


def test_stored_recaps_are_included_even_for_a_year_without_stocks(client_as):
    _seed()
    cat = client_as(PAID_USER).get("/api/modelbook/catalog").json()
    assert set(cat["recaps"]) == {"2013", "1999"}
    assert cat["recaps"]["1999"]["headline"] == "h99"


def test_CONTROL_a_year_without_a_stored_recap_is_left_to_the_hover(client_as):
    _seed()
    cat = client_as(PAID_USER).get("/api/modelbook/catalog").json()
    assert "2020" not in cat["recaps"]


def test_an_empty_book_answers_empty(client_as):
    cat = client_as(PAID_USER).get("/api/modelbook/catalog").json()
    assert cat == {"years": [], "by_year": {}, "recaps": {}}


def test_free_user_is_refused_with_402(client_as):
    assert client_as(FREE_USER).get("/api/modelbook/catalog").status_code == 402


def test_anonymous_caller_is_refused():
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_current_user_with_plan, None)
    r = TestClient(app, raise_server_exceptions=False).get("/api/modelbook/catalog")
    assert r.status_code in (401, 403)


def test_the_lists_carry_the_gallery_not_the_write_ups(client_as):
    """The catalog was 589 KB on production because every year's list shipped each stock's
    full write-up (thesis, what the company does, why it ran). The gallery never reads them;
    the detail panel reads them from /stock/{id}, which still carries every one."""
    _seed()
    sid = svc.get_stocks_for_year(2020)[0]["id"]
    svc.update_stock(sid, {"company_desc": "d" * 400, "run_story": "s" * 2000})
    c = client_as(PAID_USER)
    cat = c.get("/api/modelbook/catalog").json()
    listed = [s for part in cat["by_year"].values() for s in part["stocks"]["stocks"]]
    listed += c.get("/api/modelbook/stocks?year=2020").json()["stocks"]
    assert listed
    for s in listed:
        assert not {"thesis", "company_desc", "run_story"} & set(s), s
        assert {"id", "year", "symbol", "company", "gain_pct", "setup_count"} <= set(s)
    detail = c.get(f"/api/modelbook/stock/{sid}").json()
    assert detail["thesis"] == "t" and detail["run_story"] == "s" * 2000
