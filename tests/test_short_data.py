"""SHINT and SHRTS, the Terminal's short interest screens (`api/services/short_data.py` and the
two routes in `api/routers/short_data.py`).

What is held here:
  * the requests are the ones the vendor's documentation gives, and they go through the house
    adapter (one client, one budget, one error model); the key is never logged;
  * parsing is tolerant: a missing optional field is None, never 0, and a row without its ticker,
    its date or its headline number is dropped and counted;
  * a refusal (401 / 403 / 404, or no key) is `unavailable`, remembered per dataset, so the next
    stock a member opens does not ask the vendor again;
  * every build writes ONE `[short-data]` line with the status code and the rows parsed, and a
    distinct one for an empty answer and for a shape mismatch;
  * nothing is built on the request: one background build, a short wait, then `computing`; the
    last good answer is served, marked `refreshing`, while its replacement is built;
  * the market list keeps only the site's universe, sets each stock beside its previous report,
    ranks four ways (a percent change needs a previous report of `FLOOR_SHARES`), says when it
    was cut, is held on disk, and is rebuilt only when the vendor has a newer settlement date;
  * both routes are paid.

No test here reaches a vendor: the two readers are replaced, or the adapter's transport is.
"""
from __future__ import annotations

import logging
import threading
import time
from urllib.parse import parse_qs

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import short_data as route
from api.services import massive
from api.services import massive_adapter
from api.services import short_data as sd

KEY = "SEKRET" + "-KEY-" + "77aa"
D3, D2, D1 = "2026-10-30", "2026-10-15", "2026-09-30"       # newest first
UNI = frozenset({"AAA", "BBB", "CCC", "DDD", "EEE", "BRK-B"})



@pytest.fixture(autouse=True)
def _log_only_inside_the_blocks():
    """Records are captured only inside a `caplog.at_level` block, whatever ran before this file.
    A test that imports the whole app first configures logging at INFO, and a build's log line
    written BEFORE a block would then sit in `caplog.records` ahead of the line the test reads
    (found 2026-11-18: two tests passed alone and failed after the member API list test). The
    logger's own level is pinned here, so the order the files run in cannot matter."""
    lg = logging.getLogger("api.services.short_data")
    old = lg.level
    lg.setLevel(logging.WARNING)
    yield
    lg.setLevel(old)

def si(ticker, day, short, adv=1_000_000, dtc=2.5, **over):
    row = {"ticker": ticker, "settlement_date": day, "short_interest": short, "avg_daily_volume": adv, "days_to_cover": dtc}
    row.update(over)
    return {k: v for k, v in row.items() if v is not ...}


def sv(ticker, day, short=400_000, total=1_000_000, ratio=40.0, **over):
    row = {"ticker": ticker, "date": day, "short_volume": short, "total_volume": total, "short_volume_ratio": ratio,
           "exempt_volume": 1000, "non_exempt_volume": 399_000, "nyse_short_volume": 5}
    row.update(over)
    return {k: v for k, v in row.items() if v is not ...}


class Vendor:
    """Stands where the two readers stand. Applies the filters the service sends, so a request
    with the wrong filter gets the wrong rows, and records every call."""

    def __init__(self):
        self.rows = {sd.INTEREST: [], sd.VOLUME: []}
        self.calls: list[tuple[str, dict, str]] = []
        self.fail: dict[str, Exception] = {}
        self.gate: threading.Event | None = None
        self.threads: list[str] = []

    def _pick(self, dataset, params):
        rows = list(self.rows[dataset])
        day_key = "settlement_date" if dataset == sd.INTEREST else "date"
        if "ticker" in params:
            rows = [r for r in rows if r.get("ticker") == params["ticker"]]
        if day_key in params:
            rows = [r for r in rows if r.get(day_key) == params[day_key]]
        if f"{day_key}.lt" in params:
            rows = [r for r in rows if str(r.get(day_key) or "") < params[f"{day_key}.lt"]]
        col, _, way = str(params.get("sort") or "ticker.asc").partition(".")
        rows.sort(key=lambda r: str(r.get(col) or ""), reverse=(way == "desc"))
        return rows

    def _enter(self, dataset, params, activity):
        self.calls.append((dataset, dict(params), activity))
        self.threads.append(threading.current_thread().name)
        if self.gate is not None:
            self.gate.wait(10)
        if dataset in self.fail:
            raise self.fail[dataset]

    def page(self, dataset, params, activity):
        self._enter(dataset, params, activity)
        rows = self._pick(dataset, params)
        limit = int(params.get("limit") or 10)
        out = {"status": "OK", "request_id": "r1", "count": min(len(rows), limit), "results": rows[:limit]}
        if len(rows) > limit:
            out["next_url"] = "next"
        return out

    def all(self, dataset, params, activity, max_pages):
        self._enter(dataset, params, activity)
        return self._pick(dataset, params)

    def asked(self, dataset=None):
        return [c for c in self.calls if dataset is None or c[0] == dataset]


@pytest.fixture
def vendor(monkeypatch, tmp_path):
    v = Vendor()
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(sd, "_vendor_page", v.page)
    monkeypatch.setattr(sd, "_vendor_rows", v.all)
    monkeypatch.setattr(sd, "universe", lambda: UNI)
    monkeypatch.setattr(sd, "read_floats", lambda syms: ({"AAA": 10_000_000.0, "BBB": 2_000_000.0, "DDD": 1_000_000.0}, "ok"))
    monkeypatch.setattr(sd, "MIN_UNIVERSE_ROWS", 3)
    sd.reset_for_tests()
    yield v
    if v.gate is not None:
        v.gate.set()
    drain()
    sd.reset_for_tests()


