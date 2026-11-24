"""INS CLUSTER: insider cluster buys from the SEC's own Form 4 filings
(`api/services/insider_clusters_sec.py`, `GET /api/insider/clusters`).

EVERY DOCUMENT HERE IS INVENTED: the companies, the people, the tickers, the CIKs and accession
numbers and every number are made up, in the STRUCTURE of EDGAR's daily master index and a Form 4
complete submission text file (read once each on 2026-11-21, never copied). No test asks the SEC:
the one transport (`_sec_get`) is replaced by a fake that counts every request.

  * the readers: the daily master index (one row per party, de-duplicated by accession, form 4 only),
    the Form 4 document inside a submission, the purchase rule (P and acquired only), the ticker and
    the roles;
  * the clusters: three distinct insiders, ten NYSE sessions, joint filers are one insider, the newest
    window, the totals (a missing price is never 0), the held close and the change since the average;
  * the night: every index of the window, each Form 4 read once, the cap and what happens past it, a
    holiday, a refusal stops the run, a failing filing is retried and then given up, the budget, the
    30 days kept, the most requests a night can make;
  * the holding pattern: nothing is read on a request, one run at a time, a restart answers from disk,
    a failed run keeps the last good answer;
  * the route: one paid GET under /api/insider, 401 / 402, its own gate, above `/{ticker}`, a plain def;
  * the schedule: registered in api/main.py, Tuesday to Saturday at the module's slot, with an hour's grace;
  * the catch-up: the last slot comes from `next_run` (a weekend has none), the read starts only when nothing is held
    or the held answer was built before that slot, never a second run, never on a request; registered as a DATE job
    after boot (never inline) and an hourly check, under its own boot mark.
"""
from __future__ import annotations

import ast
import inspect
import json
import pathlib
import threading
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import insider as route
from api.services import insider_clusters_sec as ics
from api.services.edgar_ownership import ParseError, parse_form4
from api.services.fundamentals_pit.sec_client import SecError

NY = ZoneInfo("America/New_York")
ROOT = pathlib.Path(__file__).resolve().parents[1]
FREE_USER = {"id": "icl-free", "email": "free@example.test", "role": "member", "plan": "free"}
PAID_USER = {"id": "icl-paid", "email": "paid@example.test", "role": "member", "plan": "pro"}
#: Saturday 2031-03-15, 01:20 New York: the run reads the twelve weekdays before it
NIGHT = datetime(2031, 3, 15, 1, 20, tzinfo=NY)
FRI = "2031-03-14"

QUILL = ("0009900001", "Quillfeather Robotics Inc", "QFRB")
VELLUM = ("0009900002", "Vellumark Biosystems Corp", "VLMQ")
KESTREL = ("0009900003", "Kestrelwick Holdings Inc", "KWZP")


# ── invented documents in the public structure ─────────────────────────────────────────────────

def person(cik, name, *, director=False, officer=False, ten=False, title=None):
    return {"cik": cik, "name": name, "director": director, "officer": officer, "ten": ten, "title": title}


def buy(shares, price, day, code="P", ad="A"):
    return {"code": code, "ad": ad, "shares": shares, "price": price, "date": day}


def _flag(v: bool) -> str:
    return "true" if v else "false"


def _owner_xml(o) -> str:
    title = f"<officerTitle>{o['title']}</officerTitle>" if o["title"] else ""
    return (f"<reportingOwner><reportingOwnerId><rptOwnerCik>{o['cik']}</rptOwnerCik>"
            f"<rptOwnerName>{o['name']}</rptOwnerName></reportingOwnerId>"
            "<reportingOwnerAddress><rptOwnerStreet1>1 Invented Way</rptOwnerStreet1></reportingOwnerAddress>"
            f"<reportingOwnerRelationship><isDirector>{_flag(o['director'])}</isDirector>"
            f"<isOfficer>{_flag(o['officer'])}</isOfficer><isTenPercentOwner>{_flag(o['ten'])}</isTenPercentOwner>"
            f"<isOther>false</isOther>{title}</reportingOwnerRelationship></reportingOwner>")


def ownership_xml(issuer, owners, txns, *, doc_type="4") -> str:
    cik, name, symbol = issuer
    owner_xml = "".join(_owner_xml(o) for o in owners)
    txn_xml = "".join(
        "<nonDerivativeTransaction><securityTitle><value>Common Stock</value></securityTitle>"
        f"<transactionDate><value>{t['date']}</value></transactionDate>"
        f"<transactionCoding><transactionFormType>4</transactionFormType><transactionCode>{t['code']}</transactionCode>"
        "<equitySwapInvolved>0</equitySwapInvolved></transactionCoding><transactionAmounts>"
        f"<transactionShares><value>{t['shares']}</value></transactionShares>"
        + (f"<transactionPricePerShare><value>{t['price']}</value></transactionPricePerShare>" if t["price"] is not None
           else "<transactionPricePerShare><footnoteId id=\"F1\"/></transactionPricePerShare>")
        + f"<transactionAcquiredDisposedCode><value>{t['ad']}</value></transactionAcquiredDisposedCode></transactionAmounts>"
        "<postTransactionAmounts><sharesOwnedFollowingTransaction><value>50000</value></sharesOwnedFollowingTransaction>"
        "</postTransactionAmounts><ownershipNature><directOrIndirectOwnership><value>D</value>"
        "</directOrIndirectOwnership></ownershipNature></nonDerivativeTransaction>" for t in txns)
    # a derivative purchase coded P: never read (the scope is the non-derivative table)
    derivative = ("<derivativeTable><derivativeTransaction><securityTitle><value>Invented Option</value></securityTitle>"
                  "<transactionDate><value>2031-03-10</value></transactionDate><transactionCoding>"
                  "<transactionCode>P</transactionCode></transactionCoding><transactionAmounts><transactionShares>"
                  "<value>99999</value></transactionShares><transactionAcquiredDisposedCode><value>A</value>"
                  "</transactionAcquiredDisposedCode></transactionAmounts></derivativeTransaction></derivativeTable>")
    return (f'<?xml version="1.0"?>\n<ownershipDocument><schemaVersion>X0508</schemaVersion>'
            f"<documentType>{doc_type}</documentType><periodOfReport>2031-03-12</periodOfReport>"
            f"<issuer><issuerCik>{cik}</issuerCik><issuerName>{name}</issuerName>"
            f"<issuerTradingSymbol>{symbol}</issuerTradingSymbol></issuer>{owner_xml}"
            f"<nonDerivativeTable>{txn_xml}</nonDerivativeTable>{derivative}"
            "<footnotes><footnote id=\"F1\">An invented footnote.</footnote></footnotes>"
            "<ownerSignature><signatureName>/s/ Invented Signer</signatureName>"
            "<signatureDate>2031-03-14</signatureDate></ownerSignature></ownershipDocument>")


def submission(acc, issuer, owners, txns, *, exhibit_first=False, doc_type="4", xml=None) -> bytes:
    """A complete submission text file: the SGML header, the Form 4 document with its XML, an exhibit."""
    form = (f"<DOCUMENT>\n<TYPE>{doc_type}\n<SEQUENCE>1\n<FILENAME>ownership.xml\n<DESCRIPTION>{doc_type}\n<TEXT>\n<XML>\n"
            f"{xml if xml is not None else ownership_xml(issuer, owners, txns, doc_type=doc_type)}\n</XML>\n</TEXT>\n</DOCUMENT>\n")
    exhibit = "<DOCUMENT>\n<TYPE>EX-24\n<SEQUENCE>2\n<FILENAME>poa.txt\n<TEXT>\nAn invented power of attorney.\n</TEXT>\n</DOCUMENT>\n"
    docs = exhibit + form if exhibit_first else form + exhibit
    return (f"<SEC-DOCUMENT>{acc}.txt : 20310314\n<SEC-HEADER>{acc}.hdr.sgml : 20310314\n"
            f"<ACCEPTANCE-DATETIME>20310314170343\nACCESSION NUMBER:\t\t{acc}\nCONFORMED SUBMISSION TYPE:\t{doc_type}\n"
            f"PUBLIC DOCUMENT COUNT:\t\t2\n</SEC-HEADER>\n{docs}</SEC-DOCUMENT>\n").encode("utf-8")


