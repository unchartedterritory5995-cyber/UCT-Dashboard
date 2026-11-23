"""COT by trader type (`api/services/cot_finer.py`, `GET /api/cot/breakdown`, `GET /api/cot/{symbol}/breakdown`).

Rails:
  * the parser reads the CFTC's TFF and Disaggregated layouts (the real header lines, built here from the CFTC's
    own column names) row by row: every class's long, short and spreading, trader counts, concentration; a blank
    figure is None, never 0; the Disaggregated swap columns' doubled underscore; the date falls back to YYMMDD;
    a missing required column is a shape failure;
  * a row becomes a market by its contract code first and the legacy reader's own names second (runs of spaces
    collapsed); a code match is never replaced by a name match for the same week; the code table covers exactly the
    legacy reader's markets;
  * the plan asks for nothing when both reports hold the report due and every seed year; the year of the expected
    report first, then missing seed years newest first; a past year's 404 is not asked again;
  * a run: stores what it read, asks nothing the second time, keeps what it read on a refusal, a shape failure or
    an oversized file, runs only inside the quiet span (scan_period's own rule) and one at a time; a file of the
    wrong shape does not end the run, and a past year's is remembered and not asked for again within the week;
  * the request path only reads: ok, no_record, not_built, unavailable; the board's watched class per report;
  * the routes: paid (401 / 402), 404 and 400 as the legacy route, declared before the catch-all, plain defs,
    and they never start a download.
Every figure, market name and date here is INVENTED; the contract codes are the table's own.
"""
from __future__ import annotations

import csv
import inspect
import io
import os
import sqlite3
import zipfile
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import cot as route
from api.services import cot_finer as F
from api.services import cot_service as S

ET = ZoneInfo("America/New_York")

# ── the two layouts, from the CFTC's own column names (the order the files carry) ───────────────

_HEAD = ["Market_and_Exchange_Names", "As_of_Date_In_Form_YYMMDD", "Report_Date_as_YYYY-MM-DD",
         "CFTC_Contract_Market_Code", "CFTC_Market_Code", "CFTC_Region_Code", "CFTC_Commodity_Code"]
_TAIL = ["Contract_Units", "CFTC_Contract_Market_Code_Quotes", "CFTC_Market_Code_Quotes",
         "CFTC_Commodity_Code_Quotes", "CFTC_SubGroup_Code", "FutOnly_or_Combined"]
_CONC = ["Conc_Gross_LE_4_TDR_Long", "Conc_Gross_LE_4_TDR_Short", "Conc_Gross_LE_8_TDR_Long",
         "Conc_Gross_LE_8_TDR_Short", "Conc_Net_LE_4_TDR_Long", "Conc_Net_LE_4_TDR_Short", "Conc_Net_LE_8_TDR_Long",
         "Conc_Net_LE_8_TDR_Short"]
_LSS = ("Long", "Short", "Spread")
_TFF_STEMS = ("Dealer", "Asset_Mgr", "Lev_Money", "Other_Rept")


def tff_header() -> list[str]:
    h = _HEAD + ["Open_Interest_All"]
    h += [f"{s}_Positions_{x}_All" for s in _TFF_STEMS for x in _LSS]
    h += ["Tot_Rept_Positions_Long_All", "Tot_Rept_Positions_Short_All", "NonRept_Positions_Long_All",
          "NonRept_Positions_Short_All"]
    h += ["Change_in_Open_Interest_All"] + [f"Change_in_{s}_{x}_All" for s in _TFF_STEMS for x in _LSS]
    h += ["Change_in_Tot_Rept_Long_All", "Change_in_Tot_Rept_Short_All", "Change_in_NonRept_Long_All",
          "Change_in_NonRept_Short_All"]
    h += ["Pct_of_Open_Interest_All"] + [f"Pct_of_OI_{s}_{x}_All" for s in _TFF_STEMS for x in _LSS]
    h += ["Pct_of_OI_Tot_Rept_Long_All", "Pct_of_OI_Tot_Rept_Short_All", "Pct_of_OI_NonRept_Long_All",
          "Pct_of_OI_NonRept_Short_All"]
    h += ["Traders_Tot_All"] + [f"Traders_{s}_{x}_All" for s in _TFF_STEMS for x in _LSS]
    h += ["Traders_Tot_Rept_Long_All", "Traders_Tot_Rept_Short_All"]
    h += [f"{c}_All" for c in _CONC] + _TAIL
    assert len(h) == 87
    return h


