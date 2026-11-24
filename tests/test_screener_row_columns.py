"""Row columns for the Screener (`api/services/screener/row_columns.py`): days to the estimated IPO lockup, this month's
seasonality, the last report's 5-session drift, factor loadings and up / down capture.

Every price, fund, report and date here is invented. Each column is held to the panel code it reuses, run on the same
invented bars: IPO LOCKUP's `estimated_expiry`, SEAS's `compute`, ERX's `quarter_rows`, FCTX's own read and fit
(`factor_exposure.read_funds` / `build`, its reads stood in for), STAT's `beta_block`.
"""
from __future__ import annotations

import functools
import importlib
import random
from datetime import date, timedelta

import numpy as np
import pytest

from api.services import earnings_reaction_panel as ERX
from api.services import factor_exposure_calc as FC
from api.services import ipo_lockups as IPO
from api.services import seasonality as SEAS
from api.services import stock_stats_calc as SC
from api.services.fundamentals_pit import beta as BETA
from api.services.market_intel import price_reads as PR
from api.services.screener import row_columns as RC

SESSION = date(2026, 11, 20)
KEY = SESSION.isoformat()


# ── invented bars ─────────────────────────────────────────────────────────────────────────────

def _weekdays(n, end=SESSION):
    out, d = [], end
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d -= timedelta(days=1)
    return out[::-1]


def _ymd(d):
    return int(d.strftime("%Y%m%d"))


def _bar(d, c, o=None):
    o = c if o is None else o
    return {"t": _ymd(d), "o": o, "h": max(o, c) * 1.01, "l": min(o, c) * 0.99, "c": c, "v": 1_000_000.0}


def _from_returns(days, rets, start=50.0):
    c, out = start, []
    for d, r in zip(days, rets):
        c *= 1.0 + r
        out.append(_bar(d, c))
    return out


@functools.lru_cache(maxsize=1)
def _market():
    """Invented daily factor returns for 700 weekdays to the session, and the seven funds built from them, so each FCTX
    spread is one invented factor exactly (SPY = market, IWM - SPY = size, IWF - IWD = growth, and so on)."""
    days = _weekdays(700)
    rng = random.Random(11)
    f = [(rng.gauss(0.0004, 0.010), rng.gauss(0, 0.006), rng.gauss(0, 0.005), rng.gauss(0, 0.006),
          rng.gauss(0, 0.004), rng.gauss(0, 0.004)) for _ in days]
    funds = {
        "SPY": _from_returns(days, [x[0] for x in f], 400.0),
        "IWM": _from_returns(days, [x[0] + x[1] for x in f], 200.0),
        "IWF": _from_returns(days, [x[0] + x[2] / 2 for x in f], 300.0),
        "IWD": _from_returns(days, [x[0] - x[2] / 2 for x in f], 150.0),
        "MTUM": _from_returns(days, [x[0] + x[3] for x in f], 180.0),
        "QUAL": _from_returns(days, [x[0] + x[4] for x in f], 160.0),
        "USMV": _from_returns(days, [x[0] + x[5] for x in f], 80.0),
    }
    stock_rets = [1.2 * x[0] + 0.9 * x[1] + 0.7 * x[3] + rng.gauss(0, 0.009) for x in f]
    return days, f, funds, _from_returns(days, stock_rets, 30.0)


def _ctx(funds=None, spy=None, month=None):
    """The build's one context over invented funds (a dict of bar lists; SPY handed in as the build's own read)."""
    _days, _f, base, _stock = _market()
    funds = base if funds is None else funds
    reads = []

    def read(sym):
        reads.append(sym)
        return funds.get(sym, [])
    ctx = RC.build_context(SESSION, funds.get("SPY", []) if spy is None else spy, read, today=SESSION + timedelta(4))
    if month is not None:
        ctx["month"] = month
    ctx["_reads"] = reads
    return ctx


# ── the shape ─────────────────────────────────────────────────────────────────────────────────

def test_the_columns_categories_and_reused_constants_are_one_set():
    assert len(RC.COLUMNS) == 12 == len(set(RC.COLUMNS))
    assert set(RC.INT_COLUMNS) <= set(RC.COLUMNS) and set(RC.CATEGORY) == set(RC.COLUMNS)
    assert set(RC.FACTOR_LOADINGS.values()) | {"factor_r2"} == set(RC.FACTOR_COLUMNS)
    assert set(RC.FACTOR_LOADINGS) <= set(FC.FACTOR_KEYS), "every published loading is one FCTX fits"
    assert RC.FACTOR_TAIL > FC.WINDOW and RC.DRIFT_PAD > ERX.RUN_IN


# ── days to the lockup ────────────────────────────────────────────────────────────────────────

def test_days_to_lockup_is_ipo_lockups_estimate_counted_from_the_rows_date():
    # 2026-06-01 + 180 days is Saturday 2026-11-28: the estimate rolls to Monday 2026-11-30, as IPO LOCKUP does
    assert IPO.estimated_expiry(date(2026, 6, 1)) == date(2026, 11, 30)
    assert RC.lockup_fields("2026-06-01", "Stock", date(2026, 11, 24)) == {"days_to_lockup": 6}
    assert RC.lockup_fields("2026-06-01T00:00:00", "Stock", date(2026, 11, 30)) == {"days_to_lockup": 0}
    assert RC.lockup_fields("20260601", "Stock", date(2026, 7, 1)) == {"days_to_lockup": 152}


