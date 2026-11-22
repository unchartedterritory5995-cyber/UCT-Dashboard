"""Funds (N-PORT) on OWN: the SEC's quarterly Form N-PORT data sets read into a per-stock index of fund holders.

Every fund, trust, company, ticker, CUSIP, accession number and figure here is INVENTED, written in the layout the
SEC's N-PORT readme gives (tab-delimited tables, the column names of its table definitions). SEC is never reached:
the downloads and the SEC reads are replaced by name.
"""
from __future__ import annotations

import io
import json
import os
import shutil
import sqlite3
import zipfile
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import fund_holders_nport as M
from api.services import fund_holders_nport_data as D
from api.services.fundamentals_pit.sec_client import SecError

ET = ZoneInfo("America/New_York")
QUIET_NOW = datetime(2031, 11, 22, 5, 50, tzinfo=ET)     # a Saturday morning: inside the quiet span

# ── the invented securities (check digits worked out below by a second, independent routine) ─────
CUS_A = "98765X106"   # ZQAA: funds report its ticker
CUS_B = "98765Y104"   # ZQBB: no ticker reported; the SEC company name matches one ticker
CUS_C = "98765Z101"   # ZQCC: the held fails-to-deliver pair says ZQCC; one fund typed ZQCX
CUS_D = "98766A105"   # ZQDD: reached only through a US ISIN
CUS_E = "G12345677"   # a non-US issue: its name matches an SEC company name, but names are used for US issues only
CUS_G1 = "98766B103"  # ZQGG, three funds report it
CUS_G2 = "98766C101"  # also reported as ZQGG once: the conflict loser
CUS_J = "98766D109"   # ZQJJ-B, typed "ZQJJ B"


def _independent_check_digit(base8: str) -> int:
    vals = []
    for i, ch in enumerate(base8):
        v = int(ch) if ch.isdigit() else ord(ch) - ord("A") + 10
        v = v * 2 if i % 2 else v
        vals.extend(int(d) for d in str(v))
    return (10 - sum(vals) % 10) % 10


# ── a miniature data set in the readme's layout ─────────────────────────────────────────────────

SUB_COLS = ["ACCESSION_NUMBER", "FILING_DATE", "FILE_NUM", "SUB_TYPE", "REPORT_ENDING_PERIOD", "REPORT_DATE",
            "IS_LAST_FILING"]
REG_COLS = ["ACCESSION_NUMBER", "CIK", "REGISTRANT_NAME", "FILE_NUM", "LEI", "ADDRESS1", "ADDRESS2", "CITY", "STATE",
            "COUNTRY", "ZIP", "PHONE"]
INFO_COLS = ["ACCESSION_NUMBER", "SERIES_NAME", "SERIES_ID", "SERIES_LEI", "TOTAL_ASSETS", "TOTAL_LIABILITIES",
             "NET_ASSETS"]
HOLD_COLS = ["ACCESSION_NUMBER", "HOLDING_ID", "ISSUER_NAME", "ISSUER_LEI", "ISSUER_TITLE", "ISSUER_CUSIP", "BALANCE",
             "UNIT", "OTHER_UNIT_DESC", "CURRENCY_CODE", "CURRENCY_VALUE", "EXCHANGE_RATE", "PERCENTAGE",
             "PAYOFF_PROFILE", "ASSET_CAT", "OTHER_ASSET", "ISSUER_TYPE", "OTHER_ISSUER", "INVESTMENT_COUNTRY",
             "IS_RESTRICTED_SECURITY", "FAIR_VALUE_LEVEL", "DERIVATIVE_CAT"]
ID_COLS = ["HOLDING_ID", "IDENTIFIERS_ID", "IDENTIFIER_ISIN", "IDENTIFIER_TICKER", "OTHER_IDENTIFIER",
           "OTHER_IDENTIFIER_DESC"]

FUNDS = {
    1: ("S000000001", "Larchmont Total Market Index Fund", "Larchmont Index Trust", "9000001"),
    2: ("S000000002", "Petrel Growth Fund", "Petrel Funds", "9000002"),
    3: ("S000000003", "Quarry Small Cap ETF", "Quarry ETF Trust", "9000003"),
    4: ("S000000004", "Tamsin Value Fund", "Tamsin Series Trust", "9000004"),
    5: ("S000000005", "Ostler Income Fund", "Ostler Funds", "9000005"),
}


def _acc(fund: int, n: int) -> str:
    return f"{9_000_000 + fund:010d}-31-{n:06d}"


def _row(cols, **kw):
    return [str(kw.get(c.lower(), "")) for c in cols]


def _tsv(cols, rows) -> str:
    return "\n".join(["\t".join(cols)] + ["\t".join(r) for r in rows]) + "\n"


def _holding(acc, hid, cusip, shares, value, name="Invented Issuer Inc", unit="NS", cat="EC", payoff="Long", pct=1.0):
    return _row(HOLD_COLS, accession_number=acc, holding_id=hid, issuer_name=name, issuer_cusip=cusip, balance=shares,
                unit=unit, currency_code="USD", currency_value=value, percentage=pct, payoff_profile=payoff,
                asset_cat=cat, issuer_type="CORP", investment_country="US")


def _ident(hid, n, isin="", ticker=""):
    return _row(ID_COLS, holding_id=hid, identifiers_id=n, identifier_isin=isin, identifier_ticker=ticker)


def _sub(acc, filed, rdate, kind="NPORT-P"):
    return _row(SUB_COLS, accession_number=acc, filing_date=filed, sub_type=kind, report_date=rdate)


def _reg_info(acc, fund, net=1_000_000.0):
    sid, name, family, cik = FUNDS[fund]
    return (_row(REG_COLS, accession_number=acc, cik=cik.zfill(10), registrant_name=family),
            _row(INFO_COLS, accession_number=acc, series_name=name, series_id=sid, net_assets=net))


