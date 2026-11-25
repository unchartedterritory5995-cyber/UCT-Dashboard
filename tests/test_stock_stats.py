"""STAT, stock statistics (api/services/stock_stats_calc.py, api/services/stock_stats.py,
api/routers/stock_stats.py, price_reads.daily_bars). Every price, volume, date and symbol here is
INVENTED.

  * each definition on invented series: ATR (the chart's Wilder ATR over the Screener's 400
    sessions), realized volatility (the shared estimator), ADR / 52-week range / relative volume
    (the Screener's own numbers), average volume (a missing volume is no average), up and down days;
  * beta and correlation (the declared Beta methodology: aligned days, 252 returns, 200 needed),
    up and down capture;
  * returns (calendar windows, the last close on or before, a hole is not a base, YTD, the yearly
    rate), best and worst day and week (dates, ties, the unfinished week, a missing week, the mark);
  * its own drawdowns (MKTH's finder and line: exactly 20%, a double bottom, one never recovered);
  * every market correction (MKTH's episodes only: its drawdown inside the index window, against
    the index, back to its high first, the 3 months after, an episode before its history);
  * the reads: one store read per stock, closes up to the session only, the benchmarks once per
    session for everyone, the sector from the read-only map, MKTH's answer without waiting;
  * the held answers: per symbol per session, MKTH's change, a lagging stock, a failed read never
    held, the cap, one build per symbol, the slot bound;
  * the route: one paid GET, 401 / 402 / 400, its own gate, a plain def, mounted.
"""
from __future__ import annotations

import math
import pathlib
import threading
import time
from datetime import date, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import stock_stats as route
from api.services import indicator_compute
from api.services import market_history_calc as MH
from api.services import stock_stats as S
from api.services import stock_stats_calc as C
from api.services.fundamentals_pit import beta as BETA
from api.services.market_intel import price_reads
from api.services.realized_vol import annualized_hv
from api.services.screener import technicals

ROOT = pathlib.Path(__file__).resolve().parents[1]
FREE_USER = {"id": "sts-free", "email": "free@example.test", "role": "member", "plan": "free"}
PAID_USER = {"id": "sts-paid", "email": "paid@example.test", "role": "member", "plan": "pro"}
_REAL_GROUPS = S._groups          # taken before any fixture stubs it


def weekdays(start: str, n: int) -> list[str]:
    d, out = date.fromisoformat(start), []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def weekdays_ending(end: str, n: int) -> list[str]:
    d, out = date.fromisoformat(end), []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d -= timedelta(days=1)
    return out[::-1]


def closes_on(days, values):
    return [(d, float(v)) for d, v in zip(days, values)]


def bars_from(closes, spread=0.02, vol=1_000_000.0):
    """OHLCV around each close: open at the close before it, high / low `spread` around."""
    out, prev = [], None
    for d, c in closes:
        o = prev if prev is not None else c
        out.append((d, o, max(o, c) * (1 + spread), min(o, c) * (1 - spread), c, vol))
        prev = c
    return out


def wave(n, start=100.0, amp=0.03, seed=1):
    """A deterministic wiggly invented series (no randomness)."""
    out, x = [], start
    for i in range(n):
        x *= 1 + amp * math.sin(i * 0.7 + seed) * math.cos(i * 0.13)
        out.append(round(x, 4))
    return out


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    S.reset_for_tests()
    monkeypatch.setattr(S, "_groups", lambda sym: {})
    monkeypatch.setattr(S, "_is_trading_day", lambda d: d.weekday() < 5)
    # Speed pass 2 (2026-11-24): a request never builds; it answers `computing` while the stock's one background
    # build runs (`tests/test_terminal_speed_pass2.py` proves that with the module's own WAIT_S of 0). These tests
    # prove what the build works out, holds and reads, so each request here waits for the build it started.
    monkeypatch.setattr(S, "WAIT_S", 10.0)
    yield
    S.drain_for_tests()
    S.reset_for_tests()


# ── 1. volatility and range ────────────────────────────────────────────────────────────────────

def test_clean_bars_keeps_positive_finite_bars_and_never_turns_a_missing_volume_into_zero():
    rows = [("2031-01-07", 10, 11, 9, 10.5, 100), ("2031-01-06", 10, 11, 9, 10, True),
            ("2031-01-08", 10, 9, 11, 10, 5), ("2031-01-09", 10, 11, 9, float("nan"), 5),
            ("2031-01-10", 10, 11, 9, 10, float("nan")), ("bad", 1, 1, 1, 1, 1), ("2031-01-12", 0, 1, 1, 1, 1),
            ("2031-01-07", 10, 12, 9, 11.0, 200)]
    got = C.clean_bars(rows)
    assert [r[0] for r in got] == ["2031-01-06", "2031-01-07", "2031-01-10"]
    assert got[0][5] is None and got[2][5] is None                      # a bool and a NaN volume are absent, not 0
    assert got[1] == ("2031-01-07", 10.0, 12.0, 9.0, 11.0, 200)         # a duplicate date keeps the last


