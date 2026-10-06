"""The terminal's symbol routes read ONE spelling of a ticker and refuse junk with a
sentence (2026-10-05 audit of the routes behind the UCT Terminal).

Found on production the same evening: FA, OWN and PPL were blank for BRK.B while
BRK-B (and TSM, SPY) were full, because the dot form went straight to FMP and
yfinance, which spell a class share with a hyphen. The rule now lives in
`ticker_resolver.route_symbol`; each route below takes its symbol through it.

No network: every vendor is stubbed at the service seam the route calls, and the
paid gate runs for real against a paid user (only the session lookup is replaced).
"""
from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as am
from api.services import ticker_resolver as R

DUAL = ["brk.b", "BRK.B", "BRK-B"]
JUNK = ["%3Cscript%3E", "ABCDEFGHIJKLMNOPQRST", "%20"]
_PAID = {"id": "u-paid", "email": "paid@example.com", "role": "user", "plan": "pro"}


def _app(*routers):
    app = FastAPI()
    for r in routers:
        app.include_router(r)
    app.dependency_overrides[am.get_current_user] = lambda: dict(_PAID)
    app.dependency_overrides[am.get_current_user_with_plan] = lambda: dict(_PAID)
    return TestClient(app)


# ── the rule itself ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw", DUAL + [" brk.b "])
def test_every_dual_class_spelling_is_the_hyphen_form(raw):
    assert R.route_symbol(raw) == "BRK-B"


@pytest.mark.parametrize("raw,want", [("spy", "SPY"), ("TSM", "TSM"), ("F", "F"),
                                      ("nvda", "NVDA"), ("ZZZZQ", "ZZZZQ"), ("UCTA50", "UCTA50")])
def test_ordinary_symbols_are_upper_cased(raw, want):
    assert R.route_symbol(raw) == want


@pytest.mark.parametrize("raw", ["<script>", "A/B", "ABCDEFGHIJKLMNOPQRST", "", "   ", None, "BRK..B"])
def test_junk_is_not_a_ticker(raw):
    assert R.route_symbol(raw) is None


def test_the_refusal_is_a_400_with_a_sentence():
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        R.require_route_symbol("<script>")
    assert e.value.status_code == 400 and "is not a ticker symbol" in e.value.detail
    with pytest.raises(HTTPException) as e:
        R.require_route_symbol("  ")
    assert e.value.status_code == 400 and "required" in e.value.detail


# ── the routes: research.py ─────────────────────────────────────────────────────

@pytest.fixture
def research(monkeypatch):
    from api.routers import research as route
    seen = []

    def rec(name):
        def f(sym, *a, **k):
            seen.append((name, sym))
            return {"sym": sym}
        return f
    monkeypatch.setattr(route, "get_ownership", rec("own"))
    monkeypatch.setattr(route, "get_financials", rec("fin"))
    monkeypatch.setattr(route, "get_analyst_ratings", rec("anr"))
    monkeypatch.setattr(route.edgar_ownership, "is_enabled", lambda: False)
    from api.services.research import financial_history
    monkeypatch.setattr(financial_history, "get_history", lambda s, period="quarter": seen.append(("fh", s)) or {"sym": s})
    from api.services import company_about
    monkeypatch.setattr(company_about, "get_about", lambda s: seen.append(("about", s)) or {"ticker": s})
    return _app(route.router), seen


@pytest.mark.parametrize("path,tag", [
    ("/api/research/ownership/{s}", "own"),
    ("/api/research/financials/{s}", "fin"),
    ("/api/research/analyst-ratings/{s}", "anr"),
    ("/api/research/financial-history/{s}?period=annual", "fh"),
    ("/api/about/{s}", "about"),
])
def test_research_routes_hand_the_composer_the_hyphen_form(research, path, tag):
    c, seen = research
    for s in DUAL:
        r = c.get(path.replace("{s}", s))
        assert r.status_code == 200, (s, r.text)
    assert [x for x in seen if x[0] == tag] == [(tag, "BRK-B")] * 3


@pytest.mark.parametrize("path", ["/api/research/ownership/{s}", "/api/about/{s}",
                                  "/api/research/financial-history/{s}"])
def test_research_routes_refuse_junk_before_any_vendor(research, path):
    c, seen = research
    for s in JUNK:
        r = c.get(path.replace("{s}", s))
        assert r.status_code == 400, (s, r.status_code, r.text)
        assert "ticker symbol" in r.json()["detail"]
    assert seen == []