def _zip_bytes(subs, regs, infos, holds, idents, *, folder="", lower=False, metadata=False, sniff=False) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        tables = {"SUBMISSION": (SUB_COLS, subs), "REGISTRANT": (REG_COLS, regs),
                  "FUND_REPORTED_INFO": (INFO_COLS, infos), "FUND_REPORTED_HOLDING": (HOLD_COLS, holds),
                  "IDENTIFIERS": (ID_COLS, idents)}
        meta = []
        for i, (t, (cols, rows)) in enumerate(tables.items()):
            fname = f"part{i}.tsv" if (metadata or sniff) else (t.lower() if lower else t) + ".tsv"
            meta.append({"url": fname, "tableSchema": {"columns": [{"name": c} for c in cols]}})
            zf.writestr(folder + fname, _tsv(cols, rows))
        if metadata:
            zf.writestr(folder + "nport_metadata.json", json.dumps({"tables": meta}))
    return buf.getvalue()


def q3_zip(**kw) -> bytes:
    """The newest data set: every fund's current report, fund 2's amendment, fund 3's previous report filed late."""
    subs = [
        _sub(_acc(1, 101), "20-AUG-2031", "30-JUN-2031"),
        _sub(_acc(2, 201), "25-SEP-2031", "31-JUL-2031"),
        _sub(_acc(2, 202), "28-SEP-2031", "31-JUL-2031", "NPORT-P/A"),
        _sub(_acc(3, 301), "29-SEP-2031", "31-AUG-2031"),
        _sub(_acc(3, 302), "15-JUL-2031", "31-MAY-2031"),
        _sub(_acc(4, 401), "25-AUG-2031", "30-JUN-2031"),
        _sub(_acc(5, 501), "26-AUG-2031", "30-JUN-2031"),
        _sub(_acc(5, 601), "27-AUG-2031", "31-JUL-2031", "NT NPORT-P"),
    ]
    pairs = [_reg_info(_acc(f, n), f) for f, n in ((1, 101), (2, 201), (2, 202), (3, 301), (3, 302), (4, 401),
                                                     (5, 501), (5, 601))]
    holds = [
        _holding(_acc(1, 101), 1001, CUS_A, 1000, 10_000, "Zephyr Quilt Aerospace Inc", pct=1.0),
        _holding(_acc(1, 101), 1002, CUS_B, 100, 5_000, "Zephyr Beacon Bioscience Corp", pct=0.5),
        _holding(_acc(1, 101), 1003, CUS_C, 50, 2_500, "Cobble Lane Foods Inc"),
        _holding(_acc(1, 101), 1004, CUS_E, 70, 700, "Ember Holdings PLC"),
        _holding(_acc(1, 101), 1005, CUS_A, 9_999, 9_999, "Zephyr Quilt Aerospace Inc", unit="PA", cat="DBT"),
        _holding(_acc(1, 101), 1006, CUS_A, 40, 400, "Zephyr Quilt Aerospace Inc", payoff="Short"),
        _holding(_acc(1, 101), 1007, CUS_G1, 10, 100, "Gannet Rail Corp"),
        _holding(_acc(2, 201), 2001, CUS_A, 400, 4_000, "Zephyr Quilt Aerospace Inc"),       # superseded
        _holding(_acc(2, 202), 2101, CUS_A, 500, 5_000, "Zephyr Quilt Aerospace Inc"),
        _holding(_acc(2, 202), 2102, CUS_G1, 20, 200, "Gannet Rail Corp"),
        _holding(_acc(2, 202), 2103, CUS_J, 30, 300, "Juniper Hollow Inc"),
        _holding(_acc(3, 301), 3001, CUS_A, 300, 3_000, "Zephyr Quilt Aerospace Inc"),
        _holding(_acc(3, 301), 3002, CUS_G2, 5, 50, "Gannet Rail Holdings"),
        _holding(_acc(3, 301), 3003, "N/A", 60, 600, "Dovetail Mills Inc"),
        _holding(_acc(3, 301), 3004, "", 15, 150, "Mystery Paper Co"),
        _holding(_acc(3, 301), 3005, CUS_G1, 15, 150, "Gannet Rail Corp"),
        _holding(_acc(3, 302), 3101, CUS_A, 450, 4_500, "Zephyr Quilt Aerospace Inc"),
        _holding(_acc(4, 401), 4001, CUS_A, 200, 2_000, "Zephyr Quilt Aerospace Inc"),
        _holding(_acc(5, 501), 5001, CUS_B, 10, 500, "Zephyr Beacon Bioscience Corp"),
    ]
    idents = [
        _ident(1001, 1, ticker="ZQAA"), _ident(1002, 2, isin="US98765Y1040"), _ident(1003, 3, ticker="ZQCX"),
        _ident(1007, 4, ticker="ZQGG"), _ident(2101, 5, ticker="ZQAA US"), _ident(2102, 6, ticker="ZQGG"),
        _ident(2103, 7, ticker="ZQJJ B"), _ident(3001, 8, ticker="ZQAA"), _ident(3002, 9, ticker="ZQGG"),
        _ident(3003, 10, isin="US98766A1050"), _ident(3003, 11, ticker="ZQDD"), _ident(3005, 12, ticker="ZQGG"),
        _ident(1006, 13, ticker="ZQAA"),
    ]
    return _zip_bytes(subs, [p[0] for p in pairs], [p[1] for p in pairs], holds, idents, **kw)