def disagg_header() -> list[str]:
    def positions(s):
        return [f"Open_Interest_{s}", f"Prod_Merc_Positions_Long_{s}", f"Prod_Merc_Positions_Short_{s}",
                f"Swap_Positions_Long_{s}", f"Swap__Positions_Short_{s}", f"Swap__Positions_Spread_{s}",
                *[f"{st}_Positions_{x}_{s}" for st in ("M_Money", "Other_Rept") for x in _LSS],
                f"Tot_Rept_Positions_Long_{s}", f"Tot_Rept_Positions_Short_{s}",
                f"NonRept_Positions_Long_{s}", f"NonRept_Positions_Short_{s}"]

    def pct(s):
        return [f"Pct_of_Open_Interest_{s}", f"Pct_of_OI_Prod_Merc_Long_{s}", f"Pct_of_OI_Prod_Merc_Short_{s}",
                *[f"Pct_of_OI_{st}_{x}_{s}" for st in ("Swap", "M_Money", "Other_Rept") for x in _LSS],
                f"Pct_of_OI_Tot_Rept_Long_{s}", f"Pct_of_OI_Tot_Rept_Short_{s}",
                f"Pct_of_OI_NonRept_Long_{s}", f"Pct_of_OI_NonRept_Short_{s}"]

    def traders(s):
        return [f"Traders_Tot_{s}", f"Traders_Prod_Merc_Long_{s}", f"Traders_Prod_Merc_Short_{s}",
                *[f"Traders_{st}_{x}_{s}" for st in ("Swap", "M_Money", "Other_Rept") for x in _LSS],
                f"Traders_Tot_Rept_Long_{s}", f"Traders_Tot_Rept_Short_{s}"]

    sides = ("All", "Old", "Other")
    h = list(_HEAD)
    for s in sides:
        h += positions(s)
    h += ["Change_in_Open_Interest_All", "Change_in_Prod_Merc_Long_All", "Change_in_Prod_Merc_Short_All",
          *[f"Change_in_{st}_{x}_All" for st in ("Swap", "M_Money", "Other_Rept") for x in _LSS],
          "Change_in_Tot_Rept_Long_All", "Change_in_Tot_Rept_Short_All", "Change_in_NonRept_Long_All",
          "Change_in_NonRept_Short_All"]
    for s in sides:
        h += pct(s)
    for s in sides:
        h += traders(s)
    for s in sides:
        h += [f"{c}_{s}" for c in _CONC]
    h += _TAIL
    assert len(h) == 191
    return h


def row(header: list[str], day: str, code: str, name: str, values: dict) -> list[str]:
    """One data row: invented figures by column name, "0" for every other number."""
    d = date.fromisoformat(day)
    base = {"Market_and_Exchange_Names": name, "As_of_Date_In_Form_YYMMDD": d.strftime("%y%m%d"),
            "Report_Date_as_YYYY-MM-DD": day, "CFTC_Contract_Market_Code": code, "Contract_Units": "(INVENTED)",
            "FutOnly_or_Combined": "FutOnly"}
    return [str(values.get(h, base.get(h, "0"))) for h in header]


def text(header: list[str], rows: list[list[str]]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf, quoting=csv.QUOTE_MINIMAL)
    w.writerow(header)
    w.writerows(rows)
    return buf.getvalue()


def zipped(path, member: str, body: str) -> None:
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(member, body)


ES, GC = F.CONTRACT_CODES["ES"], F.CONTRACT_CODES["GC"]


def tff_lev(day, long, short, spread, oi=500000, code=ES, name="INVENTED INDEX - INVENTED EXCHANGE", **more):
    return row(tff_header(), day, code, name, {"Open_Interest_All": oi, "Lev_Money_Positions_Long_All": long,
                                               "Lev_Money_Positions_Short_All": short,
                                               "Lev_Money_Positions_Spread_All": spread, **more})


def disagg_mm(day, long, short, spread, oi=400000, code=GC, name="INVENTED METAL - INVENTED EXCHANGE", **more):
    return row(disagg_header(), day, code, name, {"Open_Interest_All": oi, "M_Money_Positions_Long_All": long,
                                                  "M_Money_Positions_Short_All": short,
                                                  "M_Money_Positions_Spread_All": spread, **more})


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(S, "DB_PATH", str(tmp_path / "cot.db"))
    F.init_db()
    return tmp_path


# ── the parser ─────────────────────────────────────────────────────────────────────────────────

