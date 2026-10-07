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


# ── people: a fund is not a vendor failure ────────────────────────────────────

def test_people_for_a_fund_says_so_and_asks_no_vendor(monkeypatch):
    from api.services import research_people, ticker_search_index
    monkeypatch.setattr(ticker_search_index, "instrument_type", lambda s: "etf")
    asked = []
    monkeypatch.setattr(research_people, "_fmp_part", lambda s: asked.append(s) or {})
    out = research_people.people("SPY", snapshot_fn=lambda s: asked.append(s) or {})
    assert asked == []
    assert out["not_applicable"] == "fund"
    for part in ("executives", "compensation", "insider_roles"):
        assert out[part]["state"] == "not_applicable" and out[part]["rows"] is None
        assert "is a fund" in out[part]["reason"] and out[part]["source"]


def test_people_for_an_unknown_type_still_reads_the_vendors(monkeypatch):
    from api.services import research_people, ticker_search_index
    monkeypatch.setattr(ticker_search_index, "instrument_type", lambda s: None)
    asked = []
    empty = {"state": "not_found", "rows": None, "source": "x", "reason": "r"}
    monkeypatch.setattr(research_people, "_fmp_part",
                        lambda s: asked.append(s) or {"executives": dict(empty), "compensation": dict(empty)})
    monkeypatch.setattr(research_people, "_insider_roles", lambda s, f=None: dict(empty))
    out = research_people.people("BRK-B")
    assert asked == ["BRK-B"] and "not_applicable" not in out


# ── options chain / history: junk never reaches a vendor ──────────────────────

def test_the_option_chain_refuses_junk_with_a_422_not_an_outage(monkeypatch):
    from api.routers import options_chain as route
    from api.services import polygon_options
    monkeypatch.setattr(route, "is_enabled", lambda: True)
    asked = []
    monkeypatch.setattr(polygon_options, "list_expirations", lambda s: asked.append(s) or {"expirations": []})
    monkeypatch.setattr(polygon_options, "get_chain", lambda s, **k: asked.append(s) or {"rows": []})
    c = _app(route.router)
    for s in JUNK:
        for path in ("expirations", "chain"):
            r = c.get(f"/api/research/options/{s}/{path}")
            assert r.status_code == 422, (s, path, r.status_code, r.text)
            assert "not a ticker symbol" in r.json()["detail"]
    assert asked == []
    assert c.get("/api/research/options/nvda/expirations").status_code == 200
    assert asked == ["NVDA"]


def test_history_refuses_junk_before_any_lane(monkeypatch):
    from api.routers import ticker_history as route
    monkeypatch.setattr(route.ticker_history, "is_enabled", lambda: True)
    asked = []
    monkeypatch.setattr(route.ticker_history, "history", lambda s, **k: asked.append(s) or {"ticker": s})
    c = _app(route.router)
    for s in JUNK:
        assert c.get(f"/api/research/history/{s}").status_code == 400, s
    assert asked == []
    assert c.get("/api/research/history/NVDA").status_code == 200 and asked == ["NVDA"]


# ── round 2: the rule never refuses a symbol the product holds ────────────────

def _delisted_keys():
    import os as _os
    from api.services import delisted_registry as dr
    keys = []
    for path in (dr._BULK_PATH, dr._SEED_PATH):
        if _os.path.exists(path):
            keys += [r.get("key") or r.get("ticker") for r in dr._read_file(path)]
    return [k for k in keys if k]


def test_every_delisted_registry_key_is_a_route_symbol():
    """A delisted era key (ADSW-2020, PSA.A.CL) refused by the rule would 400 a real chart."""
    keys = _delisted_keys()
    assert len(keys) > 1000, "the registry read found almost nothing -- the probe is broken"
    assert "ADSW-2020" in keys
    refused = sorted(k for k in keys if R.route_symbol(k) is None)
    assert refused == []


def test_every_cap_universe_symbol_is_a_route_symbol():
    from api.services import cap_universe
    syms = list(cap_universe.symbols())
    assert len(syms) > 1000 and "NVDA" in syms
    assert sorted(s for s in syms if R.route_symbol(s) is None) == []


# ── round 2: shape-only routes refuse junk and keep the typed spelling ────────

@pytest.mark.parametrize("raw,want", [("brk.b", "BRK.B"), (" BRK-B ", "BRK-B"), ("nvda", "NVDA")])
def test_the_shape_rule_keeps_the_typed_spelling(raw, want):
    assert R.require_route_shape(raw) == want


