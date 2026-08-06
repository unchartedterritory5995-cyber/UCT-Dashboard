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


# ─── 🟢 THE 1970 ANCHOR, CLOSED — WAS A PIN, IS NOW THE REGRESSION TEST ──────
#
# This block was `test_DEFECT_vwap_on_a_daily_YYYYMMDD_series_is_one_session_
# anchored_in_1970`, written by Task 5 to make an OPEN defect visible and to go
# red the day somebody corrected it. It went red. The paragraph it was holding is
# below, in the past tense, with the assertion turned over: the same series that
# used to produce one 1970-anchored bucket is now REFUSED, and the same control
# still proves the claim is about the UNIT and not about VWAP.

def test_vwap_REFUSES_a_daily_YYYYMMDD_series_instead_of_anchoring_it_in_1970():
    """🟢 THE FIX, MEASURED AT THE SHAPE THE DEFECT HAD.

    `compute_vwap_raw` documents `t` as UNIX SECONDS and both lanes' fixtures use
    them. The LIVE alert path did not: `indicator_alert_evaluator.
    _fetch_bars_for_alert` passes the bars store's timestamp straight through as
    `t`, and for a DAILY bar that value is a `YYYYMMDD` INT (the alert replay
    harness's `spy_daily` fixture records exactly that: *"`t` is a `YYYYMMDD` int
    — exactly what the live evaluator is handed"*).

    `20260806` read as unix seconds is **1970-08-23 08:00:06 ET**. Two whole
    YEARS of daily bars span 11,130 of those seconds — about three hours — so
    every one of them landed inside one ET calendar day and the session
    accumulator NEVER RESET. A 400-day daily VWAP was one continuous "session"
    beginning in 1970, and **it did not raise**, so nothing anywhere surfaced it.

    ⭐ WHY REFUSE RATHER THAN CONVERT, WHICH IS THE ONLY INTERESTING QUESTION
    HERE. Two things could have been done with a date-shaped `t`:

      * translate it to an instant, which would make daily VWAP resolve to each
        bar's own typical price — one session per bar, because a daily bar IS a
        session. That is a plausible NUMBER for a question that has no answer,
        and it would ship under the name of an indicator it is not.
      * refuse the column outright, which is what the CHART lane already says by
        construction: `eligibility.VWAP_TIMEFRAMES` is `1/5/15/30/60` and VWAP is
        not offered on daily at all.

    The second, and the guard is `VWAP_MIN_INSTANT` — the constant Task 14 had
    already introduced for `compute_avwap_raw`, now shared rather than copied.
    That sharing is itself load-bearing: `compute_avwap_raw(bars, "session")` is
    documented to equal `compute_vwap_raw(bars)` bar for bar, and while only one
    of the two validated the unit that promise was FALSE on exactly these inputs.
    `test_vwap_and_session_avwap_agree_including_when_they_both_refuse` is where
    that equality is asserted.

    ⛔ AND THE REFUSAL IS THE WHOLE COLUMN, NEVER ONE BUCKET. "One bucket for the
    whole series" IS what the defect produced, so a fallback with that shape
    could not be told apart from it.

    The control at the bottom is what makes the claim "the unit is wrong" rather
    than "VWAP is broken": the SAME closes with real unix-second timestamps still
    reset once per ET day, exactly as they should.
    """
    days = [(2026, m, d) for m in (1, 2) for d in range(1, 29)]

    def bar(t, i):
        return {"t": t, "h": 101.0 + i, "l": 99.0 + i, "c": 100.0 + i, "v": 1000}

    def collapsed(out, bars):
        """Indices where the accumulator holds exactly one bar's typical price —
        i.e. where a session opened. A refused (``None``) bar is not a session
        open, so it contributes no index; that is what lets the same helper
        describe both the defect's output and the fix's."""
        return [
            i for i, b in enumerate(bars)
            if out[i] is not None
            and abs(out[i] - (b["h"] + b["l"] + b["c"]) / 3.0) < 1e-9
        ]

    # THE INPUT THAT CARRIED THE DEFECT: the store's daily key, verbatim.
    ymd_bars = [bar(int("%04d%02d%02d" % ymd), i) for i, ymd in enumerate(days)]

    # The arithmetic that made it 1970 is still true of the INPUT — asserted
    # first, so this test names the reason the column is refused rather than
    # merely observing that it is. Nothing here calls compute.
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

    # THE FIX: the whole column, refused.
    ymd_out = compute_vwap_raw(ymd_bars)
    assert ymd_out == [None] * len(days), (
        "a daily YYYYMMDD series produced VALUES again. Whatever it produced, it "
        "was computed from a `t` that is 1970-08-23 — see the assertions above."
    )
    # …and specifically NOT the one-bucket shape, which is what the defect looked
    # like and what a 'plausible fallback' would look like too. This assertion is
    # redundant with the one above ON PURPOSE: it is the one that would catch a
    # future 'fix' that answers with a single session instead of refusing.
    assert collapsed(ymd_out, ymd_bars) != [0]
    assert not any(v is not None for v in ymd_out)

    # THE SECOND DOOR, closed by the same gate: the CHART lane's daily encoding is
    # a 'YYYY-MM-DD' STRING, which used to reach a stable 'invalid' day key — one
    # bucket for the series, the identical defect by another route.
    iso_bars = [bar("%04d-%02d-%02d" % ymd, i) for i, ymd in enumerate(days)]
    assert compute_vwap_raw(iso_bars) == [None] * len(days)

    # `True` is an `int` in Python and 1 < VWAP_MIN_INSTANT, so a boolean `t`
    # must be refused as a unit error and not silently floor-divided into 1970.
    assert compute_vwap_raw([bar(True, 0), bar(False, 1)]) == [None, None]

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
    # The control is only a control if it produced REAL VALUES — an all-None
    # column would satisfy `collapsed(...) == []`, and on a one-day series `[]`
    # is not `list(range(56))`, but on a shorter one it could be. Say it anyway.
    assert all(v is not None for v in unix_out)


