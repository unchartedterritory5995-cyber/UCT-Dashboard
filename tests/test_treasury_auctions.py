"""AUCT: Treasury auctions, upcoming and recent results (`api/services/treasury_auctions.py`,
`api/routers/treasury_auctions.py`). Every security, amount and rate here is invented. Nothing
reaches the publisher: the HTTP client's transport is stood in for, the repository's own Fiscal
Data reader (`fiscaldata.fetch_all`) runs for real on top of it, and every request is recorded.
"""
from __future__ import annotations

import json
import threading
import time
from datetime import datetime
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import treasury_auctions as route
from api.services import treasury_auctions as ta
from api.services import treasury_yields as ty
from api.services.econ import http as econ_http

NY = ZoneInfo("America/New_York")
NOW = datetime(2026, 11, 18, 12, 0, tzinfo=NY)       # a Wednesday
TODAY = "2026-11-18"


def up(kind, term, when, **over):
    row = {"record_date": "2026-11-17", "security_type": kind, "security_term": term, "reopening": "No",
           "cusip": "00000AA11", "offering_amt": "58000000000", "announcemt_date": "2026-11-12",
           "comp_auction_close_date": when, "issue_date": "2026-11-30"}
    row.update(over)
    return row


def res(kind, term, when, **over):
    row = {"record_date": when, "cusip": f"00000{kind[:2].upper()}{when[-2:]}", "security_type": kind, "security_term": term,
           "comp_auction_close_date": when, "issue_date": "2026-11-16", "maturity_date": "2036-11-15",
           "offering_amt": "42000000000", "bid_to_cover_ratio": "2.58", "high_yield": "null", "high_rate": "null",
           "high_discnt_margin": "null", "reopening": "No", "inflation_protected": "No", "floating_rate": "No",
           "cash_management_bill": "No", "prim_deal_comp_par_awarded": "4200000000",
           "dir_bid_comp_par_awarded": "8400000000", "indir_bid_comp_par_awarded": "29400000000",
           "an_unknown_field": "kept out"}
    row.update(over)
    return row


UPCOMING = [
    up("Note", "7-Year", "2026-11-24", cusip="00000NT07", offering_amt="44000000000"),
    up("Bill", "13-Week", "2026-11-23", cusip="null", offering_amt="76000000000", issue_date="2026-11-27"),
    up("Bond", "20-Year", "2026-11-19", cusip="00000BD20", offering_amt="16000000000", reopening="Yes"),
    up("Bill", "13-Week", "2026-11-23", record_date="2026-11-13", cusip="null", offering_amt="70000000000"),   # an older list
    up("Note", "2-Year", "2026-11-17"),                              # already held
    up("null", "5-Year", "2026-11-25"),                              # no security: skipped and counted
    up("Note", "5-Year", "null"),                                    # no date: skipped and counted
]
RESULTS = [
    res("Note", "10-Year", "2026-11-12", high_yield="4.117"),
    res("Bill", "4-Week", "2026-11-17", high_rate="4.250", maturity_date="2026-12-15", bid_to_cover_ratio="2.91",
        prim_deal_comp_par_awarded="null"),
    res("Note", "2-Year FRN", "2026-11-10", high_discnt_margin="0.160", floating_rate="Yes"),
    res("Note", "10-Year TIPS", "2026-11-05", high_yield="1.842", inflation_protected="Yes", reopening="Yes"),
    res("Bond", "30-Year", "2026-11-20", bid_to_cover_ratio="null", offering_amt="25000000000"),      # announced, not yet held
    res("Bond", "30-Year", "2026-11-13", high_yield="null", bid_to_cover_ratio="null"),               # held, nothing published
    res("Note", "3-Year", "null", high_yield="3.900"),                                                # no date
]


