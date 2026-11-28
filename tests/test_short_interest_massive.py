"""SHORT_INTEREST_SOURCE=massive (licensed-first pass 1, 2026-11-28).

FINRA short interest read through Massive (short_data.get_stock), float from FMP,
and the Finviz path as the labelled fallback whenever Massive cannot answer. No
network: short_data's answer, FMP's float and the Finviz path are stood in for.
"""
from datetime import date

import pytest

from api.services import short_interest as si


def _ok_answer(reports, float_shares=None, refreshing=False):
    out = {
        "status": "ok", "sym": "ABC",
        "interest": {"state": "ok", "reports": reports, "count": len(reports)},
        "volume": {"state": "ok", "days": []},
        "float": {"shares": float_shares, "pct_float": None, "withheld": False,
                  "state": "ok" if float_shares else "missing", "source": "x"},
    }
    if refreshing:
        out["refreshing"] = True
    return out


REPORTS = [
    {"settlement_date": "2026-11-14", "short_interest": 12_000_000, "avg_daily_volume": 3_000_000,
     "days_to_cover": 4.0, "change_shares": 1_000_000, "change_pct": 9.09},
    {"settlement_date": "2026-10-31", "short_interest": 11_000_000, "avg_daily_volume": 2_000_000,
     "days_to_cover": 5.5, "change_shares": 1_000_000, "change_pct": 10.0},
    {"settlement_date": "2026-10-15", "short_interest": 10_000_000, "avg_daily_volume": 2_000_000,
     "days_to_cover": 5.0, "change_shares": None, "change_pct": None},
]


@pytest.fixture(autouse=True)
def _isolate(monkeypatch, tmp_path):
    monkeypatch.setenv("SHORT_INTEREST_SOURCE", "massive")
    monkeypatch.setenv("SHORT_INTEREST_HISTORY_DB_PATH", str(tmp_path / "si_hist.db"))
    si._CACHE = type(si._CACHE)()
    finviz_calls = []

    def fake_finviz(sym):
        finviz_calls.append(sym)
        return {"ticker": sym, "shares_short": 5, "source": "finviz / exchange-reported short interest"}

    monkeypatch.setattr(si, "_get_short_interest_finviz", fake_finviz)
    yield finviz_calls


