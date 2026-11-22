"""PUBR, the Terminal's public records for one company (`api/services/public_records.py`, the route in
`api/routers/public_records.py`).

What is held here:
  * the route is one paid GET: signed out 401, a free plan 402, a string that is not a ticker 400, and none
    of them reaches the service; it is mounted on the app;
  * a member's request never asks an agency: the first read starts one background build per section (and
    one for the company's names), waits a few seconds and otherwise says `computing`; a second read within
    the day asks nothing; a section is due again after a day;
  * each section names its source, what was searched for, the company's names and how each record name
    matched; a company with no name to search with is said in words and no agency is asked;
  * an agency's refusal (a 403, a redirect) or a 429 holds that host back for every company; a 5xx is a
    failure tried again later; an answer that is not JSON is `unavailable`; openFDA's "no matches" 404 is an
    empty answer; a spent daily budget stops the host until the next day; requests to one host are paced;
  * LDA.gov is read a page at a time up to a cap, and a cut answer says so; a failed refresh keeps the good
    answer held beside its `check`.

Every company, name and figure below is invented. Nothing here reaches a real server.
"""
from __future__ import annotations

import json
import re
import threading
import time
from datetime import date
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import public_records as route
from api.services import held_build
from api.services import public_records as R

FREE_USER = {"id": "pubr-free", "email": "free@example.test", "role": "member", "plan": "free"}
PAID_USER = {"id": "pubr-paid", "email": "paid@example.test", "role": "member", "plan": "pro"}
SYM = "QQZA"
TODAY = date(2030, 5, 14)

RECIPIENTS_RECENT = {"results": [{"name": "KESTREL DYNAMICS CORP", "amount": 1000.0},
                                 {"name": "SKYHOOK KESTREL LLC", "amount": 50.0}], "page_metadata": {"hasNext": False}}
RECIPIENTS_PRIOR = {"results": [{"name": "KESTREL DYNAMICS CORPORATION", "amount": 600.0}], "page_metadata": {"hasNext": False}}
AWARDS = {"results": [{"Award ID": "QZ9", "Recipient Name": "KESTREL DYNAMICS CORP", "Base Obligation Date": "2030-02-01",
                       "Award Amount": 700.0, "Awarding Agency": "Department of Imaginary Affairs"}],
          "page_metadata": {"hasNext": False}}
STUDIES_ACTIVE = {"totalCount": 1, "studies": [{"protocolSection": {
    "identificationModule": {"nctId": "NCT90000011", "briefTitle": "Lantern oil in glow fatigue"},
    "statusModule": {"overallStatus": "RECRUITING", "primaryCompletionDateStruct": {"date": "2031-01-01", "type": "ESTIMATED"}},
    "sponsorCollaboratorsModule": {"leadSponsor": {"name": "Kestrel Dynamics"}},
    "designModule": {"phases": ["PHASE3"]}}}]}
STUDIES_CLOSED = {"totalCount": 0, "studies": []}
FDA = {"meta": {"last_updated": "2030-05-12", "results": {"total": 1}}, "results": [{
    "application_number": "NDA990011", "sponsor_name": "KESTREL DYNAMICS",
    "products": [{"brand_name": "GLOWEX", "active_ingredients": [{"name": "EMBERINE"}]}],
    "submissions": [{"submission_type": "ORIG", "submission_number": "1", "submission_status": "AP",
                     "submission_status_date": "20300101", "review_priority": "STANDARD"}]}]}


def _filings(n, *, next_page=False, year=2030, period="first_quarter"):
    return {"count": n, "next": "https://lda.gov/api/v1/filings/?page=2" if next_page else None, "results": [
        {"filing_uuid": f"f{i}", "filing_type": "Q1", "filing_year": year, "filing_period": period, "income": "10000.00",
         "expenses": None, "dt_posted": "2030-04-10T10:00:00-04:00", "registrant": {"id": 100 + i, "name": f"FIRM {i}"},
         "client": {"id": 200 + i, "name": "KESTREL DYNAMICS CORP"}, "lobbying_activities": [{"general_issue_code_display": "Defense"}]}
        for i in range(n)]}


