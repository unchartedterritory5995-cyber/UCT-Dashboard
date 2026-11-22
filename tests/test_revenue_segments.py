"""SEG, the Terminal's revenue by segment (`api/services/revenue_segments.py`, the route in
`api/routers/revenue_segments.py`, the two typed functions in `api/services/fmp_client.py`, and the shared
`api/services/held_reads.py`).

What is held here:
  * the route is one paid GET: signed out 401, a free plan 402, a string that is not a ticker 400, a
    period other than annual or quarter 400, and none of them reaches the service;
  * each typed function sends its own documented path with `symbol` and `period`, through the one
    adapter, and stamps the unregistered class "U";
  * a vendor refusal (401, 402, 403, 404, the 24-hour refused window) is the leg's own `not_in_plan`
    state, an answer and not an error; an empty answer is `none`; a 5xx or a timeout is `failed`;
  * both known answer shapes are read; unknown fields are dropped; a row without a date, or without
    one segment figure, is skipped and counted; shares are of the listed segments, computed here;
    periods newest first, capped, the oldest cut;
  * the vendor is asked once per stock and period per day (five minutes after a failed leg), never on
    the request thread; both legs failing is a `failed` answer held for five minutes.

Every symbol, segment name and figure below is invented. Nothing here reaches a vendor.
"""
from __future__ import annotations

import threading
import time

import pytest
import requests
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import MagicMock

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import revenue_segments as route
from api.services import fmp_client as fc
from api.services import held_build
from api.services import held_reads
from api.services import revenue_segments as rs

FREE_USER = {"id": "seg-free", "email": "free@example.test", "role": "member", "plan": "free"}
PAID_USER = {"id": "seg-paid", "email": "paid@example.test", "role": "member", "plan": "pro"}
PRODUCT = [
    {"symbol": "QQZA", "fiscalYear": 2030, "period": "FY", "reportedCurrency": "USD", "date": "2030-09-28",
     "data": {"Kettles": 600.0, "Lanterns": 300.0, "Ropes": 100.0}, "extra": "dropped"},
    {"symbol": "QQZA", "fiscalYear": 2029, "period": "FY", "reportedCurrency": None, "date": "2029-09-29",
     "data": {"Kettles": 500.0, "Lanterns": 250.0, "Ropes": "n/a"}},
    {"symbol": "QQZA", "fiscalYear": 2028, "period": "FY", "date": None, "data": {"Kettles": 1.0}},
    {"symbol": "QQZA", "fiscalYear": 2027, "period": "FY", "date": "2027-09-30", "data": {}},
]
REGION = [{"symbol": "QQZA", "fiscalYear": 2030, "period": "FY", "date": "2030-09-28",
           "data": {"Northland": 700.0, "Southmere": 300.0}}]


def _client(user):
    app = FastAPI()
    app.include_router(route.router)
    if user is not None:
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app, raise_server_exceptions=False)


# ── the route ────────────────────────────────────────────────────────────────────────────────

def test_the_route_is_one_paid_get_and_a_refused_caller_never_reaches_the_service(monkeypatch):
    asked = []
    monkeypatch.setattr(rs, "get_segments", lambda sym, period: asked.append((sym, period)) or {"status": "ok", "sym": sym})
    (r,) = route.router.routes
    assert r.path == "/api/research/revenue-segments/{ticker}" and r.methods == {"GET"}
    assert route.require_paid in {d.call for d in r.dependant.dependencies}
    assert route.require_paid.__module__ == "api.routers.revenue_segments"
    url = "/api/research/revenue-segments/QQZA"
    assert _client(None).get(url).status_code == 401
    refused = _client(FREE_USER).get(url)
    assert refused.status_code == 402 and refused.json() == {"detail": "Revenue by segment requires a paid plan"}
    assert _client(PAID_USER).get("/api/research/revenue-segments/not a ticker!").status_code == 400
    bad = _client(PAID_USER).get(url + "?period=monthly")
    assert bad.status_code == 400 and bad.json() == {"detail": "period must be annual or quarter"}
    assert asked == []
    assert _client(PAID_USER).get("/api/research/revenue-segments/qqza").json() == {"status": "ok", "sym": "QQZA"}
    assert _client(PAID_USER).get(url + "?period=Quarter").status_code == 200
    assert asked == [("QQZA", "annual"), ("QQZA", "quarter")]


