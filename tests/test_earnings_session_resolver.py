"""Rails for `earnings_session_resolver` — Time TBD is for the unsolvable only."""
from __future__ import annotations

from datetime import datetime

import pytest

from api.services import earnings_session_resolver as r


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    r._cache.clear()
    monkeypatch.delenv("CALENDAR_TBD_RESOLVER", raising=False)
    monkeypatch.setattr(r, "_cik_for", lambda sym: {"SNA": "87347", "WHR": "106640",
                                                     "PEP": "77476", "NEWCO": "1", "ASML": "937966",
                                                     "CBSH": "22356", "WHR": "106640"}.get(sym))
    yield
    r._cache.clear()


def _row(sym, **kw):
    return {"sym": sym, "eps_est": 1.0, "rev_est": None, "ew": 0, **kw}


def _sub(*filings):
    """filings = (acceptedUTC, filingDate) pairs, all Item 2.02 8-Ks."""
    return {"filings": {"recent": {                      # plus one 10-Q: a domestic filer
        "form": ["8-K"] * len(filings) + ["10-Q"],
        "items": ["2.02,9.01"] * len(filings) + [""],
        "acceptanceDateTime": [a for a, _ in filings] + ["2026-08-05T20:00:00.000Z"],
        "filingDate": [f for _, f in filings] + ["2026-08-05"],
    }}}


# ── the acceptance-time -> session mapping (measured cases) ─────────────────

@pytest.mark.parametrize("accepted, filed, want", [
    ("2026-07-23T10:31:34.000Z", "2026-07-23", "bmo"),   # SNA 06:31 ET
    ("2026-07-23T17:29:00.000Z", "2026-07-23", "bmo"),   # 13:29 ET: 8-K lags a morning release
    ("2026-08-03T20:15:27.000Z", "2026-08-03", "amc"),   # WHR 16:15 ET
    ("2026-07-23T00:04:00.000Z", "2026-07-22", "amc"),   # 20:04 ET, same-day date
    ("2026-10-08T01:57:44.000Z", "2026-10-08", "bmo"),   # PEP: 21:57 ET dated the NEXT day
])
def test_filing_session_mapping(accepted, filed, want):
    assert r.filing_session(accepted, filed) == want


def test_filing_session_unparseable_is_unknown_not_a_guess():
    assert r.filing_session("garbage", "2026-01-01") is None


# ── history needs unanimity and depth ───────────────────────────────────────

def test_this_quarters_filing_answers_directly():
    got = r.session_from_filings([("2026-10-14", "amc"), ("2026-07-15", "bmo")], "2026-10-14")
    assert got == ("amc", "edgar_filing")


def test_unanimous_history_infers():
    f = [("2026-07-23", "bmo"), ("2026-04-23", "bmo"), ("2026-02-05", "bmo")]
    assert r.session_from_filings(f, "2026-10-16") == ("bmo", "edgar_history")


def test_split_history_stays_unknown():
    f = [("2026-07-23", "bmo"), ("2026-04-23", "amc"), ("2026-02-05", "bmo")]
    assert r.session_from_filings(f, "2026-10-16") is None


def test_two_filings_are_not_enough_history():
    assert r.session_from_filings([("2026-07-23", "bmo"), ("2026-04-23", "bmo")], "2026-10-16") is None


# ── the pure decision ───────────────────────────────────────────────────────

WEEK = {"2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"}
HIST_BMO = [("2026-07-23", "bmo"), ("2026-04-23", "bmo"), ("2026-02-05", "bmo")]


def test_confirmed_later_week_is_dropped():          # CBSH: FMP Oct 14, confirmed Oct 20
    act = r.decide("2026-10-14", WEEK, True, ("2026-10-20", "bmo"), None, HIST_BMO, False)
    assert act[0] == "drop"


def test_confirmed_other_day_this_week_is_moved():
    act = r.decide("2026-10-13", WEEK, True, ("2026-10-15", "amc"), None, None, True)
    assert act == ("place", "2026-10-15", "amc", "nasdaq", True)


def test_yahoo_confirmation_counts_when_nasdaq_is_silent():
    y = {"date": "2026-10-22", "session": "amc", "confirmed": True}   # GBCI
    assert r.decide("2026-10-15", WEEK, True, None, y, None, True)[0] == "drop"


