"""The real yield block of the RATES read (`api/services/treasury_real_yields.py`) and the
breakevens it computes. Every figure here is invented. Nothing reaches the Treasury: the one
reader (`treasury_yields._http_get`) is stood in for, and every call it gets is recorded.
"""
from __future__ import annotations

import threading
import time
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import treasury_yields as route
from api.services import held_build
from api.services import treasury_real_yields as real
from api.services import treasury_yields as ty

NY = ZoneInfo("America/New_York")
NOW = datetime(2026, 11, 18, 12, 0, tzinfo=NY)       # a Wednesday; the newest figure is the 17th
XML_TYPE = "application/xml; charset=utf-8"
FIELDS = {key: field for key, field, _label, _months in real.MATURITIES}
HEAD = ('<?xml version="1.0" encoding="utf-8" standalone="yes" ?>\n'
        '<feed xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices" '
        'xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata" xmlns="http://www.w3.org/2005/Atom">\n')
BASE = {"5y": 1.21, "7y": 1.43, "10y": 1.64, "20y": 2.02, "30y": 2.18}


def row(day: str, **over) -> dict:
    return {"date": day, **BASE, **over}


def feed_xml(rows, fields=FIELDS) -> bytes:
    out = [HEAD]
    for i, r in enumerate(rows):
        props = [f'<d:NEW_DATE m:type="Edm.DateTime">{r["date"]}T00:00:00</d:NEW_DATE>']
        props += [f'<d:{field} m:type="Edm.Double">{r[key]}</d:{field}>' for key, field in fields.items() if r.get(key) is not None]
        out.append(f'<entry><id>x({i})</id><content type="application/xml"><m:properties>{"".join(props)}</m:properties></content></entry>\n')
    return ("".join(out) + "</feed>\n").encode("utf-8")


ROWS = [row("2026-10-28", **{"10y": 1.70}), row("2026-10-29"), row("2026-10-30"),
        row("2026-11-10", **{"5y": 1.11, "10y": 1.50}), row("2026-11-13"), row("2026-11-16", **{"5y": 1.25, "10y": 1.60}),
        row("2026-11-17", **{"30y": None})]


class Site:
    def __init__(self):
        self.rows = list(ROWS)
        self.calls: list[dict] = []
        self.threads: list[str] = []
        self.pauses: list[float] = []
        self.answer = None                       # (status, type, body) for every call, when set
        self.fields = FIELDS

    def get(self, params):
        self.calls.append(dict(params))
        self.threads.append(threading.current_thread().name)
        if isinstance(self.answer, BaseException):
            raise self.answer
        if self.answer is not None:
            return self.answer
        prefix = ty.period_of("month", params[ty.MONTH_PARAM])
        return 200, XML_TYPE, feed_xml([r for r in self.rows if r["date"].startswith(prefix)], self.fields)

    def months(self):
        return [c.get(ty.MONTH_PARAM) for c in self.calls]


NOMINAL = {"2026-11-16": {"5y": 3.80, "7y": 3.95, "10y": 4.10, "20y": 4.50, "30y": 4.60},
           "2026-11-17": {"5y": 3.85, "7y": 3.99, "10y": 4.12, "20y": None, "30y": 4.61}}


@pytest.fixture
def site(monkeypatch, tmp_path):
    s = Site()
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(ty, "_http_get", s.get)
    monkeypatch.setattr(ty, "_pause", s.pauses.append)
    monkeypatch.setattr(ty, "now_et", lambda: NOW)
    monkeypatch.setattr(ty, "held_rows", lambda days=None: {d: dict(v) for d, v in NOMINAL.items()})
    real.reset_for_tests()
    yield s
    real._held.drain(10)
    real.reset_for_tests()


def built(site, **kw):
    out = real.get_real(wait_s=10, **kw)
    real._held.drain(10)
    return out


# ── the plan and the request ─────────────────────────────────────────────────────────────────

def test_a_first_build_asks_for_last_month_and_this_month_and_a_refresh_for_this_month_only():
    today = date(2026, 11, 18)
    assert real.plan(today, []) == [("202610", False), ("202611", True)]
    assert real.plan(today, ["2026-10-30"]) == [("202610", False), ("202611", True)]
    assert real.plan(today, ["2026-10-30", "2026-11-17"]) == [("202611", True)]
    assert real.plan(date(2026, 1, 5), []) == [("202512", False), ("202601", True)]


