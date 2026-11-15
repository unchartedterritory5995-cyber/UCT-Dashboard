"""RS RATING L9 -- daily index bars carry their full history (docs/pine/RS-RATING-TRANSFER.md).

Served SPX was 5 years deep (`INDEX_FMP_LOOKBACK_DAYS` 365*5+2, yfinance `period="5y"`), so on a
chart reaching back further RS Rating's line was `na` before the served SPX began (NVDA: 6997 bars on
TradingView, ours `na` before 2021-11-15). Now:
  D1 FMP is read from 1990-01-01 in pages (FMP may cap the span of one call), oldest page first,
     and the rows come back oldest-first, deduplicated by session date;
  D2 a page that fails, or a hole after the history began, is never served: the read falls back;
  D3 the yfinance fallback reads its full period and is cut at the same start, so primary and
     fallback answer the same span;
  D4 `INDEX_FMP_LOOKBACK_DAYS`, when set, still decides the span, for both.
"""
import datetime as dt
from types import SimpleNamespace

import pytest

from api import index_bars
from api.services import fmp_client

TODAY = dt.date(2026, 11, 15)


def _utc(iso):
    d = dt.date.fromisoformat(iso)
    return int(dt.datetime(d.year, d.month, d.day, tzinfo=dt.timezone.utc).timestamp())


def _row(iso, c):
    return {"date": iso, "open": c, "high": c, "low": c, "close": c, "volume": 0}


def _sessions(start, end):
    """Weekday rows in [start, end], newest first (as FMP answers), close = ordinal day."""
    d, out = dt.date.fromisoformat(start), []
    stop = dt.date.fromisoformat(end)
    while d <= stop:
        if d.weekday() < 5:
            out.append(_row(d.isoformat(), float(d.toordinal())))
        d += dt.timedelta(days=1)
    return list(reversed(out))


@pytest.fixture
def fmp(monkeypatch):
    """A fake FMP that answers each window from one long synthetic history."""
    history = _sessions("1985-01-01", TODAY.isoformat())
    seen = []

    def fake(sym, from_d, to_d, **k):
        seen.append((from_d, to_d))
        rows = [r for r in history if from_d <= r["date"] <= to_d]
        if not rows:
            raise fmp_client._ERR.not_found("no data")
        return SimpleNamespace(value=rows)

    monkeypatch.setattr(fmp_client, "get_index_history_eod_full", fake)
    monkeypatch.delenv("INDEX_FMP_LOOKBACK_DAYS", raising=False)
    monkeypatch.delenv("INDEX_FMP_PAGE_DAYS", raising=False)
    return seen


# -- D1 -------------------------------------------------------------------------------------

def test_D1_fmp_is_paged_from_1990_oldest_page_first_and_the_rows_are_oldest_first(fmp):
    out = index_bars._fetch_fmp_daily("^GSPC", 1.0, today=TODAY)
    assert len(fmp) > 1, "one call cannot be relied on for 36 years"
    assert fmp[0][0] == "1990-01-01" and fmp[-1][1] == TODAY.isoformat()
    starts = [f for f, _ in fmp]
    assert starts == sorted(starts)
    for (_, prev_to), (nxt_from, _) in zip(fmp, fmp[1:]):          # the windows tile the span
        assert dt.date.fromisoformat(nxt_from) == dt.date.fromisoformat(prev_to) + dt.timedelta(days=1)
    ts = [b["t"] for b in out]
    assert ts == sorted(ts) and len(ts) == len(set(ts))
    assert out[0]["t"] == _utc("1990-01-01") and out[-1]["t"] == _utc("2026-11-13")
    assert len(out) > 9000


def test_D1_overlapping_pages_are_deduplicated_by_session(fmp, monkeypatch):
    real = fmp_client.get_index_history_eod_full

    def overlapping(sym, from_d, to_d, **k):                        # every page re-sends 10 days
        f = (dt.date.fromisoformat(from_d) - dt.timedelta(days=10)).isoformat()
        return real(sym, f, to_d, **k)

    monkeypatch.setattr(fmp_client, "get_index_history_eod_full", overlapping)
    out = index_bars._fetch_fmp_daily("^GSPC", 1.0, today=TODAY)
    ts = [b["t"] for b in out]
    assert len(ts) == len(set(ts)) and ts == sorted(ts)
    assert out[0]["t"] >= _utc("1990-01-01")


def test_D1_leading_pages_before_the_index_existed_are_empty_not_failures(fmp, monkeypatch):
    real = fmp_client.get_index_history_eod_full

    def late_listing(sym, from_d, to_d, **k):                        # history begins 2001
        if to_d < "2001-01-01":
            raise fmp_client._ERR.not_found("no data")
        return real(sym, max(from_d, "2001-01-01"), to_d, **k)

    monkeypatch.setattr(fmp_client, "get_index_history_eod_full", late_listing)
    out = index_bars._fetch_fmp_daily("^GSPC", 1.0, today=TODAY)
    assert out and out[0]["t"] == _utc("2001-01-01")


# -- D2 -------------------------------------------------------------------------------------

def test_D2_a_failing_page_serves_nothing_so_the_caller_falls_back(fmp, monkeypatch):
    real = fmp_client.get_index_history_eod_full

    def one_page_down(sym, from_d, to_d, **k):
        if from_d <= "2005-06-01" <= to_d:
            raise RuntimeError("timeout")
        return real(sym, from_d, to_d, **k)

    monkeypatch.setattr(fmp_client, "get_index_history_eod_full", one_page_down)
    assert index_bars._fetch_fmp_daily("^GSPC", 1.0, today=TODAY) == []