def test_the_atr_is_the_charts_wilder_atr_over_the_screeners_400_sessions():
    closes = closes_on(weekdays("2029-01-01", 520), wave(520))
    bars = bars_from(closes)
    got = C.volatility(bars)["atr"]
    dicts = [{"t": d, "o": o, "h": h, "l": lo, "c": c} for d, o, h, lo, c, _v in bars]
    want = indicator_compute.compute_atr_raw(dicts[-400:], 14)[-1]
    short = indicator_compute.compute_atr_raw(dicts[-30:], 14)[-1]
    assert round(want, 4) != round(short, 4)                            # Wilder's seed matters on a short window (the control)
    assert got == {"state": "ok", "period": 14, "value": round(want, 4), "pct": round(want / closes[-1][1] * 100, 2)}
    tech = technicals.compute_technicals(dicts[-400:])
    assert got["pct"] == tech["atr_pct"]                                # the Screener's atr_pct, by construction


def test_too_little_history_is_words_never_zero():
    closes = closes_on(weekdays("2031-01-06", 14), wave(14))
    v = C.volatility(bars_from(closes))
    assert v["atr"] == {"state": "short", "needed": 15, "held": 14, "unit": "sessions"}
    assert v["realized"][0] == {"state": "short", "needed": 21, "held": 14, "unit": "sessions", "sessions": 20}
    assert v["adr"]["state"] == "short" and v["range_52w"]["state"] == "short"
    assert v["volume"]["avg"] == {"20": None, "50": None} and v["volume"]["rel"] is None
    assert v["days_1y"]["state"] == "short"


def test_realized_volatility_is_the_shared_estimator_over_20_and_60_returns():
    closes = closes_on(weekdays("2030-01-01", 80), wave(80))
    v = C.volatility(bars_from(closes))
    cl = [c for _d, c in closes]
    assert v["realized"] == [
        {"state": "ok", "sessions": 20, "pct": round(annualized_hv(cl[-21:]) * 100, 1)},
        {"state": "ok", "sessions": 60, "pct": round(annualized_hv(cl[-61:]) * 100, 1)},
    ]


def test_adr_52_weeks_and_relative_volume_are_the_screeners_numbers():
    closes = closes_on(weekdays("2030-01-01", 300), wave(300))
    bars = [(d, o, h, lo, c, 1000.0 + i) for i, (d, o, h, lo, c, _v) in enumerate(bars_from(closes))]
    bars[-1] = bars[-1][:5] + (5000.0,)
    v = C.volatility(bars)
    dicts = [{"t": d, "o": o, "h": h, "l": lo, "c": c, "v": vol} for d, o, h, lo, c, vol in bars]
    tech = technicals.compute_technicals(dicts)
    assert v["adr"]["pct"] == tech["adr_pct"]
    assert v["adr"]["dollars"] == round(sum(b[2] - b[3] for b in bars[-21:]) / 21, 4)
    yr = bars[-252:]
    hi, lo = max(b[2] for b in yr), min(b[3] for b in yr)
    assert (v["range_52w"]["high"], v["range_52w"]["low"]) == (round(hi, 4), round(lo, 4))
    assert v["range_52w"]["from_high_pct"] == tech["dist_52w_high_pct"] == round((closes[-1][1] - hi) / hi * 100, 2)
    prior = [b[5] for b in bars[-31:-1]]
    assert v["volume"]["rel"] == round(5000.0 / (sum(prior) / 30), 2)
    assert v["volume"]["avg"] == {"20": round(sum(b[5] for b in bars[-20:]) / 20), "50": round(sum(b[5] for b in bars[-50:]) / 50)}
    assert v["volume"]["last"] == 5000 and v["volume"]["last_date"] == closes[-1][0]


def test_a_missing_volume_inside_the_window_means_no_average_not_a_smaller_one():
    closes = closes_on(weekdays("2030-01-01", 60), wave(60))
    bars = bars_from(closes)
    bars[-5] = bars[-5][:5] + (None,)
    v = C.volatility(bars)["volume"]
    assert v["avg"] == {"20": None, "50": None}


def test_up_and_down_days_count_the_last_year_and_a_flat_day_is_neither():
    days = weekdays_ending("2031-06-02", 300)
    vals, x = [], 50.0
    for i in range(300):
        x = x if i % 10 == 0 else (x * 1.01 if i % 3 else x * 0.99)
        vals.append(round(x, 6))
    v = C.volatility(bars_from(closes_on(days, vals)))["days_1y"]
    start = "2030-06-02"
    rets = [(days[i], vals[i] / vals[i - 1] - 1) for i in range(1, 300) if days[i] > start]
    up, down = sum(1 for _d, r in rets if r > 0), sum(1 for _d, r in rets if r < 0)
    assert v == {"state": "ok", "from": start, "total": len(rets), "up": up, "down": down, "flat": len(rets) - up - down,
                 "up_pct": round(up / len(rets) * 100, 1), "down_pct": round(down / len(rets) * 100, 1)}
    assert v["flat"] > 0


# ── 2. beta and correlation ────────────────────────────────────────────────────────────────────

def test_beta_is_the_declared_methodology_and_correlation_rides_the_same_returns():
    days = weekdays("2030-01-01", 320)
    bench = closes_on(days, wave(320, 400.0, 0.01, 3))
    stock = closes_on(days, wave(320, 20.0, 0.025, 5))
    got = C.beta_block(stock, bench, capture=True)
    stored = BETA.rolling_beta(stock, bench)[-1][1]
    assert got["beta"] == round(stored, 3) and got["returns"] == 252
    rets = BETA.aligned_returns(stock, bench)[-252:]
    rs, rb = [r[1] for r in rets], [r[2] for r in rets]
    ms, mb = sum(rs) / 252, sum(rb) / 252
    corr = sum((a - ms) * (b - mb) for a, b in zip(rs, rb)) / math.sqrt(sum((a - ms) ** 2 for a in rs) * sum((b - mb) ** 2 for b in rb))
    assert got["correlation"] == round(corr, 3)


