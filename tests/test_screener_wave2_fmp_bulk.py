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


def test_lt_debt_zero_needs_both_debt_witnesses():
    spec = fb.RATIO_SPECS["lt_debt_to_capital"]
    row = {spec.field: "0", "debtToEquityRatioTTM": "0",
           "debtToAssetsRatioTTM": "0"}
    assert fb.value_for(spec, row) == 0.0
    row["debtToAssetsRatioTTM"] = "0.4"
    assert fb.value_for(spec, row) is None


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
