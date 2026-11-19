"""DILU, the Terminal's dilution watch (`api/services/dilution_watch.py` and the route in
`api/routers/dilution_watch.py`).

What is held here:
  * the form list: every form the module reads is classified, an 8-K only by its item numbers,
    and every other form is left alone;
  * the filing index is read tolerantly: a row without its form, its day or its accession number
    is dropped and counted, and columns of different lengths are a shape mismatch, never a guess;
  * a shelf is set beside its effectiveness notice and its prospectus supplements by FILE NUMBER;
    "live" is three years from the day it took effect (an automatic shelf: the day it was filed);
    a shelf with no notice is not effective, one with a withdrawal request says so;
  * the counts cover 12 months and 3 years, and a count the read does not reach back far enough
    for is None, never a smaller number;
  * nothing in the answer is an amount: no shares, no dollars;
  * older pages of the index are read only when the recent page does not reach back far enough,
    at most `MAX_OLDER_PAGES`, and only pages whose name is the SEC's own form;
  * a symbol the SEC lists no filer for is `none`; a refusal (403) is `unavailable` and a 429 is
    `failed`, both remembered for the whole module so no other stock asks; a timeout is `failed`
    and is not remembered;
  * every build writes ONE `[dilution]` line with the status and the counts, and never a URL;
  * nothing is built on the request: one background build, a short wait, then `computing`; the
    last good answer is served, marked `refreshing`, while its replacement is built;
  * the route is paid.

No test here reaches the SEC: the two readers are replaced, or the house client's `get_bytes` is.
Every filing below is made up.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import dilution_watch as route
from api.services import dilution_watch as dw
from api.services.fundamentals_pit import sec_client
from api.services.fundamentals_pit.sec_client import SecError

TODAY = date(2026, 11, 18)
CIK = "0001234567"
INDEX_URL = f"https://data.sec.gov/submissions/CIK{CIK}.json"
SHELF_FILE = "333-270001"
OLD_SHELF_FILE = "333-250001"
COLUMNS = ("accessionNumber", "filingDate", "reportDate", "acceptanceDateTime", "act", "form", "fileNumber", "filmNumber",
           "items", "core_type", "size", "isXBRL", "isInlineXBRL", "isXBRLNumeric", "primaryDocument", "primaryDocDescription")
_n = [0]


def filing(form, day, file_no="", items="", **over):
    """One row of the index, as the SEC's columns hold it."""
    _n[0] += 1
    row = {"accessionNumber": f"{CIK}-{day[2:4]}-{_n[0]:06d}", "filingDate": day, "reportDate": "",
           "acceptanceDateTime": f"{day}T16:{_n[0] % 60:02d}:00.000Z", "act": "33", "form": form, "fileNumber": file_no,
           "filmNumber": "1", "items": items, "core_type": form, "size": 1000, "isXBRL": 0, "isInlineXBRL": 0,
           "isXBRLNumeric": 0, "primaryDocument": "doc.htm", "primaryDocDescription": form}
    row.update(over)
    return row


def columns(rows, drop=()):
    return {c: [r.get(c) for r in rows] for c in COLUMNS if c not in drop}


def index(rows, *, name="Acme Example Corp", entity="operating", files=None, **over):
    """A company's filing index, newest first, in the SEC's shape."""
    rows = sorted(rows, key=lambda r: (r["filingDate"], r["acceptanceDateTime"]), reverse=True)
    doc = {"cik": CIK, "entityType": entity, "sic": "2834", "name": name, "tickers": ["AAA"], "exchanges": ["Nasdaq"],
           "filings": {"recent": columns(rows), "files": files or []}}
    doc.update(over)
    return doc


def live_shelf_rows():
    """A company with a shelf in force and offering documents under it."""
    return [
        filing("10-Q", "2026-11-05"),
        filing("424B5", "2026-10-02", SHELF_FILE),
        filing("FWP", "2026-10-01", SHELF_FILE),
        filing("8-K", "2026-09-30", "001-30001", "1.01,3.02,9.01"),
        filing("8-K", "2026-08-01", "001-30001", "1.01,9.01"),
        filing("8-K", "2026-07-01", "001-30001", "2.02,9.01"),
        filing("424B5", "2026-05-20", SHELF_FILE),
        filing("424B5", "2026-01-15", SHELF_FILE),
        filing("424B5", "2025-12-01", SHELF_FILE),
        filing("424B5", "2025-06-02", SHELF_FILE),
        filing("EFFECT", "2025-03-12", SHELF_FILE),
        filing("S-3/A", "2025-03-10", SHELF_FILE),
        filing("S-3", "2025-03-04", SHELF_FILE),
        filing("424B2", "2024-03-03", OLD_SHELF_FILE),
        filing("S-8", "2024-02-01", "333-260009"),
        filing("4", "2023-12-01"),
        filing("S-3ASR", "2023-01-10", OLD_SHELF_FILE),          # before the window: read only to set filings beside it
        filing("S-3", "2020-05-05", "333-230001"),               # older than everything read
        filing("424B5", "2020-06-01", "333-230001"),
    ]


class Sec:
    """Stands where the two readers stand: serves each URL its document and records every call."""

    def __init__(self):
        self.docs: dict[str, object] = {}
        self.ciks: dict[str, str] = {"AAA": CIK}
        self.listed = True
        self.calls: list[str] = []
        self.lookups: list[str] = []
        self.gate: threading.Event | None = None
        self.threads: list[str] = []

    def get(self, url):
        self.calls.append(url)
        self.threads.append(threading.current_thread().name)
        if self.gate is not None:
            self.gate.wait(10)
        hit = self.docs.get(url)
        if hit is None:
            raise SecError(url, 404, "not found")
        if isinstance(hit, Exception):
            raise hit
        return hit if isinstance(hit, bytes) else json.dumps(hit).encode()

    def resolve(self, sym):
        self.lookups.append(sym)
        return self.ciks.get(sym), self.listed