def drain(timeout=10.0):
    """Wait for every background build this module started."""
    end = time.time() + timeout
    while time.time() < end:
        with sd._lock:
            busy = sd._market["inflight"] is not None or bool(sd._stock_inflight)
        if not busy:
            return
        time.sleep(0.01)
    raise AssertionError("a background build did not finish")


def market_rows():
    """Three reports. AAA up 50%, BBB down 40%, CCC new this report, DDD up from a tiny base, EEE flat
    with no days to cover, ZZZ outside the universe, BRK.B a class share."""
    return [
        si("AAA", D3, 3_000_000, dtc=6.0), si("AAA", D2, 2_000_000, dtc=4.0), si("AAA", D1, 1_000_000),
        si("BBB", D3, 600_000, dtc=1.2), si("BBB", D2, 1_000_000, dtc=2.0),
        si("CCC", D3, 900_000, dtc=9.0),
        si("DDD", D3, 2_000_000, dtc=3.0), si("DDD", D2, 100_000, dtc=0.2),
        si("EEE", D3, 700_000, dtc=...), si("EEE", D2, 700_000),
        si("ZZZ", D3, 50_000_000, dtc=99.0), si("ZZZ", D2, 1_000_000),
        si("BRK.B", D3, 1_500_000, dtc=0.5), si("BRK.B", D2, 1_000_000),
    ]


# ── parsing ──────────────────────────────────────────────────────────────────────────────────

def test_a_short_interest_row_keeps_what_was_sent_and_a_missing_optional_field_is_none_never_zero():
    rows, dropped = sd.parse_interest_rows([
        {"ticker": "a", "settlement_date": "2025-03-14", "short_interest": 3906231, "avg_daily_volume": 2340158, "days_to_cover": 1.67},
        {"ticker": "B", "settlement_date": "2025-03-14", "short_interest": 0},                    # a real zero stays zero
        {"ticker": "C", "settlement_date": "2025-03-14", "short_interest": 10, "avg_daily_volume": None, "days_to_cover": "n/a"},
        {"ticker": "D", "settlement_date": "2025-03-14"},                                         # no short interest
        {"ticker": "E", "settlement_date": "2025-02-30", "short_interest": 5},                    # not a date
        {"ticker": "", "settlement_date": "2025-03-14", "short_interest": 5},
        {"ticker": "F", "settlement_date": "2025-03-14", "short_interest": True},                 # a bool is not a count
        {"ticker": "G", "settlement_date": "2025-03-14", "short_interest": -4},
        {"ticker": "H", "settlement_date": "2025-03-14", "short_interest": float("nan")},
        "not a row", None,
    ])
    assert rows == [
        {"ticker": "A", "settlement_date": "2025-03-14", "short_interest": 3906231, "avg_daily_volume": 2340158, "days_to_cover": 1.67},
        {"ticker": "B", "settlement_date": "2025-03-14", "short_interest": 0, "avg_daily_volume": None, "days_to_cover": None},
        {"ticker": "C", "settlement_date": "2025-03-14", "short_interest": 10, "avg_daily_volume": None, "days_to_cover": None},
    ]
    assert dropped == 8
    assert sd.parse_interest_rows(None) == ([], 0) and sd.parse_interest_rows({"results": []}) == ([], 0)


def test_a_short_volume_row_keeps_the_vendors_ratio_and_never_invents_one():
    rows, dropped = sd.parse_volume_rows([
        sv("A", "2025-03-25", 181219, 574084, 31.57),
        sv("A", "2025-03-24", 100, total=..., ratio=...),          # only the short volume came
        sv("A", "2025-03-21", 100, 200, ratio=250.0),             # a ratio above 100 percent is not a ratio
        sv("A", "2025-03-20", short=...),
        {"date": "2025-03-19", "short_volume": 5},
    ])
    assert rows == [
        {"ticker": "A", "date": "2025-03-25", "short_volume": 181219, "total_volume": 574084, "short_volume_ratio": 31.57},
        {"ticker": "A", "date": "2025-03-24", "short_volume": 100, "total_volume": None, "short_volume_ratio": None},
        {"ticker": "A", "date": "2025-03-21", "short_volume": 100, "total_volume": 200, "short_volume_ratio": None},
    ]
    assert dropped == 2


def test_the_change_from_the_previous_report_is_worked_out_and_a_zero_base_has_no_percent():
    assert sd.change_of(3_000_000, 2_000_000) == (1_000_000, 50.0)
    assert sd.change_of(600_000, 1_000_000) == (-400_000, -40.0)
    assert sd.change_of(5, 0) == (5, None)
    assert sd.change_of(5, None) == (None, None) and sd.change_of(None, 5) == (None, None)
    rows, _ = sd.parse_interest_rows([si("A", D1, 1_000_000), si("A", D3, 3_000_000, dtc=6.0), si("A", D2, 2_000_000), si("A", D2, 9)])
    assert sd.history_of(rows) == [
        {"settlement_date": D3, "short_interest": 3_000_000, "avg_daily_volume": 1_000_000, "days_to_cover": 6.0,
         "change_shares": 1_000_000, "change_pct": 50.0},
        {"settlement_date": D2, "short_interest": 2_000_000, "avg_daily_volume": 1_000_000, "days_to_cover": 2.5,
         "change_shares": 1_000_000, "change_pct": 100.0},
        {"settlement_date": D1, "short_interest": 1_000_000, "avg_daily_volume": 1_000_000, "days_to_cover": 2.5,
         "change_shares": None, "change_pct": None},
    ]


