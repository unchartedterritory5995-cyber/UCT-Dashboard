"""Chart-data monitor — the pure checks (frontier math across DST / half-days, grid, OHLC,
gaps, latency, serve-label budget, stream-vs-REST). No network."""
from __future__ import annotations

from datetime import date

import pytest

from api.services.bar_rollup import tv_bucket_bounds
from api.services.chart_monitor import checks as C

ET = C.ET


def at(d: date, hh: int, mm: int, ss: int = 0) -> int:
    return C.et_epoch(d, hh * 60 + mm) + ss


WED = date(2026, 11, 11)          # ordinary trading day (EST, after the Nov-1 switch)
THU_HOL = date(2026, 11, 26)      # Thanksgiving
HALF = date(2026, 11, 27)         # half-day, 13:00 close
SUMMER = date(2026, 7, 15)        # EDT
DST_MON = date(2026, 11, 2)       # first session after DST ended (Sun Nov 1)
FRI_BEFORE = date(2026, 10, 30)   # last EDT session


# ───────────────────────────── grid: the serving owner, never a second copy

@pytest.mark.parametrize("d", [WED, HALF, SUMMER, DST_MON])
@pytest.mark.parametrize("tf,sess", [("1", "eth"), ("5", "eth"), ("15", "eth"), ("30", "eth"),
                                     ("60", "rth"), ("60", "eth")])
def test_INVARIANT_day_buckets_tile_the_session_and_agree_with_tv_bucket_bounds(d, tf, sess):
    """Every minute of [04:00, 20:00) lies in exactly one bucket, buckets are contiguous and
    ordered, and each start is exactly what the serving helper says."""
    b = C.day_buckets(d, tf, sess)
    assert b[0][0] == at(d, 4, 0) and b[-1][1] == at(d, 20, 0)
    for (s0, e0), (s1, _e1) in zip(b, b[1:]):
        assert e0 == s1 and s0 < e0
    for s, e in b:
        assert tv_bucket_bounds(s * 1000, tf, sess)[0] // 1000 == s
        assert C.on_grid(s, tf, sess)
    # every minute maps into the bucket list
    starts = {s for s, _ in b}
    t = at(d, 4, 0)
    while t < at(d, 20, 0):
        assert tv_bucket_bounds(t * 1000, tf, sess)[0] // 1000 in starts
        t += 60 * 7