def test_a_past_expiry_is_negative_inside_ipo_lockups_window_and_blank_past_it():
    listing = date(2026, 5, 21)                       # + 180 days = Tuesday 2026-11-17, a session: no roll
    expiry = IPO.estimated_expiry(listing)
    assert expiry == listing + timedelta(days=IPO.LOCKUP_DAYS)
    edge = expiry + timedelta(days=IPO.BEHIND_DAYS)
    assert RC.lockup_fields(listing.isoformat(), "Stock", edge) == {"days_to_lockup": -IPO.BEHIND_DAYS}
    assert RC.lockup_fields(listing.isoformat(), "Stock", edge + timedelta(days=1)) == {}, \
        "past IPO LOCKUP's own recent window: blank, never a stale negative"
    assert RC.lockup_fields("2004-08-19", "Stock", date(2026, 11, 24)) == {}


def test_lockup_is_blank_with_no_listing_date_a_future_listing_or_not_a_common_stock():
    today = date(2026, 11, 24)
    for ipo, kind in ((None, "Stock"), ("", "Stock"), ("not a date", "Stock"), ("2026-12-01", "Stock"),
                      ("2026-06-01", "ADR"), ("2026-06-01", "ETF"), ("2026-06-01", None)):
        assert RC.lockup_fields(ipo, kind, today) == {}, (ipo, kind)


# ── this month's seasonality ──────────────────────────────────────────────────────────────────

def _months_series(first=date(2012, 1, 3), last=SESSION, seed=5, drop=()):
    rng, out, c, d = random.Random(seed), [], 20.0, first
    while d <= last:
        if d.weekday() < 5 and (d.year, d.month) not in drop:
            c *= 1 + rng.gauss(0.0005, 0.02)
            out.append(_bar(d, c))
        d += timedelta(days=1)
    return out


def test_month_ends_give_seas_its_whole_series_months():
    for seed, drop in ((5, ()), (6, {(2015, 3), (2019, 11), (2020, 1)})):
        bars = _months_series(seed=seed, drop=drop)
        assert SEAS.compute(RC.month_ends(bars))["months"] == SEAS.compute(bars)["months"]
    # a bar SEAS does not count is not a month end either; text dates read as SEAS reads them
    bars = _months_series(seed=7)
    bars[-30]["c"] = 0.0
    bars[-60]["c"] = None
    iso = [{"t": f"{b['t'] // 10000:04d}-{b['t'] // 100 % 100:02d}-{b['t'] % 100:02d}", "c": b["c"]} for b in bars]
    assert SEAS.compute(RC.month_ends(iso))["months"] == SEAS.compute(iso)["months"] == \
        SEAS.compute(RC.month_ends(bars))["months"]
    assert len(RC.month_ends(bars)) < 200, "one bar per month, not the series"
    shuffled = list(bars)
    random.Random(2).shuffle(shuffled)                     # the general path: an unsorted list
    assert SEAS.compute(RC.month_ends(shuffled))["months"] == SEAS.compute(shuffled)["months"]
    # `months`: exactly the whole list with every other month left out, the newest end kept, on either path
    for series in (bars, iso, _months_series(last=date(2026, 8, 14), seed=9)):
        whole = RC.month_ends(series)
        for want in ({11, 10}, {1, 12}, {8, 7}, {3}):
            keep = [e for e in whole[:-1] if RC._month_of(e["t"]) in want] + whole[-1:]
            got = RC.month_ends(series, want)
            assert sorted(got, key=lambda e: str(e["t"])) == sorted(keep, key=lambda e: str(e["t"])), want


def test_seasonality_is_seas_month_for_the_sessions_month():
    bars = _months_series()
    nov = SEAS.compute(bars)["months"][10]
    got = RC.seasonality_fields(bars, 11)
    assert got == {"seas_month_avg": nov["avg_pct"], "seas_month_up_pct": nov["pct_up"], "seas_month_years": nov["n"]}
    assert got["seas_month_years"] == 14, "Novembers 2012-2025: November 2026 is still running"
    # hand-made: one bar per month, every November +10% except two at -5%
    days, c, rows = [], 100.0, []
    for y in range(2015, 2026):
        for m in range(1, 13):
            r = (0.10 if y not in (2017, 2021) else -0.05) if m == 11 else 0.0
            c *= 1 + r
            rows.append({"t": y * 10000 + m * 100 + 27, "c": c})
    rows.append({"t": 20261103, "c": c})
    got = RC.seasonality_fields(rows, 11)
    assert got == {"seas_month_avg": round((9 * 10.0 - 2 * 5.0) / 11, 2), "seas_month_up_pct": round(9 / 11 * 100),
                   "seas_month_years": 11}


def test_each_calendar_month_is_seas_figure_on_the_whole_series():
    for bars in (_months_series(), _months_series(seed=8, drop={(2014, 12), (2018, 6), (2021, 1), (2023, 10)}),
                 _months_series(last=date(2026, 8, 14), seed=9)):          # a stock whose bars stop in August
        months = SEAS.compute(bars)["months"]
        for m in range(1, 13):
            want, got = months[m - 1], RC.seasonality_fields(bars, m)
            if want["n"] < SEAS.MIN_YEARS:
                assert got == {}, m
            else:
                assert got == {"seas_month_avg": want["avg_pct"], "seas_month_up_pct": want["pct_up"],
                               "seas_month_years": want["n"]}, m