def test_the_build_asks_the_real_curve_feed_twice_off_the_request_with_a_pause_between(site):
    out = built(site)
    assert out["status"] == "ok"
    assert [c["data"] for c in site.calls] == ["daily_treasury_real_yield_curve"] * 2
    assert site.months() == ["202610", "202611"] and site.pauses == [ty.PAUSE_S]
    assert all(set(c) == {"data", ty.MONTH_PARAM} for c in site.calls)
    assert set(site.threads) == {"rates-real-data-build"}          # never the caller's thread


def test_a_request_never_waits_on_the_treasury_and_the_held_answer_is_not_asked_for_again(site):
    gate = threading.Event()
    inner = site.get
    site_get = lambda params: (gate.wait(10), inner(params))[1]      # noqa: E731
    ty._http_get = site_get
    try:
        started = time.time()
        assert real.get_real(wait_s=0) == {"status": "computing"}
        assert time.time() - started < 2
    finally:
        gate.set()
    real._held.drain(10)
    assert real.get_real(wait_s=0)["status"] == "ok" and len(site.calls) == 2
    for _ in range(5):
        real.get_real(wait_s=0)
    real._held.drain(10)
    assert len(site.calls) == 2                                     # looked at noon after the evening slot: nothing is due


# ── the block ────────────────────────────────────────────────────────────────────────────────

def test_each_maturity_carries_its_real_yield_and_a_missing_one_is_none_never_zero(site):
    out = built(site)
    assert out["as_of"] == "2026-11-17" and out["source"] == real.SOURCE and out["basis"] == "end_of_day"
    assert [m["key"] for m in out["maturities"]] == ["5y", "7y", "10y", "20y", "30y"]
    by = {m["key"]: m for m in out["maturities"]}
    assert by["10y"]["yield"] == 1.64 and by["10y"]["label"] == "10-year" and by["10y"]["months"] == 120
    assert by["30y"]["yield"] is None and by["30y"]["change_bp"] == {"d1": None, "w1": None}
    assert out["ref_dates"] == {"d1": "2026-11-16", "w1": "2026-11-10"}
    assert by["10y"]["was"] == {"d1": 1.60, "w1": 1.50} and by["10y"]["change_bp"] == {"d1": 4.0, "w1": 14.0}
    assert by["5y"]["change_bp"] == {"d1": -4.0, "w1": 10.0}
    assert out["rows"] == 7 and out["check"] is None and out["read_at"]


def test_a_reference_day_too_far_back_gives_no_change_rather_than_a_wrong_one(site):
    site.rows = [row("2026-10-20"), row("2026-11-17")]
    out = built(site)
    assert out["ref_dates"] == {"d1": None, "w1": None}
    assert all(m["change_bp"] == {"d1": None, "w1": None} for m in out["maturities"])


def test_the_breakeven_is_nominal_minus_real_on_the_newest_day_both_curves_hold(site):
    out = built(site)["breakevens"]
    assert out["as_of"] == "2026-11-17"
    by = {r["key"]: r for r in out["rows"]}
    assert by["10y"] == {"key": "10y", "label": "10-year", "months": 120, "date": "2026-11-17", "nominal": 4.12, "real": 1.64, "value": 2.48}
    assert by["5y"]["value"] == round(3.85 - 1.21, 2)
    # either side missing: None, never 0 and never the other side
    assert by["20y"]["nominal"] is None and by["20y"]["real"] == 2.02 and by["20y"]["value"] is None
    assert by["30y"]["nominal"] == 4.61 and by["30y"]["real"] is None and by["30y"]["value"] is None


def test_the_breakeven_keeps_its_own_date_when_one_curve_is_a_day_ahead(site, monkeypatch):
    monkeypatch.setattr(ty, "held_rows", lambda days=None: {"2026-11-16": dict(NOMINAL["2026-11-16"])})
    out = built(site)
    assert out["as_of"] == "2026-11-17" and out["breakevens"]["as_of"] == "2026-11-16"
    ten = next(r for r in out["breakevens"]["rows"] if r["key"] == "10y")
    assert ten == {"key": "10y", "label": "10-year", "months": 120, "date": "2026-11-16", "nominal": 4.10, "real": 1.60, "value": 2.5}


def test_with_no_day_in_common_every_breakeven_is_none(site, monkeypatch):
    monkeypatch.setattr(ty, "held_rows", lambda days=None: {"2026-09-01": dict(NOMINAL["2026-11-16"])})
    out = built(site)["breakevens"]
    assert out["as_of"] is None and all(r["value"] is None and r["date"] is None for r in out["rows"])