def test_the_route_is_mounted_on_the_app():
    import re
    from pathlib import Path
    src = (Path(__file__).resolve().parents[1] / "api" / "main.py").read_text(encoding="utf-8")
    assert re.search(r"^from api\.routers import revenue_segments as revenue_segments_router\b", src, re.M)
    assert re.search(r"^app\.include_router\(revenue_segments_router\.router\)", src, re.M)


# ── the typed functions ──────────────────────────────────────────────────────────────────────

@pytest.fixture
def adapter(monkeypatch):
    monkeypatch.setenv("FMP_API_KEY", "test-key")
    monkeypatch.setenv("FMP_RESPONSE_CACHE", "0")
    fc._bucket_tokens = fc._FMP_RATE_LIMIT_PER_MIN
    fc._bucket_updated = time.monotonic()
    from api.services.cache import cache
    for p in ("/stable/revenue-product-segmentation", "/stable/revenue-geographic-segmentation"):
        cache.invalidate(f"fmp_forbidden_{p}")
    calls = []

    def answer(status=200, body=None):
        def get(url, params=None, timeout=None):
            calls.append((url, dict(params or {}), timeout))
            resp = MagicMock()
            resp.status_code = status
            resp.json.return_value = body if body is not None else []
            if status >= 400:
                resp.raise_for_status.side_effect = requests.exceptions.HTTPError(f"{status}")
            else:
                resp.raise_for_status.return_value = None
            return resp
        monkeypatch.setattr(fc._session, "get", get)
        return calls

    yield answer
    for p in ("/stable/revenue-product-segmentation", "/stable/revenue-geographic-segmentation"):
        cache.invalidate(f"fmp_forbidden_{p}")


@pytest.mark.parametrize("name,path", [
    ("get_revenue_product_segmentation", "/stable/revenue-product-segmentation"),
    ("get_revenue_geographic_segmentation", "/stable/revenue-geographic-segmentation"),
])
def test_each_function_sends_its_own_path_with_symbol_and_period_and_stamps_U(adapter, name, path):
    calls = adapter(200, PRODUCT)
    res = getattr(fc, name)("qqza", period="quarter")
    ((url, params, timeout),) = calls
    assert url == f"{fc._BASE_URL}{path}"
    assert {k: v for k, v in params.items() if k != "apikey"} == {"symbol": "QQZA", "period": "quarter"}
    assert timeout == fc._DEFAULT_TIMEOUT
    assert res.value == PRODUCT and res.licensing_class == "U"
    assert res.provenance.source_activity == f"fmp_client.{name}"
    calls.clear()
    getattr(fc, name)("QQZA")
    assert calls[0][1]["period"] == "annual"
    assert path in rs.__doc__ or name in rs.__doc__


def test_the_two_paths_keep_the_response_caches_one_day_lifetime():
    from api.services import fmp_response_cache as frc
    assert frc.TTL["/stable/revenue-product-segmentation"] == 24 * 3600 == rs.TTL_S
    assert frc.TTL["/stable/revenue-geographic-segmentation"] == 24 * 3600


@pytest.mark.parametrize("status,state", [(401, "not_in_plan"), (402, "not_in_plan"), (403, "not_in_plan"),
                                          (404, "not_in_plan"), (500, "failed"), (429, "rate_limited")])
def test_a_vendor_refusal_is_not_in_plan_and_an_outage_is_failed(adapter, status, state):
    adapter(status, {"Error Message": "made up"})
    got = held_reads.fmp_leg(fc.get_revenue_product_segmentation, "QQZA", period="annual")
    assert got[0] == state
    if state == "not_in_plan":
        assert got[2] == status


def test_an_empty_answer_is_none_and_the_refused_window_is_not_in_plan(adapter):
    adapter(200, [])
    assert held_reads.fmp_leg(fc.get_revenue_product_segmentation, "QQZA", period="annual")[0] == "none"
    adapter(403, None)
    held_reads.fmp_leg(fc.get_revenue_product_segmentation, "QQZA", period="annual")
    calls = adapter(200, PRODUCT)
    calls.clear()
    # inside the adapter's 24-hour refused window no request goes out, and the leg still says not_in_plan
    assert held_reads.fmp_leg(fc.get_revenue_product_segmentation, "QQZA", period="annual")[0] == "not_in_plan"
    assert calls == []


def test_a_missing_key_is_not_configured(monkeypatch):
    monkeypatch.delenv("FMP_API_KEY", raising=False)
    assert held_reads.fmp_leg(fc.get_revenue_product_segmentation, "QQZA", period="annual")[0] == "not_configured"


