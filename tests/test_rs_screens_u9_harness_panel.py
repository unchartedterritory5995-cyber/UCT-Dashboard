"""RS screens unit U9, part 4: one symbol on one formation date (``rs_leader_test.panel``).

Each rule of the specification's universe, gate and return is exercised on a series
built for it, with the expected value recomputed from the series' own closed form:

  * the universe: close >= $10, 30-session dollar volume >= $20M, 253 bars in the
    current listing;
  * the gate's bar tests: daily range, the 200-day pair, the 252-session high, the RS
    line against its 21 EMA (the rating test is the cross-section's);
  * the return: entry at the next open, exit at the close h sessions on, on the
    benchmark's sessions; a window that is not over, has a gap, an unadjusted split or
    a bad price has NO return and is counted.

And the point-in-time property at its root: a symbol's values on a date are the same
whether or not the bars after that date exist.
"""
from __future__ import annotations

import datetime as dt
import random
from collections import Counter

import pytest

from api.services.rs_leader_test import panel, spec
from tests import rs_leader_test_fixture as fx

F = 600                         # the formation bar used throughout (a bar index)
DAY = fx.YMD[F]
FAR = fx.YMD[-1]                # a limit that cuts nothing


def dicts(rows):
    return [{"t": t, "o": o, "h": h, "l": l, "c": c, "v": v} for t, o, h, l, c, v in rows]


SPY = dicts(fx.bars(fx.closes(fx.BENCH_DRIFT, 300.0), spread=0.005, volume=50_000_000))
CAL = panel.Calendar(SPY)
DRIFT = 0.001


def leader(**kw):
    return dicts(fx.bars(fx.closes(kw.pop("drift", DRIFT), kw.pop("start", 20.0)), **kw))


def book(bars, dates=(DAY,), *, limit=FAR, declared=None, cal=CAL, development_end=None):
    books = {d: panel.DateBook() for d in dates}
    counts = Counter()
    panel.add_symbol("TEST", bars, cal, {d: limit for d in dates}, books, counts,
                     declared=declared, development_end=development_end)
    return books, counts


def one(bars, **kw):
    """``(member tuple or None, candidate dict or None, counts)`` on the formation day."""
    books, counts = book(bars, **kw)
    members = list(books[DAY].members())
    return (members[0] if members else None), books[DAY].candidates.get("TEST"), counts


def grow(k, h, drift=DRIFT):
    return fx.growth(drift, k, h)


# ───────────────────────── a leader, every value by its closed form ──────────

def test_a_steady_leader_on_one_date():
    member, cand, counts = one(leader())
    ticker, steady, change, adr, forward = member
    assert ticker == "TEST" and steady == 1.0, "it rose on every day of the Steady window"
    assert change == round((grow(F - 21, 21) - 1) * 100, 2), "the 21-session change"
    assert adr == 4.0, "high 2% over the close, low 2% under"
    for h in spec.HORIZONS:
        # the open of the next session is the formation close in this fixture
        assert forward[h] == pytest.approx((grow(F, h) - 1) * 100, abs=1e-9), h
    assert cand["px_below_high_pct"] == 0.0 and cand["rs_line_below_high_pct"] == 0.0
    assert cand["extended"] is False
    fav, adv = cand["excursion"][10]
    assert fav == pytest.approx((grow(F, 10) * 1.02 - 1) * 100 / 4.0, abs=1e-9)
    assert adv == pytest.approx((grow(F, 1) * 0.98 - 1) * 100 / 4.0, abs=1e-9)
    assert set(cand["excursion"]) == {10, 21}
    assert counts == {"symbols_liquid_on_a_date": 1, "symbols_split_list_unknown": 1}


