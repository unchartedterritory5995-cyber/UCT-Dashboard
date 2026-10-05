"""FT-041/042/043 -- member data exports (api/routers/data_exports.py).

Recorded fixtures only: every page function the exports read is replaced with a
fixed payload, so these tests assert the GATES, the METER and the FILE, never a
vendor."""
from __future__ import annotations

import csv
import io
import zipfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import data_exports as rx
from api.services import daily_counters
from api.services import data_exports as svc

PAID = {"id": "u-paid", "role": "member", "plan": "pro"}
FREE = {"id": "u-free", "role": "member", "plan": "free"}

SCAN_PAGES = {
    1: {"rows": [{"ticker": "NVDA", "price": 120.5, "company": "=HYPERLINK(\"x\")"},
                 {"ticker": "AAPL", "price": 230.0, "company": "Apple"}],
        "view_columns": ["ticker", "company", "price"], "total": 3,
        "snapshot_date": "2026-10-01"},
    2: {"rows": [{"ticker": "MSFT", "price": 410.0, "company": "Microsoft"}],
        "view_columns": ["ticker", "company", "price"], "total": 3,
        "snapshot_date": "2026-10-01"},
}
NEWS = [{"headline": "Fed holds", "source": "Wire", "url": "https://x/1", "time": "2026-10-02 09:30:00",
         "category": "MACRO", "sentiment": "neutral", "tickers": ["SPY", "QQQ"],
         "body": "THE FULL ARTICLE MUST NEVER BE EXPORTED"}]
CHAIN = {"ticker": "SPY", "expiration": "2026-10-23", "spot": 700.0,
         "calls": [{"strike": 700, "bid": 5.0, "ask": 5.2, "iv": 0.14, "delta": 0.5,
                    "contract": "O:SPY261023C00700000", "secret_vendor_field": 1}],
         "puts": [{"strike": 700, "bid": 4.8, "ask": 5.0, "iv": 0.15, "delta": -0.5,
                   "contract": "O:SPY261023P00700000"}]}


@pytest.fixture(autouse=True)
def _fresh_counters(monkeypatch):
    from api.limiter import limiter
    limiter.reset()               # the burst window is in-memory and process-wide
    daily_counters.clear()
    monkeypatch.setattr(svc, "_et_day", lambda: "2026-10-02")
    yield
    daily_counters.clear()
    limiter.reset()