def test_a_stock_that_moves_twice_the_benchmark_has_beta_2_correlation_1_and_captures_200():
    days = weekdays("2030-01-01", 300)
    b_vals = wave(300, 100.0, 0.01, 2)
    s_vals, x = [], 50.0
    for i in range(300):
        if i:
            x *= 1 + 2 * (b_vals[i] / b_vals[i - 1] - 1)
        s_vals.append(x)
    got = C.beta_block(closes_on(days, s_vals), closes_on(days, b_vals), capture=True)
    assert (got["beta"], got["correlation"], got["up_capture"], got["down_capture"]) == (2.0, 1.0, 200.0, 200.0)


def test_a_day_missing_on_either_side_is_never_a_zero_return_and_too_few_returns_is_words():
    days = weekdays("2030-01-01", 300)
    bench = closes_on(days, wave(300, 100.0, 0.01, 2))
    stock = closes_on(days, wave(300, 30.0, 0.02, 4))
    holed = [p for i, p in enumerate(stock) if i % 2 == 0]              # the stock holds every other day
    assert C.beta_block(holed, bench) == {"state": "short", "needed": 200, "held": 149, "unit": "returns"}
    assert C.beta_block(stock[:150], bench)["state"] == "short"


# ── 3. returns ─────────────────────────────────────────────────────────────────────────────────

def _by_key(rows):
    return {r["key"]: r for r in rows}


def test_each_return_is_from_the_last_close_on_or_before_its_calendar_day():
    days = weekdays("2025-01-01", 1700)                                 # through about Jul 2031
    vals = [100 + i * 0.1 for i in range(1700)]
    closes = closes_on(days, vals)
    last_d, last_c = closes[-1]
    rows = _by_key(C.period_returns(closes))
    last = date.fromisoformat(last_d)
    for key, back in (("1W", last - timedelta(days=7)), ("1M", MH.add_months(last, -1)), ("1Y", MH.add_months(last, -12))):
        base = [(d, c) for d, c in closes if d <= back.isoformat()][-1]
        assert rows[key]["from"] == base[0], key
        assert rows[key]["return_pct"] == round((last_c / base[1] - 1) * 100, 2), key
    ytd = [(d, c) for d, c in closes if d <= f"{last.year - 1}-12-31"][-1]
    assert rows["YTD"]["from"] == ytd[0] and rows["YTD"]["return_pct"] == round((last_c / ytd[1] - 1) * 100, 2)
    r3 = rows["3Y"]
    assert r3["yearly_pct"] == round(((last_c / r3["base_close"]) ** (12 / 36) - 1) * 100, 2)
    assert "yearly_pct" not in rows["1Y"]


def test_a_sunday_day_rolls_back_to_the_friday_and_history_too_short_is_words():
    closes = [("2031-05-30", 50.0), ("2031-07-01", 60.0)]               # Jun 1 2031 is a Sunday
    rows = _by_key(C.period_returns(closes))
    assert rows["1M"] == {"key": "1M", "label": "1 month", "target": "2031-06-01", "state": "ok", "from": "2031-05-30",
                          "base_close": 50.0, "return_pct": 20.0}
    assert rows["5Y"] == {"key": "5Y", "label": "5 years", "target": "2026-07-01", "state": "short",
                          "needed_from": "2026-07-01", "held_from": "2031-05-30"}


def test_a_hole_longer_than_ten_days_before_the_day_is_short_and_ten_days_is_a_base():
    closes = [("2031-01-02", 50.0), ("2031-05-30", 60.0), ("2031-06-30", 66.0)]
    rows = _by_key(C.period_returns(closes))
    assert rows["1M"]["state"] == "ok" and rows["1M"]["from"] == "2031-05-30"
    assert rows["3M"]["state"] == "short"                               # Mar 30: the last close is 87 days before
    closes = [("2031-05-19", 50.0), ("2031-06-30", 66.0)]
    assert _by_key(C.period_returns(closes))["1M"]["state"] == "short"   # May 30: May 19 is 11 days before
    closes = [("2031-05-20", 50.0), ("2031-06-30", 66.0)]
    assert _by_key(C.period_returns(closes))["1M"] == {                  # May 20 is 10 days before: a base
        "key": "1M", "label": "1 month", "target": "2031-05-30", "state": "ok", "from": "2031-05-20",
        "base_close": 50.0, "return_pct": 32.0}


def test_a_stock_listed_this_year_has_no_ytd():
    closes = closes_on(weekdays("2031-01-06", 60), [10 + i for i in range(60)])
    assert _by_key(C.period_returns(closes))["YTD"]["state"] == "short"


def test_best_and_worst_day_and_week_with_their_dates_and_ties_go_to_the_earlier():
    days = weekdays("2031-01-06", 40)                                   # Jan 6 2031 is a Monday
    vals = [100.0] * 3 + [125.0] * 10 + [80.0] * 10 + [100.0] * 17     # +25% on day 3, -36% on day 13, +25% on day 23
    ex = C.extremes(closes_on(days, vals), [], True)
    allb = ex["all"]
    assert allb["best_day"] == {"date": days[3], "return_pct": 25.0, "check": False}       # the tie: the earlier
    assert allb["worst_day"] == {"date": days[13], "return_pct": -36.0, "check": False}
    # the first week has no week before it; the week of day 23 (Feb 3 to 7) is +25% on the week before it
    assert allb["best_week"] == {"date": days[24], "return_pct": 25.0, "check": False, "from": days[20]}
    assert allb["worst_week"] == {"date": days[14], "return_pct": -36.0, "check": False, "from": days[10]}
    assert ex["year"]["state"] == "short"


