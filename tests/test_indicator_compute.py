"""Tests for server-side indicator compute (parity with frontend math)."""

import pytest

from api.services.indicator_compute import (
    compute_bb,
    compute_cci,
    compute_ema,
    compute_macd,
    compute_mfi,
    compute_rsi,
    compute_sar_events,
    compute_sma,
    compute_stoch,
    compute_vwap_raw,
    compute_williams_r,
)


def test_rsi_constant_uptrend():
    closes = list(range(100, 130))
    rsi = compute_rsi(closes, 14)
    assert rsi[-1] == 100.0  # all gains, no losses


def test_rsi_constant_downtrend():
    closes = list(range(100, 70, -1))
    rsi = compute_rsi(closes, 14)
    assert rsi[-1] == 0.0


def test_macd_returns_three_arrays():
    closes = [100 + i * 0.5 for i in range(60)]
    macd, signal, hist = compute_macd(closes, 12, 26, 9)
    assert len(macd) == 60
    assert len(signal) == 60
    assert len(hist) == 60


def test_bb_ordering():
    closes = [100 + (i % 7) * 1.5 for i in range(40)]
    upper, middle, lower = compute_bb(closes, 20, 2)
    for u, m, l in zip(upper[20:], middle[20:], lower[20:]):
        if u is not None:
            assert u >= m >= l


def test_williams_r_bounds():
    bars = [{"h": 100 + i, "l": 90 + i, "c": 95 + i} for i in range(30)]
    wr = compute_williams_r(bars, 14)
    valid = [v for v in wr if v is not None]
    assert all(-100 <= v <= 0 for v in valid)


def test_cci_range():
    bars = [{"h": 102 + i * 0.1, "l": 98 + i * 0.1, "c": 100 + i * 0.1} for i in range(40)]
    cci = compute_cci(bars, 20)
    # CCI typically ±300; constant-trend should give NaN due to zero MAD
    # so test just verifies no crash
    assert len(cci) == 40


def test_mfi_bounds():
    bars = [{"h": 102 + i, "l": 98 + i, "c": 100 + i, "v": 1000 + i * 10} for i in range(40)]
    mfi = compute_mfi(bars, 14)
    valid = [v for v in mfi if v is not None]
    assert all(0 <= v <= 100 for v in valid)


def test_stoch_bounds():
    bars = [{"h": 100 + i, "l": 90 + i, "c": 95 + i * 0.5} for i in range(30)]
    k, d = compute_stoch(bars, 14, 3)
    valid_k = [v for v in k if v is not None]
    valid_d = [v for v in d if v is not None]
    assert all(0 <= v <= 100 for v in valid_k)
    assert all(0 <= v <= 100 for v in valid_d)


def test_sma_matches_manual():
    closes = [1, 2, 3, 4, 5]
    sma = compute_sma(closes, 3)
    assert sma[2] == 2.0  # (1+2+3)/3
    assert sma[3] == 3.0
    assert sma[4] == 4.0


def test_ema_matches_known_values():
    closes = [1, 2, 3, 4, 5]
    ema = compute_ema(closes, 3)
    # First EMA is SMA of first 3: 2.0
    assert abs(ema[2] - 2.0) < 0.01
    # Subsequent: k*price + (1-k)*prev_ema, k = 2/4 = 0.5
    assert abs(ema[3] - 3.0) < 0.01  # 0.5*4 + 0.5*2 = 3


def test_sar_events_are_in_the_zero_one_none_domain():
    """SAR's two events, at the module boundary rather than through a fixture.

    The golden lane (`test_indicator_golden.py`) pins the VALUES against the JS
    lane at 1e-9; this asserts the SHAPE at the only place a future caller sees —
    the public function — so a caller can rely on `{0.0, 1.0, None}` without
    reading a fixture.
    """
    bars = [
        {"t": 1780272000 + i * 300, "o": 100.0, "h": 100.0 + (i % 7),
         "l": 96.0 - (i % 5), "c": 98.0 + ((i * 3) % 9), "v": 1000}
        for i in range(60)
    ]
    crossed, flipped = compute_sar_events(bars)
    assert len(crossed) == len(flipped) == len(bars)
    for name, series in (("priceCrossedSar", crossed), ("trendFlipped", flipped)):
        assert series[0] is None, f"{name}[0] must be the warmup pad"
        assert all(v in (0.0, 1.0) for v in series[1:]), f"{name} left the domain"
        assert 1.0 in series[1:], f"{name} never fires on these bars — the case is vacuous"