def test_D2_a_not_found_page_after_the_history_began_is_a_hole_never_served(fmp, monkeypatch):
    real = fmp_client.get_index_history_eod_full

    def hole(sym, from_d, to_d, **k):
        if from_d <= "2010-06-01" <= to_d:
            raise fmp_client._ERR.not_found("no data")
        return real(sym, from_d, to_d, **k)

    monkeypatch.setattr(fmp_client, "get_index_history_eod_full", hole)
    assert index_bars._fetch_fmp_daily("^GSPC", 1.0, today=TODAY) == []


def test_D2_a_newest_page_reported_empty_is_a_hole_too(fmp, monkeypatch):
    real = fmp_client.get_index_history_eod_full

    def no_recent(sym, from_d, to_d, **k):                          # no gap INSIDE what came back
        if to_d == TODAY.isoformat():
            raise fmp_client._ERR.not_found("no data")
        return real(sym, from_d, to_d, **k)

    monkeypatch.setattr(fmp_client, "get_index_history_eod_full", no_recent)
    assert index_bars._fetch_fmp_daily("^GSPC", 1.0, today=TODAY) == []


def test_D2_a_silent_gap_inside_a_page_is_never_served(fmp, monkeypatch):
    real = fmp_client.get_index_history_eod_full

    def truncated(sym, from_d, to_d, **k):                          # a page missing a month
        res = real(sym, from_d, to_d, **k)
        return SimpleNamespace(value=[r for r in res.value if not ("2012-03-01" <= r["date"] <= "2012-03-31")])

    monkeypatch.setattr(fmp_client, "get_index_history_eod_full", truncated)
    assert index_bars._fetch_fmp_daily("^GSPC", 1.0, today=TODAY) == []


def test_D2_CONTROL_the_longest_real_closure_is_not_a_gap(fmp, monkeypatch):
    real = fmp_client.get_index_history_eod_full

    def sept_2001(sym, from_d, to_d, **k):                          # NYSE shut 9/11-9/14/2001
        res = real(sym, from_d, to_d, **k)
        return SimpleNamespace(value=[r for r in res.value if not ("2001-09-11" <= r["date"] <= "2001-09-14")])

    monkeypatch.setattr(fmp_client, "get_index_history_eod_full", sept_2001)
    assert len(index_bars._fetch_fmp_daily("^GSPC", 1.0, today=TODAY)) > 9000


# -- D3 -------------------------------------------------------------------------------------

def test_D3_the_yfinance_fallback_reads_its_full_period_and_is_cut_at_the_same_start(monkeypatch):
    seen = []

    def fake_yf(sym, interval, period, divisor):
        seen.append((sym, interval, period))
        return [{"t": _utc(d), "o": 1, "h": 1, "l": 1, "c": 1, "v": 0}
                for d in ("1985-03-01", "1989-12-29", "1990-01-02", "2026-11-13")]

    monkeypatch.setattr(index_bars, "_fetch_fmp_daily", lambda *a, **k: [])
    monkeypatch.setattr(index_bars, "_fetch_yf", fake_yf)
    monkeypatch.delenv("INDEX_FMP_LOOKBACK_DAYS", raising=False)
    out = index_bars._fetch_full_series("SPX", "D")
    assert seen == [("^GSPC", "1d", "max")]
    assert [b["t"] for b in out] == [_utc("1990-01-02"), _utc("2026-11-13")]


def test_D3_weekly_and_intraday_periods_are_unchanged():
    assert index_bars.PERIOD_MAP["1wk"] == "10y" and index_bars.PERIOD_MAP["60m"] == "60d"


# -- D4 -------------------------------------------------------------------------------------

def test_D4_the_env_override_still_decides_the_span_for_fmp(fmp, monkeypatch):
    monkeypatch.setenv("INDEX_FMP_LOOKBACK_DAYS", "400")
    out = index_bars._fetch_fmp_daily("^GSPC", 1.0, today=TODAY)
    start = (TODAY - dt.timedelta(days=400)).isoformat()
    assert fmp[0][0] == start
    assert out[0]["t"] >= _utc(start) and len(out) < 300


def test_D4_the_env_override_still_decides_the_span_for_the_fallback(monkeypatch):
    monkeypatch.setenv("INDEX_FMP_LOOKBACK_DAYS", "30")
    old = (dt.date.today() - dt.timedelta(days=60)).isoformat()
    new = (dt.date.today() - dt.timedelta(days=5)).isoformat()
    monkeypatch.setattr(index_bars, "_fetch_fmp_daily", lambda *a, **k: [])
    monkeypatch.setattr(index_bars, "_fetch_yf", lambda *a: [
        {"t": _utc(d), "o": 1, "h": 1, "l": 1, "c": 1, "v": 0} for d in (old, new)])
    assert [b["t"] for b in index_bars._fetch_full_series("SPX", "D")] == [_utc(new)]


def test_D4_an_unparseable_override_keeps_the_1990_start(monkeypatch):
    monkeypatch.setenv("INDEX_FMP_LOOKBACK_DAYS", "five years")
    assert index_bars._daily_window_start(TODAY) == dt.date(1990, 1, 1)
    monkeypatch.setenv("INDEX_FMP_LOOKBACK_DAYS", "0")
    assert index_bars._daily_window_start(TODAY) == dt.date(1990, 1, 1)