def test_conflicting_estimate_outside_the_week_is_dropped():
    y = {"date": "2026-10-28", "session": "amc", "confirmed": False}  # WHR
    assert r.decide("2026-10-15", WEEK, True, None, y, None, True)[0] == "drop"


def test_unconfirmed_but_consistent_keeps_its_day_and_takes_history():
    y = {"date": "2026-10-16", "session": "amc", "confirmed": False}
    assert r.decide("2026-10-16", WEEK, True, None, y, HIST_BMO, True) ==         ("place", "2026-10-16", "bmo", "edgar_history", False)


def test_unconfirmed_falls_back_to_yahoo_estimate_time():
    y = {"date": "2026-10-16", "session": "amc", "confirmed": False}
    assert r.decide("2026-10-16", WEEK, True, None, y, None, True) ==         ("place", "2026-10-16", "amc", "yahoo_estimate", False)


def test_projected_row_with_a_session_is_left_alone_when_nothing_contradicts_it():
    y = {"date": "2026-10-16", "session": "bmo", "confirmed": False}
    assert r.decide("2026-10-16", WEEK, True, None, y, None, False) is None


def test_past_day_only_takes_a_session_never_a_date():
    act = r.decide("2026-10-12", WEEK, False, ("2026-10-20", "bmo"), None,
                   [("2026-10-12", "amc")], True)
    assert act == ("place", "2026-10-12", "amc", "edgar_filing", True)


def test_yahoo_answer_reads_the_estimate_flag():
    ts = datetime(2026, 10, 22, 16, 0, tzinfo=r._ET).timestamp()
    assert r.yahoo_answer({"earningsTimestampStart": ts, "isEarningsDateEstimate": False}) ==         {"date": "2026-10-22", "session": "amc", "confirmed": True}
    assert r.yahoo_answer({}) is None


# ── the pass ────────────────────────────────────────────────────────────────

def _days():
    return {
        "2026-10-14": {"bmo": [_row("BAC"), _row("CBSH", date_est=True)], "amc": [],
                       "tbd": [_row("ASML"), _row("NEWCO"), _row("ZZZZ")]},
        "2026-10-15": {"bmo": [], "amc": [], "tbd": [_row("SNA"), _row("WHR")]},
        "2026-10-16": {"bmo": [], "amc": [], "tbd": []},
    }


NASDAQ = {"2026-10-14": [("ASML", "time-pre-market"), ("BAC", "time-after-hours")],
          "2026-10-20": [("CBSH", "time-pre-market")]}
YAHOO = {"SNA": {"earningsTimestampStart": datetime(2026, 10, 15, 6, 30, tzinfo=r._ET).timestamp(),
                 "isEarningsDateEstimate": True},
         "WHR": {"earningsTimestampStart": datetime(2026, 10, 28, 16, 0, tzinfo=r._ET).timestamp(),
                 "isEarningsDateEstimate": True}}


def _fakes(monkeypatch):
    monkeypatch.setattr(r, "_nasdaq_fetch", lambda ds: {"data": {"rows": [
        {"symbol": s, "time": t} for s, t in NASDAQ.get(ds, [])]}})
    monkeypatch.setattr(r, "_yahoo_fetch", lambda s: YAHOO.get(s))
    monkeypatch.setattr(r, "_sec_fetch", _sec)
    monkeypatch.setattr(r, "_press_fetch", lambda s: [])
    monkeypatch.setattr(r, "_ew_fetch", lambda ds: [])


def _sec(cik):
    return {"87347": _sub(("2026-07-23T10:31:34.000Z", "2026-07-23"),
                          ("2026-04-23T10:31:55.000Z", "2026-04-23"),
                          ("2026-02-05T11:30:56.000Z", "2026-02-05")),
            "1": _sub(("2026-07-23T20:15:00.000Z", "2026-07-23"),
                      ("2026-04-23T12:00:00.000Z", "2026-04-23"),
                      ("2026-02-05T21:00:00.000Z", "2026-02-05"))}.get(cik, _sub())


def _syms(day, b):
    return [e["sym"] for e in day[b]]


