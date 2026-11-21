"""DVD MARKET, the Terminal's market-wide dividend and split calendar (`api/services/dividends_market.py`,
the route in `api/routers/market_dividends.py`, and the date-range read
`reference_corp_actions.fetch_market_dividends_strict`).

What is held here:
  * the route is one paid GET: signed out 401, a free plan 402, neither reaches the service;
  * the date-range read asks Massive's reference dividends endpoint for an ex-date RANGE with no
    ticker, through the one owned client, bounded pages, and an outage raises (never an empty list);
  * the window is this week's Monday to next week's Sunday, New York dates;
  * only stocks in the site's universe are listed; how many were left out is counted; a row without
    a day or a symbol is skipped and counted; a missing amount is None, never 0;
  * rows are soonest first, capped, and a cut says so;
  * the vendor is asked once per window per lifetime (12 hours, 5 minutes after a partial read),
    never on the request thread; a week that turns starts one new read; both reads failing is a
    `failed` answer held for the short lifetime, and the last good list is kept beside a failed look.

Every symbol, name, date and amount below is invented. Nothing here reaches a vendor.
"""
from __future__ import annotations

import threading
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import market_dividends as route
from api.services import dividends_calendar as per_stock
from api.services import dividends_market as dm
from api.services import held_build
from api.services import reference_corp_actions as rca

FREE_USER = {"id": "dm-free", "email": "free@example.test", "role": "member", "plan": "free"}
PAID_USER = {"id": "dm-paid", "email": "paid@example.test", "role": "member", "plan": "pro"}
URL = "/api/research/market-dividends"
TODAY = date(2031, 3, 12)                 # a Wednesday
WINDOW = {"from": "2031-03-10", "to": "2031-03-23"}
FOLLOWED = frozenset({"QQZA", "QQZB", "QQZC", "QQZD"})
NAMES = {"QQZA": "Quillfeather Mills", "QQZB": "Bramblecourt Foods"}


def _client(user):
    app = FastAPI()
    app.include_router(route.router)
    if user is not None:
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app, raise_server_exceptions=False)


class Vendor:
    """Stands in for the two date-range reads; counts every ask."""

    def __init__(self):
        self.dividends = [
            {"ticker": "QQZB", "ex_dividend_date": "2031-03-14", "cash_amount": 0.31, "currency": "USD", "frequency": 4,
             "dividend_type": "CD", "pay_date": "2031-03-28", "declaration_date": "2031-02-20", "record_date": "2031-03-14"},
            {"ticker": "QQZA", "ex_dividend_date": "2031-03-11", "cash_amount": 1.05, "currency": "USD", "frequency": 12,
             "dividend_type": "CD", "pay_date": "2031-03-20", "declaration_date": "2031-02-02", "record_date": "2031-03-11"},
            {"ticker": "ZZNOTF", "ex_dividend_date": "2031-03-12", "cash_amount": 0.2},           # not followed
            {"ticker": "QQZC", "ex_dividend_date": "2031-03-18", "cash_amount": None, "frequency": 0, "dividend_type": "SC"},
            {"ticker": "QQZA", "ex_dividend_date": "2031-03-11", "cash_amount": 1.05, "currency": "USD", "frequency": 12,
             "dividend_type": "CD", "pay_date": "2031-03-20", "declaration_date": "2031-02-02", "record_date": "2031-03-11"},
            {"ticker": "QQZD", "ex_dividend_date": "soon", "cash_amount": 0.5},                    # no real day
        ]
        self.splits = [
            {"ticker": "QQZD", "execution_date": "2031-03-19", "split_from": 1, "split_to": 4},
            {"ticker": "QQZC", "execution_date": "2031-03-13", "split_from": 10, "split_to": 1},
            {"ticker": "ZZOTHER", "execution_date": "2031-03-13", "split_from": 1, "split_to": 2},
        ]
        self.asked = []
        self.fail = set()
        self.gate = None

    def div(self, start, end):
        if self.gate is not None:
            self.gate.wait(10)
        self.asked.append(("dividends", start, end, threading.current_thread().name))
        if "dividends" in self.fail:
            raise rca.CorpActionsUnavailable("down")
        return list(self.dividends)

    def spl(self, start, end):
        self.asked.append(("splits", start, end, threading.current_thread().name))
        if "splits" in self.fail:
            raise rca.CorpActionsUnavailable("down")
        return list(self.splits)