def test_the_unfinished_newest_week_is_left_out_and_a_week_after_a_missing_week_is_skipped():
    days = weekdays("2031-01-06", 12)                                   # two weeks and two days
    vals = [100, 100, 100, 100, 100, 100, 100, 100, 100, 101, 200, 200]
    w = C.weekly_returns(closes_on(days, vals), last_week_complete=False)
    assert [r[0] for r in w] == [days[9]]
    w2 = C.weekly_returns(closes_on(days, vals), last_week_complete=True)
    assert [r[0] for r in w2] == [days[9], days[11]]
    holed = [p for p in closes_on(days, vals) if not (days[5] <= p[0] <= days[9])]
    assert C.weekly_returns(holed, True) == []


def test_week_complete_reads_the_calendar_a_holiday_friday_ends_the_week_on_thursday():
    holiday = date(2031, 4, 11)
    cal = lambda d: d.weekday() < 5 and d != holiday                    # noqa: E731
    assert C.week_complete("2031-04-10", cal) is True
    assert C.week_complete("2031-04-09", cal) is False
    assert C.week_complete("2031-04-04", lambda d: d.weekday() < 5) is True


def test_a_move_of_more_than_40_percent_in_one_session_is_marked():
    days = weekdays("2031-01-06", 15)
    vals = [100.0] * 7 + [50.0] * 8
    closes = closes_on(days, vals)
    jumps = C.jumps_of(closes)
    assert jumps == [days[7]]
    ex = C.extremes(closes, jumps, True)
    assert ex["all"]["worst_day"] == {"date": days[7], "return_pct": -50.0, "check": True}
    assert ex["all"]["worst_week"]["check"] is True
    assert C.jumps_of(closes_on(days, [100.0] * 7 + [61.0] * 8)) == []


# ── 4. its own drawdowns ───────────────────────────────────────────────────────────────────────

def test_drawdowns_are_mkth_declines_of_20_percent_or_more_and_exactly_20_counts():
    vals = [100, 110, 95, 111, 88.8, 112, 101, 112.5, 60, 70, 90]       # 13.6% (no), exactly 20% (yes), 46.7% ongoing
    closes = closes_on(weekdays("2031-01-06", len(vals)), vals)
    dd = C.drawdowns(closes, "ZZQA", [])
    assert [(e["peak"]["close"], e["trough"]["close"], e["depth_pct"], e["ongoing"]) for e in dd["episodes"]] == [
        (112.5, 60.0, -46.67, True), (111.0, 88.8, -20.0, False)]
    assert dd["episodes"][0]["below_peak_now_pct"] == -20.0 and dd["episodes"][0]["recovered"] is None
    assert dd["episodes"][1]["recovered"] == closes[5][0] and dd["episodes"][1]["sessions_to_recover"] == 1
    assert dd["total"] == 2 and dd["ongoing"] == 1 and dd["recovered"] == 1
    assert dd["deepest"]["depth_pct"] == -46.67
    assert dd["high"] == {"date": closes[7][0], "close": 112.5, "from_high_pct": -20.0}
    just_short = closes_on(weekdays("2031-01-06", 3), [100, 80.01, 101])
    assert C.drawdowns(just_short, "ZZQA", [])["total"] == 0


def test_a_double_bottom_is_one_drawdown_and_a_split_inside_it_is_marked():
    vals = [100, 70, 90, 65, 95, 101]
    closes = closes_on(weekdays("2031-01-06", 6), vals)
    dd = C.drawdowns(closes, "ZZQA", [closes[3][0]])
    assert dd["total"] == 1 and dd["episodes"][0]["trough"]["close"] == 65.0 and dd["episodes"][0]["check"] is True
    assert C.drawdowns(closes, "ZZQA", [])["episodes"][0]["check"] is False


def test_the_list_is_cut_to_the_newest_and_says_how_many_there_were(monkeypatch):
    monkeypatch.setattr(C, "DRAWDOWNS_SHOWN", 2)
    vals = []
    for k in range(5):
        top = 100 * (1.1 ** k)
        vals += [top, top * 0.7]
    vals.append(1000)
    dd = C.drawdowns(closes_on(weekdays("2031-01-06", len(vals)), vals), "ZZQA", [])
    assert dd["total"] == 5 and dd["shown"] == 2 and len(dd["episodes"]) == 2
    assert dd["episodes"][0]["peak"]["close"] == round(100 * 1.1 ** 4, 4)


# ── 5. in every market correction ──────────────────────────────────────────────────────────────

def _index_episode(peak, trough, recovered, depth, rally3=None, kind="correction"):
    return {"id": f"SPX-{peak}", "kind": kind, "peak": {"date": peak, "close": 1000.0}, "trough": {"date": trough, "close": 1000.0 * (1 + depth / 100)},
            "depth_pct": depth, "recovered": recovered, "ongoing": recovered is None,
            "rally": [{"months": 3, "target": None, "date": rally3[0] if rally3 else None,
                       "return_pct": rally3[1] if rally3 else None}]}


