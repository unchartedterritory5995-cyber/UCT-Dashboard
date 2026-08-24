"""Wave 2 FMP bulk fields — zero rules + derivation, no sockets."""
import pytest

from api.services.screener import fundamentals_bulk as fb


def test_new_specs_are_registered_and_derived():
    for col in ("quick_ratio", "p_fcf", "p_ocf", "payout_ratio",
                "lt_debt_to_capital", "roic", "ipo_date", "country"):
        assert col in fb.COLUMNS_WRITTEN, col


def test_payout_zero_needs_the_dividend_corroborator():
    spec = fb.RATIO_SPECS["payout_ratio"]
    assert fb.value_for(spec, {spec.field: "0",
                               "dividendPerShareTTM": "0"}) == 0.0
    assert fb.value_for(spec, {spec.field: "0",
                               "dividendPerShareTTM": "1.2"}) is None
    # pytest.approx, not `==`: 0.153 * 100.0 is 15.299999999999999 in IEEE-754
    # float arithmetic, matching the tolerance convention the sibling
    # percent-scale tests already use (test_screener_fundamentals_bulk.py).
    assert fb.value_for(spec, {spec.field: "0.153",
                               "dividendPerShareTTM": "1.2"}
                        ) == pytest.approx(15.3)


def test_quick_ratio_zero_is_refused_like_current_ratio():
    assert fb.value_for(fb.RATIO_SPECS["quick_ratio"],
                        {"quickRatioTTM": "0"}) is None


# ── lt_debt_to_capital: the zero gate ────────────────────────────────────────
#
# 🔴 REWRITTEN 2026-08-24. This test used to be
# `test_lt_debt_zero_needs_both_debt_witnesses` and asserted the OLD contract:
# a raw 0 published only when `debtToEquityRatioTTM` AND `debtToAssetsRatioTTM`
# were both literal zeros. That rule was the accuracy audit's defect #14 — it
# refused **830 of 3,681 rows (22.5% of the column)**, so a "no long-term debt"
# screen excluded the companies that have none.
#
# The contract is now "the reading this ratio stands on is trustworthy":
# `debt_to_equity` must RESOLVE as its own spec. Long-term debt cannot exceed
# total debt, so either total debt is a corroborated zero (⇒ long-term debt is
# zero too) or it is non-zero (⇒ the capital denominator is alive, so a ratio of
# 0 means a numerator of 0). Both branches are "D/E resolved".
#
# ⛔ The gate only ever runs on a value of 0, which previously always became
# NULL, so the change cannot move a non-zero value — `test_a_real_ratio_is_not
# _touched_by_the_zero_gate` is that control.


def test_lt_debt_zero_publishes_for_a_debt_free_company():
    """The 190-row branch: a corroborated zero D/E — debt-free outright."""
    spec = fb.RATIO_SPECS["lt_debt_to_capital"]
    row = {spec.field: "0", "debtToEquityRatioTTM": "0",
           "debtToAssetsRatioTTM": "0", "debtToCapitalRatioTTM": "0"}
    assert fb.value_for(spec, row) == 0.0


def test_lt_debt_zero_publishes_when_the_company_has_debt_but_none_long_term():
    """The 640-row branch, and the one the old contract got wrong: a live,
    non-zero D/E is itself the proof that the capital denominator is alive."""
    spec = fb.RATIO_SPECS["lt_debt_to_capital"]
    row = {spec.field: "0", "debtToEquityRatioTTM": "1.4"}
    assert fb.value_for(spec, row) == 0.0


def test_the_lt_debt_gate_can_still_refuse():
    """⭐ THE CONTROL `fundamentals_bulk` CITES BY NAME. Without a row that
    makes it fire, the gate is a rule nothing can fail — and on the 2026-08-23
    snapshot `debtToEquityRatioTTM` resolves on all 3,681 rows, so the live data
    cannot supply one. An UNCORROBORATED zero D/E leaves the reading untrusted,
    and the lt-debt zero standing on it is refused."""
    spec = fb.RATIO_SPECS["lt_debt_to_capital"]
    row = {spec.field: "0", "debtToEquityRatioTTM": "0",
           "debtToAssetsRatioTTM": "0.4", "debtToCapitalRatioTTM": "0"}
    assert fb.value_for(spec, row) is None


def test_the_lt_debt_gate_refuses_a_zero_it_cannot_corroborate_at_all():
    """A witness that is ABSENT is not a witness that agrees."""
    spec = fb.RATIO_SPECS["lt_debt_to_capital"]
    row = {spec.field: "0", "debtToEquityRatioTTM": "0",
           "debtToAssetsRatioTTM": "0"}          # debtToCapitalRatioTTM missing
    assert fb.value_for(spec, row) is None
    assert fb.value_for(spec, {spec.field: "0"}) is None, "no D/E at all"


def test_a_real_ratio_is_not_touched_by_the_zero_gate():
    """⛔ The strictly-additive claim: the gate runs only on 0."""
    spec = fb.RATIO_SPECS["lt_debt_to_capital"]
    assert fb.value_for(spec, {spec.field: "0.35"}) == 0.35


def test_ipo_age_derivation():
    import datetime
    from api.services.screener import snapshot_builder
    bars = [{"o": 100, "h": 101, "l": 99, "c": 100, "v": 1000}] * 40
    row = snapshot_builder.build_row(
        "T", bars, None, {"ipo_date": "2020-01-15"})
    want = (datetime.date.today() - datetime.date(2020, 1, 15)).days
    assert row["ipo_age_days"] == want
    row = snapshot_builder.build_row("T", bars, None, {"ipo_date": "junk"})
    assert row["ipo_age_days"] is None