@pytest.fixture
def sec(monkeypatch):
    s = Sec()
    monkeypatch.setattr(dw, "_sec_get", s.get)
    monkeypatch.setattr(dw, "_resolve_cik", s.resolve)
    monkeypatch.setattr(dw, "now_et", lambda: datetime(2026, 11, 18, 11, 0, tzinfo=ZoneInfo("America/New_York")))
    dw.reset_for_tests()
    yield s
    if s.gate is not None:
        s.gate.set()
    drain()
    dw.reset_for_tests()


def drain(timeout=10.0):
    """Wait for every background build this module started."""
    end = time.time() + timeout
    while time.time() < end:
        with dw._lock:
            busy = bool(dw._inflight)
        if not busy:
            return
        time.sleep(0.01)
    raise AssertionError("a background build did not finish")


def lines(caplog):
    return [r.getMessage() for r in caplog.records if r.getMessage().startswith("[dilution]")]


# ── the form list ────────────────────────────────────────────────────────────────────────────

def test_every_form_read_has_a_kind_and_plain_words_and_nothing_else_is_classified():
    assert set(dw.FORMS) == {
        "S-3", "S-3ASR", "F-3", "F-3ASR", "S-3/A", "F-3/A", "POSASR", "EFFECT",
        "424B1", "424B2", "424B3", "424B4", "424B5", "424B7", "424B8", "FWP",
        "S-1", "F-1", "S-1MEF", "S-3MEF", "F-1MEF", "F-3MEF", "S-1/A", "F-1/A", "POS AM", "S-8", "RW",
    }
    kinds = {form: kind for form, (kind, _what) in dw.FORMS.items()}
    assert {f for f, k in kinds.items() if k == dw.SHELF} == {"S-3", "S-3ASR", "F-3", "F-3ASR"}
    assert {f for f, k in kinds.items() if k == dw.OFFERING} == {"424B1", "424B2", "424B3", "424B4", "424B5", "424B7", "424B8"}
    assert kinds["FWP"] == dw.FWP and kinds["S-8"] == dw.PLAN and kinds["EFFECT"] == dw.EFFECT and kinds["RW"] == dw.WITHDRAWAL
    assert dw.AUTOMATIC_SHELVES == {"S-3ASR", "F-3ASR"}
    for form, (_kind, what) in dw.FORMS.items():
        assert dw.classify(form, []) == dw.FORMS[form]
        # plain words, and never a claim the index cannot support
        low = what.lower()
        assert what[0].isupper() and not any(w in low for w in ("will ", "about to", "$", "shares sold", "at-the-market", "atm"))
    assert dw.FORMS["424B5"][1] == "Prospectus supplement"
    for other in ("10-K", "10-Q", "4", "144", "DEF 14A", "PRE 14A", "S-4", "F-10", "SUPPL", "S-8 POS", "13F-HR", "424B6", ""):
        assert dw.classify(other, []) is None


def test_an_8k_is_read_only_by_its_item_numbers():
    assert dw.classify("8-K", ["3.02", "9.01"]) == (dw.UNREGISTERED, "Unregistered sale of equity securities (8-K item 3.02)")
    assert dw.classify("8-K", ["1.01", "3.02"])[0] == dw.UNREGISTERED          # 3.02 wins: the sale is the fact
    assert dw.classify("8-K", ["1.01", "9.01"]) == (dw.AGREEMENT, "Material agreement (8-K item 1.01)")
    assert dw.classify("8-K/A", ["3.02"]) == (dw.UNREGISTERED, "Unregistered sale of equity securities (8-K/A item 3.02)")
    assert dw.classify("8-K", ["2.02", "9.01"]) is None                       # an earnings release is not this panel's
    assert dw.classify("8-K", []) is None
    assert dw.items_of("1.01,3.02, 9.01") == ["1.01", "3.02", "9.01"]
    assert dw.items_of("") == [] and dw.items_of(None) == [] and dw.items_of("x,3.2,13.021") == []
    assert dw.norm_form(" pos  am ") == "POS AM" and dw.norm_form(None) == ""


# ── reading the index ────────────────────────────────────────────────────────────────────────

def test_a_page_is_read_tolerantly_and_a_row_without_its_essentials_is_dropped_and_counted():
    rows = [filing("424B5", "2026-10-02", SHELF_FILE), filing("8-K", "2026-09-30", "001-30001", "3.02"),
            filing("", "2026-09-01"), filing("S-3", "not-a-day"), filing("S-3", "2026-02-30"),
            filing("S-3", "2026-08-01", accessionNumber="12-34"), filing("S-1", "2026-07-01", "file number?")]
    got, dropped = dw.read_columns(columns(rows))
    assert dropped == 4
    assert [(f["form"], f["date"], f["file_number"], f["items"]) for f in got] == [
        ("424B5", "2026-10-02", SHELF_FILE, []), ("8-K", "2026-09-30", "001-30001", ["3.02"]), ("S-1", "2026-07-01", None, [])]
    # the optional columns may be absent: nothing is invented for them
    bare, _ = dw.read_columns(columns(rows[:2], drop=("fileNumber", "items", "acceptanceDateTime")))
    assert [(f["file_number"], f["items"], f["accepted"]) for f in bare] == [(None, [], ""), (None, [], "")]
    for bad in (None, [], "x", {"form": ["S-3"]}, {"form": ["S-3"], "filingDate": [], "accessionNumber": ["a"]},
                {"form": "S-3", "filingDate": "2026-01-01", "accessionNumber": "a"}):
        with pytest.raises(ValueError):
            dw.read_columns(bad)


