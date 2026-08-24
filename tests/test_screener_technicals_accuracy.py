"""Value rails for the two technicals columns the 2026-08-23 accuracy audit
found WRONG: ``rsi14`` and ``vol_ratio``.

⭐ THESE ARE STATEMENTS ABOUT A NUMBER, NOT ABOUT A CODE PATH. Every one of the
~9,600 backend tests was green while ``rsi14`` shipped Cutler's RSI under
Wilder's name for the whole universe, because they all assert what the code
DOES and the defect was what the number SAYS. So the oracles below are
reference implementations **typed here from the published definitions** —
nothing in this file imports ``indicator_compute``, or the comparison would be
a tautology against the very module under test.

⛔ EVERY CLAIM CARRIES A CONTROL. A fixture on which Wilder and Cutler happen
to agree would make "the screener publishes Wilder" pass for the wrong reason;
a volume fixture whose buggy and correct readings coincide would do the same.
The `_control` tests assert the fixtures can tell the two apart BEFORE the real
assertions rely on them.
"""
import pytest

from api.services.screener import technicals


# ═════════════════════════════════════════════════════════════════════════════
# Oracles — typed from the published definitions, imported from nothing
# ═════════════════════════════════════════════════════════════════════════════

def _cutler_rsi(closes, n=14):
    """Cutler's RSI: SIMPLE means of the last ``n`` gains and losses.

    This is what the screener published until 2026-08-23. It is kept here as
    the thing the column must NO LONGER equal.
    """
    if len(closes) < n + 1:
        return None
    gain = loss = 0.0
    for i in range(len(closes) - n, len(closes)):
        d = closes[i] - closes[i - 1]
        gain += max(d, 0.0)
        loss += max(-d, 0.0)
    avg_gain, avg_loss = gain / n, loss / n
    if avg_loss == 0:
        return None if avg_gain == 0 else 100.0
    return 100.0 - 100.0 / (1 + avg_gain / avg_loss)


def _wilder_rsi(closes, n=14):
    """Wilder's RSI: seed with the mean of the first ``n`` diffs, then smooth
    ``avg = (avg * (n - 1) + today) / n`` forward over the whole series.

    The near-universal reading of "the 14-period RSI" — TradingView,
    StockCharts, Finviz, and this platform's own chart.
    """
    if len(closes) < n + 1:
        return None
    avg_gain = avg_loss = 0.0
    for i in range(1, n + 1):
        d = closes[i] - closes[i - 1]
        if d > 0:
            avg_gain += d
        else:
            avg_loss -= d
    avg_gain /= n
    avg_loss /= n
    value = None
    for i in range(n, len(closes)):
        if i > n:
            d = closes[i] - closes[i - 1]
            avg_gain = (avg_gain * (n - 1) + (d if d > 0 else 0.0)) / n
            avg_loss = (avg_loss * (n - 1) + (-d if d < 0 else 0.0)) / n
        if avg_loss == 0:
            value = None if avg_gain == 0 else 100.0
        else:
            value = 100.0 - 100.0 / (1 + avg_gain / avg_loss)
    return value


def _bars(closes, volumes=None):
    """OHLC bars from a close series; `h`/`l` hug the close so nothing else
    in ``compute_technicals`` reacts to the fixture."""
    if volumes is None:
        volumes = [1_000_000] * len(closes)
    return [{"t": 20260101 + i, "o": c, "h": c, "l": c, "c": c, "v": v}
            for i, (c, v) in enumerate(zip(closes, volumes))]


#: 60 sessions of steady advance, then 14 of mild drift lower. Wilder still
#: remembers the advance; Cutler sees only the drift. They land 33 points apart
#: and — the point of the column — on OPPOSITE SIDES of the 70 line.
ADVANCE_THEN_DRIFT = ([100.0 + 2.0 * i for i in range(60)]
                      + [220.0 - 0.10 * i for i in range(1, 15)])

#: The KBON shape: a name that moved, then froze. Its last 14 diffs contain no
#: loss at all, so Cutler's average loss is exactly 0 and the column published
#: **100.00 — the top of the scale — for an instrument that has stopped
#: trading**. Wilder's memory reaches the movement before the freeze.
MOVED_THEN_FROZEN = ([50.0 + (i % 7) * 0.5 - (i % 5) * 0.4 for i in range(60)]
                     + [49.91] * 14)


# ═════════════════════════════════════════════════════════════════════════════
# 1 — rsi14 is Wilder's, and the fixtures can prove it
# ═════════════════════════════════════════════════════════════════════════════

