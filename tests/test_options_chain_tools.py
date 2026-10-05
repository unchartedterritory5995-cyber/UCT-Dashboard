"""FT-003 probability analysis, FT-016 contract drill history, FT-002 builder switch
(api/services/options_analytics/chain_tools.py + routes). No network: the vendor chain and the
contract aggregates are stubs shaped like polygon_options.get_chain / massive.get_daily_agg.

Hand-computed: spot 100, ATM IV (0.20 + 0.22)/2 = 0.21, 30 days ->
  68.27%: z 1.0000, w = 0.21 x sqrt(30/365) = 0.06021 -> 94.16 .. 106.21
  95.45%: z 2.0000 -> 88.66 .. 112.80 ;  90%: z 1.6449 -> 90.57 .. 110.41
"""
from __future__ import annotations

import datetime as dt

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import options_analytics as oa
from api.services.options_analytics import chain_tools as ct

PAID = {"id": "u1", "role": "member", "plan": "pro"}
FREE = {"id": "u2", "role": "member", "plan": "free"}
TODAY = dt.date(2026, 10, 2)
EXP = (TODAY + dt.timedelta(days=30)).isoformat()
CHAIN = {"ticker": "TST", "expiration": EXP, "spot": 100.0,
         "calls": [{"strike": 95, "iv": 0.25}, {"strike": 100, "iv": 0.20}, {"strike": 105, "iv": 0.18}],
         "puts": [{"strike": 100, "iv": 0.22}, {"strike": 95, "iv": 0.27}]}


@pytest.fixture(autouse=True)
def _stubs(monkeypatch):
    monkeypatch.setattr(ct, "_chain", lambda s, e: dict(CHAIN))
    monkeypatch.setattr(ct, "_bars", lambda occ, f, t: [
        {"t": int(dt.datetime(2026, 9, 30, 12, tzinfo=ct._ET).timestamp() * 1000), "o": 2.0, "h": 2.5, "l": 1.9, "c": 2.4, "v": 120},
        {"t": int(dt.datetime(2026, 10, 1, 12, tzinfo=ct._ET).timestamp() * 1000), "o": 2.4, "h": 3.1, "l": 2.3, "c": 3.0, "v": 340}])


def _client(user, monkeypatch):
    from api.middleware.auth_middleware import get_current_user_with_plan
    monkeypatch.setattr(oa, "is_paid_user", lambda u: u.get("plan") == "pro")
    app = FastAPI()
    app.include_router(oa.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: user
    return TestClient(app)


@pytest.mark.parametrize("flag,route", [
    ("OPTIONS_PROBABILITY_ENABLED", "/api/research/options/TST/probability"),
    ("OPTIONS_PRICER_ENABLED", "/api/research/options/TST/contract/O:TST261016C00100000"),
    ("OPTIONS_MULTI_LEG_ENABLED", "/api/research/options/TST/builder"),
])
def test_each_chain_tool_is_dark_until_its_own_switch(flag, route, monkeypatch):
    for f in ("OPTIONS_PROBABILITY_ENABLED", "OPTIONS_PRICER_ENABLED", "OPTIONS_MULTI_LEG_ENABLED"):
        monkeypatch.delenv(f, raising=False)
    c = _client(PAID, monkeypatch)
    assert c.get(route).status_code == 404
    monkeypatch.setenv(flag, "1")
    assert c.get(route).status_code == 200
    assert _client(FREE, monkeypatch).get(route).status_code == 402


def test_the_one_sd_and_two_sd_ranges():
    r = ct.probability("TST", today=TODAY)
    assert r["atm_strike"] == 100.0 and r["atm_iv"] == 0.21 and r["days"] == 30
    assert r["ranges"][0] == {"probability": 0.6827, "z": 1.0, "low": 94.16, "high": 106.21}
    assert r["ranges"][1] == {"probability": 0.9545, "z": 2.0, "low": 88.66, "high": 112.8}
    assert r["label"] == "computed" and r["iv_label"] == "vendor"


def test_a_chosen_probability_leads_and_the_standard_ones_follow():
    r = ct.probability("TST", p=0.9, today=TODAY)
    assert [x["probability"] for x in r["ranges"]] == [0.9, 0.6827, 0.9545]
    assert (r["ranges"][0]["low"], r["ranges"][0]["high"]) == (90.57, 110.41)


def test_no_atm_iv_is_a_sentence_not_a_range(monkeypatch):
    monkeypatch.setattr(ct, "_chain", lambda s, e: {**CHAIN, "calls": [{"strike": 100, "iv": None}], "puts": []})
    r = ct.probability("TST", today=TODAY)
    assert r["ranges"] == [] and "no range can be drawn" in r["note"]


def test_probability_route_validates_and_names_a_chain_failure(monkeypatch):
    monkeypatch.setenv("OPTIONS_PROBABILITY_ENABLED", "1")
    c = _client(PAID, monkeypatch)
    assert c.get("/api/research/options/TST/probability?probability=0.2").status_code == 422
    monkeypatch.setattr(ct, "_chain", lambda s, e: {"error": "polygon request failed: timeout"})
    r = c.get("/api/research/options/TST/probability")
    assert r.status_code == 503 and "timeout" in r.json()["detail"]


def test_contract_history_is_the_vendor_bars_of_that_contract():
    h = ct.contract_history("TST", "O:TST261016C00100000")
    assert (h["type"], h["strike"], h["expiration"]) == ("call", 100.0, "2026-10-16")
    assert [(b["date"], b["close"]) for b in h["bars"]] == [("2026-09-30", 2.4), ("2026-10-01", 3.0)]
    assert h["label"] == "vendor" and h["note"] is None


def test_a_contract_on_another_underlying_is_refused(monkeypatch):
    monkeypatch.setenv("OPTIONS_PRICER_ENABLED", "1")
    r = _client(PAID, monkeypatch).get("/api/research/options/TST/contract/O:SPY261016C00700000")
    assert r.status_code == 422


def test_no_bars_says_it_is_not_the_same_as_no_history(monkeypatch):
    monkeypatch.setattr(ct, "_bars", lambda occ, f, t: [])
    h = ct.contract_history("TST", "O:TST261016P00095000")
    assert h["bars"] == [] and "Not the same as no history" in h["note"]