class Publisher:
    """Stands where the HTTP transport stands. Answers each dataset its rows as Fiscal Data does."""

    def __init__(self):
        self.calls: list[dict] = []
        self.threads: list[str] = []
        self.upcoming = [dict(r) for r in UPCOMING]
        self.results = [dict(r) for r in RESULTS]
        self.answer = {}                       # endpoint tail -> (status, content type, body) | an exception
        self.gate: threading.Event | None = None
        self.total: dict = {}                  # endpoint tail -> the total-count it reports (more than it sends)

    def __call__(self, req):
        parts = urlsplit(req.url)
        query = {k: v[0] for k, v in parse_qs(parts.query).items()}
        self.calls.append({"method": req.method, "host": parts.netloc, "path": parts.path, "query": query,
                           "redirects": req.allow_redirects})
        self.threads.append(threading.current_thread().name)
        if self.gate is not None:
            self.gate.wait(10)
        tail = parts.path.rsplit("/", 1)[-1]
        hit = self.answer.get(tail, self.answer.get("*"))
        if isinstance(hit, BaseException):
            raise hit
        if hit is None:
            rows = self.upcoming if tail == "upcoming_auctions_v2" else self.results
            total = self.total.get(tail, len(rows))
            hit = (200, "application/json", json.dumps({"data": rows, "meta": {"count": len(rows), "total-count": total},
                                                        "links": {"next": None}}).encode())

        class Raw:
            status_code, headers, content = hit[0], {"content-type": hit[1]}, hit[2]
        return Raw()


@pytest.fixture
def pub(monkeypatch, tmp_path):
    p = Publisher()
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(ty, "now_et", lambda: NOW)
    monkeypatch.setattr(ta, "_client", lambda: econ_http.HttpClient(transport=p, max_retries=0, sleep=lambda s: None))
    ta.reset_for_tests()
    yield p
    if p.gate is not None:
        p.gate.set()
    ta._held.drain(10)
    ta.reset_for_tests()


def built(**kw):
    out = ta.get_auctions(wait_s=10, **kw)
    ta._held.drain(10)
    return out


# ── shaping ──────────────────────────────────────────────────────────────────────────────────

def test_upcoming_is_from_today_on_soonest_first_with_the_newest_record_of_each_sale():
    items, dropped, newest = ta.shape_upcoming(UPCOMING, TODAY)
    assert [(i["auction_date"], i["security_type"], i["security_term"]) for i in items] == [
        ("2026-11-19", "Bond", "20-Year"), ("2026-11-23", "Bill", "13-Week"), ("2026-11-24", "Note", "7-Year")]
    assert dropped == 2 and newest == "2026-11-17"
    bill = items[1]
    assert bill == {"security_type": "Bill", "security_term": "13-Week", "auction_date": "2026-11-23", "issue_date": "2026-11-27",
                    "announced_date": "2026-11-12", "offering_amount": 76000000000.0, "reopening": False, "cusip": None}
    assert items[0]["reopening"] is True and items[0]["offering_amount"] == 16000000000.0


def test_a_missing_amount_or_reopening_word_is_none_never_zero_or_no():
    items, _dropped, _newest = ta.shape_upcoming([up("Note", "5-Year", "2026-11-25", offering_amt="null", reopening="null",
                                                     issue_date="soon", announcemt_date=None)], TODAY)
    assert items[0]["offering_amount"] is None and items[0]["reopening"] is None
    assert items[0]["issue_date"] is None and items[0]["announced_date"] is None