# ── shaping ──────────────────────────────────────────────────────────────────────────────────

def test_periods_newest_first_with_shares_of_the_listed_segments_and_unreadable_rows_counted():
    got = rs.shape_periods(PRODUCT)
    assert got["dropped"] == 2 and got["cut"] is False
    assert [p["date"] for p in got["periods"]] == ["2030-09-28", "2029-09-29"]
    newest = got["periods"][0]
    assert newest == {"date": "2030-09-28", "fiscal_year": "2030", "label": "FY2030", "currency": "USD", "total": 1000.0,
                      "segments": [{"name": "Kettles", "revenue": 600.0, "share": 60.0},
                                   {"name": "Lanterns", "revenue": 300.0, "share": 30.0},
                                   {"name": "Ropes", "revenue": 100.0, "share": 10.0}], "cut": False}
    older = got["periods"][1]
    assert [s["name"] for s in older["segments"]] == ["Kettles", "Lanterns"]       # "n/a" is left out, never 0
    assert older["currency"] is None and older["total"] == 750.0


def test_the_older_answer_shape_and_a_quarter_label_are_read():
    got = rs.shape_periods([{"2030-06-30": {"Kettles": 50, "Lanterns": 50}},
                            {"symbol": "QQZA", "fiscalYear": 2030, "period": "Q2", "date": "2030-03-31", "data": {"Kettles": 40}}])
    assert [(p["date"], p["label"]) for p in got["periods"]] == [("2030-06-30", "2030-06-30"), ("2030-03-31", "Q2 FY2030")]
    assert got["periods"][0]["segments"][0]["share"] == 50.0


def test_a_negative_segment_has_no_share_and_does_not_count_toward_the_total():
    got = rs.shape_periods([{"date": "2030-09-28", "data": {"Kettles": 80.0, "Adjustments": -20.0, "Lanterns": 20.0}}])
    p = got["periods"][0]
    assert p["total"] == 100.0
    assert {s["name"]: s["share"] for s in p["segments"]} == {"Kettles": 80.0, "Lanterns": 20.0, "Adjustments": None}


def test_past_the_caps_the_newest_periods_and_largest_segments_are_kept(monkeypatch):
    monkeypatch.setattr(rs, "PERIOD_CAP", 2)
    monkeypatch.setattr(rs, "SEGMENT_CAP", 1)
    rows = [{"date": f"20{y}-12-31", "data": {"Kettles": 2.0, "Lanterns": 1.0}} for y in (27, 28, 29, 30)]
    got = rs.shape_periods(rows)
    assert [p["date"] for p in got["periods"]] == ["2030-12-31", "2029-12-31"] and got["cut"] is True
    assert got["periods"][0]["segments"] == [{"name": "Kettles", "revenue": 2.0, "share": 66.67}]
    assert got["periods"][0]["cut"] is True


def test_not_a_list_reads_as_nothing():
    assert rs.shape_periods({"Error Message": "x"}) == {"periods": [], "dropped": 0, "cut": False}


# ── holding, and how often the vendor is asked ───────────────────────────────────────────────

class Vendor:
    def __init__(self):
        self.asked = []
        self.answers = {"product": ("ok", PRODUCT), "region": ("ok", REGION)}
        self.gate = None

    def leg(self, fn, sym, period=None):
        if self.gate is not None:
            self.gate.wait(10)
        kind = "product" if fn is fc.get_revenue_product_segmentation else "region"
        self.asked.append((kind, sym, period, threading.current_thread().name))
        state, value = self.answers[kind]
        return state, value, (403 if state == "not_in_plan" else None)


@pytest.fixture
def vendor(monkeypatch):
    v = Vendor()
    monkeypatch.setattr(rs, "fmp_leg", v.leg)
    rs.reset_for_tests()
    yield v
    if v.gate is not None:
        v.gate.set()
    rs._held.drain(10)
    rs.reset_for_tests()


def built(sym="QQZA", period="annual"):
    out = rs.get_segments(sym, period, wait_s=10)
    rs._held.drain(10)
    return out


def test_one_build_makes_the_two_reads_off_the_request_thread(vendor):
    body = built()
    assert body["status"] == "ok" and body["sym"] == "QQZA" and body["period"] == "annual" and body["source"] == "Financial Modeling Prep"
    assert [(k, s, p) for k, s, p, _t in vendor.asked] == [("product", "QQZA", "annual"), ("region", "QQZA", "annual")]
    assert all(t != threading.current_thread().name for *_x, t in vendor.asked)
    assert body["product"]["state"] == "ok" and len(body["product"]["periods"]) == 2 and body["product"]["dropped"] == 2
    assert body["region"]["periods"][0]["segments"][0] == {"name": "Northland", "revenue": 700.0, "share": 70.0}


