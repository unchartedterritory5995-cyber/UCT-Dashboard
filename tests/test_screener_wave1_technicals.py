"""Wave 1 bar-derived fields — hand-computed expectations on synthetic bars."""
from api.services.screener import technicals


def bar(c, o=None, h=None, l=None, v=1000, t=None):
    o = c if o is None else o
    return {"o": o, "h": h if h is not None else max(o, c) + 0.5,
            "l": l if l is not None else min(o, c) - 0.5, "c": c, "v": v, "t": t}


def flat(n, price=100.0, start_t=20250102):
    # t values only need YYYY prefixes to be right for the YTD test
    return [bar(price, t=start_t + i) for i in range(n)]


def test_one_year_change_needs_253_closes():
    out = technicals.compute_technicals(flat(252))
    assert out["chg_pct_1y"] is None
    bars = flat(253)
    bars[0]["c"] = 80.0
    out = technicals.compute_technicals(bars)
    assert out["chg_pct_1y"] == 25.0  # 100 vs 80


def test_ytd_uses_last_close_of_prior_year():
    prior = [bar(90.0, t=20251230), bar(80.0, t=20251231)]
    this = [bar(100.0, t=20260102 + i) for i in range(30)]
    out = technicals.compute_technicals(prior + this)
    assert out["chg_pct_ytd"] == 25.0  # vs 80, the LAST prior-year close
    # a name listed this year has no baseline
    assert technicals.compute_technicals(this)["chg_pct_ytd"] is None


def test_change_from_open_and_prev_day_levels():
    bars = flat(30)
    bars[-2] = bar(102.0, o=101.0, h=103.0, l=100.5)
    bars[-1] = bar(105.0, o=100.0)
    out = technicals.compute_technicals(bars)
    assert out["chg_from_open_pct"] == 5.0
    assert out["prev_day_high"] == 103.0
    assert out["prev_day_low"] == 100.5
    assert out["prev_day_close"] == 102.0
    assert out["prev_day_open"] == 101.0


def test_adr_1w_and_20d_extremes():
    bars = flat(30)  # every bar h=c+0.5, l=c-0.5 → range 1.0 on close 100
    out = technicals.compute_technicals(bars)
    assert out["adr_pct_1w"] == 1.0
    assert out["dist_20d_high_pct"] == -0.5  # 100 vs high 100.5
    assert out["dist_20d_low_pct"] == 0.5


def test_pole_pct_trough_to_peak():
    closes = [100.0] * 10 + [80.0] + [120.0] + [110.0] * 10  # trough 80 → peak 120
    assert technicals._pole_pct(closes) == 50.0
    assert technicals._pole_pct([100.0] * 4) is None  # <5 → not computable
    assert technicals._pole_pct([120.0] + [100.0] * 10) == 0.0  # peak first → no pole


def test_rs_line_trend_port():
    spy = [100.0] * 20
    rising = [100.0 + i for i in range(20)]
    assert technicals.rs_line_trend(rising, spy) == "up"
    assert technicals.rs_line_trend(list(reversed(rising)), spy) == "down"
    assert technicals.rs_line_trend([100.0] * 20, spy) == "flat"
    assert technicals.rs_line_trend([100.0] * 4, spy) is None


def test_atr_ext_sma50_flat_tape_is_zero_extension():
    bars = flat(60)
    out = technicals.compute_technicals(bars)
    # price == SMA50 == 100, ATR == 1.0 → extension 0.0
    assert out["atr_ext_sma50"] == 0.0
