"""A fund on a stock-only research route answers "not applicable", never a fake number
(terminal backend, round 3, 2026-10-05).

The fund test is the ticker-search index's in-memory type (`ticker_search_index.is_fund`).
Earnings-intel and People already answered a fund with `not_applicable: "fund"`; here:

* RTG built a confident 0-99 composite for SPY from its two price inputs (RS, Acc/Dis) --
  a fake score. A fund now gets `composite: None, components: {}`, the shape RatingsTab
  already renders as "Ratings are unavailable for this ticker.", plus the shared marker.
* FA / EE / ANR answered a fund with empty records. They keep their payload and still read
  the vendors (a mis-typed company must not lose real data); they gain the ADDITIVE marker.
* OWN showed "Shares outstanding 0": a vendor zero now reads as not reported.
* Cold boot: before the index is built the type is unknown, and unknown is never "fund".

No network: every composer is stubbed at the seam the route calls.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as am
from api.services import ticker_search_index as tsi

_PAID = {"id": "u-paid", "email": "paid@example.com", "role": "user", "plan": "pro"}


def _app(*routers):
    app = FastAPI()
    for r in routers:
        app.include_router(r)
    app.dependency_overrides[am.get_current_user] = lambda: dict(_PAID)
    app.dependency_overrides[am.get_current_user_with_plan] = lambda: dict(_PAID)
    return TestClient(app)


@pytest.fixture
def typed(monkeypatch):
    """SPY is an ETF, NVDA a stock, anything else unknown -- through the REAL index lookup."""
    monkeypatch.setattr(tsi, "_BY_SYM", {"SPY": {"type": "etf"}, "NVDA": {"type": "stock"}})


@pytest.fixture
def research(monkeypatch, typed):
    from api.routers import research as route
    seen = []

    def rec(name, body):
        def f(sym, *a, **k):
            seen.append((name, sym))
            return dict(body, sym=sym)
        return f
    monkeypatch.setattr(route, "get_ratings", rec("rtg", {"composite": 71, "components": {"rs": 90}}))
    monkeypatch.setattr(route, "get_financials", rec("fin", {"annual": [], "quarterly": []}))
    monkeypatch.setattr(route, "get_estimates", rec("ee", {"forward": [], "revisions": []}))
    monkeypatch.setattr(route, "get_analyst_ratings", rec("anr", {"consensus": None}))
    from api.services.research import estimates_consensus, financial_history
    monkeypatch.setattr(financial_history, "get_history",
                        lambda s, period="quarter": seen.append(("fh", s)) or {"sym": s, "periods": []})
    monkeypatch.setattr(estimates_consensus, "get_consensus",
                        lambda s: seen.append(("cons", s)) or {"sym": s, "state": "empty", "annual": []})
    return _app(route.router), seen


# ── RTG: no composite from missing fundamentals ─────────────────────────────────────

def test_a_fund_gets_no_composite_and_no_ratings_build(research):
    c, seen = research
    body = c.get("/api/research/ratings/spy").json()
    assert body["not_applicable"] == "fund" and "SPY is a fund" in body["reason"]
    assert body["composite"] is None and body["components"] == {}      # RatingsTab's empty shape
    assert seen == []


def test_a_company_and_an_unknown_type_are_still_rated(research):
    c, seen = research
    for s in ("NVDA", "ZZZZQ"):
        body = c.get(f"/api/research/ratings/{s}").json()
        assert body["composite"] == 71 and "not_applicable" not in body
    assert seen == [("rtg", "NVDA"), ("rtg", "ZZZZQ")]


# ── FA / EE / ANR: the payload is kept, the marker is added ─────────────────────────

ROUTES = [("/api/research/financial-history/{s}", "fh", "periods"),
          ("/api/research/financials/{s}", "fin", "annual"),
          ("/api/research/estimates/{s}", "ee", "forward"),
          ("/api/research/analyst-ratings/{s}", "anr", "consensus")]


@pytest.mark.parametrize("path,tag,key", ROUTES)
def test_a_fund_is_marked_and_its_payload_kept(research, path, tag, key):
    c, seen = research
    body = c.get(path.replace("{s}", "SPY")).json()
    assert body["not_applicable"] == "fund" and body["reason"].startswith("SPY is a fund; ")
    assert key in body                                   # the shape the panel reads is unchanged
    assert (tag, "SPY") in seen                          # the vendors are still read


@pytest.mark.parametrize("path,tag,key", ROUTES)
def test_a_company_and_an_unknown_type_carry_no_marker(research, path, tag, key):
    c, _ = research
    for s in ("NVDA", "ZZZZQ"):
        body = c.get(path.replace("{s}", s)).json()
        assert "not_applicable" not in body and "reason" not in body, (s, body)


def test_ee_consensus_state_is_left_for_the_panels_fixed_table(research):
    c, seen = research
    body = c.get("/api/research/estimates/SPY?consensus=1").json()
    assert body["consensus"]["state"] == "empty"         # never a value EE would read as an outage
    assert body["not_applicable"] == "fund" and ("cons", "SPY") in seen


def test_the_marker_never_mutates_a_cached_composer_result(monkeypatch, typed):
    from api.routers import research as route
    held = {"sym": "SPY", "annual": []}
    monkeypatch.setattr(route, "get_financials", lambda s: held)
    _app(route.router).get("/api/research/financials/SPY")
    assert held == {"sym": "SPY", "annual": []}


# ── OWN: a vendor zero is not a share count ─────────────────────────────────────────

def test_a_zero_share_count_reads_as_not_reported():
    from api.services.research import ownership as own
    assert own._reconcile_share_counts({"floatShares": 0, "sharesOutstanding": 0},
                                       {"float_shares": 0.0, "shares_outstanding": 0.0}) == (None, None)
    # an FMP zero falls through to Yahoo's real figure rather than winning
    assert own._reconcile_share_counts({"floatShares": 9e8, "sharesOutstanding": 9.2e8},
                                       {"float_shares": 0.0, "shares_outstanding": 0.0}) == (9e8, 9.2e8)


# ── the helper, and the cold boot ───────────────────────────────────────────────────

def test_the_helper_says_fund_only_for_an_etf(typed):
    assert tsi.is_fund("spy") is True
    assert tsi.is_fund("NVDA") is False and tsi.is_fund("ZZZZQ") is False and tsi.is_fund("") is False
    assert tsi.fund_not_applicable("spy", "x") == {"not_applicable": "fund", "reason": "SPY is a fund; x"}
    assert tsi.fund_not_applicable("NVDA", "x") is None


@pytest.fixture
def cold(monkeypatch):
    """The index has not been built: nothing in memory, and asking must not start a build."""
    monkeypatch.setattr(tsi, "_BY_SYM", {})
    monkeypatch.setattr(tsi, "_INDEX", [])

    def no_build(*a, **k):
        raise AssertionError("a type lookup must never build the index")
    monkeypatch.setattr(tsi, "build_index", no_build)
    monkeypatch.setattr(tsi, "start_background_build", no_build)
    monkeypatch.setattr(tsi, "_load_snapshot", no_build)


def test_cold_boot_the_type_is_unknown_never_fund(cold):
    assert tsi.ready() is False
    for s in ("SPY", "QQQ", "NVDA"):
        assert tsi.instrument_type(s) is None
        assert tsi.is_fund(s) is False and tsi.fund_not_applicable(s, "x") is None


def test_cold_boot_every_fund_aware_route_behaves_as_for_a_company(cold, monkeypatch):
    from api.routers import fundamentals as fund_route
    from api.routers import research as route
    from api.services import earnings_intel, research_people
    built = []
    monkeypatch.setattr(earnings_intel, "get_earnings", lambda s: built.append(("ei", s)) or {"ticker": s, "quarters": [1]})
    monkeypatch.setattr(route, "get_ratings", lambda s: built.append(("rtg", s)) or {"composite": 50, "components": {"rs": 1}})
    monkeypatch.setattr(route, "get_financials", lambda s: built.append(("fin", s)) or {"annual": [1]})
    c = _app(fund_route.router, route.router)
    assert "not_applicable" not in c.get("/api/earnings-intel/SPY").json()
    assert c.get("/api/research/ratings/SPY").json()["composite"] == 50
    assert "not_applicable" not in c.get("/api/research/financials/SPY").json()
    empty = {"state": "not_found", "rows": None, "source": "x", "reason": "r"}
    monkeypatch.setattr(research_people, "_fmp_part",
                        lambda s: built.append(("ppl", s)) or {"executives": dict(empty), "compensation": dict(empty)})
    monkeypatch.setattr(research_people, "_insider_roles", lambda s, f=None: dict(empty))
    assert "not_applicable" not in research_people.people("SPY")
    assert built == [("ei", "SPY"), ("rtg", "SPY"), ("fin", "SPY"), ("ppl", "SPY")]