def master_index(day: str, rows) -> bytes:
    """rows: (cik, name, form, accession) -- a Form 4 appears once per party under one accession."""
    ymd = day.replace("-", "")
    head = ("Description:           Daily Index of EDGAR Dissemination Feed\nLast Data Received:    Invented\n"
            "Comments:              invented\nAnonymous FTP:         invented\n \n"
            "CIK|Company Name|Form Type|Date Filed|File Name\n" + "-" * 80 + "\n")
    return (head + "".join(f"{int(c)}|{n}|{f}|{ymd}|edgar/data/{int(c)}/{a}.txt\n" for c, n, f, a in rows)).encode("latin-1")


def doc_url(cik, acc) -> str:
    return f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc}.txt"


class FakeSec:
    """Serves `routes[url]` (bytes, or an exception to raise); anything else is the SEC's 404."""

    def __init__(self, routes=None):
        self.routes = dict(routes or {})
        self.calls: list[str] = []

    def __call__(self, url: str) -> bytes:
        self.calls.append(url)
        hit = self.routes.get(url)
        if hit is None:
            raise SecError(url, 404, "not found")
        if isinstance(hit, Exception):
            raise hit
        if callable(hit):
            return hit()
        return hit

    def docs(self):
        return [u for u in self.calls if "/daily-index/" not in u]

    def indexes(self):
        return [u for u in self.calls if "/daily-index/" in u]


@pytest.fixture(autouse=True)
def _isolated(monkeypatch, tmp_path):
    ics.reset_for_tests()
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "absent"))          # no disk unless a test makes one
    monkeypatch.setattr(ics, "_latest_close", lambda t: None)
    yield
    ics.reset_for_tests()


def day_with(fake: FakeSec, day: str, filings) -> None:
    """Puts one filing day's index and its Form 4 submissions on the fake SEC.
    filings: (accession, issuer, owners, txns)"""
    rows = []
    for acc, issuer, owners, txns in filings:
        rows.append((issuer[0], issuer[1], "4", acc))
        rows.extend((o["cik"], o["name"], "4", acc) for o in owners)
        fake.routes[doc_url(issuer[0], acc)] = submission(acc, issuer, owners, txns)
    rows.append(("0009900099", "Invented Shelf Co", "S-3", "0009900099-31-000001"))
    rows.append((QUILL[0], QUILL[1], "4/A", "0009900001-31-000999"))
    fake.routes[ics.index_url(date.fromisoformat(day))] = master_index(day, rows)


ANNA = person("0001900001", "Anneliese Marrow-Quint", officer=True, title="President and Chief Executive Officer")
BRAM = person("0001900002", "Bramwell Oduya", officer=True, title="EVP, Chief Financial Officer")
CORA = person("0001900003", "Coralind Vesh", director=True)
DOV = person("0001900004", "Dovrin Pell", director=True)
FUND = person("0001900005", "Invented Capital Partners LP", ten=True)
FUND_GP = person("0001900006", "Invented Capital GP LLC", ten=True)
FUND_MGR = person("0001900007", "Ottoline Brack", director=True, ten=True)


def quill_cluster_days(fake: FakeSec) -> None:
    """QFRB: CEO, CFO and a director buy across Mar 10-14; VLMQ: only a joint filing (one insider)."""
    day_with(fake, "2031-03-10", [("0001234567-31-000101", QUILL, [ANNA], [buy(1000, 12.5, "2031-03-10")])])
    day_with(fake, "2031-03-12", [("0001234567-31-000102", QUILL, [BRAM], [buy(400, 12.0, "2031-03-11"), buy(100, None, "2031-03-12")])])
    day_with(fake, FRI, [
        ("0001234567-31-000103", QUILL, [CORA], [buy(2000, 13.0, "2031-03-13"), buy(500, 10.0, "2031-03-13", code="S", ad="D")]),
        ("0001234567-31-000104", VELLUM, [FUND, FUND_GP, FUND_MGR], [buy(90000, 4.0, "2031-03-13")]),
        ("0001234567-31-000105", KESTREL, [DOV], [buy(300, 7.0, "2031-03-14", code="A")]),      # a grant, not a purchase
    ])


# ── the readers ────────────────────────────────────────────────────────────────────────────────

def test_the_daily_index_gives_each_form_4_once_by_accession_and_nothing_else():
    body = master_index(FRI, [
        (QUILL[0], QUILL[1], "4", "0001234567-31-000103"), (CORA["cik"], CORA["name"], "4", "0001234567-31-000103"),
        (VELLUM[0], VELLUM[1], "4", "0001234567-31-000104"), (FUND["cik"], FUND["name"], "4", "0001234567-31-000104"),
        (FUND_GP["cik"], FUND_GP["name"], "4", "0001234567-31-000104"),
        (QUILL[0], QUILL[1], "4/A", "0001234567-31-000199"), (QUILL[0], QUILL[1], "3", "0001234567-31-000198"),
        (QUILL[0], QUILL[1], "144", "0001234567-31-000197"),
    ]) + b"9900001|Bad Path Co|4|20310314|edgar/data/9900001/../../etc.txt\n"
    got = ics.parse_master_index(body)
    assert [g["accession"] for g in got] == ["0001234567-31-000103", "0001234567-31-000104"]
    assert got[0] == {"accession": "0001234567-31-000103", "cik": str(int(QUILL[0])),
                      "path": f"edgar/data/{int(QUILL[0])}/0001234567-31-000103.txt"}


@pytest.mark.parametrize("body, why", [
    (b"<!DOCTYPE html><html><body>Invented page</body></html>", "web page"),
    (b"Description: invented\nCIK|Name\n", "header"),
    (b"CIK|Company Name|Form Type|Date Filed|File Name\nno dashes here\n", "dashed"),
], ids=["web_page", "no_header", "no_dashes"])
def test_a_body_that_is_not_the_master_index_is_refused_in_words(body, why):
    with pytest.raises(ics.IndexShape) as caught:
        ics.parse_master_index(body)
    assert why in caught.value.why


def test_the_index_address_is_the_daily_master_index_of_that_quarter():
    assert ics.index_url(date(2031, 3, 14)) == "https://www.sec.gov/Archives/edgar/daily-index/2031/QTR1/master.20310314.idx"
    assert ics.index_url(date(2031, 11, 3)) == "https://www.sec.gov/Archives/edgar/daily-index/2031/QTR4/master.20311103.idx"


def test_the_form_4_xml_is_taken_from_the_type_4_document_wherever_it_sits():
    body = submission("0001234567-31-000101", QUILL, [ANNA], [buy(1000, 12.5, "2031-03-10")], exhibit_first=True)
    doc = parse_form4(ics.form4_xml(body), accession="0001234567-31-000101", filing_date="2031-03-10")
    assert doc["issuer"] == {"cik": QUILL[0], "name": QUILL[1], "symbol": "QFRB"}
    assert [t["code"] for t in doc["transactions"]] == ["P"]                       # the derivative row is not read