def test_percent_of_float_is_withheld_when_the_two_figures_cannot_be_the_same_share_count():
    assert sd.pct_of_float(3_000_000, 10_000_000.0) == (30.0, False)
    assert sd.pct_of_float(3_000_000, None) == (None, False)
    assert sd.pct_of_float(3_000_000, 0) == (None, False)
    assert sd.pct_of_float(None, 10.0) == (None, False)
    assert sd.pct_of_float(2_000_000, 1_000_000.0) == (None, True)          # 200% of float: a mismatch
    assert sd.pct_of_float(1_500_000, 1_000_000.0) == (150.0, False)        # the line itself is kept


def test_a_typed_symbol_is_cleaned_and_anything_else_is_refused():
    assert sd.clean_symbol(" nvda ") == "NVDA" and sd.clean_symbol("$spy") == "SPY"
    assert sd.clean_symbol("brk.b") == "BRK-B" and sd.clean_symbol("BRK-B") == "BRK-B"
    for bad in ("", None, "I:SPX", "BTC-USD", "TOOLONG", "A B", "../x", "NVDA?apiKey=1", "123"):
        assert sd.clean_symbol(bad) is None, bad
    assert sd.vendor_symbol("BRK-B") == "BRK.B" and sd.house_symbol("brk.b") == "BRK-B"
    assert sd.norm_rank(None) == "dtc" and sd.norm_rank(" UP ") == "up" and sd.norm_rank("banana") is None


def test_the_publication_day_is_an_estimate_from_finras_schedule_and_skips_a_holiday():
    assert sd.publication_estimate("2025-01-15") == "2025-01-27"     # Martin Luther King Jr. Day is not a business day
    assert sd.publication_estimate("2025-03-14") == "2025-03-25"
    assert sd.publication_estimate(None) is None and sd.publication_estimate("soon") is None


# ── the documented requests, through the house adapter ───────────────────────────────────────

class Transport:
    """Stands where `_MassiveRestClient` stands (the adapter's own transport)."""

    def __init__(self, *script):
        self._api_key = KEY
        self.script = list(script)
        self.paths: list[str] = []

    def _typed_get(self, path, *, timeout=None):
        self.paths.append(path)
        nxt = self.script.pop(0)
        if isinstance(nxt, BaseException):
            raise nxt
        return nxt


def _query(path):
    route_, _, qs = path.partition("?")
    return route_, {k: v[0] for k, v in parse_qs(qs).items()}


@pytest.fixture
def clean(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    sd.reset_for_tests()
    massive_adapter.reset_stats()
    yield
    drain()
    sd.reset_for_tests()
    massive_adapter.reset_stats()


def test_one_stock_is_two_documented_requests_through_the_adapter_and_the_key_is_never_logged(monkeypatch, clean, caplog):
    t = Transport({"status": "OK", "results": [si("BRK.B", D3, 3_000_000), si("BRK.B", D2, 2_000_000)]},
                  {"status": "OK", "results": [sv("BRK.B", "2026-11-17")], "next_url": "https://api." + "massive" + ".com/stocks/v1/short-volume?cursor=x"})
    monkeypatch.setattr(massive, "_get_client", lambda: t)
    monkeypatch.setattr(sd, "read_floats", lambda syms: ({}, "missing"))
    with caplog.at_level(logging.INFO, logger="api.services.short_data"):
        out = sd.get_stock("brk.b", wait_s=10)
        drain()
    assert [_query(p) for p in t.paths] == [
        ("/stocks/v1/short-interest", {"ticker": "BRK.B", "sort": "settlement_date.desc", "limit": "500", "apiKey": KEY}),
        ("/stocks/v1/short-volume", {"ticker": "BRK.B", "sort": "date.desc", "limit": "60", "apiKey": KEY}),
    ]
    assert out["status"] == "ok" and out["sym"] == "BRK-B"
    assert out["interest"]["count"] == 2 and out["interest"]["reports"][0]["change_pct"] == 50.0
    assert out["volume"]["days"] == [{"date": "2026-11-17", "short_volume": 400_000, "total_volume": 1_000_000, "short_volume_ratio": 40.0}]
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("[short-data]")]
    assert len(lines) == 1
    assert "stock BRK-B: short-interest status=200 rows=2; short-volume status=200 rows=1;" in lines[0]
    assert KEY not in caplog.text and "apiKey" not in caplog.text and "massive.com" not in caplog.text
    # both reads are counted under their own data class on the adapter's own counters
    assert set(massive_adapter.stats()["by_data_class"]) == {"short_interest", "short_volume"}


def test_the_market_list_is_the_documented_requests_newest_date_first_then_each_whole_report(monkeypatch, clean):
    monkeypatch.setattr(sd, "universe", lambda: UNI)
    monkeypatch.setattr(sd, "read_floats", lambda syms: ({}, "missing"))
    monkeypatch.setattr(sd, "MIN_UNIVERSE_ROWS", 3)
    rows = market_rows()
    t = Transport({"results": [si("ZZZ", D3, 1)]}, {"results": [r for r in rows if r["settlement_date"] == D3]},
                  {"results": [si("ZZZ", D2, 1)]}, {"results": [r for r in rows if r["settlement_date"] == D2]})
    monkeypatch.setattr(massive, "_get_client", lambda: t)
    out = sd.get_market(wait_s=10)
    assert out["status"] == "ok" and out["settlement_date"] == D3 and out["previous_settlement_date"] == D2
    assert [_query(p) for p in t.paths] == [
        ("/stocks/v1/short-interest", {"sort": "settlement_date.desc", "limit": "1", "apiKey": KEY}),
        ("/stocks/v1/short-interest", {"settlement_date": D3, "sort": "ticker.asc", "limit": "50000", "apiKey": KEY}),
        ("/stocks/v1/short-interest", {"sort": "settlement_date.desc", "limit": "1", "settlement_date.lt": D3, "apiKey": KEY}),
        ("/stocks/v1/short-interest", {"settlement_date": D2, "sort": "ticker.asc", "limit": "50000", "apiKey": KEY}),
    ]


