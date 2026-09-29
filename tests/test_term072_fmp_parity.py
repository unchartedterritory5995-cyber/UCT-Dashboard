"""TERM-072 (FB-A3-01) -- parity for every module moved off `earnings_estimates._fmp_get`.

WHAT IS PROVED, AND HOW.

The migration swaps a TRANSPORT (the legacy helper's bare `requests.get`) for
the D1 adapter (`fmp_client`'s typed functions over `_session`) and leaves every
parser alone. So the claim is: for the same HTTP outcome, every migrated
function returns the same parsed value AND fires the same request.

The fake below answers BOTH transports from one table -- `requests.get` (what
`_fmp_get` calls) and `fmp_client._session.get` (what the adapter calls) -- so
this file runs unchanged against the legacy code and against the migrated code.
The goldens in `fixtures/term072_fmp_parity_goldens.json` were RECORDED FROM THE
LEGACY CODE (base `322d92f86`, before any call site moved) and are the contract:

  * `output`   -- the function's return value, JSON-normalised;
  * `requests` -- every FMP request, as (path, params minus the key, timeout).

Seven HTTP outcomes per function: a recorded body, an empty `[]`, a 500, a
timeout, a non-JSON body, a 403, and no API key at all.

⚠️ Two transport differences are the ADAPTER'S DECLARED CONTRACT, not drift, and
are the only places this file relaxes equality:
  * 403 -- the adapter caches the refusal per PATH for 24h, so a second call to
    the same path in one run is answered locally instead of re-fired. The
    OUTPUT is still compared; the request list is not.
  * `get_institutional_ownership_holders` always sends `page=0` (FMP's own
    default page). Stripped from that one path's params before comparing.

Bodies: the analyst and 13F ones are the LIVE CAPTURES already checked into
`test_analyst_intel_fmp_shapes.py` / `test_institutional_holdings_fmp_shapes.py`
(imported, never copied); the rest are built from the field names each parser
reads, and say so.
"""
from __future__ import annotations

import copy
import datetime as _dt
import json
import pathlib

import pytest
import requests

from api.services import fmp_client as fc
from api.services.cache import cache
from tests.test_analyst_intel_fmp_shapes import (
    GRADES_NEWS_FIXTURE, PRICE_TARGET_CONSENSUS_FIXTURE)
from tests.test_institutional_holdings_fmp_shapes import EXTRACT_ANALYTICS_HOLDER_FIXTURE

GOLDENS_PATH = pathlib.Path(__file__).parent / "fixtures" / "term072_fmp_parity_goldens.json"
# Built by concatenation so this file is not itself an FMP reach to a grep.
_FMP_HOST = "https://financialmodeling" + "prep.com"

MODES = ("ok", "empty", "http500", "timeout", "nonjson", "http403", "nokey")

# ── recorded / constructed response bodies, by FMP path ─────────────────────
# Constructed (not captured) bodies carry only fields the parsers read, with
# realistic values; forward rows sit in 2099 and past rows in 2001 so no case
# depends on the day the suite runs.
_PROFILE = [{
    "symbol": "AAPL", "companyName": "Apple Inc.", "description": "Designs phones.",
    "sector": "Technology", "industry": "Consumer Electronics", "ceo": "Tim Cook",
    "fullTimeEmployees": "164000", "city": "Cupertino", "state": "CA",
    "country": "US", "ipoDate": "1980-12-12", "exchange": "NASDAQ",
    "currency": "USD", "website": "https://www.apple.com", "marketCap": 3.1e12,
    "beta": 1.2, "range": "164.08-260.1", "averageVolume": 5.5e7, "lastDiv": 1.0,
    "price": 227.5, "isEtf": False, "isFund": False, "isActivelyTrading": True,
    "cik": "0000320193",
}]
_GRADES_CONSENSUS = [{"symbol": "AAPL", "strongBuy": 2, "buy": 30, "hold": 8,
                      "sell": 1, "strongSell": 0, "consensus": "Buy"}]
