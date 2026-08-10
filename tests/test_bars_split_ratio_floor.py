"""A declared action the ratio test cannot tell from an ordinary day is skipped.

🔴 THE MEASUREMENT, 2026-08-09, against the live store. `unadjusted_splits` accepts
a boundary when `|observed/ratio - 1| <= _SPLIT_TOL`. That tolerance is RELATIVE, so
the band it accepts is `ratio * [1-tol, 1+tol]`:

    DD   3-for-1, ratio 0.3333 -> accepts observed in [0.2833, 0.3833]   (real step: 0.33501)
    TR   3% stock dividend, 1.03 -> accepts observed in [0.8755, 1.1845]  <-- 1.0 IS INSIDE

So for every small declared action a FLAT DAY satisfies the test, and
`_SPLIT_BOUNDARY_WINDOW` gives fifteen sessions to find one. The match is not
likely, it is CERTAIN — whether or not the series was ever unadjusted.

What it cost before this guard: a `--universe --warm` dry run proposed **251,506
rows**. Checked against an independent vendor, **72 of its 74 daily hits were
already correct on BOTH sides** of the claimed boundary — **239,632 rows** that
rescaling would have corrupted. And because `split_factor` multiplies every matched
boundary before a bar, the error COMPOUNDS: Tootsie Roll declares 32 annual 3% stock
dividends, and the sweep proposed `1.03**32 = 2.575x` on its whole pre-2026 history.

⭐ THE THRESHOLD IS DERIVED FROM `_SPLIT_TOL`, NOT TYPED. These tests derive their
expectations the same way, so moving the tolerance moves the test with it and a
second hand-tuned constant can never drift away from the first.
"""
from __future__ import annotations

import os
import sys

import pytest

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from api.services import bars_sanitize as san  # noqa: E402

TOL = san._SPLIT_TOL


def _series(closes, start_day=1):
    """A daily series with the given closes, one per session."""
    return [{"t": f"2026-01-{start_day + i:02d}", "o": c, "h": c, "l": c,
             "c": c, "v": 1000} for i, c in enumerate(closes)]


# ── the boundary of adjudicability, derived ──────────────────────────────────

def test_a_ratio_whose_band_contains_one_is_not_adjudicable():
    """The whole rule in one line: 'already adjusted' must be REJECTABLE."""
    # Just inside the band => an ordinary day satisfies the test => unusable.
    assert san.adjudicable(1.0) is False
    assert san.adjudicable(1.0 / (1.0 + TOL) + 1e-9) is False
    assert san.adjudicable(1.0 / (1.0 - TOL) - 1e-9) is False
    # Just outside => the test can distinguish, so it is allowed.
    assert san.adjudicable(1.0 / (1.0 + TOL) - 1e-6) is True
    assert san.adjudicable(1.0 / (1.0 - TOL) + 1e-6) is True


def test_the_real_splits_this_repo_measured_stay_adjudicable():
    """DD 3-for-1, ABTC 1-for-15, EEM 3-for-1 — all healed for real."""
    for ratio in (1 / 3, 1 / 15, 3.0, 0.5, 2.0):
        assert san.adjudicable(ratio) is True, ratio


def test_the_stock_dividends_that_caused_the_false_positives_are_not():
    """Every ratio measured on the 72 false positives, by its declared value."""
    for ratio in (1.03, 1.05, 1.024, 1.0104, 1.00709, 1.062, 0.945, 0.981):
        assert san.adjudicable(ratio) is False, ratio


def test_a_nonsense_ratio_is_never_adjudicable():
    for bad in (0.0, -1.0, None, "x", float("nan")):
        assert san.adjudicable(bad) is False, bad


# ── through the detector itself, on a series ─────────────────────────────────

def test_a_flat_day_no_longer_matches_a_three_percent_stock_dividend():
    """The exact TR shape: an ordinary session beside a 1.03 declaration.

    Before the floor this returned a boundary; with 32 of them declared it
    compounded to 2.575x over the whole history.
    """
    closes = [10.0, 10.0, 10.0, 10.22, 10.22, 10.22]   # a 2.2% day, nothing more
    bars = _series(closes)
    declared = [(bars[3]["t"], 1.03)]
    observed = closes[2] / closes[3]
    # The old test WOULD have passed — prove the trap is real, then prove it is shut.
    assert abs(observed / 1.03 - 1.0) <= TOL, "precondition: the old rule matched"
    assert san.unadjusted_splits(bars, declared) == []


def test_a_real_three_for_one_is_still_detected():
    """The control. Without it the test above passes by breaking everything."""
    closes = [47.95, 47.95, 47.95, 143.13, 143.13, 143.13]
    bars = _series(closes)
    declared = [(bars[3]["t"], 1 / 3)]
    found = san.unadjusted_splits(bars, declared)
    assert len(found) == 1, found
    assert found[0][0].isoformat() == bars[3]["t"]


def test_the_declared_date_can_still_be_off_by_days():
    """The ±7-session search is UNTOUCHED — the floor gates the ratio, not the
    window. This is the DD case: declared 06-24, the tape stepped on 06-18."""
    closes = [47.95] * 4 + [143.13] * 6
    bars = _series(closes)
    stepped_on = bars[4]["t"]
    declared_at = bars[8]["t"]            # four sessions late, like FMP's DD row
    found = san.unadjusted_splits(bars, [(declared_at, 1 / 3)])
    assert len(found) == 1 and found[0][0].isoformat() == stepped_on


def test_a_small_action_and_a_real_split_on_one_ticker_keeps_only_the_split():
    """SBSW-shaped: 1.474 is adjudicable, 1.02/1.04 are not. The compounding
    factor must come from the real one alone."""
    closes = [10.0, 10.0, 14.74, 14.74, 15.0, 15.0]
    bars = _series(closes)
    declared = [(bars[2]["t"], 1 / 1.474), (bars[4]["t"], 1.02)]
    found = san.unadjusted_splits(bars, declared)
    assert [round(r, 4) for _d, r in found] == [round(1 / 1.474, 4)]


@pytest.mark.parametrize("tol", [0.05, 0.15, 0.30])
def test_the_floor_tracks_the_tolerance_instead_of_restating_it(tol):
    """Move `_SPLIT_TOL` and the floor moves with it, by construction. A second
    hand-typed constant is this repo's most-repeated defect."""
    just_inside = 1.0 / (1.0 + tol) + 1e-9
    just_outside = 1.0 / (1.0 + tol) - 1e-6
    assert san.adjudicable(just_inside, tol=tol) is False
    assert san.adjudicable(just_outside, tol=tol) is True