def test_tff_every_class_with_spreading_traders_and_concentration_and_a_blank_is_none():
    body = text(tff_header(), [
        tff_lev("2031-03-18", 412345, 98765, 23456, Dealer_Positions_Long_All=111, Dealer_Positions_Short_All=222,
                Dealer_Positions_Spread_All="", Asset_Mgr_Positions_Long_All=333, Asset_Mgr_Positions_Short_All=444,
                Asset_Mgr_Positions_Spread_All=55, Other_Rept_Positions_Long_All=66, Other_Rept_Positions_Short_All=77,
                Other_Rept_Positions_Spread_All=8, NonRept_Positions_Long_All=99, NonRept_Positions_Short_All=101,
                Traders_Lev_Money_Long_All=41, Traders_Lev_Money_Short_All=33, Traders_Lev_Money_Spread_All=20,
                Traders_Tot_All=310, Conc_Gross_LE_4_TDR_Long_All="21.7", Conc_Net_LE_8_TDR_Short_All=""),
    ])
    p = F.parse_report(io.StringIO(body), F.REPORTS["tff"])
    assert (p.rows, p.unmatched, p.newest) == (1, 0, "2031-03-18")
    m = p.markets[("ES", "2031-03-18")]
    assert (m["report"], m["cftc_code"], m["match"], m["open_interest"], m["traders_total"]) == ("tff", ES, "code", 500000, 310)
    assert (m["conc_gross_4_long"], m["conc_net_8_short"]) == (21.7, None)
    cls = {c["cls"]: c for c in p.positions[("ES", "2031-03-18")]}
    assert list(cls) == ["dealer", "asset_manager", "leveraged_funds", "other_reportable", "nonreportable"]
    assert {k: cls["leveraged_funds"][k] for k in ("long", "short", "spread", "traders_long", "traders_short", "traders_spread")} \
        == {"long": 412345, "short": 98765, "spread": 23456, "traders_long": 41, "traders_short": 33, "traders_spread": 20}
    assert (cls["dealer"]["long"], cls["dealer"]["spread"]) == (111, None)          # a blank figure is None, never 0
    assert (cls["nonreportable"]["long"], cls["nonreportable"]["short"]) == (99, 101)
    assert (cls["nonreportable"]["spread"], cls["nonreportable"]["traders_long"]) == (None, None)  # no such columns


def test_disaggregated_reads_the_doubled_underscore_swap_columns_and_producers_have_no_spreading():
    body = text(disagg_header(), [disagg_mm("2031-03-18", 250000, 40000, 30000, Swap_Positions_Long_All=7000,
                                            **{"Swap__Positions_Short_All": 90000, "Swap__Positions_Spread_All": 1234},
                                            Prod_Merc_Positions_Long_All=50000, Prod_Merc_Positions_Short_All=210000)])
    p = F.parse_report(io.StringIO(body), F.REPORTS["disaggregated"])
    cls = {c["cls"]: c for c in p.positions[("GC", "2031-03-18")]}
    assert list(cls) == ["producer_merchant", "swap_dealer", "managed_money", "other_reportable", "nonreportable"]
    assert (cls["swap_dealer"]["long"], cls["swap_dealer"]["short"], cls["swap_dealer"]["spread"]) == (7000, 90000, 1234)
    assert (cls["managed_money"]["long"], cls["managed_money"]["short"]) == (250000, 40000)
    assert (cls["producer_merchant"]["short"], cls["producer_merchant"]["spread"]) == (210000, None)


def test_the_date_falls_back_to_yymmdd_and_a_missing_required_column_is_a_shape_failure():
    header = [h for h in tff_header() if h != "Report_Date_as_YYYY-MM-DD"]
    body = text(header, [row(header, "2031-03-18", ES, "X", {"Lev_Money_Positions_Long_All": 5})])
    p = F.parse_report(io.StringIO(body), F.REPORTS["tff"])
    assert list(p.markets) == [("ES", "2031-03-18")]
    header = [h for h in tff_header() if h != "Lev_Money_Positions_Short_All"]
    with pytest.raises(F.Shape, match="lev_money_positions_short_all"):
        F.parse_report(io.StringIO(text(header, [])), F.REPORTS["tff"])
    header = [h for h in tff_header() if "Date" not in h]
    with pytest.raises(F.Shape, match="a report date"):
        F.parse_report(io.StringIO(text(header, [])), F.REPORTS["tff"])
    with pytest.raises(F.Shape):
        F.parse_report(io.StringIO(""), F.REPORTS["tff"])


def test_a_code_match_beats_a_name_match_and_a_name_with_doubled_spaces_still_resolves():
    gold_name = S.SYMBOL_MAP["GC"]                                      # the legacy reader's own name for GC
    body = text(disagg_header(), [
        disagg_mm("2031-03-18", 1, 2, 3, code="999999", name=gold_name),          # name only: GC
        disagg_mm("2031-03-18", 250000, 40000, 30000),                            # code: GC, same week -> wins
        disagg_mm("2031-03-11", 5, 6, 7, code="999999", name=gold_name.replace(" - ", "  -  ")),  # name only, spaces
        disagg_mm("2031-03-18", 9, 9, 9, code="ZZZZZZ", name="INVENTED NOTHING - NOWHERE"),       # no market of ours
    ])
    p = F.parse_report(io.StringIO(body), F.REPORTS["disaggregated"])
    assert (p.rows, p.unmatched) == (4, 1)
    assert p.markets[("GC", "2031-03-18")]["match"] == "code"
    assert {c["cls"]: c["long"] for c in p.positions[("GC", "2031-03-18")]}["managed_money"] == 250000
    assert (p.markets[("GC", "2031-03-11")]["match"], p.markets[("GC", "2031-03-11")]["cftc_code"]) == ("name", "999999")
    # the order does not matter: a later name match never replaces an earlier code match
    body = text(disagg_header(), [disagg_mm("2031-03-18", 250000, 40000, 30000),
                                  disagg_mm("2031-03-18", 1, 2, 3, code="999999", name=gold_name)])
    p = F.parse_report(io.StringIO(body), F.REPORTS["disaggregated"])
    assert {c["cls"]: c["long"] for c in p.positions[("GC", "2031-03-18")]}["managed_money"] == 250000