def test_its_drawdown_is_inside_the_index_window_and_compared_with_the_index_depth():
    days = weekdays("2030-01-01", 400)
    vals = [100.0] * 300 + [110.0, 120.0, 90.0, 60.0, 80.0] + [100.0] * 95
    closes = closes_on(days, vals)
    ep = _index_episode(days[299], days[304], days[340], -25.0, (days[366], 12.0))
    got = C.in_correction(closes, ep)
    assert got["drawdown_pct"] == -50.0                                 # from 120 (inside the window) to 60
    assert got["high"] == {"date": days[301], "close": 120.0} and got["low"] == {"date": days[303], "close": 60.0}
    assert got["window_return_pct"] == -20.0                            # 100 at the index peak, 80 at its low
    assert got["vs_index_ratio"] == 2.0 and got["vs_index_pts"] == -25.0
    assert got["after"] == {"state": "ok", "months": 3, "from": days[304], "date": days[366], "return_pct": 25.0,
                            "index_return_pct": 12.0, "vs_index_pts": 13.0}


def test_back_to_its_high_first_after_the_same_day_or_not_at_all():
    days = weekdays("2030-01-01", 420)
    base = [100.0] * 300
    ep = lambda rec: _index_episode(days[300], days[305], rec, -15.0)   # noqa: E731
    first = C.in_correction(closes_on(days, base + [90, 80, 85, 101, 90, 85] + [95.0] * 114), ep(days[350]))
    assert first["new_high"] == {"state": "first", "high": 100.0, "date": days[303], "index_date": days[350], "lead_sessions": 47}
    after = C.in_correction(closes_on(days, base + [90, 80, 85, 90, 90, 85] + [95.0] * 50 + [100.0] * 64), ep(days[350]))
    assert after["new_high"]["state"] == "after" and after["new_high"]["lead_sessions"] == -6
    same = C.in_correction(closes_on(days, base + [90, 80, 85, 90, 90, 85] + [95.0] * 44 + [100.0] * 70), ep(days[350]))
    assert same["new_high"]["state"] == "same_day" and same["new_high"]["lead_sessions"] == 0
    never = C.in_correction(closes_on(days, base + [90, 80] + [85.0] * 118), ep(days[350]))
    assert never["new_high"]["state"] == "index_only"
    neither = C.in_correction(closes_on(days, base + [90, 80] + [85.0] * 118), ep(None))
    assert neither["new_high"]["state"] == "neither" and neither["after"]["state"] == "not_yet"
    young = C.in_correction(closes_on(days[200:], base[200:] + [90, 80] + [85.0] * 118), ep(days[350]))
    assert young["new_high"] == {"state": "short", "needed": 252, "held": 101}


def test_an_index_decline_before_the_stocks_history_is_counted_not_listed():
    days = weekdays("2030-01-01", 300)
    closes = closes_on(days[100:], [50.0] * 200)
    block = {"episodes": [_index_episode(days[250], days[260], None, -12.0),
                          _index_episode(days[10], days[20], days[40], -11.0)]}
    got = C.corrections(closes, block)
    assert [e["id"] for e in got["episodes"]] == [f"SPX-{days[250]}"]
    assert got["before_history"] == 1 and got["summary"]["count"] == 1
    assert got["episodes"][0]["stock"]["drawdown_pct"] == 0.0 and got["episodes"][0]["stock"]["vs_index_ratio"] == 0.0


def test_the_summary_counts_falls_highs_and_the_months_after():
    days = weekdays("2029-01-01", 700)
    vals = [100.0] * 300 + [70.0] * 100 + [120.0] * 100 + [115.0] * 200
    closes = closes_on(days, vals)
    block = {"episodes": [
        _index_episode(days[520], days[530], days[560], -10.0, (days[590], 5.0)),        # it did not fall: less
        _index_episode(days[299], days[310], days[450], -20.0, (days[372], 8.0)),        # it fell 30%: more
    ]}
    s = C.corrections(closes, block)["summary"]
    assert (s["count"], s["fell_less"], s["fell_more"]) == (2, 1, 1)
    assert s["median_ratio"] == 0.75                                    # 0.0 (it did not fall) and 1.5
    assert (s["new_high_first"], s["new_high_judged"]) == (1, 2)       # back to 100 before the index; never back to 120
    assert (s["after_count"], s["after_beat"], s["median_after_vs_index_pts"]) == (2, 0, -6.5)


# ── the reads ──────────────────────────────────────────────────────────────────────────────────

def test_daily_bars_is_one_read_with_the_very_closes_daily_closes_answers(monkeypatch):
    raw = [{"t": "2031-01-06", "o": 10, "h": 11, "l": 9, "c": 10.5, "v": 100},
           {"t": "20310107", "o": 10.5, "h": 12, "l": 10, "c": 11.5, "v": None},
           {"t": "2031-01-08", "o": None, "h": 12, "l": 10, "c": 11.0, "v": 7},
           {"t": "2031-01-09", "o": 11, "h": 12, "l": 10, "c": 20.0, "v": True}]
    reads = []
    monkeypatch.setattr(price_reads, "_load_bars", lambda s: reads.append(s) or [dict(b) for b in raw])
    got = price_reads.daily_bars("zzqa")
    assert reads == ["ZZQA"]
    want = price_reads.daily_closes("ZZQA")
    assert {k: got[k] for k in want} == want
    assert got["bars"] == [("2031-01-06", 10.0, 11.0, 9.0, 10.5, 100.0), ("2031-01-07", 10.5, 12.0, 10.0, 11.5, None),
                           ("2031-01-09", 11.0, 12.0, 10.0, 20.0, None)]
    assert got["suspect_jumps"] == ["2031-01-09"]
    assert price_reads.daily_bars("not a ticker")["status"] == "refused"
    monkeypatch.setattr(price_reads, "_load_bars", lambda s: [])
    assert price_reads.daily_bars("ZZQA")["reason"] == "no_price_history"
    monkeypatch.setattr(price_reads, "_load_bars", lambda s: (_ for _ in ()).throw(OSError("x")))
    assert price_reads.daily_bars("ZZQA")["reason"] == "read_failed"