class Agencies:
    """Stands in for `_http`: routes each request by host and path to a scripted answer, and records it."""

    def __init__(self):
        self.calls: list[tuple] = []
        self.threads: set[str] = set()
        self.override: dict[str, tuple] = {}
        self.lda_pages: list = []
        self.lock = threading.Lock()
        self.gate = threading.Event()
        self.gate.set()

    def answer(self, key):
        o = self.override.get(key)
        if o is not None:
            return o
        return None

    def __call__(self, method, url, *, params=None, body=None, max_bytes=R.MAX_BYTES):
        self.gate.wait(10)
        with self.lock:
            self.calls.append((method, url, json.dumps(params, sort_keys=True) if params else None,
                               json.dumps(body, sort_keys=True) if body else None))
            self.threads.add(threading.current_thread().name)
        if "api.usaspending.gov" in url:
            key = "usaspending"
            if "spending_by_award" in url:
                payload = AWARDS
            else:
                payload = RECIPIENTS_RECENT if body["filters"]["time_period"][0]["end_date"] == TODAY.isoformat() else RECIPIENTS_PRIOR
        elif "clinicaltrials.gov" in url:
            key = "ctgov"
            if url.endswith("/version"):
                payload = {"apiVersion": "9.9", "dataTimestamp": "2030-05-13T10:00:05"}
            else:
                payload = STUDIES_ACTIVE if "RECRUITING" in params["filter.overallStatus"] else STUDIES_CLOSED
        elif "api.fda.gov" in url:
            key, payload = "openfda", FDA
        elif "lda.gov" in url:
            key = "lda"
            payload = self.lda_pages.pop(0) if self.lda_pages else _filings(1)
        else:
            raise AssertionError(f"unexpected host {url}")
        o = self.answer(key)
        if o is not None:
            return o
        return 200, {"retry-after": None}, json.dumps(payload).encode()

    def hosts(self):
        out = []
        for _m, url, _p, _b in self.calls:
            out.append(next(k for k, h in (("usaspending", "usaspending"), ("ctgov", "clinicaltrials"), ("openfda", "fda.gov"),
                                            ("lda", "lda.gov")) if h in url))
        return out


@pytest.fixture
def agencies(monkeypatch):
    R.reset_for_tests()
    fake = Agencies()
    slept: list[float] = []
    monkeypatch.setattr(R, "_http", fake)
    monkeypatch.setattr(R, "_sleep", lambda s: slept.append(s))
    monkeypatch.setattr(R, "_today", lambda: TODAY)
    monkeypatch.setattr(R, "_site_name", lambda sym: "Kestrel Dynamics Corporation" if sym == SYM else None)
    monkeypatch.setattr(R, "_resolve_cik", lambda sym: "0009990001" if sym == SYM else None)
    monkeypatch.setattr(R, "_sec_submissions", lambda cik: {"name": "KESTREL DYNAMICS CORP", "formerNames": []})
    fake.slept = slept
    yield fake
    R.drain_for_tests(10)
    R.reset_for_tests()


def _full(sym=SYM):
    R.get_public_records(sym, wait_s=0)
    R.drain_for_tests(10)
    R.drain_for_tests(10)
    return R.get_public_records(sym, wait_s=0)


def _client(user):
    app = FastAPI()
    app.include_router(route.router)
    if user is not None:
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app, raise_server_exceptions=False)


# ── the route ────────────────────────────────────────────────────────────────────────────────

