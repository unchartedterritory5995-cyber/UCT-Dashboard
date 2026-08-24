"""PEG is a growth-adjusted multiple, so it needs a growth to adjust for.

Accuracy audit defect #1 — the worst case in the audit, rescoped on 2026-08-24
after re-deriving the mechanism, because the audit's own account had gone stale.

The audit reported the "PEG Under 1" preset as a bare `peg <= ?`, so negative
PEGs passed it. That is no longer true: the presets are
`{"op": "between", "min": 0, "max": 1}` and `query.py` renders `between` as a
real `>= ? AND <= ?`. What survives that guard is the half a sign test cannot
see — PEG = P/E / growth, so two negatives make an ATTRACTIVE POSITIVE, and a
positive sails through `>= 0`.

Measured live over our universe 2026-08-24: 614 of 3,653 rows publish a
positive PEG off a non-positive P/E.

⛔ AND THE REFUSAL THAT WAS NOT TAKEN is asserted here too. A negative PEG, and
a negative P/E, P/B, P/FCF or P/OCF, are REAL answers and stay. See
`test_a_negative_peg_is_a_real_answer_and_survives`.
"""
import pytest

from api.services.screener import fundamentals_bulk as fb


def _v(col, row):
    return fb.value_for(fb.RATIO_SPECS[col], row)


# ── what IS refused: a positive PEG standing on a non-positive P/E ───────────

def test_two_negatives_making_an_attractive_positive_are_refused():
    """The audit's headline. LCID published peg 0.019 -- the LOWEST in its
    sample -- because P/E was -0.40 against a -264% net margin. It passes
    `between 0 and 1` today."""
    assert _v("peg", {"priceToEarningsGrowthRatioTTM": "0.019",
                      "priceToEarningsRatioTTM": "-0.40"}) is None
    # ABVX and ACHC, both measured live 2026-08-24
    assert _v("peg", {"priceToEarningsGrowthRatioTTM": "0.3369",
                      "priceToEarningsRatioTTM": "-20.50"}) is None
    assert _v("peg", {"priceToEarningsGrowthRatioTTM": "0.0025",
                      "priceToEarningsRatioTTM": "-2.23"}) is None


def test_peg_refuses_when_it_cannot_see_the_pe_at_all():
    """A multiple we cannot show to be meaningful is not one to publish.
    Measured cost of this branch: 0 rows -- the two fields are present on
    exactly the same 3,653 rows."""
    assert _v("peg", {"priceToEarningsGrowthRatioTTM": "0.85"}) is None


def test_a_zero_pe_does_not_make_peg_meaningful():
    """`requires_positive` is strictly positive: a P/E of exactly 0 is the
    provider's undefined, and dividing by it is not a growth adjustment."""
    assert _v("peg", {"priceToEarningsGrowthRatioTTM": "0.5",
                      "priceToEarningsRatioTTM": "0"}) is None


def test_the_control_a_real_cheap_growth_stock_still_passes_under_1():
    """The preset has to keep working, or the guard replaced one defect with
    another."""
    assert _v("peg", {"priceToEarningsGrowthRatioTTM": "0.85",
                      "priceToEarningsRatioTTM": "14.2"}) == 0.85


# ── what is NOT refused, deliberately ────────────────────────────────────────

def test_a_negative_peg_is_a_real_answer_and_survives():
    """⛔ THE REVERSAL. A negative PEG is a positive P/E against SHRINKING
    earnings -- a real reading, and one the shipped presets already exclude
    via `between min=0`. Blanking it would delete 1,185 true values to fix a
    preset that is already guarded. BABA -0.482 off a P/E of +24.80 is the
    case; ABCB -6.01 is defended by name in test_screener_fundamentals_bulk."""
    assert _v("peg", {"priceToEarningsGrowthRatioTTM": "-0.482",
                      "priceToEarningsRatioTTM": "24.80"}) == pytest.approx(-0.482)


@pytest.mark.parametrize("col,field,value", [
    ("pe_ttm", "priceToEarningsRatioTTM", "-0.40"),
    ("pb", "priceToBookRatioTTM", "-2.685"),
    ("p_fcf", "priceToFreeCashFlowRatioTTM", "-5.90"),
    ("p_ocf", "priceToOperatingCashFlowRatioTTM", "-11.84"),
])
def test_the_other_multiples_keep_their_negatives(col, field, value):
    """All four are `_open_range` with NO shipped preset, so the only way to
    select their negatives is a member-typed range -- and the honest answer to
    that is the member-facing `desc` these columns still lack, not a mass
    refusal. Cost of the refusal NOT taken: 1,005 + 981 + 713 + 164 rows."""
    assert _v(col, {field: value}) == pytest.approx(float(value))


def test_the_existing_same_sign_guard_still_fires():
    """The rescope must not have disarmed the guard that was already there: a
    POSITIVE P/B beside a negative book value is two halves of one division
    that cannot both be right."""
    assert _v("pb", {"priceToBookRatioTTM": "1.14",
                     "bookValuePerShareTTM": "-2.685"}) is None


def test_a_negative_margin_is_a_real_number_and_is_published():
    """⛔ THE RULE IS NOT "REFUSE NEGATIVES" anywhere in this module."""
    assert _v("net_margin", {"netProfitMarginTTM": "-2.64"}) == -264.0


def test_only_peg_carries_the_gate():
    """A hand-typed list beside a registry drifts; derive it."""
    armed = {c for c, s in {**fb.RATIO_SPECS, **fb.KEY_METRIC_SPECS}.items()
             if s.requires_positive}
    assert armed == {"peg"}
