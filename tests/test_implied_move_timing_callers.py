"""Accuracy follow-up 1 (audit 2026-10-06, design note 5): the three implied-move
callers that knew only (symbol, date) now pass the report's session.

An AFTER-CLOSE report needs the first expiry STRICTLY after the report date; a
same-day expiry settles at 4 PM, before the print. Independent reference: the
expiry a trader would pick by hand for NVDA reporting Wed 2026-10-07 after the
close, with Wed/Fri expiries listed, is Fri 2026-10-09.

No network: every vendor seam is stubbed.
"""
from __future__ import annotations

import pytest

from api.services import implied_move as im

EXPIRIES = ["2026-10-07", "2026-10-09", "2026-10-16"]


def _hand_pick(report_date: str, after_close: bool) -> str:
    """Independent reference, written without the product: first listed expiry
    that settles after the print (strictly later day for AMC; same day allowed
    for a pre-market / unknown print)."""
    for e in EXPIRIES:
        if e > report_date or (e == report_date and not after_close):
            return e
    raise AssertionError("no expiry")


@pytest.fixture(autouse=True)
def _fresh_timing_cache():
    im._timing_cache.clear()
    yield
    im._timing_cache.clear()


def _fake_get_implied_move(calls):
    """Stands in for earnings_enrichment.get_implied_move; records the call and
    picks the expiry with the product's own rule so the end result is checkable
    against the hand reference."""
    def fake(sym, earnings_date=None, timing=None):
        calls.append((sym, earnings_date, timing))
        return {"pct": 8.1, "expiry": im.select_report_expiry(EXPIRIES, earnings_date, timing)}
    return fake


# ── report_timing: sources, order, default ───────────────────────────────────

def test_report_timing_reads_the_engine_weekly_calendar_first(monkeypatch):
    from api.services import engine
    monkeypatch.setattr(engine, "_load_wire_data", lambda: {"weekly_calendar": {
        "2026-10-07": {"bmo": [{"sym": "JPM"}], "amc": [{"sym": "NVDA"}]}}})
    monkeypatch.setattr(im, "_finnhub_timing", lambda s, d: pytest.fail("wire answered; no vendor call"))
    assert im.report_timing("nvda", "2026-10-07") == "amc"
    assert im.report_timing("JPM", "2026-10-07") == "bmo"


def test_report_timing_falls_back_to_finnhub_hour(monkeypatch):
    from api.services import earnings_estimates as ee
    monkeypatch.setattr(im, "_wire_timing", lambda s, d: None)
    seen = []

    def fh(path, params):
        seen.append((path, params))
        return {"earningsCalendar": [{"symbol": "TSLA", "date": "2026-10-21", "hour": "amc"}]}
    monkeypatch.setattr(ee, "_fh_get", fh)
    assert im.report_timing("TSLA", "2026-10-21") == "amc"
    assert seen == [("/calendar/earnings", {"symbol": "TSLA", "from": "2026-10-21", "to": "2026-10-21"})]


def test_report_timing_unknown_is_none_and_is_cached(monkeypatch):
    """dmh / '' / not listed / a failure are all UNKNOWN (None) -> the documented
    on-or-after default. The answer, None included, is cached per (sym, date)."""
    from api.services import earnings_estimates as ee
    monkeypatch.setattr(im, "_wire_timing", lambda s, d: (_ for _ in ()).throw(RuntimeError("disk")))
    n = []

    def fh(path, params):
        n.append(1)
        return {"earningsCalendar": [{"date": "2026-10-22", "hour": "dmh"}]}
    monkeypatch.setattr(ee, "_fh_get", fh)
    assert im.report_timing("XYZ", "2026-10-22") is None
    assert im.report_timing("XYZ", "2026-10-22") is None
    assert len(n) == 1, "a None answer must be cached too, or every read re-asks the vendor"
    assert im.report_timing("XYZ", None) is None
    assert im.report_timing("", "2026-10-22") is None
    assert im.report_timing("XYZ", "not-a-date") is None