def q2_zip(**kw) -> bytes:
    """The data set before: funds 1, 2 and 5's previous reports, and an older report of fund 3 that is not used."""
    subs = [
        _sub(_acc(1, 11), "20-MAY-2031", "31-MAR-2031"),
        _sub(_acc(2, 21), "25-JUN-2031", "30-APR-2031"),
        _sub(_acc(5, 51), "26-MAY-2031", "31-MAR-2031"),
        _sub(_acc(3, 31), "28-APR-2031", "28-FEB-2031"),
    ]
    pairs = [_reg_info(_acc(f, n), f) for f, n in ((1, 11), (2, 21), (5, 51), (3, 31))]
    holds = [
        _holding(_acc(1, 11), 101, CUS_A, 800, 7_200, "Zephyr Quilt Aerospace Inc"),
        _holding(_acc(2, 21), 201, CUS_A, 500, 4_500, "Zephyr Quilt Aerospace Inc"),
        _holding(_acc(5, 51), 501, CUS_A, 700, 6_300, "Zephyr Quilt Aerospace Inc"),
        _holding(_acc(5, 51), 502, CUS_B, 10, 400, "Zephyr Beacon Bioscience Corp"),
        _holding(_acc(3, 31), 301, CUS_A, 999, 9_990, "Zephyr Quilt Aerospace Inc"),
    ]
    return _zip_bytes(subs, [p[0] for p in pairs], [p[1] for p in pairs], holds, [], **kw)


def _rewrite(body: bytes, member: str, old: str, new: str) -> bytes:
    """The same zip with one member's text changed."""
    src, out = zipfile.ZipFile(io.BytesIO(body)), io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst:
        for n in src.namelist():
            data = src.read(n)
            dst.writestr(n, data.replace(old.encode(), new.encode()) if n == member else data)
    return out.getvalue()


SEC_NAMES = {"ZEPHYR BEACON BIOSCIENCE": {"ZQBB"}, "EMBER HOLDINGS": {"ZQEE"}, "TWIN CLASS": {"ZQTA", "ZQTB"}}
FTD = {CUS_C: "ZQCC"}


def _builder(tmp_path, q3=None, q2=None, parts=None) -> dict:
    """The index from the two miniatures, built in its own folder; `stocks` reads the written file."""
    import tempfile
    d = tempfile.mkdtemp(dir=tmp_path)
    b = D.Builder(work_dir=os.path.join(d, "parts"), parts=parts)
    p3, p2 = os.path.join(d, "q3.zip"), os.path.join(d, "q2.zip")
    with open(p3, "wb") as fh:
        fh.write(q3 or q3_zip())
    with open(p2, "wb") as fh:
        fh.write(q2 or q2_zip())
    with zipfile.ZipFile(p3) as zf:
        b.add_current(zf)
    with zipfile.ZipFile(p2) as zf:
        b.add_prior(zf)
    return b.finish(os.path.join(d, "index.sqlite"), {"quarter": "2031Q3"}, ftd_pairs=FTD, sec_names=SEC_NAMES)


# ── helpers ─────────────────────────────────────────────────────────────────────────────────────

def test_cusip_check_digits_agree_with_an_independent_routine_and_placeholders_are_refused():
    for c in (CUS_A, CUS_B, CUS_C, CUS_D, CUS_G1, CUS_G2, CUS_J, CUS_E):
        assert D.cusip_check_digit(c[:8]) == _independent_check_digit(c[:8]) == int(c[8])
        assert D.valid_cusip(c.lower()) == c
    assert D.valid_cusip(CUS_A[:8] + "7") is None          # a wrong check digit
    assert D.valid_cusip("000000000") is None and D.valid_cusip("999999999") is None
    assert D.valid_cusip("N/A") is None and D.valid_cusip(None) is None
    assert D.cusip_from_isin("US98766A1050") == CUS_D and D.cusip_from_isin("GB98766A1050") is None


def test_fund_tickers_read_in_the_sites_spelling_and_junk_is_none():
    assert D.norm_ticker("ZQAA US") == "ZQAA"
    assert D.norm_ticker("ZQAA UW Equity") == "ZQAA"
    assert D.norm_ticker("NYSE: ZQAA") == "ZQAA"
    assert D.norm_ticker("ZQJJ B") == D.norm_ticker("ZQJJ/B") == D.norm_ticker("zqjj.b") == "ZQJJ-B"
    for junk in ("7203", "N/A", "None", "", None, "TOOLONGX", "-"):
        assert D.norm_ticker(junk) is None


def test_names_compare_in_a_plain_normal_form():
    assert D.norm_name("The Zephyr Beacon Bioscience, Corp. /DE/") == "ZEPHYR BEACON BIOSCIENCE"
    assert D.norm_name("Alder & Birch Co") == "ALDER AND BIRCH"


def test_dates_read_in_each_form_the_data_set_may_use():
    for raw in ("30-JUN-2031", "2031-06-30", "06/30/2031", "20310630", "2031-06-30 00:00:00"):
        assert D.parse_day(raw) == "2031-06-30"
    assert D.parse_day("31-FEB-2031") is None and D.parse_day("soon") is None


# ── reading the data set ────────────────────────────────────────────────────────────────────────

def test_members_are_found_in_a_folder_lower_case_or_named_by_the_metadata_file(tmp_path):
    for kw in ({"folder": "2031q3_nport/"}, {"lower": True}, {"metadata": True}, {"sniff": True}):
        p = tmp_path / "x.zip"
        p.write_bytes(q3_zip(**kw))
        with zipfile.ZipFile(p) as zf:
            assert set(D.find_members(zf)) == set(D.TABLES)


def test_a_missing_table_or_column_is_a_shape_error(tmp_path):
    p = tmp_path / "x.zip"
    with zipfile.ZipFile(p, "w") as zf:
        zf.writestr("SUBMISSION.tsv", _tsv(SUB_COLS, []))
    with zipfile.ZipFile(p) as zf, pytest.raises(D.Shape, match="no REGISTRANT"):
        D.find_members(zf)
    p.write_bytes(_rewrite(q3_zip(), "FUND_REPORTED_HOLDING.tsv", "ISSUER_CUSIP", "ISSUER_CODE"))
    with zipfile.ZipFile(p) as zf, pytest.raises(D.Shape, match="ISSUER_CUSIP"):
        D.Builder(work_dir=str(tmp_path / "w")).add_current(zf)