def test_the_shape_rule_refuses_junk_like_the_route_rule():
    from fastapi import HTTPException
    for raw in ("<script>", "ABCDEFGHIJKLMNOPQRST", "  "):
        with pytest.raises(HTTPException) as e:
            R.require_route_shape(raw)
        assert e.value.status_code == 400


#: (router module, route path, path-param dependency). Every terminal-reached route
#: that takes the symbol through one of the two rules, and which one. `_shape` routes
#: key a store on the typed spelling, so they refuse junk only.
_ROUTE_RULES = [
    ("earnings_intel", "/api/earnings/call-recap/{ticker}", "ticker_shape"),
    ("earnings_intel", "/api/earnings/transcript/{ticker}", "ticker_shape"),
    ("earnings_intel", "/api/earnings/transcript-quarters/{ticker}", "ticker_shape"),
    ("earnings_intel", "/api/earnings/timed-transcript/{ticker}", "ticker_shape"),
    ("earnings_intel", "/api/earnings/sentiment/{ticker}", "ticker_shape"),
    ("earnings", "/api/earnings-analysis/{sym}", "sym_shape"),
    ("intelligence", "/api/confidence-scores/{symbol}", "symbol_shape"),
    ("intelligence", "/api/leader-persistence/{symbol}", "symbol_shape"),
    ("decision_record", "/api/decision-record/ticker/{ticker}", "ticker_shape"),
    ("analyst_revisions", "/api/research/analyst-revisions/{ticker}", "ticker_shape"),
    ("research", "/api/research/ownership/{sym}", "sym_path"),
    ("fundamentals", "/api/earnings-intel/{ticker}", "ticker_path"),
]


@pytest.mark.parametrize("mod,path,dep", _ROUTE_RULES)
def test_each_route_takes_its_symbol_through_its_rule(mod, path, dep):
    import importlib
    router = importlib.import_module(f"api.routers.{mod}").router
    routes = [r for r in router.routes if getattr(r, "path", None) == path]
    assert routes, f"{mod} has no route {path} -- the census is stale"
    calls = {d.call.__name__ for r in routes for d in r.dependant.dependencies if d.call}
    assert dep in calls, (path, sorted(calls))


def test_the_census_sees_a_route_without_a_rule():
    """Non-vacuity: a route known to take no symbol rule is seen as having none."""
    from api.routers import fundamentals
    r = [x for x in fundamentals.router.routes if getattr(x, "path", "") == "/api/fundamentals/earnings-table"]
    assert r
    names = {d.call.__name__ for x in r for d in x.dependant.dependencies if d.call}
    assert not names & {"sym_path", "ticker_path", "sym_shape", "ticker_shape", "symbol_shape"}


def test_shape_routes_refuse_junk_and_pass_the_typed_spelling(monkeypatch):
    from api.routers import earnings_intel as ei, intelligence, decision_record as drr
    from api.routers import analyst_revisions as arr
    got = []
    monkeypatch.setattr(ei, "get_sentiment", lambda s: got.append(s) or {"score": 1})
    monkeypatch.setattr(intelligence, "_get_api", lambda: None)
    monkeypatch.setattr(drr.decision_record, "is_enabled", lambda: True)
    monkeypatch.setattr(drr.decision_record, "ticker_record", lambda t, **k: got.append(t) or {"ticker": t})
    monkeypatch.setattr(arr.analyst_revisions, "is_enabled", lambda: True)
    monkeypatch.setattr(arr.analyst_revisions, "revision_history", lambda t: got.append(t) or {"ticker": t})
    c = _app(ei.router, intelligence.router, drr.router, arr.router)
    paths = ["/api/earnings/sentiment/{s}", "/api/confidence-scores/{s}",
             "/api/decision-record/ticker/{s}", "/api/research/analyst-revisions/{s}"]
    for p in paths:
        for s in JUNK:
            r = c.get(p.replace("{s}", s))
            assert r.status_code == 400, (p, s, r.status_code, r.text)
            assert "ticker symbol" in r.json()["detail"]
    assert got == []
    for p in paths:
        assert c.get(p.replace("{s}", "brk.b")).status_code == 200, p
    assert got == ["BRK.B"] * 3                       # spelling kept, case upper
    assert c.get("/api/confidence-scores/nvda").json()["symbol"] == "NVDA"   # no lowercase echo
