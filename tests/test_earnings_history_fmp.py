"""FMP-sourced earnings history: right quarter, right revenue, right silence.

The join key here is `acceptedDate` (the filing) rather than the fiscal period
end, because nearest-period-end is WRONG for calendar-year filers and wrong in
the worst way — it produces a plausible duplicate rather than an error. These
tests use the real shapes measured live on 2026-08-06.
"""
from unittest import mock

from api.services import earnings_history_fmp as fh


# JAZZ — a Dec-end filer. Q4 FY2025 (ended 2025-12-31) was announced
# 2026-02-24, which is 55 days AFTER its own period end but only 35 days
# BEFORE the NEXT period end (2026-03-31). Nearest-period-end therefore
# labelled it "Q1 FY2026" — a duplicate of the row above it.
_JAZZ_EARNINGS = [
    {"date": "2026-11-04", "epsActual": None, "epsEstimated": 6.42,
     "revenueActual": None, "revenueEstimated": 1209631000},          # forward
    {"date": "2026-05-05", "epsActual": 6.34, "epsEstimated": 4.64,
     "revenueActual": 1068900000, "revenueEstimated": 978656400},
    {"date": "2026-02-24", "epsActual": 6.64, "epsEstimated": 6.52,
     "revenueActual": 1197926000, "revenueEstimated": 1165182000},
]
_JAZZ_INCOME = [
    {"date": "2026-03-31", "period": "Q1", "fiscalYear": "2026",
     "acceptedDate": "2026-05-05 16:05:00"},
    {"date": "2025-12-31", "period": "Q4", "fiscalYear": "2025",
     "acceptedDate": "2026-02-24 16:10:00"},
    {"date": "2026-06-30", "period": "FY", "fiscalYear": "2026",
     "acceptedDate": "2026-08-03 16:08:34"},                          # annual row
]


def _run(earnings, income, limit=8):
    def fake(path, params=None):
        if path == "/stable/earnings":
            return earnings
        if path == "/stable/income-statement":
            return income
        return None
    with mock.patch.object(fh, "_fmp_get", side_effect=fake):
        return fh.fmp_beat_history("JAZZ", limit=limit)


def test_a_december_filer_gets_distinct_sequential_quarters():
    """The regression this join exists for: no duplicate quarter labels."""
    rows = _run(_JAZZ_EARNINGS, _JAZZ_INCOME)
    labels = [(r["year"], r["quarter"]) for r in rows]
    assert labels == [(2026, 1), (2025, 4)], labels
    assert len(set(labels)) == len(labels), f"duplicate quarter: {labels}"


def test_the_period_field_stays_the_fiscal_period_end():
    """The client reads `period` as the period END (Finnhub's meaning)."""
    rows = _run(_JAZZ_EARNINGS, _JAZZ_INCOME)
    assert rows[0]["period"] == "2026-03-31"
    assert rows[1]["period"] == "2025-12-31"


def test_revenue_comes_through():
    """The whole reason the REV column rendered an em dash on every row."""
    rows = _run(_JAZZ_EARNINGS, _JAZZ_INCOME)
    assert rows[0]["revenue_actual"] == 1068900000
    assert rows[0]["revenue_estimate"] == 978656400


def test_forward_quarters_are_excluded():
    """`beat_history` is REPORTED quarters only — a null actual is not one."""
    rows = _run(_JAZZ_EARNINGS, _JAZZ_INCOME)
    assert all(r["actual"] is not None for r in rows)
    assert "2026-11-04" not in [r["report_date"] for r in rows]


def test_annual_FY_rows_never_supply_fiscal_identity():
    """FMP mixes an annual 'FY' row into the quarterly list; it is not a
    quarter and must never be joined to a quarterly announcement."""
    rows = _run(_JAZZ_EARNINGS, _JAZZ_INCOME)
    assert all(r["quarter"] in (1, 2, 3, 4) for r in rows if r["quarter"] is not None)


def test_a_missing_income_statement_degrades_but_does_not_disappear():
    """Losing fiscal identity must cost the LABEL, not the whole history —
    EPS and revenue are still real and worth showing."""
    rows = _run(_JAZZ_EARNINGS, None)
    assert len(rows) == 2
    assert rows[0]["revenue_actual"] == 1068900000
    assert rows[0]["quarter"] is None          # no identity, honestly absent


def test_no_answer_from_fmp_is_None_not_empty():
    """None vs [] is the signal that stops the modal claiming a company never
    reported. An empty LIST is an answer; None is a shrug."""
    assert _run(None, _JAZZ_INCOME) is None
    assert _run([], _JAZZ_INCOME) == []


def test_a_filing_far_from_the_announcement_is_not_joined():
    """The tolerance absorbs clock skew, not a search for a plausible quarter."""
    far = [{"date": "2026-03-31", "period": "Q1", "fiscalYear": "2026",
            "acceptedDate": "2026-01-01 16:00:00"}]
    rows = _run([_JAZZ_EARNINGS[1]], far)
    assert rows[0]["quarter"] is None
