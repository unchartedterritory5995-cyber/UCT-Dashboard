"""MNA (mergers and acquisitions) and IDXC (index changes): `api/services/mergers.py`,
`api/services/index_changes.py`, their routes, and the five typed functions in `api/services/fmp_client.py`.

What is held here:
  * each route is one paid GET: signed out 401, a free plan 402, a bad `sym` or `index` 400, none of them
    reaching the service;
  * each typed function sends its own documented path and parameters through the one adapter and stamps
    the unregistered class "U";
  * parsing is defensive: unknown fields are dropped; a row without a date or a symbol is skipped and
    counted; exact repeats are kept once; a link that is not https on sec.gov is not kept;
  * a company's deals: only rows naming its symbol, or its held name read without suffixes, are kept, the
    others counted; with no name held there is no search;
  * index changes: the date is `dateAdded` read as a date, else `date`; one stock's history comes out of
    the held lists with no read of its own; capped newest first;
  * the provider is asked once per lifetime, never on the request thread; a refusal is an `unavailable`
    answer held for hours, a failure a `failed` answer held for five minutes.

Every symbol, name, date and link below is invented. Nothing here reaches a vendor.
"""
from __future__ import annotations

import threading
import time

import pytest
import requests
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import MagicMock

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import index_changes as idx_route
from api.routers import mergers as mna_route
from api.services import fmp_client as fc
from api.services import held_build
from api.services import held_reads
from api.services import index_changes as ic
from api.services import mergers as mna

FREE_USER = {"id": "mna-free", "email": "free@example.test", "role": "member", "plan": "free"}
PAID_USER = {"id": "mna-paid", "email": "paid@example.test", "role": "member", "plan": "pro"}
FOLLOWED = frozenset({"QQZA", "QQZB", "QQZC"})


def _client(router, user):
    app = FastAPI()
    app.include_router(router)
    if user is not None:
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app, raise_server_exceptions=False)


def deal(sym, name, target, day, **over):
    row = {"symbol": sym, "companyName": name, "cik": "0000000001", "targetedCompanyName": target,
           "transactionDate": day, "acceptedDate": f"{day} 16:20:38", "link": "https://www.sec.gov/Archives/edgar/data/1/made-up.htm",
           "unknownField": "dropped"}
    row.update(over)
    return row


# ── the routes ───────────────────────────────────────────────────────────────────────────────

def test_the_mergers_route_is_one_paid_get_and_a_refused_caller_never_reaches_the_service(monkeypatch):
    asked = []
    monkeypatch.setattr(mna, "get_latest", lambda **k: asked.append("latest") or {"status": "ok", "scope": "latest"})
    monkeypatch.setattr(mna, "get_company", lambda sym, **k: asked.append(sym) or {"status": "ok", "scope": "company"})
    (r,) = mna_route.router.routes
    assert r.path == "/api/research/mergers" and r.methods == {"GET"}
    assert mna_route.require_paid.__module__ == "api.routers.mergers"
    assert mna_route.require_paid in {d.call for d in r.dependant.dependencies}
    assert _client(mna_route.router, None).get("/api/research/mergers").status_code == 401
    refused = _client(mna_route.router, FREE_USER).get("/api/research/mergers")
    assert refused.status_code == 402 and refused.json() == {"detail": "Mergers and acquisitions require a paid plan"}
    assert _client(mna_route.router, PAID_USER).get("/api/research/mergers?sym=not a ticker!").status_code == 400
    assert asked == []
    paid = _client(mna_route.router, PAID_USER)
    assert paid.get("/api/research/mergers").json()["scope"] == "latest"
    assert paid.get("/api/research/mergers?sym=").json()["scope"] == "latest"
    assert paid.get("/api/research/mergers?sym=qqza").json()["scope"] == "company"
    assert asked == ["latest", "latest", "QQZA"]


def test_the_index_changes_route_is_one_paid_get_and_a_refused_caller_never_reaches_the_service(monkeypatch):
    asked = []
    monkeypatch.setattr(ic, "get_changes", lambda index, sym: asked.append((index, sym)) or {"status": "ok"})
    (r,) = idx_route.router.routes
    assert r.path == "/api/research/index-changes" and r.methods == {"GET"}
    assert idx_route.require_paid.__module__ == "api.routers.index_changes"
    url = "/api/research/index-changes"
    assert _client(idx_route.router, None).get(url).status_code == 401
    refused = _client(idx_route.router, FREE_USER).get(url)
    assert refused.status_code == 402 and refused.json() == {"detail": "Index changes require a paid plan"}
    paid = _client(idx_route.router, PAID_USER)
    bad = paid.get(url + "?index=russell")
    assert bad.status_code == 400 and bad.json() == {"detail": "index must be all, sp500, nasdaq100 or dow"}
    assert paid.get(url + "?sym=not a ticker!").status_code == 400
    assert asked == []
    paid.get(url)
    paid.get(url + "?index=NASDAQ100&sym=qqza")
    assert asked == [("all", None), ("nasdaq100", "QQZA")]