def test_the_pass_verifies_dates_and_sessions(monkeypatch):
    _fakes(monkeypatch)
    days = _days()
    stats = r.resolve_tbd_sessions(days, today_str="2026-10-10")
    d14, d15 = days["2026-10-14"], days["2026-10-15"]
    assert _syms(d14, "bmo") == ["ASML", "BAC"]          # CBSH gone: confirmed Oct 20
    assert d14["bmo"][0]["session_src"] == "nasdaq" and d14["bmo"][0]["date_confirmed"]
    assert "session_src" not in d14["bmo"][1]            # BAC was confirmed: untouched
    assert _syms(d14, "tbd") == ["NEWCO", "ZZZZ"]        # split history / no CIK
    assert _syms(d15, "bmo") == ["SNA"]                  # unanimous 06:30 history
    assert d15["bmo"][0]["session_src"] == "edgar_history"
    assert "WHR" not in [e["sym"] for b in ("bmo", "amc", "tbd") for e in d15[b]]
    assert stats["dropped"] == 2 and stats["left_tbd"] == 2


def test_provider_outage_changes_nothing_and_never_raises(monkeypatch):
    def boom(*a):
        raise RuntimeError("down")
    for n in ("_nasdaq_fetch", "_yahoo_fetch", "_sec_fetch", "_press_fetch", "_ew_fetch"):
        monkeypatch.setattr(r, n, boom)
    days = _days()
    r.resolve_tbd_sessions(days, today_str="2026-10-10")
    assert days == _days()


def test_kill_switch(monkeypatch):
    monkeypatch.setenv("CALENDAR_TBD_RESOLVER", "0")
    _fakes(monkeypatch)
    days = _days()
    assert not r.resolve_tbd_sessions(days, today_str="2026-10-10")
    assert days == _days()


