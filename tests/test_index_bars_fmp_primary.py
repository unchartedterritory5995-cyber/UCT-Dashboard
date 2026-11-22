"""Daily index bars: FMP primary, yfinance fallback (owner ruling 2026-11-14).

docs/pine/RS-RATING-TRANSFER.md: "We have the highest plan for FMP, I am fine using
Yahoo, and only want to upgrade to massive if it is needed."
"""
import datetime as dt
from types import SimpleNamespace

import pytest

from api import index_bars
from api.services import fmp_client, yf_util

FMP_ROWS = [  # newest first, as FMP answers
    {"date": "2026-11-13", "open": 6800.0, "high": 6850.0, "low": 6790.0, "close": 6840.5, "volume": 0},
    {"date": "2026-11-12", "open": 6780.0, "high": 6810.0, "low": 6750.0, "close": 6799.25, "volume": 0},
    {"date": "2026-11-11", "open": "bad", "high": 1, "low": 1, "close": 1, "volume": 0},
]


@pytest.fixture(autouse=True)
def no_live_vendor(monkeypatch):
    """No test in this file may reach a live vendor. Two tripwires, both RECORDED and asserted at
    teardown, because index_bars swallows every fetch error (a refused call reads as "no data", and
    the test would stay green):

      * every yfinance read in index_bars goes through `yf_util.bounded_call` (the census rails that,
        tests/test_yf_guard_census.py), so a spy there sees one even though yfinance 1.x talks
        through curl_cffi/libcurl, which never touches Python's `socket`; the spy never runs the
        callable, so a regression fails the test WITHOUT calling Yahoo;
      * every other client (requests/httpx/urllib, e.g. an FMP read the `calls` fixture missed)
        hits the shared loopback-only socket guard.

    Found 2026-11-17: test_weekly_and_intraday_stay_on_yfinance reached the real `_proxy_ratio`,
    downloaded ^GSPC and SPY from Yahoo, and left the live ratio (10.02) in the process-wide cache,
    which then turned tests/test_yf_guard_binds.py::test_index_bars_proxy_ratio_* red."""
    from tests.market_intel_breadth_fixtures import install_loopback_only_guard
    refused_hosts = install_loopback_only_guard(monkeypatch)
    yf_reads = []

    def _tripwire(fn, default, *a, **k):
        yf_reads.append(getattr(fn, "__qualname__", repr(fn)))
        return default                               # never runs `fn`: no request leaves the box

    monkeypatch.setattr(yf_util, "bounded_call", _tripwire)
    yield
    assert yf_reads == [], f"a test reached yfinance (live vendor): {yf_reads}"
    assert refused_hosts == [], f"a test opened a network connection: {refused_hosts}"


@pytest.fixture
def calls(monkeypatch):
    seen = {"fmp": [], "yf": [], "ratio": []}

    def fake_fmp(sym, f, t, **k):
        seen["fmp"].append(sym)
        return SimpleNamespace(value=FMP_ROWS)

    def fake_yf(sym, interval, period, divisor):
        seen["yf"].append((sym, interval))
        # a recent bar: the daily fallback is cut at the window start (L9)
        return [{"t": _utc_midnight("2026-11-13"), "o": 1, "h": 1, "l": 1, "c": 1, "v": 0}]

    def fake_ratio(target_yahoo, etf_sym):
        # the intraday ETF-proxy ratio is two more yfinance reads in production (and is cached
        # process-wide), so it is stubbed like every other vendor read here
        seen["ratio"].append((target_yahoo, etf_sym))
        return 10.0

    monkeypatch.setattr(fmp_client, "get_index_history_eod_full", fake_fmp)
    monkeypatch.setattr(index_bars, "_fetch_yf", fake_yf)
    monkeypatch.setattr(index_bars, "_proxy_ratio", fake_ratio)
    return seen


def _utc_midnight(iso):
    d = dt.date.fromisoformat(iso)
    return int(dt.datetime(d.year, d.month, d.day, tzinfo=dt.timezone.utc).timestamp())


def test_daily_spx_reads_fmp_first_oldest_first_and_never_yfinance(calls):
    out = index_bars._fetch_full_series("SPX", "D")
    # (paged since L9: every page asks ^GSPC; tests/test_index_bars_depth.py rails the paging)
    assert calls["fmp"] and set(calls["fmp"]) == {"^GSPC"} and calls["yf"] == []
    assert [b["c"] for b in out] == [6799.25, 6840.5]           # the bad row is dropped
    assert out[-1]["t"] == _utc_midnight("2026-11-13")


def test_divisor_applies_to_fmp_bars(calls):
    out = index_bars._fetch_full_series("XSP", "D")
    assert out[-1]["c"] == pytest.approx(684.05)


def test_an_fmp_miss_falls_back_to_yfinance(calls, monkeypatch):
    monkeypatch.setattr(fmp_client, "get_index_history_eod_full",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("down")))
    out = index_bars._fetch_full_series("SPX", "D")
    assert calls["yf"] == [("^GSPC", "1d")] and out[0]["c"] == 1


def test_weekly_and_intraday_stay_on_yfinance(calls):
    index_bars._fetch_full_series("SPX", "W")
    index_bars._fetch_full_series("SPX", "60")
    assert calls["fmp"] == []
    # (the one-row fake is "sparse", so intraday also reads its ETF proxy: existing behaviour)
    assert calls["yf"][0] == ("^GSPC", "1wk") and calls["yf"][1] == ("^GSPC", "60m")
    assert calls["ratio"] == [("^GSPC", "SPY")] and calls["yf"][2] == ("SPY", "60m")


def test_the_licensing_register_records_the_ruling():
    from api.services import provider_licensing_class as plc
    assert plc.licensing_class_for("fmp", "indices") == "LA"   # T-40 DDLA column (restated 2026-11-19)
    assert plc.licensing_class_for("yahoo", "indices") == "X"    # the licence fact stands