def test_both_routes_are_mounted_on_the_app():
    import re
    from pathlib import Path
    src = (Path(__file__).resolve().parents[1] / "api" / "main.py").read_text(encoding="utf-8")
    for mod in ("mergers", "index_changes"):
        assert re.search(rf"^from api\.routers import {mod} as {mod}_router\b", src, re.M), mod
        assert re.search(rf"^app\.include_router\({mod}_router\.router\)", src, re.M), mod


# ── the typed functions ──────────────────────────────────────────────────────────────────────

PATHS = ("/stable/mergers-acquisitions-latest", "/stable/mergers-acquisitions-search", "/stable/historical-sp500-constituent",
         "/stable/historical-nasdaq-constituent", "/stable/historical-dowjones-constituent")


@pytest.fixture
def adapter(monkeypatch):
    monkeypatch.setenv("FMP_API_KEY", "test-key")
    monkeypatch.setenv("FMP_RESPONSE_CACHE", "0")
    fc._bucket_tokens = fc._FMP_RATE_LIMIT_PER_MIN
    fc._bucket_updated = time.monotonic()
    from api.services.cache import cache
    for p in PATHS:
        cache.invalidate(f"fmp_forbidden_{p}")
    calls = []

    def answer(status=200, body=None):
        def get(url, params=None, timeout=None):
            calls.append((url, dict(params or {})))
            resp = MagicMock()
            resp.status_code = status
            resp.json.return_value = body if body is not None else []
            resp.raise_for_status.side_effect = requests.exceptions.HTTPError(str(status)) if status >= 400 else None
            return resp
        monkeypatch.setattr(fc._session, "get", get)
        calls.clear()
        return calls

    yield answer
    for p in PATHS:
        cache.invalidate(f"fmp_forbidden_{p}")


@pytest.mark.parametrize("call,path,params", [
    (lambda: fc.get_mergers_acquisitions_latest(), "/stable/mergers-acquisitions-latest", {"page": 0, "limit": 100}),
    (lambda: fc.get_mergers_acquisitions_latest(page=2, limit=50), "/stable/mergers-acquisitions-latest", {"page": 2, "limit": 50}),
    (lambda: fc.search_mergers_acquisitions("Quillfeather Mills"), "/stable/mergers-acquisitions-search", {"name": "Quillfeather Mills"}),
    (lambda: fc.get_historical_sp500_constituents(), "/stable/historical-sp500-constituent", {}),
    (lambda: fc.get_historical_nasdaq_constituents(), "/stable/historical-nasdaq-constituent", {}),
    (lambda: fc.get_historical_dowjones_constituents(), "/stable/historical-dowjones-constituent", {}),
])
def test_each_function_sends_its_documented_path_and_parameters_and_stamps_U(adapter, call, path, params):
    calls = adapter(200, [{"symbol": "QQZA"}])
    res = call()
    ((url, sent),) = calls
    assert url == f"{fc._BASE_URL}{path}"
    assert {k: v for k, v in sent.items() if k != "apikey"} == params
    assert res.licensing_class == "U" and res.value == [{"symbol": "QQZA"}]


def test_an_empty_answer_is_not_found_and_a_refusal_is_not_in_plan(adapter):
    adapter(200, [])
    assert held_reads.fmp_leg(fc.get_historical_dowjones_constituents)[0] == "none"
    adapter(402, None)
    assert held_reads.fmp_leg(fc.get_mergers_acquisitions_latest, page=0, limit=100)[:3:2] == ("not_in_plan", 402)


# ── deals: shaping ───────────────────────────────────────────────────────────────────────────

