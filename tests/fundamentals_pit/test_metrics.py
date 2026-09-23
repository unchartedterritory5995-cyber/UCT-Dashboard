"""Metrics over ONE knowledge state: TTM, YoY, margins, tag pools, staleness."""
from datetime import date

from api.services.fundamentals_pit import knowledge as K, metrics as M

from ._build import D, fact, filing, utc

NOW = utc("2030-01-01T00:00:00")


def _book(facts, filings, t=NOW):
    kb = K.build(facts, {f.accn: f for f in filings})
    return M.build_book(kb.state_at(t), None, kb, t), kb


def _year(concept, y, q1, h1, m9, fy, accn_prefix, unit="USD"):
    s = f"{y}-01-01"
    return [fact(concept, s, f"{y}-03-31", q1, f"{accn_prefix}1", unit=unit),
            fact(concept, s, f"{y}-06-30", h1, f"{accn_prefix}2", unit=unit),
            fact(concept, s, f"{y}-09-30", m9, f"{accn_prefix}3", unit=unit),
            fact(concept, s, f"{y}-12-31", fy, f"{accn_prefix}4", unit=unit)]


def _filings(y, prefix):
    return [filing(f"{prefix}1", f"{y}-05-01T20:00:00"), filing(f"{prefix}2", f"{y}-08-01T20:00:00"),
            filing(f"{prefix}3", f"{y}-11-01T20:00:00"), filing(f"{prefix}4", f"{y + 1}-02-15T20:00:00", form="10-K")]


def test_ttm_at_fiscal_year_end_is_the_reported_fy_value():
    b, _ = _book(_year("Revenues", 2023, 100, 210, 330, 460, "A"), _filings(2023, "A"))
    v = M.ttm(b, "revenue", D("2023-12-31"))
    assert v.v == 460 and v.note == "fiscal_year"


def test_ttm_mid_year_rolls_fy_prev_plus_ytd_minus_prior_ytd():
    facts = _year("Revenues", 2023, 100, 210, 330, 460, "A") + [
        fact("Revenues", "2024-01-01", "2024-06-30", 260, "B2"),
        fact("Revenues", "2023-01-01", "2023-06-30", 210, "B2")]
    b, _ = _book(facts, _filings(2023, "A") + [filing("B2", "2024-08-01T20:00:00")])
    v = M.ttm(b, "revenue", D("2024-06-30"))
    assert v.v == 460 + 260 - 210 and v.note == "ytd_roll"


def test_yoy_growth_uses_same_book_and_refuses_non_positive_base():
    f = _year("Revenues", 2023, 100, 210, 330, 460, "A") + _year("Revenues", 2024, 120, 250, 390, 550, "B")
    fl = _filings(2023, "A") + _filings(2024, "B")
    b, _ = _book(f, fl)
    g = M.METRICS["revenue_growth_ttm"][0](b, D("2024-12-31"))
    assert abs(g.v - (550 / 460 - 1)) < 1e-12
    f2 = _year("NetIncomeLoss", 2023, -1, -2, -3, -4, "A") + _year("NetIncomeLoss", 2024, 1, 2, 3, 4, "B")
    b2, _ = _book(f2, fl)
    assert M.METRICS["net_income_growth_ttm"][0](b2, D("2024-12-31")) is None


def test_margin_uses_the_same_four_quarters_and_null_denominator():
    f = _year("Revenues", 2023, 100, 210, 330, 460, "A") + _year("NetIncomeLoss", 2023, 10, 21, 33, 46, "A")
    b, _ = _book(f, _filings(2023, "A"))
    assert abs(M.METRICS["net_margin_ttm"][0](b, D("2023-12-31")).v - 0.1) < 1e-12
    f0 = _year("Revenues", 2023, 0, 0, 0, 0, "A") + _year("NetIncomeLoss", 2023, 10, 21, 33, 46, "A")
    b0, _ = _book(f0, _filings(2023, "A"))
    assert M.METRICS["net_margin_ttm"][0](b0, D("2023-12-31")) is None     # divide by zero


def test_units_are_never_mixed():
    # an EPS-unit fact under a revenue tag must not become revenue
    f = [fact("Revenues", "2023-01-01", "2023-12-31", 5.5, "A4", unit="USD/shares")]
    b, _ = _book(f, [filing("A4", "2024-02-15T20:00:00", form="10-K")])
    assert M.ttm(b, "revenue", D("2023-12-31")) is None


