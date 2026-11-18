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
import time
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


def test_D3_weekly_and_the_finer_intraday_periods_are_unchanged():
    assert index_bars.PERIOD_MAP["1wk"] == "10y"
    for interval in ("1m", "2m", "5m", "15m", "30m", "90m"):
        assert index_bars.PERIOD_MAP[interval] in ("7d", "60d"), interval


def test_D3b_hourly_reaches_yfinance_s_730_days():
    """RS RATING L12: an hourly chart (an index's own, and Fred RS's RS line on any 1h chart) reads SP:SPX at its own
    period; 60 days of it covered only the last 60 sessions of a 1h chart. yfinance serves 730 days of 60m."""
    assert index_bars.PERIOD_MAP["60m"] == "730d"


def test_D3c_an_hourly_fetch_asks_yfinance_for_730_days(monkeypatch):
    seen = []
    monkeypatch.setattr(index_bars, "_fetch_yf", lambda sym, interval, period, divisor: seen.append((sym, interval, period)) or
                        [{"t": 1794929400 + 3600 * i, "o": 1, "h": 1, "l": 1, "c": 1, "v": 0} for i in range(20)])
    index_bars._fetch_full_series("SPX", "60")
    assert seen == [("^GSPC", "60m", "730d")]


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


# -- D5 (RS RATING L12) --------------------------------------------------------------

def test_D5_a_yfinance_index_level_is_its_2_decimal_quote_before_the_divisor(monkeypatch):
    """yfinance hands 7340.6298828125 for the 7340.63 print; TradingView reads the quote. Rounded BEFORE the divisor,
    so a divided index (DJX = ^DJI / 100, XSP = ^GSPC / 10) keeps its extra digits."""
    import pandas as pd
    idx = pd.to_datetime(["2026-11-17 20:55:00+00:00"])
    df = pd.DataFrame({"Open": [7329.97998046875], "High": [7340.6298828125], "Low": [7329.97998046875],
                       "Close": [7340.6298828125], "Volume": [87212000]}, index=idx)
    import api.services.yf_util as yfu
    monkeypatch.setattr(yfu, "bounded_call", lambda fn, default: df)
    import types, sys
    monkeypatch.setitem(sys.modules, "yfinance", types.SimpleNamespace(download=lambda *a, **k: df))
    out = index_bars._fetch_yf("^GSPC", "5m", "60d", 1.0)
    assert out[0]["c"] == 7340.63 and out[0]["o"] == 7329.98
    xsp = index_bars._fetch_yf("^GSPC", "5m", "60d", 10.0)
    assert xsp[0]["c"] == 734.063                       # the quote / 10, not round(734.06298828125, 2)



# -- D6 (RS RATING L12): a COLD intraday copy is refreshed in the request -------------------------------------------

def _seed_mem(sym, tf, age_s, rows):
    from api.services.cache import cache
    cache.set(f"idxbars_{sym}_{tf}", {"saved_at": time.time() - age_s, "series": rows, "proxy": False}, ttl=3600)


def _clear_mem(sym, tf):
    from api.services.cache import cache
    cache.set(f"idxbars_{sym}_{tf}", None, ttl=1)


OLD = [{"t": 1794859200, "o": 1, "h": 1, "l": 1, "c": 1, "v": 0}]
NEW = [{"t": 1794859200, "o": 1, "h": 1, "l": 1, "c": 1, "v": 0}, {"t": 1794949200, "o": 2, "h": 2, "l": 2, "c": 2, "v": 0}]


def test_D6a_a_cold_intraday_copy_is_refreshed_in_the_request(monkeypatch):
    calls, kicked = [], []
    monkeypatch.setattr(index_bars, "_refresh", lambda s, tf: calls.append((s, tf)) or NEW)
    monkeypatch.setattr(index_bars, "_kick_bg_refresh", lambda s, tf: kicked.append((s, tf)))
    _seed_mem("SPX", "15", 2 * 3600, OLD)
    series, tier = index_bars._cached_series("SPX", "15")
    assert calls == [("SPX", "15")] and tier == "index-yf" and series == NEW and kicked == []
    _clear_mem("SPX", "15")


def test_D6b_a_vendor_that_answers_nothing_serves_the_stale_copy(monkeypatch):
    monkeypatch.setattr(index_bars, "_refresh", lambda s, tf: [])
    monkeypatch.setattr(index_bars, "_kick_bg_refresh", lambda s, tf: None)
    _seed_mem("SPX", "15", 2 * 3600, OLD)
    series, tier = index_bars._cached_series("SPX", "15")
    assert series == OLD and tier == "index-mem-stale"
    def boom(s, tf):
        raise RuntimeError("vendor down")
    monkeypatch.setattr(index_bars, "_refresh", boom)
    series, tier = index_bars._cached_series("SPX", "15")
    assert series == OLD and tier == "index-mem-stale"
    _clear_mem("SPX", "15")