def test_deals_newest_first_with_unknown_fields_dropped_and_unreadable_rows_counted():
    rows = [
        deal("QQZA", "Quillfeather Mills Inc.", "Tinmoor Works", "2031-03-10", targetedSymbol="QQZB", targetedCik="0000000002"),
        deal("QQZC", "Bramblecourt Corp", "Fernhollow LLC", "2031-03-12", link="https://example.test/sec.gov/not-sec"),
        deal("", "No Symbol Co", "Somebody", "2031-03-11"),
        deal("QQZD", "Undated Ltd", "Somebody", None, acceptedDate=None),
        deal("QQZE", "Accepted Only plc", "Target X", None, acceptedDate="2031-03-09 08:00:00"),
        "not a row",
        deal("QQZA", "Quillfeather Mills Inc.", "Tinmoor Works", "2031-03-10", targetedSymbol="QQZB", targetedCik="0000000002"),
    ]
    deals, dropped = mna.shape_deals(rows, FOLLOWED)
    assert dropped == 3
    assert [(d["date"], d["acquirer"]["sym"]) for d in deals] == [("2031-03-12", "QQZC"), ("2031-03-10", "QQZA"), ("2031-03-09", "QQZE")]
    first = deals[1]
    assert first == {"date": "2031-03-10", "accepted_at": "2031-03-10 16:20:38",
                     "acquirer": {"sym": "QQZA", "name": "Quillfeather Mills Inc.", "cik": "0000000001", "covered": True},
                     "target": {"sym": "QQZB", "name": "Tinmoor Works", "cik": "0000000002", "covered": True},
                     "link": "https://www.sec.gov/Archives/edgar/data/1/made-up.htm"}
    assert deals[0]["link"] is None                          # https, but not on sec.gov: not kept
    assert mna._link("http://www.sec.gov/Archives/x.htm") is None and mna._link("https://sec.gov.example.test/x") is None
    assert mna._link("https://www.sec.gov/Archives/x.htm") == "https://www.sec.gov/Archives/x.htm"
    assert deals[2]["target"] == {"sym": None, "name": "Target X", "cik": None, "covered": False}
    assert deals[2]["acquirer"]["covered"] is False


def test_a_company_name_is_read_without_its_suffixes():
    assert mna.name_key("Quillfeather Mills, Inc.") == "quillfeather mills"
    assert mna.name_key("QUILLFEATHER MILLS CORP") == "quillfeather mills"
    assert mna.name_key("The Bramblecourt Group Holdings Ltd") == "bramblecourt"
    assert mna.name_key(None) == ""


# ── deals: holding and asking ────────────────────────────────────────────────────────────────

class Provider:
    def __init__(self):
        self.asked = []
        self.pages = {0: [deal("QQZA", "Quillfeather Mills Inc", "Tinmoor Works", "2031-03-10")] * 1}
        self.search = ("ok", [])
        self.latest_state = "ok"
        self.gate = None

    def leg(self, fn, *args, **kwargs):
        if self.gate is not None:
            self.gate.wait(10)
        self.asked.append((fn.__name__, args, kwargs, threading.current_thread().name))
        if fn is fc.get_mergers_acquisitions_latest:
            if self.latest_state != "ok":
                return self.latest_state, None, 403 if self.latest_state == "not_in_plan" else None
            rows = self.pages.get(kwargs["page"])
            return ("ok", rows, None) if rows else ("none", None, None)
        if fn is fc.search_mergers_acquisitions:
            state, value = self.search
            return state, value, None
        raise AssertionError(fn)


@pytest.fixture
def provider(monkeypatch, tmp_path):
    p = Provider()
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(mna, "fmp_leg", p.leg)
    monkeypatch.setattr(held_reads, "site_universe", lambda: FOLLOWED)
    monkeypatch.setattr(held_reads, "held_name", lambda s: {"QQZA": "Quillfeather Mills, Inc."}.get(s))
    mna.reset_for_tests()
    yield p
    if p.gate is not None:
        p.gate.set()
    mna._latest.drain(10)
    mna._company.drain(10)
    mna.reset_for_tests()


def test_the_latest_list_reads_pages_until_a_short_one_off_the_request_thread(provider, monkeypatch):
    monkeypatch.setattr(mna, "PAGE_SIZE", 2)
    provider.pages = {0: [deal("QQZA", "A", "T1", "2031-03-10"), deal("QQZB", "B", "T2", "2031-03-09")],
                      1: [deal("QQZC", "C", "T3", "2031-03-08")], 2: [deal("QQZA", "A", "T9", "2031-03-01")]}
    body = mna.get_latest(wait_s=10)
    mna._latest.drain(10)
    assert body["status"] == "ok" and body["scope"] == "latest" and body["pages_read"] == 2 and body["cut"] is False
    assert [d["target"]["name"] for d in body["deals"]] == ["T1", "T2", "T3"]
    assert [a[2]["page"] for a in provider.asked] == [0, 1]
    assert all(a[3] != threading.current_thread().name for a in provider.asked)