def test_only_the_secs_own_page_names_are_ever_read_and_only_those_that_reach_the_window():
    doc = {"filings": {"files": [
        {"name": "CIK0001234567-submissions-001.json", "filingFrom": "2019-01-01", "filingTo": "2024-06-30"},
        {"name": "CIK0001234567-submissions-002.json", "filingFrom": "2010-01-01", "filingTo": "2018-12-31"},
        {"name": "CIK0001234567-submissions-003.json", "filingFrom": "2000-01-01"},                 # no end said: taken, last
        {"name": "../../cgi-bin/browse-edgar?action=getcompany", "filingTo": "2026-01-01"},
        {"name": "https://example.test/x.json", "filingTo": "2026-01-01"},
        "x", None,
    ]}}
    assert dw.older_pages(doc, "2022-11-18") == ["CIK0001234567-submissions-001.json", "CIK0001234567-submissions-003.json"]
    assert dw.older_pages({"filings": {"files": None}}, "2022-11-18") == [] and dw.older_pages({}, "2022-11-18") == []


def test_months_are_shifted_by_the_calendar():
    assert dw.shift_months(date(2026, 11, 18), -36) == date(2023, 11, 18)
    assert dw.shift_months(date(2024, 2, 29), 36) == date(2027, 2, 28)
    assert dw.shift_months(date(2026, 3, 31), -1) == date(2026, 2, 28)
    assert dw.filing_url(CIK, "0001234567-26-000042") == "https://www.sec.gov/Archives/edgar/data/1234567/000123456726000042/0001234567-26-000042-index.htm"


# ── the answer ───────────────────────────────────────────────────────────────────────────────

def answer(rows, covered_from=None, **kw):
    doc = index(rows, **kw)
    filings, _ = dw.read_columns(doc["filings"]["recent"])
    return dw.assemble("AAA", CIK, doc, filings, today=TODAY, covered_from=covered_from, read_at="2026-11-18T16:00:00+00:00")


def test_a_shelf_is_set_beside_its_notice_and_its_supplements_and_live_is_three_years_from_effect():
    out = answer(live_shelf_rows())
    assert out["status"] == "ok" and out["sym"] == "AAA" and out["cik"] == CIK and out["company"] == "Acme Example Corp"
    assert out["entity_type"] == "operating" and out["fund_like"] is False and out["source"] == "SEC EDGAR filings"
    assert out["window"] == {"years": 3, "from": "2023-11-18", "to": "2026-11-18", "recent_months": 12, "recent_from": "2025-11-18"}
    assert out["coverage"] == {"complete": True, "from": "2023-11-18", "requests": 1, "pages_unread": 0}
    assert out["newest_filing"] == "2026-11-05"                      # a 10-Q: the newest filing of ANY form
    (shelf,) = out["shelves"]                                        # the 2023 automatic shelf ran out in January 2026
    assert {k: shelf[k] for k in ("form", "what", "file_number", "filed", "automatic", "effective", "effective_basis",
                                  "expires_estimate", "state", "withdrawal_requested", "amendments", "offerings", "latest_offering")} == {
        "form": "S-3", "what": "Shelf registration", "file_number": SHELF_FILE, "filed": "2025-03-04", "automatic": False,
        "effective": "2025-03-12", "effective_basis": "notice", "expires_estimate": "2028-03-12", "state": "live",
        "withdrawal_requested": None, "amendments": 1, "offerings": 5, "latest_offering": "2026-10-02"}
    assert shelf["url"].startswith("https://www.sec.gov/Archives/edgar/data/1234567/") and shelf["url"].endswith("-index.htm")
    s = out["summary"]
    assert s["live_shelves"] == 1 and s["newest_live_shelf"] == shelf and s["pending_shelves"] == 0 and s["newest_pending_shelf"] is None
    assert s["offerings"] == {"m12": 4, "y3": 6, "latest": "2026-10-02"}          # the FWP is listed, not counted
    assert s["unregistered"] == {"m12": 1, "y3": 1, "latest": "2026-09-30"}
    assert s["registrations"] == {"m12": 0, "y3": 0, "latest": None}
    assert out["shelf_life_years"] == 3


def test_the_timeline_is_the_window_newest_first_each_row_with_its_link_and_what_it_was_filed_under():
    out = answer(live_shelf_rows())
    rows = out["rows"]
    assert [(r["date"], r["form"], r["kind"]) for r in rows] == [
        ("2026-10-02", "424B5", "offering"), ("2026-10-01", "FWP", "fwp"), ("2026-09-30", "8-K", "unregistered"),
        ("2026-08-01", "8-K", "agreement"), ("2026-05-20", "424B5", "offering"), ("2026-01-15", "424B5", "offering"),
        ("2025-12-01", "424B5", "offering"), ("2025-06-02", "424B5", "offering"), ("2025-03-12", "EFFECT", "effect"),
        ("2025-03-10", "S-3/A", "shelf_amendment"), ("2025-03-04", "S-3", "shelf"), ("2024-03-03", "424B2", "offering"),
        ("2024-02-01", "S-8", "plan"),
    ]
    assert out["rows_total"] == 13 and out["cut"] is False
    assert out["counts"] == {"offering": 6, "fwp": 1, "unregistered": 1, "agreement": 1, "effect": 1, "shelf_amendment": 1,
                             "shelf": 1, "plan": 1}
    by = {(r["date"], r["form"]): r for r in rows}
    under = {"form": "S-3", "filed": "2025-03-04", "shelf": True}
    for key in (("2026-10-02", "424B5"), ("2026-10-01", "FWP"), ("2025-03-12", "EFFECT"), ("2025-03-10", "S-3/A")):
        assert by[key]["under"] == under and by[key]["file_number"] == SHELF_FILE
    assert by[("2025-03-04", "S-3")]["under"] is None                                 # a registration is not under itself
    # a supplement under a shelf filed before the window still says which shelf
    assert by[("2024-03-03", "424B2")]["under"] == {"form": "S-3ASR", "filed": "2023-01-10", "shelf": True}
    assert by[("2026-09-30", "8-K")]["items"] == ["1.01", "3.02", "9.01"] and by[("2026-10-02", "424B5")]["items"] == []
    assert by[("2026-09-30", "8-K")]["what"] == "Unregistered sale of equity securities (8-K item 3.02)"
    for r in rows:
        assert r["url"] == dw.filing_url(CIK, r["accession"]) and set(r) == {"date", "form", "kind", "what", "accession", "url", "file_number", "items", "under"}
    # nothing in the answer is an amount: the index holds none
    flat = json.dumps(out).lower()
    assert not any(w in flat for w in ("amount", "dollar", "proceeds", "shares", "price"))


