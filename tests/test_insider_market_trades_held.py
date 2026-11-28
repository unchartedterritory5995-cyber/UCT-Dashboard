"""INS SELLS / INS BOTH / INS 30D / INS 90D (2026-11-27): the held market build in `api/services/insider.py`.

The request path (`get_market_insider_trades`, `GET /api/insider/feed?scope=market&side=&days=`) answers at once
from what the module holds and starts one background build; the build pages the vendor's market-wide Form 4 feed
(purchases and, new, sales) back to the window, bounded per side. The vendor is never called for real: both
`fmp_client.search_insider_*` functions are replaced by name with invented pages.
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import insider as insider_router
from api.services import fmp_client, insider, provider_errors


def _day(offset: int) -> str:
    return (datetime.utcnow() - timedelta(days=offset)).strftime("%Y-%m-%d")


def _row(sym="ZBUY", kind="P-Purchase", ad="A", shares=1000, price=10.0, traded=1, filed=0, name="Jane Doe"):
    return {"symbol": sym, "filingDate": _day(filed), "transactionDate": _day(traded), "reportingName": name,
            "typeOfOwner": "director", "transactionType": kind, "acquisitionOrDisposition": ad,
            "securitiesTransacted": shares, "price": price, "formType": "4"}


def _ok(rows):
    return provider_errors.ProviderResult(
        value=rows, provenance=provider_errors.ProvenanceRecord(vendor="fmp", source_activity="test"),
        licensing_class="R")


def _pages(pages):
    """A vendor stand-in serving `pages` in order (a short page ends the paging), recording the pages asked."""
    asked = []

    def fetch(page, limit=100, *, timeout=None):
        asked.append(page)
        if page >= len(pages):
            raise fmp_client.FMPNotFound("no more", vendor="fmp")
        got = pages[page]
        if isinstance(got, Exception):
            raise got
        return _ok(got)
    return fetch, asked


@pytest.fixture(autouse=True)
def _clean():
    with insider._held_lock:
        insider._held.clear()
        insider._held_building.update(key=None, started=None)
    yield
    with insider._held_lock:
        insider._held.clear()
        insider._held_building.update(key=None, started=None)


def _full(rows):
    return rows + [_row(sym="ZPAD", traded=200, filed=1)] * (insider._MARKET_PAGE_LIMIT - len(rows))


class TestTheBuild:
    def test_sells_are_read_from_their_own_feed_and_classified_as_sales(self, monkeypatch):
        sells, asked = _pages([[_row(sym="ZSEL", kind="S-Sale", ad="D", shares=5000, price=20.0),
                                _row(sym="ZODD", kind="S-Sale", ad="", shares=9e9),          # no direction: dropped
                                _row(sym="ZBUY")]])                                          # a purchase: not a sale
        monkeypatch.setattr(fmp_client, "search_insider_sales", sells)
        monkeypatch.setattr(fmp_client, "search_insider_purchases", lambda *a, **k: pytest.fail("buys not asked"))
        out = insider.build_market_trades("sells", 7)
        assert out["status"] == "ok" and out["complete"] is True
        assert [(r["symbol"], r["type"], r["amount"]) for r in out["rows"]] == [("ZSEL", "sell", 100000.0)]
        assert asked == [0] and out["sides"]["sells"]["reached_window"] is True

    def test_both_merges_the_two_sides_largest_first_and_caps_at_fifty(self, monkeypatch):
        buys, _ = _pages([[_row(sym=f"B{i}", price=1.0 + i) for i in range(30)]])
        sells, _ = _pages([[_row(sym=f"S{i}", kind="S-Sale", ad="D", price=100.0 + i) for i in range(40)]])
        monkeypatch.setattr(fmp_client, "search_insider_purchases", buys)
        monkeypatch.setattr(fmp_client, "search_insider_sales", sells)
        out = insider.build_market_trades("both", 30)
        assert len(out["rows"]) == insider._MARKET_CAP == out["cap"] and out["matched"] == 70 and out["cut"] is True
        amounts = [r["amount"] for r in out["rows"]]
        assert amounts == sorted(amounts, reverse=True)
        assert {r["type"] for r in out["rows"]} == {"buy", "sell"}

    def test_the_window_is_the_trade_date_and_a_long_window_pages_further(self, monkeypatch):
        # 30 days: a buy traded 20 days ago counts; the 7-day bound would not reach it.
        pages = [_full([_row(sym="ZNEW", traded=1)])] * 3 + [[_row(sym="ZOLD", traded=20, filed=19)]]
        fetch, asked = _pages(pages)
        monkeypatch.setattr(fmp_client, "search_insider_purchases", fetch)
        out = insider.build_market_trades("buys", 30)
        assert {r["symbol"] for r in out["rows"]} >= {"ZNEW", "ZOLD"} and asked == [0, 1, 2, 3]
        assert "ZPAD" not in {r["symbol"] for r in out["rows"]}          # traded 200 days ago: outside

    def test_a_build_that_hits_its_page_bound_says_how_far_back_it_reached(self, monkeypatch):
        monkeypatch.setitem(insider._HELD_MAX_PAGES["sells"], 90, 2)
        page = _full([_row(sym="ZSEL", kind="S-Sale", ad="D", filed=3, traded=3)])
        for r in page:
            r["filingDate"] = _day(3)
        fetch, asked = _pages([page, page, page])
        monkeypatch.setattr(fmp_client, "search_insider_sales", fetch)
        out = insider.build_market_trades("sells", 90)
        side = out["sides"]["sells"]
        assert asked == [0, 1] and side["reached_window"] is False and side["covered_from"] == _day(3)
        assert out["complete"] is False and side["max_pages"] == 2

    def test_a_failed_page_is_incomplete_and_a_total_failure_keeps_the_last_good_answer(self, monkeypatch):
        ok, _ = _pages([[_row(sym="ZSEL", kind="S-Sale", ad="D")]])
        monkeypatch.setattr(fmp_client, "search_insider_sales", ok)
        good = insider.build_market_trades("sells", 7)
        down, _ = _pages([RuntimeError("down")])
        monkeypatch.setattr(fmp_client, "search_insider_sales", down)
        after = insider.build_market_trades("sells", 7)
        assert after["status"] == "ok" and after["rows"] == good["rows"] and "last_build_failed_at" in after
        with insider._held_lock:
            insider._held.clear()
        first = insider.build_market_trades("sells", 7)
        assert first["status"] == "failed" and first["rows"] is None and "could not be read" in first["reason"]

    def test_the_answer_is_held_in_the_module_never_in_the_shared_cache(self, monkeypatch):
        from api.services.cache import cache
        before = set(cache._store)
        ok, _ = _pages([[_row(sym="ZSEL", kind="S-Sale", ad="D")]])
        monkeypatch.setattr(fmp_client, "search_insider_sales", ok)
        insider.build_market_trades("sells", 7)
        assert set(cache._store) == before and ("sells", 7) in insider._held


class TestTheRequestPath:
    def test_a_first_ask_is_computing_at_once_and_starts_one_build(self, monkeypatch):
        gate = threading.Event()
        started = []

        def slow(page, limit=100, *, timeout=None):
            started.append(page)
            gate.wait(5)
            return _ok([_row(sym="ZSEL", kind="S-Sale", ad="D")])
        monkeypatch.setattr(fmp_client, "search_insider_sales", slow)
        t0 = time.time()
        first = insider.get_market_insider_trades("sells", 7)
        second = insider.get_market_insider_trades("sells", 30)       # another key while one build runs
        assert time.time() - t0 < 1.0
        assert first["status"] == "computing" and first["rows"] is None
        assert second["status"] == "computing"
        gate.set()
        for _ in range(100):
            if insider._held_building["key"] is None:
                break
            time.sleep(0.02)
        assert ("sells", 7) in insider._held and ("sells", 30) not in insider._held   # one build, not two
        held = insider.get_market_insider_trades("sells", 7)
        assert held["status"] == "ok" and held["rows"][0]["symbol"] == "ZSEL" and held["refreshing"] is False

    def test_a_fresh_answer_starts_no_build_and_a_stale_one_is_served_while_it_rebuilds(self, monkeypatch):
        starts = []
        monkeypatch.setattr(insider, "_start_held_build", lambda key: starts.append(key) or True)
        with insider._held_lock:
            insider._held[("both", 90)] = {"status": "ok", "complete": True, "rows": [{"symbol": "Z"}],
                                           "built_at": time.time(), "side": "both", "window_days": 90}
        assert insider.get_market_insider_trades("both", 90)["rows"] == [{"symbol": "Z"}] and starts == []
        with insider._held_lock:
            insider._held[("both", 90)]["built_at"] = time.time() - insider._HELD_FRESH_S - 1
        assert insider.get_market_insider_trades("both", 90)["status"] == "ok" and starts == [("both", 90)]

    def test_an_incomplete_answer_is_rebuilt_sooner(self, monkeypatch):
        starts = []
        monkeypatch.setattr(insider, "_start_held_build", lambda key: starts.append(key) or True)
        with insider._held_lock:
            insider._held[("sells", 90)] = {"status": "ok", "complete": False, "rows": [],
                                            "built_at": time.time() - insider._HELD_RETRY_S - 1}
        insider.get_market_insider_trades("sells", 90)
        assert starts == [("sells", 90)]

    def test_bad_arguments_are_refused(self):
        for side, days in (("short", 7), ("buys", 14), ("BUYS", 7)):
            with pytest.raises(ValueError):
                insider.get_market_insider_trades(side, days)


class TestTheRoute:
    @pytest.fixture
    def client(self):
        app = FastAPI()
        app.include_router(insider_router.router)
        app.dependency_overrides[insider_router.require_paid] = lambda: {"id": "u1"}
        return TestClient(app)

    def test_no_side_or_days_is_the_default_list_unchanged(self, client, monkeypatch):
        monkeypatch.setattr(insider_router, "get_market_insider_buys", lambda: [{"symbol": "ZBUY"}])
        monkeypatch.setattr(insider_router, "get_market_insider_trades", lambda s, d: pytest.fail("held path"))
        assert client.get("/api/insider/feed?scope=market").json() == [{"symbol": "ZBUY"}]

    def test_side_and_days_reach_the_held_build(self, client, monkeypatch):
        seen = []
        monkeypatch.setattr(insider_router, "get_market_insider_trades",
                            lambda s, d: seen.append((s, d)) or {"status": "computing"})
        assert client.get("/api/insider/feed?scope=market&side=sells").json() == {"status": "computing"}
        client.get("/api/insider/feed?scope=market&days=30")
        client.get("/api/insider/feed?scope=market&side=BOTH&days=90")
        assert seen == [("sells", 7), ("buys", 30), ("both", 90)]
        for bad in ("side=short", "days=14", "days=x"):
            assert client.get(f"/api/insider/feed?scope=market&{bad}").status_code in (400, 422), bad