def test_compare_canonicalizes_both_sides(monkeypatch):
    from api.routers import research as route
    got = []
    monkeypatch.setattr(route, "get_comparison", lambda a, b: got.append((a, b)) or {"ok": 1})
    c = _app(route.router)
    assert c.get("/api/research/compare/brk.b/bf.b").status_code == 200
    assert got == [("BRK-B", "BF-B")]
    assert c.get("/api/research/compare/NVDA/%3Cscript%3E").status_code == 400


# ── fundamentals.py / analyst.py / tweets.py ──────────────────────────────────

def test_fundamentals_routes_read_the_hyphen_form(monkeypatch):
    from api.routers import fundamentals as route
    got = []
    monkeypatch.setattr(route, "get_statements", lambda s: got.append(s) or {"ticker": s})
    c = _app(route.router)
    for s in DUAL:
        assert c.get(f"/api/fundamentals-statements/{s}").status_code == 200
    assert got == ["BRK-B"] * 3
    assert c.get("/api/fundamentals-statements/%3Cscript%3E").status_code == 400


def test_analyst_and_ownership_read_the_hyphen_form(monkeypatch):
    from api.routers import analyst as route
    got = []
    monkeypatch.setattr(route, "get_ownership", lambda s, *a, **k: got.append(s) or {"ticker": s})
    c = _app(route.router)
    for s in DUAL:
        assert c.get(f"/api/ownership/{s}").status_code == 200, c.get(f"/api/ownership/{s}").text
    assert got and set(got) == {"BRK-B"}
    assert c.get("/api/ownership/%3Cscript%3E").status_code == 400


def test_tweets_for_a_dual_class_name_are_read_not_refused(monkeypatch):
    """The old `isalpha()` check answered BRK.B AND BRK-B with "invalid ticker"."""
    from api.routers import tweets as route
    got = []
    monkeypatch.setattr(route.tweet_store, "tweets_for_ticker",
                        lambda s, hours=24: got.append(s) or [])
    c = _app(route.router)
    for s in DUAL:
        r = c.get(f"/api/tweets/ticker/{s}")
        assert r.status_code == 200, (s, r.text)
    assert got == ["BRK-B"] * 3
    assert c.get("/api/tweets/ticker/%3Cscript%3E").status_code == 400


# ── the research-cov / depth / notices helpers ─────────────────────────────────

@pytest.mark.parametrize("mod", ["research_cov", "research_notices"])
def test_the_router_sym_helpers_delegate_to_the_one_rule(mod):
    import importlib
    from fastapi import HTTPException
    m = importlib.import_module(f"api.routers.{mod}")
    assert m._sym("brk.b") == "BRK-B"
    with pytest.raises(HTTPException) as e:
        m._sym("<script>")
    assert e.value.status_code == 400


def test_the_depth_helper_keeps_its_optional_contract():
    from fastapi import HTTPException
    from api.routers import research_depth as m
    assert m._sym(None) is None and m._sym("  ") is None
    assert m._sym("BRK.B") == "BRK-B"
    with pytest.raises(HTTPException):
        m._sym("A/B")


def test_people_route_asks_fmp_for_the_hyphen_form(monkeypatch):
    from api.routers import research_cov as route
    from api.services import research_people
    monkeypatch.setattr(research_people, "is_enabled", lambda: True)
    got = []
    monkeypatch.setattr(research_people, "people", lambda s, **k: got.append(s) or {"ticker": s})
    c = _app(route.router)
    for s in DUAL:
        assert c.get(f"/api/research/people/{s}").status_code == 200
    assert got == ["BRK-B"] * 3


# ── the FMP boundary ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,want", [("BRK.B", "BRK-B"), ("BF.A", "BF-A"), ("BRK-B", "BRK-B"),
                                      ("NVDA", "NVDA"), ("RY.TO", "RY.TO"), ("^GSPC", "^GSPC"),
                                      ("BRK.B,AAPL", "BRK-B,AAPL")])
def test_fmp_is_asked_in_its_own_class_share_spelling(raw, want):
    from api.services import fmp_client
    assert fmp_client._fmp_symbol_param(raw) == want