def test_both_week_builders_call_the_resolver():
    """An AST check that the pass is WIRED, with a control that can see a sibling."""
    import ast
    import pathlib
    src = pathlib.Path("api/routers/calendar.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    calls = {}
    for fn in ast.walk(tree):
        if isinstance(fn, ast.FunctionDef):
            calls[fn.name] = {c.func.id for c in ast.walk(fn)
                              if isinstance(c, ast.Call) and isinstance(c.func, ast.Name)}
    assert "_attach_names" in calls["_build_range_week"]          # control
    assert "_resolve_tbd_sessions" in calls["_build_range_week"]
    assert "_resolve_tbd_sessions" in calls["_build_current_week"]


# ── the four rules added after reviewing every decision on the live week ────

@pytest.mark.parametrize("text, want", [
    ("Glacier Bancorp, Inc. (NYSE: GBCI) will report third quarter financial results "
     "after the market closes on October 22, 2026. A conference call", ("2026-10-22", "amc")),
    ("expects to report its financial results for the quarter ended September 30, 2026, "
     "after the stock market closes on Friday, October 23, 2026.", ("2026-10-23", "amc")),
    ("will release its third quarter results on Tuesday, October 20, 2026, prior to the "
     "market opening.", ("2026-10-20", "bmo")),
    ("The dividend is payable on October 22, 2026 to holders of record.", None),
])
def test_parse_announcement(text, want):
    assert r.parse_announcement(text) == want


def test_a_press_release_confirmation_moves_the_row_out():          # RCBC
    act = r.decide("2026-10-15", WEEK, True, None, None, None, True,
                   press=("2026-10-23", "amc"), today_str="2026-10-10")
    assert act[0] == "drop" and "press_release" in act[1]


def test_an_unconfirmed_no_10q_filer_is_dropped():                # HKD
    y = {"date": "2026-10-12", "session": "amc", "confirmed": False}
    act = r.decide("2026-10-12", WEEK, True, None, y, None, False, no_10q=True,
                   today_str="2026-10-10")
    assert act[0] == "drop"


def test_a_stale_yahoo_date_is_not_evidence():                      # PBAM
    y = {"date": "2025-07-18", "session": "bmo", "confirmed": False}
    act = r.decide("2026-10-16", WEEK, True, None, y, HIST_BMO, True, today_str="2026-10-10")
    assert act == ("place", "2026-10-16", "bmo", "edgar_history", False)


def test_yahoo_estimate_in_week_beats_the_fmp_projection():         # BANF
    y = {"date": "2026-10-16", "session": "amc", "confirmed": False}
    act = r.decide("2026-10-15", WEEK, True, None, y, None, True, today_str="2026-10-10")
    assert act == ("place", "2026-10-16", "amc", "yahoo_estimate", False)


def test_foreign_flag_end_to_end(monkeypatch):
    monkeypatch.setattr(r, "_cik_for", lambda s: "9")
    monkeypatch.setattr(r, "_sec_fetch", lambda c: {"filings": {"recent": {
        "form": ["6-K", "20-F"], "items": ["", ""],
        "acceptanceDateTime": ["2026-09-30T13:15:00.000Z"] * 2, "filingDate": ["2026-09-30"] * 2}}})
    assert r._company("HKD")["no_10q"] is True


def test_yahoo_answering_with_no_date_drops_an_fmp_only_projection():   # ALOY
    act = r.decide("2026-10-14", WEEK, True, None,
                   {"date": None, "session": None, "confirmed": False}, None, True,
                   today_str="2026-10-10")
    assert act[0] == "drop"


def test_a_yahoo_failure_is_not_an_answer():
    assert r.yahoo_answer(None) is None
    assert r.decide("2026-10-14", WEEK, True, None, None, None, True, today_str="2026-10-10") is None


def test_release_history_gives_the_session():                          # PBAM 08:00
    act = r.decide("2026-10-16", WEEK, True, None,
                   {"date": "2026-10-16", "session": None, "confirmed": False}, None, True,
                   today_str="2026-10-10", release_history="bmo")
    assert act == ("place", "2026-10-16", "bmo", "release_history", False)


def test_press_history_needs_its_releases_to_agree(monkeypatch):
    monkeypatch.setattr(r, "_press_fetch", lambda s: [
        {"publishedDate": "2026-07-16 08:00:00", "title": "PBAM Announces Net Income for Second Quarter 2026"},
        {"publishedDate": "2026-04-16 08:00:00", "title": "PBAM Reports First Quarter 2026 Results"},
        {"publishedDate": "2026-07-29 16:20:00", "title": "PBAM Announces Uplisting"}])
    assert r._press("PBAM", "2026-10-10") == {"announced": None, "history": "bmo"}
    r._cache.clear()
    monkeypatch.setattr(r, "_press_fetch", lambda s: [
        {"publishedDate": "2026-07-16 08:00:00", "title": "PBAM Reports Second Quarter 2026 Results"}])
    assert r._press("PBAM", "2026-10-10")["history"] == "bmo"     # one release, uncontested
    r._cache.clear()
    monkeypatch.setattr(r, "_press_fetch", lambda s: [
        {"publishedDate": "2026-07-16 08:00:00", "title": "PBAM Reports Second Quarter 2026 Results"},
        {"publishedDate": "2026-04-16 16:05:00", "title": "PBAM Reports First Quarter 2026 Results"}])
    assert r._press("PBAM", "2026-10-10")["history"] is None      # releases disagree


def test_earningswhispers_confirmed_rows_count_and_unconfirmed_do_not(monkeypatch):
    monkeypatch.setattr(r, "_ew_fetch", lambda ds: [
        {"ticker": "MTB", "releaseTime": 1, "confirmDate": "2026-09-30T07:12:32"},
        {"ticker": "AA", "releaseTime": 3, "confirmDate": "2026-09-15T15:42:53"},
        {"ticker": "XX", "releaseTime": 1, "confirmDate": None}])
    monkeypatch.setattr(r, "_nasdaq_fetch", lambda ds: {"data": {"rows": [
        {"symbol": "AA", "time": "time-pre-market"}]}})
    got = r._confirmed_day("2026-10-16")
    assert got == {"MTB": ("bmo", "earningswhispers"), "AA": ("bmo", "nasdaq")}


def test_a_during_market_release_history_beats_the_8k_proxy():        # WABC 11:04 ET
    y = {"date": "2026-10-15", "session": None, "confirmed": False}
    act = r.decide("2026-10-15", WEEK, True, None, y, HIST_BMO, True,
                   today_str="2026-10-10", release_history="dmh")
    assert act == ("place", "2026-10-15", "tbd", "release_history", False)


def test_release_history_marks_in_session_releases(monkeypatch):
    monkeypatch.setattr(r, "_press_fetch", lambda s: [
        {"publishedDate": "2026-07-16 11:04:00",
         "title": "Westamerica Bancorporation Reports Second Quarter 2026 Financial Results"}])
    assert r._press("WABC", "2026-10-10")["history"] == "dmh"
