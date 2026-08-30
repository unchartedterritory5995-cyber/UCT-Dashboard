"""What `new_ath` MEASURES — and the fix that stopped the live path from
publishing a lie under its name.

The collector's `new_ath` was `count_nd_highs(closes, min(252, len(closes) - 1))`
— a 251-bar window over a one-year frame, i.e. `new_52w_highs` under another
name. That was fixed at the source on 2026-08-06 (uct-intelligence `506d8ad`,
hardened by `4aeb6`/`5ecd5f6`): the collector now downloads full per-ticker
history, builds a real all-time-high map, and `--repair-ath` restated the stored
rows. `Breadth.jsx`'s tiers and `chartMetrics.js`'s presets were re-derived the
same day on the assumption that the value is a genuine all-time-high count.

`breadth_live.build_levels` was NOT changed, and it CANNOT be by the same
method: it builds levels from a 380-session frame, and no window over one and a
half years of closes is an all-time high. `nath` reduces to the same 251-bar
tail as `n52`, so `max52`/`maxath` are still byte-identical arrays today — that
part of the reduction is a fact about the frame length and does not go away.

⛔ WHAT DID CHANGE (2026-08-30, this file's fix): `compute_metrics` no longer
turns that identical array into a published `new_ath` count. It publishes
`None` instead — an honest "not computed live" rather than `new_52w_highs`
wearing the ATH's name. The first two tests below are the PREMISE (the window
collapse is real, so publishing `maxath` would still be wrong today); the rest
pin the FIX — that the live path answers `None`, not the collapsed count. If
someone reintroduces `m["new_ath"] = _hi("new_ath", "maxath", "maxath_ok")`,
the fix tests go RED, and the failure message is the checklist of what else has
to move before this key can carry a real number again.
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


def test_the_underlying_reduction_would_still_equal_new_52w_highs_if_published():
    """The premise the fix has to survive: the equality is a property of the
    150-year-frame math (test above), not of one code path, so a naive future
    "just call the same helper" fix would reproduce it. Reconstruct exactly
    what `_hi("new_ath", "maxath", "maxath_ok")` computed before the fix,
    directly from the published `maxath` level, and show it still lands on
    `new_52w_highs` — confirming there was never a way to publish `maxath`
    honestly under the ATH key on this frame length."""
    tickers, closes, vols = _frame()
    lv = bl.build_levels(tickers, closes, vols, 20260828)
    rng = np.random.default_rng(23)
    px_arr = closes[:, -1] * (1 + rng.normal(0, 0.03, closes.shape[0]))
    have = np.ones(len(tickers), dtype=bool)
    valid = have & lv["maxath_ok"] & ~np.isnan(lv["maxath"])
    would_be_ath_count = int((valid & (px_arr >= lv["maxath"] * 0.999)).sum())

    px = {t: float(px_arr[i]) for i, t in enumerate(tickers)}
    m = bl.compute_metrics(lv, px, {t: 1_000_000.0 for t in tickers})
    assert would_be_ath_count == m["new_52w_highs"]


def test_the_live_payload_no_longer_publishes_a_fake_ath():
    """The fix (2026-08-30). Reintroducing
    `m["new_ath"] = _hi("new_ath", "maxath", "maxath_ok")` in `compute_metrics`
    makes this go RED — that line is exactly what reproduces the duplicate-line
    defect the tests above characterize."""
    tickers, closes, vols = _frame()
    lv = bl.build_levels(tickers, closes, vols, 20260828)
    rng = np.random.default_rng(23)
    px = {t: float(closes[i, -1] * (1 + rng.normal(0, 0.03)))
          for i, t in enumerate(tickers)}
    m = bl.compute_metrics(lv, px, {t: 1_000_000.0 for t in tickers})
    assert m["new_ath"] is None
    assert m["new_ath"] != m["new_52w_highs"], (
        "new_ath equals new_52w_highs again — the live path is publishing a "
        "52-week count under the all-time-high key")


def test_the_discriminating_control_a_real_ath_would_not_equal_the_52_week_count():
    """A rail that cannot distinguish is not a rail.

    Prove the equality the fix guards against is a property of the CODE (this
    frame length), not of the fixture, by building the answer a real all-time
    reference would give: take the running maximum over ALL of history rather
    than the last 251 bars. It must be strictly smaller — an all-time high is a
    52-week high, not the other way round — so a future real-ATH implementation
    has a fixture that can actually tell the two definitions apart.
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
    # The live path does not claim `real_ath_count` either — it claims nothing.
    assert m["new_ath"] is None


def test_new_52w_highs_still_publishes_a_real_count_while_new_ath_does_not():
    """The asymmetry the fix creates on purpose: one key keeps its honest
    count, the other reports absence rather than a copy of it."""
    tickers, closes, vols = _frame()
    lv = bl.build_levels(tickers, closes, vols, 20260828)
    px = {t: float(closes[i, -1]) for i, t in enumerate(tickers)}
    m = bl.compute_metrics(lv, px, {t: 1_000_000.0 for t in tickers})
    assert isinstance(m["new_52w_highs"], int)
    assert m["new_ath"] is None


def test_new_ath_is_absent_from_the_live_drill_members_so_a_click_cannot_lie():
    """`new_ath` stays in `DRILLABLE` (the Monitor's column still declares
    `drillKey: 'new_ath_list'`), but nothing ever calls `_keep` for it now, so
    a click must refuse rather than open an empty "0 names" modal."""
    tickers, closes, vols = _frame()
    lv = bl.build_levels(tickers, closes, vols, 20260828)
    px = {t: float(closes[i, -1]) for i, t in enumerate(tickers)}
    members = {}
    bl.compute_metrics(lv, px, {t: 1_000_000.0 for t in tickers}, members=members)
    assert "new_ath" not in members
    assert "new_ath" in bl.DRILLABLE