@pytest.mark.parametrize("rows, state, effective, basis, expires", [
    ([filing("S-3ASR", "2026-02-10", SHELF_FILE)], "live", "2026-02-10", "automatic", "2029-02-10"),
    ([filing("F-3ASR", "2024-02-29", SHELF_FILE)], "live", "2024-02-29", "automatic", "2027-02-28"),
    ([filing("S-3", "2026-10-20", SHELF_FILE)], "not_effective", None, None, None),
    ([filing("F-3", "2026-06-01", SHELF_FILE), filing("EFFECT", "2026-06-20", "333-999999")], "not_effective", None, None, None),
    ([filing("S-3", "2026-06-01", SHELF_FILE), filing("EFFECT", "2026-06-20", SHELF_FILE), filing("EFFECT", "2026-09-01", SHELF_FILE)],
     "live", "2026-06-20", "notice", "2029-06-20"),
    ([filing("S-3", "2026-06-01", SHELF_FILE), filing("EFFECT", "2026-06-20", SHELF_FILE), filing("RW", "2026-08-01", SHELF_FILE)],
     "withdrawal_requested", "2026-06-20", "notice", "2029-06-20"),
    # filed before the window, in force by its notice: still this answer's
    ([filing("S-3", "2023-10-01", SHELF_FILE), filing("EFFECT", "2023-12-15", SHELF_FILE)], "live", "2023-12-15", "notice", "2026-12-15"),
])
def test_each_state_of_a_shelf(rows, state, effective, basis, expires):
    (shelf,) = answer(rows)["shelves"]
    assert (shelf["state"], shelf["effective"], shelf["effective_basis"], shelf["expires_estimate"]) == (state, effective, basis, expires)
    assert shelf["automatic"] is (basis == "automatic")
    if state == "withdrawal_requested":
        assert shelf["withdrawal_requested"] == "2026-08-01"


def test_a_shelf_that_ran_out_or_never_took_effect_before_the_window_is_not_listed():
    out = answer([filing("S-3ASR", "2023-01-10", OLD_SHELF_FILE), filing("S-3", "2023-06-01", "333-250002"),
                  filing("EFFECT", "2023-11-17", "333-250003"), filing("S-3", "2023-08-01", "333-250003")])
    assert out["shelves"] == [] and out["rows"] == []
    assert out["summary"]["live_shelves"] == 0 and out["summary"]["offerings"] == {"m12": 0, "y3": 0, "latest": None}
    # the last day of its three years is live; the day after is not
    on = dw.assemble("AAA", CIK, {}, dw.read_columns(columns([filing("S-3ASR", "2023-11-19", SHELF_FILE)]))[0], today=TODAY, covered_from=None)
    assert on["shelves"][0]["state"] == "live" and on["shelves"][0]["expires_estimate"] == "2026-11-19"
    off = dw.assemble("AAA", CIK, {}, dw.read_columns(columns([filing("S-3ASR", "2023-11-18", SHELF_FILE)]))[0], today=TODAY, covered_from=None)
    assert off["shelves"][0]["state"] == "expired" and off["summary"]["live_shelves"] == 0


def test_a_company_with_nothing_filed_is_an_answer_with_zeros_it_can_stand_behind():
    out = answer([filing("10-K", "2026-02-20"), filing("8-K", "2026-11-01", "001-30001", "2.02,9.01"), filing("DEF 14A", "2026-04-01")])
    assert out["status"] == "ok" and out["rows"] == [] and out["shelves"] == [] and out["counts"] == {}
    assert out["summary"]["offerings"] == {"m12": 0, "y3": 0, "latest": None} and out["newest_filing"] == "2026-11-01"


def test_a_count_the_read_does_not_reach_back_for_is_none_never_a_smaller_number():
    rows = [filing("424B5", "2026-10-02", SHELF_FILE), filing("424B5", "2025-01-10", SHELF_FILE), filing("424B5", "2024-09-09", SHELF_FILE)]
    part = answer(rows, covered_from="2024-09-09")                   # older pages were left unread
    assert part["coverage"]["complete"] is False and part["coverage"]["from"] == "2024-09-09"
    assert part["summary"]["offerings"] == {"m12": 1, "y3": None, "latest": "2026-10-02"}
    thin = answer(rows[:1], covered_from="2026-06-01")               # not even twelve months
    assert thin["summary"]["offerings"] == {"m12": None, "y3": None, "latest": "2026-10-02"}
    edge = answer(rows, covered_from="2025-11-18")                   # the boundary day itself may be cut: not reached
    assert edge["summary"]["offerings"]["m12"] is None
    assert answer(rows, covered_from="2023-11-17")["summary"]["offerings"] == {"m12": 1, "y3": 3, "latest": "2026-10-02"}


def test_a_long_timeline_is_cut_at_the_newest_rows_and_says_so_while_the_counts_cover_everything(monkeypatch):
    monkeypatch.setattr(dw, "ROWS_MAX", 5)
    rows = [filing("424B2", f"2026-{m:02d}-{d:02d}", SHELF_FILE) for m in range(1, 11) for d in (5, 15)]
    out = answer(rows)
    assert len(out["rows"]) == 5 and out["rows_total"] == 20 and out["cut"] is True
    assert [r["date"] for r in out["rows"]] == ["2026-10-15", "2026-10-05", "2026-09-15", "2026-09-05", "2026-08-15"]
    assert out["summary"]["offerings"] == {"m12": 20, "y3": 20, "latest": "2026-10-15"} and out["counts"] == {"offering": 20}