# ── a source that does not answer ────────────────────────────────────────────────────────────

def test_a_refusal_is_said_and_remembered_not_asked_again_on_the_next_request(site):
    site.answer = (403, "text/html", b"<html>no</html>")
    assert built(site) == {"status": "unavailable", "reason": "refused", "http_status": 403}
    assert len(site.calls) == 1
    for _ in range(4):
        assert real.get_real(wait_s=0)["status"] == "unavailable"
    real._held.drain(10)
    assert len(site.calls) == 1


def test_a_feed_that_carries_none_of_the_real_elements_is_a_shape_answer_never_zeros(site):
    site.fields = {key: f"XX_{field}" for key, field in FIELDS.items()}      # the days are there; the elements are not
    out = built(site)
    assert out == {"status": "unavailable", "reason": "shape", "http_status": 200}
    assert "maturities" not in out


@pytest.mark.parametrize("answer, said", [
    ((429, "text/plain", b""), {"status": "failed", "reason": "rate_limited", "http_status": 429}),
    ((503, "text/plain", b""), {"status": "failed", "reason": "source", "http_status": 503}),
    (TimeoutError("slow"), {"status": "failed", "reason": "timeout", "http_status": None}),
])
def test_a_failed_read_is_failed_with_its_reason(site, answer, said):
    site.answer = answer
    assert built(site) == said


def test_a_look_that_fails_keeps_the_last_good_figures_and_says_so(site):
    first = built(site)
    assert first["status"] == "ok" and len(site.calls) == 2
    site.answer = (503, "text/plain", b"")
    with real._held._lock:
        real._held._state["checked"] = 0.0                           # the evening slot has passed since the last look
    again = real.get_real(wait_s=0)
    real._held.drain(10)
    after = real.get_real(wait_s=0)
    assert again["status"] == "ok" and len(site.calls) == 3 and site.months()[-1] == "202611"      # a refresh is one request
    assert after["status"] == "ok" and after["as_of"] == "2026-11-17" and after["maturities"] == first["maturities"]
    assert after["check"]["state"] == "failed" and after["check"]["reason"] == "source" and after["check"]["http_status"] == 503


def test_the_held_days_survive_a_restart_without_a_request(site):
    first = built(site)
    real.reset_for_tests()
    site.calls.clear()
    with_disk = real.get_real(wait_s=0)
    real._held.drain(10)
    assert with_disk["status"] == "ok" and with_disk["maturities"] == first["maturities"]
    assert site.calls == []                                          # read at noon after the evening slot: not due


def test_a_broken_block_never_raises(monkeypatch):
    monkeypatch.setattr(real._held, "get", lambda **kw: (_ for _ in ()).throw(RuntimeError("x")))
    assert real.get_real() == {"status": "failed", "reason": "error", "http_status": None}


# ── the route ────────────────────────────────────────────────────────────────────────────────

PAID_USER = {"id": "tr-paid", "email": "paid@example.test", "role": "member", "plan": "pro"}
URL = "/api/research/treasury-yields"