@pytest.fixture
def vendor(monkeypatch, tmp_path):
    v = Vendor()
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(dm, "today_et", lambda: TODAY)
    monkeypatch.setattr(dm, "universe", lambda: FOLLOWED)
    monkeypatch.setattr(dm, "held_name", lambda s: NAMES.get(s))
    monkeypatch.setattr(rca, "fetch_market_dividends_strict", v.div)
    monkeypatch.setattr(rca, "fetch_confirmed_splits_strict", v.spl)
    dm._held.reset()
    yield v
    if v.gate is not None:
        v.gate.set()
    dm._held.drain(10)
    dm._held.reset()


def built():
    out = dm.get_market_dividends(wait_s=10)
    dm._held.drain(10)
    return out


# ── the route ────────────────────────────────────────────────────────────────────────────────

def test_the_route_is_one_paid_get_and_a_refused_caller_never_reaches_the_service(monkeypatch):
    asked = []
    monkeypatch.setattr(dm, "get_market_dividends", lambda **k: asked.append(1) or {"status": "ok"})
    (r,) = route.router.routes
    assert r.path == URL and r.methods == {"GET"}
    assert route.require_paid in {d.call for d in r.dependant.dependencies}
    assert route.require_paid.__module__ == "api.routers.market_dividends"
    assert _client(None).get(URL).status_code == 401
    refused = _client(FREE_USER).get(URL)
    assert refused.status_code == 402 and refused.json() == {"detail": "The market dividend calendar requires a paid plan"}
    assert asked == []
    assert _client(PAID_USER).get(URL).json() == {"status": "ok"}
    assert asked == [1]


def test_the_route_is_mounted_on_the_app():
    import re
    from pathlib import Path
    src = (Path(__file__).resolve().parents[1] / "api" / "main.py").read_text(encoding="utf-8")
    assert re.search(r"^from api\.routers import market_dividends as market_dividends_router\b", src, re.M)
    assert re.search(r"^app\.include_router\(market_dividends_router\.router\)", src, re.M)


def test_the_route_serves_the_services_answer_end_to_end(vendor):
    first = _client(PAID_USER).get(URL)
    dm._held.drain(10)
    body = first.json() if first.json().get("status") == "ok" else _client(PAID_USER).get(URL).json()
    assert body["status"] == "ok" and body["window"] == WINDOW
    assert [d["sym"] for d in body["dividends"]] == ["QQZA", "QQZB", "QQZC"]


# ── the date-range read ──────────────────────────────────────────────────────────────────────

def test_the_market_read_asks_for_an_ex_date_range_with_no_ticker_through_the_one_client(monkeypatch):
    from api.services import massive_adapter
    calls = []

    class Result:
        value = [
            {"ticker": "qqzb", "ex_dividend_date": "2031-03-14T00:00:00", "cash_amount": 0.31, "frequency": 4,
             "dividend_type": "CD", "pay_date": "2031-03-28", "declaration_date": "2031-02-20", "record_date": "2031-03-14",
             "currency": "USD", "id": "made-up"},
            {"ticker": "", "ex_dividend_date": "2031-03-14"},
            {"ticker": "QQZA"},
            "not a row",
        ]

    def get_pages(path, **kw):
        calls.append((path, kw))
        return Result()

    monkeypatch.setattr(massive_adapter, "get_pages", get_pages)
    rows = rca.fetch_market_dividends_strict("2031-03-10", "2031-03-23")
    ((path, kw),) = calls
    assert path == "/v3/reference/dividends"
    assert kw["params"] == {"ex_dividend_date.gte": "2031-03-10", "ex_dividend_date.lte": "2031-03-23",
                            "order": "asc", "sort": "ex_dividend_date", "limit": 1000}
    assert "ticker" not in kw["params"]
    assert kw["data_class"] == "reference" and kw["max_pages"] == 10
    assert rows == [{"ticker": "QQZB", "ex_dividend_date": "2031-03-14", "cash_amount": 0.31, "currency": "USD",
                     "frequency": 4, "dividend_type": "CD", "pay_date": "2031-03-28",
                     "declaration_date": "2031-02-20", "record_date": "2031-03-14"}]


def test_an_outage_or_a_truncated_window_raises_never_an_empty_list(monkeypatch):
    from api.services import massive_adapter

    def broken(*a, **k):
        raise RuntimeError("more than 10 pages")

    monkeypatch.setattr(massive_adapter, "get_pages", broken)
    with pytest.raises(rca.CorpActionsUnavailable):
        rca.fetch_market_dividends_strict("2031-03-10", "2031-03-23")