def test_a_fund_is_marked_so_the_panel_can_say_this_screen_is_about_companies():
    fund = answer([filing("485BPOS", "2026-02-01"), filing("497K", "2026-02-02"), filing("N-CSR", "2026-01-05")], entity="operating")
    assert fund["fund_like"] is True and fund["rows"] == []
    assert answer([filing("10-K", "2026-02-01")], entity="investment")["fund_like"] is True
    assert answer([filing("10-K", "2026-02-01")], entity=None)["entity_type"] is None
    # a filing listed twice, or dated after today, is not counted
    twice = filing("424B5", "2026-10-02", SHELF_FILE)
    assert answer([twice, dict(twice), filing("424B5", "2026-12-25", SHELF_FILE)])["rows_total"] == 1


# ── the read, one company ────────────────────────────────────────────────────────────────────

def test_one_company_is_one_request_and_one_log_line_with_its_counts_and_never_a_url(sec, caplog):
    sec.docs[INDEX_URL] = index(live_shelf_rows())
    with caplog.at_level(logging.INFO, logger="api.services.dilution_watch"):
        out = dw.get_watch("aaa", wait_s=10)
        drain()
    assert out["status"] == "ok" and out["summary"]["live_shelves"] == 1 and out["coverage"]["requests"] == 1
    assert "_after" not in out and "refreshing" not in out
    assert sec.calls == [INDEX_URL] and sec.lookups == ["AAA"]
    assert all(name == "dilution-watch" for name in sec.threads)        # never the caller's thread
    (line,) = lines(caplog)
    assert line.startswith(f"[dilution] AAA cik={CIK} status=200 ok rows=13 shelves=1 live=1 offerings_3y=6 unregistered_3y=1 "
                           f"filings_read=19 requests=1 coverage=complete; ")
    assert "http" not in caplog.text and "sec.gov" not in caplog.text
    assert caplog.records[-1].levelno == logging.INFO


def test_a_request_never_builds_it_says_computing_then_the_held_answer(sec):
    sec.docs[INDEX_URL] = index(live_shelf_rows())
    sec.gate = threading.Event()
    started = time.time()
    assert dw.get_watch("AAA", wait_s=0.05) == {"status": "computing", "sym": "AAA"}
    assert time.time() - started < 2.0
    assert dw.get_watch("AAA", wait_s=0.05) == {"status": "computing", "sym": "AAA"}      # the same build, not a second one
    assert dw.held_watch("AAA") == (None, "not_held")
    sec.gate.set()
    drain()
    assert dw.get_watch("AAA", wait_s=0)["status"] == "ok" and dw.held_watch("AAA")[1] == "fresh"
    assert sec.calls == [INDEX_URL]
    assert dw.get_watch("AAA")["status"] == "ok" and sec.calls == [INDEX_URL]             # held: the SEC is not asked


def test_the_last_good_answer_is_served_marked_refreshing_while_one_rebuild_runs(sec):
    sec.docs[INDEX_URL] = index(live_shelf_rows())
    good = dw.get_watch("AAA", wait_s=10)
    drain()
    with dw._lock:                                                                        # its freshness has run out
        dw._done["AAA"] = (time.time() - 1, good)
    sec.gate = threading.Event()
    again = dw.get_watch("AAA", wait_s=10)
    assert again["refreshing"] is True and again["rows"] == good["rows"]
    assert dw.held_watch("AAA")[1] == "last_good" and "refreshing" not in dw.held_watch("AAA")[0]
    sec.gate.set()
    drain()
    assert "refreshing" not in dw.get_watch("AAA", wait_s=0) and len(sec.calls) == 2


def test_only_a_few_companies_are_read_at_once_and_one_more_waits_its_turn(sec, monkeypatch):
    monkeypatch.setattr(dw, "MAX_BUILDS", 2)
    sec.ciks.update({"BBB": "0000000002", "CCC": "0000000003"})
    sec.gate = threading.Event()
    assert dw.get_watch("AAA", wait_s=0)["status"] == "computing"
    assert dw.get_watch("BBB", wait_s=0)["status"] == "computing"
    assert dw.get_watch("CCC", wait_s=0) == {"status": "computing", "sym": "CCC", "busy": True}
    with dw._lock:
        assert set(dw._inflight) == {"AAA", "BBB"}
    sec.gate.set()
    drain()
    assert "CCC" not in sec.lookups


def test_a_symbol_that_is_not_a_stock_is_refused_before_anything_is_started(sec):
    assert dw.get_watch("I:SPX") == {"status": "bad_symbol", "sym": None}
    assert dw.held_watch("../etc") == ({"status": "bad_symbol", "sym": None}, "refused")
    assert sec.calls == [] and sec.lookups == [] and not dw._inflight


# ── older pages ──────────────────────────────────────────────────────────────────────────────

PAGE = "CIK0001234567-submissions-{:03d}.json"
PAGE_URL = "https://data.sec.gov/submissions/" + PAGE