@pytest.mark.parametrize("body", [
    b"<SEC-DOCUMENT>x\n<DOCUMENT>\n<TYPE>EX-24\n<TEXT>\nInvented.\n</TEXT>\n</DOCUMENT>\n</SEC-DOCUMENT>",
    b"<SEC-DOCUMENT>x\n<DOCUMENT>\n<TYPE>4\n<TEXT>\nA paper filing, invented.\n</TEXT>\n</DOCUMENT>\n</SEC-DOCUMENT>",
    submission("0001234567-31-000111", QUILL, [ANNA], [], xml='<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><ownershipDocument/>'),
    b"<DOCUMENT>\n<TYPE>4\n<XML>\n" + b" " * (ics.MAX_DOC_BYTES + 1) + b"\n</XML>\n</DOCUMENT>",
], ids=["no_type_4", "no_xml", "doctype", "too_large"])
def test_a_submission_without_a_readable_form_4_xml_is_refused(body):
    with pytest.raises(ParseError):
        ics.form4_xml(body)


def _record(owners, txns, issuer=QUILL, acc="0001234567-31-000121", filed="2031-03-14"):
    body = submission(acc, issuer, owners, txns)
    return ics.purchase_record(parse_form4(ics.form4_xml(body), accession=acc, filing_date=filed), filed=filed)


def test_only_open_market_purchases_acquired_are_kept_and_a_missing_price_is_never_0():
    rec = _record([BRAM], [
        buy(400, 12.0, "2031-03-11"), buy(100, None, "2031-03-12"), buy(50, 0, "2031-03-12"),
        buy(700, 11.0, "2031-03-12", code="S", ad="D"), buy(900, 11.0, "2031-03-12", code="P", ad="D"),
        buy(800, 11.0, "2031-03-12", code="A"), buy(600, 11.0, "2031-03-12", code="M"), buy(0, 11.0, "2031-03-12"),
        buy(10, 11.0, "not a date"),
    ])
    assert [(t["shares"], t["price"]) for t in rec["txns"]] == [(400.0, 12.0), (100.0, None), (50.0, None)]
    assert rec["shares"] == 550.0 and rec["value"] == 4800.0 and rec["avg_price"] == 12.0 and rec["unpriced"] == 2
    assert (rec["first_date"], rec["date"], rec["filed"]) == ("2031-03-11", "2031-03-12", "2031-03-14")
    assert rec["issuer_cik"] == QUILL[0] and rec["ticker"] == "QFRB" and rec["company"] == QUILL[1]
    assert rec["owners"] == [{"cik": BRAM["cik"], "name": BRAM["name"], "roles": ["cfo"], "title": "EVP, Chief Financial Officer"}]
    assert rec["url"].endswith(f"/{int(QUILL[0])}/000123456731000121/0001234567-31-000121-index.htm")
    assert _record([BRAM], [buy(700, 11.0, "2031-03-12", code="S", ad="D")]) is None


@pytest.mark.parametrize("raw, want", [
    ("qfrb", "QFRB"), (" QFRB ", "QFRB"), ("NYSE: QFRB", "QFRB"), ("QFRB.B", "QFRB-B"), ("QFRB, QFRBW", "QFRB"),
    ("N/A", None), ("None", None), ("n.a.", None), ("-", None), ("", None), (None, None), ("1234", None),
    ("<script>", None), ("ABCDEFGHIJK", None),
])
def test_the_trading_symbol_is_read_in_the_sites_one_spelling_or_not_at_all(raw, want):
    assert ics.norm_ticker(raw) == want


def test_roles_come_from_the_filing_and_the_highest_one_is_the_insiders_role():
    parsed = lambda o: {"is_officer": o["officer"], "is_director": o["director"], "is_ten_percent": o["ten"],  # noqa: E731
                        "officer_title": o["title"]}
    assert ics.owner_roles(parsed(ANNA)) == ["ceo"]
    assert ics.owner_roles(parsed(BRAM)) == ["cfo"]
    assert ics.owner_roles(parsed(person("1", "x", officer=True, title="Chief Operating Officer"))) == ["officer"]
    assert ics.owner_roles(parsed(person("1", "x", officer=True, director=True, title="Co-CEO"))) == ["ceo", "director"]
    assert ics.owner_roles(parsed(FUND_MGR)) == ["director", "ten_percent"]
    assert ics.owner_roles({}) == ["not_stated"]
    assert ics.primary_role(["director", "ceo"]) == "ceo"
    assert ics.primary_role(["ten_percent", "director"]) == "director"
    assert ics.primary_role([]) == "not_stated"


# ── the clusters ───────────────────────────────────────────────────────────────────────────────

def rec(acc, owners, txns, *, issuer=QUILL, filed=None):
    """A stored purchase record without going through XML (the cluster rule is pure)."""
    txns = [{"date": d, "shares": float(s), "price": p} for s, p, d in txns]
    dates = sorted(t["date"] for t in txns)
    return {"accession": acc, "filed": filed or dates[-1], "issuer_cik": issuer[0], "ticker": issuer[2],
            "company": issuer[1], "txns": txns, "first_date": dates[0], "date": dates[-1],
            "owners": [{"cik": o["cik"], "name": o["name"], "roles": ics.owner_roles(
                {"is_officer": o["officer"], "is_director": o["director"], "is_ten_percent": o["ten"],
                 "officer_title": o["title"]}), "title": o["title"]} for o in owners],
            **ics._totals(txns), "url": f"https://www.sec.gov/invented/{acc}"}


WEEKDAYS = lambda d: d.weekday() < 5  # noqa: E731


def test_three_distinct_insiders_within_ten_sessions_make_a_cluster_and_two_do_not():
    three = [rec("a1", [ANNA], [(1000, 12.5, "2031-03-10")]), rec("a2", [BRAM], [(400, 12.0, "2031-03-11")]),
             rec("a3", [CORA], [(2000, 13.0, "2031-03-13")])]
    (c,) = ics.find_clusters(three, newest_day=FRI, is_trading_day=WEEKDAYS)
    assert (c["ticker"], c["insiders"], c["first_buy"], c["last_buy"], c["buys"], c["filings"]) == ("QFRB", 3, "2031-03-10", "2031-03-13", 3, 3)
    assert ics.find_clusters(three[:2], newest_day=FRI, is_trading_day=WEEKDAYS) == []
    # the same insider twice is still one insider
    twice = three[:2] + [rec("a4", [ANNA], [(10, 12.0, "2031-03-12")])]
    assert ics.find_clusters(twice, newest_day=FRI, is_trading_day=WEEKDAYS) == []


def test_owners_who_file_together_are_one_insider_so_a_joint_filing_is_never_a_cluster_alone():
    joint = [rec("v1", [FUND, FUND_GP, FUND_MGR], [(90000, 4.0, "2031-03-13")], issuer=VELLUM)]
    assert ics.find_clusters(joint, newest_day=FRI, is_trading_day=WEEKDAYS) == []
    # ... even when its members also file on their own another day
    joint += [rec("v2", [FUND_GP], [(5, 4.0, "2031-03-12")], issuer=VELLUM), rec("v3", [CORA], [(5, 4.0, "2031-03-12")], issuer=VELLUM)]
    assert ics.find_clusters(joint, newest_day=FRI, is_trading_day=WEEKDAYS) == []
    joint += [rec("v4", [DOV], [(5, 4.0, "2031-03-11")], issuer=VELLUM)]
    (c,) = ics.find_clusters(joint, newest_day=FRI, is_trading_day=WEEKDAYS)
    assert c["insiders"] == 3
    fund = next(p for p in c["people"] if FUND["name"] in p["names"])
    assert fund["names"] == [FUND["name"], FUND_GP["name"], FUND_MGR["name"]] and fund["role"] == "director"