def test_seasonality_is_blank_under_seas_minimum_years_and_without_a_month():
    short = _months_series(first=date(SESSION.year - SEAS.MIN_YEARS + 1, 1, 2))
    assert RC.seasonality_fields(short, 11) == {}, f"{SEAS.MIN_YEARS - 1} Novembers: SEAS marks it thin"
    enough = _months_series(first=date(SESSION.year - SEAS.MIN_YEARS, 1, 2))
    assert RC.seasonality_fields(enough, 11)["seas_month_years"] == SEAS.MIN_YEARS
    assert RC.seasonality_fields(enough, None) == {} and RC.seasonality_fields([], 11) == {}


# ── the last report's drift ───────────────────────────────────────────────────────────────────

def _report_bars(after_reaction=5, gap_day=21, n_before=21):
    """Flat at 100; the report is on bar 20 (after the close), bar 21 opens 8% higher and closes at 110, and the
    close `after_reaction` sessions later is 121 when there are five."""
    days = _weekdays(n_before + 1 + after_reaction, end=date(2026, 10, 30))
    bars = [_bar(d, 100.0) for d in days[:n_before]]
    bars.append(_bar(days[n_before], 110.0, o=108.0))
    for k in range(1, after_reaction + 1):
        bars.append(_bar(days[n_before + k], 121.0 if k == 5 else 112.0))
    return bars, days


def _erx_shape(bars):
    return [{"t": f"{b['t'] // 10000:04d}-{b['t'] // 100 % 100:02d}-{b['t'] % 100:02d}", "o": b["o"], "c": b["c"]}
            for b in bars]


def test_drift_is_erxs_drift_after_its_reacting_session():
    bars, days = _report_bars()
    report = {"report_date": days[20].isoformat(), "label": "Q3"}
    got, reach = RC.drift_fields(bars, report)
    assert got == {"post_earn_drift_5d": 10.0}, "121 over the reacting session's 110 close"
    assert reach == len(bars) - 19
    erx = ERX.quarter_rows([{"reported": True, "report_date": report["report_date"], "label": "Q3"}],
                           _erx_shape(bars))
    assert erx[0]["session"] == days[21].isoformat() and erx[0]["drift_pct"] == got["post_earn_drift_5d"]


def test_drift_equals_erx_on_random_series_and_every_recent_report():
    rng = random.Random(3)
    days = _weekdays(400)
    bars = [_bar(d, 50 * (1 + 0.3 * rng.random()), o=50 * (1 + 0.3 * rng.random())) for d in days]
    for i in range(300, 399, 7):
        rep = days[i].isoformat()
        erx = ERX.quarter_rows([{"reported": True, "report_date": rep}], _erx_shape(bars))[0]
        got = RC.drift_fields(bars, {"report_date": rep})[0]
        assert got.get("post_earn_drift_5d") == (erx["drift_pct"] if erx["drift_state"] == "measured" else None), rep


def test_drift_is_blank_while_pending_or_awaiting_never_zero():
    bars, days = _report_bars(after_reaction=3)
    assert RC.drift_fields(bars, {"report_date": days[20].isoformat()})[0] == {}, "pending, never 0"
    bars, days = _report_bars(after_reaction=0)
    assert RC.drift_fields(bars[:-1], {"report_date": days[20].isoformat()})[0] == {}, \
        "the session after the report has not traded: the reacting session cannot be chosen"
    assert RC.drift_fields(bars, None)[0] == {} and RC.drift_fields([], {"report_date": "2026-10-01"})[0] == {}


def test_the_report_comes_from_the_earnings_reads_own_pass(monkeypatch):
    from api.services import sector_earnings as SE
    from api.services.screener import beats_insiders_funds as BIF
    from tests.test_screener_beats_insiders_funds import _copy, _q
    copies = {"ZZQA": _copy(_q(2026, 3, "2026-11-05", 1.1, 1.0), _q(2026, 2, "2026-08-06", 1.0, 1.0)),
              "ZZQB": _copy(_q(2026, 2, "2026-08-06", 1.1, 1.0), nxt="2026-11-04"),             # behind
              "ZZQC": _copy(_q(2026, 4, "2026-11-23", 1.1, 1.0), _q(2026, 3, "2026-11-02", 1.0, None,
                                                                      basis="gaap_diluted"))}
    copies["ZZQA"]["quarters"][0]["label"] = "Q3 FY2026"
    passes = []

    def held(symbols):
        passes.append(1)
        for s in symbols:
            yield s, copies.get(s)
    monkeypatch.setattr(SE, "held_copies", held)
    reports = {}
    got = BIF.read_earnings_fields(["ZZQA", "ZZQB", "ZZQC", "ZZQD"], session=SESSION, reports=reports)
    assert len(passes) == 1, "the report dates ride the earnings read's one pass"
    assert reports == {"ZZQA": {"report_date": "2026-11-05", "label": "Q3 FY2026"},
                       "ZZQC": {"report_date": "2026-11-02", "label": None}}, \
        "behind (ZZQB) gives none; a report after the session (ZZQC's Q4) is never the last one"
    assert got == {"ZZQA": {"eps_surprise_last": 10.0, "eps_beat_streak": 1}}, "the columns it writes did not move"


# ── factor loadings ───────────────────────────────────────────────────────────────────────────

def _fctx(monkeypatch, funds, stock, sym="ZZQF"):
    """FCTX's own answer on the same invented closes: its reads stood in for, nothing else."""
    from api.services import factor_exposure as FX
    series = dict(funds, **{sym: stock})

    def read(s):
        bars = series.get(s)
        if not bars:
            return {"status": "unavailable", "reason": "no_price_history"}
        got = PR._closes_answer(s, bars[-FX.READ_SESSIONS:])
        return {"status": "ok", "closes": got["closes"], "suspect_jumps": []}
    monkeypatch.setattr(FX, "_read_bars", read)
    funds_held = FX.read_funds(KEY)
    return funds_held, FX.build(sym, KEY, funds_held)


