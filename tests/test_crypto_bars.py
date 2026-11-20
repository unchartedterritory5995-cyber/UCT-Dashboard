"""Bitcoin (BTC/USD) bars and quote from FMP, dark behind CRYPTO_BARS_ENABLED.

Every price in this file is INVENTED (a straight line of round numbers): no vendor answer is
copied here, and no test may reach a vendor (see `no_live_vendor`).

What is pinned:
  * the switch: off / admin / on, and that anything else is off;
  * the pair table: `BTCUSD` and nothing shaped like it (`BTC` stays the fund);
  * FMP only: a Yahoo read anywhere on this path fails the test at teardown;
  * seven daily bars a week, keyed as the chart's daily path is keyed, and the week and
    month built from them;
  * "still forming" is the bar's own UTC day, not the NYSE session;
  * the request budget and the cache: no vendor call on a request, one build at a time, a
    small tail read when stale, the stored copy kept when a read fails;
  * garbage in the query string and in the vendor's rows;
  * that a stock and an index are handed to exactly the serve they had, switch on or off.
"""
import ast
import datetime as dt
import json
import os
import re
import time
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from api import bars_auth, crypto_bars
from api.routers import bars as barsmod
from api.routers import crypto as crypto_router
from api.services import fmp_client as fc
from api.services import yf_util
from api.services.cache import cache as _cache

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAIR = "BTCUSD"
EPOCH = dt.date(2026, 1, 1)
START = "2026-01-01"                    # the test history start (the real one is 2010)
UTC = dt.timezone.utc

MEMBER = {"id": "paid-1", "email": "p@x.test", "role": "member", "plan": "pro"}
ADMIN = {"id": "adm-1", "email": "a@x.test", "role": "admin", "plan": "free"}
FREE = {"id": "free-1", "email": "f@x.test", "role": "member", "plan": "free"}
SERVICE = {"via": "push_secret"}

EOD_PATH = "/stable/historical-price-eod/full"
QUOTE_PATH = "/stable/quote"


def at(y, m, d, hh=0, mm=0, ss=0) -> float:
    return dt.datetime(y, m, d, hh, mm, ss, tzinfo=UTC).timestamp()


SAT_NOON = at(2026, 11, 14, 12)         # 2026-11-14 is a Saturday


def row(d: dt.date) -> dict:
    """One invented daily row, in the shape of an end-of-day vendor row."""
    i = (d - EPOCH).days
    o = 1000.0 + i
    return {"date": d.isoformat(), "open": o, "high": o + 30, "low": o - 20, "close": o + 10,
            "volume": float(5 + i % 7)}


def rows(first: dt.date, last: dt.date, skip=()) -> list:
    out, d = [], last
    while d >= first:                   # newest first, as the vendor answers
        if d not in skip:
            out.append(row(d))
        d -= dt.timedelta(days=1)
    return out


UNSET = object()


class Clock:
    def __init__(self, now):
        self.now = now

    def __call__(self):
        return self.now


class Inline:
    """A pool that runs the job on submit (the build finishes before the request returns)."""
    def submit(self, fn):
        fn()


class Deferred:
    """A pool that holds the job until the test runs it."""
    def __init__(self):
        self.jobs = []

    def submit(self, fn):
        self.jobs.append(fn)

    def run(self):
        jobs, self.jobs = self.jobs, []
        for j in jobs:
            j()


class FakeFmp:
    """Stands in for the two typed crypto reads. Rows come from `rows()` unless overridden."""
    def __init__(self, clock):
        self.clock = clock
        self.eod_calls = []
        self.quote_calls = []
        self.eod_error = None
        self.eod_value = UNSET          # a fixed answer for every page, when set
        self.skip = ()
        self.last_day = None            # the newest day the vendor has (default: today UTC)
        self.quote_value = [{"symbol": PAIR, "price": 1234.5, "change": 12.5,
                             "changePercentage": 1.02, "open": 1220.0, "dayHigh": 1240.0,
                             "dayLow": 1210.0, "previousClose": 1222.0, "yearHigh": 2000.0,
                             "yearLow": 500.0, "volume": 77.0, "timestamp": 1794657600}]
        self.quote_error = None

    def eod(self, symbol, from_date, to_date, *, timeout=None):
        self.eod_calls.append((symbol, from_date, to_date, timeout))
        if self.eod_error:
            raise self.eod_error
        if self.eod_value is not UNSET:
            return SimpleNamespace(value=self.eod_value)
        today = dt.datetime.fromtimestamp(self.clock(), UTC).date()
        last = min(dt.date.fromisoformat(to_date), self.last_day or today)
        return SimpleNamespace(value=rows(dt.date.fromisoformat(from_date), last, self.skip))

    def quote(self, symbol, *, timeout=None):
        self.quote_calls.append((symbol, timeout))
        if self.quote_error:
            raise self.quote_error
        ts = (self.quote_value or [{}])[0].get("timestamp") if isinstance(self.quote_value, list) else None
        return SimpleNamespace(value=self.quote_value,
                               provenance=SimpleNamespace(source_observed_at=ts))


@pytest.fixture(autouse=True)
def no_live_vendor(monkeypatch):
    """No test here may reach a vendor, and NO test here may read Yahoo at all: the unit's rule
    is FMP only. Both tripwires are recorded and asserted at teardown, because the code under
    test swallows fetch errors (a refused call would read as "no data" and stay green)."""
    from tests.market_intel_breadth_fixtures import install_loopback_only_guard
    refused_hosts = install_loopback_only_guard(monkeypatch)
    yf_reads = []

    def _tripwire(fn, default, *a, **k):
        yf_reads.append(getattr(fn, "__qualname__", repr(fn)))
        return default

    monkeypatch.setattr(yf_util, "bounded_call", _tripwire)
    yield
    assert yf_reads == [], f"the crypto path read Yahoo: {yf_reads}"
    assert refused_hosts == [], f"a test opened a network connection: {refused_hosts}"


@pytest.fixture(autouse=True)
def fresh(monkeypatch, tmp_path):
    crypto_bars._reset_for_tests()
    monkeypatch.delenv("CRYPTO_BARS_ENABLED", raising=False)
    monkeypatch.setattr(crypto_bars, "_DISK_DIR", str(tmp_path / "crypto_bars_cache"))
    monkeypatch.setitem(crypto_bars.PAIRS[PAIR], "history_start", START)
    yield
    crypto_bars._reset_for_tests()


@pytest.fixture
def clock(monkeypatch):
    c = Clock(SAT_NOON)
    monkeypatch.setattr(crypto_bars, "_now", c)
    return c


@pytest.fixture
def fmp(monkeypatch, clock):
    f = FakeFmp(clock)
    monkeypatch.setattr(fc, "get_crypto_history_eod_full", f.eod)
    monkeypatch.setattr(fc, "get_crypto_quote", f.quote)
    return f


@pytest.fixture
def inline(monkeypatch):
    monkeypatch.setattr(crypto_bars, "_pool", Inline())
    monkeypatch.setattr(crypto_bars, "_spawn", lambda job: job())


@pytest.fixture
def deferred(monkeypatch):
    d = Deferred()
    monkeypatch.setattr(crypto_bars, "_pool", d)
    monkeypatch.setattr(crypto_bars, "_spawn", d.submit)
    return d


def warm(fmp_fake=None):
    """Build the series (the `inline` fixture must be active) and return the daily answer."""
    assert crypto_bars._refresh(PAIR) is True
    status, body = crypto_bars.serve_bars(PAIR, "D", 5000)
    assert status == 200
    return body


# ── 1. the switch ───────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,want", [
    (None, "off"), ("", "off"), ("0", "off"), ("true", "off"), ("TRUE", "off"), ("yes", "off"),
    ("on", "off"), ("2", "off"), ("11", "off"), ("admins", "off"), ("1,admin", "off"),
    ("1", "on"), (" 1 ", "on"), ("admin", "admin"), (" ADMIN ", "admin"), ("Admin", "admin"),
])
def test_the_switch_reads_three_values_and_everything_else_is_off(monkeypatch, raw, want):
    if raw is None:
        monkeypatch.delenv("CRYPTO_BARS_ENABLED", raising=False)
    else:
        monkeypatch.setenv("CRYPTO_BARS_ENABLED", raw)
    assert crypto_bars.mode() == want
    assert crypto_bars.enabled() is (want != "off")