def test_the_window_is_ten_sessions_first_buy_to_last_inclusive_counted_on_the_market_calendar():
    # Mon Mar 3 to Fri Mar 14 is ten weekdays: in. One more weekday back (Fri Feb 28) is eleven: out.
    ten = [rec("w1", [ANNA], [(1, 10.0, "2031-03-03")]), rec("w2", [BRAM], [(1, 10.0, "2031-03-07")]),
           rec("w3", [CORA], [(1, 10.0, "2031-03-14")])]
    assert len(ics.find_clusters(ten, newest_day=FRI, is_trading_day=WEEKDAYS)) == 1
    eleven = [rec("w0", [ANNA], [(1, 10.0, "2031-02-28")])] + ten[1:]
    assert ics.find_clusters(eleven, newest_day=FRI, is_trading_day=WEEKDAYS) == []
    # a market holiday inside the span is not a session, so the span reaches one weekday further back
    holiday = lambda d: d.weekday() < 5 and d != date(2031, 3, 5)  # noqa: E731
    assert len(ics.find_clusters(eleven, newest_day=FRI, is_trading_day=holiday)) == 1


def test_each_issuer_counts_its_newest_window_and_late_or_future_dated_buys_do_not_count():
    old = [rec("o1", [ANNA], [(1, 10.0, "2031-02-10")]), rec("o2", [BRAM], [(1, 10.0, "2031-02-11")]),
           rec("o3", [CORA], [(1, 10.0, "2031-02-12")])]
    newer = [rec("n1", [ANNA], [(1, 11.0, "2031-03-11")]), rec("n2", [BRAM], [(1, 11.0, "2031-03-12")]),
             rec("n3", [DOV], [(1, 11.0, "2031-03-13")])]
    (c,) = ics.find_clusters(old + newer, newest_day=FRI, is_trading_day=WEEKDAYS)
    assert (c["first_buy"], c["last_buy"]) == ("2031-03-11", "2031-03-13")
    # a purchase more than KEEP_DAYS before the newest filing day (a late filing) is not a cluster today
    late = [rec(f"l{i}", [p], [(1, 10.0, "2031-01-20")], filed=FRI) for i, p in enumerate([ANNA, BRAM, CORA])]
    assert ics.find_clusters(late, newest_day=FRI, is_trading_day=WEEKDAYS) == []
    # a purchase dated after its own filing day is a typing error, not a purchase
    future = [rec(f"f{i}", [p], [(1, 10.0, "2031-03-20")], filed=FRI) for i, p in enumerate([ANNA, BRAM, CORA])]
    assert ics.find_clusters(future, newest_day=FRI, is_trading_day=WEEKDAYS) == []


def test_the_cluster_carries_roles_that_add_up_totals_and_an_average_from_priced_buys_only():
    recs = [rec("c1", [ANNA], [(1000, 12.5, "2031-03-10")]), rec("c2", [BRAM], [(400, 12.0, "2031-03-11"), (100, None, "2031-03-12")]),
            rec("c3", [CORA], [(2000, 13.0, "2031-03-13")]), rec("c4", [DOV], [(500, 12.0, "2031-03-13")])]
    (c,) = ics.find_clusters(recs, newest_day=FRI, is_trading_day=WEEKDAYS)
    assert c["insiders"] == 4 and sum(c["roles"].values()) == 4
    assert {k: v for k, v in c["roles"].items() if v} == {"ceo": 1, "cfo": 1, "director": 2}
    assert [p["role"] for p in c["people"]] == ["ceo", "cfo", "director", "director"]
    assert c["shares"] == 4000.0
    assert c["value"] == 12500.0 + 4800.0 + 26000.0 + 6000.0
    assert c["avg_price"] == round(49300.0 / 3900.0, 4)
    assert (c["value_complete"], c["unpriced_buys"]) == (False, 1)
    assert c["last_filed"] == "2031-03-13" and c["url"].endswith("/c4")          # the newest filing's page


def test_clusters_are_newest_last_buy_first():
    a = [rec(f"q{i}", [p], [(1, 10.0, d)]) for i, (p, d) in enumerate([(ANNA, "2031-03-03"), (BRAM, "2031-03-04"), (CORA, "2031-03-05")])]
    b = [rec(f"k{i}", [p], [(1, 10.0, d)], issuer=KESTREL) for i, (p, d) in enumerate([(ANNA, "2031-03-10"), (BRAM, "2031-03-11"), (CORA, "2031-03-12")])]
    assert [c["ticker"] for c in ics.find_clusters(a + b, newest_day=FRI, is_trading_day=WEEKDAYS)] == ["KWZP", "QFRB"]


def test_the_held_close_gives_the_change_since_the_average_and_is_never_invented():
    clusters = [{"ticker": "QFRB", "avg_price": 12.5}, {"ticker": None, "avg_price": 4.0},
                {"ticker": "KWZP", "avg_price": 7.0}, {"ticker": "VLMQ", "avg_price": 4.0}, {"ticker": "JQZV", "avg_price": None}]
    closes = {"QFRB": (13.75, FRI), "VLMQ": (5.0, "2031-03-01"), "JQZV": (2.0, FRI)}
    ics.attach_closes(clusters, FRI, lambda t: closes.get(t))
    assert clusters[0]["close"] == {"value": 13.75, "date": FRI, "reason": None} and clusters[0]["change_pct"] == 10.0
    assert clusters[1]["close"]["reason"] == "no_ticker" and clusters[1]["change_pct"] is None
    assert clusters[2]["close"] == {"value": None, "date": None, "reason": "not_held"}
    assert clusters[3]["close"] == {"value": None, "date": "2031-03-01", "reason": "stale"} and clusters[3]["change_pct"] is None
    assert clusters[4]["close"]["value"] == 2.0 and clusters[4]["change_pct"] is None


def test_the_cluster_rule_constants_are_the_stated_ones():
    assert (ics.CLUSTER_MIN_INSIDERS, ics.CLUSTER_WINDOW_DAYS, ics.MAX_CLUSTERS) == (3, 10, 50)
    assert (ics.KEEP_DAYS, ics.SCAN_WEEKDAYS, ics.MAX_FILINGS_PER_RUN, ics.MAX_TRIES) == (30, 12, 15_000, 3)
    assert ics.RULES["min_insiders"] == 3 and ics.RULES["window_business_days"] == 10


# ── the night ──────────────────────────────────────────────────────────────────────────────────

def _night(fake, monkeypatch, store=None, now=NIGHT):
    monkeypatch.setattr(ics, "_sec_get", fake)
    return ics.build(store if store is not None else ics._empty_store(), now=now)