def test_control_the_rsi_fixtures_separate_wilder_from_cutler():
    """CONTROL. Without this, every assertion below could pass on a fixture
    where the two definitions happen to agree — the single most likely way a
    value test goes vacuous."""
    c1, w1 = _cutler_rsi(ADVANCE_THEN_DRIFT), _wilder_rsi(ADVANCE_THEN_DRIFT)
    assert abs(w1 - c1) > 20, (
        "ADVANCE_THEN_DRIFT no longer separates the two RSI definitions "
        f"(cutler={c1}, wilder={w1}) — the rails below would be vacuous")
    assert (c1 > 70) != (w1 > 70), (
        "the fixture must straddle the 70 line: crossing a threshold is what "
        "made this a WRONG verdict rather than a rounding quibble")

    c2, w2 = _cutler_rsi(MOVED_THEN_FROZEN), _wilder_rsi(MOVED_THEN_FROZEN)
    assert c2 == 100.0, (
        "MOVED_THEN_FROZEN no longer reproduces the frozen-tape 100.0 that "
        f"Cutler's window produces (got {c2}) — the KBON rail would be vacuous")
    assert w2 is not None and 0.0 < w2 < 100.0


def test_rsi14_is_wilders_smoothed_average_not_a_simple_one():
    """The headline. 2,748 fresh rows measured 2026-08-23: median 6.16 points
    apart, 525 of them on the wrong side of 70/30."""
    out = technicals.compute_technicals(_bars(ADVANCE_THEN_DRIFT))
    assert out["rsi14"] == pytest.approx(_wilder_rsi(ADVANCE_THEN_DRIFT), abs=5e-3)
    assert out["rsi14"] == pytest.approx(92.48, abs=5e-3)
    assert out["rsi14"] != pytest.approx(_cutler_rsi(ADVANCE_THEN_DRIFT), abs=1.0)


def test_rsi14_crosses_the_seventy_line_where_wilder_says_it_does():
    """The thresholds ARE the column. `filters.py` ships Oversold (<30), 40–60
    and Overbought (>70); `conceptVocabulary.json` grounds the words "oversold"
    and "overbought" on exactly those numbers."""
    out = technicals.compute_technicals(_bars(ADVANCE_THEN_DRIFT))
    assert out["rsi14"] > 70, "Wilder reads this tape as overbought"
    assert _cutler_rsi(ADVANCE_THEN_DRIFT) < 70, (
        "and the retired definition read the same tape as neutral — which is "
        "the 525-row disagreement, in one fixture")


def test_a_frozen_tape_no_longer_publishes_the_top_of_the_scale():
    """KBON, a bond ETF with a zero-volume flat tail, published `rsi14 =
    100.00` and sat at the top of an "RSI > 70" screen. The `0/0` guard in
    `rsi_from_wilder_averages` never reached it — its last 14 diffs contain
    real gains and no losses, so Cutler's average loss is legitimately 0.
    Wilder's long memory is the other half of that protection, and it needed
    no special case."""
    out = technicals.compute_technicals(_bars(MOVED_THEN_FROZEN))
    assert out["rsi14"] is not None
    assert out["rsi14"] < 70, (
        "a frozen instrument must not surface as the most overbought name in "
        "the market")
    assert out["rsi14"] == pytest.approx(47.16, abs=5e-3)


def test_rsi14_still_refuses_a_series_that_never_moved_and_still_pins_100():
    """Unchanged by the Wilder switch, and both directions matter: `None` is
    "not computable", `100.0` is a real unbroken advance."""
    flat = [10.0] * 60
    rising = [10.0 + i for i in range(60)]
    assert technicals.compute_technicals(_bars(flat))["rsi14"] is None
    assert technicals.compute_technicals(_bars(rising))["rsi14"] == 100.0


def test_rsi14_is_none_below_its_warm_up_and_lands_on_the_first_full_window():
    assert technicals.compute_technicals(_bars([10.0 + i for i in range(14)]))["rsi14"] is None
    assert technicals.compute_technicals(_bars([10.0 + i for i in range(15)]))["rsi14"] == 100.0


def test_the_screener_rsi_is_not_seed_sensitive_at_the_length_it_is_fed():
    """Wilder is a recursion, so the value depends on where the series starts.
    Measured over 277 sampled tickers, the 400-bar and full-history values
    agree to 3.1e-11 — the seed is washed out long before the window
    `snapshot_builder` hands this module. A 100-bar window is NOT equivalent
    (0.40 worst), which is why this rail pins the length that ships."""
    import random
    rng = random.Random(20260823)
    closes = [100.0]
    for _ in range(999):
        closes.append(max(1.0, closes[-1] * (1 + rng.uniform(-0.03, 0.031))))
    full = technicals.compute_technicals(_bars(closes))["rsi14"]
    tail400 = technicals.compute_technicals(_bars(closes[-400:]))["rsi14"]
    assert full == pytest.approx(tail400, abs=1e-6)