def test_the_route_is_one_paid_get_and_a_refused_caller_never_reaches_the_service(monkeypatch):
    asked = []
    monkeypatch.setattr(R, "get_public_records", lambda sym: asked.append(sym) or {"status": "ok", "sym": sym})
    (r,) = route.router.routes
    assert r.path == "/api/research/public-records/{ticker}" and r.methods == {"GET"}
    assert route.require_paid in {d.call for d in r.dependant.dependencies}
    assert route.require_paid.__module__ == "api.routers.public_records"
    url = "/api/research/public-records/QQZA"
    assert _client(None).get(url).status_code == 401
    refused = _client(FREE_USER).get(url)
    assert refused.status_code == 402 and refused.json() == {"detail": "Public records require a paid plan"}
    assert _client(PAID_USER).get("/api/research/public-records/not a ticker!").status_code == 400
    assert asked == []
    assert _client(PAID_USER).get("/api/research/public-records/qqza").json() == {"status": "ok", "sym": "QQZA"}
    assert asked == ["QQZA"]


def test_the_public_records_route_is_mounted_on_the_app():
    src = (Path(__file__).resolve().parents[1] / "api" / "main.py").read_text(encoding="utf-8")
    assert re.search(r"^from api\.routers import public_records as public_records_router\b", src, re.M)
    assert re.search(r"^app\.include_router\(public_records_router\.router\)", src, re.M)


# ── the hold-and-build rule ──────────────────────────────────────────────────────────────────

def test_the_first_read_says_computing_and_never_asks_on_the_callers_thread(agencies):
    agencies.gate.clear()                                # the agencies answer only when the test lets them
    first = R.get_public_records(SYM, wait_s=0.2)
    assert first["status"] == "ok" and first["sym"] == SYM
    assert all(first[k]["status"] == "computing" for k in R.SECTIONS)
    assert first["contracts"]["source"].startswith("USAspending.gov")
    agencies.gate.set()
    R.drain_for_tests(10)
    R.drain_for_tests(10)
    assert agencies.calls, "the background builds asked the agencies"
    assert threading.current_thread().name not in agencies.threads


def test_every_section_says_its_source_what_was_searched_and_how_each_name_matched(agencies):
    got = _full()
    company = got["company"]
    assert company["status"] == "ok" and company["cik"] == "0009990001" and company["sec_state"] == "ok"
    assert [n["source"] for n in company["names"]] == ["site", "sec"]
    c = got["contracts"]
    assert c["state"] == "matched" and c["searched_for"] == "KESTREL DYNAMICS"
    assert c["recent_total"] == 1000.0 and c["prior_total"] == 600.0
    assert [n["name"] for n in c["counted"]] == ["KESTREL DYNAMICS CORP", "KESTREL DYNAMICS CORPORATION"]
    assert c["counted"][0]["how_words"] == "Same name" and [n["name"] for n in c["not_counted"]] == ["SKYHOOK KESTREL LLC"]
    assert c["awards"][0]["award_id"] == "QZ9" and c["read_at"] and c["source_url"] == "https://www.usaspending.gov"
    t = got["trials"]
    assert t["state"] == "matched" and t["active"][0]["nct_id"] == "NCT90000011" and t["data_processed"] == "2030-05-13T10:00:05"
    assert t["searched_for"] == "KESTREL DYNAMICS"
    f = got["fda"]
    assert f["state"] == "matched" and f["actions"][0]["drug"] == "GLOWEX" and f["since"] == "2028-05-14"
    lob = got["lobbying"]
    assert lob["state"] == "matched" and lob["searched_for"] == "kestrel dynamics" and len(lob["quarters"]) == 8
    assert lob["quarters"][0]["label"] == "Q1 2030" and lob["quarters"][0]["firms"] == 10000.0
    # USAspending: two windows and the awards; the search words are the company's name, nothing else
    usa = [json.loads(b) for _m, u, _p, b in agencies.calls if "usaspending" in u]
    assert len(usa) == 3 and all(b["filters"]["recipient_search_text"] == ["KESTREL DYNAMICS"] for b in usa)
    assert all(b["filters"]["award_type_codes"] == ["A", "B", "C", "D"] for b in usa)