def test_the_first_night_reads_every_index_of_the_window_and_each_form_4_once_keeping_purchases_only(monkeypatch):
    fake = FakeSec()
    quill_cluster_days(fake)
    store, summary = _night(fake, monkeypatch)
    want_days = [d.isoformat() for d in ics.scan_days(NIGHT.date())]
    assert want_days[0] == FRI and want_days[-1] == "2031-02-27" and len(want_days) == 12
    assert fake.indexes() == [ics.index_url(date.fromisoformat(d)) for d in want_days]
    assert fake.docs() == [doc_url(QUILL[0], "0001234567-31-000103"), doc_url(VELLUM[0], "0001234567-31-000104"),
                           doc_url(KESTREL[0], "0001234567-31-000105"), doc_url(QUILL[0], "0001234567-31-000102"),
                           doc_url(QUILL[0], "0001234567-31-000101")]                 # newest day first, once each
    assert all("000999" not in u and "S-3" not in u for u in fake.calls)            # the amendment and the shelf are never read
    assert sorted(store["buys"]) == ["0001234567-31-000101", "0001234567-31-000102", "0001234567-31-000103", "0001234567-31-000104"]
    friday = store["days"][FRI]
    assert {k: friday[k] for k in ("state", "listed", "read", "unreadable", "given_up", "purchases", "index_error")} == {
        "state": "complete", "listed": 3, "read": 3, "unreadable": 0, "given_up": 0, "purchases": 2, "index_error": None}
    assert store["days"]["2031-03-11"]["state"] == "no_index"                        # no index that day: a 404, said
    assert summary["stop"] is None and summary["documents"] == 5 and summary["index_reads"] == 12
    # the second night reads the indexes again and no document twice
    fake.calls.clear()
    store, summary = _night(fake, monkeypatch, store)
    assert len(fake.indexes()) == 12 and fake.docs() == [] and summary["documents"] == 0


def test_the_answer_has_the_cluster_its_close_and_says_the_read_is_complete(monkeypatch):
    fake = FakeSec()
    quill_cluster_days(fake)
    store, summary = _night(fake, monkeypatch)
    held = ics.assemble(store, today=NIGHT.date(), summary=summary, read_close=lambda t: {"QFRB": (13.75, FRI)}.get(t))
    assert held["as_of"] == FRI and held["source"] == "SEC Form 4 filings (open-market purchases)"
    (c,) = held["clusters"]
    assert (c["ticker"], c["company"], c["insiders"], c["first_buy"], c["last_buy"]) == ("QFRB", QUILL[1], 3, "2031-03-10", "2031-03-13")
    assert {k: v for k, v in c["roles"].items() if v} == {"ceo": 1, "cfo": 1, "director": 1}
    assert c["value"] == 12500.0 + 4800.0 + 26000.0 and c["value_complete"] is False
    assert c["close"]["value"] == 13.75 and c["change_pct"] == round((13.75 / c["avg_price"] - 1) * 100, 2)
    assert held["coverage"]["complete"] is True and held["coverage"]["listed"] == held["coverage"]["read"] == 5
    assert (held["total"], held["truncated"], held["cut_from"]) == (1, False, None)


def test_the_cap_ends_the_run_and_the_filings_past_it_are_read_the_next_night(monkeypatch):
    monkeypatch.setattr(ics, "MAX_FILINGS_PER_RUN", 2)
    fake = FakeSec()
    quill_cluster_days(fake)
    store, summary = _night(fake, monkeypatch)
    assert summary["stop"] == "cap" and summary["documents"] == 2 and len(fake.docs()) == 2
    assert store["days"][FRI]["state"] == "partial" and store["days"][FRI]["read"] == 2
    assert store["days"]["2031-03-12"]["state"] == "unread"                          # not reached: said, not dropped
    held = ics.assemble(store, today=NIGHT.date(), summary=summary)
    assert held["coverage"]["complete"] is False and held["last_run"]["stop"] == "cap"
    fake.calls.clear()
    store, summary = _night(fake, monkeypatch, store)                               # the next night carries on
    assert summary["documents"] == 2 and store["days"][FRI]["state"] == "complete"
    fake.calls.clear()
    store, summary = _night(fake, monkeypatch, store)
    assert summary["documents"] == 1 and all(store["days"][d]["state"] in ("complete", "no_index") for d in store["days"])


def test_a_refusal_stops_the_whole_run_at_once_and_a_later_night_tries_again(monkeypatch):
    fake = FakeSec()
    quill_cluster_days(fake)
    fake.routes[doc_url(QUILL[0], "0001234567-31-000103")] = SecError("u", 403, "forbidden")
    store, summary = _night(fake, monkeypatch)
    assert (summary["stop"], summary["http_status"]) == ("refused", 403)
    assert len(fake.calls) == 2                                                      # Friday's index, then the refused filing
    assert store["days"]["2031-03-13"]["state"] == "unread"
    fake.routes[doc_url(QUILL[0], "0001234567-31-000103")] = submission(
        "0001234567-31-000103", QUILL, [CORA], [buy(2000, 13.0, "2031-03-13")])
    store, summary = _night(fake, monkeypatch, store)
    assert summary["stop"] is None and "0001234567-31-000103" in store["buys"]


def test_too_many_requests_on_an_index_stops_the_run(monkeypatch):
    fake = FakeSec()
    quill_cluster_days(fake)
    fake.routes[ics.index_url(date(2031, 3, 14))] = SecError("u", 429, "slow down")
    store, summary = _night(fake, monkeypatch)
    assert (summary["stop"], summary["http_status"]) == ("rate_limited", 429) and len(fake.calls) == 1
    assert store["days"][FRI]["state"] == "failed" and store["days"][FRI]["index_error"] == "sec_429"


def test_a_failing_filing_is_tried_on_three_nights_then_given_up_and_counted(monkeypatch):
    fake = FakeSec()
    quill_cluster_days(fake)
    bad = doc_url(KESTREL[0], "0001234567-31-000105")
    fake.routes[bad] = SecError(bad, 503, "unavailable")
    store = ics._empty_store()
    for night in range(1, 5):
        fake.calls.clear()
        store, summary = _night(fake, monkeypatch, store)
        assert fake.calls.count(bad) == (1 if night <= 3 else 0), night
    assert store["days"][FRI]["given_up"] == 1 and store["days"][FRI]["state"] == "complete"
    assert ics.coverage(store, NIGHT.date())["given_up"] == 1


def test_failed_reads_in_a_row_end_the_run(monkeypatch):
    monkeypatch.setattr(ics, "STOP_AFTER_FAILURES", 3)
    fake = FakeSec()
    filings = [(f"0001234567-31-0002{i:02d}", QUILL, [ANNA], [buy(1, 10.0, FRI)]) for i in range(6)]
    day_with(fake, FRI, filings)
    for acc, *_ in filings:
        fake.routes[doc_url(QUILL[0], acc)] = SecError("u", 500, "server error")
    store, summary = _night(fake, monkeypatch)
    assert summary["stop"] == "failures" and len(fake.docs()) == 3


def test_a_submission_that_is_not_a_form_4_document_is_counted_once_and_not_read_again(monkeypatch):
    fake = FakeSec()
    day_with(fake, FRI, [("0001234567-31-000301", QUILL, [ANNA], [buy(1, 10.0, FRI)])])
    fake.routes[doc_url(QUILL[0], "0001234567-31-000301")] = b"<SEC-DOCUMENT>\n<DOCUMENT>\n<TYPE>4\n<TEXT>\npaper\n</TEXT>\n</DOCUMENT>"
    store, _ = _night(fake, monkeypatch)
    assert store["days"][FRI]["unreadable"] == 1 and store["days"][FRI]["state"] == "complete"
    fake.calls.clear()
    _night(fake, monkeypatch, store)
    assert fake.docs() == []


def test_the_budget_ends_the_run_before_any_request(monkeypatch):
    monkeypatch.setattr(ics, "RUN_BUDGET_S", -1.0)
    fake = FakeSec()
    quill_cluster_days(fake)
    _store, summary = _night(fake, monkeypatch)
    assert summary["stop"] == "time" and fake.calls == []