def test_the_code_table_covers_exactly_the_legacy_markets_once_each_and_each_report_watches_its_own_class():
    assert set(F.CONTRACT_CODES) == set(S.SYMBOL_MAP)
    assert len(set(F.CONTRACT_CODES.values())) == len(F.CONTRACT_CODES)
    for r in F.REPORTS.values():
        assert r.watch in [c.key for c in r.classes], r.key
    assert (F.REPORTS["tff"].watch, F.REPORTS["disaggregated"].watch) == ("leveraged_funds", "managed_money")
    assert F.REPORTS["tff"].url(2031) == "https://www.cftc.gov/files/dea/history/fut_fin_txt_2031.zip"
    assert F.REPORTS["disaggregated"].url(2031) == "https://www.cftc.gov/files/dea/history/fut_disagg_txt_2031.zip"


def test_a_zip_is_read_from_its_text_member_and_anything_else_is_a_shape_failure(tmp_path):
    good = tmp_path / "good.zip"
    zipped(good, "FinFutYY.txt", text(tff_header(), [tff_lev("2031-03-18", 10, 20, 30)]))
    assert list(F.parse_zip(str(good), F.REPORTS["tff"]).markets) == [("ES", "2031-03-18")]
    bad = tmp_path / "bad.zip"
    bad.write_bytes(b"<html>not a zip</html>")
    with pytest.raises(F.Shape, match="not a zip"):
        F.parse_zip(str(bad), F.REPORTS["tff"])
    empty = tmp_path / "empty.zip"
    zipped(empty, "readme.pdf", "x")
    with pytest.raises(F.Shape, match="no text file"):
        F.parse_zip(str(empty), F.REPORTS["tff"])


# ── the plan ───────────────────────────────────────────────────────────────────────────────────

def test_the_plan_seeds_newest_first_and_asks_nothing_once_everything_is_held(monkeypatch):
    monkeypatch.setattr(S, "_SEED_YEARS", 3)
    want = date(2031, 3, 18)
    todo = F.plan({}, want)
    assert todo == [("tff", 2031), ("disaggregated", 2031), ("tff", 2030), ("tff", 2029),
                    ("disaggregated", 2030), ("disaggregated", 2029)]
    held = {"tff": {2031: "2031-03-18", 2030: "2030-12-31", 2029: "2029-12-25"},
            "disaggregated": {2031: "2031-03-18", 2030: "2030-12-31", 2029: None}}     # 2029: noted as not posted
    assert F.plan(held, want) == []
    # a new report is due: only the year of the expected report, for each report
    assert F.plan(held, date(2031, 3, 25)) == [("tff", 2031), ("disaggregated", 2031)]
    # a report due early in January can still be the previous year's: the plan follows the report, not the clock
    held_jan = {k: {2031: "2031-12-23", 2030: "2030-12-31", 2029: "2029-12-25"} for k in F.REPORTS}
    assert F.plan(held_jan, date(2031, 12, 30)) == [("tff", 2031), ("disaggregated", 2031)]
    # a seed year whose file read as the wrong shape this week is left out; the year of the expected report never is
    assert F.plan({}, want, {("tff", 2030), ("tff", 2031)}) == [("tff", 2031), ("disaggregated", 2031), ("tff", 2029),
                                                                ("disaggregated", 2030), ("disaggregated", 2029)]


# ── a run ──────────────────────────────────────────────────────────────────────────────────────

class FakeCftc:
    """Stands in for the CFTC: one invented zip per (report, year), or an HTTP status."""

    def __init__(self, answers):
        self.answers = answers
        self.asked: list[str] = []

    def __call__(self, url, dest):
        self.asked.append(url)
        got = self.answers.get(url, 404)
        if isinstance(got, int):
            raise F.HttpStatus(got)
        if isinstance(got, Exception):
            raise got
        member, body = got
        zipped(dest, member, body)
        return os.path.getsize(dest)


def _url(key, year):
    return F.REPORTS[key].url(year)


@pytest.fixture
def run_env(db, monkeypatch):
    monkeypatch.setattr(S, "_SEED_YEARS", 2)
    monkeypatch.setattr(S, "expected_latest_report_date", lambda now: date(2031, 3, 18))
    monkeypatch.setattr(F, "quiet", lambda now: True)
    monkeypatch.setattr(F, "_pause", lambda s: None)
    return db