# ─── ⚠️ AN OPEN DEFECT, PINNED WHERE IT CAN BE SEEN ─────────────────────────

def test_DEFECT_vwap_on_a_daily_YYYYMMDD_series_is_one_session_anchored_in_1970():
    """🔴 THIS TEST ASSERTS A BUG. Read it before "fixing" the red it will turn.

    `compute_vwap_raw` documents `t` as UNIX SECONDS and both lanes' fixtures use
    them. The LIVE alert path does not: `indicator_alert_evaluator.
    _fetch_bars_for_alert` passes the bars store's timestamp straight through as
    `t`, and for a DAILY bar that value is a `YYYYMMDD` INT (the alert replay
    harness's `spy_daily` fixture records exactly that: *"`t` is a `YYYYMMDD` int
    — exactly what the live evaluator is handed"*).

    `20260806` read as unix seconds is **1970-08-23 08:00:06 ET**. Two whole
    YEARS of daily bars span 11,130 of those seconds — about three hours — so
    every one of them lands inside one ET calendar day and the session
    accumulator NEVER RESETS. A 400-day daily VWAP is one continuous "session"
    beginning in 1970.

    **It does not raise.** `compute_vwap_raw`'s defensive branch catches a
    NON-NUMERIC `t` (a `'YYYY-MM-DD'` string) and yields a stable `'invalid'`
    bucket; a numeric `YYYYMMDD` sails straight through the arithmetic, so
    nothing anywhere surfaces it.

    ⛔ DELIBERATELY NOT FIXED HERE, and the reason is the fix's location. The
    unit mismatch is at the CALL SITE — the evaluator hands a compute documented
    in seconds a number in days — and that file belongs to the alert lane. Fixing
    it inside `compute_vwap_raw` (sniffing the `YYYYMMDD` shape) would change what
    an ARMED alert computes, which is a behavioural change to a live surface and
    is not this task's to make. What this task owes is that the defect stop being
    invisible, so: it is measured, it is written down, and the day somebody
    corrects the call site THIS TEST GOES RED with the paragraph in hand.

    The control below is what makes the claim "the unit is wrong" rather than
    "VWAP is broken": the SAME closes with real unix-second timestamps reset once
    per ET day, exactly as they should.
    """
    days = [(2026, m, d) for m in (1, 2) for d in range(1, 29)]

    def bar(t, i):
        return {"t": t, "h": 101.0 + i, "l": 99.0 + i, "c": 100.0 + i, "v": 1000}

    def collapsed(out, bars):
        """Indices where the accumulator holds exactly one bar's typical price —
        i.e. where a session opened."""
        return [
            i for i, b in enumerate(bars)
            if abs(out[i] - (b["h"] + b["l"] + b["c"]) / 3.0) < 1e-9
        ]

    # THE DEFECT: the store's daily key, passed through verbatim.
    ymd_bars = [bar(int("%04d%02d%02d" % ymd), i) for i, ymd in enumerate(days)]
    ymd_out = compute_vwap_raw(ymd_bars)
    assert collapsed(ymd_out, ymd_bars) == [0], (
        "a daily YYYYMMDD series now resets more than once — the 1970 anchor has "
        "been corrected somewhere. That is GOOD NEWS: delete this test, and record "
        "the fix wherever it landed."
    )
    # …and it really is 1970, not merely 'one long session'.
    from datetime import datetime
    import zoneinfo
    et = zoneinfo.ZoneInfo("America/New_York")
    first = datetime.fromtimestamp(ymd_bars[0]["t"], et)
    last = datetime.fromtimestamp(ymd_bars[-1]["t"], et)
    assert first.year == last.year == 1970
    assert first.strftime("%Y-%m-%d") == last.strftime("%Y-%m-%d")
    assert last.timestamp() - first.timestamp() < 3 * 3600, (
        "two months of daily bars span more than three hours — re-measure the span"
    )

    # THE CONTROL: the same series with real unix seconds resets once per ET day.
    import calendar
    unix_bars = [
        bar(calendar.timegm(datetime(y, m, d, 15, 0, tzinfo=zoneinfo.ZoneInfo("UTC")).timetuple()), i)
        for i, (y, m, d) in enumerate(days)
    ]
    unix_out = compute_vwap_raw(unix_bars)
    assert collapsed(unix_out, unix_bars) == list(range(len(days))), (
        "the control failed: compute_vwap_raw does not reset per ET day even on real "
        "unix seconds, so the assertion above is not measuring a UNIT mismatch"
    )