def test_thirty_days_are_kept_and_a_day_out_of_the_window_keeps_its_counts_not_its_ledger(monkeypatch):
    fake = FakeSec()
    quill_cluster_days(fake)
    store, _ = _night(fake, monkeypatch)
    assert "seen" in store["days"]["2031-03-10"]
    later = NIGHT + timedelta(days=21)                                               # Sat Apr 5
    store, _ = _night(FakeSec(), monkeypatch, store, now=later)
    assert "seen" not in store["days"]["2031-03-10"] and store["days"]["2031-03-10"]["read"] == 1
    assert "0001234567-31-000101" in store["buys"]
    store, _ = _night(FakeSec(), monkeypatch, store, now=NIGHT + timedelta(days=40))
    assert "2031-03-10" not in store["days"] and "0001234567-31-000101" not in store["buys"]


def test_the_most_requests_a_night_can_make_is_the_window_plus_the_cap(monkeypatch):
    monkeypatch.setattr(ics, "MAX_FILINGS_PER_RUN", 4)
    fake = FakeSec()
    for back in range(12):
        day = ics.scan_days(NIGHT.date())[back].isoformat()
        day_with(fake, day, [(f"0001234567-31-{back:02d}{i:04d}", QUILL, [ANNA], [buy(1, 10.0, day)]) for i in range(3)])
    _store, summary = _night(fake, monkeypatch)
    assert len(fake.calls) <= ics.SCAN_WEEKDAYS + ics.MAX_FILINGS_PER_RUN
    assert len(fake.docs()) == 4 and summary["stop"] == "cap"


# ── the holding pattern ────────────────────────────────────────────────────────────────────────

def test_nothing_held_is_not_built_and_no_request_ever_reads_the_sec(monkeypatch):
    fake = FakeSec()
    monkeypatch.setattr(ics, "_sec_get", fake)
    got = ics.get_clusters()
    assert got["status"] == "not_built" and got["building"] is False and fake.calls == []
    assert got["source"] == "SEC Form 4 filings (open-market purchases)"
    assert ics.held_answer() == (None, "not_held") and fake.calls == []


def test_the_next_run_is_tuesday_to_saturday_at_the_slot():
    assert ics.RUN_AT_ET == (1, 20)
    # not one of the other jobs' slots
    assert ics.RUN_AT_ET not in {(16, 35), (16, 45), (21, 0), (8, 0), (8, 15), (3, 30)}
    sunday = datetime(2031, 3, 16, 9, 0, tzinfo=NY)
    assert ics.next_run(sunday) == datetime(2031, 3, 18, 1, 20, tzinfo=NY)          # Tuesday
    friday_night = datetime(2031, 3, 14, 23, 0, tzinfo=NY)
    assert ics.next_run(friday_night) == datetime(2031, 3, 15, 1, 20, tzinfo=NY)    # Saturday
    assert ics.next_run(datetime(2031, 3, 15, 1, 20, tzinfo=NY)) == datetime(2031, 3, 18, 1, 20, tzinfo=NY)


def _wait():
    ev = ics._state["inflight"]
    if ev is not None:
        assert ev.wait(10)


