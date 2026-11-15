"""``api.services.listing_break``: where a symbol's CURRENT listing starts in the store.

Why it exists (production, 2026-11-12): the bars store keeps a recycled or renamed
symbol's earlier security in front of its own bars. The chart drops it at serve time;
the RS Rating and the screener build read the store whole, so BNY (a $10 fund, then a
$139 bank) rated 99 and drew its 200-day line across two securities.
"""
from __future__ import annotations

import inspect
from datetime import date, timedelta

from api.services import bars_sanitize, bars_sqlite, listing_break as lb
from api.services.screener import snapshot_builder as b


def _weekdays_ending(end: date, n: int) -> list:
    out, d = [], end
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d -= timedelta(days=1)
    return sorted(out)


def _ymd(d: date) -> int:
    return int(d.strftime("%Y%m%d"))


def _two_lives(gap_days, old_close, new_close, old_bars=200, new_bars=150, end=date(2026, 11, 12)):
    new_days = _weekdays_ending(end, new_bars)
    old_days = _weekdays_ending(new_days[0] - timedelta(days=gap_days), old_bars)
    ts = [_ymd(d) for d in old_days + new_days]
    return ts, [float(old_close)] * old_bars + [float(new_close)] * new_bars


def _bars(ts, closes):
    return [{"t": t, "o": c, "h": c, "l": c, "c": c, "v": 1000} for t, c in zip(ts, closes)]


# ── the rule ───────────────────────────────────────────────────────────────

def test_the_three_numbers_are_the_charts_and_the_bars_stores():
    params = inspect.signature(bars_sqlite.current_listing_starts).parameters
    assert lb.GAP_DAYS == bars_sanitize._GAP_MIN_DAYS == params["gap_days"].default
    assert lb.PRICE_FACTOR == bars_sanitize._REUSE_PRICE_FACTOR == params["price_factor"].default
    assert lb.GAP_STANDALONE_DAYS == bars_sanitize._GAP_STANDALONE_DAYS


def test_is_break_reads_the_gap_and_the_price():
    assert lb.is_break(104, 10.20, 138.98) is True, "BNY: a fund, then a bank"
    assert lb.is_break(4317, 8.91, 40.50) is True, "BSP"
    assert lb.is_break(17, 44.45, 41.18) is False, "BSP's 17-day hole inside its real history"
    assert lb.is_break(60, 50.0, 55.0) is False, "a two-month halt of one company"
    assert lb.is_break(60, 50.0, 199.0) is False and lb.is_break(60, 50.0, 200.0) is True
    assert lb.is_break(60, 200.0, 50.0) is True, "four-fold either way"
    assert lb.is_break(149, 50.0, 55.0) is False and lb.is_break(150, 50.0, 55.0) is True
    assert lb.is_break(20, 1.0, 400.0) is False, "under 21 days is never a listing break"


def test_a_dead_close_is_no_evidence():
    for prev, cur in ((0.0, 55.0), (None, 55.0), (50.0, None), (50.0, 0.0), ("x", 5.0)):
        assert lb.is_break(60, prev, cur) is False, (prev, cur)
    assert lb.is_break(200, None, None) is True, "the long gap stands on its own"


def test_start_index_is_the_bar_after_the_newest_break():
    ts, closes = _two_lives(104, 10.0, 140.0)
    assert lb.start_index(ts, closes) == 200
    assert lb.start_index(ts, closes, lo=250) == 250, "no break inside the range asked for"
    assert lb.start_index(ts, closes, lo=0, hi=200) == 0, "a range that ends before the break is one listing"
    assert lb.start_index([], []) == 0 and lb.start_index([20261112], [5.0]) == 0


def test_three_lives_keep_only_the_newest():
    a = _weekdays_ending(date(2015, 6, 30), 50)
    bb = _weekdays_ending(date(2021, 6, 30), 50)
    c = _weekdays_ending(date(2026, 11, 12), 50)
    ts = [_ymd(d) for d in a + bb + c]
    closes = [5.0] * 50 + [30.0] * 50 + [90.0] * 50
    assert lb.start_index(ts, closes) == 100