# ── shaping ──────────────────────────────────────────────────────────────────────────────────

def test_the_window_is_this_weeks_monday_to_next_weeks_sunday():
    assert dm.window(date(2031, 3, 12)) == WINDOW
    assert dm.window(date(2031, 3, 10)) == WINDOW            # a Monday is its own week's start
    assert dm.window(date(2031, 3, 16)) == WINDOW            # a Sunday still belongs to that week
    assert dm.window(date(2031, 3, 17)) == {"from": "2031-03-17", "to": "2031-03-30"}


def test_only_followed_stocks_soonest_first_deduplicated_with_what_was_left_out_counted(vendor):
    body = built()
    assert body["status"] == "ok" and body["source"] == "Massive reference data"
    assert [(d["sym"], d["ex_date"]) for d in body["dividends"]] == [("QQZA", "2031-03-11"), ("QQZB", "2031-03-14"),
                                                                     ("QQZC", "2031-03-18")]
    qqza = body["dividends"][0]
    assert qqza == {"sym": "QQZA", "ex_date": "2031-03-11", "amount": 1.05, "currency": "USD", "frequency": 12, "type": "CD",
                    "pay_date": "2031-03-20", "declared_date": "2031-02-02", "record_date": "2031-03-11",
                    "name": "Quillfeather Mills"}
    assert body["counts"] == {"dividends": 3, "splits": 2, "not_followed_dividends": 1, "not_followed_splits": 1}
    assert body["dropped"] == {"dividends": 1, "splits": 0}
    assert body["cut"] == {"dividends": False, "splits": False}
    assert body["caps"] == {"dividends": dm.DIVIDEND_CAP, "splits": dm.SPLIT_CAP}
    assert body["legs"] == {"dividends": "ok", "splits": "ok"}


def test_a_missing_amount_or_name_is_none_never_zero(vendor):
    body = built()
    qqzc = next(d for d in body["dividends"] if d["sym"] == "QQZC")
    assert qqzc["amount"] is None and qqzc["name"] is None and qqzc["pay_date"] is None and qqzc["frequency"] == 0
    # a zero, negative or unreadable figure is no figure either, never a $0 dividend
    rows = [{"ticker": "QQZA", "ex_dividend_date": "2031-03-11", "cash_amount": v, "pay_date": f"2031-03-{20 + i}"}
            for i, v in enumerate((0, -0.5, "n/a", float("nan")))]
    shaped, _meta = dm.shape_dividends(rows, FOLLOWED, lambda s: None)
    assert [d["amount"] for d in shaped] == [None, None, None, None]


def test_splits_carry_the_ratio_both_ways_soonest_first(vendor):
    body = built()
    assert body["splits"] == [
        {"sym": "QQZC", "date": "2031-03-13", "split_from": 10.0, "split_to": 1.0, "ratio": "1:10", "reverse": True, "name": None},
        {"sym": "QQZD", "date": "2031-03-19", "split_from": 1.0, "split_to": 4.0, "ratio": "4:1", "reverse": False, "name": None},
    ]


def test_past_the_cap_the_soonest_days_are_kept_and_the_cut_is_said(vendor, monkeypatch):
    monkeypatch.setattr(dm, "DIVIDEND_CAP", 2)
    monkeypatch.setattr(dm, "SPLIT_CAP", 1)
    body = built()
    assert [d["sym"] for d in body["dividends"]] == ["QQZA", "QQZB"]
    assert [s["sym"] for s in body["splits"]] == ["QQZC"]
    assert body["cut"] == {"dividends": True, "splits": True}


# ── holding, and how often the vendor is asked ───────────────────────────────────────────────

def test_one_build_makes_the_two_reads_off_the_request_thread_for_this_window(vendor):
    built()
    assert [(k, s, e) for k, s, e, _t in vendor.asked] == [("dividends", *WINDOW.values()), ("splits", *WINDOW.values())]
    assert all(t != threading.current_thread().name for *_x, t in vendor.asked)


def test_a_held_answer_is_not_asked_for_again_within_its_lifetime(vendor):
    built()
    for _ in range(5):
        assert dm.get_market_dividends(wait_s=10)["status"] == "ok"
    dm._held.drain(10)
    assert len(vendor.asked) == 2