def test_a_held_answer_is_not_asked_for_again_within_the_day_and_each_period_is_its_own(vendor):
    built()
    for _ in range(4):
        assert rs.get_segments("QQZA", "annual", wait_s=0)["status"] == "ok"
    built(period="quarter")
    built(sym="QQZB")
    rs._held.drain(10)
    assert [(k, s, p) for k, s, p, _t in vendor.asked] == [
        ("product", "QQZA", "annual"), ("region", "QQZA", "annual"),
        ("product", "QQZA", "quarter"), ("region", "QQZA", "quarter"),
        ("product", "QQZB", "annual"), ("region", "QQZB", "annual")]


def test_with_nothing_held_a_slow_read_answers_computing_and_starts_one_build(vendor):
    vendor.gate = threading.Event()
    assert rs.get_segments("QQZA", "annual", wait_s=0.05) == {"status": "computing", "sym": "QQZA", "period": "annual",
                                                               "source": "Financial Modeling Prep"}
    assert rs.get_segments("QQZA", "annual", wait_s=0.05)["status"] == "computing"
    vendor.gate.set()
    rs._held.drain(10)
    assert rs.get_segments("QQZA", "annual", wait_s=0)["status"] == "ok"
    assert len([a for a in vendor.asked if a[0] == "product"]) == 1


def test_a_plan_that_lacks_an_endpoint_is_an_answer_about_the_source(vendor):
    vendor.answers = {"product": ("not_in_plan", None), "region": ("not_in_plan", None)}
    body = built()
    assert body["status"] == "ok"
    assert body["product"] == {"state": "not_in_plan", "http_status": 403, "periods": [], "dropped": 0, "cut": False}
    assert body["region"]["state"] == "not_in_plan"


def test_an_answer_with_no_readable_period_is_none(vendor):
    vendor.answers = {"product": ("ok", [{"date": None, "data": {}}]), "region": ("none", None)}
    body = built()
    assert body["product"]["state"] == "none" and body["product"]["dropped"] == 1
    assert body["region"]["state"] == "none"


def test_both_legs_failing_is_a_failed_answer_held_for_five_minutes(vendor):
    vendor.answers = {"product": ("failed", None), "region": ("rate_limited", None)}
    body = built()
    assert body == {"status": "failed", "reason": "source", "http_status": None, "sym": "QQZA", "period": "annual",
                    "source": "Financial Modeling Prep"}
    for _ in range(3):
        assert rs.get_segments("QQZA", "annual", wait_s=0)["status"] == "failed"
    rs._held.drain(10)
    assert len(vendor.asked) == 2


def test_the_refresh_rule_is_a_day_or_five_minutes_after_a_failed_leg():
    ok = {"product": {"state": "ok"}, "region": {"state": "not_in_plan"}}
    partial = {"product": {"state": "ok"}, "region": {"state": "failed"}}
    assert rs.refresh_due(ok, 100.0, now=100.0 + 86_399) is False
    assert rs.refresh_due(ok, 100.0, now=100.0 + 86_400) is True
    assert rs.refresh_due(partial, 100.0, now=100.0 + 299) is False
    assert rs.refresh_due(partial, 100.0, now=100.0 + 300) is True


def test_one_failed_leg_keeps_the_other_and_is_refreshed_sooner(vendor):
    vendor.answers = {"product": ("ok", PRODUCT), "region": ("failed", None)}
    body = built()
    assert body["status"] == "ok" and body["product"]["state"] == "ok" and body["region"]["state"] == "failed"


def test_at_most_max_keys_are_held(vendor, monkeypatch):
    small = held_reads.KeyedHeld("t", rs._build_for, rs.refresh_due, max_keys=2, valid=rs._valid)
    monkeypatch.setattr(rs, "_held", small)
    for s in ("QQZA", "QQZB", "QQZC"):
        built(sym=s)
    assert small.keys() == [("QQZB", "annual"), ("QQZC", "annual")]


def test_the_build_raises_the_house_stop(vendor):
    vendor.answers = {"product": ("failed", None), "region": ("failed", None)}
    with pytest.raises(held_build.Stop) as stop:
        rs._build_for(("QQZA", "annual"))()
    assert stop.value.hold == rs.RETRY_S == 300
