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


# -- D8 (2026-11-20, production): the newest bar never goes BACK across a bar boundary -------------------------------
# Measured on production 2026-11-20 (the bars-api tier, anonymous, one read every 10 s): `/api/bars/SPX?tf=5` answered
# the 15:00 bar forming at 15:04:47Z and only 14:55 at 15:05:07Z, from ONE stored copy (refreshed_at 15:04:04 both
# times). That copy's newest bar ended at 15:05:00, D7 withheld it, and nothing refreshed the copy until its 300 s TTL
# ran out: 16 of 21 tf=5 answers were two bars behind the clock, tf=1 and tf=15 the same. A Pine script reading SPX
# from an intraday chart sat pending, because the series it held kept losing its newest row.
# Now a copy whose newest bar has ended since it was stored is refreshed in the request (`_tail_ended_since_saved`),
# and a request that finds that refresh already running waits for it (`REFRESH_WAIT_S`) instead of answering the
# withheld tail. A vendor that answers nothing still gets the withheld tail (D7), and the answer says it is stale.

_REAL_REFRESH = index_bars._refresh


def _d8_et(hh, mm, ss=0):
    return _d7_et(hh, mm, ss)          # 2026-11-18: a past session, so no read of the wall clock can land on it


def _d8_fives(last_hm):
    """The 5m rows from 09:30 to `last_hm` (an ET (hh, mm)); close = minutes since 09:30."""
    out, t, stop = [], _d8_et(9, 30), _d8_et(*last_hm)
    while t <= stop:
        out.append(_d7_row(t, 7300.0 + (t - _d8_et(9, 30)) / 60.0))
        t += 300
    return out


S5_STORED = _d8_fives((9, 50))         # stored at 09:54:00, while its 09:50 bar was forming
S5_FRESH = _d8_fives((9, 55))          # what the vendor answers at 09:56:35: 09:50 settled, 09:55 forming


class _D8Clock:
    """`index_bars.time` with `time()` pinned; everything else is the real module's."""
    def __init__(self, now):
        self.now = float(now)

    def time(self):
        return self.now

    def __getattr__(self, name):
        return getattr(time, name)


@pytest.fixture
def d8(monkeypatch):
    """The index store in memory only, the serve clock pinned, the vendor a stub that stores like `_refresh`."""
    from api.services.cache import cache
    clock = _D8Clock(_d8_et(9, 54, 3))
    monkeypatch.setattr(index_bars, "time", clock)
    monkeypatch.setattr(index_bars, "_now", lambda: clock.now)
    monkeypatch.setattr(index_bars, "_load_disk", lambda sym, tf: None)
    monkeypatch.setattr(index_bars, "_save_disk", lambda *a, **k: None)
    monkeypatch.setattr(index_bars, "_refresh_failed_at", {})
    kicked, calls = [], []
    monkeypatch.setattr(index_bars, "_kick_bg_refresh", lambda s, tf: kicked.append((s, tf)))
    vendor = {"rows": S5_FRESH}

    def fake_refresh(sym, tf):
        calls.append((sym, tf))
        rows = list(vendor["rows"])
        if rows:
            cache.set(f"idxbars_{sym}_{tf}", {"saved_at": clock.now, "series": rows, "proxy": False}, ttl=3600)
        return rows

    monkeypatch.setattr(index_bars, "_refresh", fake_refresh)

    def seed(tf, rows, saved_at):
        cache.set(f"idxbars_SPX_{tf}", {"saved_at": saved_at, "series": list(rows), "proxy": False}, ttl=3600)

    def serve(tf="5"):
        return index_bars.fetch_index_bars("SPX", tf, bars=5000)

    keys = [f"idxbars_SPX_{tf}" for tf in ("1", "5", "D")]
    for k in keys:
        cache.invalidate(k)
    yield SimpleNamespace(clock=clock, calls=calls, kicked=kicked, vendor=vendor, seed=seed, serve=serve)
    for k in keys:
        cache.invalidate(k)