def test_the_fmp_transport_applies_it_to_the_wire(monkeypatch):
    from api.services import fmp_client
    sent = {}

    class _R:
        status_code = 200

        def raise_for_status(self):
            pass

        def json(self):
            return [{"ok": 1}]

    def fake_get(url, params=None, timeout=None):
        sent.update(params or {})
        return _R()
    monkeypatch.setenv("FMP_API_KEY", "k")
    monkeypatch.setattr(fmp_client, "_take_token", lambda: True)
    monkeypatch.setattr(fmp_client.cache, "get", lambda k: None)
    monkeypatch.setattr(fmp_client._session, "get", fake_get)
    fmp_client._get_raw("/stable/key-executives", {"symbol": "BRK.B"})
    assert sent["symbol"] == "BRK-B"


# ── earnings-intel: a fund answers at once ─────────────────────────────────────

def test_a_fund_gets_an_honest_not_applicable_without_a_build(monkeypatch):
    from api.routers import fundamentals as route
    from api.services import ticker_search_index, earnings_intel
    monkeypatch.setattr(ticker_search_index, "instrument_type",
                        lambda s: "etf" if s == "SPY" else "stock")
    built = []
    monkeypatch.setattr(earnings_intel, "get_earnings", lambda s: built.append(s) or {"ticker": s, "quarters": [1]})
    c = _app(route.router)
    r = c.get("/api/earnings-intel/spy")
    assert r.status_code == 200
    assert r.json()["not_applicable"] == "fund" and r.json()["quarters"] == []
    assert built == []
    assert c.get("/api/earnings-intel/NVDA").json()["quarters"] == [1]
    assert built == ["NVDA"]


def test_an_unknown_type_is_not_treated_as_a_fund(monkeypatch):
    from api.routers import fundamentals as route
    from api.services import ticker_search_index, earnings_intel
    monkeypatch.setattr(ticker_search_index, "instrument_type", lambda s: None)
    monkeypatch.setattr(earnings_intel, "get_earnings", lambda s: {"ticker": s, "quarters": []})
    assert "not_applicable" not in _app(route.router).get("/api/earnings-intel/QQQ").json()


def test_instrument_type_reads_the_built_index(monkeypatch):
    from api.services import ticker_search_index as tsi
    monkeypatch.setattr(tsi, "_BY_SYM", {"SPY": {"type": "etf"}, "NVDA": {"type": "stock"}})
    assert tsi.instrument_type("spy") == "etf"
    assert tsi.instrument_type("NVDA") == "stock"
    assert tsi.instrument_type("ZZZZQ") is None


# ── seasonality: the serve's verdict is read, never flattened ─────────────────

class _Resp:
    def __init__(self, status, payload):
        self.status_code = status
        self.body = json.dumps(payload).encode()


@pytest.fixture
def seasonality(monkeypatch):
    from api.routers import seasonality as route
    from api.routers import bars as bars_router
    monkeypatch.setenv("SEASONALITY_ENABLED", "1")
    asked = []

    def serve(answer):
        monkeypatch.setattr(bars_router, "serve_bars",
                            lambda sym, *a, **k: asked.append(sym) or answer)
    return _app(route.router), serve, asked


def test_a_warming_serve_is_a_503_with_retry_after(seasonality):
    c, serve, _ = seasonality
    serve(_Resp(503, {"bars": [], "error": "warming"}))
    r = c.get("/api/research/seasonality/SPY")
    assert r.status_code == 503 and r.headers.get("retry-after") == "15"
    assert "still being read" in r.json()["detail"]


def test_a_not_carried_symbol_is_a_404_not_an_outage(seasonality):
    c, serve, _ = seasonality
    serve(_Resp(200, {"bars": [], "no_data": True, "reason": "symbol_not_carried"}))
    r = c.get("/api/research/seasonality/ZZZZQ")
    assert r.status_code == 404 and "No daily bars" in r.json()["detail"]


def test_a_failed_serve_names_its_reason_and_asks_for_a_retry(seasonality):
    c, serve, _ = seasonality
    serve(_Resp(503, {"bars": [], "error": "transient"}))
    r = c.get("/api/research/seasonality/SPY")
    assert r.status_code == 503 and "transient" in r.json()["detail"]
    assert r.headers.get("retry-after")


def test_seasonality_reads_the_bar_store_in_the_hyphen_form(seasonality):
    c, serve, asked = seasonality
    serve(_Resp(503, {"bars": [], "error": "transient"}))
    for s in DUAL:
        c.get(f"/api/research/seasonality/{s}")
    assert asked == ["BRK-B"] * 3