def test_a_data_set_with_no_common_stock_holding_is_a_shape_error(tmp_path):
    subs = [_sub(_acc(1, 101), "20-AUG-2031", "30-JUN-2031")]
    reg, info = _reg_info(_acc(1, 101), 1)
    holds = [_holding(_acc(1, 101), 10_000 + i, CUS_A, 5, 5, unit="PA", cat="DBT") for i in range(1000)]
    p = tmp_path / "x.zip"
    p.write_bytes(_zip_bytes(subs, [reg], [info], holds, []))
    with zipfile.ZipFile(p) as zf, pytest.raises(D.Shape, match="no common-stock"):
        D.Builder(work_dir=str(tmp_path / "w")).add_current(zf)


def test_each_fund_reads_its_newest_report_and_the_amendment_replaces_the_original(tmp_path):
    idx = _builder(tmp_path)
    by_name = {h["fund"]: h for h in idx["stocks"]["ZQAA"]["holders"]}
    petrel = next(s for s, f in idx["funds"].items() if f["name"] == "Petrel Growth Fund")
    assert by_name[petrel]["shares"] == 500                          # the amendment's 500, never the original's 400
    f = idx["funds"][petrel]
    assert f["accession"] == _acc(2, 202) and f["report_date"] == "2031-07-31" and f["filed"] == "2031-09-28"
    assert f["family"] == "Petrel Funds" and f["cik"] == "9000002"
    assert idx["periods"] == {"from": "2031-06-30", "to": "2031-08-31", "funds": 5, "funds_with_previous": 4}


def test_shorts_bonds_and_late_notices_are_not_holders(tmp_path):
    idx = _builder(tmp_path)
    assert idx["stocks"]["ZQAA"]["summary"]["shares"] == 1000 + 500 + 300 + 200
    assert idx["stats"]["short_rows"] == 1
    assert not any(f["accession"] == _acc(5, 601) for f in idx["funds"].values())


# ── matching ────────────────────────────────────────────────────────────────────────────────────

def test_matching_tiers_conflicts_and_the_unmatched_are_each_said(tmp_path):
    idx = _builder(tmp_path)
    s = idx["stocks"]
    assert s["ZQAA"]["summary"]["tier"] == "fund_ticker" and s["ZQAA"]["summary"]["votes"] == 3
    assert s["ZQBB"]["summary"]["tier"] == "sec_name"
    assert s["ZQCC"]["summary"]["tier"] == "sec_ftd" and "ZQCX" not in s
    assert s["ZQDD"]["summary"]["tier"] == "fund_ticker"             # its CUSIP came from the US ISIN
    assert s["ZQJJ-B"]["summary"]["funds"] == 1
    assert s["ZQGG"]["summary"]["funds"] == 3                         # the three-vote security, not the one-vote one
    assert "ZQEE" not in s                                            # a non-US issue is never matched by name
    cov = idx["coverage"]
    assert cov["all"]["rows"] == 15 and cov["matched"]["rows"] == 12
    assert cov["no_identifier"]["rows"] == 1 and cov["conflict"]["rows"] == 1 and cov["no_ticker"]["rows"] == 1
    assert cov["matched_rows_pct"] == 80.0
    all_value = 10_000 + 5_000 + 2_500 + 700 + 100 + 5_000 + 200 + 300 + 3_000 + 50 + 600 + 150 + 150 + 2_000 + 500
    assert cov["all"]["value"] == all_value
    assert cov["matched_value_pct"] == round((all_value - 700 - 150 - 50) / all_value * 100, 1)
    assert idx["stats"]["isin_cusips"] == 1


def test_a_name_two_tickers_share_is_never_a_match(tmp_path):
    b = D.Builder()
    b.cusips.get(CUS_B)
    b.names[0] = {"TWIN CLASS": 3}
    ticker, tier, _votes, _conflict = b.match(sec_names=SEC_NAMES)
    assert ticker == [None] and tier == [None]


def test_a_split_vote_without_a_clear_winner_matches_nothing(tmp_path):
    b = D.Builder()
    b.cusips.get(CUS_A)
    b.votes = {(0, "ZQAA"): 2, (0, "ZQAB"): 2}
    assert b.match()[0] == [None]
    b.votes = {(0, "ZQAA"): 3, (0, "ZQAB"): 2}                      # 60 percent: just enough
    assert b.match()[0] == ["ZQAA"]
    b.votes = {(0, "ZQAA"): 5, (0, "ZQAB"): 4}                      # 56 percent: not enough
    assert b.match()[0] == [None]


# ── changes since each fund's previous report ───────────────────────────────────────────────────

def test_a_tie_never_matches_even_under_a_lower_share_rule(monkeypatch):
    monkeypatch.setattr(D, "MIN_TICKER_SHARE", 0.4)                  # low enough that two tickers can tie at the top
    b = D.Builder()
    b.cusips.get(CUS_A)
    b.votes = {(0, "ZQAA"): 2, (0, "ZQAB"): 2, (0, "ZQAC"): 1}       # 40 percent each for two: a tie
    assert b.match()[0] == [None]
    b.votes = {(0, "ZQAA"): 3, (0, "ZQAB"): 2, (0, "ZQAC"): 2}       # 43 percent, alone at the top
    assert b.match()[0] == ["ZQAA"]