_INCOME_ANNUAL = [
    {"date": "2025-09-27", "calendarYear": "2025", "epsdiluted": 6.08, "eps": 6.11, "revenue": 4.16e11},
    {"date": "2024-09-28", "calendarYear": "2024", "epsdiluted": 6.08, "eps": 6.11, "revenue": 3.91e11},
    {"date": "2023-09-30", "calendarYear": "2023", "eps": 6.13, "revenue": 3.83e11},
    {"date": "bogus", "eps": 1.0},
]
_INCOME_QUARTER = [
    {"date": "2026-06-30", "period": "Q2", "fiscalYear": "2026", "eps": 2.5, "revenue": 6.9e9,
     "netIncome": 1.3e9, "acceptedDate": "2026-07-24 16:05:00"},
    {"date": "2026-03-31", "period": "Q1", "fiscalYear": "2026", "eps": 2.9, "revenue": 7.1e9,
     "netIncome": 1.4e9, "acceptedDate": "2026-04-17 16:05:00"},
    {"date": "2025-12-31", "period": "Q4", "fiscalYear": "2025", "eps": 2.1, "revenue": 6.4e9,
     "netIncome": 1.1e9, "acceptedDate": "2026-01-29 16:05:00"},
    {"date": "2025-09-30", "period": "Q3", "fiscalYear": "2025", "eps": 1.9, "revenue": 6.1e9,
     "netIncome": 0.9e9, "acceptedDate": "2025-10-16 16:05:00"},
    {"date": "2025-06-30", "period": "Q2", "fiscalYear": "2025", "eps": 2.0, "revenue": 6.0e9,
     "netIncome": 1.0e9, "acceptedDate": "2025-07-17 16:05:00"},
]
_ANALYST_ESTIMATES = [
    {"date": "2099-09-30", "epsAvg": 9.1, "revenueAvg": 5.1e11},
    {"date": "2098-09-30", "epsAvg": 8.2, "revenueAvg": 4.9e11},
    {"date": "2098-06-30", "epsAvg": 2.1, "revenueAvg": 1.2e11},
    {"date": "2001-09-30", "epsAvg": 0.1, "revenueAvg": 1.0e9},
    {"date": "2097-12-31", "epsAvg": None, "revenueAvg": 0},
]
_EARNINGS = [
    {"symbol": "AAPL", "date": "2099-01-29", "epsActual": None, "epsEstimated": 2.35,
     "revenueActual": None, "revenueEstimated": 1.24e11},
    {"symbol": "AAPL", "date": "2098-10-30", "epsActual": None, "epsEstimated": 1.6,
     "revenueActual": None, "revenueEstimated": 1.0e11},
    {"symbol": "AAPL", "date": "2001-07-31", "epsActual": 1.57, "epsEstimated": 1.43,
     "revenueActual": 9.4e10, "revenueEstimated": 8.9e10},
]
_EARNINGS_CALENDAR = [
    {"symbol": "AAA", "date": "2026-08-09", "epsActual": 1.0, "revenueActual": 5.0e9},
    {"symbol": "DIS", "date": "2026-08-09", "epsActual": 1.6, "revenueActual": 2.3e10},
    {"symbol": "PEND", "date": "2026-08-09", "epsActual": None, "revenueActual": None},
    {"symbol": "600641.SS", "date": "2026-08-09", "epsActual": 1.0, "revenueActual": 1.0},
    {"symbol": "NEW", "date": "2026-08-09", "epsActual": 0.2, "revenueActual": None},
]

BODIES = {
    "/stable/profile": _PROFILE,
    "/stable/grades-consensus": _GRADES_CONSENSUS,
    "/stable/price-target-consensus": PRICE_TARGET_CONSENSUS_FIXTURE,
    "/stable/grades-news": GRADES_NEWS_FIXTURE,
    "/stable/income-statement": None,          # period-dependent, see _body_for
    "/stable/analyst-estimates": _ANALYST_ESTIMATES,
    "/stable/earnings": _EARNINGS,
    "/stable/earnings-calendar": _EARNINGS_CALENDAR,
    "/stable/institutional-ownership/extract-analytics/holder": EXTRACT_ANALYTICS_HOLDER_FIXTURE,
}


def _body_for(path: str, params: dict):
    if path == "/stable/income-statement":
        return _INCOME_QUARTER if params.get("period") == "quarter" else _INCOME_ANNUAL
    return BODIES[path]


# ── the fake: ONE table, BOTH transports ────────────────────────────────────
class _NonJSON:
    pass