def _client():
    app = FastAPI()
    app.include_router(route.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(PAID_USER)
    return TestClient(app, raise_server_exceptions=False)


def test_the_route_adds_the_real_block_beside_an_ok_answer_and_never_waits_for_it(monkeypatch):
    waits = []
    monkeypatch.setattr(ty, "get_yields", lambda: {"status": "ok", "as_of": "2026-11-17", "maturities": []})
    monkeypatch.setattr(real, "get_real", lambda **kw: waits.append(kw) or {"status": "ok", "as_of": "2026-11-17"})
    body = _client().get(URL).json()
    assert body == {"status": "ok", "as_of": "2026-11-17", "maturities": [], "real": {"status": "ok", "as_of": "2026-11-17"}}
    assert waits == [{"wait_s": 0}]


@pytest.mark.parametrize("nominal", [{"status": "computing"}, {"status": "unavailable", "reason": "refused", "http_status": 403},
                                     {"status": "failed", "reason": "source", "http_status": 503}])
def test_the_real_block_is_not_asked_for_without_a_nominal_answer(monkeypatch, nominal):
    monkeypatch.setattr(ty, "get_yields", lambda: dict(nominal))
    monkeypatch.setattr(real, "get_real", lambda **kw: pytest.fail("asked without a nominal answer"))
    assert _client().get(URL).json() == nominal


def test_the_agents_read_of_the_nominal_curve_carries_no_real_block(site):
    built(site)
    answer, how = ty.held_answer()
    assert how == "not_held" and answer is None                      # this module never builds or fills the nominal answer


def test_the_real_module_asks_only_through_the_nominal_services_reader():
    import ast
    import inspect
    source = inspect.getsource(real)
    imported = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            imported |= {a.name for a in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported |= {f"{node.module}.{a.name}" for a in node.names}
    assert imported == {"__future__.annotations", "datetime.date", "datetime.timedelta", "typing.Optional",
                        "api.services.held_build", "api.services.treasury_yields"}
    assert "://" not in source                                        # no address of its own
    assert source.count("ty.fetch_period(") == 1 and "_http_get" not in source
    assert held_build.Stop.__name__ in source and "HeldBuild(" in source


# ── what the Treasury documents, and what the nominal module lends ─────────────────────────────

def test_the_feed_and_the_elements_are_the_ones_the_treasury_documents():
    # "Treasury Daily Interest Rate XML Feed", section 4 (daily Treasury real par yield curve rates)
    assert real.FEED == "daily_treasury_real_yield_curve"
    assert [(k, f) for k, f, _label, _months in real.MATURITIES] == [
        ("5y", "TC_5YEAR"), ("7y", "TC_7YEAR"), ("10y", "TC_10YEAR"), ("20y", "TC_20YEAR"), ("30y", "TC_30YEAR")]
    assert ty.DATE_FIELD == "NEW_DATE"
    # each key is one the nominal curve also carries, so a breakeven pairs by key
    assert {k for k, *_ in real.MATURITIES} <= {k for k, *_ in ty.MATURITIES}


def test_the_block_asks_the_nominal_module_only_for_the_days_it_holds(site, monkeypatch):
    asked = []
    monkeypatch.setattr(ty, "held_rows", lambda days=None: asked.append(sorted(days)) or {d: dict(v) for d, v in NOMINAL.items()})
    out = built(site)
    assert out["breakevens"]["as_of"] == "2026-11-17"
    assert asked and asked[-1] == sorted(r["date"] for r in ROWS)


def test_the_nominal_modules_held_rows_never_builds_and_copies_only_the_days_named(monkeypatch):
    ty.reset_for_tests()
    monkeypatch.setattr(ty, "_start_job", lambda: pytest.fail("held_rows started a build"))
    monkeypatch.setattr(ty, "_load_disk", lambda: (None, {}, 0.0))
    try:
        assert ty.held_rows() == {} and ty.held_rows(["2026-11-17"]) == {}
        with ty._lock:
            ty._state.update({"held": {"as_of": "2026-11-17"}, "loaded": True,
                              "rows": {"2026-11-16": {"10y": 4.10}, "2026-11-17": {"10y": 4.12}}})
        got = ty.held_rows(["2026-11-17", "2026-11-01"])
        assert got == {"2026-11-17": {"10y": 4.12}}
        got["2026-11-17"]["10y"] = 0.0                                       # a copy: the held rows are untouched
        assert ty._state["rows"]["2026-11-17"]["10y"] == 4.12
        assert set(ty.held_rows()) == {"2026-11-16", "2026-11-17"}
    finally:
        ty.reset_for_tests()


def test_after_a_failed_refresh_the_feed_is_asked_again_only_once_the_hold_has_passed(site):
    built(site)
    site.answer = (503, "text/plain", b"")
    with real._held._lock:
        real._held._state["checked"] = 0.0                                   # the evening slot has passed since the last look
    real.get_real(wait_s=0)
    real._held.drain(10)
    assert len(site.calls) == 3
    for _ in range(4):
        real.get_real(wait_s=0)
    real._held.drain(10)
    assert len(site.calls) == 3                                              # within the hold: not asked per request
    with real._held._lock:
        assert real._held._state["checked"] == 0.0                           # a failed look is not a look that worked
        real._held._state["retry_at"] = 0.0                                  # the hold has passed
    real.get_real(wait_s=0)
    real._held.drain(10)
    assert len(site.calls) == 4


def test_every_build_writes_one_log_line_with_its_requests_and_rows(site, caplog):
    import logging
    with caplog.at_level(logging.INFO, logger="api.services.held_build"):
        built(site)
    lines = [r.getMessage() for r in caplog.records if r.name == "api.services.held_build"]
    assert len(lines) == 1
    assert lines[0].startswith("[rates-real-data] treasury-real status=200 rows=7 requests=2 latest=2026-11-17")