def test_a_second_read_within_the_day_asks_no_agency_and_a_day_later_one_build_runs(agencies, monkeypatch):
    _full()
    n = len(agencies.calls)
    again = R.get_public_records(SYM, wait_s=0)
    R.drain_for_tests(5)
    assert len(agencies.calls) == n and again["contracts"]["state"] == "matched"
    assert R.refresh_due({}, time.time() - R.TTL_S + 60) is False
    assert R.refresh_due({}, time.time() - R.TTL_S - 1) is True
    assert R.TTL_S == 24 * 3600.0


def test_a_company_with_no_name_is_said_in_words_and_no_agency_is_asked(agencies):
    got = _full("QQZB")
    assert got["company"]["status"] == "ok" and got["company"]["names"] == [] and got["company"]["sec_state"] == "no_cik"
    for k in R.SECTIONS:
        assert got[k]["status"] == "ok" and got[k]["state"] == "no_name" and got[k]["searched_for"] is None
    assert agencies.calls == []


def test_an_sec_failure_keeps_the_sites_name_and_is_tried_again_sooner(agencies, monkeypatch):
    def boom(cik):
        raise RuntimeError("down")
    monkeypatch.setattr(R, "_sec_submissions", boom)
    got = _full()
    assert got["company"]["sec_state"] == "failed" and [n["source"] for n in got["company"]["names"]] == ["site"]
    assert got["contracts"]["state"] == "matched"
    assert R._identity_due({"sec_state": "failed"}, time.time() - R.RETRY_S - 1) is True
    assert R._identity_due({"sec_state": "ok"}, time.time() - R.RETRY_S - 1) is False


def test_held_records_never_builds(agencies):
    got = R.held_records(SYM)
    assert all(got[k]["status"] == "not_held" for k in R.SECTIONS)
    R.drain_for_tests(2)
    assert agencies.calls == []


# ── what the agencies answer ─────────────────────────────────────────────────────────────────

def test_a_429_holds_the_host_back_for_every_company_with_its_retry_after(agencies):
    agencies.override["usaspending"] = (429, {"retry-after": "120"}, b"{}")
    got = _full()
    assert got["contracts"]["status"] == "failed" and got["contracts"]["reason"] == "rate_limited"
    assert got["contracts"]["http_status"] == 429 and got["trials"]["state"] == "matched"
    h = R._hosts["usaspending"]
    assert 100 < h.blocked_until - time.time() <= 121
    usa_calls = agencies.hosts().count("usaspending")
    with pytest.raises(held_build.Stop) as stop:
        R.fetch_json("usaspending", "POST", f"{R.USA_BASE}/api/v2/search/spending_by_award/", body={})
    assert stop.value.reason == "rate_limited" and agencies.hosts().count("usaspending") == usa_calls


@pytest.mark.parametrize("status, state, reason", [(403, "unavailable", "refused"), (302, "unavailable", "refused"),
                                                   (503, "failed", "source"), (408, "failed", "source")])
def test_an_agency_answer_that_is_not_200_is_said_by_its_kind(agencies, status, state, reason):
    agencies.override["ctgov"] = (status, {"retry-after": None}, b"")
    got = _full()
    assert got["trials"]["status"] == state and got["trials"]["reason"] == reason and got["trials"]["http_status"] == status
    assert got["trials"]["source"].startswith("ClinicalTrials.gov")
    held_back = R._hosts["ctgov"].block is not None
    assert held_back is (reason == "refused")


def test_an_answer_that_is_not_json_is_unavailable_with_reason_shape(agencies):
    agencies.override["lda"] = (200, {"retry-after": None}, b"<html>maintenance</html>")
    got = _full()
    assert got["lobbying"]["status"] == "unavailable" and got["lobbying"]["reason"] == "shape"