def test_values_on_a_date_do_not_depend_on_the_bars_after_it():
    """A noisy series, three dates. Everything that describes the date (Steady, the
    1-month change, the daily range, both below-high measures, the extended flag, and
    whether it is a candidate at all) is identical when the series stops on that date.
    Only the outcomes need the future."""
    rng = random.Random(4)
    closes = [30.0]
    for _ in range(fx.N - 1):
        closes.append(closes[-1] * (1.0 + 0.0012 + rng.gauss(0, 0.012)))
    rows = [(fx.YMD[n], closes[n - 1] if n else c, c * (1 + rng.uniform(0.012, 0.03)),
             c * (1 - rng.uniform(0.012, 0.03)), c, 3_000_000) for n, c in enumerate(closes)]
    bars = dicts(rows)
    seen = 0
    for f in (500, 800, 1100, 1400):
        day = fx.YMD[f]
        full, _ = book(bars, (day,))
        cut, _ = book(bars[:f + 1], (day,))
        a, b = list(full[day].members()), list(cut[day].members())
        assert [m[:4] for m in a] == [m[:4] for m in b], f
        ca, cb = full[day].candidates.get("TEST"), cut[day].candidates.get("TEST")
        assert (ca is None) == (cb is None), f
        if ca:
            seen += 1
            assert {k: ca[k] for k in ("px_below_high_pct", "rs_line_below_high_pct", "extended")} == \
                   {k: cb[k] for k in ("px_below_high_pct", "rs_line_below_high_pct", "extended")}
            assert cb["excursion"] == {} and ca["excursion"], "the cut series has no outcome"
        assert all(v is None for v in b[0][4].values()) and a[0][4][5] is not None
    assert seen >= 2, "the fixture must reach the gate on some dates"


# ───────────────────────── the universe ─────────────────────────────────────

def test_the_price_floor_is_ten_dollars_inclusive():
    exact = leader()
    scale = 10.0 / exact[F]["c"]
    at_ten = [{**b, **{k: b[k] * scale for k in "ohlc"}, "v": 10_000_000} for b in exact]
    assert at_ten[F]["c"] == pytest.approx(10.0)
    at_ten[F]["c"] = 10.0
    assert one(at_ten)[0] is not None
    at_ten[F]["c"] = 9.99
    assert one(at_ten)[0] is None


def test_the_dollar_volume_floor_is_the_close_times_the_30_session_mean_volume():
    bars = leader()
    c = bars[F]["c"]
    need = 20_000_000.0 / c                       # shares a day for exactly $20M
    for b in bars[F - 29:F + 1]:
        b["v"] = need + 1
    assert one(bars)[0] is not None
    for b in bars[F - 29:F + 1]:
        b["v"] = need - 1
    assert one(bars)[0] is None
    # the session before the 30 is not read: a huge volume there changes nothing
    bars[F - 30]["v"] = 10 ** 12
    assert one(bars)[0] is None
    # ... and each of the 30 is: one large session lifts the mean over the floor
    bars[F - 29]["v"] = need * 40
    assert one(bars)[0] is not None


def test_the_listing_must_hold_253_bars_on_the_date():
    bars = leader()
    member, _c, counts = one(bars[F - 252:])
    assert member is not None, "253 bars, the formation bar included"
    member, _c, counts = one(bars[F - 251:])
    assert member is None and counts["dates_short_listing"] == 1
    _m, _c, counts = one(bars[F - 100:F + 100])
    assert counts == {"symbols_short_history": 1}