@pytest.mark.parametrize("exc, status", [
    (massive._ERR.auth_error("Massive rejected (403)", status=403), 403),
    (massive._ERR.auth_error("Massive rejected (401)", status=401), 401),
    (massive._ERR.not_found("Massive: not found (HTTP 404) for /stocks/v1/short-interest"), 404),
])
def test_a_refusal_from_the_transport_is_unavailable_with_its_status_and_is_not_asked_again(monkeypatch, clean, caplog, exc, status):
    t = Transport(exc, {"results": [sv("AAA", "2026-11-17")]}, {"results": [sv("BBB", "2026-11-17")]})
    monkeypatch.setattr(massive, "_get_client", lambda: t)
    with caplog.at_level(logging.INFO, logger="api.services.short_data"):
        first = sd.get_stock("AAA", wait_s=10)
        drain()
        second = sd.get_stock("BBB", wait_s=10)
        drain()
    assert first["status"] == "ok"                                    # the other dataset still answers
    assert first["interest"] == {"state": "unavailable", "http_status": status, "reason": "refused"}
    assert first["volume"]["state"] == "ok" and first["settlement_date"] is None
    # the second stock never asked for short interest: three requests in all, not four
    assert [_query(p)[0] for p in t.paths] == ["/stocks/v1/short-interest", "/stocks/v1/short-volume", "/stocks/v1/short-volume"]
    assert second["interest"] == {"state": "unavailable", "http_status": status, "reason": "refused"}
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("[short-data]")]
    assert len(lines) == 2
    assert f"short-interest status={status} unavailable (the vendor refused this key; not asked again for 6h)" in lines[0]
    assert f"short-interest status={status} unavailable (not asked: a refusal is remembered" in lines[1]
    assert all(r.levelno == logging.WARNING for r in caplog.records if r.getMessage().startswith("[short-data]"))
    assert KEY not in caplog.text


def test_no_key_on_the_server_is_unavailable_and_says_so(monkeypatch, clean, caplog):
    def no_client():
        raise RuntimeError("MASSIVE_API_KEY not set in environment")
    monkeypatch.setattr(massive, "_get_client", no_client)
    with caplog.at_level(logging.INFO, logger="api.services.short_data"):
        out = sd.get_stock("AAA", wait_s=10)
        drain()
        market = sd.get_market(wait_s=10)
        drain()
    assert out["status"] == "unavailable"
    assert out["interest"] == {"state": "unavailable", "http_status": None, "reason": "not_configured"}
    assert market == {"status": "unavailable", "reason": "not_configured", "http_status": None, "source": sd.SOURCE}
    assert "short-interest status=none unavailable (no vendor key on this server)" in caplog.text


# ── one stock ────────────────────────────────────────────────────────────────────────────────

def test_one_stock_carries_its_history_its_short_volume_and_its_percent_of_float(vendor):
    vendor.rows[sd.INTEREST] = market_rows()
    vendor.rows[sd.VOLUME] = [sv("AAA", f"2026-11-{d:02d}", ratio=30.0 + d) for d in range(2, 19)] + [sv("BBB", "2026-11-18")]
    out = sd.get_stock("aaa", wait_s=10)
    assert out["status"] == "ok" and out["sym"] == "AAA" and out["source"] == "FINRA, through Massive"
    assert out["settlement_date"] == D3 and out["published"] is None and out["publication_estimate"] == "2026-11-10"
    assert [r["settlement_date"] for r in out["interest"]["reports"]] == [D3, D2, D1]
    assert out["interest"]["reports"][0] == {"settlement_date": D3, "short_interest": 3_000_000, "avg_daily_volume": 1_000_000,
                                              "days_to_cover": 6.0, "change_shares": 1_000_000, "change_pct": 50.0}
    assert out["interest"]["first_date"] == D1 and out["interest"]["cut"] is False
    assert out["volume"]["count"] == 17 and out["volume"]["window_days"] == 60
    assert out["volume"]["days"][0] == {"date": "2026-11-18", "short_volume": 400_000, "total_volume": 1_000_000, "short_volume_ratio": 48.0}
    assert out["float"] == {"shares": 10_000_000, "pct_float": 30.0, "withheld": False, "state": "ok", "source": sd.FLOAT_SOURCE}
    assert "refreshing" not in out
    # the build ran on its own thread, never on the caller's
    assert set(vendor.threads) == {"short-data-stock"}
    assert [(c[0], c[1]) for c in vendor.calls] == [
        (sd.INTEREST, {"ticker": "AAA", "sort": "settlement_date.desc", "limit": 500}),
        (sd.VOLUME, {"ticker": "AAA", "sort": "date.desc", "limit": 60}),
    ]