def test_results_are_newest_first_and_each_kind_of_sale_names_its_own_rate():
    items, dropped, through = ta.shape_results(RESULTS, TODAY)
    assert [(i["auction_date"], i["security_term"]) for i in items] == [
        ("2026-11-17", "4-Week"), ("2026-11-13", "30-Year"), ("2026-11-12", "10-Year"), ("2026-11-10", "2-Year FRN"),
        ("2026-11-05", "10-Year TIPS")]
    assert dropped == 1 and through == "2026-11-17"
    by = {i["security_term"]: i for i in items}
    assert (by["10-Year"]["rate"], by["10-Year"]["rate_kind"]) == (4.117, "high_yield")
    assert (by["4-Week"]["rate"], by["4-Week"]["rate_kind"]) == (4.25, "high_rate")
    assert (by["2-Year FRN"]["rate"], by["2-Year FRN"]["rate_kind"]) == (0.16, "high_discount_margin")
    assert by["2-Year FRN"]["floating_rate"] is True and by["10-Year"]["floating_rate"] is False
    assert by["10-Year TIPS"]["tips"] is True and by["10-Year TIPS"]["reopening"] is True
    assert by["10-Year"]["bid_to_cover"] == 2.58 and by["10-Year"]["offering_amount"] == 42000000000.0
    assert by["10-Year"]["maturity_date"] == "2036-11-15" and by["10-Year"]["issue_date"] == "2026-11-16"
    assert "an_unknown_field" not in by["10-Year"]


def test_a_sale_with_nothing_published_keeps_its_row_with_no_figures_and_one_still_to_come_is_left_out():
    items, _dropped, _through = ta.shape_results(RESULTS, TODAY)
    held = next(i for i in items if i["auction_date"] == "2026-11-13")
    assert held["rate"] is None and held["rate_kind"] is None and held["bid_to_cover"] is None
    assert not any(i["auction_date"] == "2026-11-20" for i in items)


def test_the_bidder_split_is_each_class_and_its_share_of_the_three():
    split = ta.bidder_split(RESULTS[0])
    assert split == {"primary_dealers": {"amount": 4200000000.0, "share": 10.0}, "direct": {"amount": 8400000000.0, "share": 20.0},
                     "indirect": {"amount": 29400000000.0, "share": 70.0}, "total": 42000000000.0}
    assert round(sum(split[k]["share"] for k in ("primary_dealers", "direct", "indirect")), 1) == 100.0


@pytest.mark.parametrize("over", [
    {"prim_deal_comp_par_awarded": "null"}, {"dir_bid_comp_par_awarded": ""}, {"indir_bid_comp_par_awarded": None},
    {"prim_deal_comp_par_awarded": "0", "dir_bid_comp_par_awarded": "0", "indir_bid_comp_par_awarded": "0"},
    {"dir_bid_comp_par_awarded": "-5"}, {"indir_bid_comp_par_awarded": "plenty"},
])
def test_with_a_class_missing_or_no_total_there_is_no_split_never_a_share_of_zero(over):
    assert ta.bidder_split(res("Note", "10-Year", "2026-11-12", **over)) is None


def test_a_refresh_is_due_once_after_each_weekday_evening_slot():
    slot = datetime(2026, 11, 17, 18, 15, tzinfo=NY).timestamp()
    assert ta.refresh_due(slot - 1, NOW) is True
    assert ta.refresh_due(slot + 1, NOW) is False
    monday = datetime(2026, 11, 23, 9, 0, tzinfo=NY)                 # the last slot was Friday evening
    friday_slot = datetime(2026, 11, 20, 18, 15, tzinfo=NY).timestamp()
    assert ta.refresh_due(friday_slot + 60, monday) is False and ta.refresh_due(friday_slot - 60, monday) is True


# ── the read ─────────────────────────────────────────────────────────────────────────────────

def test_one_build_asks_the_two_datasets_once_each_off_the_request_thread(pub):
    out = built()
    assert out["status"] == "ok"
    assert [c["path"] for c in pub.calls] == [
        "/services/api/fiscal_service/v1/accounting/od/upcoming_auctions_v2",
        "/services/api/fiscal_service/v1/accounting/od/treasury_securities_auctions_v2"]
    assert {c["host"] for c in pub.calls} == {"api.fiscaldata.treasury.gov"}
    assert all(c["method"] == "GET" and c["redirects"] is False for c in pub.calls)
    assert pub.calls[0]["query"] == {"filter": "comp_auction_close_date:gte:2026-11-18", "sort": "-record_date",
                                     "page[size]": "500", "page[number]": "1"}
    assert pub.calls[1]["query"] == {"filter": "comp_auction_close_date:gte:2026-10-04", "sort": "-comp_auction_close_date",
                                     "page[size]": "500", "page[number]": "1"}
    assert set(pub.threads) == {"auctions-data-build"}