def test_60m_rth_grid_is_tradingview_and_half_day_truncates():
    starts = [C.et_dt(s).strftime("%H:%M") for s, _ in C.day_buckets(WED, "60", "rth")]
    assert starts[5:13] == ["09:00", "09:30", "10:30", "11:30", "12:30", "13:30", "14:30", "15:30"]
    half = {C.et_dt(s).strftime("%H:%M"): (e - s) // 60 for s, e in C.day_buckets(HALF, "60", "rth")}
    assert half["12:30"] == 30 and "13:00" in half and "13:30" not in half
    rth = C.rth_buckets(HALF, "60", "rth")
    assert C.et_dt(rth[-1][1]).strftime("%H:%M") == "13:00"


def test_grid_check_flags_mid_bucket_and_seconds_stamps():
    good = [s for s, _ in C.day_buckets(WED, "5", "eth")][:50]
    assert C.check_grid(good, "5").status == C.PASS
    bad = good + [at(WED, 16, 35, 50)]
    v = C.check_grid(bad, "5")
    assert v.status == C.FAIL and "off_grid=1" in v.detail
    # 60m: a :30 start is on the rth grid only inside RTH; 10:00 is an eth (clock) start
    assert C.on_grid(at(WED, 10, 30), "60", "rth") and not C.on_grid(at(WED, 10, 0), "60", "rth")
    assert C.on_grid(at(WED, 10, 0), "60", "eth") and not C.on_grid(at(WED, 10, 30), "60", "eth")


def test_dst_switch_keeps_the_grid_on_et_wall_clock():
    """The 09:30 bucket is 09:30 ET on both sides of the Nov-1 switch (UTC moves by an hour)."""
    a = C.rth_buckets(FRI_BEFORE, "60", "rth")[0][0]
    b = C.rth_buckets(DST_MON, "60", "rth")[0][0]
    assert C.et_dt(a).strftime("%H:%M") == C.et_dt(b).strftime("%H:%M") == "09:30"
    assert (a % 86400) != (b % 86400)


# ───────────────────────────── frontier

def test_frontier_mid_rth_is_the_bucket_containing_now_minus_grace():
    now = at(WED, 10, 7, 30)
    fr = C.frontier(now, "5", "eth", grace=90)
    assert C.et_str(fr.expected_start).endswith("10:05")
    assert C.et_str(fr.developing_start).endswith("10:05")
    fr1 = C.frontier(at(WED, 10, 0, 30), "1", "eth", grace=90)
    assert C.et_str(fr1.expected_start).endswith("09:59")   # bucket containing now-grace


def test_frontier_before_premarket_is_previous_sessions_last_bucket():
    fr = C.frontier(at(WED, 3, 0), "15", "eth")
    assert fr.session_day == date(2026, 11, 10)
    assert C.et_str(fr.expected_start) == "2026-11-10 19:45"
    assert fr.developing_start is None


def test_frontier_skips_holiday_and_weekend():
    fr = C.frontier(at(THU_HOL, 11, 0), "60", "rth")
    assert fr.session_day == date(2026, 11, 25)
    assert C.et_str(fr.expected_start) == "2026-11-25 19:00"
    sat = date(2026, 11, 14)
    assert C.frontier(at(sat, 12, 0), "1").session_day == date(2026, 11, 13)


def test_frontier_half_day_after_close_is_post_market_bucket():
    fr = C.frontier(at(HALF, 13, 20), "60", "rth", grace=90)
    assert C.et_str(fr.expected_start).endswith("13:00")
    assert C.phase_at(at(HALF, 13, 20)) == "post"


def test_frontier_60m_rth_mid_morning_counts_the_0930_bucket():
    fr = C.frontier(at(WED, 10, 45), "60", "rth")
    assert C.et_str(fr.expected_start).endswith("10:30")
    fr2 = C.frontier(at(WED, 10, 45), "60", "eth")
    assert C.et_str(fr2.expected_start).endswith("10:00")


def test_bucket_lag_counts_across_the_overnight_boundary():
    fr = C.frontier(at(WED, 9, 40), "5", "eth")
    yday_last = at(date(2026, 11, 10), 19, 55)
    lag = C.bucket_lag(fr, yday_last)
    # 04:00 .. 09:35 today = 68 buckets after yesterday's 19:55
    assert lag == 68
    assert C.bucket_lag(fr, fr.expected_start) == 0
    assert C.bucket_lag(fr, at(date(2026, 11, 2), 10, 0)) > 192 + 68  # older than both days


# ───────────────────────────── tail / freshness

def test_tail_within_one_bucket_passes_and_two_behind_fails():
    now = at(WED, 11, 2, 0)
    fr = C.frontier(now, "15", "eth")
    assert C.check_tail(now, "15", fr.expected_start).status == C.PASS
    assert C.check_tail(now, "15", fr.expected_start - 900).status == C.PASS
    v = C.check_tail(now, "15", fr.expected_start - 1800)
    assert v.status == C.FAIL and "lag=2bkt" in v.detail


def test_tail_four_hours_stale_fails_and_names_no_price():
    now = at(WED, 14, 0)
    v = C.check_tail(now, "15", at(WED, 10, 0))
    assert v.status == C.FAIL
    assert "lag=" in v.detail and "$" not in v.detail


def test_tail_tolerances_thin_and_quiet_extended_minutes_warn_not_fail():
    now = at(WED, 7, 10)
    fr = C.frontier(now, "1", "eth")
    assert C.check_tail(now, "1", fr.expected_start - 180).status == C.WARN   # quiet pre-market
    assert C.check_tail(now, "1", fr.expected_start - 1200).status == C.FAIL
    assert C.check_tail(at(WED, 14, 0), "15", at(WED, 10, 0), thin=True).status == C.WARN


def test_tail_future_bar_fails():
    now = at(WED, 11, 0)
    assert C.check_tail(now, "5", at(WED, 11, 30)).status == C.FAIL


def test_tail_on_dst_monday_premarket_uses_friday_last_bucket():
    now = at(DST_MON, 3, 30)
    v = C.check_tail(now, "60", at(FRI_BEFORE, 19, 0), session="eth")
    assert v.status == C.PASS


def test_daily_tail_expected_date_rules():
    # pre-open: previous trading day; after open: today; holiday: the day before
    assert C.expected_daily_date(at(WED, 8, 0)) == date(2026, 11, 10)
    assert C.expected_daily_date(at(WED, 10, 0)) == WED
    assert C.expected_daily_date(at(THU_HOL, 12, 0)) == date(2026, 11, 25)
    assert C.check_daily_tail(at(WED, 10, 0), "2026-11-11").status == C.PASS
    v = C.check_daily_tail(at(WED, 10, 0), "2026-11-09")
    assert v.status == C.FAIL and "behind=2d" in v.detail
    assert C.check_daily_tail(at(WED, 10, 0), "2026-11-12").status == C.FAIL
    assert C.check_daily_tail(at(WED, 10, 0), "2026-11-09", thin=True).status == C.WARN


def test_tail_status_honest_unverified_must_heal():
    assert C.check_tail_status("current", None).status == C.PASS
    assert C.check_tail_status("unverified", "current").status == C.PASS
    assert C.check_tail_status("unverified", "unverified").status == C.FAIL
    assert C.check_tail_status("unverified", None).status == C.FAIL


# ───────────────────────────── OHLC / dup / forming / gaps

def test_ohlc_sanity():
    ok = [{"t": 1, "o": 10, "h": 11, "l": 9, "c": 10.5, "v": 5}]
    assert C.check_ohlc(ok).status == C.PASS
    assert C.check_ohlc([{"t": 1, "o": 10, "h": 9, "l": 8, "c": 9}]).status == C.FAIL
    assert C.check_ohlc([{"t": 1, "o": None, "h": 9, "l": 8, "c": 9}]).status == C.FAIL
    assert C.check_ohlc([{"t": 1, "o": float("nan"), "h": 9, "l": 8, "c": 9}]).status == C.FAIL
    assert C.check_ohlc([{"t": 1, "o": 9, "h": 9, "l": 8, "c": 9, "v": -1}]).status == C.FAIL


def test_dup_and_unsorted():
    assert C.check_dup_sorted([1, 2, 3]).status == C.PASS
    assert C.check_dup_sorted([1, 2, 2]).status == C.FAIL
    assert C.check_dup_sorted([1, 3, 2]).status == C.FAIL


def test_forming_flag_rth_only():
    now = at(WED, 10, 7)
    dev = C.frontier(now, "5").developing_start
    assert C.check_forming(now, "5", dev, True).status == C.PASS
    assert C.check_forming(now, "5", dev, False).status == C.WARN
    assert C.check_forming(now, "5", dev - 300, True).status == C.WARN
    assert C.check_forming(at(WED, 17, 0), "5", dev, False).status == C.SKIP


def _rth_series(d, tf, upto, drop=()):
    return [s for s, e in C.day_buckets(d, tf, "eth") if e <= upto and s not in drop]


def test_rth_gaps_today_and_tolerances():
    now = at(WED, 12, 0)
    full = _rth_series(WED, "5", now)
    assert C.check_rth_gaps(now, "5", full, WED).status == C.PASS
    hole = [at(WED, 10, 0), at(WED, 10, 5), at(WED, 10, 10)]
    v = C.check_rth_gaps(now, "5", _rth_series(WED, "5", now, drop=hole), WED)
    assert v.status == C.FAIL and "missing=3/" in v.detail and "max_run=3bkt" in v.detail
    one = _rth_series(WED, "1", now, drop=(at(WED, 10, 0),))
    assert C.check_rth_gaps(now, "1", one, WED).status == C.WARN      # single 1m hole
    assert C.check_rth_gaps(now, "5", _rth_series(WED, "5", now, drop=hole), WED,
                            thin=True).status == C.PASS                 # thin, 15 min run
    assert C.check_rth_gaps(at(WED, 9, 0), "5", full, WED).status == C.SKIP


def test_rth_gaps_half_day_ignores_afternoon():
    now = at(HALF, 15, 0)
    s = _rth_series(HALF, "15", now)
    v = C.check_rth_gaps(now, "15", s, HALF)
    assert v.status == C.PASS and "/14 " in v.detail + " "    # 09:30..12:45 = 14 buckets


def test_missing_days_detects_a_whole_session_hole():
    now = at(WED, 12, 0)
    d1, d2 = date(2026, 11, 9), date(2026, 11, 10)
    ts = _rth_series(d1, "5", at(d1, 20, 0)) + _rth_series(WED, "5", now)
    v = C.check_missing_days(now, ts)
    assert v.status == C.FAIL and str(d2) in v.detail
    ts_ok = ts + _rth_series(d2, "5", at(d2, 20, 0))
    assert C.check_missing_days(now, sorted(ts_ok)).status == C.PASS
    # holiday is not a missing day
    ts_h = _rth_series(date(2026, 11, 25), "5", at(date(2026, 11, 25), 20, 0)) + \
        _rth_series(HALF, "5", at(HALF, 12, 0))
    assert C.check_missing_days(at(HALF, 12, 0), ts_h).status == C.PASS


def test_daily_grid_rejects_weekend_and_holiday_dates():
    assert C.check_daily_grid(["2026-11-24", "2026-11-25", "2026-11-27"]).status == C.PASS
    assert C.check_daily_grid(["2026-11-25", "2026-11-26"]).status == C.FAIL
    assert C.check_daily_grid(["2026-11-14"]).status == C.FAIL


# ───────────────────────────── latency + label budget

def test_latency_p90_budget():
    assert C.check_latency([100] * 20, 3000).status == C.PASS
    assert C.check_latency([100] * 17 + [5000] * 3, 3000).status == C.FAIL   # p90 is the 18th
    assert C.check_latency([100] * 18 + [5000] * 2, 3000).status == C.PASS
    assert C.check_latency([9000] * 3, 3000).status == C.SKIP


def test_label_window_budget_and_expiry():
    w = C.LabelWindow(window_s=1800)
    for i in range(80):
        w.add(1000 + i, "sd-deadline" if i % 4 == 0 else "hot")
    v = C.check_label_budget(w.counts(1100), 0.15)
    assert v.status == C.FAIL and "degraded=20/80" in v.detail
    assert C.check_label_budget(w.counts(1100), 0.30).status == C.PASS
    assert C.check_label_budget(w.counts(1000 + 1800 + 200), 0.15).status == C.SKIP  # expired
    assert C.check_label_budget({"hot": 5}, 0.15).status == C.SKIP


def test_server_timing_desc_parse():
    assert C.server_timing_desc('bars;desc="stale-swr";dur=12.0') == "stale-swr"
    assert C.server_timing_desc('edge;dur=3, bars;desc="hot";dur=1') == "hot"
    assert C.server_timing_desc(None) is None


# ───────────────────────────── stream vs REST

def test_stream_vs_rest_relative_tolerance():
    a = {"o": 100.0, "h": 101.0, "l": 99.0, "c": 100.5, "v": 1000}
    same = dict(a)
    assert not C.compare_stream_rest(a, same)["price_mismatch"]
    off = dict(a, c=100.6)
    r = C.compare_stream_rest(a, off)
    assert r["price_mismatch"] and r["fields"] == ["c"]
    vol = dict(a, v=1100)
    r2 = C.compare_stream_rest(a, vol)
    assert r2["vol_mismatch"] and not r2["price_mismatch"]
    assert C.compare_stream_rest(a, None)["row_missing"]
    assert C.check_stream_vs_rest([r]).status == C.FAIL
    assert C.check_stream_vs_rest([r2]).status == C.WARN
    assert C.check_stream_vs_rest([C.compare_stream_rest(a, same)]).status == C.PASS
    assert C.check_stream_vs_rest([C.compare_stream_rest(a, None)]).status == C.FAIL
    assert C.check_stream_vs_rest([]).status == C.SKIP