def test_a_request_never_builds_it_says_computing_then_the_held_answer(vendor):
    vendor.rows[sd.INTEREST] = market_rows()
    vendor.gate = threading.Event()
    started = time.time()
    first = sd.get_stock("AAA", wait_s=0.05)
    assert first == {"status": "computing", "sym": "AAA"}
    assert time.time() - started < 2.0
    assert sd.get_stock("AAA", wait_s=0.05) == {"status": "computing", "sym": "AAA"}      # the same build, not a second one
    assert sd.held_stock("AAA") == (None, "not_held")
    vendor.gate.set()
    drain()
    held = sd.get_stock("AAA", wait_s=0)
    assert held["status"] == "ok"
    assert len(vendor.asked(sd.INTEREST)) == 1 and len(vendor.asked(sd.VOLUME)) == 1
    before = len(vendor.calls)
    assert sd.get_stock("AAA")["status"] == "ok" and sd.held_stock("AAA")[1] == "fresh"
    assert len(vendor.calls) == before                                                    # held: the vendor is not asked


def test_the_last_good_answer_is_served_marked_refreshing_while_one_rebuild_runs(vendor):
    vendor.rows[sd.INTEREST] = market_rows()
    good = sd.get_stock("AAA", wait_s=10)
    drain()
    with sd._lock:                                                                        # its freshness has run out
        sd._stock_done["AAA"] = (time.time() - 1, good)
    vendor.gate = threading.Event()
    again = sd.get_stock("AAA", wait_s=10)
    assert again["refreshing"] is True and again["interest"] == good["interest"]
    assert sd.held_stock("AAA")[1] == "last_good" and "refreshing" not in sd.held_stock("AAA")[0]
    vendor.gate.set()
    drain()
    assert "refreshing" not in sd.get_stock("AAA", wait_s=0)
    assert len(vendor.asked(sd.INTEREST)) == 2


def test_only_a_few_stocks_are_read_at_once_and_one_more_waits_its_turn(vendor, monkeypatch):
    monkeypatch.setattr(sd, "MAX_STOCK_BUILDS", 2)
    vendor.gate = threading.Event()
    assert sd.get_stock("AAA", wait_s=0)["status"] == "computing"
    assert sd.get_stock("BBB", wait_s=0)["status"] == "computing"
    assert sd.get_stock("CCC", wait_s=0) == {"status": "computing", "sym": "CCC", "busy": True}
    with sd._lock:
        assert set(sd._stock_inflight) == {"AAA", "BBB"}
    vendor.gate.set()
    drain()
    assert {c[1]["ticker"] for c in vendor.calls} == {"AAA", "BBB"}


def test_an_empty_answer_and_a_shape_mismatch_are_said_differently_and_neither_is_a_zero(vendor, caplog):
    vendor.rows[sd.INTEREST] = [{"symbol": "AAA", "settlementDate": D3, "shortInterest": 5}]      # another vendor's field names
    with caplog.at_level(logging.INFO, logger="api.services.short_data"):
        # the fake filters on `ticker`, so hand the mismatch back whatever is asked
        vendor._pick = lambda dataset, params: list(vendor.rows[dataset])
        out = sd.get_stock("AAA", wait_s=10)
        drain()
    assert out["status"] == "ok"                                     # the vendor answered: short volume has no rows
    assert out["interest"] == {"state": "failed", "http_status": 200, "reason": "shape"}
    assert out["volume"] == {"state": "none", "http_status": 200, "reason": None}
    line = next(r.getMessage() for r in caplog.records if r.getMessage().startswith("[short-data]"))
    assert "short-interest status=200 rows=0 shape mismatch (1 results, none usable for AAA)" in line
    assert "short-volume status=200 rows=0 no rows (the vendor answered with an empty list)" in line
    # a section that failed is tried again soon; it is never kept as the last good answer
    with sd._lock:
        assert sd._stock_done["AAA"][0] - time.time() <= sd.FAILED_S + 1 and "AAA" not in sd._stock_old


def test_a_failed_read_is_failed_with_its_status_and_only_the_error_class_is_logged(vendor, caplog):
    vendor.fail[sd.INTEREST] = massive._ERR.rate_limited("Massive rate-limited (/stocks/v1/short-interest) secret-text", status=429)
    vendor.fail[sd.VOLUME] = massive._ERR.transient("Massive server error (502) secret-text", status=502)
    with caplog.at_level(logging.INFO, logger="api.services.short_data"):
        out = sd.get_stock("AAA", wait_s=10)
        drain()
    assert out["status"] == "failed"
    assert out["interest"] == {"state": "failed", "http_status": 429, "reason": "rate_limited"}
    assert out["volume"] == {"state": "failed", "http_status": 502, "reason": "vendor"}
    assert "short-interest status=429 failed (MassiveRateLimited); short-volume status=502 failed (MassiveTransient)" in caplog.text
    assert "secret-text" not in caplog.text
    # a transient failure is NOT remembered as a refusal: the next build asks again
    with sd._lock:
        sd._stock_done.clear()
    vendor.fail.clear()
    vendor.rows[sd.INTEREST] = market_rows()
    assert sd.get_stock("AAA", wait_s=10)["interest"]["state"] == "ok"


def test_a_symbol_that_is_not_a_stock_is_refused_before_anything_is_started(vendor):
    assert sd.get_stock("I:SPX") == {"status": "bad_symbol", "sym": None}
    assert sd.held_stock("../etc") == ({"status": "bad_symbol", "sym": None}, "refused")
    assert vendor.calls == [] and not sd._stock_inflight


# ── the market list ──────────────────────────────────────────────────────────────────────────