def test_a_full_last_page_says_the_feed_holds_older_deals(provider, monkeypatch):
    monkeypatch.setattr(mna, "PAGE_SIZE", 1)
    monkeypatch.setattr(mna, "LATEST_PAGES", 2)
    provider.pages = {0: [deal("QQZA", "A", "T1", "2031-03-10")], 1: [deal("QQZB", "B", "T2", "2031-03-09")]}
    body = mna.get_latest(wait_s=10)
    assert body["pages_read"] == 2 and body["cut"] is True


def test_the_latest_list_is_read_once_an_hour_at_most(provider):
    mna.get_latest(wait_s=10)
    for _ in range(4):
        assert mna.get_latest(wait_s=0)["status"] == "ok"
    mna._latest.drain(10)
    assert len(provider.asked) == 1
    with mna._latest._lock:
        mna._latest._state["checked"] -= mna.LATEST_TTL_S
    mna.get_latest(wait_s=0)
    mna._latest.drain(10)
    assert len(provider.asked) == 2
    assert mna.LATEST_TTL_S == 3600


def test_a_refused_plan_is_an_unavailable_answer_held_for_hours_and_a_failure_for_minutes(provider):
    provider.latest_state = "not_in_plan"
    body = mna.get_latest(wait_s=10)
    assert body == {"status": "unavailable", "reason": "not_in_plan", "http_status": 403, "scope": "latest",
                    "source": "Financial Modeling Prep"}
    with mna._latest._lock:
        assert mna._latest._state["retry_at"] - time.time() > mna.REFUSED_HOLD_S - 60
    mna.reset_for_tests()
    provider.latest_state = "failed"
    assert mna.get_latest(wait_s=10)["status"] == "failed"
    with mna._latest._lock:
        assert mna._latest._state["retry_at"] - time.time() <= mna.FAILED_HOLD_S


def test_with_nothing_held_a_slow_read_answers_computing(provider):
    provider.gate = threading.Event()
    assert mna.get_latest(wait_s=0.05) == {"status": "computing", "scope": "latest", "source": "Financial Modeling Prep"}
    provider.gate.set()


def test_a_companys_deals_keep_only_rows_naming_it_and_count_the_rest(provider):
    provider.search = ("ok", [
        deal("QQZA", "Quillfeather Mills Inc", "Tinmoor Works", "2031-02-01"),                       # its symbol
        deal("QQZX", "Ashgrove Partners", "QUILLFEATHER MILLS CORP", "2031-01-15"),                   # its name, as target
        deal("QQZY", "Quillfeather Mills Hospitality Trust", "Other Co", "2031-01-10"),               # a different company
        deal("QQZZ", "Unrelated Co", "Someone", "2031-01-05", targetedSymbol="QQZA"),                 # its symbol as target
    ])
    mna.get_latest(wait_s=10)
    body = mna.get_company("QQZA", wait_s=10)
    mna._company.drain(10)
    assert body["status"] == "ok" and body["scope"] == "company" and body["name"] == "Quillfeather Mills, Inc."
    assert body["search"] == "ok" and body["other_companies"] == 1
    assert [(d["date"], d["acquirer"]["sym"]) for d in body["deals"]] == [
        ("2031-03-10", "QQZA"), ("2031-02-01", "QQZA"), ("2031-01-15", "QQZX"), ("2031-01-05", "QQZZ")]
    assert body["from_latest"] == 1
    searches = [a for a in provider.asked if a[0] == "search_mergers_acquisitions"]
    assert [a[1] for a in searches] == [("Quillfeather Mills, Inc.",)]


def test_with_no_name_held_there_is_no_search(provider):
    body = mna.get_company("QQZB", wait_s=10)
    assert body["status"] == "ok" and body["search"] == "no_name" and body["deals"] == []
    assert not [a for a in provider.asked if a[0] == "search_mergers_acquisitions"]


def test_a_failed_search_with_nothing_else_found_is_a_failed_answer(provider):
    provider.search = ("failed", None)
    provider.pages = {}                                   # the latest list names no deal of the company
    body = mna.get_company("QQZA", wait_s=10)
    assert body["status"] == "failed" and body["scope"] == "company" and body["sym"] == "QQZA"