def test_added_cut_unchanged_new_no_earlier_report_and_sold_out(tmp_path):
    idx = _builder(tmp_path)
    funds = idx["funds"]
    name = {s: f["name"] for s, f in funds.items()}
    zqaa = idx["stocks"]["ZQAA"]
    got = [(name[h["fund"]], h["shares"], h["prior_shares"], h["state"]) for h in zqaa["holders"]]
    assert got == [
        ("Larchmont Total Market Index Fund", 1000, 800, "added"),
        ("Petrel Growth Fund", 500, 500, "unchanged"),
        ("Quarry Small Cap ETF", 300, 450, "cut"),                   # its previous report was in the same data set
        ("Tamsin Value Fund", 200, None, "no_prior"),
    ]
    assert [(name[h["fund"]], h["prior_shares"]) for h in zqaa["sold"]] == [("Ostler Income Fund", 700)]
    sm = zqaa["summary"]
    assert (sm["funds"], sm["added"], sm["cut"], sm["unchanged"], sm["new"], sm["no_prior"], sm["sold_out"]) == \
        (4, 1, 1, 1, 0, 1, 1)
    assert sm["value"] == 20_000 and sm["value_complete"] is True
    assert (sm["both_now"], sm["both_prior"]) == (1800, 800 + 500 + 450 + 700)
    assert (sm["period_from"], sm["period_to"]) == ("2031-06-30", "2031-08-31")
    zqbb = {name[h["fund"]]: h for h in idx["stocks"]["ZQBB"]["holders"]}
    assert zqbb["Larchmont Total Market Index Fund"]["state"] == "new"
    assert zqbb["Larchmont Total Market Index Fund"]["prior_shares"] == 0.0
    assert zqbb["Ostler Income Fund"]["state"] == "unchanged"
    quarry = next(f for f in funds.values() if f["name"] == "Quarry Small Cap ETF")
    assert quarry["prior_report_date"] == "2031-05-31"               # never the older Feb report of the data set before


def test_without_the_data_set_before_every_change_is_no_earlier_report(tmp_path):
    b = D.Builder(work_dir=str(tmp_path / "parts"))
    p = tmp_path / "q3.zip"
    p.write_bytes(q3_zip())
    with zipfile.ZipFile(p) as zf:
        b.add_current(zf)
    idx = b.finish(str(tmp_path / "index.sqlite"), ftd_pairs=FTD, sec_names=SEC_NAMES)
    states = {h["state"] for h in idx["stocks"]["ZQAA"]["holders"]}
    assert states == {"no_prior", "cut"}                               # only the fund with two reports in the data set
    assert idx["stocks"]["ZQAA"]["sold"] == []


def test_rows_are_bounded_and_ranked_by_value(tmp_path, monkeypatch):
    monkeypatch.setattr(D, "KEEP_ROWS", 2)
    idx = _builder(tmp_path)
    zqaa = idx["stocks"]["ZQAA"]
    assert [h["value"] for h in zqaa["holders"]] == [10_000, 5_000]
    assert zqaa["summary"]["funds"] == 4                               # the count is over every fund, not the kept rows


def test_the_partitioned_build_gives_the_same_index(tmp_path):
    whole = _builder(tmp_path, parts=1)
    expected = {t: whole["stocks"][t] for t in whole["stocks"]}
    for parts in (3, 7, 16):                                          # CUSIP partitions on the miniature
        split = _builder(tmp_path, parts=parts)
        assert {t: split["stocks"][t] for t in split["stocks"]} == expected, parts
        assert split["coverage"] == whole["coverage"] and split["funds"] == whole["funds"]


def test_never_more_than_one_partition_of_holdings_is_held(tmp_path):
    split = _builder(tmp_path, parts=4)
    rows = split["stats"]["partition_rows"]
    assert len(rows) == 4 and sum(1 for n in rows if n) >= 2         # the miniature lands in several partitions
    assert split["stats"]["max_rows_held"] == max(rows) < sum(rows)
    whole = _builder(tmp_path, parts=1)
    assert whole["stats"]["max_rows_held"] == sum(rows)               # one partition holds everything
    # the IDENTIFIERS join keeps one 8-byte key per kept holding of a data set (16 in the newest miniature)
    assert split["stats"]["join_key_bytes"] == 8 * 16


def test_a_run_cut_short_leaves_no_half_written_index(data_dir, monkeypatch):
    _built(data_dir, monkeypatch)
    index = data_dir / M.DISK_DIR / M.INDEX_NAME
    before = index.read_bytes()
    looks = []

    def quiet_once(now):                                              # the quiet span ends during the write
        looks.append(now)
        return len(looks) < 2
    monkeypatch.setattr(D, "TICK_EVERY", 10 ** 9)                     # so the only looks are the partitions'
    monkeypatch.setattr(M, "quiet", quiet_once)
    out, _ = _built(data_dir, monkeypatch)
    assert out["state"] == "stopped" and out["reason"] == "busy" and len(looks) == 2
    assert index.read_bytes() == before                               # the last good index stays
    assert sorted(os.listdir(data_dir / M.DISK_DIR)) == [M.INDEX_NAME]  # no .part, no partition files, no zip


def test_a_value_no_fund_could_hold_is_not_reported_never_infinite(tmp_path):
    bad = _rewrite(q3_zip(), "FUND_REPORTED_HOLDING.tsv", "\t1000\tNS\t\tUSD\t10000\t", "\t1000\tNS\t\tUSD\t1e20\t")
    idx = _builder(tmp_path, q3=bad)
    zqaa = idx["stocks"]["ZQAA"]
    larch = [h for h in zqaa["holders"] if idx["funds"][h["fund"]]["name"] == "Larchmont Total Market Index Fund"][0]
    assert larch["value"] is None and larch["shares"] == 1000
    assert zqaa["holders"][-1] is larch                                # a missing value sinks to the bottom
    assert zqaa["summary"]["value_complete"] is False and zqaa["summary"]["value"] == 5_000 + 3_000 + 2_000