def _assert_equals_fctx(mine, answer):
    now = answer["now"]
    assert now["state"] == "ok"
    rows = {r["key"]: r for r in now["loadings"]}
    for key, col in RC.FACTOR_LOADINGS.items():
        if rows[key]["clears"]:
            assert mine[col] == rows[key]["loading"], col
        else:
            assert col not in mine, f"{col}: under FCTX's bar, blank never its estimate"
    assert mine["factor_r2"] == now["r2"]


def test_factor_loadings_equal_fctxs_own_answer_on_the_same_closes(monkeypatch):
    _days, _f, funds, stock = _market()
    ctx = _ctx()
    mine, reach = RC.factor_fields(stock, ctx)
    held, answer = _fctx(monkeypatch, funds, stock)
    assert ctx["factors"]["chosen"] == held["chosen"]
    _assert_equals_fctx(mine, answer)
    assert {"factor_mkt", "factor_size", "factor_mom"} <= set(mine), "non-vacuity: the invented tilts clear the bar"
    assert "factor_growth" not in mine, "non-vacuity: no invented growth tilt, so a loading under the bar"
    assert 1.0 < mine["factor_mkt"] < 1.4 and 0 < mine["factor_r2"] < 1
    assert reach == FC.WINDOW + 1 + RC.FAST_PAD and ctx["factor_paths"] == {"fast": 1, "align": 0}
    assert "SPY" not in ctx["_reads"], "SPY is the build's own read, never read again"


def test_the_closes_are_price_reads_own_answer_on_ordinary_and_broken_bars():
    _days, _f, funds, stock = _market()
    assert RC._closes(stock, None) == PR._closes_answer("X", stock)["closes"]
    broken = [dict(b) for b in stock[-40:]]
    broken[3]["c"], broken[5]["c"], broken[7]["c"], broken[9]["c"] = 0.0, -2.0, float("nan"), float("inf")
    broken[11]["c"], broken[13]["c"], broken[15]["t"], broken[17]["t"] = None, "x", "20261301x", True
    broken[19]["t"] = f"{broken[19]['t'] // 10000:04d}-{broken[19]['t'] // 100 % 100:02d}-{broken[19]['t'] % 100:02d}"
    broken.append(dict(broken[-1], c=99.0))                      # a repeated date: the last bar of it is kept
    broken.insert(0, dict(broken[20]))                           # out of order
    assert RC._closes(broken, None) == PR._closes_answer("X", broken)["closes"]
    assert RC._closes(broken, KEY, 10) == [x for x in PR._closes_answer("X", broken)["closes"] if x[0] <= KEY][-10:]
    assert RC._closes([], None) == [] == RC._closes([{"t": 20261120, "c": 0}], None)


def test_the_fast_window_is_aligns_own_window_bit_for_bit():
    _days, _f, _funds, stock = _market()
    ctx = _ctx()
    fx = ctx["factors"]
    dates, y, f, keys, reach, path = RC.factor_inputs(stock, ctx)
    assert path == "fast" and reach == FC.WINDOW + 1 + RC.FAST_PAD
    closes = RC._closes(stock[-RC.FACTOR_TAIL:], KEY)
    first = closes[0][0]
    cut = {s: [x for x in v if x[0] >= first] for s, v in fx["series"].items()}
    d2, y2, f2, k2 = FC.align(closes, cut, fx["legs"])
    assert dates == d2[-FC.WINDOW:] and keys == k2
    assert np.array_equal(y, y2[-FC.WINDOW:]) and np.array_equal(f, f2[-FC.WINDOW:]), "bit for bit, not close"
    a, raw_a = FC.fit(dates, y, f, keys)
    b, raw_b = FC.fit(d2[-FC.WINDOW:], y2[-FC.WINDOW:], f2[-FC.WINDOW:], k2)
    assert a == b and raw_a == raw_b


