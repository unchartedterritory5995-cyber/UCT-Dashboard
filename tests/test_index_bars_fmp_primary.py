"""Daily index bars: FMP primary, yfinance fallback (owner ruling 2026-11-14).

docs/pine/RS-RATING-TRANSFER.md: "We have the highest plan for FMP, I am fine using
Yahoo, and only want to upgrade to massive if it is needed."
"""
import datetime as dt
from types import SimpleNamespace

import pytest

from api import index_bars
from api.services import fmp_client

FMP_ROWS = [  # newest first, as FMP answers
    {"date": "2026-11-13", "open": 6800.0, "high": 6850.0, "low": 6790.0, "close": 6840.5, "volume": 0},
    {"date": "2026-11-12", "open": 6780.0, "high": 6810.0, "low": 6750.0, "close": 6799.25, "volume": 0},
    {"date": "2026-11-11", "open": "bad", "high": 1, "low": 1, "close": 1, "volume": 0},
]


@pytest.fixture
def calls(monkeypatch):
    seen = {"fmp": [], "yf": []}

    def fake_fmp(sym, f, t, **k):
        seen["fmp"].append(sym)
        return SimpleNamespace(value=FMP_ROWS)

    def fake_yf(sym, interval, period, divisor):
        seen["yf"].append((sym, interval))
        return [{"t": 1, "o": 1, "h": 1, "l": 1, "c": 1, "v": 0}]

    monkeypatch.setattr(fmp_client, "get_index_history_eod_full", fake_fmp)
    monkeypatch.setattr(index_bars, "_fetch_yf", fake_yf)
    return seen


def _utc_midnight(iso):
    d = dt.date.fromisoformat(iso)
    return int(dt.datetime(d.year, d.month, d.day, tzinfo=dt.timezone.utc).timestamp())


def test_daily_spx_reads_fmp_first_oldest_first_and_never_yfinance(calls):
    out = index_bars._fetch_full_series("SPX", "D")
    assert calls["fmp"] == ["^GSPC"] and calls["yf"] == []
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


def test_the_licensing_register_records_the_ruling():
    from api.services import provider_licensing_class as plc
    assert plc.licensing_class_for("fmp", "indices") == "R"
    assert plc.licensing_class_for("yahoo", "indices") == "X"    # the licence fact stands