def test_an_older_page_is_read_only_when_the_recent_page_does_not_reach_back_far_enough(sec, caplog):
    recent = [filing("424B5", "2026-10-02", SHELF_FILE), filing("424B5", "2025-08-01", SHELF_FILE), filing("10-Q", "2025-05-05")]
    older = [filing("EFFECT", "2025-03-12", SHELF_FILE), filing("S-3", "2025-03-04", SHELF_FILE), filing("424B5", "2021-01-01", "333-230001")]
    files = [{"name": PAGE.format(1), "filingCount": 3, "filingFrom": "2021-01-01", "filingTo": "2025-03-12"},
             {"name": PAGE.format(2), "filingCount": 9, "filingFrom": "2001-01-01", "filingTo": "2020-12-31"}]
    sec.docs[INDEX_URL] = index(recent, files=files)
    sec.docs[PAGE_URL.format(1)] = columns(older)
    with caplog.at_level(logging.INFO, logger="api.services.dilution_watch"):
        out = dw.get_watch("AAA", wait_s=10)
        drain()
    assert sec.calls == [INDEX_URL, PAGE_URL.format(1)]              # the page that ends before the window is never asked for
    assert out["coverage"] == {"complete": True, "from": "2023-11-18", "requests": 2, "pages_unread": 0}
    assert out["summary"]["live_shelves"] == 1 and out["summary"]["offerings"] == {"m12": 1, "y3": 2, "latest": "2026-10-02"}
    assert "requests=2 coverage=complete" in lines(caplog)[0]
    # a recent page that reaches back far enough asks for nothing more, whatever older pages exist
    dw.reset_for_tests()
    sec.calls.clear()
    sec.docs[INDEX_URL] = index(live_shelf_rows(), files=files)
    assert dw.get_watch("AAA", wait_s=10)["coverage"]["requests"] == 1 and sec.calls == [INDEX_URL]


def test_a_company_that_files_too_often_is_read_a_few_pages_back_and_says_how_far(sec, caplog, monkeypatch):
    monkeypatch.setattr(dw, "MAX_OLDER_PAGES", 2)
    sec.docs[INDEX_URL] = index([filing("424B2", "2026-11-10", SHELF_FILE), filing("424B2", "2026-09-01", SHELF_FILE)], files=[
        {"name": PAGE.format(1), "filingFrom": "2026-05-01", "filingTo": "2026-08-31"},
        {"name": PAGE.format(2), "filingFrom": "2026-01-01", "filingTo": "2026-04-30"},
        {"name": PAGE.format(3), "filingFrom": "2025-06-01", "filingTo": "2025-12-31"},
        {"name": PAGE.format(4), "filingFrom": "2024-06-01", "filingTo": "2025-05-31"},
    ])
    sec.docs[PAGE_URL.format(1)] = columns([filing("424B2", "2026-08-31", SHELF_FILE), filing("424B2", "2026-05-01", SHELF_FILE)])
    sec.docs[PAGE_URL.format(2)] = columns([filing("424B2", "2026-04-30", SHELF_FILE), filing("424B2", "2026-01-01", SHELF_FILE)])
    with caplog.at_level(logging.INFO, logger="api.services.dilution_watch"):
        out = dw.get_watch("AAA", wait_s=10)
        drain()
    assert sec.calls == [INDEX_URL, PAGE_URL.format(1), PAGE_URL.format(2)]
    assert out["coverage"] == {"complete": False, "from": "2026-01-01", "requests": 3, "pages_unread": 2}
    assert out["rows_total"] == 6 and out["summary"]["offerings"] == {"m12": None, "y3": None, "latest": "2026-11-10"}
    assert "offerings_3y=unknown" in lines(caplog)[0] and "coverage=from 2026-01-01 pages_unread=2" in lines(caplog)[0]


def test_an_older_page_that_fails_leaves_the_answer_standing_and_says_the_page_was_not_read(sec, caplog):
    files = [{"name": PAGE.format(1), "filingFrom": "2021-01-01", "filingTo": "2025-03-12"}]
    sec.docs[INDEX_URL] = index([filing("424B5", "2026-10-02", SHELF_FILE), filing("10-Q", "2025-05-05")], files=files)
    sec.docs[PAGE_URL.format(1)] = SecError(PAGE_URL.format(1), 429, "gave up after 2 attempts: secret-text")
    with caplog.at_level(logging.INFO, logger="api.services.dilution_watch"):
        out = dw.get_watch("AAA", wait_s=10)
        drain()
    assert out["status"] == "ok" and "_after" not in out
    assert out["coverage"] == {"complete": False, "from": "2025-05-05", "requests": 2, "pages_unread": 1}
    assert out["summary"]["offerings"] == {"m12": 1, "y3": None, "latest": "2026-10-02"}
    (line,) = lines(caplog)
    assert "pages_unread=1 older_page=rate_limited" in line and "secret-text" not in caplog.text
    assert caplog.records[-1].levelno == logging.WARNING
    # the rate limit is remembered: the next company is not asked for
    sec.ciks["BBB"] = "0000000002"
    assert dw.get_watch("BBB", wait_s=10) == {"status": "failed", "reason": "rate_limited", "http_status": 429,
                                              "source": "SEC EDGAR filings", "sym": "BBB"}
    assert "BBB" not in sec.lookups


# ── none, refused, failed ────────────────────────────────────────────────────────────────────

def test_a_symbol_the_sec_lists_no_filer_for_is_none_a_healthy_answer(sec, caplog):
    with caplog.at_level(logging.INFO, logger="api.services.dilution_watch"):
        out = dw.get_watch("ZZZ", wait_s=10)
        drain()
    assert out == {"status": "none", "sym": "ZZZ", "reason": "no_cik", "http_status": None, "source": "SEC EDGAR filings"}
    assert sec.calls == []                                           # no company number: the SEC's index is not asked
    (line,) = lines(caplog)
    assert "ZZZ cik=none status=none none (the SEC lists no filer for this symbol) requests=0" in line
    assert caplog.records[-1].levelno == logging.INFO
    assert dw.held_watch("ZZZ") == (out, "fresh")
    assert dw.get_watch("ZZZ") == out and sec.lookups == ["ZZZ"]     # held: not looked up again