def test_an_earlier_listing_does_not_count_toward_the_253():
    """A recycled symbol: 400 bars of an old security, a 200-day gap, then the stock.
    On a date 100 bars into the new listing it is not in the universe; 252 bars in, it is."""
    new = leader()[F - 100:]
    first = dt.date(new[0]["t"] // 10000, new[0]["t"] // 100 % 100, new[0]["t"] % 100)
    old_days = fx.weekdays(400, first - dt.timedelta(days=200 + 600))
    old = [{"t": d.year * 10000 + d.month * 100 + d.day, "o": 5.0, "h": 5.1, "l": 4.9, "c": 5.0,
            "v": 9_000_000} for d in old_days]
    assert old[-1]["t"] < new[0]["t"]
    bars = old + new
    assert panel.listing_breaks([b["t"] for b in bars], [b["c"] for b in bars]) == [400]
    member, _c, counts = one(bars)
    assert member is None and counts["dates_short_listing"] == 1
    later = fx.YMD[F - 100 + 252]
    books, _ = book(bars, (later,))
    assert len(books[later].tickers) == 1
    # without the break the old bars would have counted: the control
    joined = [{**b, "t": fx.YMD[n]} for n, b in enumerate((old + new)[-(F + 1):])]
    assert one(joined)[0] is not None


# ───────────────────────── the gate's bar tests ─────────────────────────────

def test_the_daily_range_must_be_three_percent():
    assert one(leader(spread=0.015))[1] is not None, "exactly 3.0%"
    member, cand, _ = one(leader(spread=0.0149))
    assert member[3] == 2.98 and cand is None, "liquid, in the baseline of all, not a candidate"


def test_the_daily_range_is_the_mean_of_the_last_21_sessions():
    """Twenty sessions with a 4% range and one, the 21st counting back from the date,
    with a 46% range: (20 x 4 + 46) / 21 = 6.0%. A wide session one further back is
    outside the 21 and changes nothing."""
    bars = leader()
    bars[F - 20]["h"], bars[F - 20]["l"] = bars[F - 20]["c"] * 1.23, bars[F - 20]["c"] * 0.77
    assert one(bars)[0][3] == 6.0
    bars = leader()
    bars[F - 21]["h"], bars[F - 21]["l"] = bars[F - 21]["c"] * 1.23, bars[F - 21]["c"] * 0.77
    assert one(bars)[0][3] == 4.0


def test_a_close_under_a_still_rising_200_day_average_is_not_a_candidate():
    """The stock rose 0.2% a session and then fell 0.3% a session for the 60 sessions to
    the date: its close is under its 200-day average while that average is still above
    its level of 20 sessions ago, it is within 25% of its high, and (against a benchmark
    that fell faster) its RS line is rising. Only the close-above-the-average test fails."""
    up = [40.0 * 1.002 ** n for n in range(F - 59)]
    down = [up[-1] * 0.997 ** n for n in range(1, fx.N - len(up) + 1)]
    bars = dicts(fx.bars(up + down))
    spy_up = [300.0 * 1.0002 ** n for n in range(F - 59)]
    spy_down = [spy_up[-1] * 0.995 ** n for n in range(1, fx.N - len(spy_up) + 1)]
    cal = panel.Calendar(dicts(fx.bars(spy_up + spy_down, spread=0.005, volume=50_000_000)))
    closes = [b["c"] for b in bars]
    now = sum(closes[F - 199:F + 1]) / 200
    then = sum(closes[F - 219:F - 19]) / 200
    assert closes[F] < now and now > then, "under the average, and the average still rising"
    assert closes[F] / max(b["h"] for b in bars[F - 251:F + 1]) - 1 > -0.25
    member, cand, _ = one(bars, cal=cal)
    assert member is not None and member[3] == 4.0 and cand is None
    # the same stock one session before it crossed under is a candidate: every other test passes
    cross = next(i for i in range(F - 59, F + 1) if closes[i] < sum(closes[i - 199:i + 1]) / 200)
    before = fx.YMD[cross - 1]
    books, _ = book(bars, (before,), cal=cal)
    assert "TEST" in books[before].candidates


def test_the_close_must_be_above_a_200_day_average_that_is_rising():
    # rises, then falls 0.2% a session for the last 150: under its 200-day average
    rising = fx.closes(DRIFT)[:F - 149]
    falling = [rising[-1] * 0.998 ** n for n in range(1, fx.N - len(rising) + 1)]
    under = dicts(fx.bars(rising + falling))
    member, cand, _ = one(under)
    assert member is not None and cand is None
    avg = sum(b["c"] for b in under[F - 199:F + 1]) / 200
    assert under[F]["c"] < avg
    # falls for 400 sessions, then jumps 60% on the formation day: above the average,
    # which is still lower than it was 20 sessions ago
    down = [200.0 * 0.999 ** n for n in range(F)]
    jump = [down[-1] * 1.6 * 1.001 ** n for n in range(fx.N - F)]
    spike = dicts(fx.bars(down + jump))
    now = sum(b["c"] for b in spike[F - 199:F + 1]) / 200
    then = sum(b["c"] for b in spike[F - 219:F - 19]) / 200
    assert spike[F]["c"] > now and now < then
    member, cand, _ = one(spike)
    assert member is not None and cand is None


def test_the_close_must_be_within_25_percent_of_the_252_session_high():
    """One session 100 bars back printed a high 45% over its close; the stock has gained
    about 10.5% since: (1.105 / 1.45 - 1) = -23.8%, inside. At 50% over: -26.3%, outside.
    The high is the intraday one, the screener's own."""
    inside, outside = leader(), leader()
    inside[F - 100]["h"] = inside[F - 100]["c"] * 1.45
    outside[F - 100]["h"] = outside[F - 100]["c"] * 1.50
    assert one(inside)[1] is not None and one(outside)[1] is None
    # 252 sessions counting the formation bar: a spike 252 bars back is not read
    old = leader()
    old[F - 252]["h"] = old[F - 252]["c"] * 5
    assert one(old)[1] is not None
    edge = leader()
    edge[F - 251]["h"] = edge[F - 251]["c"] * 5
    assert one(edge)[1] is None


def test_the_rs_line_must_be_at_or_above_its_21_ema():
    """A stock that rises more slowly than the benchmark on every session: an uptrend at
    its own high, and an RS line that falls every day, under its average."""
    member, cand, _ = one(leader(drift=0.0001))
    assert member is not None and member[1] == 1.0 and cand is None
    assert one(leader(drift=0.0003))[1] is not None, "faster than the benchmark: above it"
    # no benchmark bar on the day: no RS reading, so not a candidate
    holed = panel.Calendar([b for b in SPY if b["t"] != fx.YMD[F - 3]])
    member, cand, _ = one(leader(), cal=holed)
    assert cand is not None and cand["rs_line_below_high_pct"] is None, \
        "above its average today, but one of the 252 readings is missing: no below-high value"


def test_extended_is_four_true_ranges_over_the_50_day():
    """Flat at $50 with a 4% range, then 3% a session for the 15 sessions to the date: the
    close is about 30% over its 50-day average and a true range is about 5% of price."""
    flat = [50.0] * (F - 14)
    run_up = [50.0 * 1.03 ** n for n in range(1, fx.N - len(flat) + 1)]
    _m, cand, _ = one(dicts(fx.bars(flat + run_up)))
    assert cand is not None and cand["extended"] is True
    assert one(leader())[1]["extended"] is False


# ───────────────────────── the return ───────────────────────────────────────

def test_entry_is_the_next_sessions_open_and_exit_the_close_h_sessions_on():
    """The stock gaps up 5% at the next open. A member who saw the list after the close
    could not have bought the formation close: the return starts at that open."""
    bars = leader()
    entry = bars[F]["c"] * 1.05
    bars[F + 1]["o"] = entry
    member, cand, _ = one(bars)
    for h in spec.HORIZONS:
        assert member[4][h] == pytest.approx((bars[F + h]["c"] / entry - 1) * 100, abs=1e-9), h
        assert member[4][h] < (grow(F, h) - 1) * 100 - 4
    # the excursions start from the same entry
    fav, adv = cand["excursion"][10]
    assert fav == pytest.approx((max(b["h"] for b in bars[F + 1:F + 11]) / entry - 1) * 100 / 4.0)
    assert adv == pytest.approx((min(b["l"] for b in bars[F + 1:F + 11]) / entry - 1) * 100 / 4.0)
    # the formation bar's own open, high and low are not part of the outcome
    bars[F]["o"], bars[F]["h"], bars[F]["l"] = entry * 3, bars[F]["c"] * 1.02, bars[F]["c"] * 0.98
    assert one(bars)[0][4] == member[4]


def test_a_window_that_is_not_over_has_no_return():
    late = fx.YMD[fx.N - 11]
    books, counts = book(leader(), (late,))
    fwd = list(books[late].members())[0][4]
    assert fwd[5] is not None and fwd[10] is not None and fwd[21] is None and fwd[63] is None
    assert counts["window_open_21"] == 1 and counts["window_open_63"] == 1
    assert set(books[late].candidates["TEST"]["excursion"]) == {10}


def test_the_embargo_a_window_never_reads_past_its_limit():
    """The limit is the last development session: the bars after it exist and are not read."""
    member, cand, counts = one(leader(), limit=fx.YMD[F + 10])
    fwd = member[4]
    assert fwd[5] is not None and fwd[10] is not None and fwd[21] is None and fwd[63] is None
    assert counts["window_open_21"] == 1 and set(cand["excursion"]) == {10}
    assert one(leader(), limit=fx.YMD[F + 9])[0][4][10] is None


def test_a_missed_session_inside_the_window_is_no_return():
    bars = leader()
    del bars[F + 7]
    member, _c, counts = one(bars)
    fwd = member[4]
    assert fwd[5] == pytest.approx((grow(F, 5) - 1) * 100, abs=1e-9), "the window before the gap stands"
    assert fwd[10] is None and fwd[21] is None and fwd[63] is None
    assert counts["window_gap_10"] == counts["window_gap_21"] == counts["window_gap_63"] == 1
    # missing the entry session itself: no window at all
    bars = leader()
    del bars[F + 1]
    assert all(v is None for v in one(bars)[0][4].values())


def test_an_unadjusted_split_inside_the_window_is_no_return():
    """A declared 2-for-1 on the 8th session after the date, still showing in the closes."""
    bars = leader()
    for b in bars[F + 8:]:
        for k in "ohlc":
            b[k] = b[k] / 2.0
    iso = dt.date(fx.YMD[F + 8] // 10000, fx.YMD[F + 8] // 100 % 100, fx.YMD[F + 8] % 100).isoformat()
    member, _c, counts = one(bars, declared=[(iso, 2.0)])
    fwd = member[4]
    assert fwd[5] == pytest.approx((grow(F, 5) - 1) * 100, abs=1e-9)
    assert fwd[10] is None and fwd[21] is None and fwd[63] is None
    assert counts["window_split_10"] == 1 and "symbols_split_list_unknown" not in counts
    # with no declared list the same window would read a -50% trade: the reason for the guard
    unguarded, _c, counts = one(bars, declared=None)
    assert unguarded[4][10] < -45 and counts["symbols_split_list_unknown"] == 1
    # an adjusted series (no jump in the closes) is not flagged by a declared split
    clean, _c, _ = one(leader(), declared=[(iso, 2.0)])
    assert clean[4][10] is not None


def test_a_bad_entry_price_is_no_return():
    bars = leader()
    bars[F + 1]["o"] = 0.0
    member, _c, counts = one(bars)
    assert all(v is None for v in member[4].values()) and counts["window_price_5"] == 1


def test_the_benchmark_s_own_return_and_its_200_day_state():
    got = panel.benchmark_book(CAL, {DAY: FAR, fx.YMD[100]: FAR, fx.YMD[fx.N - 3]: FAR})
    for h in spec.HORIZONS:
        assert got[DAY]["forward"][h] == pytest.approx((grow(F, h, fx.BENCH_DRIFT) - 1) * 100, abs=1e-9)
    assert got[DAY]["above_average"] is True
    assert got[fx.YMD[100]]["above_average"] is None, "under 200 sessions of history: unknown"
    assert got[fx.YMD[fx.N - 3]]["forward"] == {5: None, 10: None, 21: None, 63: None}
    falling = panel.Calendar(dicts(fx.bars([300.0 * 0.999 ** n for n in range(fx.N)])))
    assert panel.benchmark_book(falling, {DAY: FAR})[DAY]["above_average"] is False
    assert panel.benchmark_book(CAL, {20190601: FAR}) == {}, "not a session: no entry"


def test_a_date_the_benchmark_has_no_session_for_is_not_formed():
    holed = panel.Calendar([b for b in SPY if b["t"] != DAY])
    books, counts = book(leader(), cal=holed)
    assert books[DAY].tickers == []