def test_vwap_and_session_avwap_agree_including_when_they_both_refuse():
    """⭐ THE ORACLE THAT MAKES THE REFUSAL NON-ARBITRARY, AND IT PREDATES IT.

    `compute_avwap_raw`'s own docstring has said since Task 14 that ``session``
    "is the same boundary `compute_vwap_raw` uses (the ET calendar day), so on a
    one-session series the two are the same number bar for bar". That sentence
    was FALSE on exactly the inputs that carried the 1970 defect: AVWAP refused a
    date-shaped `t` (`AVWAP_MIN_INSTANT`) while VWAP answered with one 1970
    bucket. Nothing measured the disagreement, because nothing compared them.

    So this compares them — in BOTH directions, on the SAME series:
      * real unix seconds → identical, element for element, and finite;
      * `YYYYMMDD` ints → BOTH all-None.

    A future edit that reverts VWAP's guard fails the second half; one that
    reverts AVWAP's fails it too; one that makes VWAP *convert* instead of refuse
    fails it as an inequality rather than as a missing None, which is the more
    informative red.
    """
    from api.services.indicator_compute import compute_avwap_raw

    import calendar
    from datetime import datetime, timezone

    days = [(2026, m, d) for m in (1, 2) for d in range(1, 29)]

    def bar(t, i):
        return {"t": t, "h": 101.0 + i, "l": 99.0 + i, "c": 100.0 + i, "v": 1000}

    unix_bars = [
        bar(calendar.timegm(
            datetime(y, m, d, 15, 0, tzinfo=timezone.utc).timetuple()), i)
        for i, (y, m, d) in enumerate(days)
    ]
    vwap = compute_vwap_raw(unix_bars)
    avwap = compute_avwap_raw(unix_bars, "session")
    assert vwap == avwap
    # NON-VACUITY: `[] == []` and `[None…] == [None…]` would also satisfy the
    # line above. These numbers are real.
    assert len(vwap) == len(days) and all(v is not None for v in vwap)

    ymd_bars = [bar(int("%04d%02d%02d" % ymd), i) for i, ymd in enumerate(days)]
    assert compute_vwap_raw(ymd_bars) == compute_avwap_raw(ymd_bars, "session")
    assert compute_vwap_raw(ymd_bars) == [None] * len(days)