def test_the_percent_unit_is_read_from_the_reports_own_net_assets():
    import numpy as np
    b = D.Builder()
    b.reps = [{"net_assets": 1_000_000.0, "s": 0}]
    rep = np.zeros(30, dtype=np.int32)
    val = np.full(30, 20_000.0)
    assert b._pct_units(rep, val, np.full(30, 2.0)) == ("percent", 1.0)
    assert b._pct_units(rep, val, np.full(30, 0.02)) == ("fraction", 100.0)
    unit, factor = b._pct_units(rep, val, np.full(30, 40.0))
    assert unit == "unclear" and np.isnan(factor)                     # withheld, never guessed
    assert b._pct_units(rep[:5], val[:5], np.full(5, 2.0)) == ("assumed_percent", 1.0)


# ── the index on disk and the request path ──────────────────────────────────────────────────────

@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(M, "ftd_pairs", lambda: dict(FTD))
    monkeypatch.setattr(M, "quiet", lambda now: True)
    monkeypatch.setattr(M, "PAUSE_S", 0.0)
    M.reset_for_tests()
    yield tmp_path
    M.reset_for_tests()


def _fake_sec(zips: dict, calls: list, *, tickers=None, refuse=None, status=403):
    def download(url, dest):
        calls.append(url)
        if refuse and refuse in url:
            raise SecError(url, status, "refused")
        for q, body in zips.items():
            if f"/{q}_nport.zip" in url:
                with open(dest, "wb") as fh:
                    fh.write(body)
                return len(body)
        raise SecError(url, 404, "not found")

    def sec_get(url):
        calls.append(url)
        assert url == M.SEC_TICKERS_URL
        body = tickers if tickers is not None else {"0": {"cik_str": 1, "ticker": "ZQBB", "title": "Zephyr Beacon Bioscience Corp."}}
        return json.dumps(body).encode()
    return download, sec_get


def _built(data_dir, monkeypatch, zips=None, calls=None, **kw):
    calls = [] if calls is None else calls
    download, sec_get = _fake_sec(zips if zips is not None else {"2031q3": q3_zip(), "2031q2": q2_zip()}, calls, **kw)
    monkeypatch.setattr(M, "_download", download)
    monkeypatch.setattr(M, "_sec_get", sec_get)
    return M.build(QUIET_NOW), calls


def test_a_run_reads_the_newest_data_set_then_the_one_before_and_keeps_no_zip(data_dir, monkeypatch):
    out, calls = _built(data_dir, monkeypatch)
    assert out["state"] == "built" and out["quarter"] == "2031Q3" and out["prior_quarter"] == "2031Q2"
    assert calls == [M.data_set_url((2031, 3)), M.data_set_url((2031, 2)), M.SEC_TICKERS_URL]
    assert out["downloads"] == 2 and out["requests"] == 3
    assert not (data_dir / M.DISK_DIR / "tmp").exists()
    assert sorted(os.listdir(data_dir / M.DISK_DIR)) == [M.INDEX_NAME]
    con = sqlite3.connect(data_dir / M.DISK_DIR / M.INDEX_NAME)
    cols = " ".join(r[0] or "" for r in con.execute("SELECT sql FROM sqlite_master"))
    assert "cusip" not in cols.lower()                                # no CUSIP is kept on disk
    assert not any(CUS_A in str(r) for r in con.execute("SELECT * FROM holder"))
    con.close()


def test_one_zip_is_on_disk_at_a_time(data_dir, monkeypatch):
    calls, seen = [], []
    download, sec_get = _fake_sec({"2031q3": q3_zip(), "2031q2": q2_zip()}, calls)

    def watching(url, dest):
        zips = [f for f in os.listdir(os.path.dirname(dest)) if f.endswith(".zip")]
        seen.append(sorted(zips))                                     # the zips on disk when the next download starts
        return download(url, dest)
    monkeypatch.setattr(M, "_download", watching)
    monkeypatch.setattr(M, "_sec_get", sec_get)
    assert M.build(QUIET_NOW)["state"] == "built"
    assert seen == [[], []]                                           # the newest zip is gone before the one before


def test_the_answer_for_a_held_stock(data_dir, monkeypatch):
    _built(data_dir, monkeypatch)
    a = M.answer_for("zqaa")
    assert a["state"] == "ok" and a["sym"] == "ZQAA" and a["source"] == M.SOURCE
    assert a["data_set"]["quarter"] == "2031Q3" and a["data_set"]["prior_quarter"] == "2031Q2"
    assert a["data_set"]["url"] == M.data_set_url((2031, 3))
    assert a["data_set"]["periods"]["to"] == "2031-08-31"
    assert a["holders_total"] == 4 and a["holders_limit"] == D.KEEP_ROWS
    first = a["holders"][0]
    assert first["name"] == "Larchmont Total Market Index Fund" and first["family"] == "Larchmont Index Trust"
    assert (first["shares"], first["prior_shares"], first["change_shares"], first["change_pct"]) == (1000, 800, 200, 25.0)
    assert first["period"] == "2031-06-30" and first["prior_period"] == "2031-03-31" and first["pct"] == 1.0
    assert first["url"] == f"https://www.sec.gov/Archives/edgar/data/9000001/{_acc(1, 101).replace('-', '')}/{_acc(1, 101)}-index.htm"
    tamsin = a["holders"][3]
    assert tamsin["state"] == "no_prior" and tamsin["change_shares"] is None and tamsin["prior_shares"] is None
    assert a["sold_out"][0]["name"] == "Ostler Income Fund" and a["sold_out"][0]["prior_shares"] == 700
    assert a["sold_out_total"] == 1
    assert a["coverage"]["matched_rows_pct"] == 80.0 and a["coverage"]["pct_units"] == "assumed_percent"
    assert a["summary"]["tier"] == "fund_ticker"