class _Resp:
    def __init__(self, status: int, body=None):
        self.status_code = status
        self._body = body
        self.text = "" if body is None else json.dumps(body, default=str)

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.exceptions.HTTPError(f"{self.status_code}")

    def json(self):
        if isinstance(self._body, _NonJSON):
            raise ValueError("not json")
        return copy.deepcopy(self._body)


class _FakeFMP:
    def __init__(self, mode: str):
        self.mode = mode
        self.calls: list[dict] = []

    def __call__(self, transport: str):
        def _get(url, params=None, timeout=None, **_kw):
            if not str(url).startswith(_FMP_HOST):
                return _Resp(404)                      # any non-FMP tier fails closed
            path = str(url)[len(_FMP_HOST):]
            clean = {k: v for k, v in (params or {}).items() if k != "apikey"}
            self.calls.append({"transport": transport, "path": path,
                               "params": clean, "timeout": timeout})
            if self.mode == "timeout":
                raise requests.exceptions.Timeout("read timed out")
            if self.mode == "http500":
                return _Resp(500)
            if self.mode == "http403":
                return _Resp(403)
            if self.mode == "nonjson":
                return _Resp(200, _NonJSON())
            if self.mode == "empty":
                return _Resp(200, [])
            return _Resp(200, _body_for(path, clean))
        return _get


# ── the cases: every function that held a migrated call site ────────────────
_FIXED_NOW = _dt.datetime(2026, 8, 9, 15, 0, tzinfo=_dt.timezone.utc).timestamp()


def _case_analyst_consensus(mp):
    from api.services import analyst_intel as m
    return m._fmp_consensus("AAPL")


def _case_analyst_price_target(mp):
    from api.services import analyst_intel as m
    return m._fmp_price_target("AAPL")


def _case_analyst_recent_actions(mp):
    from api.services import analyst_intel as m
    return m._fmp_recent_actions("AAPL")


def _case_annual_actuals(mp):
    from api.services import annual_financials as m
    return m._annual_actuals_from_fmp("AAPL")


def _case_annual_forward(mp):
    from api.services import annual_financials as m
    mp.setenv("FUNDAMENTALS_FMP_ANALYST_ESTIMATES", "1")
    return m._forward_estimates_fmp("AAPL", _FIXED_NOW, last_actual_year=2025)


def _case_recap_recent_reporters(mp):
    from api.services import call_recap_warmer as m
    mp.setattr(m, "_UNIVERSE", {"AAA", "DIS", "PEND", "NEW"})
    return m.recent_reporters(days=2, today=_dt.date(2026, 8, 9))


def _case_company_about_profile(mp):
    from api.services import company_about as m
    return m.get_profile("AAPL")


def _case_year_earnings_income(mp):
    """TWO years, on purpose: `_raw_history` memoizes `[]` ("FMP answered:
    nothing") but retries `None` ("FMP did not answer"). A migration that
    turned the empty answer into None would fire a second request in the
    `empty` mode, and the request-list comparison would name it."""
    from api.services import earnings_estimates as m
    return [m._year_earnings_from_fmp_income("MMC", 2026),
            m._year_earnings_from_fmp_income("MMC", 2025)]


def _case_growth_profile(mp):
    from api.services import earnings_growth_fmp as m
    return m._profile("AAPL")


def _case_growth_pct(mp):
    from api.services import earnings_growth_fmp as m
    return m.earnings_growth_pct("PANW")


def _case_table_next_earnings(mp):
    from api.services import earnings_estimates as ee
    from api.services import earnings_table as m
    mp.setattr(ee, "_fh_get", lambda *a, **k: None)   # Finnhub leg silent -> FMP fallback
    return m._next_earnings("AAPL")


def _case_table_forward_quarters(mp):
    from api.services import earnings_table as m
    mp.setenv("FUNDAMENTALS_FMP_ANALYST_ESTIMATES", "1")
    return m._fmp_forward_quarters("AAPL", 4)


def _case_table_next_report_date(mp):
    from api.services import earnings_estimates as ee
    from api.services import earnings_table as m
    mp.setattr(ee, "_fh_get", lambda *a, **k: None)
    return m._next_report_date("AAPL", now=_FIXED_NOW)


def _case_edgar_resolve_cik(mp):
    from api.services import edgar as m
    mp.setattr(m, "_ticker_to_cik_bulk", lambda: {})
    mp.setattr(m, "_cik_resolved", {})
    return m.resolve_cik("MMC")