def _world(monkeypatch, *, days=None, market=None, groups=None, reads=None, bench_reads=None, key="2031-06-02"):
    days = days or weekdays_ending("2031-06-03", 420)
    closes = closes_on(days, wave(len(days), 40.0, 0.02, 9))
    bars = bars_from(closes)
    reads = reads if reads is not None else []
    bench_reads = bench_reads if bench_reads is not None else []

    def read_bars(sym):
        reads.append(sym)
        return {"status": "ok", "symbol": sym, "bars": list(bars), "closes": closes}

    def read_closes(sym):
        bench_reads.append(sym)
        return {"status": "ok", "symbol": sym, "closes": closes_on(days, wave(len(days), 300.0, 0.01, 2))}

    monkeypatch.setattr(S, "_read_bars", read_bars)
    monkeypatch.setattr(S, "_read_closes", read_closes)
    monkeypatch.setattr(S, "_groups", lambda sym: groups if groups is not None else {"sector": "Technology", "industry": "Semiconductors"})
    monkeypatch.setattr(S, "session_key", lambda now: key)
    monkeypatch.setattr(S, "now_et", lambda: datetime(2031, 6, 3, 12, 0))
    state = {"answer": market if market is not None else {"status": "computing"}}
    monkeypatch.setattr(S, "_market_answer", lambda: state["answer"])
    return {"reads": reads, "bench_reads": bench_reads, "days": days, "market": state}


def test_only_closes_up_to_the_session_are_read_so_todays_unfinished_bar_never_counts(monkeypatch):
    w = _world(monkeypatch)
    ans = S.get_stock_stats("ZZQA")
    assert ans["status"] == "ok" and ans["data_through"] == "2031-06-02" and ans["session"] == "2031-06-02"
    assert w["days"][-1] == "2031-06-03"                                 # the store held a bar for the next day
    assert ans["volatility"]["as_of"] == "2031-06-02"
    assert ans["corrections"]["state"] == "computing"


def test_the_answer_is_held_per_symbol_per_session_and_follows_mkths_answer(monkeypatch):
    w = _world(monkeypatch)
    a1 = S.get_stock_stats("ZZQA")
    a2 = S.get_stock_stats("ZZQA")
    assert a1 is a2 and w["reads"] == ["ZZQA"]
    S.get_stock_stats("ZZQB")
    assert w["reads"] == ["ZZQA", "ZZQB"] and w["bench_reads"] == ["SPY", "XLK"]   # benchmarks once for everyone
    idx = closes_on(weekdays_ending("2031-06-02", 400), [100.0] * 200 + [80.0] * 100 + [101.0] * 100)
    w["market"]["answer"] = {"status": "ok", "built_at": "2031-06-02T21:00:00+00:00", "data_through": "2031-06-02",
                             "definition": {"text": "A decline counts ..."},
                             "indexes": {"SPX": {"state": "ok", "first": idx[0][0], "last": idx[-1][0],
                                                 "episodes": MH.describe_episodes(idx, "SPX")}}}
    a3 = S.get_stock_stats("ZZQA")
    assert w["reads"] == ["ZZQA", "ZZQB", "ZZQA"]
    assert a3["corrections"]["state"] == "ok" and a3["corrections"]["summary"]["count"] == 1
    assert a3["corrections"]["definition"] == "A decline counts ..."


def test_a_new_session_reads_again(monkeypatch):
    w = _world(monkeypatch)
    S.get_stock_stats("ZZQA")
    monkeypatch.setattr(S, "session_key", lambda now: "2031-06-03")
    assert S.get_stock_stats("ZZQA")["data_through"] == "2031-06-03"
    assert w["reads"] == ["ZZQA", "ZZQA"]


def test_a_stock_whose_closes_stop_short_is_read_again_only_after_the_recheck(monkeypatch):
    w = _world(monkeypatch, key="2031-06-10")
    ans = S.get_stock_stats("ZZQA")
    assert ans["data_through"] == "2031-06-03"
    S.get_stock_stats("ZZQA")
    assert w["reads"] == ["ZZQA"]
    entry = S._cache["ZZQA"]
    assert abs(entry["recheck_at"] - (entry["at"] + S.LAG_RECHECK_S)) < 1e-6
    entry["recheck_at"] = time.time() - 1                               # the recheck is due
    S.get_stock_stats("ZZQA")
    assert w["reads"] == ["ZZQA", "ZZQA"]