# ═════════════════════════════════════════════════════════════════════════════
# 2 — vol_ratio: an absent volume is never a zero
# ═════════════════════════════════════════════════════════════════════════════

_FLAT = [50.0] * 40


def test_control_the_volume_fixtures_separate_absent_from_zero():
    """CONTROL. Each rail below must be able to tell the retired reading from
    the shipped one — otherwise "no NULL volumes in the store today" would make
    the whole section pass without exercising anything."""
    vols = [1_000] * 39 + [None]
    present = [v for v in vols[-31:-1] if v is not None]
    assert None in vols, "the fixture must actually carry an absent datum"
    # what `v or 0` would have published for the numerator, vs. the honest answer
    assert 0 / (sum(present) / len(present)) == 0.0

    gapped = [1_000] * 29 + [None] + [1_000] * 10
    window = gapped[-31:-1]
    assert None in window, "the gap must land INSIDE the 30-bar denominator"
    coerced = sum(v or 0 for v in window) / len(window)
    honest = sum(v for v in window if v is not None) / len([v for v in window if v is not None])
    assert coerced != honest, (
        "the gapped fixture no longer separates the coerced mean from the "
        "honest one — the denominator rail would be vacuous")


def test_an_absent_newest_volume_is_not_a_zero_volume_ratio():
    """The banned shape: a confident `0.00×` meaning "we hold no volume for
    this session". It is invisible, it sorts first ascending, and it passes
    every `vol_ratio <= x` filter."""
    bars = _bars(_FLAT, [1_000] * 39 + [None])
    assert technicals.compute_technicals(bars)["vol_ratio"] is None


def test_an_absent_volume_inside_the_window_is_dropped_not_counted_as_zero():
    """Quieter and worse: a missing session counted as zero drags the 30-day
    mean DOWN and inflates the ratio, on a row that looks entirely healthy."""
    vols = [1_000] * 29 + [None] + [1_000] * 10
    out = technicals.compute_technicals(_bars(_FLAT, vols))
    window = vols[-31:-1]
    present = [v for v in window if v is not None]
    assert out["vol_ratio"] == pytest.approx(
        round(vols[-1] / (sum(present) / len(present)), 2))
    coerced = round(vols[-1] / (sum(v or 0 for v in window) / len(window)), 2)
    assert out["vol_ratio"] != coerced, (
        "the ratio still reflects a missing session counted as zero volume")


def test_a_measured_zero_volume_session_is_kept_as_zero():
    """⭐ DELIBERATELY NOT BLANKED. The audit read the 58 rows at exactly `0.0`
    as fabricated; re-measured 2026-08-23, all 56 of them that came from a
    zero-volume newest bar were corroborated share-for-share by yfinance
    (AVB, EQR, KBON, SORN, ZKP …). A measured zero is knowledge, and `0.00×`
    behaves correctly under every threshold this column ships."""
    out = technicals.compute_technicals(_bars(_FLAT, [1_000] * 39 + [0]))
    assert out["vol_ratio"] == 0.0


def test_vol_ratios_denominator_excludes_the_session_it_measures():
    """Not `avg_volume_30d`'s window. That column includes today (a liquidity
    measure); this baseline must not contain the very session it is compared
    against, or a spike drags its own baseline up and reads as ordinary."""
    vols = [1_000] * 39 + [31_000]
    out = technicals.compute_technicals(_bars(_FLAT, vols))
    assert out["vol_ratio"] == 31.0
    including_today = round(31_000 / (sum(vols[-30:]) / 30), 2)
    assert out["vol_ratio"] != including_today


def test_vol_ratio_declines_to_answer_when_the_baseline_is_empty():
    every_zero = _bars(_FLAT, [0] * 40)
    assert technicals.compute_technicals(every_zero)["vol_ratio"] is None
    single = _bars([50.0], [1_000])
    assert technicals.compute_technicals(single)["vol_ratio"] is None


def test_a_boolean_is_not_a_volume():
    """`True` is an `int` in Python and would sail through as a volume of 1 —
    the same trap `usable_bars` documents for prices."""
    assert technicals.compute_technicals(
        _bars(_FLAT, [1_000] * 39 + [True]))["vol_ratio"] is None