def test_equivalent_tags_pool_across_a_tag_change():
    # NVDA: 10-Qs tag `Revenues`, the 10-K tags `RevenueFromContract...`; they
    # agree on shared periods, so Q4 = FY - 9M may use both.
    RFC = "RevenueFromContractWithCustomerExcludingAssessedTax"
    f = [fact("Revenues", "2023-01-01", "2023-09-30", 330, "A3"),
         fact("Revenues", "2022-01-01", "2022-12-31", 400, "A0"),
         fact(RFC, "2022-01-01", "2022-12-31", 400, "A4"),
         fact(RFC, "2023-01-01", "2023-12-31", 460, "A4")]
    fl = [filing("A0", "2023-02-15T20:00:00", form="10-K"), filing("A3", "2023-11-01T20:00:00"),
          filing("A4", "2024-02-15T20:00:00", form="10-K")]
    b, _ = _book(f, fl)
    assert M.quarter_value(b, "revenue", D("2023-12-31")).v == 130


def test_non_equivalent_tags_never_subtract():
    # CAT: `Revenues` (total) vs `SalesRevenueNet` (machinery only) always differ
    f = [fact("Revenues", "2023-01-01", "2023-09-30", 330, "A3"),
         fact("Revenues", "2022-01-01", "2022-12-31", 440, "A0"),
         fact("SalesRevenueNet", "2022-01-01", "2022-12-31", 400, "A0"),
         fact("SalesRevenueNet", "2023-01-01", "2023-12-31", 420, "A4")]
    fl = [filing("A0", "2023-02-15T20:00:00", form="10-K"), filing("A3", "2023-11-01T20:00:00"),
          filing("A4", "2024-02-15T20:00:00", form="10-K")]
    b, _ = _book(f, fl)
    assert M.quarter_value(b, "revenue", D("2023-12-31")) is None


def test_restated_fy_minus_unrestated_9m_is_withheld():
    # the AAPL 2010 hazard, after warm-up: FY restated by a 10-K/A while the 9M
    # on record is from before it -> Q4 must not be manufactured.
    f = [fact("Revenues", "2023-01-01", "2023-09-30", 330, "A3"),
         fact("Revenues", "2023-01-01", "2023-12-31", 460, "A4"),
         fact("Revenues", "2023-01-01", "2023-12-31", 500, "AA")]
    fl = [filing("A3", "2023-11-01T20:00:00"), filing("A4", "2024-02-15T20:00:00", form="10-K"),
          filing("AA", "2024-05-01T20:00:00", form="10-K/A")]
    b_before, _ = _book(f, fl, utc("2024-03-01T00:00:00"))
    assert M.quarter_value(b_before, "revenue", D("2023-12-31")).v == 130
    b_after, _ = _book(f, fl, utc("2024-06-01T00:00:00"))
    assert M.quarter_value(b_after, "revenue", D("2023-12-31")) is None
    assert M.ttm(b_after, "revenue", D("2023-12-31")).v == 500


def test_more_recent_tag_wins_a_period_reported_under_two_tags():
    # SMCI restated FY2015 revenue under `Revenues`; original was `SalesRevenueNet`
    f = [fact("SalesRevenueNet", "2014-07-01", "2015-06-30", 1_991, "O"),
         fact("Revenues", "2014-07-01", "2015-06-30", 1_954, "R")]
    fl = [filing("O", "2015-09-10T13:00:00", form="10-K"), filing("R", "2019-05-17T10:00:00", form="10-K")]
    b, _ = _book(f, fl)
    assert M.ttm(b, "revenue", D("2015-06-30")).v == 1_954


def test_cross_tag_exact_negative_is_a_sign_error_priority_wins():
    OCF, OCF_C = "NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"
    f = [fact(OCF, "2018-01-01", "2018-12-31", 4_275_713, "A"),
         fact(OCF_C, "2018-01-01", "2018-12-31", -4_275_713, "B")]
    fl = [filing("A", "2019-03-01T20:00:00", form="10-K"), filing("B", "2019-05-01T20:00:00")]
    b, _ = _book(f, fl)
    assert M.ttm(b, "operating_cash_flow", D("2018-12-31")).v == 4_275_713


def test_roe_needs_both_ends_of_the_year():
    f = _year("NetIncomeLoss", 2023, 10, 21, 33, 46, "A") + [
        fact("StockholdersEquity", None, "2023-12-31", 500, "A4"),
        fact("StockholdersEquity", None, "2022-12-31", 420, "A4")]
    b, _ = _book(f, _filings(2023, "A"))
    assert abs(M.METRICS["roe_ttm"][0](b, D("2023-12-31")).v - 46 / 460) < 1e-12
    b1, _ = _book(f[:-1], _filings(2023, "A"))
    assert M.METRICS["roe_ttm"][0](b1, D("2023-12-31")) is None