def _answers():
    return {
        _url("tff", 2031): ("FinFutYY.txt", text(tff_header(), [tff_lev("2031-03-11", 300000, 100000, 5000),
                                                                tff_lev("2031-03-18", 412345, 98765, 23456)])),
        _url("tff", 2030): ("FinFutYY.txt", text(tff_header(), [tff_lev("2030-12-30", 200000, 150000, 4000)])),
        _url("disaggregated", 2031): ("f_year.txt", text(disagg_header(), [disagg_mm("2031-03-18", 250000, 40000, 30000)])),
        _url("disaggregated", 2030): 404,                                # a past year not posted
    }


def test_a_run_stores_what_it_read_and_the_next_run_asks_for_nothing(run_env, monkeypatch):
    cftc = FakeCftc(_answers())
    monkeypatch.setattr(F, "_download", cftc)
    out = F.refresh(datetime(2031, 3, 21, 21, 10, tzinfo=ET))
    assert out["state"] == "built" and out["requests"] == 4 and out["weeks"] == 4
    assert cftc.asked == [_url("tff", 2031), _url("disaggregated", 2031), _url("tff", 2030), _url("disaggregated", 2030)]
    assert out["not_posted"] == ["disaggregated 2030"]
    with S._get_conn() as conn:
        assert conn.execute("SELECT COUNT(*) FROM cot_finer_markets").fetchone()[0] == 4
        assert conn.execute("SELECT COUNT(*) FROM cot_finer_positions").fetchone()[0] == 20
        assert conn.execute("SELECT state FROM cot_finer_runs").fetchall()[-1][0] == "built"
    assert not (run_env / "cot_finer_tmp").exists()                     # nothing left on disk
    again = F.refresh(datetime(2031, 3, 22, 5, 10, tzinfo=ET))
    assert (again["state"], again["requests"]) == ("current", 0)
    assert len(cftc.asked) == 4                                         # the 404 year is not asked again


def test_a_refusal_stops_the_run_and_what_was_read_stays(run_env, monkeypatch):
    answers = _answers()
    answers[_url("disaggregated", 2031)] = 403
    monkeypatch.setattr(F, "_download", FakeCftc(answers))
    out = F.refresh(datetime(2031, 3, 21, 21, 10, tzinfo=ET))
    assert (out["state"], out["reason"]) == ("stopped", "http_403")
    assert F.market_answer("ES", 52)["state"] == "ok"                   # the TFF file read before it stays
    assert F.last_run()["state"] == "stopped"


_BAD_SHAPE = ("FinFutYY.txt", "Market_and_Exchange_Names\nX\n")       # a zip whose text has no required column


# The wrong shape left this list on 2026-11-22 on purpose: it no longer ends the run (the two tests below).
@pytest.mark.parametrize("failure, state, reason", [
    (F.TooLarge("x"), "failed", "too_large"),
    (500, "failed", "http_500"),
])
def test_a_bad_file_ends_the_run_without_touching_stored_weeks(run_env, monkeypatch, failure, state, reason):
    monkeypatch.setattr(F, "_download", FakeCftc(_answers()))
    F.refresh(datetime(2031, 3, 21, 21, 10, tzinfo=ET))
    before = F.market_answer("ES", 52)
    monkeypatch.setattr(S, "expected_latest_report_date", lambda now: date(2031, 3, 25))
    answers = _answers()
    answers[_url("tff", 2031)] = failure
    monkeypatch.setattr(F, "_download", FakeCftc(answers))
    out = F.refresh(datetime(2031, 3, 28, 21, 10, tzinfo=ET))
    assert out["state"] == state
    if reason:
        assert out["reason"] == reason
    assert F.market_answer("ES", 52)["rows"] == before["rows"]