def test_a_stock_not_in_the_index_is_not_matched_never_none(data_dir, monkeypatch):
    _built(data_dir, monkeypatch)
    a = M.answer_for("ZQZZ")
    assert a["state"] == "not_matched" and "holders" not in a
    assert a["coverage"]["matched_value_pct"] is not None


def test_before_any_run_the_answer_is_not_built_with_the_next_check(data_dir):
    a = M.answer_for("ZQAA")
    assert a["state"] == "not_built" and a["building"] is False and a["last_check"] is None
    assert "T00:50" in a["next_check"]


def test_an_unreadable_index_is_unavailable(data_dir):
    os.makedirs(data_dir / M.DISK_DIR)
    (data_dir / M.DISK_DIR / M.INDEX_NAME).write_bytes(b"not a database at all" * 50)
    assert M.answer_for("ZQAA")["state"] == "unavailable"


def test_the_overlay_never_changes_the_cached_payload_and_never_raises(data_dir, monkeypatch):
    payload = {"sym": "ZQAA", "thirteen_f": None}
    out = M.overlay(payload, "ZQAA")
    assert out["funds_nport"]["state"] == "not_built" and "funds_nport" not in payload
    monkeypatch.setattr(M, "answer_for", lambda s: 1 / 0)
    assert M.overlay(payload, "ZQAA")["funds_nport"]["state"] == "unavailable"
    assert M.overlay({}, "ZQAA") == {}


def test_the_ownership_route_carries_the_block(data_dir, monkeypatch):
    from api.routers import research as R
    from api.services import edgar_ownership, sec_13f_list
    _built(data_dir, monkeypatch)
    monkeypatch.setattr(R, "get_ownership", lambda s: {"sym": s.upper(), "thirteen_f": None})
    monkeypatch.setattr(edgar_ownership, "is_enabled", lambda: False)
    monkeypatch.setattr(sec_13f_list, "is_enabled", lambda: False)
    app = FastAPI()
    app.include_router(R.router)
    body = TestClient(app).get("/api/research/ownership/ZQAA").json()
    assert body["funds_nport"]["state"] == "ok" and body["funds_nport"]["holders"][0]["shares"] == 1000


def test_the_ownership_route_is_in_the_paid_family_of_the_gate():
    from api import open_reads_gate as G
    assert G.family_of("/api/research/ownership/{sym}") == "paid"


# ── the run's rules ─────────────────────────────────────────────────────────────────────────────

def test_nothing_is_asked_when_the_newest_data_set_is_held(data_dir, monkeypatch):
    calls = []
    download, sec_get = _fake_sec({}, calls)
    monkeypatch.setattr(M, "_download", download)
    monkeypatch.setattr(M, "_sec_get", sec_get)
    assert M.build(QUIET_NOW, held_quarter=(2031, 3))["state"] == "current"
    assert calls == []


def test_a_quarter_not_posted_yet_falls_back_to_the_one_before(data_dir, monkeypatch):
    out, calls = _built(data_dir, monkeypatch, zips={"2031q2": q3_zip(), "2031q1": q2_zip()})
    assert out["state"] == "built" and out["quarter"] == "2031Q2" and out["not_posted"] == ["2031Q3"]
    assert calls[:3] == [M.data_set_url((2031, 3)), M.data_set_url((2031, 2)), M.data_set_url((2031, 1))]


def test_nothing_posted_is_not_published_and_an_older_held_index_is_never_asked_for_again(data_dir, monkeypatch):
    out, calls = _built(data_dir, monkeypatch, zips={})
    assert out["state"] == "not_published" and len(calls) == 2
    calls.clear()
    out = M.build(QUIET_NOW, held_quarter=(2031, 2))
    assert out["state"] == "not_published" and calls == [M.data_set_url((2031, 3))]


def test_a_refusal_stops_the_run_and_the_last_good_index_stays(data_dir, monkeypatch):
    _built(data_dir, monkeypatch)
    before = (data_dir / M.DISK_DIR / M.INDEX_NAME).read_bytes()
    out, _calls = _built(data_dir, monkeypatch, refuse="2031q2")
    assert out["state"] == "stopped" and out["reason"] == "sec_403"
    assert (data_dir / M.DISK_DIR / M.INDEX_NAME).read_bytes() == before
    assert not (data_dir / M.DISK_DIR / "tmp").exists()


def test_a_passing_failure_on_the_data_set_before_ends_the_run_never_a_weaker_index(data_dir, monkeypatch):
    out, _calls = _built(data_dir, monkeypatch, refuse="2031q2", status=503)
    assert out["state"] == "failed" and out["reason"] == "sec_503"
    assert not (data_dir / M.DISK_DIR / M.INDEX_NAME).exists()          # tomorrow's run tries again


def test_an_index_from_another_builder_version_is_rebuilt(data_dir, monkeypatch):
    import threading
    _built(data_dir, monkeypatch)
    calls = []
    download, sec_get = _fake_sec({"2031q3": q3_zip(), "2031q2": q2_zip()}, calls)
    monkeypatch.setattr(M, "_download", download)
    monkeypatch.setattr(M, "_sec_get", sec_get)
    monkeypatch.setattr(M, "now_et", lambda: QUIET_NOW)
    M._run(threading.Event(), QUIET_NOW)
    assert calls == []                                                   # same version, newest quarter held
    monkeypatch.setattr(D, "INDEX_VERSION", D.INDEX_VERSION + 1)
    M._run(threading.Event(), QUIET_NOW)
    assert calls[:2] == [M.data_set_url((2031, 3)), M.data_set_url((2031, 2))]
    assert M.last_run()["state"] == "built"