def test_a_failed_search_beside_deals_in_the_latest_list_answers_with_them_and_says_the_search_failed(provider):
    provider.search = ("failed", None)
    mna.get_latest(wait_s=10)
    mna._latest.drain(10)
    body = mna.get_company("QQZA", wait_s=10)
    assert body["status"] == "ok" and body["search"] == "failed" and body["from_latest"] == 1
    assert mna._company_due(body, time.time() - mna.FAILED_HOLD_S) is True


def test_a_company_is_searched_once_per_lifetime(provider):
    mna.get_company("QQZA", wait_s=10)
    mna._company.drain(10)
    for _ in range(3):
        mna.get_company("QQZA", wait_s=0)
    mna._company.drain(10)
    assert len([a for a in provider.asked if a[0] == "search_mergers_acquisitions"]) == 1
    assert mna.COMPANY_TTL_S == 6 * 3600


# ── index changes ────────────────────────────────────────────────────────────────────────────

def chg(sym, added, removed_sym, removed, date_added, date=None, reason="Market capitalization change."):
    return {"symbol": sym, "addedSecurity": added, "removedTicker": removed_sym, "removedSecurity": removed,
            "dateAdded": date_added, "date": date, "reason": reason, "unknownField": 1}


def test_the_change_date_is_date_added_read_as_a_date_else_date():
    assert ic.change_date({"dateAdded": "June 23, 2031", "date": "2031-07-01"}) == "2031-06-23"
    assert ic.change_date({"dateAdded": "2031-06-23"}) == "2031-06-23"
    assert ic.change_date({"dateAdded": "Jun 3, 2031"}) == "2031-06-03"
    assert ic.change_date({"dateAdded": "soon", "date": "2031-07-01"}) == "2031-07-01"
    assert ic.change_date({"dateAdded": None, "date": None}) is None


def test_changes_newest_first_with_unreadable_rows_counted_and_repeats_kept_once():
    rows = [
        chg("QQZA", "Quillfeather Mills", "QQZR", "Rustbank Inc", "March 3, 2031"),
        chg("QQZB", "Bramblecourt Foods", None, None, "May 1, 2031"),
        chg(None, None, "QQZS", "Saltmarsh Co", "April 2, 2031"),
        chg(None, None, None, None, "April 2, 2031"),                  # neither side: skipped
        chg("QQZC", "Undated", None, None, None),                      # no date: skipped
        chg("QQZA", "Quillfeather Mills", "QQZR", "Rustbank Inc", "March 3, 2031"),
        7,
    ]
    out, dropped = ic.shape_changes(rows, "sp500", FOLLOWED)
    assert dropped == 3
    assert [(c["date"], (c["added"] or {}).get("sym"), (c["removed"] or {}).get("sym")) for c in out] == [
        ("2031-05-01", "QQZB", None), ("2031-04-02", None, "QQZS"), ("2031-03-03", "QQZA", "QQZR")]
    assert out[2] == {"index": "sp500", "date": "2031-03-03",
                      "added": {"sym": "QQZA", "name": "Quillfeather Mills", "covered": True},
                      "removed": {"sym": "QQZR", "name": "Rustbank Inc", "covered": False},
                      "reason": "Market capitalization change."}


class Lists:
    def __init__(self):
        self.asked = []
        self.answers = {
            "get_historical_sp500_constituents": ("ok", [chg("QQZA", "Quillfeather Mills", "QQZR", "Rustbank Inc", "March 3, 2031"),
                                                         chg("QQZB", "Bramblecourt Foods", "QQZT", "Tinmoor Works", "January 9, 2030")]),
            "get_historical_nasdaq_constituents": ("ok", [chg("QQZC", "Fernhollow", "QQZA", "Quillfeather Mills", "March 3, 2031")]),
            "get_historical_dowjones_constituents": ("not_in_plan", None),
        }
        self.gate = None

    def leg(self, fn, *a, **k):
        if self.gate is not None:
            self.gate.wait(10)
        self.asked.append((fn.__name__, threading.current_thread().name))
        state, value = self.answers[fn.__name__]
        return state, value, 403 if state == "not_in_plan" else None


@pytest.fixture
def lists(monkeypatch, tmp_path):
    p = Lists()
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(ic, "fmp_leg", p.leg)
    monkeypatch.setattr(held_reads, "site_universe", lambda: FOLLOWED)
    ic.reset_for_tests()
    yield p
    if p.gate is not None:
        p.gate.set()
    ic._held.drain(10)
    ic.reset_for_tests()