def test_the_answer_carries_both_lists_their_dates_and_the_rows_skipped(pub):
    out = built()
    assert out["source"] == "US Treasury Fiscal Data" and out["window_days"] == 45 and out["check"] is None
    assert out["as_of"] == "2026-11-17" and out["upcoming_as_of"] == "2026-11-17" and out["results_through"] == "2026-11-17"
    assert len(out["upcoming"]) == 3 and len(out["results"]) == 5
    assert out["dropped"] == {"upcoming": 2, "results": 1}
    assert out["cut"] == {"upcoming": False, "results": False}
    assert out["read_at"] and "v" not in out


def test_a_request_never_waits_on_the_publisher_and_a_held_answer_is_not_asked_for_again(pub):
    pub.gate = threading.Event()
    started = time.time()
    assert ta.get_auctions(wait_s=0) == {"status": "computing", "source": ta.SOURCE}
    assert time.time() - started < 2
    pub.gate.set()
    ta._held.drain(10)
    assert ta.get_auctions(wait_s=0)["status"] == "ok" and len(pub.calls) == 2
    for _ in range(5):
        ta.get_auctions(wait_s=0)
    ta._held.drain(10)
    assert len(pub.calls) == 2


def test_after_the_evening_slot_one_refresh_runs_and_the_held_answer_is_given_meanwhile(pub):
    first = built()
    with ta._held._lock:
        ta._held._state["checked"] = 0.0
    pub.results = [res("Note", "5-Year", "2026-11-18", high_yield="3.955")] + pub.results
    during = ta.get_auctions(wait_s=0)
    ta._held.drain(10)
    after = ta.get_auctions(wait_s=0)
    assert during["results"] == first["results"] and len(pub.calls) == 4
    assert after["results"][0]["security_term"] == "5-Year" and after["results_through"] == "2026-11-18"


def test_the_held_answer_survives_a_restart_without_a_request(pub):
    first = built()
    ta.reset_for_tests()
    pub.calls.clear()
    again = ta.get_auctions(wait_s=0)
    ta._held.drain(10)
    assert again["results"] == first["results"] and again["upcoming"] == first["upcoming"] and pub.calls == []


def test_both_lists_empty_is_an_ok_answer_with_nothing_in_it_not_a_failure(pub):
    pub.upcoming, pub.results = [], []
    out = built()
    assert out["status"] == "ok" and out["upcoming"] == [] and out["results"] == []
    assert out["as_of"] is None and out["upcoming_as_of"] is None and out["results_through"] is None


# ── a publisher that does not answer ─────────────────────────────────────────────────────────

def test_a_refusal_is_said_and_remembered_not_asked_again_per_request(pub):
    pub.answer["*"] = (403, "text/html", b"<html>no</html>")
    assert built() == {"status": "unavailable", "reason": "refused", "http_status": 403, "source": ta.SOURCE}
    assert len(pub.calls) == 1                                       # the second dataset is not asked after a refusal
    for _ in range(4):
        assert ta.get_auctions(wait_s=0)["status"] == "unavailable"
    ta._held.drain(10)
    assert len(pub.calls) == 1