def test_the_vwap_unit_floor_is_ONE_constant_and_sits_at_1990():
    """The guard AVWAP already had and VWAP now shares — one object, not two.

    ⛔ `AVWAP_MIN_INSTANT` is retained as a NAME because the JS lane exports it
    and `goldenFixtures.test.js` imports it; what it must never be again is a
    SECOND VALUE.

    🔴 AND THE OBVIOUS WAY TO ASSERT THAT IS VACUOUS — MEASURED, NOT ASSUMED.
    `assert AVWAP_MIN_INSTANT is VWAP_MIN_INSTANT` looks like the strict version
    of `==`, and it is not: CPython folds equal constants in ONE code object into
    ONE object, and a module body is one code object, so `A = 631152000;
    B = 631152000` gives `A is B` → **True**. Probed before this test was
    written. The identity check would have passed on exactly the edit it exists
    to catch.

    So the rail is STRUCTURAL, read off the source with an AST — never a grep,
    which on this repo has twice counted prose in a comment as a call site.
    `AVWAP_MIN_INSTANT` must be assigned from the NAME `VWAP_MIN_INSTANT`; a
    literal there fails, whatever the literal is.
    """
    import ast
    import pathlib
    from datetime import datetime, timezone
    from api.services import indicator_compute as ic

    assert ic.AVWAP_MIN_INSTANT == ic.VWAP_MIN_INSTANT
    assert datetime.fromtimestamp(
        ic.VWAP_MIN_INSTANT, timezone.utc).strftime("%Y-%m-%d") == "1990-01-01"

    tree = ast.parse(pathlib.Path(ic.__file__).read_bytes().decode("utf-8"))
    assigned_from = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 \
                and isinstance(node.targets[0], ast.Name):
            assigned_from[node.targets[0].id] = node.value
    assert set(assigned_from) >= {"VWAP_MIN_INSTANT", "AVWAP_MIN_INSTANT"}, (
        "one of the two constants is no longer a module-level assignment — this "
        "rail then checks nothing")
    rhs = assigned_from["AVWAP_MIN_INSTANT"]
    assert isinstance(rhs, ast.Name) and rhs.id == "VWAP_MIN_INSTANT", (
        "AVWAP_MIN_INSTANT is assigned "
        f"{ast.dump(rhs)[:80]} instead of the NAME VWAP_MIN_INSTANT. Two "
        "constants that happen to be equal today is how the guard drifts apart, "
        "and `is` cannot see it (CPython folds equal literals in one module).")
    # The control: the OTHER one really is the literal, so this rail is
    # distinguishing two shapes rather than accepting everything.
    assert isinstance(assigned_from["VWAP_MIN_INSTANT"], ast.Constant)

    # THE BOUNDARY, both sides, so the comparison cannot silently become `<=`/`>`
    # in a way no test notices. One second under is refused; the floor itself is
    # accepted.
    def bar(t):
        return {"t": t, "h": 101.0, "l": 99.0, "c": 100.0, "v": 1000}

    assert compute_vwap_raw([bar(ic.VWAP_MIN_INSTANT - 1)]) == [None]
    assert compute_vwap_raw([bar(ic.VWAP_MIN_INSTANT)]) == [100.0]
    # …and a series is refused as a WHOLE when only ONE bar is bad — the property
    # that makes "never one bucket" true rather than merely intended.
    mixed = [bar(1785410100 + i * 300) for i in range(5)]
    assert all(v is not None for v in compute_vwap_raw(mixed))
    mixed[3] = bar(20250101)
    assert compute_vwap_raw(mixed) == [None] * 5