def test_a_failed_read_is_never_held_and_nothing_stored_is_not_held_in_words(monkeypatch):
    calls = []
    monkeypatch.setattr(S, "_read_bars", lambda s: calls.append(s) or {"status": "unavailable", "reason": "read_failed"})
    monkeypatch.setattr(S, "_market_answer", lambda: {"status": "computing"})
    assert S.get_stock_stats("ZZQA")["status"] == "unavailable"
    assert S.get_stock_stats("ZZQA")["status"] == "unavailable"
    assert calls == ["ZZQA", "ZZQA"]
    monkeypatch.setattr(S, "_read_bars", lambda s: calls.append(s) or {"status": "unavailable", "reason": "no_price_history"})
    got = S.get_stock_stats("ZZQB")
    assert got == {"status": "not_held", "symbol": "ZZQB", "detail": "UCT holds no daily prices for ZZQB."}
    monkeypatch.setattr(S, "_read_bars", lambda s: (_ for _ in ()).throw(RuntimeError("boom")))
    assert S.get_stock_stats("ZZQC")["reason"] == "failed"


def test_the_held_answers_are_capped_least_recently_asked_first(monkeypatch):
    w = _world(monkeypatch)
    monkeypatch.setattr(S, "CACHE_MAX", 2)
    for s in ("ZZQA", "ZZQB", "ZZQA", "ZZQC", "ZZQA", "ZZQB"):
        S.get_stock_stats(s)
    assert w["reads"] == ["ZZQA", "ZZQB", "ZZQC", "ZZQB"]


def test_one_build_per_symbol_at_a_time_and_a_bounded_number_of_symbols(monkeypatch):
    w = _world(monkeypatch)
    gate, started = threading.Event(), threading.Event()
    slow_reads = []
    real = S._read_bars

    def slow(sym):
        slow_reads.append(sym)
        started.set()
        gate.wait(5)
        return real(sym)

    monkeypatch.setattr(S, "_read_bars", slow)
    out = []
    t1 = threading.Thread(target=lambda: out.append(S.get_stock_stats("ZZQA")))
    t1.start()
    started.wait(5)
    t2 = threading.Thread(target=lambda: out.append(S.get_stock_stats("ZZQA")))
    t2.start()
    time.sleep(0.2)
    gate.set()
    t1.join(5); t2.join(5)
    assert slow_reads == ["ZZQA"] and len(out) == 2 and out[0] is out[1]
    # every slot taken: the next symbol says busy rather than queue without end
    monkeypatch.setattr(S, "BUILD_WAIT_S", 0.05)
    for _ in range(S.BUILD_SLOTS):
        S._slots.acquire()
    try:
        assert S.get_stock_stats("ZZQZ")["status"] == "busy"
    finally:
        for _ in range(S.BUILD_SLOTS):
            S._slots.release()
    assert "ZZQZ" not in w["reads"]


def test_the_sector_fund_comes_from_the_read_only_map_and_a_fund_has_none(monkeypatch):
    from api.services import industry_map
    monkeypatch.setattr(industry_map, "get_groups", lambda *a, **k: pytest.fail("the fetching map read"))
    monkeypatch.setattr(industry_map, "peek_groups", lambda t, **k: {"ZZQA": {"sector": "Energy", "industry": "Oil"}})
    monkeypatch.setattr(S, "_groups", _REAL_GROUPS)
    assert S.sector_fund("ZZQA") == {"state": "ok", "symbol": "XLE", "sector": "Energy"}
    monkeypatch.setattr(industry_map, "peek_groups", lambda t, **k: {"ZZQA": {"sector": "Financial", "industry": "Exchange Traded Fund"}})
    assert S.sector_fund("ZZQA") == {"state": "fund"}
    monkeypatch.setattr(industry_map, "peek_groups", lambda t, **k: {})
    assert S.sector_fund("ZZQA") == {"state": "no_sector"}
    monkeypatch.setattr(industry_map, "peek_groups", lambda t, **k: {"ZZQA": {"sector": "Shipping", "industry": "x"}})
    assert S.sector_fund("ZZQA") == {"state": "not_mapped", "sector": "Shipping"}



def test_mkths_answer_is_asked_without_waiting_and_its_states_are_words(monkeypatch):
    from api.services import market_history
    seen = []
    monkeypatch.setattr(market_history, "get_market_history", lambda **kw: seen.append(kw) or {"status": "computing"})
    assert S.market_corrections()[0] == {"state": "computing"}
    assert seen == [{"wait_s": 0}]
    monkeypatch.setattr(market_history, "get_market_history", lambda **kw: {"status": "unavailable", "detail": "no index"})
    assert S.market_corrections()[0] == {"state": "unavailable", "detail": "no index"}
    monkeypatch.setattr(market_history, "get_market_history", lambda **kw: {"status": "ok", "indexes": {"SPX": {"state": "not_held"}}})
    assert S.market_corrections()[0] == {"state": "not_held"}
    monkeypatch.setattr(market_history, "get_market_history", lambda **kw: (_ for _ in ()).throw(RuntimeError("x")))
    assert S.market_corrections()[0]["state"] == "unavailable"


def test_the_benchmarks_and_the_sector_fund_say_when_they_are_not_held(monkeypatch):
    _world(monkeypatch, groups={"sector": "Financial", "industry": "Exchange Traded Fund"})
    monkeypatch.setattr(S, "_read_closes", lambda s: {"status": "unavailable", "reason": "no_price_history"})
    ans = S.get_stock_stats("ZZQA")
    assert ans["beta"]["spy"] == {"symbol": "SPY", "state": "not_held"}
    assert ans["beta"]["sector"] == {"state": "fund"}