@pytest.mark.parametrize("answer, said", [
    ((503, "text/plain", b""), {"status": "failed", "reason": "source", "http_status": 503}),
    ((429, "text/plain", b""), {"status": "failed", "reason": "rate_limited", "http_status": 429}),
    ((301, "text/html", b""), {"status": "unavailable", "reason": "refused", "http_status": 301}),
    (TimeoutError("slow"), {"status": "failed", "reason": "timeout", "http_status": None}),
    (ConnectionError("reset"), {"status": "failed", "reason": "source", "http_status": None}),
    ((200, "text/html", b"<html>maintenance</html>"), {"status": "unavailable", "reason": "shape", "http_status": 200}),
    ((200, "application/json", b'{"error": "Invalid Query Param", "message": "x"}'), {"status": "unavailable", "reason": "shape", "http_status": 200}),
    ((200, "application/json", b'{"data": [{"some_other": "dataset"}], "meta": {}, "links": {}}'), {"status": "unavailable", "reason": "shape", "http_status": 200}),
])
def test_a_failed_or_unreadable_answer_says_which_and_never_draws_rows(pub, answer, said):
    pub.answer["*"] = answer
    out = built()
    assert out == {**said, "source": ta.SOURCE}
    assert "results" not in out and "upcoming" not in out


def test_the_client_never_retries_a_failed_look(pub):
    pub.answer["*"] = (503, "text/plain", b"")
    built()
    assert len(pub.calls) == 1


def test_a_look_that_fails_keeps_the_last_good_answer_and_says_so(pub):
    first = built()
    pub.answer["treasury_securities_auctions_v2"] = (503, "text/plain", b"")
    with ta._held._lock:
        ta._held._state["checked"] = 0.0
    ta.get_auctions(wait_s=0)
    ta._held.drain(10)
    after = ta.get_auctions(wait_s=0)
    assert after["status"] == "ok" and after["results"] == first["results"] and after["as_of"] == "2026-11-17"
    assert after["check"]["state"] == "failed" and after["check"]["reason"] == "source"
    calls = len(pub.calls)
    ta.get_auctions(wait_s=0)
    ta._held.drain(10)
    assert len(pub.calls) == calls                                   # held for a while: not asked per request


def test_the_real_client_is_the_repositorys_own_with_no_retries_and_makes_no_request_when_built(monkeypatch):
    monkeypatch.undo()
    client = ta._client()
    assert isinstance(client, econ_http.HttpClient) and client.max_retries == 0 and client._transport is None


def test_the_module_names_no_address_of_its_own_and_reads_through_the_repositorys_reader():
    import ast
    import inspect
    source = inspect.getsource(ta)
    imported = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            imported |= {a.name for a in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported |= {f"{node.module}.{a.name}" for a in node.names}
    assert imported == {"__future__.annotations", "re", "datetime.date", "datetime.timedelta", "typing.Any", "typing.Optional",
                        "api.services.held_build", "api.services.treasury_yields", "api.services.econ.http",
                        "api.services.econ.adapters.fiscaldata", "api.services.econ.model.MalformedPayload",
                        "api.services.econ.model.SourceUnavailable"}
    assert "://" not in source                                        # no address of its own: the reader's base address
    assert source.count("fiscaldata.fetch_all(") == 1
    assert "os.environ" not in source


# ── the route ────────────────────────────────────────────────────────────────────────────────

FREE_USER = {"id": "au-free", "email": "free@example.test", "role": "member", "plan": "free"}
PAID_USER = {"id": "au-paid", "email": "paid@example.test", "role": "member", "plan": "pro"}
URL = "/api/research/treasury-auctions"


def _client(user):
    app = FastAPI()
    app.include_router(route.router)
    if user is not None:
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app, raise_server_exceptions=False)


def test_the_route_is_paid_and_a_refused_caller_never_reaches_the_service(monkeypatch):
    asked = []
    monkeypatch.setattr(ta, "get_auctions", lambda: asked.append("auctions") or {"status": "ok", "upcoming": [], "results": []})
    paths = {r.path: r for r in route.router.routes}
    assert set(paths) == {URL} and paths[URL].methods == {"GET"}
    assert route.require_paid in {d.call for d in paths[URL].dependant.dependencies}
    assert _client(None).get(URL).status_code == 401
    assert _client(FREE_USER).get(URL).status_code == 402
    assert asked == []
    assert _client(PAID_USER).get(URL).json() == {"status": "ok", "upcoming": [], "results": []}
    assert asked == ["auctions"]