def test_the_market_list_keeps_only_the_universe_with_each_previous_report_beside_it(vendor):
    vendor.rows[sd.INTEREST] = market_rows()
    out = sd.get_market(wait_s=10)
    assert out["status"] == "ok" and out["rank"] == "dtc" and out["source"] == "FINRA, through Massive"
    assert (out["settlement_date"], out["previous_settlement_date"]) == (D3, D2)
    assert out["published"] is None and out["publication_estimate"] == "2026-11-10" and out["read_at"]
    assert out["count"] == 6 and out["universe"] == 6 and out["newer_report_landing"] is None and out["check"] is None
    assert out["float"] == {"state": "ok", "with_float": 2, "withheld": 1, "source": sd.FLOAT_SOURCE}
    # days to cover, highest first; EEE has none and is never ranked as 0; ZZZ is not in the universe
    assert [r["sym"] for r in out["rows"]] == ["CCC", "AAA", "DDD", "BBB", "BRK-B"]
    assert out["ranked"] == 5 and out["cut"] is False and out["floor_shares"] is None
    by = {r["sym"]: r for r in out["rows"]}
    assert by["AAA"] == {"sym": "AAA", "short_interest": 3_000_000, "avg_daily_volume": 1_000_000, "days_to_cover": 6.0,
                         "prev_short_interest": 2_000_000, "change_shares": 1_000_000, "change_pct": 50.0,
                         "float_shares": 10_000_000, "pct_float": 30.0}
    assert by["CCC"]["prev_short_interest"] is None and by["CCC"]["change_pct"] is None and by["CCC"]["pct_float"] is None
    assert by["DDD"]["pct_float"] is None and by["DDD"]["float_shares"] == 1_000_000      # 200% of float: withheld
    assert by["BRK-B"]["change_pct"] == 50.0                                              # the class share, in the house form
    assert set(vendor.threads) == {"short-data-market"}


def test_each_rank_and_the_floor_under_a_percent_change(vendor):
    vendor.rows[sd.INTEREST] = market_rows()
    sd.get_market(wait_s=10)
    up = sd.get_market("up")
    # DDD rose 1,900% from 100,000 shares: under the floor, so it does not top the list
    assert [(r["sym"], r["change_pct"]) for r in up["rows"]] == [("AAA", 50.0), ("BRK-B", 50.0)]
    assert up["ranked"] == 2 and up["floor_shares"] == 500_000
    down = sd.get_market("DOWN")
    assert [(r["sym"], r["change_pct"]) for r in down["rows"]] == [("BBB", -40.0)]
    flt = sd.get_market("float")
    assert [(r["sym"], r["pct_float"]) for r in flt["rows"]] == [("AAA", 30.0), ("BBB", 30.0)] and flt["ranked"] == 2
    one = sd.get_market("dtc", 2)
    assert [r["sym"] for r in one["rows"]] == ["CCC", "AAA"] and one["cut"] is True and one["ranked"] == 5 and one["limit"] == 2
    assert sd.get_market("banana") == {"status": "bad_rank", "ranks": ["dtc", "up", "down", "float"]}
    assert sd.get_market("dtc", 9999)["limit"] == 250 and sd.get_market("dtc", None)["limit"] == 100
    assert len(vendor.calls) == 4                                    # one build served every rank


def test_a_request_never_builds_the_list_it_says_computing_then_the_held_list(vendor):
    vendor.rows[sd.INTEREST] = market_rows()
    vendor.gate = threading.Event()
    assert sd.get_market(wait_s=0.05) == {"status": "computing"}
    assert sd.get_market("up", wait_s=0.05) == {"status": "computing"}
    assert sd.held_market() == (None, "not_held")
    vendor.gate.set()
    drain()
    assert sd.get_market(wait_s=0)["status"] == "ok" and sd.held_market("up")[1] == "held"
    assert len(vendor.calls) == 4                                    # two requests while building: still one build


def test_the_list_is_kept_on_disk_so_a_restart_does_not_start_cold(vendor):
    vendor.rows[sd.INTEREST] = market_rows()
    first = sd.get_market(wait_s=10)
    drain()
    calls = len(vendor.calls)
    sd.reset_for_tests()                                             # a restart: nothing in memory
    vendor.gate = threading.Event()                                  # and a vendor that would not answer in time
    again = sd.get_market(wait_s=0)
    assert again["status"] == "ok" and again["rows"] == first["rows"] and again["read_at"] == first["read_at"]
    assert len(vendor.calls) == calls                                # read from disk: fresh enough, the vendor is not asked
    assert sd.held_market("float")[0]["rank"] == "float"


def test_a_later_request_only_checks_the_newest_date_and_rebuilds_when_it_is_newer(vendor, caplog):
    vendor.rows[sd.INTEREST] = [r for r in market_rows() if r["settlement_date"] != D3]
    first = sd.get_market(wait_s=10)
    drain()
    assert first["settlement_date"] == D2 and len(vendor.calls) == 4
    # six hours on, nothing new at the vendor: ONE one-row request, and the held list answers at once
    with sd._lock:
        sd._market["checked"] = time.time() - sd.CHECK_EVERY_S - 1
    with caplog.at_level(logging.INFO, logger="api.services.short_data"):
        same = sd.get_market(wait_s=0)
        drain()
    assert same["settlement_date"] == D2 and same["read_at"] == first["read_at"]
    assert [c[1] for c in vendor.calls[4:]] == [{"sort": "settlement_date.desc", "limit": 1}]
    assert f"market list: short-interest status=200 newest settlement {D2} is the one held; nothing rebuilt" in caplog.text
    assert sd.get_market(wait_s=0)["settlement_date"] == D2 and len(vendor.calls) == 5      # and not checked again yet
    # a newer report lands: the next check rebuilds, and the request that started it still got the held list
    vendor.rows[sd.INTEREST] = market_rows()
    with sd._lock:
        sd._market["checked"] = 0.0
    assert sd.get_market(wait_s=0)["settlement_date"] == D2
    drain()
    new = sd.get_market(wait_s=0)
    assert new["settlement_date"] == D3 and new["previous_settlement_date"] == D2 and new["count"] == 6