def test_a_stock_with_a_gap_of_its_own_takes_align_and_equals_fctx(monkeypatch):
    days, _f, funds, stock = _market()
    gap = set(days[-90:-87])
    gappy = [b for b in stock if date(b["t"] // 10000, b["t"] // 100 % 100, b["t"] % 100) not in gap]
    ctx = _ctx()
    assert RC.factor_inputs(gappy, ctx)[-1] == "align"
    _held, answer = _fctx(monkeypatch, funds, gappy)
    _assert_equals_fctx(RC.factor_fields(gappy, ctx)[0], answer)
    assert ctx["factor_paths"]["align"] == 1


def test_a_fund_missing_sessions_reads_fctxs_whole_depth_and_still_equals_it(monkeypatch):
    days, _f, funds, stock = _market()
    holes = set(days[-200:-120])
    gappy = dict(funds, MTUM=[b for b in funds["MTUM"] if date(b["t"] // 10000, b["t"] // 100 % 100, b["t"] % 100)
                              not in holes])
    ctx = _ctx(gappy)
    mine, reach = RC.factor_fields(stock, ctx)
    _held, answer = _fctx(monkeypatch, gappy, stock)
    assert answer["now"]["returns"] == FC.WINDOW and reach > RC.FACTOR_TAIL, "the second, deeper read was needed"
    assert RC.factor_inputs(stock, ctx)[-1] == "align", "a session the funds do not all hold: never the fast path"
    _assert_equals_fctx(mine, answer)


def test_factors_use_fctxs_alternative_fund_or_none_without_a_market_fund(monkeypatch):
    _days, _f, funds, stock = _market()
    alt = {k: v for k, v in funds.items() if k != "IWM"}
    alt["VTWO"] = funds["IWM"]
    ctx = _ctx(alt)
    held, answer = _fctx(monkeypatch, alt, stock)
    assert ctx["factors"]["chosen"]["size"] == ("VTWO",) == held["chosen"]["size"]
    _assert_equals_fctx(RC.factor_fields(stock, ctx)[0], answer)
    none = _ctx({k: v for k, v in funds.items() if k != "SPY"}, spy=[])
    assert none["factors"]["state"] == "unavailable" and RC.factor_fields(stock, none)[0] == {}
    assert none["_reads"][0] == "IVV", "the market's alternative is looked at, then nothing else"


def test_factors_are_blank_with_too_little_overlap():
    _days, _f, _funds, stock = _market()
    assert RC.factor_fields(stock[-FC.MIN_OBS:], _ctx())[0] == {}
    assert RC.factor_fields(stock, None)[0] == {} and RC.factor_fields([], _ctx())[0] == {}


# ── up / down capture ─────────────────────────────────────────────────────────────────────────

def test_capture_is_stats_capture_against_spys_newest_closes():
    from api.services import stock_stats as STAT
    days, _f, funds, stock = _market()
    ctx = _ctx()
    spy = PR._closes_answer("SPY", funds["SPY"])["closes"][-STAT.BENCH_TAIL:]

    def stat_capture(bars):
        iso = [(f"{b['t'] // 10000:04d}-{b['t'] // 100 % 100:02d}-{b['t'] % 100:02d}", b["o"], b["h"], b["l"],
                b["c"], b["v"]) for b in bars]
        got = SC.beta_block(SC.closes_of(SC.clean_bars(iso)), spy, capture=True)
        return {"up_capture_1y": got["up_capture"], "down_capture_1y": got["down_capture"]}, got["returns"]

    got, reach = RC.capture_fields(stock, ctx)
    want, n = stat_capture(stock)
    assert got == want and n == BETA.WINDOW and reach == RC.CAPTURE_TAIL, "the newest year read first"
    # a stock halted for 180 sessions inside SPY's window: STAT reads it over its held sessions there (fewer than a
    # year of returns), never over older ones SPY's window does not reach
    halt = set(days[-380:-200])
    halted = [b for b in stock if date(b["t"] // 10000, b["t"] // 100 % 100, b["t"] % 100) not in halt]
    got, reach = RC.capture_fields(halted, ctx)
    want, n = stat_capture(halted)
    assert got == want and BETA.MIN_OBS <= n < BETA.WINDOW and reach == STAT.BENCH_TAIL - len(halt)
    # a stock moving exactly twice SPY every day captures 200% both ways
    days = [date(b["t"] // 10000, b["t"] // 100 % 100, b["t"] % 100) for b in funds["SPY"]]
    spy_r = [funds["SPY"][i]["c"] / funds["SPY"][i - 1]["c"] - 1 for i in range(1, len(days))]
    double = _from_returns(days[1:], [2 * r for r in spy_r])
    assert RC.capture_fields(double, ctx)[0] == {"up_capture_1y": 200.0, "down_capture_1y": 200.0}


def test_capture_is_blank_under_stats_minimums():
    _days, _f, _funds, stock = _market()
    assert RC.capture_fields(stock[-BETA.MIN_OBS:], _ctx())[0] == {}
    assert RC.capture_fields(stock, None)[0] == {}


# ── one row: the seam rule and the build step ─────────────────────────────────────────────────

def test_a_seam_withholds_each_column_whose_read_reaches_it():
    _days, _f, _funds, stock = _market()
    bars = [dict(b) for b in stock]
    ctx = _ctx(month=11)
    rep = date(bars[-12]["t"] // 10000, bars[-12]["t"] // 100 % 100, bars[-12]["t"] % 100)
    ctx["reports"]["ZZQS"] = {"report_date": rep.isoformat()}
    full = RC.row_fields(bars, ctx, ticker="zzqs", ipo_date="2026-06-01", security_type="Stock")
    assert full["post_earn_drift_5d"] is not None and full["factor_r2"] is not None
    assert full["up_capture_1y"] is not None and full["days_to_lockup"] is not None
    near = RC.row_fields(bars, ctx, ticker="ZZQS", ipo_date="2026-06-01", security_type="Stock", seam_since=20)
    assert near["post_earn_drift_5d"] == full["post_earn_drift_5d"], "the drift's read starts after the seam"
    assert near["factor_r2"] is None and near["up_capture_1y"] is None
    assert near["days_to_lockup"] == full["days_to_lockup"], "the lockup reads no bars"
    fresh = RC.row_fields(bars, ctx, ticker="ZZQS", seam_since=2)
    assert all(fresh[c] is None for c in RC.COLUMNS if c != "days_to_lockup")


def test_build_row_writes_the_row_columns_and_times_each_part():
    from api.services.screener import snapshot_builder as sb
    _days, _f, _funds, stock = _market()
    ctx = _ctx(month=11)
    row = sb.build_row("ZZQT", [dict(b) for b in stock], None, {"ipo_date": "2026-06-01"}, identity_state={},
                       rc_context=ctx)
    assert row["factor_r2"] is not None and row["up_capture_1y"] is not None
    assert ctx["rows"] == 1 and ctx["ms"] > 0 and set(ctx["part_ms"]) == set(RC.PARTS)
    assert row["days_to_lockup"] is None, "no Type for the row: not known to be a common stock"


def test_build_row_withholds_and_counts_a_contradicting_series():
    from tests.test_screener_series_seams import _dated, _with_ratios
    from api.services.screener import snapshot_builder as sb
    bars = _dated(_with_ratios(300, [0.489, 1.956, 0.493, 1.941], n_after=2))
    failures, ctx = {}, _ctx(month=11)
    row = sb.build_row("ZZQS", bars, None, {}, identity_state={}, failures=failures, rc_context=ctx)
    assert all(row[c] is None for c in RC.COLUMNS)
    assert failures["bars_row_columns"]["series_contradicts_itself"] == 1
    assert ctx["rows"] == 1 and ctx["seam_withheld"] == 1


def test_a_raising_step_costs_its_twelve_columns_never_the_row(monkeypatch):
    from api.services.screener import snapshot_builder as sb
    monkeypatch.setattr(RC, "row_fields", lambda *a, **k: (_ for _ in ()).throw(ValueError("boom")))
    failures = {}
    _days, _f, _funds, stock = _market()
    row = sb.build_row("ZZQU", [dict(b) for b in stock], None, {}, failures=failures)
    assert row["ticker"] == "ZZQU" and row["bars_asof"] is not None and row["hv_20"] is not None
    assert all(row[c] is None for c in RC.COLUMNS)
    assert failures["bars_row_columns"] == {"ValueError": 1}


def test_the_context_is_guarded_and_the_build_survives_it(monkeypatch):
    from api.services.screener import snapshot_builder as sb
    monkeypatch.setattr(RC, "build_context", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("store down")))
    failures = {}
    ctx = sb._row_columns_context(SESSION, [], None, failures)
    assert failures == {"row_columns_context": {"RuntimeError": 1}} and ctx["state"] == "failed"
    _days, _f, _funds, stock = _market()
    assert RC.row_fields(stock, ctx, ipo_date="2026-06-01", security_type="Stock")["factor_r2"] is None


# ── the build: one context, the columns land, the filters screen them ─────────────────────────

def test_the_build_reads_each_fund_once_and_writes_the_columns(tmp_path, monkeypatch):
    from api.services.screener import snapshot_builder as sb, snapshot_db, volume_volatility as VV
    from api.services.screener import (finviz_universe, earnings_dates, earnings_context, analyst_pass,
                                       insider_capture, short_columns, fund_trends, beats_insiders_funds as BIF,
                                       context_joins as cj)
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    snapshot_db.init_db()
    days, _f, funds, stock = _market()
    as_rows = lambda bars: [(b["t"], b["o"], b["h"], b["l"], b["c"], b["v"]) for b in bars]   # noqa: E731
    store = {k: as_rows(v) for k, v in funds.items()}
    store["ZZQA"], store["ZZQB"] = as_rows(stock), as_rows(stock[-15:])
    reads: dict = {}

    def get_bars(t, tf, n):
        reads[t] = reads.get(t, 0) + 1
        return store.get(t, [])
    import api.services.bars_sqlite as bs
    monkeypatch.setattr(bs, "get_bars", get_bars)
    monkeypatch.setattr(sb, "_load_universe", lambda: ["ZZQA", "ZZQB"])
    monkeypatch.setattr(sb, "_security_types", lambda: {"ZZQA": "Stock", "ZZQB": "Stock"})
    monkeypatch.setattr(sb, "_read_rs_map", lambda: {})
    monkeypatch.setattr(sb, "_read_bulk_fundamentals", lambda t, failures=None: {})
    monkeypatch.setattr(sb, "_read_ratings", lambda t, failures=None: {})
    listing = (date.today() - timedelta(days=100)).isoformat()
    monkeypatch.setattr(sb, "_read_fundamentals",
                        lambda t, price=None, failures=None: {"ipo_date": listing} if t == "ZZQA" else {})
    monkeypatch.setattr(sb, "settled_session", lambda now=None: SESSION)
    monkeypatch.setattr(sb, "_read_settled_bars", lambda d: {"error": "not in this test"})
    for fn in ("read_breadth_flags", "read_uct20", "read_index_flags", "read_etf_flags"):
        monkeypatch.setattr(cj, fn, lambda targets, failures=None: {})
    for mod, fn in ((finviz_universe, "read_finviz_fields"), (earnings_dates, "read_earnings_dates"),
                    (earnings_context, "read_last_report_move"), (earnings_context, "read_implied_context"),
                    (analyst_pass, "read_analyst_fields"), (insider_capture, "read_insider_fields")):
        monkeypatch.setattr(mod, fn, lambda targets, failures=None: {})
    monkeypatch.setattr(short_columns, "read_short_columns", lambda t, failures=None, receipt=None: {})
    monkeypatch.setattr(fund_trends, "read_fields", lambda t, failures=None, settled=None, receipt=None: {})
    rep = days[-12].isoformat()

    def earnings(t, failures=None, session=None, receipt=None, reports=None):
        reports["ZZQA"] = {"report_date": rep, "label": "Q3"}
        return {}
    monkeypatch.setattr(BIF, "read_earnings_fields", earnings)
    monkeypatch.setattr(BIF, "read_insider_fields", lambda t, failures=None, session=None, receipt=None: {})
    monkeypatch.setattr(BIF, "read_fund_fields", lambda t, failures=None, receipt=None: {})
    monkeypatch.setattr(sb, "_read_store_columns", lambda targets, failures, session: ({}, {}))
    monkeypatch.setattr(VV, "index_context", lambda now=None: {"state": "not_held", "rows": 0, "ms": 0.0,
                                                               "seam_withheld": 0})

    out = sb.run_build(max_tickers=2)
    assert out["built"] == 2
    for sym in ("SPY", "IWM", "IWF", "IWD", "MTUM", "QUAL", "USMV"):
        assert reads.get(sym) == 1, f"{sym}: one read per build, never one per ticker ({reads})"
    assert not {"IVV", "VTWO", "VUG", "VTV", "SPMO", "SPHQ", "SPLV"} & set(reads), "no alternative was needed"
    r = out["row_columns"]
    assert r["funds_state"] == "ok" and r["rows"] == 2 and r["month"] == SESSION.month and r["reports"] == 1
    assert r["ms_per_row"] is not None and set(r["part_ms"]) == set(RC.PARTS) and r["session"] == KEY
    a, b = snapshot_db.get_row("ZZQA"), snapshot_db.get_row("ZZQB")
    assert a["factor_r2"] is not None and a["factor_mkt"] is not None and a["up_capture_1y"] is not None
    assert a["post_earn_drift_5d"] is not None and isinstance(a["days_to_lockup"], int)
    assert all(b[c] is None for c in RC.COLUMNS), "fifteen sessions and no listing date hold none: NULL, never 0"
    assert out["populated"]["factor_r2"] == 1 and out["populated"]["days_to_lockup"] == 1


def test_the_filters_screen_the_row_columns_end_to_end(tmp_path, monkeypatch):
    from tests.test_screener_filters import _snapshot
    day = "2026-11-21"
    _snapshot(tmp_path, monkeypatch, [
        {"ticker": "ZZQA", "days_to_lockup": 12, "seas_month_avg": 3.4, "seas_month_up_pct": 75, "seas_month_years": 12,
         "post_earn_drift_5d": 6.5, "factor_mkt": 1.4, "factor_size": 0.8, "factor_growth": 0.5, "factor_mom": 0.3,
         "factor_r2": 0.62, "up_capture_1y": 130.0, "down_capture_1y": 90.0, "snapshot_date": day, "built_at": 1},
        {"ticker": "ZZQB", "days_to_lockup": -3, "seas_month_avg": -1.5, "seas_month_up_pct": 40, "seas_month_years": 8,
         "post_earn_drift_5d": -4.0, "factor_mkt": 0.7, "factor_size": -0.4, "factor_growth": -0.6, "factor_r2": 0.21,
         "up_capture_1y": 70.0, "down_capture_1y": 115.0, "snapshot_date": day, "built_at": 1},
        {"ticker": "ZZQD", "snapshot_date": day, "built_at": 1},       # NULL: inside no range
    ])
    from api.services.screener import query
    importlib.reload(query)

    def tickers(*fs):
        return sorted(r["ticker"] for r in query.run_scan({"filters": list(fs)})["rows"])

    assert tickers({"key": "days_to_lockup", "op": "between", "min": 0, "max": 30}) == ["ZZQA"]
    assert tickers({"key": "days_to_lockup", "op": "lt", "max": 0}) == ["ZZQB"]
    assert tickers({"key": "seas_month_avg", "op": "gt", "min": 0}) == ["ZZQA"]
    assert tickers({"key": "seas_month_up_pct", "op": "gte", "min": 70}) == ["ZZQA"]
    assert tickers({"key": "seas_month_years", "op": "gte", "min": 5}) == ["ZZQA", "ZZQB"]
    assert tickers({"key": "post_earn_drift_5d", "op": "lt", "max": 0}) == ["ZZQB"]
    assert tickers({"key": "factor_mkt", "op": "gt", "min": 1}) == ["ZZQA"]
    assert tickers({"key": "factor_size", "op": "gt", "min": 0}) == ["ZZQA"]
    assert tickers({"key": "factor_growth", "op": "lt", "max": 0}) == ["ZZQB"]
    assert tickers({"key": "factor_mom", "op": "gt", "min": 0}) == ["ZZQA"], "a loading under the bar is not 0"
    assert tickers({"key": "factor_r2", "op": "gte", "min": 0.5}) == ["ZZQA"]
    assert tickers({"key": "up_capture_1y", "op": "gt", "min": 100}, {"key": "down_capture_1y", "op": "lt",
                                                                      "max": 100}) == ["ZZQA"]


# ── the registry, the client text, the methodology ────────────────────────────────────────────

def test_each_column_is_a_bare_member_control_in_its_family_with_a_seat_in_its_view():
    from api.services.screener import filters, snapshot_db
    assert {"key": RC.FACTOR_CATEGORY, "label": RC.FACTOR_CATEGORY_LABEL} in filters.CATEGORIES
    labels = [c["label"] for c in filters.CATEGORIES]
    assert len(labels) == len(set(labels)), "no two categories share a label"
    catalog = {f["key"]: f for f in filters.field_catalog()}
    seat = {"events": "events", "performance": "performance", RC.FACTOR_CATEGORY: RC.FACTOR_CATEGORY}
    words = ("accum", "distrib", "a/d", "acc/dis")
    for c in RC.COLUMNS:
        f = filters.FILTERS[c]
        assert f["column"] == c and f["type"] == "range" and f["allow_custom"] is True
        assert f["category"] == RC.CATEGORY[c] and [p["label"] for p in f["presets"]] == ["Any"]
        assert f["presets_deferred"] is True and f.get("agent_omit") is True and catalog[c].get("agent_omit"), c
        assert c in filters.VIEWS[seat[f["category"]]]["columns"] and c in snapshot_db.COLUMNS, c
        assert not any(w in (c + " " + f["label"]).lower() for w in words), "the owner's A/D-line hold"
    assert {k for k, f in filters.FILTERS.items() if f["category"] == RC.FACTOR_CATEGORY} == \
        set(RC.FACTOR_COLUMNS + RC.CAPTURE_COLUMNS)
    assert "post_earn_drift_5d" in filters.VIEWS["beats_insiders_funds"]["columns"]
    assert "beta" in filters.VIEWS[RC.FACTOR_CATEGORY]["columns"], "the vendor's beta sits beside the loadings"
    assert set(RC.INT_COLUMNS) <= snapshot_db._INT
    assert not (set(RC.COLUMNS) - set(RC.INT_COLUMNS)) & (snapshot_db._INT | snapshot_db._TEXT)


def test_the_client_text_states_the_owners_numbers():
    from api.services import stock_stats as STAT                                   # noqa: F401
    from api.services.screener import snapshot_builder as sb
    from tests.test_screener_filters import _column_def_block as block
    lock = block("days_to_lockup")
    assert f"plus {IPO.LOCKUP_DAYS} days" in lock and f"shown for {IPO.BEHIND_DAYS} days" in lock
    assert f"more than {IPO.BEHIND_DAYS} days past" in lock
    seas = block("seas_month_avg")
    assert f"fewer than {SEAS.MIN_YEARS} such years" in seas and f"up to {sb.DEEP_BARS:,} sessions" in seas
    assert f"about {sb.DEEP_BARS // 252} years" in seas and f"Blank under {SEAS.MIN_YEARS}" in block("seas_month_years")
    drift = block("post_earn_drift_5d")
    assert f"in the {ERX.DRIFT} sessions after" in drift and f"close {ERX.DRIFT} sessions later" in drift
    spreads = {f["key"]: f["options"][0] for f in FC.FACTORS}
    for key, col in RC.FACTOR_LOADINGS.items():
        text = block(col)
        assert f"over the last {FC.WINDOW} sessions" in text and f"fewer than {FC.MIN_OBS} shared sessions" in text
        assert f"t-statistic is above {FC.T_BAR:g}" in text, col
    assert f"({spreads['size'][0]} less SPY)" in block("factor_size")
    assert f"({spreads['growth'][0]} less {spreads['growth'][1]})" in block("factor_growth")
    assert f"({spreads['momentum'][0]} less SPY)" in block("factor_mom")
    for col, side in (("up_capture_1y", "up"), ("down_capture_1y", "down")):
        text = block(col)
        assert f"over the last {BETA.WINDOW} sessions" in text and f"fewer than {BETA.MIN_OBS} shared sessions" in text
        assert f"fewer than {SC.CAPTURE_MIN_DAYS} {side} days" in text


def test_every_column_publishes_a_method_with_its_owners_definition():
    from api.services.screener import methodology as M
    doc = M.all_methods()
    published = {m["column"]: m for m in doc["methods"]}
    for c in RC.COLUMNS:
        m = published.get(c)
        assert m is not None, f"{c} ships without a method"
        assert m["family"] == "row_columns" and m["one_line"] and m["scale"] and m["how"] and m["caveat"]
        assert "never 0" in m["caveat"], c
    assert "IPO LOCKUP's estimate" in published["days_to_lockup"]["how"]
    assert "estimate" in published["days_to_lockup"]["caveat"] and "prospectus" in published["days_to_lockup"]["caveat"]
    assert "SEAS's month figures" in published["seas_month_avg"]["how"]
    assert "ERX's drift" in published["post_earn_drift_5d"]["how"]
    assert "pending, never 0" in published["post_earn_drift_5d"]["caveat"]
    for c in RC.FACTOR_LOADINGS.values():
        assert "FCTX's regression" in published[c]["how"] and "too uncertain to read" in published[c]["caveat"]
    assert "STAT's capture" in published["up_capture_1y"]["how"]
    assert doc["row_columns"]["columns"] == list(RC.COLUMNS)


def test_the_row_methods_are_read_from_the_owners(monkeypatch):
    from api.services import stock_stats as STAT
    from api.services.screener import methodology as M
    monkeypatch.setattr(IPO, "LOCKUP_DAYS", 90)
    monkeypatch.setattr(IPO, "BEHIND_DAYS", 3)
    monkeypatch.setattr(SEAS, "MIN_YEARS", 7)
    monkeypatch.setattr(ERX, "DRIFT", 10)
    monkeypatch.setattr(FC, "T_BAR", 3.0)
    monkeypatch.setattr(SC, "CAPTURE_MIN_DAYS", 15)
    monkeypatch.setattr(STAT, "BENCH_TAIL", 300)
    by = {m["column"]: m for m in M._row_methods()}
    assert "plus 90 calendar days" in by["days_to_lockup"]["how"]
    assert "more than 3 days past" in by["days_to_lockup"]["caveat"] and "last 93 days" in by["days_to_lockup"]["caveat"]
    assert "fewer than 7 such years" in by["seas_month_years"]["caveat"]
    assert by["post_earn_drift_5d"]["label"] == "Drift 10 Days After Last Report"
    assert "|t| above 3," in by["factor_mom"]["caveat"]
    assert "fewer than 15 such days" in by["down_capture_1y"]["caveat"]
    assert "newest 300 closes" in by["up_capture_1y"]["how"]