def test_a_seed_year_of_the_wrong_shape_is_remembered_and_the_run_reads_the_years_after_it(run_env, monkeypatch):
    """One bad seed-year file used to end every run there: never stored, it was downloaded again by each run, and every
    year after it in the plan (all the Disaggregated years come after the TFF ones) was never read."""
    monkeypatch.setattr(S, "_SEED_YEARS", 3)
    answers = _answers()
    answers[_url("tff", 2030)] = _BAD_SHAPE
    answers[_url("tff", 2029)] = ("FinFutYY.txt", text(tff_header(), [tff_lev("2029-12-25", 1000, 2000, 30)]))
    answers[_url("disaggregated", 2029)] = ("f_year.txt", text(disagg_header(), [disagg_mm("2029-12-25", 4, 5, 6)]))
    cftc = FakeCftc(answers)
    monkeypatch.setattr(F, "_download", cftc)
    first = datetime(2031, 3, 21, 21, 10, tzinfo=ET)
    out = F.refresh(first)
    assert cftc.asked == [_url("tff", 2031), _url("disaggregated", 2031), _url("tff", 2030), _url("tff", 2029),
                          _url("disaggregated", 2030), _url("disaggregated", 2029)]
    assert out["state"] == "shape" and out["shape"] == ["tff 2030"] and out["reason"].startswith("tff 2030: missing")
    assert [(f["report"], f["year"]) for f in out["files"] if f["status"] == "read"] == [
        ("tff", 2031), ("disaggregated", 2031), ("tff", 2029), ("disaggregated", 2029)]
    assert F.last_run()["state"] == "shape" and F.market_answer("GC", 520)["rows"][0]["date"] == "2029-12-25"
    with S._get_conn() as conn:
        assert [tuple(r) for r in conn.execute("SELECT report, year FROM cot_finer_shape")] == [("tff", 2030)]
    # the runs of the next week do not ask for it again
    cftc.asked.clear()
    for later in (timedelta(hours=8), timedelta(days=6, hours=23)):
        again = F.refresh(first + later)
        assert (again["state"], again["requests"]) == ("current", 0)
    assert cftc.asked == []
    # a week on it is asked for once more; read well, it is stored and the record goes
    answers[_url("tff", 2030)] = ("FinFutYY.txt", text(tff_header(), [tff_lev("2030-12-30", 200000, 150000, 4000)]))
    week = F.refresh(first + timedelta(days=7, minutes=1))
    assert week["state"] == "built" and cftc.asked == [_url("tff", 2030)]
    with S._get_conn() as conn:
        assert conn.execute("SELECT COUNT(*) FROM cot_finer_shape").fetchone()[0] == 0
    assert F.refresh(first + timedelta(days=7, hours=8))["state"] == "current"


def test_the_expected_years_file_of_the_wrong_shape_is_asked_again_each_run_and_the_run_goes_on(run_env, monkeypatch):
    monkeypatch.setattr(F, "_download", FakeCftc(_answers()))
    F.refresh(datetime(2031, 3, 21, 21, 10, tzinfo=ET))
    before = F.market_answer("ES", 52)
    monkeypatch.setattr(S, "expected_latest_report_date", lambda now: date(2031, 3, 25))
    answers = _answers()
    answers[_url("tff", 2031)] = _BAD_SHAPE
    answers[_url("disaggregated", 2031)] = ("f_year.txt", text(disagg_header(), [
        disagg_mm("2031-03-18", 250000, 40000, 30000), disagg_mm("2031-03-25", 260000, 41000, 30000)]))
    cftc = FakeCftc(answers)
    monkeypatch.setattr(F, "_download", cftc)
    out = F.refresh(datetime(2031, 3, 28, 21, 10, tzinfo=ET))
    assert out["state"] == "shape" and out["shape"] == ["tff 2031"]
    assert F.market_answer("ES", 52)["rows"] == before["rows"]            # the stored weeks are untouched
    assert F.market_answer("GC", 52)["rows"][-1]["date"] == "2031-03-25"   # the file after it was still read
    with S._get_conn() as conn:
        assert conn.execute("SELECT COUNT(*) FROM cot_finer_shape").fetchone()[0] == 0   # the current year: no record
    cftc.asked.clear()
    F.refresh(datetime(2031, 3, 29, 5, 10, tzinfo=ET))
    assert cftc.asked == [_url("tff", 2031)]                               # asked again on the next run


def test_the_current_year_not_posted_yet_is_said_and_noted_nowhere(run_env, monkeypatch):
    monkeypatch.setattr(S, "_SEED_YEARS", 1)
    cftc = FakeCftc({})
    monkeypatch.setattr(F, "_download", cftc)
    out = F.refresh(datetime(2031, 3, 21, 21, 10, tzinfo=ET))
    assert out["state"] == "not_published"
    F.refresh(datetime(2031, 3, 22, 5, 10, tzinfo=ET))
    assert len(cftc.asked) == 4                                         # the current year is asked again each run
    assert F.market_answer("ES", 52)["state"] == "not_built"


def test_the_download_streams_to_disk_refuses_an_oversized_body_and_follows_no_redirect(tmp_path, monkeypatch):
    import requests

    calls = []

    class Resp:
        def __init__(self, status, chunks):
            self.status_code, self._chunks = status, chunks

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def iter_content(self, n):
            assert n == F.CHUNK_BYTES
            yield from self._chunks

    def fake_get(url, **kw):
        calls.append(kw)
        return answers.pop(0)

    monkeypatch.setattr(requests, "get", fake_get)
    monkeypatch.setattr(F, "MAX_ZIP_BYTES", 10)
    answers = [Resp(200, [b"12345", b"678"]), Resp(200, [b"123456", b"78901"]), Resp(302, [])]
    assert F._download("https://example.invalid/a.zip", str(tmp_path / "a.zip")) == 8
    with pytest.raises(F.TooLarge):
        F._download("https://example.invalid/b.zip", str(tmp_path / "b.zip"))
    with pytest.raises(F.HttpStatus) as moved:
        F._download("https://example.invalid/c.zip", str(tmp_path / "c.zip"))
    assert moved.value.status == 302
    assert all(kw["allow_redirects"] is False and kw["stream"] is True for kw in calls)