def _case_institutional_ownership(mp):
    from api.services import institutional_holdings as m
    mp.setattr(m, "_recent_13f_quarters", lambda *a, **k: [(2026, 1), (2025, 4), (2025, 3)])
    return m._fmp_ownership("AAPL")


def _case_ir_website(mp):
    from api.services import ir_webcast as m
    return m._website_for("AAPL")


#: case id -> (module file that held the migrated call site, the case)
CASES = {
    "analyst_intel._fmp_consensus": ("api/services/analyst_intel.py", _case_analyst_consensus),
    "analyst_intel._fmp_price_target": ("api/services/analyst_intel.py", _case_analyst_price_target),
    "analyst_intel._fmp_recent_actions": ("api/services/analyst_intel.py", _case_analyst_recent_actions),
    "annual_financials._annual_actuals_from_fmp": ("api/services/annual_financials.py", _case_annual_actuals),
    "annual_financials._forward_estimates_fmp": ("api/services/annual_financials.py", _case_annual_forward),
    "call_recap_warmer.recent_reporters": ("api/services/call_recap_warmer.py", _case_recap_recent_reporters),
    "company_about.get_profile": ("api/services/company_about.py", _case_company_about_profile),
    "earnings_estimates._year_earnings_from_fmp_income": ("api/services/earnings_estimates.py", _case_year_earnings_income),
    "earnings_growth_fmp._profile": ("api/services/earnings_growth_fmp.py", _case_growth_profile),
    "earnings_growth_fmp.earnings_growth_pct": ("api/services/earnings_growth_fmp.py", _case_growth_pct),
    "earnings_table._next_earnings": ("api/services/earnings_table.py", _case_table_next_earnings),
    "earnings_table._fmp_forward_quarters": ("api/services/earnings_table.py", _case_table_forward_quarters),
    "earnings_table._next_report_date": ("api/services/earnings_table.py", _case_table_next_report_date),
    "edgar.resolve_cik": ("api/services/edgar.py", _case_edgar_resolve_cik),
    "institutional_holdings._fmp_ownership": ("api/services/institutional_holdings.py", _case_institutional_ownership),
    "ir_webcast._website_for": ("api/services/ir_webcast.py", _case_ir_website),
}

#: The one request-shape difference the adapter declares (see module docstring).
_HOLDER_PATH = "/stable/institutional-ownership/extract-analytics/holder"


def _normalise_request(call: dict) -> dict:
    params = dict(call["params"])
    if call["path"] == _HOLDER_PATH and params.get("page") == 0:
        params.pop("page")
    return {"path": call["path"], "params": params, "timeout": call["timeout"]}


def _jsonable(v):
    return json.loads(json.dumps(v, sort_keys=True, default=str))


def run_case(case_id: str, mode: str, mp) -> tuple[object, list[dict]]:
    """Run one case under one HTTP outcome; returns (output, raw FMP calls)."""
    fake = _FakeFMP(mode)
    mp.setattr(requests, "get", fake("legacy"))
    mp.setattr(fc._session, "get", fake("adapter"))
    if mode == "nokey":
        mp.delenv("FMP_API_KEY", raising=False)
    else:
        mp.setenv("FMP_API_KEY", "test-key")
    cache.clear()                                  # memo + cached-forbidden state
    with fc._bucket_lock:
        fc._bucket_tokens = fc._FMP_RATE_LIMIT_PER_MIN
    try:
        out = CASES[case_id][1](mp)
    finally:
        cache.clear()
    return _jsonable(out), fake.calls


def _goldens() -> dict:
    return json.loads(GOLDENS_PATH.read_text(encoding="utf-8"))


# ═════════════════════════════════════════════════════════════════════════
# PARITY -- output and request shape, against the legacy recording
# ═════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("mode", MODES)
@pytest.mark.parametrize("case_id", sorted(CASES))
def test_parity_with_the_legacy_recording(case_id, mode, monkeypatch):
    golden = _goldens()[case_id][mode]
    out, calls = run_case(case_id, mode, monkeypatch)
    assert out == golden["output"], (
        f"{case_id} under {mode!r} no longer returns what the legacy `_fmp_get` "
        f"path returned.\n  legacy: {golden['output']!r}\n  now:    {out!r}")
    if mode == "http403":
        return                                     # the adapter's 24h refusal cache, see docstring
    got = [_normalise_request(c) for c in calls]
    assert _jsonable(got) == golden["requests"], (
        f"{case_id} under {mode!r} sends a different request than the legacy path "
        f"did.\n  legacy: {golden['requests']!r}\n  now:    {got!r}")