def test_a_benchmark_that_could_not_be_read_when_the_answer_was_built_is_tried_again_with_the_stock(monkeypatch):
    # a failed SPY (or sector fund) read is tried again after LAG_RECHECK_S; the stock's held answer
    # must follow it, never carry the failed read for the rest of the session
    _world(monkeypatch)
    good = S._read_closes
    state = {"fail": True}
    monkeypatch.setattr(S, "_read_closes", lambda s: {"status": "unavailable", "reason": "read_failed", "symbol": s}
                        if state["fail"] else good(s))
    first = S.get_stock_stats("ZZQA")
    assert first["beta"]["spy"] == {"symbol": "SPY", "state": "unavailable", "reason": "read_failed"}
    assert first["beta"]["sector"]["state"] == "unavailable"
    state["fail"] = False
    # half an hour passes: every time this module stored moves back by the recheck
    for held in S._bench.values():
        held["at"] -= S.LAG_RECHECK_S + 1
    entry = S._cache["ZZQA"]
    entry["at"] -= S.LAG_RECHECK_S + 1
    if entry["recheck_at"] is not None:
        entry["recheck_at"] -= S.LAG_RECHECK_S + 1
    ans = S.get_stock_stats("ZZQA")
    assert ans["beta"]["spy"]["state"] == "ok" and ans["beta"]["spy"]["beta"] is not None
    assert ans["beta"]["sector"]["state"] == "ok" and ans["beta"]["sector"]["symbol"] == "XLK"
    assert S._cache["ZZQA"]["recheck_at"] is None                      # both held now: kept for the session


def test_a_failed_benchmark_read_is_said_as_a_failed_read_and_only_nothing_stored_is_not_held(monkeypatch):
    # `read_failed` (the store could not be read just now) is NOT "UCT holds no prices for SPY"
    _world(monkeypatch)
    monkeypatch.setattr(S, "_read_closes", lambda s: {"status": "unavailable", "reason": "read_failed", "symbol": s})
    ans = S.get_stock_stats("ZZQA")
    assert ans["beta"]["spy"] == {"symbol": "SPY", "state": "unavailable", "reason": "read_failed"}
    assert ans["beta"]["sector"] == {"symbol": "XLK", "sector": "Technology", "state": "unavailable", "reason": "read_failed"}
    entry = S._cache["ZZQA"]                                            # and it is read again after the recheck
    assert entry["recheck_at"] is not None and abs(entry["recheck_at"] - (entry["at"] + S.LAG_RECHECK_S)) < 1e-6
    # nothing stored for the fund, or nothing settled by the session: not held, in the words it always had
    for read in ({"status": "unavailable", "reason": "no_price_history"},
                 {"status": "ok", "closes": [("2031-06-03", 300.0)]}):          # only a close after the session
        S.reset_for_tests()
        monkeypatch.setattr(S, "_read_closes", lambda s, read=read: {**read, "symbol": s})
        ans = S.get_stock_stats("ZZQA")
        assert ans["beta"]["spy"] == {"symbol": "SPY", "state": "not_held"}
        assert ans["beta"]["sector"] == {"symbol": "XLK", "sector": "Technology", "state": "not_held"}


def test_a_sector_fund_not_held_alone_also_sends_the_stock_back_for_the_recheck(monkeypatch):
    _world(monkeypatch)
    good = S._read_closes
    monkeypatch.setattr(S, "_read_closes", lambda s: {"status": "unavailable", "reason": "no_price_history", "symbol": s}
                        if s == "XLK" else good(s))
    ans = S.get_stock_stats("ZZQA")
    assert ans["beta"]["spy"]["state"] == "ok" and ans["beta"]["sector"]["state"] == "not_held"
    entry = S._cache["ZZQA"]
    assert entry["recheck_at"] is not None and abs(entry["recheck_at"] - (entry["at"] + S.LAG_RECHECK_S)) < 1e-6


# ── the route ──────────────────────────────────────────────────────────────────────────────────

def _client(user):
    app = FastAPI()
    app.include_router(route.router)
    if user is not None:
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app, raise_server_exceptions=False)


def test_the_route_is_one_paid_get_and_a_refused_caller_never_reaches_the_service(monkeypatch):
    asked = []
    monkeypatch.setattr(S, "get_stock_stats", lambda sym: asked.append(sym) or {"status": "ok", "symbol": sym})
    (r,) = route.router.routes
    assert r.path == "/api/research/stock-stats/{ticker}" and r.methods == {"GET"}
    assert route.require_paid in {d.call for d in r.dependant.dependencies}
    assert route.require_paid.__module__ == "api.routers.stock_stats"
    assert _client(None).get("/api/research/stock-stats/NVDA").status_code == 401
    refused = _client(FREE_USER).get("/api/research/stock-stats/NVDA")
    assert refused.status_code == 402 and refused.json() == {"detail": "Stock statistics require a paid plan"}
    assert asked == []
    assert _client(PAID_USER).get("/api/research/stock-stats/nvda").json() == {"status": "ok", "symbol": "NVDA"}
    assert _client(PAID_USER).get("/api/research/stock-stats/$$$").status_code == 400
    assert asked == ["NVDA"]


def test_the_handler_is_a_plain_def_and_the_route_is_mounted():
    import inspect
    assert not inspect.iscoroutinefunction(route.get_stock_stats)
    main = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
    assert "from api.routers import stock_stats as stock_stats_router" in main
    assert "app.include_router(stock_stats_router.router)" in main
