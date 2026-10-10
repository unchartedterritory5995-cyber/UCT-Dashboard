"""Rails for `earnings_session_resolver` — Time TBD is for the unsolvable only."""
from __future__ import annotations

import pytest

from api.services import earnings_session_resolver as r


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    r._cache.clear()
    monkeypatch.delenv("CALENDAR_TBD_RESOLVER", raising=False)
    monkeypatch.setattr(r, "_cik_for", lambda sym: {"SNA": "87347", "WHR": "106640",
                                                     "PEP": "77476", "NEWCO": "1"}.get(sym))
    yield
    r._cache.clear()


def _row(sym, **kw):
    return {"sym": sym, "eps_est": 1.0, "rev_est": None, "ew": 0, **kw}


def _sub(*filings):
    """filings = (acceptedUTC, filingDate) pairs, all Item 2.02 8-Ks."""
    return {"filings": {"recent": {
        "form": ["8-K"] * len(filings),
        "items": ["2.02,9.01"] * len(filings),
        "acceptanceDateTime": [a for a, _ in filings],
        "filingDate": [f for _, f in filings],
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


# ── the pass ────────────────────────────────────────────────────────────────

def _days():
    return {"2026-10-14": {"bmo": [_row("BAC")], "amc": [],
                           "tbd": [_row("ASML"), _row("SNA"), _row("NEWCO"), _row("ZZZZ")]}}


def _nasdaq(ds):
    return {"data": {"rows": [{"symbol": "ASML", "time": "time-pre-market"},
                              {"symbol": "SNA", "time": "time-not-supplied"},
                              {"symbol": "ZZZZ", "time": "time-not-supplied"}]}}


def _sec(cik):
    return {"87347": _sub(("2026-07-23T10:31:34.000Z", "2026-07-23"),
                          ("2026-04-23T10:31:55.000Z", "2026-04-23"),
                          ("2026-02-05T11:30:56.000Z", "2026-02-05")),
            "1": _sub(("2026-07-23T20:15:00.000Z", "2026-07-23"),
                      ("2026-04-23T12:00:00.000Z", "2026-04-23"),
                      ("2026-02-05T21:00:00.000Z", "2026-02-05"))}[cik]


def test_resolves_what_is_knowable_and_leaves_the_rest(monkeypatch):
    monkeypatch.setattr(r, "_nasdaq_fetch", _nasdaq)
    monkeypatch.setattr(r, "_sec_fetch", _sec)
    days = _days()
    stats = r.resolve_tbd_sessions(days)
    day = days["2026-10-14"]
    assert [e["sym"] for e in day["bmo"]] == ["ASML", "BAC", "SNA"]
    assert {e["sym"]: e.get("session_src") for e in day["bmo"]} == {
        "ASML": "nasdaq", "BAC": None, "SNA": "edgar_history"}
    # NEWCO's history disagrees with itself, ZZZZ has no CIK: both stay TBD.
    assert [e["sym"] for e in day["tbd"]] == ["NEWCO", "ZZZZ"]
    assert stats == {"nasdaq": 1, "edgar_history": 1, "left": 2}


def test_a_decided_session_is_never_touched(monkeypatch):
    monkeypatch.setattr(r, "_nasdaq_fetch",
                        lambda ds: {"data": {"rows": [{"symbol": "BAC", "time": "time-after-hours"}]}})
    monkeypatch.setattr(r, "_sec_fetch", _sec)
    days = _days()
    r.resolve_tbd_sessions(days)
    assert "BAC" in [e["sym"] for e in days["2026-10-14"]["bmo"]]
    assert "BAC" not in [e["sym"] for e in days["2026-10-14"]["amc"]]


def test_provider_outage_leaves_rows_in_tbd_and_never_raises(monkeypatch):
    def boom(*a):
        raise RuntimeError("down")
    monkeypatch.setattr(r, "_nasdaq_fetch", boom)
    monkeypatch.setattr(r, "_sec_fetch", boom)
    days = _days()
    stats = r.resolve_tbd_sessions(days)
    assert len(days["2026-10-14"]["tbd"]) == 4
    assert stats == {"left": 4}


def test_kill_switch(monkeypatch):
    monkeypatch.setenv("CALENDAR_TBD_RESOLVER", "0")
    monkeypatch.setattr(r, "_nasdaq_fetch", _nasdaq)
    days = _days()
    assert not r.resolve_tbd_sessions(days)
    assert len(days["2026-10-14"]["tbd"]) == 4


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