@pytest.mark.parametrize("raw,member,admin,service", [
    (None, False, False, False),
    ("0", False, False, False),
    ("bogus", False, False, False),
    ("admin", False, True, False),      # a service caller carries no role: not an admin
    ("1", True, True, True),
])
def test_who_the_switch_admits(monkeypatch, raw, member, admin, service):
    if raw is None:
        monkeypatch.delenv("CRYPTO_BARS_ENABLED", raising=False)
    else:
        monkeypatch.setenv("CRYPTO_BARS_ENABLED", raw)
    assert crypto_bars.allowed(MEMBER) is member
    assert crypto_bars.allowed(ADMIN) is admin
    assert crypto_bars.allowed(SERVICE) is service
    for nobody in (None, "", 0, [], "admin", True):
        assert crypto_bars.allowed(nobody) is False
    assert crypto_router.serves(PAIR, MEMBER) is member
    assert crypto_router.serves(PAIR, ADMIN) is admin


def test_the_switch_is_read_per_call(monkeypatch):
    assert crypto_bars.allowed(MEMBER) is False
    monkeypatch.setenv("CRYPTO_BARS_ENABLED", "1")
    assert crypto_bars.allowed(MEMBER) is True
    monkeypatch.setenv("CRYPTO_BARS_ENABLED", "0")
    assert crypto_bars.allowed(MEMBER) is False


# ── 2. the pair table ───────────────────────────────────────────────────────────────────

def test_the_pair_table_is_btcusd_and_nothing_shaped_like_it(monkeypatch):
    assert set(crypto_bars.PAIRS) == {"BTCUSD"}
    for yes in ("BTCUSD", "btcusd", " BtcUsd "):
        assert crypto_bars.is_pair(yes) is True
    for no in ("BTC", "BTC-USD", "BTC/USD", "BTCUSDT", "X:BTCUSD", "^BTCUSD", "BTCUS", "USD",
               "ETHUSD", "AAPL", "^GSPC", "", None, 0, ["BTCUSD"], b"BTCUSD"):
        assert crypto_bars.is_pair(no) is False, no
    monkeypatch.setenv("CRYPTO_BARS_ENABLED", "1")
    for no in ("BTC", "AAPL", "^GSPC", "UCTA50", "ETHUSD", "BTCUSDT"):
        assert crypto_router.serves(no, ADMIN) is False, no


def test_one_more_pair_is_one_line(monkeypatch, clock, fmp, inline):
    monkeypatch.setitem(crypto_bars.PAIRS, "ETHUSD", {
        "fmp": "ETHUSD", "name": "Ether", "base": "ETH", "quote": "USD", "history_start": START})
    assert crypto_bars.is_pair("ethusd")
    assert crypto_bars._refresh("ETHUSD") is True
    assert {c[0] for c in fmp.eod_calls} == {"ETHUSD"}
    status, body = crypto_bars.serve_bars("ETHUSD", "D", 3)
    assert status == 200 and body["ticker"] == "ETHUSD" and len(body["bars"]) == 3
    assert [p["symbol"] for p in crypto_bars.pairs_public()] == ["BTCUSD", "ETHUSD"]


def test_the_public_table_names_the_pair_and_not_the_vendor_symbol():
    assert crypto_bars.pairs_public() == [
        {"symbol": "BTCUSD", "name": "Bitcoin", "base": "BTC", "quote": "USD"}]


# ── 3. FMP only ─────────────────────────────────────────────────────────────────────────

def _imports(path):
    tree = ast.parse(open(path, encoding="utf-8").read())
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            names.add(mod)
            names.update(f"{mod}.{a.name}" for a in node.names)
    return names


@pytest.mark.parametrize("rel", ["api/crypto_bars.py", "api/routers/crypto.py"])
def test_the_crypto_modules_import_no_yahoo_reader_and_no_licensing_table(rel):
    names = _imports(os.path.join(REPO, *rel.split("/")))
    banned = ("yfinance", "yf_util", "index_bars", "provider_licensing_class", "bars_fetch",
              "massive", "finnhub", "requests", "httpx", "urllib")
    hits = sorted(n for n in names if any(b in n for b in banned))
    assert hits == [], f"{rel} imports {hits}: the pair path is FMP only, through fmp_client"


def test_a_whole_cold_build_serve_and_quote_reads_fmp_and_nothing_else(clock, fmp, inline):
    status, body = crypto_bars.serve_bars(PAIR, "D", 10)
    assert status == 200 and len(body["bars"]) == 10 and body["source"] == "FMP"
    q = crypto_bars.quote(PAIR)
    assert q["price"] == 1234.5 and q["source"] == "FMP"
    assert fmp.eod_calls and fmp.quote_calls
    # (the autouse fixture fails this test at teardown if Yahoo or a socket was touched)


def test_the_exact_vendor_reads_at_the_transport(monkeypatch):
    """The endpoints and the symbol the integrator checks against production: the daily
    history and the quote, both asked for `BTCUSD` as it is (no caret, no dash)."""
    monkeypatch.setenv("FMP_API_KEY", "test-key")
    fc._bucket_tokens = fc._FMP_RATE_LIMIT_PER_MIN
    fc._bucket_updated = time.monotonic()
    for p in (EOD_PATH, QUOTE_PATH):
        _cache.invalidate(f"fmp_forbidden_{p}")
        _cache.invalidate(f"fmp_forbidden_{p}::crypto")
    seen = []

    def fake_get(url, params=None, timeout=None, **k):
        seen.append((url, dict(params or {}), timeout))
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = [{"symbol": "BTCUSD", "price": 1.0, "timestamp": 1794657600}]
        return resp

    with patch.object(fc._session, "get", side_effect=fake_get):
        fc.get_crypto_history_eod_full("btcusd", "2026-01-01", "2026-01-31", timeout=10)
        res = fc.get_crypto_quote("BTCUSD", timeout=5)
    (u1, p1, t1), (u2, p2, t2) = seen
    assert u1.endswith(EOD_PATH) and u2.endswith(QUOTE_PATH)
    assert {k: v for k, v in p1.items() if k != "apikey"} == {
        "symbol": "BTCUSD", "from": "2026-01-01", "to": "2026-01-31"}
    assert {k: v for k, v in p2.items() if k != "apikey"} == {"symbol": "BTCUSD"}
    assert (t1, t2) == (10, 5)
    assert res.provenance.vendor == "fmp"
    assert res.provenance.source_activity == "fmp_client.get_crypto_quote"
    assert res.provenance.source_observed_at == 1794657600
    assert res.freshness is None            # no delay class is claimed for the crypto quote


def test_the_real_history_is_paged_from_2010_without_a_hole_or_an_overlap(monkeypatch, clock, fmp, inline):
    monkeypatch.setitem(crypto_bars.PAIRS[PAIR], "history_start", "2010-07-01")
    fmp.eod_value = []                      # every page empty: only the paging is read here
    assert crypto_bars._build(PAIR, None, clock()) is None
    calls = fmp.eod_calls
    assert all(c[0] == "BTCUSD" and c[3] == crypto_bars.FMP_TIMEOUT_S for c in calls)
    assert calls[0][1] == "2010-07-01" and calls[-1][2] == "2026-11-14"
    for a, b in zip(calls, calls[1:]):
        gap = dt.date.fromisoformat(b[1]) - dt.date.fromisoformat(a[2])
        assert gap == dt.timedelta(days=1), (a, b)
    for c in calls:
        span = dt.date.fromisoformat(c[2]) - dt.date.fromisoformat(c[1])
        assert span.days < crypto_bars.PAGE_DAYS
    assert len(calls) == 6                  # 16.4 years in 3-year pages


# ── 4. seven bars a week, keyed as the chart's daily path is keyed ──────────────────────