def _yf_must_not_run(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("the massive source must never read yfinance")
    monkeypatch.setattr(si, "_get_short_interest_yfinance", boom)


def test_massive_is_in_the_vocabulary_but_not_the_default(monkeypatch):
    default, vocab = si.SHORT_INTEREST_MODE_FLAGS["SHORT_INTEREST_SOURCE"]
    assert default == "yfinance"
    assert "massive" in vocab
    assert si.source() == "massive"
    monkeypatch.setenv("SHORT_INTEREST_SOURCE", " Massive ")
    assert si.source() == "massive"
    monkeypatch.delenv("SHORT_INTEREST_SOURCE")
    assert si.source() == "yfinance"


def test_massive_answer_with_fmp_float(monkeypatch, _isolate):
    _yf_must_not_run(monkeypatch)
    monkeypatch.setattr(si, "_massive_stock", lambda sym: _ok_answer(REPORTS, float_shares=999))
    monkeypatch.setattr(si, "_fmp_float", lambda sym: (100_000_000.0, 120_000_000.0))
    out = si.get_short_interest("abc")
    assert _isolate == [], "a good Massive answer never reads the Finviz path"
    assert out["ticker"] == "ABC"
    assert out["shares_short"] == 12_000_000
    assert out["days_to_cover"] == 4.0
    assert out["short_pct_of_float"] == 12.0          # FMP float, not the Finviz 999
    assert out["float_source"] == si.FLOAT_SOURCE_FMP
    assert out["short_pct_of_shares_outstanding"] == 10.0
    assert out["crowded"] == "high"
    # the prior month is the report two settlements back, read, not inferred
    assert out["shares_short_prior_month"] == 10_000_000
    assert out["shares_short_change_pct"] == 20.0
    assert out["as_of_date"] == "2026-11-14"
    assert out["as_of"] == si._epoch(date(2026, 11, 14))
    assert out["source"] == si.MASSIVE_SOURCE_LABEL
    assert out["licensing_class"] == "LA"
    assert "fallback_from" not in out


def test_float_falls_back_to_the_held_export_float_then_unknown(monkeypatch):
    monkeypatch.setattr(si, "_massive_stock", lambda sym: _ok_answer(REPORTS, float_shares=60_000_000))
    monkeypatch.setattr(si, "_fmp_float", lambda sym: (None, None))
    out = si.get_short_interest("ABC")
    assert out["short_pct_of_float"] == 20.0
    assert out["float_source"] == "nightly screener export (Finviz), today's float"

    si._CACHE = type(si._CACHE)()
    monkeypatch.setattr(si, "_massive_stock", lambda sym: _ok_answer(REPORTS, float_shares=None))
    out = si.get_short_interest("ABC")
    assert out["short_pct_of_float"] is None
    assert out["crowded"] is None, "an unknown float is never 'low'"
    assert out["float_source"] is None
    assert out["short_pct_of_shares_outstanding"] is None


def test_a_gap_in_massive_history_leaves_the_prior_month_unknown(monkeypatch):
    gap = [REPORTS[0], dict(REPORTS[2], settlement_date="2026-09-30")]
    monkeypatch.setattr(si, "_massive_stock", lambda sym: _ok_answer(gap))
    monkeypatch.setattr(si, "_fmp_float", lambda sym: (None, None))
    out = si.get_short_interest("ABC")
    assert out["shares_short_prior_month"] is None
    assert out["shares_short_change_pct"] is None


@pytest.mark.parametrize("answer,reason", [
    ({"status": "computing", "sym": "ABC"}, "computing"),
    ({"status": "unavailable", "sym": "ABC"}, "unavailable"),
    ({"status": "failed", "sym": "ABC"}, "failed"),
    ({"status": "ok", "interest": {"state": "none"}}, "short interest none"),
    ({"status": "ok", "interest": {"state": "unavailable", "http_status": 403}}, "short interest unavailable"),
    (None, "no answer"),
])
def test_massive_that_cannot_answer_falls_back_to_finviz_labelled(monkeypatch, _isolate, answer, reason):
    _yf_must_not_run(monkeypatch)
    monkeypatch.setattr(si, "_massive_stock", lambda sym: answer)
    monkeypatch.setattr(si, "_fmp_float", lambda sym: pytest.fail("no float read on a fallback"))
    out = si.get_short_interest("ABC")
    assert _isolate == ["ABC"]
    assert out["source"].startswith("finviz")
    assert out["fallback_from"] == "massive"
    assert out["massive_state"] == reason


def test_a_raising_read_falls_back_too(monkeypatch, _isolate):
    def boom(sym):
        raise RuntimeError("network")
    monkeypatch.setattr(si, "_massive_stock", boom)
    out = si.get_short_interest("ABC")
    assert _isolate == ["ABC"] and out["fallback_from"] == "massive"


def test_only_a_massive_answer_is_cached(monkeypatch, _isolate):
    calls = []
    monkeypatch.setattr(si, "_massive_stock", lambda sym: calls.append(sym) or {"status": "computing"})
    si.get_short_interest("ABC")
    si.get_short_interest("ABC")
    assert calls == ["ABC", "ABC"], "a fallback answer is not held: the next call asks Massive again"
    monkeypatch.setattr(si, "_massive_stock", lambda sym: calls.append(sym) or _ok_answer(REPORTS))
    monkeypatch.setattr(si, "_fmp_float", lambda sym: (None, None))
    si.get_short_interest("ABC")
    si.get_short_interest("ABC")
    assert calls == ["ABC", "ABC", "ABC"]


def test_history_keeps_recording_under_massive(monkeypatch):
    assert si.history_enabled() is True
    monkeypatch.setenv("SHORT_INTEREST_SOURCE", "yfinance")
    assert si.history_enabled() is False


def test_fmp_float_reads_the_first_row(monkeypatch):
    from api.services import fmp_client
    monkeypatch.setattr(fmp_client, "body_or_none", lambda fn, sym, timeout: [
        {"symbol": sym, "floatShares": 5.0, "outstandingShares": 7}])
    assert si._fmp_float("ABC") == (5.0, 7.0)
    monkeypatch.setattr(fmp_client, "body_or_none", lambda fn, sym, timeout: [])
    assert si._fmp_float("ABC") == (None, None)
    monkeypatch.setattr(fmp_client, "body_or_none", lambda fn, sym, timeout: [
        {"floatShares": 0, "outstandingShares": None}])
    assert si._fmp_float("ABC") == (None, None)