def test_the_goldens_cover_every_case_and_mode_and_are_not_vacuous():
    g = _goldens()
    assert sorted(g) == sorted(CASES)
    for case_id, modes in g.items():
        assert sorted(modes) == sorted(MODES), case_id
        # Non-vacuity: the recorded body produced a non-empty answer AND a
        # request, or this case compares nothing against nothing.
        ok = modes["ok"]
        assert ok["requests"], f"{case_id}: the legacy recording fired no FMP request"
        assert ok["output"] not in (None, [], {}), f"{case_id}: the recorded body parsed to nothing"
        # ...and the failure modes are distinguishable from success, or a
        # parser that ignored its input would pass.
        assert modes["http500"]["output"] != ok["output"], case_id


# ═════════════════════════════════════════════════════════════════════════
# ROUTING -- the migrated modules reach FMP only through the adapter
# ═════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("case_id", sorted(CASES))
def test_every_fmp_request_goes_through_the_adapter(case_id, monkeypatch):
    """Red on the legacy code by construction (every request there is
    `transport == "legacy"`), which is what makes the parity above a
    statement about the MIGRATED path rather than about the old one."""
    _, calls = run_case(case_id, "ok", monkeypatch)
    assert calls, case_id
    legacy = [c for c in calls if c["transport"] != "adapter"]
    assert legacy == [], f"{case_id} still reaches FMP outside the adapter: {legacy}"


# ═════════════════════════════════════════════════════════════════════════
# THE COMPAT FUNCTION ITSELF -- one mapping, every outcome
# ═════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("mode,expected", [
    ("ok", _PROFILE), ("empty", []), ("http500", None), ("timeout", None),
    ("nonjson", None), ("http403", None), ("nokey", None),
])
def test_body_or_none_returns_exactly_what_fmp_get_returned(mode, expected, monkeypatch):
    """The legacy helper and the compat function, side by side, on one fake."""
    from api.services import earnings_estimates as ee
    fake = _FakeFMP(mode)
    monkeypatch.setattr(requests, "get", fake("legacy"))
    monkeypatch.setattr(fc._session, "get", fake("adapter"))
    if mode == "nokey":
        monkeypatch.delenv("FMP_API_KEY", raising=False)
    else:
        monkeypatch.setenv("FMP_API_KEY", "test-key")
    cache.clear()
    try:
        legacy = ee._fmp_get("/stable/profile", {"symbol": "AAPL"}, timeout=8)
        cache.clear()
        typed = fc.body_or_none(fc.get_company_profile, "AAPL", timeout=8)
        assert typed == legacy == expected
    finally:
        cache.clear()


def test_body_or_none_answers_a_cached_forbidden_path_with_none_and_no_request(monkeypatch):
    fake = _FakeFMP("ok")
    monkeypatch.setattr(fc._session, "get", fake("adapter"))
    monkeypatch.setenv("FMP_API_KEY", "test-key")
    cache.clear()
    try:
        cache.set("fmp_forbidden_/stable/profile", 1.0, ttl=60)
        assert fc.body_or_none(fc.get_company_profile, "AAPL", timeout=8) is None
        assert fake.calls == []
    finally:
        cache.clear()


def test_body_or_none_requires_a_named_timeout():
    with pytest.raises(TypeError):
        fc.body_or_none(fc.get_company_profile, "AAPL")    # no timeout= -> refused


def test_body_or_none_forwards_the_timeout_it_was_given(monkeypatch):
    fake = _FakeFMP("ok")
    monkeypatch.setattr(fc._session, "get", fake("adapter"))
    monkeypatch.setenv("FMP_API_KEY", "test-key")
    cache.clear()
    try:
        fc.body_or_none(fc.get_company_profile, "AAPL", timeout=7)
        assert [c["timeout"] for c in fake.calls] == [7]
    finally:
        cache.clear()