def test_a_newest_report_that_is_still_landing_is_not_shown_as_the_market(vendor, caplog):
    rows = market_rows()
    vendor.rows[sd.INTEREST] = [r for r in rows if not (r["settlement_date"] == D3 and r["ticker"] not in ("AAA", "BBB"))]
    with caplog.at_level(logging.INFO, logger="api.services.short_data"):
        out = sd.get_market(wait_s=10)
        drain()
    assert out["status"] == "ok" and out["settlement_date"] == D2 and out["previous_settlement_date"] == D1
    assert out["newer_report_landing"] == D3
    assert f"settlement={D2} previous={D1}" in caplog.text and f"landing={D3}" in caplog.text
    # while it is landing every check rebuilds (the date alone cannot say it has finished)
    vendor.rows[sd.INTEREST] = rows
    with sd._lock:
        sd._market["checked"] = 0.0
    sd.get_market(wait_s=0)
    drain()
    assert sd.get_market(wait_s=0)["settlement_date"] == D3 and sd.get_market()["newer_report_landing"] is None


def test_a_report_too_thin_to_be_a_market_and_a_shape_mismatch_are_unavailable_never_an_empty_list(vendor, caplog, monkeypatch):
    vendor.rows[sd.INTEREST] = [si("AAA", D3, 5), si("ZZZ", D3, 5), si("QQQQ", D3, 7)]
    with caplog.at_level(logging.INFO, logger="api.services.short_data"):
        thin = sd.get_market(wait_s=10)
        drain()
    assert thin == {"status": "unavailable", "reason": "thin", "http_status": 200, "source": sd.SOURCE}
    assert f"short-interest status=200 rows=3 thin report (only 1 of 6 universe stocks for {D3}; nothing held)" in caplog.text
    calls = len(vendor.calls)
    assert sd.get_market(wait_s=10) == thin and len(vendor.calls) == calls          # held a while: not rebuilt per request
    sd.reset_for_tests()
    caplog.clear()
    vendor.rows[sd.INTEREST] = [{"symbol": "AAA", "date": D3}]
    vendor._pick = lambda dataset, params: list(vendor.rows[dataset])
    with caplog.at_level(logging.INFO, logger="api.services.short_data"):
        shape = sd.get_market(wait_s=10)
        drain()
    assert shape == {"status": "unavailable", "reason": "shape", "http_status": 200, "source": sd.SOURCE}
    assert "market list: short-interest status=200 rows=0 shape mismatch" in caplog.text
    sd.reset_for_tests()
    caplog.clear()
    vendor.rows[sd.INTEREST] = []
    with caplog.at_level(logging.INFO, logger="api.services.short_data"):
        assert sd.get_market(wait_s=10)["reason"] == "shape"
        drain()
    assert "market list: short-interest status=200 rows=0 no rows (the vendor answered with an empty list)" in caplog.text


def test_a_refused_market_read_is_unavailable_remembered_and_one_line(vendor, caplog):
    vendor.fail[sd.INTEREST] = massive._ERR.auth_error("Massive rejected (403)", status=403)
    with caplog.at_level(logging.INFO, logger="api.services.short_data"):
        out = sd.get_market(wait_s=10)
        drain()
        again = sd.get_market("up", wait_s=10)
        drain()
    assert out == {"status": "unavailable", "reason": "refused", "http_status": 403, "source": sd.SOURCE} == again
    assert len(vendor.calls) == 1                                    # asked once; the second request asked nothing
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("[short-data]")]
    assert len(lines) == 1
    assert "market list: short-interest status=403 unavailable (the vendor refused this key; not asked again for 6h)" in lines[0]
    # and one stock's short interest is not asked for either: the refusal is the dataset's
    stock = sd.get_stock("AAA", wait_s=10)
    assert stock["interest"]["state"] == "unavailable" and len(vendor.asked(sd.INTEREST)) == 1


def test_the_read_only_accessor_says_what_the_last_build_said_and_starts_nothing(vendor):
    """`held_market` with no list held: the standing answer of the last build (what `get_market` gives without
    starting another), then nothing once that answer has lapsed. It never asks the vendor and never starts a job."""
    assert sd.held_market() == (None, "not_held") and vendor.calls == []
    vendor.fail[sd.INTEREST] = massive._ERR.auth_error("Massive rejected (403)", status=403)
    refused = sd.get_market(wait_s=10)
    drain()
    calls = len(vendor.calls)
    assert refused["reason"] == "refused" and sd.held_market("up") == (refused, "not_held") == (sd.get_market("up"), "not_held")
    assert sd.held_market("banana") == ({"status": "bad_rank", "ranks": ["dtc", "up", "down", "float"]}, "refused")
    with sd._lock:
        assert sd._market["inflight"] is None
        sd._market["block"] = (time.time() - 1, refused)             # the answer has lapsed
    assert sd.held_market() == (None, "not_held")
    assert len(vendor.calls) == calls == 1                           # only the one build above asked the vendor