def test_D8a_the_newest_bar_never_goes_back_across_a_bar_boundary(d8, monkeypatch):
    d8.seed("5", S5_STORED, _d8_et(9, 54))
    first = d8.serve()                                     # 09:54:03: the 09:50 bar is still forming
    assert first["bars"][-1]["t"] == _d8_et(9, 50)
    assert d8.calls == [] and first["refresh_state"] == "fresh"     # CONTROL: inside its TTL, no boundary crossed
    d8.clock.now = _d8_et(9, 56, 35)                       # the 09:50 bar ended at 09:55:00; the copy is 155 s old
    second = d8.serve()
    newest = second["bars"][-1]["t"]
    assert newest >= first["bars"][-1]["t"], (
        "the newest bar went BACK %d s (production 2026-11-20: 15:00 forming, then 14:55)"
        % (first["bars"][-1]["t"] - newest))
    assert d8.calls == [("SPX", "5")] and newest == _d8_et(9, 55)   # refreshed in THIS request, one vendor read

    # ONE serve clock: `_now` alone decides the copy's age (the module's wall clock is left real here).
    monkeypatch.setattr(index_bars, "time", time)
    d8.seed("5", S5_FRESH, _d8_et(9, 56, 35))              # stored at `_now`; its 09:55 bar is forming
    third = d8.serve()
    assert third["bars"][-1]["t"] == _d8_et(9, 55) and d8.calls == [("SPX", "5")], (
        "the serve judged the copy's age by a clock other than `_now`")


def test_D8b_a_vendor_that_answers_nothing_at_the_boundary_says_the_answer_is_stale(d8, monkeypatch):
    asked = []
    monkeypatch.setattr(index_bars, "_refresh", _REAL_REFRESH)
    monkeypatch.setattr(index_bars, "_fetch_full_series", lambda sym, tf, info=None: asked.append((sym, tf)) or [])
    d8.seed("5", S5_STORED, _d8_et(9, 54))
    d8.clock.now = _d8_et(9, 56, 35)
    got = d8.serve()
    assert asked == [("SPX", "5")]                         # the vendor was asked, in the request
    assert got["bars"][-1]["t"] == _d8_et(9, 45)           # D7 holds: the partial 09:50 print is not served as settled
    assert got["refresh_state"] in ("stale", "failed"), "a tail two bars behind answered refresh_state=fresh"


def test_D8c_one_minute_bars_a_disk_copy_and_the_controls(d8, monkeypatch):
    from api.services.cache import cache
    # tf=1 (TTL 120 s): stored 09:54:10 with its 09:54 bar forming; at 09:55:20 the copy is 70 s old and that bar ended.
    s1 = [_d7_row(_d8_et(9, m), 7300.0 + m) for m in range(40, 55)]
    d8.seed("1", s1, _d8_et(9, 54, 10))
    d8.vendor["rows"] = s1 + [_d7_row(_d8_et(9, 55), 7355.0)]
    d8.clock.now = _d8_et(9, 55, 20)
    got = d8.serve("1")
    assert got["bars"][-1]["t"] == _d8_et(9, 55) and d8.calls == [("SPX", "1")]

    # A copy read from disk (memory empty: a restart, an eviction) follows the same rule.
    cache.invalidate("idxbars_SPX_5")
    monkeypatch.setattr(index_bars, "_load_disk", lambda sym, tf: (
        {"saved_at": _d8_et(9, 54), "series": list(S5_STORED), "proxy": False} if tf == "5" else None))
    d8.vendor["rows"] = S5_FRESH
    d8.clock.now = _d8_et(9, 56, 35)
    got = d8.serve("5")
    assert got["bars"][-1]["t"] == _d8_et(9, 55) and d8.calls[-1] == ("SPX", "5")

    # CONTROLS, no boundary refresh: a copy stored AFTER its newest bar ended, and a daily copy.
    n = len(d8.calls)
    d8.seed("5", S5_STORED, _d8_et(9, 55, 10))             # 09:50 had ended when this copy was stored
    d8.clock.now = _d8_et(9, 57)
    got = d8.serve("5")
    assert got["bars"][-1]["t"] == _d8_et(9, 50) and len(d8.calls) == n
    d8.seed("D", [{"t": 1794873600, "o": 1, "h": 1, "l": 1, "c": 7340.53, "v": 0}], _d8_et(9, 0))
    d8.serve("D")
    assert len(d8.calls) == n