def test_with_nothing_held_a_slow_read_answers_computing_and_starts_one_build(vendor):
    vendor.gate = threading.Event()
    assert dm.get_market_dividends(wait_s=0.05) == {"status": "computing", "source": "Massive reference data"}
    assert dm.get_market_dividends(wait_s=0.05)["status"] == "computing"
    vendor.gate.set()
    dm._held.drain(10)
    assert dm.get_market_dividends(wait_s=0)["status"] == "ok"
    assert len([a for a in vendor.asked if a[0] == "dividends"]) == 1


def test_the_lifetime_is_the_per_stock_reads_and_a_partial_read_is_refreshed_sooner():
    full = {"window": WINDOW, "legs": {"dividends": "ok", "splits": "ok"}}
    partial = {"window": WINDOW, "legs": {"dividends": "ok", "splits": "failed"}}
    assert per_stock._CACHE_TTL == 43_200 and per_stock._CACHE_TTL_PARTIAL == 300
    assert dm.refresh_due(full, 1000.0, now=1000.0 + 43_199, today=TODAY) is False
    assert dm.refresh_due(full, 1000.0, now=1000.0 + 43_200, today=TODAY) is True
    assert dm.refresh_due(partial, 1000.0, now=1000.0 + 299, today=TODAY) is False
    assert dm.refresh_due(partial, 1000.0, now=1000.0 + 300, today=TODAY) is True
    # a new week is due at once, whatever the lifetime
    assert dm.refresh_due(full, 1000.0, now=1001.0, today=date(2031, 3, 17)) is True


def test_a_week_that_turns_gives_the_held_list_at_once_marked_stale_and_reads_the_new_window_once(vendor, monkeypatch):
    built()
    monkeypatch.setattr(dm, "today_et", lambda: date(2031, 3, 17))
    stale = dm.get_market_dividends(wait_s=0)
    assert stale["status"] == "ok" and stale["window"] == WINDOW and stale["stale_window"] is True
    assert stale["current_window"] == {"from": "2031-03-17", "to": "2031-03-30"}
    dm._held.drain(10)
    fresh = dm.get_market_dividends(wait_s=0)
    assert fresh["window"] == {"from": "2031-03-17", "to": "2031-03-30"} and fresh["stale_window"] is False
    assert [a[1] for a in vendor.asked if a[0] == "dividends"] == ["2031-03-10", "2031-03-17"]


def test_one_read_failing_still_answers_with_the_other_and_names_the_failed_leg(vendor):
    vendor.fail = {"splits"}
    body = built()
    assert body["status"] == "ok" and body["legs"] == {"dividends": "ok", "splits": "failed"}
    assert body["splits"] == [] and len(body["dividends"]) == 3


def test_both_reads_failing_is_a_failed_answer_held_for_the_short_lifetime(vendor):
    vendor.fail = {"dividends", "splits"}
    body = built()
    assert body == {"status": "failed", "reason": "source", "http_status": None, "source": "Massive reference data"}
    for _ in range(3):
        assert dm.get_market_dividends(wait_s=0)["status"] == "failed"
    dm._held.drain(10)
    assert len(vendor.asked) == 2                         # not asked again inside the hold
    with dm._held._lock:
        retry_in = dm._held._state["retry_at"] - __import__("time").time()
    assert 280 < retry_in <= per_stock._CACHE_TTL_PARTIAL


def test_a_failed_look_keeps_the_last_good_list_and_says_so(vendor, monkeypatch):
    built()
    vendor.fail = {"dividends", "splits"}
    monkeypatch.setattr(dm, "today_et", lambda: date(2031, 3, 17))
    dm.get_market_dividends(wait_s=0)
    dm._held.drain(10)
    kept = dm.get_market_dividends(wait_s=0)
    assert kept["status"] == "ok" and kept["window"] == WINDOW and kept["stale_window"] is True
    assert kept["check"]["state"] == "failed" and kept["check"]["reason"] == "source"


def test_the_held_list_survives_a_restart_without_a_vendor_read(vendor):
    built()
    dm._held.reset()
    again = dm.get_market_dividends(wait_s=0)
    assert again["status"] == "ok" and len(vendor.asked) == 2


def test_the_build_raises_the_house_stop_with_the_per_stock_short_lifetime(vendor):
    vendor.fail = {"dividends", "splits"}
    with pytest.raises(held_build.Stop) as stop:
        dm.build()
    assert stop.value.state == "failed" and stop.value.hold == float(per_stock._CACHE_TTL_PARTIAL)


def test_the_universe_is_the_sites_own_ticker_list():
    from api.services import held_reads
    held_reads.site_universe.cache_clear()
    u = dm.universe()
    assert len(u) > 3000 and "NVDA" in u