def test_runs_only_in_scan_periods_quiet_span_and_one_at_a_time(monkeypatch):
    from api.services import scan_period
    for at in ("2031-03-17 06:59", "2031-03-17 07:00", "2031-03-17 20:14", "2031-03-17 20:15", "2031-03-22 12:00"):
        when = datetime.fromisoformat(at).replace(tzinfo=ET)
        assert F.quiet(when) == scan_period._reuse_quiet_now(when), at
    started = []
    monkeypatch.setattr(F, "refresh", lambda now: started.append(now) or {"state": "current"})
    assert F.run_scheduled(datetime(2031, 3, 18, 12, 0, tzinfo=ET)) == {"started": False, "reason": "not_quiet"}
    assert started == []
    import threading
    gate = threading.Event()
    monkeypatch.setattr(F, "refresh", lambda now: gate.wait(5))
    assert F.run_scheduled(datetime(2031, 3, 18, 21, 10, tzinfo=ET)) == {"started": True}
    assert F.run_scheduled(datetime(2031, 3, 18, 21, 11, tzinfo=ET)) == {"started": False, "reason": "running"}
    assert F.building()
    gate.set()
    F.drain()
    assert not F.building()


def test_the_two_slots_are_inside_the_quiet_span_and_next_run_finds_the_next_one():
    for hour in F.RUN_HOURS_ET:
        assert F.quiet(datetime(2031, 3, 18, hour, F.RUN_MINUTE_ET, tzinfo=ET))
    assert F.next_run(datetime(2031, 3, 18, 12, 0, tzinfo=ET)).strftime("%d %H:%M") == "18 21:10"
    assert F.next_run(datetime(2031, 3, 18, 21, 10, tzinfo=ET)).strftime("%d %H:%M") == "19 05:10"
    assert F.next_run(datetime(2031, 3, 18, 4, 0, tzinfo=ET)).strftime("%d %H:%M") == "18 05:10"


# ── the request path ───────────────────────────────────────────────────────────────────────────

def test_nothing_read_yet_is_not_built_with_the_next_check(db):
    for got in (F.market_answer("GC", 52), F.board_answer()):
        assert got["state"] == "not_built" and got["next_check"] and got["source"] == F.SOURCE


def test_a_database_without_the_tables_is_not_built_and_a_broken_one_is_unavailable(tmp_path, monkeypatch):
    monkeypatch.setattr(S, "DB_PATH", str(tmp_path / "fresh.db"))
    assert F.market_answer("GC", 52)["state"] == "not_built"
    assert F.board_answer()["state"] == "not_built"
    broken = tmp_path / "broken.db"
    broken.write_bytes(b"this is not a database at all, invented" * 100)
    monkeypatch.setattr(S, "DB_PATH", str(broken))
    assert F.market_answer("GC", 52)["state"] == "unavailable"
    assert F.board_answer()["state"] == "unavailable"


def _store(rows, report_key, year=2031):
    header = tff_header() if report_key == "tff" else disagg_header()
    F.store(F.parse_report(io.StringIO(text(header, rows)), F.REPORTS[report_key]), year, 1234)


def test_one_market_oldest_first_with_its_report_classes_records_and_concentration(db):
    _store([tff_lev("2031-03-04", 1, 2, 3, name="OLD INVENTED NAME"), tff_lev("2031-03-11", 300000, 100000, 5000),
            tff_lev("2031-03-18", 412345, 98765, 23456, Conc_Gross_LE_4_TDR_Long_All="21.7")], "tff")
    got = F.market_answer("es", 52)
    assert (got["state"], got["symbol"], got["report"], got["report_name"], got["watch"]) == \
        ("ok", "ES", "tff", "Traders in Financial Futures", "leveraged_funds")
    assert [c["key"] for c in got["classes"]] == ["dealer", "asset_manager", "leveraged_funds", "other_reportable", "nonreportable"]
    assert [(c["spread"], c["traders"]) for c in got["classes"]][-1] == (False, False)
    assert [r["date"] for r in got["rows"]] == ["2031-03-04", "2031-03-11", "2031-03-18"]
    lev = got["rows"][-1]["classes"]["leveraged_funds"]
    assert (lev["long"], lev["short"], lev["spread"]) == (412345, 98765, 23456)
    assert got["rows"][-1]["open_interest"] == 500000
    assert [(r["market_name"], r["first"], r["last"]) for r in got["records"]] == [
        ("OLD INVENTED NAME", "2031-03-04", "2031-03-04"),
        ("INVENTED INDEX - INVENTED EXCHANGE", "2031-03-11", "2031-03-18")]
    assert got["concentration"]["date"] == "2031-03-18" and got["concentration"]["gross_4_long"] == 21.7
    assert [r["date"] for r in F.market_answer("ES", 2)["rows"]] == ["2031-03-11", "2031-03-18"]