def test_a_refusal_after_a_list_is_held_keeps_the_list_and_says_the_check_was_refused(vendor):
    vendor.rows[sd.INTEREST] = market_rows()
    held = sd.get_market(wait_s=10)
    drain()
    vendor.fail[sd.INTEREST] = massive._ERR.auth_error("Massive rejected (403)", status=403)
    with sd._lock:
        sd._market["checked"] = 0.0
    sd.get_market(wait_s=0)
    drain()
    out = sd.get_market(wait_s=0)
    assert out["status"] == "ok" and out["rows"] == held["rows"] and out["settlement_date"] == D3
    assert out["check"]["state"] == "unavailable" and out["check"]["http_status"] == 403 and out["check"]["at"]
    calls = len(vendor.calls)
    sd.get_market(wait_s=0)
    drain()
    assert len(vendor.calls) == calls                                # not looked at again on every request


def test_the_universe_file_missing_is_a_failure_that_asks_the_vendor_nothing(vendor, monkeypatch, caplog):
    monkeypatch.setattr(sd, "universe", lambda: frozenset())
    with caplog.at_level(logging.INFO, logger="api.services.short_data"):
        out = sd.get_market(wait_s=10)
        drain()
    assert out["status"] == "failed" and out["reason"] == "universe" and vendor.calls == []
    assert "the site's stock universe could not be read; the vendor was not asked" in caplog.text


def test_the_real_float_reader_reads_the_screener_export_and_leaves_a_missing_float_out(monkeypatch):
    from api.services.screener import finviz_universe

    def fields(targets, failures=None):
        if failures is not None:
            failures.setdefault("finviz_universe", {})["stale:6d"] = 1
        return {"AAA": {"float_shares": 5_000_000.0}, "BBB": {"float_shares": 0}, "CCC": {}, "DDD": {"float_shares": None}}
    monkeypatch.setattr(finviz_universe, "read_finviz_fields", fields)
    assert sd.read_floats(["AAA", "BBB", "CCC", "DDD"]) == ({"AAA": 5_000_000.0}, "stale")

    def missing(targets, failures=None):
        failures.setdefault("finviz_universe", {})["missing"] = 1
        return {}
    monkeypatch.setattr(finviz_universe, "read_finviz_fields", missing)
    assert sd.read_floats(["AAA"]) == ({}, "missing")

    def boom(targets, failures=None):
        raise OSError("gone")
    monkeypatch.setattr(finviz_universe, "read_finviz_fields", boom)
    assert sd.read_floats(["AAA"]) == ({}, "missing")


def test_the_real_universe_is_the_sites_own_list():
    from api.services import cap_universe
    assert sd.universe() is cap_universe.symbols() and len(sd.universe()) > 1000


# ── the routes ───────────────────────────────────────────────────────────────────────────────

FREE_USER = {"id": "sd-free", "email": "free@example.test", "role": "member", "plan": "free"}
PAID_USER = {"id": "sd-paid", "email": "paid@example.test", "role": "member", "plan": "pro"}
LIST_URL = "/api/research/short-interest-list"
STOCK_URL = "/api/research/short-data/NVDA"


def _client(user):
    app = FastAPI()
    app.include_router(route.router)
    if user is not None:
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app, raise_server_exceptions=False)


def test_both_routes_are_paid_and_pass_their_arguments_through(monkeypatch):
    asked = []
    monkeypatch.setattr(sd, "get_market", lambda rank=None, limit=None: asked.append(("market", rank, limit)) or {"status": "ok", "rank": rank})
    monkeypatch.setattr(sd, "get_stock", lambda ticker: asked.append(("stock", ticker)) or {"status": "ok", "sym": ticker})
    paths = {r.path: r for r in route.router.routes}
    assert set(paths) == {LIST_URL, "/api/research/short-data/{ticker}"}
    for r in paths.values():
        assert r.methods == {"GET"}
        assert route.require_paid in {d.call for d in r.dependant.dependencies}
    for url in (LIST_URL, STOCK_URL):
        assert _client(None).get(url).status_code == 401
        assert _client(FREE_USER).get(url).status_code == 402
    assert asked == []                                               # a refused caller never reaches the service
    paid = _client(PAID_USER)
    assert paid.get(LIST_URL).json() == {"status": "ok", "rank": None}
    assert paid.get(LIST_URL, params={"rank": "up", "limit": 25}).json() == {"status": "ok", "rank": "up"}
    assert paid.get(STOCK_URL).json() == {"status": "ok", "sym": "NVDA"}
    assert paid.get(LIST_URL, params={"limit": 0}).status_code == 422
    assert paid.get(LIST_URL, params={"limit": 251}).status_code == 422
    assert asked == [("market", None, None), ("market", "up", 25), ("stock", "NVDA")]


def test_an_unavailable_plan_is_a_200_answer_not_an_error_status(monkeypatch):
    monkeypatch.setattr(sd, "get_market", lambda rank=None, limit=None: {"status": "unavailable", "reason": "refused", "http_status": 403})
    resp = _client(PAID_USER).get(LIST_URL)
    assert resp.status_code == 200 and resp.json()["status"] == "unavailable"


def test_the_service_reaches_the_vendor_only_through_the_house_adapter():
    """No client of its own: the module names no HTTP library and no vendor host, and both readers
    call `massive_adapter` (the census rails count everything else)."""
    import ast
    import inspect
    tree = ast.parse(inspect.getsource(sd))
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    assert not imported & {"httpx", "requests", "urllib", "aiohttp", "yfinance"}
    code = "\n".join(ast.unparse(n) for n in tree.body if not (isinstance(n, ast.Expr) and isinstance(getattr(n, "value", None), ast.Constant)))
    assert "massive.com" not in code and "polygon.io" not in code and "apiKey" not in code and "API_KEY" not in code
    assert "massive_adapter.get(" in inspect.getsource(sd._vendor_page)
    assert "massive_adapter.get_pages(" in inspect.getsource(sd._vendor_rows)