def test_a_bad_data_set_is_a_shape_state_and_the_last_good_index_stays(data_dir, monkeypatch):
    _built(data_dir, monkeypatch)
    before = (data_dir / M.DISK_DIR / M.INDEX_NAME).read_bytes()
    out, _ = _built(data_dir, monkeypatch, zips={"2031q3": b"this is not a zip", "2031q2": q2_zip()})
    assert out["state"] == "shape" and (data_dir / M.DISK_DIR / M.INDEX_NAME).read_bytes() == before


def test_too_little_disk_starts_no_download(data_dir, monkeypatch):
    calls = []
    monkeypatch.setattr(M.shutil, "disk_usage", lambda p: shutil._ntuple_diskusage(10, 10, M.DISK_HEADROOM_BYTES - 1))
    out, calls = _built(data_dir, monkeypatch, calls=calls)
    assert out["state"] == "low_disk" and calls == []


def test_a_missing_data_set_before_still_builds_and_says_so(data_dir, monkeypatch):
    out, _ = _built(data_dir, monkeypatch, zips={"2031q3": q3_zip()})
    assert out["state"] == "built" and out["prior_missing"] == "sec_404"
    a = M.answer_for("ZQAA")
    assert a["data_set"]["prior_quarter"] is None and a["data_set"]["prior_missing"] == "sec_404"


def test_the_time_budget_and_the_end_of_the_quiet_span_stop_a_run(data_dir, monkeypatch):
    monkeypatch.setattr(D, "TICK_EVERY", 2)
    monkeypatch.setattr(M, "RUN_BUDGET_S", -1.0)
    out, _ = _built(data_dir, monkeypatch)
    assert out["state"] == "stopped" and out["reason"] == "time"
    monkeypatch.setattr(M, "RUN_BUDGET_S", 3600.0)
    monkeypatch.setattr(M, "quiet", lambda now: False)
    out, _ = _built(data_dir, monkeypatch)
    assert out["state"] == "stopped" and out["reason"] == "busy"
    assert not (data_dir / M.DISK_DIR / M.INDEX_NAME).exists()


def test_a_download_past_the_cap_is_refused_not_truncated():
    class Resp:
        headers = {}

        def __init__(self):
            self.left = 10

        def read(self, n=-1):
            out, self.left = b"x" * min(4, self.left), max(0, self.left - 4)
            return out

        def close(self):
            pass

    capped = M._Capped(Resp(), 9)
    assert capped.read(4) == b"xxxx" and capped.read(4) == b"xxxx"
    with pytest.raises(M.TooLarge):
        capped.read(4)


def test_the_download_is_the_sites_sec_client_with_the_cap_and_one_retry(monkeypatch, tmp_path):
    from api.services.fundamentals_pit import sec_client
    seen = {}

    def fake(url, dest, retries, timeout, opener):
        seen.update(url=url, retries=retries, timeout=timeout, opener=opener)
        return 1
    monkeypatch.setattr(sec_client, "download", fake)
    M._download(M.data_set_url((2031, 3)), str(tmp_path / "z.zip"))
    assert seen["url"].startswith("https://www.sec.gov/files/dera/data/form-n-port-data-sets/")
    assert seen["retries"] == 1 and seen["timeout"] == M.DOWNLOAD_TIMEOUT_S and callable(seen["opener"])


def test_the_sec_names_map_keeps_every_ticker_of_a_name():
    body = json.dumps({"0": {"cik_str": 1, "ticker": "ZQTA", "title": "Twin Class Inc"},
                       "1": {"cik_str": 1, "ticker": "ZQTB", "title": "TWIN CLASS INC."},
                       "2": {"cik_str": 2, "ticker": "7777", "title": "Numbered Co"}}).encode()
    assert M.sec_name_map(body) == {"TWIN CLASS": {"ZQTA", "ZQTB"}}


def test_the_ftd_pairs_are_read_only_when_the_store_is_on_this_server(tmp_path, monkeypatch):
    from api.services import ftd_dataset
    path = tmp_path / "ftd.db"
    monkeypatch.setattr(ftd_dataset, "db_path", lambda: str(path))
    assert M.ftd_pairs() == {} and not path.exists()                  # never created by a read
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE ftd (settle_date TEXT, cusip TEXT, symbol TEXT)")
    con.executemany("INSERT INTO ftd VALUES (?,?,?)", [("2031-09-01", CUS_C, "ZQCO"), ("2031-09-15", CUS_C, "ZQCC"),
                                                      ("2031-09-15", "BADCUSIP1", "ZQXX")])
    con.commit()
    con.close()
    assert M.ftd_pairs() == {CUS_C: "ZQCC"}


def test_the_quiet_span_is_scan_periods():
    from api.services import scan_period
    for day in range(20, 27):                                            # a whole week, every half hour
        for minute in range(0, 24 * 60, 30):
            now = datetime(2031, 10, day, minute // 60, minute % 60, tzinfo=ET)
            assert M.quiet(now) == scan_period._reuse_quiet_now(now.replace(tzinfo=None)), now


def test_the_scheduled_entry_starts_nothing_outside_the_quiet_span(monkeypatch):
    M.reset_for_tests()
    busy = datetime(2031, 11, 18, 11, 0, tzinfo=ET)                     # a Tuesday at 11:00
    assert M.run_scheduled(busy) == {"started": False, "reason": "not_quiet"}
    assert M.building() is False


def test_quarters_count_back_across_the_year():
    assert M.last_ended_quarter(date(2031, 1, 5)) == (2030, 4)
    assert M.last_ended_quarter(date(2031, 11, 22)) == (2031, 3)
    assert M.quarter_before((2031, 1)) == (2030, 4)
    assert M.parse_label("2031Q3") == (2031, 3) and M.parse_label("junk") is None
    assert M.data_set_url((2031, 3)) == "https://www.sec.gov/files/dera/data/form-n-port-data-sets/2031q3_nport.zip"