def _client(user, monkeypatch, *, armed=True):
    from api.middleware.auth_middleware import get_current_user_with_plan
    from api.services.screener import query as scr_query
    from api.services import polygon_options, watchlist_service
    from api.services import engine
    from api.routers import options_chain

    if armed:
        monkeypatch.setenv(svc.FLAG, "1")
    else:
        monkeypatch.delenv(svc.FLAG, raising=False)
    monkeypatch.setattr(rx, "is_paid_user", lambda u: u.get("plan") == "pro")
    monkeypatch.setattr(svc, "SCREENER_PAGE", 2)
    monkeypatch.setattr(scr_query, "run_scan",
                        lambda spec, user_id=None, user=None: SCAN_PAGES[spec["page"]])
    monkeypatch.setattr(engine, "get_news", lambda: list(NEWS))
    monkeypatch.setattr(polygon_options, "get_chain",
                        lambda s, expiration="", strikes_around_spot=6: dict(CHAIN))
    monkeypatch.setattr(options_chain, "is_enabled", lambda: True)
    monkeypatch.setattr(watchlist_service, "get_watchlist",
                        lambda wl_id, uid: ({"name": "Leaders", "items": [
                            {"sym": "NVDA", "notes": "-1R stop", "added_at": "2026-09-01"}]}
                            if wl_id == "w1" and uid == "u-paid" else None))
    app = FastAPI()
    app.include_router(rx.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: user
    return TestClient(app)


def _csv(resp):
    return list(csv.reader(io.StringIO(resp.content.decode("utf-8-sig"))))


def test_dark_by_default_every_route_404_and_nothing_counted(monkeypatch):
    c = _client(PAID, monkeypatch, armed=False)
    for path in ("/api/exports/quota", "/api/exports/news", "/api/exports/watchlists/w1",
                 "/api/exports/options/SPY/chain", "/api/exports/bars/SPY"):
        assert c.get(path).status_code == 404, path
    assert c.post("/api/exports/screener", json={"filters": []}).status_code == 404
    assert daily_counters.value("2026-10-02", svc.SCOPE, "u-paid") == 0


def test_free_member_is_402(monkeypatch):
    c = _client(FREE, monkeypatch)
    assert c.get("/api/exports/news").status_code == 402
    assert c.post("/api/exports/screener", json={"filters": []}).status_code == 402


def test_screener_export_pages_every_row_in_displayed_columns(monkeypatch):
    r = _client(PAID, monkeypatch).post("/api/exports/screener?format=csv", json={"filters": []})
    assert r.status_code == 200
    assert "attachment" in r.headers["content-disposition"]
    assert "screen_2026-10-01" in r.headers["content-disposition"]
    rows = _csv(r)
    assert rows[0] == ["ticker", "company", "price"]
    assert [x[0] for x in rows[1:]] == ["NVDA", "AAPL", "MSFT"]
    assert r.headers["x-export-rows"] == "3"


def test_a_formula_looking_cell_is_made_literal(monkeypatch):
    rows = _csv(_client(PAID, monkeypatch).post("/api/exports/screener", json={"filters": []}))
    assert rows[1][1].startswith("'=")


def test_news_export_carries_only_what_the_list_shows(monkeypatch):
    r = _client(PAID, monkeypatch).get("/api/exports/news")
    rows = _csv(r)
    assert rows[0] == svc.NEWS_COLUMNS
    assert "THE FULL ARTICLE" not in r.content.decode("utf-8-sig")
    assert rows[1][4] == "SPY, QQQ"


def test_chain_export_is_the_chain_pages_columns_and_no_more(monkeypatch):
    r = _client(PAID, monkeypatch).get("/api/exports/options/SPY/chain?expiration=2026-10-23")
    rows = _csv(r)
    assert rows[0] == svc.CHAIN_COLUMNS
    assert "secret_vendor_field" not in r.content.decode()
    assert [x[0] for x in rows[1:]] == ["call", "put"]


def test_chain_export_rides_the_chain_flag(monkeypatch):
    from api.routers import options_chain
    c = _client(PAID, monkeypatch)
    monkeypatch.setattr(options_chain, "is_enabled", lambda: False)
    assert c.get("/api/exports/options/SPY/chain").status_code == 404


def test_watchlist_export_is_owner_scoped(monkeypatch):
    c = _client(PAID, monkeypatch)
    assert _csv(c.get("/api/exports/watchlists/w1"))[1] == ["NVDA", "'-1R stop", "2026-09-01"]
    assert c.get("/api/exports/watchlists/someone-elses").status_code == 404
    # a not-found export gives its charge back
    assert daily_counters.value("2026-10-02", svc.SCOPE, "u-paid") == 1


def test_xlsx_is_a_real_workbook(monkeypatch):
    r = _client(PAID, monkeypatch).get("/api/exports/news?format=xlsx")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/vnd.openxmlformats")
    z = zipfile.ZipFile(io.BytesIO(r.content))
    assert {"[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"} <= set(z.namelist())
    sheet = z.read("xl/worksheets/sheet1.xml").decode()
    assert "Fed holds" in sheet and "headline" in sheet


def test_bad_format_is_422_and_uncharged(monkeypatch):
    c = _client(PAID, monkeypatch)
    assert c.get("/api/exports/news?format=pdf").status_code == 422
    assert daily_counters.value("2026-10-02", svc.SCOPE, "u-paid") == 0


def test_daily_cap_refuses_with_a_sentence_and_counts_per_member(monkeypatch):
    monkeypatch.setenv(svc.CAP_ENV, "2")
    monkeypatch.setattr(rx, "_burst", lambda uid: None)
    c = _client(PAID, monkeypatch)
    assert c.get("/api/exports/news").status_code == 200
    assert c.get("/api/exports/news").status_code == 200
    r = c.get("/api/exports/news")
    assert r.status_code == 429 and "export limit" in r.json()["detail"]
    q = c.get("/api/exports/quota").json()
    assert q["used"] == 2 and q["remaining"] == 0 and q["cap"] == 2


def test_a_failed_build_gives_its_charge_back(monkeypatch):
    from api.services import polygon_options
    c = _client(PAID, monkeypatch)
    monkeypatch.setattr(polygon_options, "get_chain",
                        lambda s, expiration="", strikes_around_spot=6: {"error": "timeout"})
    r = c.get("/api/exports/options/SPY/chain")
    assert r.status_code == 503 and "unavailable" in r.json()["detail"]
    assert daily_counters.value("2026-10-02", svc.SCOPE, "u-paid") == 0


def test_burst_limit_is_per_member(monkeypatch):
    from api.limiter import limiter
    monkeypatch.setattr(limiter, "enabled", True)
    limiter.reset()
    c = _client(PAID, monkeypatch)
    codes = [c.get("/api/exports/news").status_code for _ in range(7)]
    assert codes[:6] == [200] * 6 and codes[6] == 429
    limiter.reset()


def test_bars_export_reads_serve_bars(monkeypatch):
    import json
    from fastapi.responses import JSONResponse
    from api.routers import bars as bars_mod
    seen = {}

    def fake(ticker, tf, n, *a, **k):
        seen.update(ticker=ticker, tf=tf, n=n)
        return JSONResponse(content={"ticker": ticker, "bars": [
            {"time": 1, "open": 1, "high": 2, "low": 0.5, "close": 1.5, "volume": 10}]})
    monkeypatch.setattr(bars_mod, "serve_bars", fake)
    r = _client(PAID, monkeypatch).get("/api/exports/bars/nvda?tf=D&bars=500")
    rows = _csv(r)
    assert rows[0] == ["time", "open", "high", "low", "close", "volume"]
    assert seen == {"ticker": "nvda", "tf": "D", "n": 500}


def test_safe_cell_leaves_numbers_alone():
    assert svc.safe_cell(-1.5) == -1.5
    assert svc.safe_cell("-1.5") == "'-1.5"
    assert svc.safe_cell(None) == ""