def test_daily_bars_cover_saturday_and_sunday(clock, fmp, inline):
    body = warm()
    keys = [b["t"] for b in body["bars"]]
    assert keys[-7:] == ["2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12",
                         "2026-11-13", "2026-11-14"]
    assert all(isinstance(k, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", k) for k in keys)
    assert keys == sorted(set(keys))
    assert len(keys) == (dt.date(2026, 11, 14) - EPOCH).days + 1      # every calendar day
    weekdays = {dt.date.fromisoformat(k).weekday() for k in keys[-14:]}
    assert weekdays == set(range(7))
    last = body["bars"][-1]
    want = row(dt.date(2026, 11, 14))
    assert (last["o"], last["h"], last["l"], last["c"], last["v"]) == (
        want["open"], want["high"], want["low"], want["close"], want["volume"])
    assert set(last) == {"t", "o", "h", "l", "c", "v"}


def test_a_week_is_monday_to_sunday_and_carries_the_stock_weekly_key(clock, fmp, inline):
    clock.now = at(2026, 11, 15, 23)        # Sunday night: the week of 9-15 Nov is whole
    warm()
    status, body = crypto_bars.serve_bars(PAIR, "W", 3)
    assert status == 200
    wk = body["bars"][-1]
    days = [row(dt.date(2026, 11, d)) for d in range(9, 16)]
    assert wk["t"] == "2026-11-13"          # the week's Friday, the key a stock's week carries
    assert wk["o"] == days[0]["open"] and wk["c"] == days[-1]["close"]
    assert wk["h"] == max(d["high"] for d in days) and wk["l"] == min(d["low"] for d in days)
    assert wk["v"] == sum(d["volume"] for d in days)
    assert [b["t"] for b in body["bars"]] == ["2026-10-30", "2026-11-06", "2026-11-13"]


def test_a_month_is_keyed_on_its_first_day(clock, fmp, inline):
    warm()
    status, body = crypto_bars.serve_bars(PAIR, "M", 3)
    assert [b["t"] for b in body["bars"]] == ["2026-09-01", "2026-10-01", "2026-11-01"]
    octo = body["bars"][-2]
    days = [row(dt.date(2026, 10, d)) for d in range(1, 32)]
    assert octo["o"] == days[0]["open"] and octo["c"] == days[-1]["close"]
    assert octo["v"] == sum(d["volume"] for d in days)


def test_no_intraday_is_served_and_none_is_asked_for(clock, fmp, deferred):
    for tf in ("1", "5", "15", "30", "60", "240", "d", "w", "", "D ", "2D", "1D"):
        status, body = crypto_bars.serve_bars(PAIR, tf, 100)
        assert status == 200, tf
        assert body["no_data"] is True and body["reason"] == "timeframe_not_carried", tf
        assert body["bars"] == [] and body["source"] == "FMP"
    assert fmp.eod_calls == [] and deferred.jobs == []      # nothing kicked, nothing read
    for tf in (None, 5, ["D"]):         # not a string (an in-process default object): daily
        status, body = crypto_bars.serve_bars(PAIR, tf, 100)
        assert (status, body["tf"]) == (503, "D"), tf


# ── 5. "still forming" is the bar's own UTC day ─────────────────────────────────────────

def test_a_saturday_bar_is_forming_on_saturday(clock, fmp, inline):
    body = warm()
    assert body["newest_bar_is_forming"] is True
    dev = body["developing"]
    assert dev["t"] == "2026-11-14" and dev["c"] == row(dt.date(2026, 11, 14))["close"]
    assert dev["rev"] == int(SAT_NOON * 1000)


def test_a_bar_is_forming_before_the_new_york_open_too(clock, fmp, inline):
    clock.now = at(2026, 11, 16, 8)         # Monday 03:00 in New York: no stock session yet
    body = warm()
    assert body["bars"][-1]["t"] == "2026-11-16"
    assert body["newest_bar_is_forming"] is True


def test_a_settled_newest_bar_is_not_called_forming(clock, fmp, inline):
    fmp.last_day = dt.date(2026, 11, 13)    # the vendor has nothing for today yet
    body = warm()
    assert body["bars"][-1]["t"] == "2026-11-13"
    assert body["newest_bar_is_forming"] is False and body["developing"] is None


def test_week_and_month_form_until_their_own_end(clock, fmp, inline):
    warm()
    _, wk = crypto_bars.serve_bars(PAIR, "W", 2)
    _, mo = crypto_bars.serve_bars(PAIR, "M", 2)
    assert wk["newest_bar_is_forming"] is True and wk["developing"]["t"] == "2026-11-13"
    assert mo["newest_bar_is_forming"] is True and mo["developing"]["t"] == "2026-11-01"
    assert crypto_bars.bucket_bounds("W", at(2026, 11, 14)) == (at(2026, 11, 9), at(2026, 11, 16))
    assert crypto_bars.bucket_bounds("M", at(2026, 12, 31)) == (at(2026, 12, 1), at(2027, 1, 1))
    assert crypto_bars.bucket_bounds("D", at(2026, 11, 14)) == (at(2026, 11, 14), at(2026, 11, 15))
    for bad in (("5", 1), ("D", None), ("D", True), ("D", "x")):
        assert crypto_bars.bucket_bounds(*bad) is None


def test_a_bar_stored_mid_day_is_withheld_once_its_day_has_ended(clock, fmp, deferred):
    crypto_bars._refresh(PAIR)              # stored Saturday noon, Saturday's bar still forming
    clock.now = at(2026, 11, 15, 0, 0, 1)   # one second into Sunday; no refresh has landed
    status, body = crypto_bars.serve_bars(PAIR, "D", 5)
    assert status == 200
    assert body["bars"][-1]["t"] == "2026-11-13"        # Saturday's mid-day print is not shown
    assert body["newest_bar_is_forming"] is False
    assert len(deferred.jobs) == 1                      # ...and the read that settles it is kicked
    deferred.run()
    _, body = crypto_bars.serve_bars(PAIR, "D", 5)
    assert [b["t"] for b in body["bars"]][-2:] == ["2026-11-14", "2026-11-15"]


# ── 6. holes and garbage in the vendor's rows ───────────────────────────────────────────

def test_rows_across_a_hole_are_dropped_never_bridged(clock, fmp, inline):
    fmp.skip = {dt.date(2026, 10, d) for d in range(1, 7)}      # six missing days
    body = warm()
    assert body["bars"][0]["t"] == "2026-10-07"
    fmp.skip = {dt.date(2026, 10, 1), dt.date(2026, 10, 2)}     # two missing days: not a hole
    crypto_bars._reset_for_tests()
    os.remove(crypto_bars._disk_path(PAIR))                     # a fresh box: nothing stored
    body = warm()
    assert body["bars"][0]["t"] == START


def test_a_series_that_stopped_is_not_served(clock, fmp, inline):
    fmp.last_day = dt.date(2026, 11, 10)    # four days behind: not today's Bitcoin chart
    assert crypto_bars._refresh(PAIR) is False
    status, body = crypto_bars.serve_bars(PAIR, "D", 10)
    assert (status, body["no_data"], body["reason"]) == (200, True, "no_provider_data")
    assert body["refresh_state"] == "failed" and body["refreshed_at"] is None
    fmp.last_day = dt.date(2026, 11, 11)    # three days behind is the limit
    clock.now += crypto_bars.RETRY_S + 1
    assert crypto_bars._refresh(PAIR) is True


def test_a_row_that_does_not_parse_is_dropped_never_repaired():
    good = row(dt.date(2026, 3, 2))
    bad = [
        {**good, "date": "2026-03-03", "open": "x"},
        {**good, "date": "2026-03-04", "high": good["low"] - 1},
        {**good, "date": "2026-03-05", "close": 0},
        {**good, "date": "2026-03-06", "low": -5},
        {**good, "date": "2026-03-07", "close": float("nan")},
        {**good, "date": "2026-03-08", "open": float("inf")},
        {**good, "date": "2026-03-09", "volume": -1},
        {**good, "date": "2026-03-10", "volume": "many"},
        {**good, "date": "not-a-date"},
        {**good, "date": "2025-12-31"},     # before the span asked
        {**good, "date": "2026-04-01"},     # after it
        {k: v for k, v in good.items() if k != "close"},
        {k: v for k, v in good.items() if k != "date"},
        None, 7, "row", [],
    ]
    out = crypto_bars._parse_rows([good, *bad], dt.date(2026, 1, 1), dt.date(2026, 3, 31))
    assert list(out) == [dt.date(2026, 3, 2)]
    assert out[dt.date(2026, 3, 2)] == {"t": int(at(2026, 3, 2)), "o": good["open"], "h": good["high"],
                                        "l": good["low"], "c": good["close"], "v": good["volume"]}
    no_vol = {k: v for k, v in good.items() if k != "volume"}
    assert crypto_bars._parse_rows([no_vol], dt.date(2026, 1, 1), dt.date(2026, 3, 31))[
        dt.date(2026, 3, 2)]["v"] == 0.0
    for junk in (None, {}, "x", 5, {"Error Message": "no"}):
        assert crypto_bars._parse_rows(junk, dt.date(2026, 1, 1), dt.date(2026, 3, 31)) == {}


@pytest.mark.parametrize("answer", [None, {"Error Message": "x"}, "nope", 5])
def test_an_answer_that_is_not_a_list_is_a_failed_read(clock, fmp, inline, answer):
    fmp.eod_value = answer
    assert crypto_bars._refresh(PAIR) is False
    assert crypto_bars.serve_bars(PAIR, "D", 5)[1]["reason"] == "no_provider_data"


# ── 7. the budget and the cache ─────────────────────────────────────────────────────────

def test_a_cold_request_never_builds_on_the_request(clock, fmp, deferred):
    status, body = crypto_bars.serve_bars(PAIR, "D", 10)
    assert status == 503 and body == {"ticker": PAIR, "tf": "D", "bars": [], "error": "warming"}
    assert fmp.eod_calls == []              # the request returned before any vendor read
    for _ in range(5):                      # five more charts ask while the build runs
        assert crypto_bars.serve_bars(PAIR, "W", 10)[0] == 503
    assert len(deferred.jobs) == 1          # one build, not six
    deferred.run()
    status, body = crypto_bars.serve_bars(PAIR, "D", 10)
    assert status == 200 and len(body["bars"]) == 10
    assert body["refresh_state"] == "fresh" and body["refreshed_at"] == SAT_NOON


def test_a_held_series_is_served_without_a_vendor_call_inside_its_ttl(clock, fmp, inline):
    warm()
    n = len(fmp.eod_calls)
    clock.now += crypto_bars.TTL_S - 1
    for tf in ("D", "W", "M", "D"):
        assert crypto_bars.serve_bars(PAIR, tf, 100)[0] == 200
    assert len(fmp.eod_calls) == n


def test_a_stale_series_is_served_as_it_is_and_refreshed_by_one_small_read(clock, fmp, deferred):
    crypto_bars._refresh(PAIR)
    whole = len(fmp.eod_calls)
    clock.now += crypto_bars.TTL_S + 1
    status, body = crypto_bars.serve_bars(PAIR, "D", 5)
    assert status == 200 and body["refresh_state"] == "stale" and body["refreshed_at"] == SAT_NOON
    assert len(fmp.eod_calls) == whole      # served before the read
    crypto_bars.serve_bars(PAIR, "D", 5)
    assert len(deferred.jobs) == 1          # one refresh for two requests
    deferred.run()
    tail = fmp.eod_calls[whole:]
    assert tail == [("BTCUSD", "2026-11-07", "2026-11-14", crypto_bars.FMP_TIMEOUT_S)]
    _, body = crypto_bars.serve_bars(PAIR, "D", 5)
    assert body["refresh_state"] == "fresh" and body["refreshed_at"] == clock.now


def test_the_tail_read_replaces_the_forming_bar_and_keeps_the_history(clock, fmp, inline):
    warm()
    first_len = len(crypto_bars._entry(PAIR)["series"])
    clock.now += crypto_bars.TTL_S + 1
    moved = dict(row(dt.date(2026, 11, 14)), close=1500.0, high=1600.0)
    fmp.eod_value = [moved]
    _, body = crypto_bars.serve_bars(PAIR, "D", 2)       # kicks the inline refresh
    _, body = crypto_bars.serve_bars(PAIR, "D", 2)
    assert body["bars"][-1]["c"] == 1500.0 and body["bars"][-1]["h"] == 1600.0
    assert len(crypto_bars._entry(PAIR)["series"]) == first_len


def test_the_whole_history_is_read_again_once_a_week(clock, fmp, inline):
    warm()
    fmp.eod_calls.clear()
    clock.now += crypto_bars.TTL_S + 1
    crypto_bars._refresh(PAIR)
    assert fmp.eod_calls[0][1] != START                  # a tail read
    fmp.eod_calls.clear()
    clock.now = SAT_NOON + crypto_bars.FULL_REFRESH_S + 1
    crypto_bars._refresh(PAIR)
    assert fmp.eod_calls[0][1] == START                  # the whole history


def test_a_failed_refresh_keeps_the_stored_copy_and_says_so(clock, fmp, inline):
    warm()
    clock.now += crypto_bars.TTL_S + 1
    fmp.eod_error = fc.FMPTransient("timed out", vendor="fmp")
    status, body = crypto_bars.serve_bars(PAIR, "D", 3)  # kicks the refresh, which fails
    status, body = crypto_bars.serve_bars(PAIR, "D", 3)
    assert status == 200 and len(body["bars"]) == 3
    assert body["refresh_state"] == "failed" and body["refreshed_at"] == SAT_NOON
    n = len(fmp.eod_calls)
    clock.now += crypto_bars.RETRY_S - 5
    crypto_bars.serve_bars(PAIR, "D", 3)
    assert len(fmp.eod_calls) == n                       # no retry inside the window
    clock.now += 10
    fmp.eod_error = None
    crypto_bars.serve_bars(PAIR, "D", 3)
    assert len(fmp.eod_calls) == n + 1
    assert crypto_bars.serve_bars(PAIR, "D", 3)[1]["refresh_state"] == "fresh"


def test_with_nothing_stored_a_failing_vendor_is_an_honest_empty_answer(clock, fmp, deferred):
    fmp.eod_error = RuntimeError("down")
    assert crypto_bars.serve_bars(PAIR, "D", 5)[0] == 503
    deferred.run()
    status, body = crypto_bars.serve_bars(PAIR, "D", 5)
    assert status == 200 and body["bars"] == []
    assert body["no_data"] is True and body["reason"] == "no_provider_data"
    assert body["source"] == "FMP" and body["refresh_state"] == "failed"
    assert deferred.jobs == []                           # no new build inside the retry window
    clock.now += crypto_bars.RETRY_S + 1
    assert crypto_bars.serve_bars(PAIR, "D", 5)[0] == 503
    assert len(deferred.jobs) == 1


def test_a_vendor_not_found_is_an_empty_page_not_a_crash(clock, fmp, inline):
    fmp.eod_error = fc.FMPNotFound("no rows", vendor="fmp")
    assert crypto_bars._refresh(PAIR) is False
    assert crypto_bars.serve_bars(PAIR, "D", 5)[1]["reason"] == "no_provider_data"


def test_the_series_survives_a_restart_on_disk(clock, fmp, inline):
    first = warm()
    with crypto_bars._lock:
        crypto_bars._held.clear()                        # a new process: memory is empty
    fmp.eod_calls.clear()
    status, body = crypto_bars.serve_bars(PAIR, "D", 5000)
    assert status == 200 and body["bars"] == first["bars"]
    assert fmp.eod_calls == []
    path = crypto_bars._disk_path(PAIR)
    stored = json.load(open(path, encoding="utf-8"))
    assert set(stored) == {"saved_at", "full_at", "series"}
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("{not json")
    with crypto_bars._lock:
        crypto_bars._held.clear()
    assert crypto_bars._entry(PAIR) is None              # an unreadable copy is no copy


def _reset_fmp(monkeypatch):
    monkeypatch.setenv("FMP_API_KEY", "test-key")
    fc._bucket_tokens = fc._FMP_RATE_LIMIT_PER_MIN
    fc._bucket_updated = time.monotonic()
    for p in (EOD_PATH, QUOTE_PATH):
        _cache.invalidate(f"fmp_forbidden_{p}")
        _cache.invalidate(f"fmp_forbidden_{p}::crypto")


def _resp(status, value=None):
    r = MagicMock()
    r.status_code = status
    r.json.return_value = value if value is not None else []
    r.raise_for_status.return_value = None
    return r


def test_a_crypto_read_spends_the_shared_fmp_budget(monkeypatch):
    _reset_fmp(monkeypatch)
    with patch.object(fc._session, "get", return_value=_resp(200, [{"price": 1.0}])) as get:
        before = fc._bucket_tokens
        fc.get_crypto_quote("BTCUSD")
        assert before - fc._bucket_tokens == pytest.approx(1, abs=0.2)
        fc._bucket_tokens = 0
        fc._bucket_updated = time.monotonic()
        with pytest.raises(fc.FMPRateLimited):
            fc.get_crypto_history_eod_full("BTCUSD", "2026-01-01", "2026-01-02")
        assert get.call_count == 1          # the second read never left the box


def test_an_empty_budget_is_a_failed_refresh_not_a_request(monkeypatch, clock, inline):
    _reset_fmp(monkeypatch)
    fc._bucket_tokens = 0
    fc._bucket_updated = time.monotonic()
    with patch.object(fc._session, "get", return_value=_resp(200, [])) as get:
        assert crypto_bars._refresh(PAIR) is False
        assert get.call_count == 0
    fc._bucket_tokens = fc._FMP_RATE_LIMIT_PER_MIN


def test_a_refused_crypto_read_does_not_switch_off_stocks_or_indices(monkeypatch):
    """`_get_raw` remembers a 401/403 per PATH for a day, and the crypto reads share their
    paths with stock quotes and index bars. A plan that does not carry crypto must not blank
    those: a crypto refusal is remembered under its own key."""
    _reset_fmp(monkeypatch)
    with patch.object(fc._session, "get", return_value=_resp(403)):
        with pytest.raises(fc.FMPAuthError):
            fc.get_crypto_quote("BTCUSD")
        with pytest.raises(fc.FMPAuthError):
            fc.get_crypto_history_eod_full("BTCUSD", "2026-01-01", "2026-01-02")
    for p in (QUOTE_PATH, EOD_PATH):
        assert _cache.get(f"fmp_forbidden_{p}") is None
        assert _cache.get(f"fmp_forbidden_{p}::crypto") is not None
    with patch.object(fc._session, "get", return_value=_resp(200, [{"symbol": "AAPL", "price": 9.0}])) as get:
        assert fc.get_quote("AAPL").value == [{"symbol": "AAPL", "price": 9.0}]
        assert fc.get_index_history_eod_full("^GSPC", "2026-01-01", "2026-01-02").degraded is None
        assert get.call_count == 2
        # ...and the refused crypto read is not asked again for the day
        assert fc.get_crypto_quote("BTCUSD").degraded == "cached_forbidden"
        assert get.call_count == 2


def test_a_refusal_of_the_whole_path_still_stops_the_crypto_read(monkeypatch, clock, inline):
    _reset_fmp(monkeypatch)
    with patch.object(fc._session, "get", return_value=_resp(403)):
        with pytest.raises(fc.FMPAuthError):
            fc.get_quote("AAPL")
    assert _cache.get(f"fmp_forbidden_{QUOTE_PATH}") is not None
    assert _cache.get(f"fmp_forbidden_{QUOTE_PATH}::crypto") is None
    with patch.object(fc._session, "get", return_value=_resp(200, [{"price": 1.0}])) as get:
        res = fc.get_crypto_quote("BTCUSD")
        assert res.value is None and res.degraded == "cached_forbidden"
        assert get.call_count == 0
        assert crypto_bars._read_quote(PAIR, clock()) is None       # no price: a failed read
    _cache.invalidate(f"fmp_forbidden_{QUOTE_PATH}")


def test_a_refused_history_read_is_a_failed_refresh(monkeypatch, clock, inline):
    _reset_fmp(monkeypatch)
    _cache.set(f"fmp_forbidden_{EOD_PATH}::crypto", time.time(), ttl=60)
    with patch.object(fc._session, "get", return_value=_resp(200, [])) as get:
        assert crypto_bars._refresh(PAIR) is False                  # no list: not a series
        assert get.call_count == 0
    _cache.invalidate(f"fmp_forbidden_{EOD_PATH}::crypto")


def test_every_other_fmp_read_calls_the_transport_exactly_as_before(monkeypatch):
    """The scope argument is passed ONLY by the crypto reads: a three-argument `_get_raw`
    (what every existing test substitutes) still serves stocks and indices."""
    monkeypatch.setenv("FMP_API_KEY", "test-key")
    seen = []

    def old_shape(path, params, timeout=None):
        seen.append((path, dict(params), timeout))
        return [{"symbol": "X", "price": 1.0, "date": "2026-01-02"}]

    monkeypatch.setattr(fc, "_get_raw", old_shape)
    fc.get_quote("AAPL")
    fc.get_index_history_eod_full("^GSPC", "2026-01-01", "2026-01-02")
    assert [s[0] for s in seen] == [QUOTE_PATH, EOD_PATH]

    scoped = []
    monkeypatch.setattr(fc, "_get_raw", lambda path, params, timeout=None, forbidden_scope=None:
                        scoped.append(forbidden_scope) or [{"price": 1.0}])
    fc.get_crypto_quote("BTCUSD")
    fc.get_crypto_history_eod_full("BTCUSD", "2026-01-01", "2026-01-02")
    assert scoped == ["crypto", "crypto"]


# ── 8. garbage in the query string ──────────────────────────────────────────────────────

def test_garbage_in_the_query_string_never_raises(clock, fmp, inline):
    warm()
    full = crypto_bars.serve_bars(PAIR, "D", 5000)[1]["bars"]
    for bars in ("abc", None, 0, -5, 1.9, "", [], 10 ** 9):
        status, body = crypto_bars.serve_bars(PAIR, "D", bars)
        assert status == 200 and 1 <= len(body["bars"]) <= len(full), bars
    assert len(crypto_bars.serve_bars(PAIR, "D", "abc")[1]["bars"]) == 200
    assert len(crypto_bars.serve_bars(PAIR, "D", 0)[1]["bars"]) == 1
    for since in ("abc", "-1", "0", "", None, True, "2026-13-45", "1e9", [], {}, "9" * 40):
        status, body = crypto_bars.serve_bars(PAIR, "D", 5000, since=since)
        assert status == 200 and body["bars"] == full and "delta" not in body, since
    for to in ("abc", "", None, 5, "2026-02-31", []):
        status, body = crypto_bars.serve_bars(PAIR, "D", 5000, to=to)
        assert status == 200 and body["bars"] == full, to


def test_since_and_to_cut_the_series(clock, fmp, inline):
    warm()
    _, body = crypto_bars.serve_bars(PAIR, "D", 5000, since="2026-11-12")
    assert [b["t"] for b in body["bars"]] == ["2026-11-13", "2026-11-14"] and body["delta"] is True
    for unix in (int(at(2026, 11, 12, 9)), int(at(2026, 11, 12, 9)) * 1000, str(int(at(2026, 11, 12)))):
        _, b2 = crypto_bars.serve_bars(PAIR, "D", 5000, since=unix)
        assert [b["t"] for b in b2["bars"]] == ["2026-11-13", "2026-11-14"], unix
    _, none = crypto_bars.serve_bars(PAIR, "D", 5000, since="2026-11-14")
    assert none["bars"] == [] and none["delta"] is True
    assert none["newest_bar_is_forming"] is True         # an empty delta still tells the truth
    _, wk = crypto_bars.serve_bars(PAIR, "W", 5000, since="2026-11-06")
    assert [b["t"] for b in wk["bars"]] == ["2026-11-13"]
    _, cut = crypto_bars.serve_bars(PAIR, "D", 3, to="2026-03-10")
    assert [b["t"] for b in cut["bars"]] == ["2026-03-08", "2026-03-09", "2026-03-10"]


def test_the_answer_carries_the_contract_identity_and_no_proof_it_does_not_have(clock, fmp, inline):
    body = warm()
    assert body["ticker"] == PAIR and body["tf"] == "D" and body["source"] == "FMP"
    assert body["contract"] == 1 and body["cache_key"] == "b1:BTCUSD:D:plain"
    for unproven in ("verified_through", "sealed_through", "complete_through", "series_rev",
                     "history_rev", "adj_basis", "session"):
        assert body[unproven] is None, unproven
    assert "tail_status" not in body and "no_data" not in body


# ── 9. the quote ────────────────────────────────────────────────────────────────────────

def test_the_quote_names_its_source_and_the_vendors_own_time(clock, fmp, inline):
    q = crypto_bars.quote("btcusd")
    assert q == {"symbol": "BTCUSD", "name": "Bitcoin", "base": "BTC", "quote": "USD",
                 "price": 1234.5, "change": 12.5, "change_pct": 1.02, "open": 1220.0,
                 "day_high": 1240.0, "day_low": 1210.0, "prev_close": 1222.0,
                 "year_high": 2000.0, "year_low": 500.0, "volume": 77.0,
                 "as_of": 1794657600.0, "fetched_at": SAT_NOON, "source": "FMP",
                 "state": "fresh"}
    assert fmp.quote_calls == [("BTCUSD", crypto_bars.QUOTE_TIMEOUT_S)]


def test_a_held_quote_is_not_read_again_inside_its_ttl(clock, fmp, inline):
    crypto_bars.quote(PAIR)
    clock.now += crypto_bars.QUOTE_TTL_S - 1
    for _ in range(20):
        assert crypto_bars.quote(PAIR)["state"] == "fresh"
    assert len(fmp.quote_calls) == 1


def test_a_quote_past_its_hold_is_read_again_and_the_new_price_is_what_is_answered(clock, fmp, inline):
    crypto_bars._quotes[PAIR] = {"symbol": PAIR, "price": 900.0, "as_of": 1.0,
                                 "fetched_at": SAT_NOON - 100, "source": "FMP"}
    q = crypto_bars.quote(PAIR)                          # the read lands inside the wait
    assert q["price"] == 1234.5 and q["state"] == "fresh" and q["fetched_at"] == SAT_NOON
    assert len(fmp.quote_calls) == 1


def test_a_stale_quote_waits_a_bounded_moment_only(monkeypatch, clock, fmp, deferred):
    assert 0 < crypto_bars.QUOTE_STALE_WAIT_S <= crypto_bars.QUOTE_FIRST_WAIT_S <= 2.0
    waits = []
    real = crypto_bars.threading.Event

    class Spy(real):
        def wait(self, timeout=None):
            waits.append(timeout)
            return super().wait(0.01)
    monkeypatch.setattr(crypto_bars.threading, "Event", Spy)
    crypto_bars._quotes[PAIR] = {"symbol": PAIR, "price": 900.0, "as_of": 1.0,
                                 "fetched_at": SAT_NOON - 100, "source": "FMP"}
    assert crypto_bars.quote(PAIR)["state"] == "stale"
    assert waits == [crypto_bars.QUOTE_STALE_WAIT_S]
    deferred.jobs.clear()
    crypto_bars._reset_for_tests()
    assert crypto_bars.quote(PAIR)["state"] == "warming"   # the first read has its own bound
    assert waits == [crypto_bars.QUOTE_STALE_WAIT_S, crypto_bars.QUOTE_FIRST_WAIT_S]


def test_a_stale_quote_is_served_as_it_is_and_read_once_in_the_background(monkeypatch, clock, fmp, deferred):
    monkeypatch.setattr(crypto_bars, "QUOTE_STALE_WAIT_S", 0.01)
    crypto_bars._quotes[PAIR] = {"symbol": PAIR, "price": 900.0, "as_of": 1.0,
                                 "fetched_at": SAT_NOON - 100, "source": "FMP"}
    for _ in range(4):
        q = crypto_bars.quote(PAIR)
        assert q["price"] == 900.0 and q["state"] == "stale"
    assert fmp.quote_calls == [] and len(deferred.jobs) == 1
    deferred.run()
    q = crypto_bars.quote(PAIR)
    assert q["price"] == 1234.5 and q["state"] == "fresh"


def test_a_failed_quote_read_keeps_the_last_price_and_says_failed(clock, fmp, inline):
    crypto_bars.quote(PAIR)
    clock.now += crypto_bars.QUOTE_TTL_S + 1
    fmp.quote_error = RuntimeError("down")
    crypto_bars.quote(PAIR)
    q = crypto_bars.quote(PAIR)
    assert q["price"] == 1234.5 and q["state"] == "failed" and q["fetched_at"] == SAT_NOON
    n = len(fmp.quote_calls)
    clock.now += crypto_bars.RETRY_S - 5
    crypto_bars.quote(PAIR)
    assert len(fmp.quote_calls) == n                     # no retry inside the window


@pytest.mark.parametrize("value", [
    [], None, {}, "x", [None], [{}], [{"price": 0}], [{"price": -3}], [{"price": "12"}],
    [{"price": float("nan")}], [{"price": True}],
])
def test_a_quote_without_a_usable_price_is_no_quote(clock, fmp, inline, value):
    fmp.quote_value = value
    q = crypto_bars.quote(PAIR)
    assert q["price"] is None and q["state"] == "failed" and q["as_of"] is None
    assert q["source"] == "FMP" and q["name"] == "Bitcoin"


def test_the_first_quote_does_not_wait_long_for_a_slow_vendor(monkeypatch, clock, fmp, deferred):
    monkeypatch.setattr(crypto_bars, "QUOTE_FIRST_WAIT_S", 0.01)
    q = crypto_bars.quote(PAIR)                          # the read is still running
    assert q["price"] is None and q["state"] == "warming"
    assert fmp.quote_calls == []
    deferred.run()
    assert crypto_bars.quote(PAIR)["state"] == "fresh"


def test_missing_quote_fields_are_absent_never_zero(clock, fmp, inline):
    fmp.quote_value = [{"price": 10.0}]
    q = crypto_bars.quote(PAIR)
    assert q["price"] == 10.0 and q["as_of"] is None
    for k in ("change", "change_pct", "open", "day_high", "day_low", "prev_close", "volume"):
        assert q[k] is None, k


# ── 10. the routes ──────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def app():
    from api.main import app as real_app       # not entered: no lifespan, no scheduler
    return real_app


@pytest.fixture
def as_caller(monkeypatch):
    def _set(user):
        monkeypatch.setattr(bars_auth, "validate_session",
                            lambda _tok, _u=user: (dict(_u) if _u else None))
        monkeypatch.setattr(bars_auth, "get_user_plan",
                            lambda _uid, _u=user: (_u or {}).get("plan", "free"))
    return _set


def _get(app, path, cookie=True):
    return TestClient(app).get(path, cookies={"uct_session": "t"} if cookie else {})


@pytest.fixture
def stock_path(monkeypatch):
    """Spies on the two serves a stock or an index reaches today."""
    seen = {"bars": [], "history": []}

    def bars_serve(ticker, tf, bars, since, to, warm, *session):
        seen["bars"].append((ticker, tf, bars, since, to, warm, session))
        return JSONResponse(content={"served_by": "stock-path", "ticker": ticker, "tf": tf})

    def history_serve(ticker, tf, bars, v, d, if_none_match=""):
        seen["history"].append((ticker, tf, bars, v, d))
        return JSONResponse(content={"served_by": "stock-history", "ticker": ticker})

    monkeypatch.setattr(barsmod, "serve_bars_http", bars_serve)
    monkeypatch.setattr(barsmod, "serve_bars_history", history_serve)
    monkeypatch.delenv("BARS_ORIGIN_URL", raising=False)
    monkeypatch.delenv("BARS_HISTORY_ORIGIN_URL", raising=False)
    return seen


CRYPTO_ROUTES = ["/api/crypto/pairs", "/api/crypto/quote/BTCUSD"]


@pytest.mark.parametrize("raw", [None, "0", "true", "bogus"])
@pytest.mark.parametrize("path", CRYPTO_ROUTES)
def test_off_the_new_routes_do_not_exist_for_anyone(app, as_caller, monkeypatch, fmp, deferred, raw, path):
    if raw is not None:
        monkeypatch.setenv("CRYPTO_BARS_ENABLED", raw)
    for who, cookie in ((ADMIN, True), (MEMBER, True), (FREE, True), (None, False)):
        as_caller(who)
        assert _get(app, path, cookie=cookie).status_code == 404, (who, path)
    assert fmp.eod_calls == [] and fmp.quote_calls == [] and deferred.jobs == []


def test_off_bitcoin_is_answered_by_the_stock_path_exactly_as_any_unknown_symbol(
        app, as_caller, stock_path, fmp, deferred):
    as_caller(ADMIN)
    r = _get(app, "/api/bars/BTCUSD?tf=D&bars=7")
    assert r.status_code == 200 and r.json()["served_by"] == "stock-path"
    r = _get(app, "/api/bars-history/BTCUSD?tf=D&bars=7")
    assert r.json()["served_by"] == "stock-history"
    assert stock_path["bars"] == [("BTCUSD", "D", 7, "", "", 0, ())]
    assert [h[0] for h in stock_path["history"]] == ["BTCUSD"]
    assert fmp.eod_calls == [] and fmp.quote_calls == [] and deferred.jobs == []


def test_admin_mode_admits_admins_only(app, as_caller, monkeypatch, stock_path, fmp, inline):
    monkeypatch.setenv("CRYPTO_BARS_ENABLED", "admin")
    as_caller(MEMBER)
    for path in CRYPTO_ROUTES:
        assert _get(app, path).status_code == 404
    assert _get(app, "/api/bars/BTCUSD?tf=D").json()["served_by"] == "stock-path"
    assert _get(app, "/api/bars-history/BTCUSD?tf=D").json()["served_by"] == "stock-history"
    assert fmp.eod_calls == [] and fmp.quote_calls == []

    as_caller(ADMIN)
    assert _get(app, "/api/crypto/pairs").json() == {
        "pairs": [{"symbol": "BTCUSD", "name": "Bitcoin", "base": "BTC", "quote": "USD"}],
        "source": "FMP"}
    assert _get(app, "/api/crypto/quote/BTCUSD").json()["price"] == 1234.5
    r = _get(app, "/api/bars/BTCUSD?tf=D&bars=3")
    assert r.status_code == 200 and r.json()["source"] == "FMP" and len(r.json()["bars"]) == 3
    assert len(stock_path["bars"]) == 1                  # only the member's request above


def test_on_every_entitled_member_reads_it_and_nobody_else(app, as_caller, monkeypatch, stock_path, fmp, inline):
    monkeypatch.setenv("CRYPTO_BARS_ENABLED", "1")
    as_caller(None)
    for path in CRYPTO_ROUTES + ["/api/bars/BTCUSD?tf=D"]:
        assert _get(app, path, cookie=False).status_code == 401, path
    as_caller(FREE)
    for path in CRYPTO_ROUTES + ["/api/bars/BTCUSD?tf=D"]:
        assert _get(app, path).status_code == 403, path
    assert fmp.eod_calls == [] and fmp.quote_calls == []
    as_caller(MEMBER)
    r = _get(app, "/api/bars/btcusd?tf=W&bars=2")
    assert r.status_code == 200
    body = r.json()
    assert body["ticker"] == "BTCUSD" and body["tf"] == "W" and len(body["bars"]) == 2
    assert r.headers["cache-control"] == "no-store, must-revalidate"
    q = _get(app, "/api/crypto/quote/btcusd")
    assert q.status_code == 200 and q.json()["symbol"] == "BTCUSD"
    assert q.headers["cache-control"] == "no-store, must-revalidate"
    assert stock_path["bars"] == []


def test_the_quote_route_knows_only_the_table(app, as_caller, monkeypatch, fmp, inline):
    monkeypatch.setenv("CRYPTO_BARS_ENABLED", "1")
    as_caller(MEMBER)
    for sym in ("BTC", "ETHUSD", "AAPL", "BTCUSDT", "%5EGSPC", "BTC-USD"):
        assert _get(app, f"/api/crypto/quote/{sym}").status_code == 404, sym
    assert fmp.quote_calls == []


def test_a_cold_pair_answers_the_charts_warming_contract(app, as_caller, monkeypatch, stock_path, fmp, deferred):
    monkeypatch.setenv("CRYPTO_BARS_ENABLED", "1")
    as_caller(MEMBER)
    r = _get(app, "/api/bars/BTCUSD?tf=D&bars=5")
    assert r.status_code == 503
    assert r.json() == {"ticker": "BTCUSD", "tf": "D", "bars": [], "error": "warming"}
    assert r.headers["retry-after"] == "3" and r.headers["cache-control"] == "no-store, must-revalidate"
    assert fmp.eod_calls == []
    deferred.run()
    assert _get(app, "/api/bars/BTCUSD?tf=D&bars=5").status_code == 200


def test_the_history_route_gives_a_pair_its_settled_bars_and_is_never_cached(
        app, as_caller, monkeypatch, stock_path, fmp, inline):
    """A chart opens on the newest 600 bars and reads the older ones from this route when the
    member scrolls back; it merges only an answer marked `sealed`. Answering nothing here
    ended a pair's daily chart about 20 months back."""
    monkeypatch.setenv("CRYPTO_BARS_ENABLED", "1")
    as_caller(MEMBER)
    assert _get(app, "/api/bars/BTCUSD?tf=D&bars=5").json()["newest_bar_is_forming"] is True
    calls = len(fmp.eod_calls)
    whole = crypto_bars.serve_bars(PAIR, "D", 60000)[1]["bars"]
    assert whole[0]["t"] == START and whole[-1]["t"] == "2026-11-14" and len(whole) == 318
    r = _get(app, "/api/bars-history/BTCUSD?tf=D&bars=60000&d=2026-11-13")
    assert r.status_code == 200
    assert r.json() == {"ticker": "BTCUSD", "tf": "D", "bars": whole[:-1], "sealed": True,
                        "last_sealed": "2026-11-13", "count": 317, "source": "FMP"}
    assert r.headers["cache-control"] == "no-store, must-revalidate"
    assert "cdn-cache-control" not in r.headers and "etag" not in r.headers
    assert stock_path["history"] == [] and len(fmp.eod_calls) == calls     # no vendor wait


def test_the_history_route_keeps_a_newest_bar_that_has_settled(app, as_caller, monkeypatch, fmp, inline):
    monkeypatch.setenv("CRYPTO_BARS_ENABLED", "1")
    as_caller(MEMBER)
    fmp.last_day = dt.date(2026, 11, 13)                 # the vendor has nothing for today yet
    assert _get(app, "/api/bars/BTCUSD?tf=D&bars=5").json()["newest_bar_is_forming"] is False
    body = _get(app, "/api/bars-history/BTCUSD?tf=D").json()
    assert body["bars"][-1]["t"] == "2026-11-13" == body["last_sealed"] and body["count"] == 317


@pytest.mark.parametrize("tf", ["W", "M", "w"])
def test_the_history_route_leaves_the_forming_week_and_month_to_the_bars_route(
        app, as_caller, monkeypatch, fmp, inline, tf):
    monkeypatch.setenv("CRYPTO_BARS_ENABLED", "1")
    as_caller(MEMBER)
    tail = _get(app, "/api/bars/BTCUSD?tf=%s&bars=5000" % tf.upper()).json()
    assert tail["newest_bar_is_forming"] is True
    body = _get(app, "/api/bars-history/BTCUSD?tf=%s" % tf).json()
    assert body["tf"] == tf.upper() and body["sealed"] is True
    assert body["bars"] == tail["bars"][:-1] and body["last_sealed"] == tail["bars"][-2]["t"]


def test_the_history_route_honours_the_bar_count_asked(app, as_caller, monkeypatch, fmp, inline):
    monkeypatch.setenv("CRYPTO_BARS_ENABLED", "1")
    as_caller(MEMBER)
    _get(app, "/api/bars/BTCUSD?tf=D&bars=5")
    body = _get(app, "/api/bars-history/BTCUSD?tf=D&bars=3").json()
    assert [b["t"] for b in body["bars"]] == ["2026-11-11", "2026-11-12", "2026-11-13"]
    assert body["count"] == 3


def test_the_history_route_has_no_intraday_for_a_pair(app, as_caller, monkeypatch, fmp, inline):
    monkeypatch.setenv("CRYPTO_BARS_ENABLED", "1")
    as_caller(MEMBER)
    _get(app, "/api/bars/BTCUSD?tf=D&bars=5")
    r = _get(app, "/api/bars-history/BTCUSD?tf=5")
    assert r.json() == {"ticker": "BTCUSD", "tf": "5", "bars": [], "sealed": False, "last_sealed": "",
                        "count": 0, "source": "FMP", "reason": "timeframe_not_carried"}
    assert r.headers["cache-control"] == "no-store, must-revalidate"


def test_the_history_route_asks_again_while_the_series_is_being_built(
        app, as_caller, monkeypatch, fmp, deferred):
    monkeypatch.setenv("CRYPTO_BARS_ENABLED", "1")
    as_caller(MEMBER)
    r = _get(app, "/api/bars-history/BTCUSD?tf=D")
    assert r.status_code == 503 and r.json() == {"ticker": "BTCUSD", "tf": "D", "bars": [], "error": "warming"}
    assert r.headers["retry-after"] == "3" and r.headers["cache-control"] == "no-store, must-revalidate"
    assert fmp.eod_calls == []
    deferred.run()
    assert _get(app, "/api/bars-history/BTCUSD?tf=D").json()["sealed"] is True


def test_an_admitted_pair_is_never_sent_to_the_bars_tier(app, as_caller, monkeypatch, stock_path, fmp, inline):
    """The tier has no member identity and no pair series: a pair is answered here, before
    either proxy decision is even asked."""
    monkeypatch.setenv("CRYPTO_BARS_ENABLED", "1")
    monkeypatch.setenv("BARS_ORIGIN_URL", "http://127.0.0.1:9")
    monkeypatch.setenv("BARS_HISTORY_ORIGIN_URL", "http://127.0.0.1:9")
    monkeypatch.setenv("BARS_HISTORY_PROXY_ENABLED", "1")
    asked = []
    monkeypatch.setattr(barsmod, "_bars_proxy_should_route", lambda t, w: asked.append(t) or False)

    async def no_proxy(*a, **k):
        asked.append("history-proxy")
        raise RuntimeError("proxied")

    monkeypatch.setattr(barsmod, "_proxy_bars_history_to_worker", no_proxy)
    as_caller(MEMBER)
    assert _get(app, "/api/bars/BTCUSD?tf=D&bars=2").json()["source"] == "FMP"
    assert _get(app, "/api/bars-history/BTCUSD?tf=D").json()["source"] == "FMP"
    assert asked == []
    _get(app, "/api/bars/AAPL?tf=D&bars=2")
    assert asked == ["AAPL"]                             # the control: a stock still asks


# ── 11. a stock and an index are served as before ───────────────────────────────────────

OTHERS = ["/api/bars/AAPL?tf=D&bars=5", "/api/bars/AAPL?tf=5&bars=50&since=1794657600&session=eth",
          "/api/bars/%5EGSPC?tf=D&bars=5", "/api/bars/%5EIXIC?tf=60&bars=9", "/api/bars/BTC?tf=D&bars=5",
          "/api/bars/UCTA50?tf=D&bars=5", "/api/bars/ETHUSD?tf=D&bars=5",
          "/api/bars-history/AAPL?tf=D&bars=5", "/api/bars-history/%5EGSPC?tf=D&bars=5",
          "/api/bars-history/BTC?tf=D&bars=5"]


def test_a_stock_and_an_index_get_the_same_bytes_whatever_the_switch_says(
        app, as_caller, monkeypatch, stock_path, fmp, deferred):
    as_caller(ADMIN)
    monkeypatch.setattr(crypto_bars, "serve_bars",
                        lambda *a, **k: pytest.fail("the crypto serve ran for a non-pair"))
    answers = {}
    for raw in (None, "admin", "1"):
        if raw is None:
            monkeypatch.delenv("CRYPTO_BARS_ENABLED", raising=False)
        else:
            monkeypatch.setenv("CRYPTO_BARS_ENABLED", raw)
        stock_path["bars"].clear()
        stock_path["history"].clear()
        got = []
        for path in OTHERS:
            r = _get(app, path)
            got.append((r.status_code, r.content, r.headers.get("cache-control")))
        answers[raw] = (got, list(stock_path["bars"]), list(stock_path["history"]))
    assert answers["admin"] == answers[None]
    assert answers["1"] == answers[None]
    got, bars_calls, history_calls = answers[None]
    assert len(bars_calls) + len(history_calls) >= 8     # the stub serves really were reached
    assert ("AAPL", "5", 50, "1794657600", "", 0, ("eth",)) in bars_calls
    assert fmp.eod_calls == [] and fmp.quote_calls == [] and deferred.jobs == []


def test_the_bars_router_changes_only_what_a_pair_reaches():
    """The two hand-offs sit before each route's proxy decision and name the same oracle."""
    import inspect
    for fn, proxy in ((barsmod.get_bars, "_bars_proxy_should_route"),
                      (barsmod.get_bars_history, 'os.environ.get("BARS_HISTORY_ORIGIN_URL"')):
        src = inspect.getsource(fn)
        assert src.count("_crypto.serves(ticker, _access)") == 1, fn.__name__
        assert src.index("_crypto.serves(ticker, _access)") < src.index(proxy), fn.__name__
    core = inspect.getsource(barsmod._serve_bars_impl) + inspect.getsource(barsmod.serve_bars_history)
    assert "crypto" not in core.lower()                  # the shared serves know nothing of pairs


# ── 12. the edge and the switch ledger ──────────────────────────────────────────────────

WORKER = os.path.join(REPO, "edge", "bars-edge-router", "worker.js")


def _tier_app(monkeypatch):
    """The bars tier's app (lifespan not entered) with its two shared serves replaced by
    recorders, so a request that reaches the stock serve is seen."""
    import api.bars_api_main as bam
    reached = []
    monkeypatch.setattr(barsmod, "serve_bars_http",
                        lambda t, *a, **k: reached.append(("bars", t)) or {"ticker": t, "bars": []})
    monkeypatch.setattr(barsmod, "serve_bars_history",
                        lambda t, *a, **k: reached.append(("history", t)) or {"ticker": t, "bars": []})
    return bam, bam._build_app(), reached


def _route(app, path):
    return next(r.endpoint for r in app.routes if getattr(r, "path", None) == path)


TIER_BARS = dict(tf="D", bars=5, since="", to="", warm=0, session="")
TIER_HISTORY = dict(tf="D", bars=5, v="", d="")


@pytest.mark.parametrize("raw", [None, "0", "admin", "1"])
def test_the_bars_tier_hands_a_pair_to_the_web_pod_whatever_the_switch_says(monkeypatch, fmp, deferred, raw):
    """The edge sends `/api/bars/BTCUSD` to the tier first. The tier has no member to check
    and no pair series: it answers 501 and never reads a vendor or the stock store."""
    if raw is None:
        monkeypatch.delenv("CRYPTO_BARS_ENABLED", raising=False)
    else:
        monkeypatch.setenv("CRYPTO_BARS_ENABLED", raw)
    bam, app, reached = _tier_app(monkeypatch)
    for path, kw in (("/api/bars/{ticker}", TIER_BARS), ("/api/bars-history/{ticker}", TIER_HISTORY)):
        for typed in ("BTCUSD", "btcusd", " BTCUSD "):
            r = _route(app, path)(typed, **kw)
            assert r.status_code == bam.PAIR_HANDOFF_STATUS == 501, (path, typed)
            assert json.loads(r.body) == {"ticker": "BTCUSD", "bars": [], "error": "served_by_web",
                                          "detail": "currency pairs are served by the web pod"}
            assert r.headers["cache-control"] == "no-store"
            assert "retry-after" not in r.headers and "x-bars-shed" not in r.headers
    assert reached == [] and fmp.eod_calls == [] and fmp.quote_calls == [] and deferred.jobs == []


def test_the_bars_tier_serves_everything_else_as_before(monkeypatch):
    bam, app, reached = _tier_app(monkeypatch)
    others = ("AAPL", "BTC", "ETHUSD", "^GSPC", "UCTA50", "BTCUSDT", "X:BTCUSD")
    for t in others:
        assert _route(app, "/api/bars/{ticker}")(t, **TIER_BARS) == {"ticker": t, "bars": []}
        assert _route(app, "/api/bars-history/{ticker}")(t, **TIER_HISTORY) == {"ticker": t, "bars": []}
    assert reached == [(kind, t) for t in others for kind in ("bars", "history")]


def test_the_edge_router_asks_web_when_the_tier_answers_the_hand_off():
    """The hand-off rides the Worker's fall-back rule as it is deployed: a tier answer of 500
    or more that is not a deliberate 503 shed is asked of web at once. Read from the Worker's
    own source, so a change to that rule fails here instead of blanking the pair's chart."""
    import api.bars_api_main as bam
    src = open(WORKER, encoding="utf-8").read()
    assert "if (r.status >= 500 && !(await isDeliberateTierShed(r))) throw" in src
    assert 'tierP.catch(() => { why = "web-fallback"; openWeb(); });' in src
    shed = src[src.index("export async function isDeliberateTierShed"):]
    assert "if (!r || r.status !== 503) return false;" in shed[:shed.index("\n}\n")]
    assert bam.PAIR_HANDOFF_STATUS >= 500 and bam.PAIR_HANDOFF_STATUS != 503
    assert "CRYPTO" not in src                           # the Worker itself knows no pair


def test_the_web_pod_never_proxies_a_pair_to_the_tier_whatever_the_switch_says(monkeypatch):
    monkeypatch.setenv("BARS_PROXY_ENABLED", "1")
    monkeypatch.setenv("BARS_PROXY_PCT", "100")
    for raw in (None, "0", "1"):
        if raw is None:
            monkeypatch.delenv("CRYPTO_BARS_ENABLED", raising=False)
        else:
            monkeypatch.setenv("CRYPTO_BARS_ENABLED", raw)
        assert barsmod._bars_proxy_should_route("BTCUSD", 0) is False
        assert barsmod._bars_proxy_should_route("btcusd", 0) is False
        assert barsmod._bars_proxy_should_route("AAPL", 0) is True       # the control
        assert barsmod._bars_proxy_should_route("BTC", 0) is True        # the fund is a stock


def test_the_switch_is_in_the_ledger_as_dark():
    ledger = json.load(open(os.path.join(REPO, "docs", "feature_flags.json"), encoding="utf-8"))
    entry = ledger["flags"]["CRYPTO_BARS_ENABLED"]
    assert entry["status"] == "dark"
    assert "provider_licensing_class" in entry["note"] and "FMP" in entry["note"]


# ── 13. the browser's copies of two server facts ────────────────────────────────────────
# The browser holds no flag. It asks `/api/crypto/pairs` only for a symbol in its own short
# list, so a stock costs no request; that list and the timeframes it offers are the server's
# facts written a second time, and these read the client FILE rather than restating it.

CLIENT_LIB = os.path.join(REPO, "app", "src", "lib", "cryptoPairs.js")


def _client_list(name):
    src = open(CLIENT_LIB, encoding="utf-8").read()
    m = re.search(r"export const %s = Object\.freeze\(\[(.*?)\]\)" % name, src, re.S)
    assert m, f"app/src/lib/cryptoPairs.js must export {name} as a frozen list"
    return re.findall(r"'([^']+)'", m.group(1))


def test_the_browsers_candidate_list_is_the_servers_pair_table():
    assert sorted(_client_list("PAIR_CANDIDATES")) == sorted(crypto_bars.PAIRS)
    assert "BTC" not in _client_list("PAIR_CANDIDATES")      # the fund is never asked about


def test_the_browser_offers_exactly_the_timeframes_the_server_serves():
    assert tuple(_client_list("PAIR_TFS")) == tuple(crypto_bars.DAILY_TFS)


def test_the_chart_keys_its_sentence_on_the_word_the_server_sends():
    _, body = crypto_bars.serve_bars(PAIR, "5", 10)
    assert body["reason"] == "timeframe_not_carried"
    chart = open(os.path.join(REPO, "app", "src", "components", "StockChart.jsx"),
                 encoding="utf-8").read()
    assert chart.count("data?.reason === '%s'" % body["reason"]) == 1