def test_a_refused_publisher_is_a_200_answer_not_an_error_status(monkeypatch):
    monkeypatch.setattr(ta, "get_auctions", lambda: {"status": "unavailable", "reason": "refused", "http_status": 403})
    resp = _client(PAID_USER).get(URL)
    assert resp.status_code == 200 and resp.json()["status"] == "unavailable"


def test_the_route_serves_the_services_answer_end_to_end(pub):
    ta.get_auctions(wait_s=10)
    ta._held.drain(10)
    body = _client(PAID_USER).get(URL).json()
    assert body["status"] == "ok" and len(body["upcoming"]) == 3 and body["results"][0]["rate_kind"] == "high_rate"
    assert body["results"][0]["bidders"] is None and body["results"][2]["bidders"]["indirect"]["share"] == 70.0


def test_the_route_is_mounted_on_the_app():
    import re
    from pathlib import Path
    src = (Path(__file__).resolve().parents[1] / "api" / "main.py").read_text(encoding="utf-8")
    assert re.search(r"^from api\.routers import treasury_auctions as treasury_auctions_router\b", src, re.M)
    assert re.search(r"^app\.include_router\(treasury_auctions_router\.router\)", src, re.M)


# ── added on review (2026-11-21) ─────────────────────────────────────────────────────────────

def test_the_newest_record_of_a_sale_wins_whichever_order_the_lists_arrive_in():
    older = up("Bill", "13-Week", "2026-11-23", record_date="2026-11-13", cusip="null", offering_amt="70000000000")
    newer = up("Bill", "13-Week", "2026-11-23", record_date="2026-11-17", cusip="null", offering_amt="76000000000")
    for rows in ([older, newer], [newer, older]):
        items, _dropped, newest = ta.shape_upcoming(rows, TODAY)
        assert [i["offering_amount"] for i in items] == [76000000000.0] and newest == "2026-11-17"


def test_a_list_the_publisher_holds_more_of_than_one_page_is_marked_cut(pub):
    pub.total["treasury_securities_auctions_v2"] = len(RESULTS) + 40
    out = built()
    assert out["status"] == "ok" and out["cut"] == {"upcoming": False, "results": True}
    assert len(out["results"]) == 5                                  # what came is still shown


def test_a_429_is_held_for_the_rates_reads_own_fifteen_minutes(pub):
    pub.answer["*"] = (429, "text/plain", b"")
    started = time.time()
    assert built()["reason"] == "rate_limited"
    with ta._held._lock:
        until = ta._held._state["block"][0]
    assert ta.RATE_LIMITED_HOLD_S == ty.RATE_LIMITED_HOLD_S == 900.0
    assert started + 899 <= until <= time.time() + 901
    for _ in range(3):
        assert ta.get_auctions(wait_s=0)["reason"] == "rate_limited"
    ta._held.drain(10)
    assert len(pub.calls) == 1


def test_every_build_writes_one_log_line_naming_the_source_the_requests_and_the_rows(pub, caplog):
    import logging
    with caplog.at_level(logging.INFO, logger="api.services.held_build"):
        built()
    lines = [r.getMessage() for r in caplog.records if r.name == "api.services.held_build"]
    assert len(lines) == 1
    assert lines[0].startswith("[auctions-data] fiscaldata status=200 requests=2 rows=7+7 upcoming=3 results=5 dropped=3 latest=2026-11-17")


def test_a_refusal_writes_one_warning_line_with_its_status(pub, caplog):
    import logging
    pub.answer["*"] = (404, "application/json", b'{"error": "not found"}')
    with caplog.at_level(logging.INFO, logger="api.services.held_build"):
        assert built()["reason"] == "refused"
    lines = [(r.levelname, r.getMessage()) for r in caplog.records if r.name == "api.services.held_build"]
    assert len(lines) == 1 and lines[0][0] == "WARNING"
    assert lines[0][1].startswith("[auctions-data] fiscaldata status=404 unavailable (the upcoming list refused)")