def test_a_network_error_is_a_failure_and_its_text_is_not_kept(agencies, monkeypatch):
    def broken(*a, **k):
        raise ConnectionError("secret-ish detail https://example.test/?q=x")
    monkeypatch.setattr(R, "_http", broken)
    got = _full()
    assert got["fda"]["status"] == "failed" and got["fda"]["reason"] == "source"
    assert "secret-ish" not in json.dumps(got)


def test_openfda_no_matches_404_is_an_empty_answer_and_the_host_is_not_held_back(agencies):
    agencies.override["openfda"] = (404, {"retry-after": None}, b'{"error": {"code": "NOT_FOUND"}}')
    got = _full()
    assert got["fda"]["status"] == "ok" and got["fda"]["state"] == "no_match" and got["fda"]["actions"] == []
    assert R._hosts["openfda"].block is None


def test_a_spent_daily_budget_stops_the_host_until_the_next_day(agencies, monkeypatch):
    monkeypatch.setitem(R.HOSTS, "openfda", {**R.HOSTS["openfda"], "daily": 0})
    got = _full()
    assert got["fda"]["status"] == "unavailable" and got["fda"]["reason"] == "budget"
    assert "openfda" not in agencies.hosts()


def test_requests_to_one_host_are_paced(agencies):
    lda_gap = R.HOSTS["lda"]["gap"]
    R._turn("lda")
    assert agencies.slept == []                          # the first request of a host waits for nothing
    R._turn("lda")
    R._turn("openfda")
    assert len(agencies.slept) == 1 and abs(agencies.slept[0] - lda_gap) < 0.5
    assert R._hosts["lda"].used == 2 and R._hosts["openfda"].used == 1


def test_lobbying_reads_pages_up_to_its_cap_and_says_it_was_cut(agencies, monkeypatch):
    monkeypatch.setattr(R, "LDA_MAX_PAGES", 3)
    agencies.lda_pages = [_filings(2, next_page=True), _filings(2, next_page=True), _filings(2, next_page=True)]
    got = _full()
    lob = got["lobbying"]
    assert lob["status"] == "ok" and lob["cut"] is True and lob["filings_read"] == 6
    assert agencies.hosts().count("lda") == 3
    lda = [json.loads(p) for _m, u, p, _b in agencies.calls if "lda.gov" in u]
    assert [p["page"] for p in lda] == [1, 2, 3] and all(p["client_name"] == "kestrel dynamics" for p in lda)
    assert all(p["page_size"] == 25 and p["ordering"] == "-dt_posted" for p in lda)


def test_a_failed_refresh_keeps_the_good_answer_beside_its_check(agencies, monkeypatch):
    _full()
    held = R._sections["fda"]._one(SYM)
    with held._lock:
        held._state["checked"] = time.time() - R.TTL_S - 10
    agencies.override["openfda"] = (503, {"retry-after": None}, b"")
    R.get_public_records(SYM, wait_s=0)
    R.drain_for_tests(10)
    got = R.get_public_records(SYM, wait_s=0)
    assert got["fda"]["status"] == "ok" and got["fda"]["state"] == "matched"
    assert got["fda"]["check"]["state"] == "failed" and got["fda"]["check"]["http_status"] == 503


def test_a_full_build_queue_tells_a_new_build_to_come_back(agencies, monkeypatch):
    h = R._hosts["lda"]
    with h.lock:
        h.waiting = R.MAX_WAITING
    with pytest.raises(held_build.Stop) as stop:
        with R._Slot("lda"):
            pass
    assert stop.value.reason == "busy"


def test_the_holds_are_bounded_and_the_section_words_are_fixed():
    assert all(h._max == R.MAX_KEYS for h in R._sections.values()) and R._identity._max == R.MAX_KEYS
    assert R.SECTIONS == ("contracts", "trials", "fda", "lobbying")
    assert R.USER_AGENT == "UCT-Intelligence public-records (contact: see docs)"
    assert R.lda_words("HARROW AND VANE") == "harrow & vane"
    assert R.essie_words("HARROW AND VANE OR NOT") == "HARROW VANE"