def test_a_continuous_series_is_returned_as_the_same_object():
    days = _weekdays_ending(date(2026, 11, 12), 300)
    bars = _bars([_ymd(d) for d in days], [100.0 + i for i in range(300)])
    assert lb.current_listing(bars) is bars
    assert lb.current_listing([]) == [] and lb.current_listing(None) is None


def test_current_listing_drops_the_earlier_security():
    ts, closes = _two_lives(104, 10.0, 140.0)
    kept = lb.current_listing(_bars(ts, closes))
    assert len(kept) == 150 and min(x["c"] for x in kept) == 140.0
    assert kept[0]["t"] == ts[200]


def test_an_unreadable_date_leaves_the_series_alone():
    ts, closes = _two_lives(104, 10.0, 140.0)
    bars = _bars(ts, closes)
    bars[3]["t"] = "not a date"
    assert lb.current_listing(bars) is bars


def test_it_agrees_with_the_charts_cut_on_the_production_shapes():
    """The chart's cleaner works on ISO dates and its LARGEST gap; with one earlier
    life the two must keep exactly the same bars."""
    for gap, old, new in ((104, 10.20, 138.98), (4317, 8.91, 40.50), (60, 50.0, 55.0), (17, 44.45, 41.18)):
        ts, closes = _two_lives(gap, old, new)
        mine = lb.current_listing(_bars(ts, closes))
        iso = [{"t": f"{t // 10000:04d}-{t // 100 % 100:02d}-{t % 100:02d}", "c": c} for t, c in zip(ts, closes)]
        theirs = bars_sanitize._apply_listing_cutoff(iso, None)
        assert len(mine) == len(theirs), (gap, old, new)


# ── the screener build reads the current listing only ───────────────────────────

def test_the_builds_bar_reader_drops_the_earlier_security(monkeypatch):
    ts, closes = _two_lives(104, 10.0, 140.0)
    rows = [(t, c, c, c, c, 1000) for t, c in zip(ts, closes)]
    asked = {}

    def get_bars(ticker, tf, n):
        asked.update(ticker=ticker, tf=tf, n=n)
        return rows
    monkeypatch.setattr(bars_sqlite, "get_bars", get_bars)
    bars = b._read_daily_bars("BNY")
    assert asked == {"ticker": "BNY", "tf": "D", "n": b.DEEP_BARS}
    assert len(bars) == 150 and all(x["c"] == 140.0 for x in bars)
    assert set(bars[0]) == {"t", "o", "h", "l", "c", "v"}


def test_the_builds_bar_reader_leaves_an_ordinary_stock_whole(monkeypatch):
    days = _weekdays_ending(date(2026, 11, 12), 400)
    rows = [(_ymd(d), 1.0, 2.0, 0.5, 100.0 + i, 1000) for i, d in enumerate(days)]
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda ticker, tf, n: rows)
    bars = b._read_daily_bars("AAPL")
    assert len(bars) == 400 and bars[0]["c"] == 100.0 and bars[-1]["h"] == 2.0


def test_a_row_built_from_a_recycled_symbol_measures_its_own_listing(monkeypatch):
    """150 bars of the bank after 200 of the fund. Read whole, the row said the stock
    was up 1,449% on the year, 37% above a 200-day line and in a full-bull stack. Read
    as its own listing, every measure that needs a year it does not have is blank and
    the ones it can support (the 50-day) are unchanged."""
    from api.services.screener import technicals
    ts, closes = _two_lives(104, 10.0, 140.0)
    closes = closes[:200] + [140.0 + 0.1 * i for i in range(150)]
    rows = [(t, c, c, c, c, 1000) for t, c in zip(ts, closes)]
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda ticker, tf, n: rows)
    own = technicals.compute_technicals(b._read_daily_bars("BNY"))
    whole = technicals.compute_technicals(_bars(ts, closes))
    assert whole["chg_pct_1y"] > 1000.0 and whole["dist_52w_low_pct"] > 1000.0, "what the cut refuses"
    assert whole["pct_vs_sma200"] > 30.0 and whole["ma_stack"] == "full-bull"
    for key in ("chg_pct_1y", "dist_52w_low_pct", "dist_52w_high_pct", "pct_vs_sma200", "ma_stack"):
        assert own[key] is None, key
    assert own["pct_vs_sma50"] == whole["pct_vs_sma50"], "150 of its own bars carry the 50-day either way"