def test_an_unreadable_ticker_list_is_a_failure_never_no_such_company(sec):
    sec.listed = False
    out = dw.get_watch("ZZZ", wait_s=10)
    assert (out["status"], out["reason"]) == ("failed", "source") and sec.calls == []


def test_a_company_number_with_no_index_and_an_index_with_no_filings_are_both_none(sec, caplog):
    with caplog.at_level(logging.INFO, logger="api.services.dilution_watch"):
        out = dw.get_watch("AAA", wait_s=10)                         # the fake answers 404 for a URL it has no document for
        drain()
    assert (out["status"], out["reason"], out["http_status"]) == ("none", "no_filings", 404)
    assert f"AAA cik={CIK} status=404 none (the SEC has no filing index for this company number) requests=1" in lines(caplog)[0]
    dw.reset_for_tests()
    sec.docs[INDEX_URL] = index([])
    out = dw.get_watch("AAA", wait_s=10)
    assert (out["status"], out["reason"], out["http_status"]) == ("none", "no_filings", 200)


def test_a_refusal_is_unavailable_and_remembered_for_every_company(sec, caplog):
    sec.ciks["BBB"] = "0000000002"
    sec.docs[INDEX_URL] = SecError(INDEX_URL, 403, "gave up after 2 attempts: secret-text")
    with caplog.at_level(logging.INFO, logger="api.services.dilution_watch"):
        out = dw.get_watch("AAA", wait_s=10)
        drain()
    assert out == {"status": "unavailable", "sym": "AAA", "reason": "refused", "http_status": 403, "source": "SEC EDGAR filings"}
    (line,) = lines(caplog)
    assert f"AAA cik={CIK} status=403 unavailable (the SEC refused the request for the filing index; nothing is asked for 15 min) requests=1" in line
    assert "secret-text" not in caplog.text and "http" not in caplog.text and caplog.records[-1].levelno == logging.WARNING
    # another company: answered at once from the memory of the refusal, nothing looked up, nothing asked
    before = (list(sec.calls), list(sec.lookups))
    assert dw.get_watch("BBB", wait_s=10) == {"status": "unavailable", "reason": "refused", "http_status": 403,
                                              "source": "SEC EDGAR filings", "sym": "BBB"}
    assert (sec.calls, sec.lookups) == before and not dw._inflight
    # when the hold runs out the SEC is asked again
    with dw._lock:
        dw._blocked[0] = (time.time() - 1, dw._blocked[0][1])
    sec.docs["https://data.sec.gov/submissions/CIK0000000002.json"] = index([filing("S-3ASR", "2026-02-10", SHELF_FILE)])
    assert dw.get_watch("BBB", wait_s=10)["status"] == "ok"


@pytest.mark.parametrize("exc, status, reason, said, remembered", [
    (SecError(INDEX_URL, 429, "gave up"), 429, "rate_limited", "failed (the SEC said too many requests, for the filing index; nothing is asked for 15 min)", True),
    (SecError(INDEX_URL, None, "gave up after 2 attempts: <urlopen error timed out>"), None, "timeout", "failed (the SEC did not answer in time, for the filing index)", False),
    (SecError(INDEX_URL, 503, "gave up"), 503, "source", "failed (SecError, for the filing index)", False),
    (SecError(INDEX_URL, None, "gave up after 2 attempts: connection reset"), None, "source", "failed (SecError, for the filing index)", False),
    (RuntimeError("secret-text"), None, "source", "failed (RuntimeError, for the filing index)", False),
])
def test_a_failed_read_is_failed_with_its_reason_and_only_a_rate_limit_is_remembered(sec, caplog, exc, status, reason, said, remembered):
    sec.ciks["BBB"] = "0000000002"
    sec.docs[INDEX_URL] = exc
    with caplog.at_level(logging.INFO, logger="api.services.dilution_watch"):
        out = dw.get_watch("AAA", wait_s=10)
        drain()
    assert out == {"status": "failed", "sym": "AAA", "reason": reason, "http_status": status, "source": "SEC EDGAR filings"}
    assert said in lines(caplog)[0] and "secret-text" not in caplog.text and "http" not in caplog.text
    sec.docs["https://data.sec.gov/submissions/CIK0000000002.json"] = index([filing("10-K", "2026-02-10")])
    other = dw.get_watch("BBB", wait_s=10)
    assert (other["status"] == "failed") is remembered and (("BBB" in sec.lookups) is not remembered)
    # a failed answer is tried again soon, and is never kept as the last good one
    with dw._lock:
        assert dw._done["AAA"][0] - time.time() <= dw.FAILED_S + 1 and "AAA" not in dw._old


@pytest.mark.parametrize("doc, why", [
    (b"<html><body>Request Rate Threshold Exceeded</body></html>", "the answer is not JSON"),
    ({"name": "x"}, "not an object"),
    ({"filings": {"recent": {"form": ["S-3"], "filingDate": ["2026-01-01"]}}}, "the form, filingDate and accessionNumber columns are missing or of different lengths"),
    ({"filings": {"recent": {"form": ["S-3"], "filingDate": ["x"], "accessionNumber": ["y"]}}}, "1 filings listed, none with a form, a day and an accession number"),
    ([1, 2], "not an object"),
])
def test_an_answer_that_is_not_the_filing_index_is_a_shape_mismatch_never_an_empty_company(sec, caplog, doc, why):
    sec.docs[INDEX_URL] = doc
    with caplog.at_level(logging.INFO, logger="api.services.dilution_watch"):
        out = dw.get_watch("AAA", wait_s=10)
        drain()
    assert out == {"status": "unavailable", "sym": "AAA", "reason": "shape", "http_status": 200, "source": "SEC EDGAR filings"}
    assert f"status=200 rows=0 shape mismatch ({why}) requests=1" in lines(caplog)[0]
    with dw._lock:
        assert dw.SHAPE_S - 5 <= dw._done["AAA"][0] - time.time() <= dw.SHAPE_S + 1 and dw._blocked[0] is None