def test_one_build_reads_the_three_lists_off_the_request_thread_and_merges_them_newest_first(lists):
    body = ic.get_changes("all", wait_s=10)
    ic._held.drain(10)
    assert body["status"] == "ok" and body["index"] == "all" and body["sym"] is None
    assert [a[0] for a in lists.asked] == ["get_historical_sp500_constituents", "get_historical_nasdaq_constituents",
                                           "get_historical_dowjones_constituents"]
    assert all(a[1] != threading.current_thread().name for a in lists.asked)
    assert [(c["index"], c["date"]) for c in body["changes"]] == [("sp500", "2031-03-03"), ("nasdaq100", "2031-03-03"), ("sp500", "2030-01-09")]
    assert body["indexes"]["dow"] == {"state": "not_in_plan", "http_status": 403, "count": 0, "dropped": 0}
    assert body["indexes"]["sp500"]["count"] == 2 and body["total"] == 3 and body["cut"] is False


def test_one_index_and_one_stock_come_out_of_the_held_lists_with_no_read_of_their_own(lists):
    ic.get_changes("all", wait_s=10)
    ic._held.drain(10)
    n = len(lists.asked)
    nasdaq = ic.get_changes("nasdaq100", wait_s=0)
    assert [c["index"] for c in nasdaq["changes"]] == ["nasdaq100"]
    mine = ic.get_changes("all", "QQZA", wait_s=0)
    assert [(c["index"], (c["added"] or {}).get("sym"), (c["removed"] or {}).get("sym")) for c in mine["changes"]] == [
        ("sp500", "QQZA", "QQZR"), ("nasdaq100", "QQZC", "QQZA")]
    assert mine["sym"] == "QQZA"
    ic._held.drain(10)
    assert len(lists.asked) == n


def test_past_the_cap_the_newest_are_kept_and_the_cut_is_said(lists, monkeypatch):
    monkeypatch.setattr(ic, "SHOWN_CAP", 2)
    body = ic.get_changes("all", wait_s=10)
    assert len(body["changes"]) == 2 and body["total"] == 3 and body["cut"] is True
    assert body["changes"][-1]["date"] == "2031-03-03"


def test_all_three_failing_is_a_failed_answer_held_for_five_minutes(lists):
    for k in lists.answers:
        lists.answers[k] = ("failed", None)
    body = ic.get_changes("all", wait_s=10)
    assert body == {"status": "failed", "reason": "source", "http_status": None, "index": "all", "sym": None,
                    "source": "Financial Modeling Prep"}
    for _ in range(3):
        ic.get_changes("all", wait_s=0)
    ic._held.drain(10)
    assert len(lists.asked) == 3


def test_the_lists_are_refreshed_once_a_day_or_after_five_minutes_when_one_failed():
    ok = {"indexes": {"sp500": {"state": "ok"}, "dow": {"state": "not_in_plan"}}}
    partial = {"indexes": {"sp500": {"state": "ok"}, "dow": {"state": "failed"}}}
    assert ic.refresh_due(ok, 10.0, now=10.0 + 86_399) is False
    assert ic.refresh_due(ok, 10.0, now=10.0 + 86_400) is True
    assert ic.refresh_due(partial, 10.0, now=10.0 + 300) is True
    assert ic.refresh_due(partial, 10.0, now=10.0 + 299) is False


def test_the_held_lists_survive_a_restart_without_a_read(lists):
    ic.get_changes("all", wait_s=10)
    ic._held.drain(10)
    ic._held.reset()
    assert ic.get_changes("all", wait_s=0)["status"] == "ok" and len(lists.asked) == 3


def test_with_nothing_held_a_slow_read_answers_computing(lists):
    lists.gate = threading.Event()
    assert ic.get_changes("sp500", wait_s=0.05) == {"status": "computing", "index": "sp500", "sym": None, "source": "Financial Modeling Prep"}
    lists.gate.set()


def test_the_build_raises_the_house_stop():
    with pytest.raises(held_build.Stop):
        raise mna._stop_for("failed", 500, "x")
    assert mna._stop_for("not_in_plan", 403, "x").state == "unavailable"
    assert mna._stop_for("not_in_plan", 403, "x").hold == mna.REFUSED_HOLD_S
    assert mna._stop_for("rate_limited", 429, "x").reason == "rate_limited"