def test_one_run_at_a_time_then_the_answer_is_held_and_a_restart_reads_it_from_disk(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    fake = FakeSec()
    quill_cluster_days(fake)
    gate = threading.Event()
    friday = ics.index_url(date(2031, 3, 14))
    body = fake.routes[friday]
    fake.routes[friday] = lambda: (gate.wait(10), body)[1]
    monkeypatch.setattr(ics, "_sec_get", fake)
    assert ics.run_nightly(NIGHT) == {"started": True}
    assert ics.run_nightly(NIGHT) == {"started": False, "reason": "running"}
    got = ics.get_clusters()
    assert got["status"] == "not_built" and got["building"] is True
    gate.set()
    _wait()
    got = ics.get_clusters()
    assert got["status"] == "ok" and got["building"] is False and [c["ticker"] for c in got["clusters"]] == ["QFRB"]
    assert (tmp_path / "insider_clusters_sec" / "store_v1.json").exists()
    # a restart answers from disk, and reading it asks the SEC nothing
    ics.reset_for_tests()
    fake.calls.clear()
    again = ics.get_clusters()
    assert again["status"] == "ok" and [c["ticker"] for c in again["clusters"]] == ["QFRB"] and fake.calls == []


def test_a_failed_run_keeps_the_last_good_answer(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    fake = FakeSec()
    quill_cluster_days(fake)
    monkeypatch.setattr(ics, "_sec_get", fake)
    ics.run_nightly(NIGHT)
    _wait()
    before = ics.get_clusters()
    monkeypatch.setattr(ics, "build", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("invented")))
    ics.run_nightly(NIGHT)
    _wait()
    after = ics.get_clusters()
    assert after["status"] == "ok" and after["clusters"] == before["clusters"] and after["read_at"] == before["read_at"]


def test_held_answer_never_starts_a_run(monkeypatch):
    started = []
    monkeypatch.setattr(ics, "run_nightly", lambda *a, **k: started.append(1))
    monkeypatch.setattr(ics, "_sec_get", FakeSec())
    ics.held_answer()
    ics.get_clusters()
    assert started == [] and ics._state["inflight"] is None


def test_a_disk_copy_of_another_version_is_not_read(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    path = tmp_path / "insider_clusters_sec" / "store_v1.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({"store": {"v": 99, "days": {}, "buys": {}}, "held": {"v": 99, "clusters": []}}), encoding="utf-8")
    assert ics.get_clusters()["status"] == "not_built"


def test_the_answer_is_bounded_and_says_it_was_cut_from_the_oldest_end(monkeypatch):
    monkeypatch.setattr(ics, "MAX_CLUSTERS", 2)
    store = ics._empty_store()
    store["days"][FRI] = ics._new_day() | {"state": "complete", "listed": 9, "read": 9}
    for n, (cik, last) in enumerate([("0009900011", "2031-03-12"), ("0009900012", "2031-03-13"), ("0009900013", "2031-03-14")]):
        issuer = (cik, f"Invented Issuer {n}", f"ZQX{chr(65 + n)}")
        for i, p in enumerate([ANNA, BRAM, CORA]):
            store["buys"][f"{cik}-{i}"] = rec(f"{cik}-{i}", [p], [(1, 10.0, last)], issuer=issuer, filed=FRI)
    held = ics.assemble(store, today=NIGHT.date())
    assert [c["ticker"] for c in held["clusters"]] == ["ZQXC", "ZQXB"]
    assert (held["total"], held["truncated"], held["cut_from"]) == (3, True, "oldest")


# ── the route ──────────────────────────────────────────────────────────────────────────────────

def _client(user):
    app = FastAPI()
    app.include_router(route.router)
    if user is not None:
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app, raise_server_exceptions=False)


def test_the_route_is_one_paid_get_and_a_refused_caller_never_reaches_the_service(monkeypatch):
    asked = []
    monkeypatch.setattr(ics, "get_clusters", lambda: asked.append(1) or {"status": "ok", "clusters": []})
    monkeypatch.setattr(route, "get_insider_activity", lambda sym: pytest.fail(f"read as a ticker: {sym}"))
    (r,) = [x for x in route.router.routes if x.path == "/api/insider/clusters"]
    assert r.methods == {"GET"} and route.require_paid in {d.call for d in r.dependant.dependencies}
    assert route.require_paid.__module__ == "api.routers.insider"
    assert _client(None).get("/api/insider/clusters").status_code == 401
    refused = _client(FREE_USER).get("/api/insider/clusters")
    assert refused.status_code == 402 and refused.json() == {"detail": "Insider activity requires a paid plan"}
    assert asked == []
    assert _client(PAID_USER).get("/api/insider/clusters").json() == {"status": "ok", "clusters": []}
    assert asked == [1]


def test_the_route_sits_above_the_ticker_route_and_is_a_plain_def():
    paths = [x.path for x in route.router.routes]
    assert paths.index("/api/insider/clusters") < paths.index("/api/insider/{ticker}")
    assert not inspect.iscoroutinefunction(route.insider_clusters)
    main = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
    assert "from api.routers import insider as insider_router" in main
    assert "app.include_router(insider_router.router)" in main


def test_the_nightly_read_is_registered_tuesday_to_saturday_at_the_modules_slot():
    main = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
    at = main.index('id="insider_clusters_sec_nightly"')
    block = main[main.rindex("def _insider_clusters_sec_job", 0, at):at]
    assert "run_nightly()" in block and 'day_of_week="tue-sat"' in block
    assert "hour=_ics_mod.RUN_AT_ET[0]" in block and "minute=_ics_mod.RUN_AT_ET[1]" in block and "timezone=_ET" in block


# ── the catch-up: a fire lost to a restart heals itself ─────────────────────────────────────────

SAT_READ = datetime(2031, 3, 15, 1, 47, tzinfo=NY)        # Saturday's read finished at 01:47
TUE = datetime(2031, 3, 18, 1, 20, tzinfo=NY)             # the next slot after it


def _held_at(moment: datetime) -> dict:
    """A held answer built at `moment`, its `read_at` written the way `assemble` writes it."""
    return {"v": ics.DISK_VERSION, "clusters": [], "read_at": moment.astimezone(timezone.utc).isoformat(timespec="seconds")}


def test_the_last_slot_is_stepped_from_next_run_across_the_weekend_and_the_0120_boundary():
    assert ics.last_slot(NIGHT) == NIGHT                                                    # at 01:20 the slot has come
    assert ics.last_slot(NIGHT - timedelta(seconds=1)) == datetime(2031, 3, 14, 1, 20, tzinfo=NY)   # Friday's
    assert ics.last_slot(datetime(2031, 3, 16, 12, 0, tzinfo=NY)) == NIGHT                 # Sunday has no slot
    assert ics.last_slot(datetime(2031, 3, 17, 23, 59, tzinfo=NY)) == NIGHT                # nor Monday
    assert ics.last_slot(TUE - timedelta(seconds=1)) == NIGHT and ics.last_slot(TUE) == TUE
    assert ics.last_slot(datetime(2031, 3, 16, 16, 0, tzinfo=timezone.utc)) == NIGHT       # a UTC moment: the same slot
    # every moment of three weeks (across the March clock change): a scheduled slot, at or before it, none between
    t = datetime(2031, 3, 1, 0, 7, tzinfo=NY)
    while t < datetime(2031, 3, 22, tzinfo=NY):
        s = ics.last_slot(t)
        assert s <= t < ics.next_run(s) and ics.next_run(t) == ics.next_run(s), t
        assert s.weekday() in (1, 2, 3, 4, 5) and (s.hour, s.minute) == ics.RUN_AT_ET, t
        t += timedelta(minutes=37)


def test_behind_with_nothing_held_is_the_first_read():
    assert ics.behind(None, datetime(2031, 3, 16, 12, 0, tzinfo=NY)) is True


def test_a_held_answer_built_after_the_last_slot_is_current_and_one_built_before_it_is_behind():
    sunday = datetime(2031, 3, 16, 12, 0, tzinfo=NY)
    assert ics.behind(_held_at(SAT_READ), sunday) is False                                  # Saturday's read ran
    assert ics.behind(_held_at(SAT_READ - timedelta(days=1)), sunday) is True               # Saturday's fire was lost


def test_over_the_weekend_saturdays_read_is_current_until_tuesdays_slot_and_not_a_second_longer():
    held = _held_at(SAT_READ)
    for now in (datetime(2031, 3, 16, 0, 0, tzinfo=NY), datetime(2031, 3, 17, 23, 59, tzinfo=NY), TUE - timedelta(seconds=1)):
        assert ics.behind(held, now) is False, now
    assert ics.behind(held, TUE) is True


def test_the_0120_boundary_on_the_reads_side():
    later = TUE + timedelta(minutes=5)
    assert ics.behind(_held_at(TUE - timedelta(seconds=1)), later) is True
    assert ics.behind(_held_at(TUE), later) is False


@pytest.mark.parametrize("read_at", [None, "", "yesterday", "2031-03-15T01:47:00"])      # the last names no zone
def test_a_held_answer_whose_build_time_is_not_a_moment_reads_as_behind(read_at):
    assert ics.behind({"v": ics.DISK_VERSION, "clusters": [], "read_at": read_at}, datetime(2031, 3, 16, 12, tzinfo=NY)) is True


def test_behind_reads_the_build_time_assemble_writes():
    held = ics.assemble(ics._empty_store(), today=NIGHT.date())
    built = datetime.fromisoformat(held["read_at"])
    assert ics.behind(held, built) is False
    assert ics.behind(held, built + timedelta(days=7)) is True                              # a week holds five slots


def _stub_run(monkeypatch) -> list:
    started: list = []
    monkeypatch.setattr(ics, "run_nightly", lambda now=None: started.append(now) or {"started": True})
    return started


def test_the_catch_up_starts_the_run_when_nothing_is_held_and_asks_the_sec_nothing_itself(monkeypatch):
    fake = FakeSec()
    monkeypatch.setattr(ics, "_sec_get", fake)
    started = _stub_run(monkeypatch)
    assert ics.catch_up(NIGHT) == {"started": True}
    assert started == [NIGHT] and fake.calls == []


def test_after_a_restart_the_catch_up_reads_the_disk_copy_and_starts_the_run_only_once_behind(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    ics._save_disk(ics._empty_store(), _held_at(SAT_READ))
    ics.reset_for_tests()                                                                   # a new process
    fake = FakeSec()
    monkeypatch.setattr(ics, "_sec_get", fake)
    started = _stub_run(monkeypatch)
    assert ics.catch_up(datetime(2031, 3, 17, 9, 0, tzinfo=NY)) == {"started": False, "reason": "current"}   # Monday
    assert started == [] and fake.calls == []
    tuesday = TUE + timedelta(minutes=10)                                                   # Tuesday's fire was lost
    assert ics.catch_up(tuesday) == {"started": True} and started == [tuesday]


def test_a_boot_during_market_hours_while_behind_starts_nothing_and_asks_the_sec_nothing(monkeypatch):
    # member speed first: behind, but inside the weekday busy span, the catch-up starts no SEC read; the hourly
    # checks and the next boot in the quiet hours start it
    fake = FakeSec()
    monkeypatch.setattr(ics, "_sec_get", fake)
    started = _stub_run(monkeypatch)
    for now in (datetime(2031, 3, 18, 10, 0, tzinfo=NY),                  # a Tuesday morning: nothing held
                datetime(2031, 3, 18, 7, 0, tzinfo=NY),                   # the first minute of the busy span
                datetime(2031, 3, 18, 20, 14, tzinfo=NY)):                # its last minute
        assert ics.behind(None, now) is True
        assert ics.catch_up(now) == {"started": False, "reason": "not_quiet"}, now
    assert started == [] and fake.calls == []


@pytest.mark.parametrize("now", [datetime(2031, 3, 18, 21, 0, tzinfo=NY),   # a weekday evening
                                 datetime(2031, 3, 18, 3, 0, tzinfo=NY),    # a weekday night
                                 datetime(2031, 3, 18, 20, 15, tzinfo=NY),  # the quiet span's first minute
                                 datetime(2031, 3, 16, 12, 0, tzinfo=NY)])  # a Sunday noon: quiet all day
def test_the_same_catch_up_in_the_quiet_span_starts_the_run(monkeypatch, now):
    started = _stub_run(monkeypatch)
    assert ics.catch_up(now) == {"started": True} and started == [now]


def test_the_catch_up_reads_scan_periods_own_quiet_span(monkeypatch):
    from api.services import scan_period
    started = _stub_run(monkeypatch)
    seen = []
    monkeypatch.setattr(scan_period, "_reuse_quiet_now", lambda now=None: seen.append(now) or False)
    night = datetime(2031, 3, 18, 3, 0, tzinfo=timezone.utc)             # read in New York time, never retyped
    assert ics.catch_up(night) == {"started": False, "reason": "not_quiet"} and started == []
    assert seen == [night.astimezone(NY)] and seen[0].tzinfo == NY


def test_the_catch_up_never_starts_a_second_run(monkeypatch):
    started = _stub_run(monkeypatch)
    ics._state["inflight"] = threading.Event()                    # the 01:20 run, or another catch-up, is reading
    assert ics.catch_up(NIGHT) == {"started": False, "reason": "running"} and started == []


def test_the_catch_up_runs_the_real_nightly_read_once_and_is_current_after_it(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    fake = FakeSec()
    quill_cluster_days(fake)
    gate = threading.Event()
    friday = ics.index_url(date(2031, 3, 14))
    body = fake.routes[friday]
    fake.routes[friday] = lambda: (gate.wait(10), body)[1]
    monkeypatch.setattr(ics, "_sec_get", fake)
    assert ics.catch_up(NIGHT) == {"started": True}
    assert ics.catch_up(NIGHT) == {"started": False, "reason": "running"}
    assert ics.run_nightly(NIGHT) == {"started": False, "reason": "running"}                # the scheduled fire too
    gate.set()
    _wait()
    held = ics._state["held"]
    assert held is not None and [c["ticker"] for c in held["clusters"]] == ["QFRB"]
    asked = len(fake.calls)
    assert ics.catch_up(datetime.fromisoformat(held["read_at"])) == {"started": False, "reason": "current"}
    assert len(fake.calls) == asked


def test_no_member_request_reaches_the_catch_up(monkeypatch):
    monkeypatch.setattr(ics, "catch_up", lambda *a, **k: pytest.fail("a read path started the catch-up"))
    monkeypatch.setattr(ics, "run_nightly", lambda *a, **k: pytest.fail("a read path started the run"))
    monkeypatch.setattr(ics, "_sec_get", FakeSec())
    ics.get_clusters()
    ics.held_answer()
    ics.held_purchases(NIGHT.date())
    assert _client(PAID_USER).get("/api/insider/clusters").json()["status"] == "not_built"
    assert "catch_up" not in inspect.getsource(route)


def _lifespan():
    src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
    life = next(n for n in ast.parse(src).body if isinstance(n, ast.AsyncFunctionDef) and n.name == "lifespan")
    return src, life


def _add_jobs(life) -> dict:
    """{job id: its `add_job(...)` call} for every add_job in the lifespan that names a literal id."""
    out = {}
    for c in ast.walk(life):
        if isinstance(c, ast.Call) and getattr(c.func, "attr", "") == "add_job":
            for kw in c.keywords:
                if kw.arg == "id" and isinstance(kw.value, ast.Constant):
                    out[kw.value.value] = c
    return out


def _kw(call, name):
    return next((kw.value for kw in call.keywords if kw.arg == name), None)


def _lit(call, name):
    node = _kw(call, name)
    return ast.literal_eval(node) if node is not None else None


def test_the_nightly_job_carries_an_hours_grace_so_a_busy_scheduler_does_not_drop_the_night():
    job = _add_jobs(_lifespan()[1])["insider_clusters_sec_nightly"]
    assert (_lit(job, "misfire_grace_time"), _lit(job, "coalesce"), _lit(job, "max_instances")) == (3600, True, 1)


def test_the_catch_up_is_a_date_job_after_boot_and_an_hourly_check_both_calling_the_modules_catch_up():
    src, life = _lifespan()
    jobs = _add_jobs(life)
    boot, hourly = jobs["insider_clusters_sec_catchup_boot"], jobs["insider_clusters_sec_catchup"]
    assert "from api.services import insider_clusters_sec as _ics_cu" in src
    defs = {n.name: n for n in ast.walk(life) if isinstance(n, ast.FunctionDef)}
    for call in (boot, hourly):
        fn = call.args[0]
        assert isinstance(fn, ast.Name) and fn.id in defs
        body = ast.get_source_segment(src, defs[fn.id])
        assert ".catch_up()" in body and "run_nightly" not in body
    assert _lit(boot, "trigger") == "date" and _lit(boot, "kwargs") == {"source": "boot"}
    run_date = ast.unparse(_kw(boot, "run_date"))
    assert "now(_ET)" in run_date and "seconds=_ics_cu.CATCHUP_BOOT_DELAY_S" in run_date
    assert _lit(boot, "max_instances") == 1 and _lit(boot, "misfire_grace_time") >= 60
    # every day (`behind` knows the schedule; it is never retyped here)
    assert ast.unparse(_kw(hourly, "trigger")) == (
        "CronTrigger(hour=_ics_cu.CATCHUP_HOURS_ET, minute=_ics_cu.CATCHUP_MINUTE_ET, timezone=_ET)")
    assert _lit(hourly, "kwargs") == {"source": "hourly"}
    assert (_lit(hourly, "coalesce"), _lit(hourly, "max_instances")) == (True, 1) and _lit(hourly, "misfire_grace_time") >= 60


def test_the_catch_up_never_runs_inline_in_the_boot():
    src, life = _lifespan()
    at_boot: list[str] = []

    def walk(node, nested):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                walk(child, True)
                continue
            if isinstance(child, ast.Call) and not nested:
                at_boot.append(getattr(child.func, "attr", None) or getattr(child.func, "id", None) or "")
            walk(child, nested)

    walk(life, False)
    assert "_boot_mark" in at_boot and "add_job" in at_boot                 # control: the walk sees the boot's own calls
    ran = {"catch_up", "run_nightly", "_insider_clusters_sec_catch_up_job", "_insider_clusters_sec_job"} & set(at_boot)
    assert ran == set(), ran


def test_the_catch_up_registration_has_its_own_boot_mark():
    _src, life = _lifespan()
    marks = sorted((c.lineno, c.args[0].value) for c in ast.walk(life)
                   if isinstance(c, ast.Call) and getattr(c.func, "id", "") == "_boot_mark")
    names = [n for _, n in marks]
    assert names.count("INS-catch-up") == 1
    i = names.index("INS-catch-up")
    jobs = _add_jobs(life)
    for jid in ("insider_clusters_sec_catchup_boot", "insider_clusters_sec_catchup"):
        assert marks[i][0] < jobs[jid].lineno < marks[i + 1][0], jid


def test_the_hourly_check_comes_after_the_nightly_budget_and_before_the_weekday_busy_span():
    from apscheduler.triggers.cron import CronTrigger
    trig = CronTrigger(hour=ics.CATCHUP_HOURS_ET, minute=ics.CATCHUP_MINUTE_ET, timezone=NY)
    day = datetime(2031, 3, 18, 0, 0, tzinfo=NY)
    fires, t = [], trig.get_next_fire_time(None, day)
    while t < day + timedelta(days=1):
        fires.append(t)
        t = trig.get_next_fire_time(t, t + timedelta(seconds=1))
    budget_ends = day.replace(hour=ics.RUN_AT_ET[0], minute=ics.RUN_AT_ET[1]) + timedelta(seconds=ics.RUN_BUDGET_S)
    assert len(fires) >= 3 and all(budget_ends <= f and f.hour < 7 for f in fires), fires
    assert ics.CATCHUP_BOOT_DELAY_S >= 300                                   # past the boot's busiest minutes