def test_a_build_that_breaks_is_said_as_failed_and_never_left_computing(sec, monkeypatch, caplog):
    monkeypatch.setattr(dw, "assemble", lambda *a, **k: (_ for _ in ()).throw(KeyError("secret-text")))
    sec.docs[INDEX_URL] = index(live_shelf_rows())
    with caplog.at_level(logging.INFO, logger="api.services.dilution_watch"):
        out = dw.get_watch("AAA", wait_s=10)
        drain()
    assert (out["status"], out["reason"]) == ("failed", "error")
    assert "failed (KeyError)" in lines(caplog)[0] and "secret-text" not in caplog.text


def test_the_answers_held_are_bounded(sec, monkeypatch):
    monkeypatch.setattr(dw, "KEEP", 3)
    for i in range(6):
        dw._remember(f"S{i}", {"status": "ok", "sym": f"S{i}"}, 100 + i)
    with dw._lock:
        assert set(dw._done) == {"S3", "S4", "S5"} and set(dw._old) == {"S3", "S4", "S5"}
    assert dw._ttl({"status": "ok"}) == dw.FRESH_S and dw._ttl({"status": "none"}) == dw.NONE_S
    assert dw._ttl({"status": "unavailable", "reason": "shape"}) == dw.SHAPE_S and dw._ttl({"status": "failed", "reason": "timeout"}) == dw.FAILED_S


# ── the house client and the house company-number chain ──────────────────────────────────────

def test_the_sec_is_asked_through_the_house_client_with_one_bounded_retry(monkeypatch):
    seen = []
    monkeypatch.setattr(sec_client, "get_bytes", lambda url, **kw: seen.append((url, kw)) or b"{}")
    assert dw._sec_get(INDEX_URL) == b"{}"
    assert seen == [(INDEX_URL, {"retries": 1, "timeout": 20.0})]


def test_the_company_number_comes_from_the_house_chain_and_a_remembered_miss_is_checked_against_the_list(monkeypatch):
    from api.services import edgar
    monkeypatch.setattr(edgar, "resolve_cik", lambda sym: "1234567" if sym == "AAA" else None)
    monkeypatch.setattr(edgar, "_ticker_to_cik_bulk", lambda: {"BBB": "0000000002"})
    assert dw._resolve_cik("AAA") == (CIK, True)
    assert dw._resolve_cik("BBB") == ("0000000002", True)            # the chain's remembered miss does not stand against the list
    assert dw._resolve_cik("ZZZ") == (None, True)
    monkeypatch.setattr(edgar, "_ticker_to_cik_bulk", lambda: {})
    assert dw._resolve_cik("ZZZ") == (None, False)                   # the list could not be read: not "no such company"


def test_the_service_has_no_client_of_its_own_and_reads_no_filing_document():
    """The module names no HTTP library; its one transport is the house client; the only SEC
    addresses it builds are the filing index and its older pages (a filing's own page is a link
    for the member, never fetched)."""
    import ast
    import inspect
    tree = ast.parse(inspect.getsource(dw))
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    assert not imported & {"httpx", "requests", "urllib", "aiohttp", "yfinance", "os"}        # no client, no environment variable
    assert "sec_client.get_bytes(" in inspect.getsource(dw._sec_get)
    assert "edgar.resolve_cik(" in inspect.getsource(dw._resolve_cik)
    fetched = [ast.unparse(n.args[0]) for n in ast.walk(tree)
               if isinstance(n, ast.Call) and getattr(n.func, "id", None) == "_sec_get"]
    assert sorted(fetched) == ["f'{_DATA}/submissions/CIK{cik}.json'", "f'{_DATA}/submissions/{name}'"]
    assert "_WWW" not in "".join(fetched)


# ── the route ────────────────────────────────────────────────────────────────────────────────

FREE_USER = {"id": "dw-free", "email": "free@example.test", "role": "member", "plan": "free"}
PAID_USER = {"id": "dw-paid", "email": "paid@example.test", "role": "member", "plan": "pro"}
URL = "/api/research/dilution-watch/NVDA"


def _client(user):
    app = FastAPI()
    app.include_router(route.router)
    if user is not None:
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app, raise_server_exceptions=False)


def test_the_route_is_paid_and_passes_the_ticker_through(monkeypatch):
    asked = []
    monkeypatch.setattr(dw, "get_watch", lambda ticker: asked.append(ticker) or {"status": "ok", "sym": ticker})
    (r,) = route.router.routes
    assert r.path == "/api/research/dilution-watch/{ticker}" and r.methods == {"GET"}
    assert route.require_paid in {d.call for d in r.dependant.dependencies}
    assert _client(None).get(URL).status_code == 401
    assert _client(FREE_USER).get(URL).status_code == 402
    assert asked == []                                               # a refused caller never reaches the service
    assert _client(PAID_USER).get(URL).json() == {"status": "ok", "sym": "NVDA"}
    assert asked == ["NVDA"]


@pytest.mark.parametrize("body", [
    {"status": "none", "reason": "no_cik"}, {"status": "unavailable", "reason": "refused", "http_status": 403},
    {"status": "failed", "reason": "rate_limited", "http_status": 429}, {"status": "computing"},
])
def test_none_refused_and_failed_are_200_answers_not_error_statuses(monkeypatch, body):
    monkeypatch.setattr(dw, "get_watch", lambda ticker: dict(body))
    resp = _client(PAID_USER).get(URL)
    assert resp.status_code == 200 and resp.json() == body


def test_the_route_is_mounted_on_the_app():
    import pathlib
    main = pathlib.Path(__file__).resolve().parents[1].joinpath("api", "main.py").read_text(encoding="utf-8")
    assert "from api.routers import dilution_watch as dilution_watch_router" in main
    assert "app.include_router(dilution_watch_router.router)" in main
