"""What `new_ath` MEASURES — and the fact that the live path and the stored
series no longer agree about it.

The collector's `new_ath` was `count_nd_highs(closes, min(252, len(closes) - 1))`
— a 251-bar window over a one-year frame, i.e. `new_52w_highs` under another
name. That was fixed at the source on 2026-08-06 (uct-intelligence `506d8ad`,
hardened by `4aeb6`/`5ecd5f6`): the collector now downloads full per-ticker
history, builds a real all-time-high map, and `--repair-ath` restated the stored
rows. `Breadth.jsx`'s tiers and `chartMetrics.js`'s presets were re-derived the
same day on the assumption that the value is a genuine all-time-high count.

`breadth_live.build_levels` was NOT changed, and it cannot be by the same
method: it builds levels from a 380-session frame, and no window over one and a
half years of closes is an all-time high. So the live/recon path still publishes
a 52-week-high count under the `new_ath` key.

⛔ THIS FILE ASSERTS THE DEFECT ON PURPOSE. A characterization rail, not an
endorsement: the claim "new_ath is not an all-time high" has been carried in
prose for months and prose does not get re-measured. When someone gives this
module a real all-time reference these tests go RED, and the failure message is
the checklist of what else has to move in the same change.
"""
import numpy as np
import pytest

from api.services import breadth_live as bl


def _frame(n_tickers=400, n_dates=380, seed=11):
    """A frame the shape of the live one: `_FRAME_SESSIONS` completed sessions."""
    rng = np.random.default_rng(seed)
    closes = np.cumprod(1 + rng.normal(0, 0.02, (n_tickers, n_dates)), axis=1) * 100
    vols = np.full((n_tickers, n_dates), 1_000_000.0)
    tickers = [f"T{i:04d}" for i in range(n_tickers)]
    return tickers, closes, vols


def test_the_live_frame_is_long_enough_that_the_two_windows_collapse():
    """The premise. `nath = min(252, n_dates)` only differs from
    `n52 = min(252, n_dates + 1)` on a frame SHORTER than 252 sessions, and the
    live loader asks for 380."""
    assert bl._FRAME_SESSIONS >= 252
    tickers, closes, vols = _frame()
    lv = bl.build_levels(tickers, closes, vols, 20260828)
    assert lv["n52"] == 252
    assert lv["nath"] == 252


def test_the_all_time_high_level_is_byte_identical_to_the_52_week_level():
    """Not "close to" — the SAME array, because both are a 251-column tail max.

    If this ever fails, `new_ath` has been given a real reference and the
    docstring above, the `_ACCURACY` grade for `new_ath`, and the comment in
    `build_levels` all describe a world that no longer exists.
    """
    tickers, closes, vols = _frame()
    lv = bl.build_levels(tickers, closes, vols, 20260828)
    assert np.array_equal(lv["max52"], lv["maxath"])
    assert np.array_equal(lv["max52_ok"], lv["maxath_ok"])


def test_the_two_published_counts_are_therefore_always_equal():
    """The user-visible consequence: charting "ATH Count (Close)" beside
    "52W Highs" draws one line twice on every live row."""
    tickers, closes, vols = _frame()
    lv = bl.build_levels(tickers, closes, vols, 20260828)
    rng = np.random.default_rng(23)
    px = {t: float(closes[i, -1] * (1 + rng.normal(0, 0.03)))
          for i, t in enumerate(tickers)}
    m = bl.compute_metrics(lv, px, {t: 1_000_000.0 for t in tickers})
    assert m["new_52w_highs"] == m["new_ath"], (
        "new_ath and new_52w_highs diverged — if that is because this module "
        "grew a real all-time-high reference, ALSO update: the header comment "
        "on `nath` in build_levels, the `new_ath` grade in `_ACCURACY` (it was "
        "measured when both sides were 52-week counts and certifies nothing "
        "today), and whether `breadth_history_recon.sweep_history` may write "
        "this key into breadth_daily_ohlc.")


def test_the_discriminating_control_a_real_ath_would_not_equal_the_52_week_count():
    """A rail that cannot distinguish is not a rail.

    Prove the equality above is a property of the CODE, not of the fixture, by
    building the answer a real all-time reference would give on this same frame:
    take the running maximum over ALL of history rather than the last 251 bars.
    It must be strictly smaller — an all-time high is a 52-week high, not the
    other way round.
    """
    tickers, closes, vols = _frame()
    lv = bl.build_levels(tickers, closes, vols, 20260828)
    rng = np.random.default_rng(23)
    px_arr = closes[:, -1] * (1 + rng.normal(0, 0.03, closes.shape[0]))
    px = {t: float(px_arr[i]) for i, t in enumerate(tickers)}
    m = bl.compute_metrics(lv, px, {t: 1_000_000.0 for t in tickers})

    true_ath_level = np.nanmax(closes, axis=1)          # every session, not 251
    real_ath_count = int((px_arr >= true_ath_level * 0.999).sum())

    assert real_ath_count < m["new_52w_highs"], (
        "the fixture cannot tell the two definitions apart — pick a frame with "
        "a longer memory before trusting the equality tests above")
    assert m["new_ath"] != real_ath_count


@pytest.mark.parametrize("key", ["new_ath", "new_52w_highs"])
def test_both_keys_are_still_published_so_the_duplication_is_visible(key):
    tickers, closes, vols = _frame()
    lv = bl.build_levels(tickers, closes, vols, 20260828)
    px = {t: float(closes[i, -1]) for i, t in enumerate(tickers)}
    m = bl.compute_metrics(lv, px, {t: 1_000_000.0 for t in tickers})
    assert isinstance(m[key], int)