def test_D6c_a_short_miss_and_a_daily_copy_keep_stale_while_revalidate(monkeypatch):
    calls, kicked = [], []
    monkeypatch.setattr(index_bars, "_refresh", lambda s, tf: calls.append((s, tf)) or NEW)
    monkeypatch.setattr(index_bars, "_kick_bg_refresh", lambda s, tf: kicked.append((s, tf)))
    _seed_mem("SPX", "15", 600, OLD)                     # past the 300 s TTL, under an hour
    assert index_bars._cached_series("SPX", "15") == (OLD, "index-mem-stale")
    _seed_mem("SPX", "D", 3 * 86400, OLD)                # a daily copy days old
    assert index_bars._cached_series("SPX", "D") == (OLD, "index-mem-stale")
    assert calls == [] and kicked == [("SPX", "15"), ("SPX", "D")]
    _clear_mem("SPX", "15"); _clear_mem("SPX", "D")


def test_D6d_one_refresh_at_a_time_a_second_request_serves_stale(monkeypatch):
    calls = []
    monkeypatch.setattr(index_bars, "_refresh", lambda s, tf: calls.append((s, tf)) or NEW)
    monkeypatch.setattr(index_bars, "_kick_bg_refresh", lambda s, tf: None)
    _seed_mem("SPX", "15", 2 * 3600, OLD)
    with index_bars._bg_lock:
        index_bars._bg_inflight.add("SPX_15")
    try:
        assert index_bars._cached_series("SPX", "15") == (OLD, "index-mem-stale") and calls == []
    finally:
        with index_bars._bg_lock:
            index_bars._bg_inflight.discard("SPX_15")
    _clear_mem("SPX", "15")



# -- D7 (RS RATING L12): a newest bar stored while it formed is a partial print once it has ended --------------------

def _d7_et(hh, mm, ss=0, day=18):
    from datetime import datetime
    from zoneinfo import ZoneInfo
    return datetime(2026, 11, day, hh, mm, ss, tzinfo=ZoneInfo("America/New_York")).timestamp()


def _d7_row(t, c):
    return {"t": int(t), "o": c, "h": c, "l": c, "c": c, "v": 0}


S15 = [_d7_row(_d7_et(9, 45), 7354.63), _d7_row(_d7_et(10, 0), 7340.98), _d7_row(_d7_et(10, 15), 7338.74)]   # production at 10:17:37 ET


def test_D7a_a_bar_forming_when_stored_and_ended_since_is_withheld():
    out = index_bars._settled_partial_withheld(S15, "15", _d7_et(10, 17, 37), _d7_et(11, 1))
    assert out == S15[:-1]                                   # the 10:15 bar (its 10:17 print) is not served as settled


def test_D7b_the_bar_still_forming_at_serve_is_kept():
    assert index_bars._settled_partial_withheld(S15, "15", _d7_et(10, 17, 37), _d7_et(10, 20)) == S15


def test_D7c_a_bar_that_had_ended_when_stored_is_kept():
    assert index_bars._settled_partial_withheld(S15, "15", _d7_et(10, 30, 5), _d7_et(11, 1)) == S15
    assert index_bars._settled_partial_withheld(S15, "15", _d7_et(10, 30), _d7_et(11, 1)) == S15     # stored AT its end


def test_D7d_a_60m_bar_ends_at_the_session_close_not_its_step():
    s60 = [_d7_row(_d7_et(14, 30), 7319.31), _d7_row(_d7_et(15, 30), 7340.63)]
    # stored 16:05 ET (after the 16:00 close): the 15:30 bar had ended, kept the next morning
    assert index_bars._settled_partial_withheld(s60, "60", _d7_et(16, 5), _d7_et(9, 0, day=19)) == s60
    # stored 15:50 (still forming): withheld once the close has passed
    assert index_bars._settled_partial_withheld(s60, "60", _d7_et(15, 50), _d7_et(16, 1)) == s60[:-1]


def test_D7e_a_daily_copy_and_an_unstamped_copy_are_untouched():
    d = [{"t": 1794873600, "o": 1, "h": 1, "l": 1, "c": 7340.53, "v": 0}]
    assert index_bars._settled_partial_withheld(d, "D", 1794873600, 1794960000) == d
    assert index_bars._settled_partial_withheld(S15, "15", None, _d7_et(11, 1)) == S15


def test_D7f_the_serve_applies_it(monkeypatch):
    from api.services.cache import cache
    monkeypatch.setattr(index_bars, "_refresh", lambda s, tf: [])            # no vendor answers: the stored copy is served
    monkeypatch.setattr(index_bars, "_kick_bg_refresh", lambda s, tf: None)
    monkeypatch.setattr(index_bars, "_now", lambda: _d7_et(11, 1))
    cache.set("idxbars_SPX_15", {"saved_at": _d7_et(10, 17, 37), "series": S15, "proxy": False}, ttl=3600)
    try:
        got = index_bars.fetch_index_bars("SPX", "15", bars=5000)
        assert [r["t"] for r in got["bars"]] == [r["t"] for r in S15[:-1]]
    finally:
        cache.set("idxbars_SPX_15", None, ttl=1)