# ── the three callers ─────────────────────────────────────────────────────────

def test_erx_panel_read_passes_the_session_and_picks_the_post_print_expiry(monkeypatch):
    from api.services import earnings_enrichment as ee
    from api.services import earnings_reaction_panel as p
    calls = []
    monkeypatch.setattr(ee, "get_implied_move", _fake_get_implied_move(calls))
    monkeypatch.setattr(im, "report_timing", lambda s, d: "amc")
    p._implied.pop("NVDA", None)
    p._read_implied("NVDA", "2026-10-07")
    assert calls == [("NVDA", "2026-10-07", "amc")]
    _, res = p._implied["NVDA"]
    assert res["expiry"] == _hand_pick("2026-10-07", after_close=True) == "2026-10-09"
    assert res["timing"] == "amc"
    p._implied.pop("NVDA", None)


def test_erx_panel_unknown_session_keeps_the_same_day_expiry(monkeypatch):
    from api.services import earnings_enrichment as ee
    from api.services import earnings_reaction_panel as p
    calls = []
    monkeypatch.setattr(ee, "get_implied_move", _fake_get_implied_move(calls))
    monkeypatch.setattr(im, "report_timing", lambda s, d: None)
    p._implied.pop("JPM", None)
    p._read_implied("JPM", "2026-10-07")
    _, res = p._implied["JPM"]
    assert res["expiry"] == _hand_pick("2026-10-07", after_close=False) == "2026-10-07"
    p._implied.pop("JPM", None)


def test_discord_chart_context_passes_the_session(monkeypatch):
    from api.services import discord_chart_context as dcc
    from api.services import earnings_enrichment as ee
    calls = []
    monkeypatch.setattr(ee, "get_implied_move", _fake_get_implied_move(calls))
    monkeypatch.setattr(im, "report_timing", lambda s, d: "amc")
    out = dcc._implied("NVDA", "2026-10-07")
    assert calls == [("NVDA", "2026-10-07", "amc")]
    assert out["expiry"] == "2026-10-09"


def test_enrichment_uses_the_callers_session_before_resolving(monkeypatch):
    from api.services import earnings_enrichment as ee
    calls = []
    monkeypatch.setattr(ee, "get_implied_move", _fake_get_implied_move(calls))
    monkeypatch.setattr(im, "report_timing", lambda s, d: pytest.fail("caller already knew the session"))
    assert ee._implied_for_report("NVDA", "2026-10-07", "AMC")["expiry"] == "2026-10-09"
    monkeypatch.setattr(im, "report_timing", lambda s, d: "amc")
    assert ee._implied_for_report("NVDA", "2026-10-07", None)["expiry"] == "2026-10-09"
    assert [c[2] for c in calls] == ["AMC", "amc"]


def test_enrich_earnings_response_wires_timing_into_the_implied_leg(monkeypatch):
    from api.services import earnings_enrichment as ee
    for name in ("get_pre_earnings_context", "get_estimate_revisions", "get_key_quotes"):
        monkeypatch.setattr(ee, name, lambda *a, **k: None)
    monkeypatch.setattr(ee, "get_historical_earnings_moves", lambda *a, **k: None)
    monkeypatch.setattr(ee, "extract_beat_surprises", lambda *a, **k: None)
    calls = []
    monkeypatch.setattr(ee, "get_implied_move", _fake_get_implied_move(calls))
    out = ee.enrich_earnings_response("NVDA", [], "2026-10-07", timing="AMC")
    assert out["implied_move"]["expiry"] == "2026-10-09"
    assert calls == [("NVDA", "2026-10-07", "AMC")]


def test_engine_row_timing_reads_the_rows_session_and_treats_tbd_as_unknown():
    from api.services.engine import _row_timing
    assert _row_timing({"session": "AMC"}) == "AMC"
    assert _row_timing({"hour": "bmo"}) == "bmo"
    assert _row_timing({"session": "TBD"}) is None
    assert _row_timing({"session": ""}) is None
    assert _row_timing(None) is None