def test_D8d_a_request_that_finds_the_refresh_running_waits_for_it(d8, monkeypatch):
    import threading
    from api.services.cache import cache
    d8.seed("5", S5_STORED, _d8_et(9, 54))
    d8.clock.now = _d8_et(9, 56, 35)
    entered, release, b_waiting = threading.Event(), threading.Event(), threading.Event()
    vendor_reads = []

    def slow_refresh(sym, tf):                             # request A holds the refresh until released
        vendor_reads.append((sym, tf))
        entered.set()
        release.wait(5)
        cache.set(f"idxbars_{sym}_{tf}", {"saved_at": d8.clock.now, "series": list(S5_FRESH), "proxy": False},
                  ttl=3600)
        return list(S5_FRESH)

    monkeypatch.setattr(index_bars, "_refresh", slow_refresh)
    real_wait = getattr(index_bars, "_await_refresh", None)

    def watched_wait(*a, **k):                             # B is parked on A's refresh
        b_waiting.set()
        return real_wait(*a, **k)

    monkeypatch.setattr(index_bars, "_await_refresh", watched_wait, raising=False)
    results = {}

    def serve_into(name):
        results[name] = d8.serve()

    a = threading.Thread(target=serve_into, args=("a",))
    a.start()
    try:
        assert entered.wait(5), "the first request at the boundary never asked the vendor"
        b = threading.Thread(target=serve_into, args=("b",))
        b.start()
        b_waiting.wait(2)                                  # without the wait, B has already answered by now
    finally:
        release.set()
    a.join(5)
    b.join(5)
    assert vendor_reads == [("SPX", "5")]                  # ONE vendor read served both requests
    assert results["a"]["bars"][-1]["t"] == _d8_et(9, 55)
    assert results["b"]["bars"][-1]["t"] == _d8_et(9, 55), "the second request answered the withheld tail"


# -- D9 (2026-11-20, production re-probe): a refresh that came back WITHOUT the bar now forming -----------------------
# After D8 shipped, the tier's 1m refresh at 18:36:01Z got a series whose newest bar was 18:35. The vendor had not
# published the 18:36 bar one second into the minute. A signed-in probe saw the same at 13:36 ET: newest stuck at 13:35
# from 13:36:08 to 13:37:59, 1 then 2 bars behind, until the 120 s TTL ran out.
# That copy's newest bar had already ENDED when it was stored, so D8's rule correctly does not fire (D7c). A copy is
# ALSO stale once the bar AFTER its newest has ended since it was stored, and only inside that bar's session.

def _d9_ones(first_hm, last_hm):
    out, t, stop = [], _d8_et(*first_hm), _d8_et(*last_hm)
    while t <= stop:
        out.append(_d7_row(t, 7300.0 + (t - _d8_et(9, 30)) / 60.0))
        t += 60
    return out


def test_D9a_a_copy_that_never_held_a_bar_is_refreshed_once_that_bar_has_ended(d8):
    lagged = _d9_ones((13, 20), (13, 35))                  # stored 13:36:01: the vendor had no 13:36 bar yet
    d8.seed("1", lagged, _d8_et(13, 36, 1))
    d8.vendor["rows"] = _d9_ones((13, 20), (13, 37))
    d8.clock.now = _d8_et(13, 36, 8)                       # CONTROL: the 13:36 bar is still forming, nothing to ask for
    first = d8.serve("1")
    assert first["bars"][-1]["t"] == _d8_et(13, 35) and d8.calls == []
    d8.clock.now = _d8_et(13, 36, 30)                      # CONTROL: still forming
    assert d8.serve("1")["bars"][-1]["t"] == _d8_et(13, 35) and d8.calls == []
    d8.clock.now = _d8_et(13, 37, 14)                      # the 13:36 bar ended at 13:37:00; the copy never held it
    second = d8.serve("1")
    assert d8.calls == [("SPX", "1")], "a copy missing a whole ended bar was answered until its TTL ran out"
    assert second["bars"][-1]["t"] == _d8_et(13, 37)


def test_D9b_never_outside_the_session(d8):
    closing = _d9_ones((15, 40), (15, 59))                 # 15:59 is the session's last 1m bar
    d8.seed("1", closing, _d8_et(16, 0, 1))
    d8.clock.now = _d8_et(16, 1, 30)                       # no 16:00 bar exists to wait for: the session is over
    got = d8.serve("1")
    assert got["bars"][-1]["t"] == _d8_et(15, 59) and d8.calls == [], "a refresh was asked for a bar after the close"
    d8.seed("5", _d8_fives((15, 55)), _d8_et(16, 0, 2))     # the 5m twin: 15:55 ends at the close
    d8.clock.now = _d8_et(16, 4)
    got = d8.serve("5")
    assert got["bars"][-1]["t"] == _d8_et(15, 55) and d8.calls == []