def test_a_market_the_files_do_not_carry_is_no_record(db):
    _store([tff_lev("2031-03-18", 1, 2, 3)], "tff")
    got = F.market_answer("GC", 52)
    assert got["state"] == "no_record" and "rows" not in got


def test_the_board_carries_the_watched_class_of_each_report_and_its_previous_week(db):
    _store([tff_lev("2031-03-11", 300000, 100000, 5000), tff_lev("2031-03-18", 412345, 98765, 23456)], "tff")
    _store([disagg_mm("2031-03-18", 250000, 40000, 30000, oi=410000)], "disaggregated")
    got = F.board_answer()
    assert got["state"] == "ok" and got["watch"] == {"tff": "leveraged_funds", "disaggregated": "managed_money"}
    es, gc = got["markets"]["ES"], got["markets"]["GC"]
    assert (es["watch"], es["date"], es["long"], es["short"], es["spread"]) == ("leveraged_funds", "2031-03-18", 412345, 98765, 23456)
    assert (es["previous"]["date"], es["previous"]["long"], es["previous"]["short"]) == ("2031-03-11", 300000, 100000)
    assert (gc["watch"], gc["long"], gc["short"], gc["open_interest"], gc["previous"]) == ("managed_money", 250000, 40000, 410000, None)
    assert set(got["no_record"]) == set(S.SYMBOL_MAP) - {"ES", "GC"}


def test_a_failed_last_run_is_said_beside_the_stored_weeks(db):
    _store([tff_lev("2031-03-18", 1, 2, 3)], "tff")
    F._log_run({"state": "stopped", "reason": "http_403", "at": "2031-03-21T02:10:00+00:00"})
    assert F.market_answer("ES", 52)["check"] == {"at": "2031-03-21T02:10:00+00:00", "state": "stopped", "reason": "http_403"}
    F._log_run({"state": "built", "at": "2031-03-22T02:10:00+00:00"})
    assert "check" not in F.board_answer()


# ── the routes ─────────────────────────────────────────────────────────────────────────────────

FREE = {"id": "free-x", "email": "free@example.test", "role": "member", "plan": "free"}
PAID = {"id": "paid-x", "email": "paid@example.test", "role": "member", "plan": "pro"}


def _client(user):
    app = FastAPI()
    app.include_router(route.router)
    if user is not None:
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app, raise_server_exceptions=False)


def test_the_routes_are_paid_reads_that_never_start_a_download(db, monkeypatch):
    def no_download(*a, **k):
        raise AssertionError("a request must never download")
    monkeypatch.setattr(F, "_download", no_download)
    monkeypatch.setattr(F, "run_scheduled", no_download)
    monkeypatch.setattr(F, "refresh", no_download)
    for path in ("/api/cot/breakdown", "/api/cot/GC/breakdown"):
        assert _client(None).get(path).status_code == 401
        refused = _client(FREE).get(path)
        assert refused.status_code == 402 and refused.json() == {"detail": "COT data requires a paid plan"}
        assert _client(PAID).get(path).json()["state"] == "not_built"
    _store([disagg_mm("2031-03-18", 250000, 40000, 30000)], "disaggregated")
    assert _client(PAID).get("/api/cot/gc/breakdown?weeks=160").json()["rows"][0]["classes"]["managed_money"]["long"] == 250000
    assert _client(PAID).get("/api/cot/breakdown").json()["markets"]["GC"]["long"] == 250000


def test_unknown_market_and_weeks_out_of_range_answer_as_the_legacy_route(db):
    c = _client(PAID)
    assert c.get("/api/cot/NOPE/breakdown").status_code == 404
    assert c.get("/api/cot/GC/breakdown?weeks=0").status_code == 400
    assert c.get("/api/cot/GC/breakdown?weeks=521").status_code == 400


def test_the_board_route_is_declared_before_the_symbol_catch_all_and_both_are_plain_defs():
    paths = [getattr(r, "path", "") for r in route.router.routes]
    assert paths.index("/api/cot/breakdown") < paths.index("/api/cot/{symbol}")
    assert paths.index("/api/cot/{symbol}/breakdown") < paths.index("/api/cot/{symbol}")
    assert not inspect.iscoroutinefunction(route.breakdown_board)
    assert not inspect.iscoroutinefunction(route.breakdown_for_symbol)


def test_the_legacy_tables_are_never_touched(db):
    _store([tff_lev("2031-03-18", 1, 2, 3)], "tff")
    with sqlite3.connect(S.DB_PATH) as conn:
        names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert {"cot_finer_markets", "cot_finer_positions", "cot_finer_files", "cot_finer_runs"} <= names
    assert "cot_records" not in names                                    # this module creates no legacy table
