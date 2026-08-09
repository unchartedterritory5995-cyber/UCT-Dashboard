"""FMP-sourced earnings history: right quarter, right revenue, right silence.

The join key here is `acceptedDate` (the filing) rather than the fiscal period
end, because nearest-period-end is WRONG for calendar-year filers and wrong in
the worst way — it produces a plausible duplicate rather than an error. These
tests use the real shapes measured live on 2026-08-06.
"""
from unittest import mock

from api.services import earnings_estimates as ee
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
    def fake(path, params=None, timeout=10):
        if path == "/stable/earnings":
            return earnings
        if path == "/stable/income-statement":
            return income
        return None
    # Patch the OWNING module, not `fh`. `earnings_history_fmp` resolves
    # `_fmp_get` through `earnings_estimates` at call time precisely so it
    # cannot escape the guards (or the stubs) every other caller goes through —
    # see TestItCannotEscapeTheOwningModule below.
    with mock.patch.object(ee, "_fmp_get", side_effect=fake):
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


class TestItCannotEscapeTheOwningModule:
    """`earnings_history_fmp` must resolve `_fmp_get` THROUGH
    `earnings_estimates`, not bind its own copy at import.

    A bound copy quietly severs this module from the one that owns the
    provider call: patching `earnings_estimates._fmp_get` -- how every other
    caller is guarded and every existing test stubs the provider -- would not
    reach here, so it would keep issuing real HTTP while the rest of the
    process believed the provider was stubbed or shed.

    Caught for real: after this module was wired into `past_reports`, a live
    `/stable/earnings` request escaped straight through a test asserting that
    an ACTIVE Finnhub cooldown lets no HTTP out. The suite passed file-by-file
    and only failed in combination, which is exactly how a defect like this
    survives.
    """

    def test_patching_earnings_estimates_reaches_this_module(self, monkeypatch):
        from api.services import earnings_estimates as ee
        from api.services import earnings_history_fmp as mod

        seen = []

        def stub(path, params, timeout=10):
            seen.append(path)
            return []

        monkeypatch.setattr(ee, "_fmp_get", stub)
        mod.fmp_beat_history("JAZZ", limit=4)
        assert seen, "the stub was never reached — this module bound its own _fmp_get"
        assert any("/stable/earnings" in p for p in seen)

    def test_no_module_level_binding_of_the_provider_call(self):
        """The structural guard. Without it, someone reintroduces
        `from ...earnings_estimates import _fmp_get` and only a cross-file test
        ordering reveals it."""
        from api.services import earnings_history_fmp as mod
        assert not hasattr(mod, "_fmp_get"), (
            "earnings_history_fmp binds its own _fmp_get again — resolve it "
            "through the earnings_estimates module at call time instead"
        )


class TestTheJoinWindowCoversA10K:
    """Q4 filings land WEEKS after the announcement, not days.

    `_MAX_JOIN_DAYS` was 5, picked from a 4-ticker sample (JAZZ, AAPL, NVDA,
    MSFT) measuring 0-1 days -- large caps that file fast. It generalized
    badly: a 10-Q lands within days of the announcement but a 10-K lands weeks
    after it, so EVERY Q4 fell outside the window, lost its fiscal identity,
    and fell back to deriving a label from the calendar month -- which then
    COLLIDED with a real one. The visible symptom was an axis reading
    "Q2 25 ... Q2 25 ... Q1 26 ... Q1 26" with Q4 nowhere.

    Re-measured over 180 joins across 15 tickers (2026-08-08):
        Q1/Q2/Q3  median 0 days, max 9
        Q4        median 5 days, max 29   <- the 10-K lag
        40 of 180 (22%) exceeded the old 5.
    """

    def test_a_q4_filing_weeks_later_still_joins(self):
        earnings = [{"date": "2026-02-02", "epsActual": 0.5, "epsEstimated": 0.4}]
        income = [{"date": "2025-12-31", "period": "Q4", "fiscalYear": "2025",
                   "acceptedDate": "2026-02-17 16:30:00"}]      # 15 days later
        rows = _run(earnings, income)
        assert rows[0]["quarter"] == 4 and rows[0]["year"] == 2025

    def test_the_observed_worst_case_still_joins(self):
        """29 days was the widest real gap measured; the window must cover it
        with headroom rather than sitting exactly on it."""
        earnings = [{"date": "2026-02-02", "epsActual": 0.5, "epsEstimated": 0.4}]
        income = [{"date": "2025-12-31", "period": "Q4", "fiscalYear": "2025",
                   "acceptedDate": "2026-03-03 16:30:00"}]      # 29 days
        rows = _run(earnings, income)
        assert rows[0]["quarter"] == 4
        assert fh._MAX_JOIN_DAYS > 29, "no headroom above the observed maximum"

    def test_it_still_cannot_reach_a_NEIGHBOURING_quarter(self):
        """The window must stay well under a quarter (~91 days) or it stops
        being a tolerance and starts guessing -- the mislabelling this join
        exists to prevent."""
        assert fh._MAX_JOIN_DAYS < 91 / 2, "window could reach an adjacent period"

    def test_a_filing_a_whole_quarter_away_is_still_refused(self):
        earnings = [{"date": "2026-02-02", "epsActual": 0.5, "epsEstimated": 0.4}]
        income = [{"date": "2026-03-31", "period": "Q1", "fiscalYear": "2026",
                   "acceptedDate": "2026-05-05 16:30:00"}]      # ~92 days
        rows = _run(earnings, income)
        assert rows[0]["quarter"] is None

    def test_every_quarter_of_a_year_gets_a_DISTINCT_label(self):
        """The end-to-end property the axis actually needs: four announcements
        with realistic filing lags produce Q1-Q4, no duplicates, none missing."""
        earnings = [
            {"date": "2026-02-02", "epsActual": 0.6, "epsEstimated": 0.5},   # Q4, 10-K
            {"date": "2025-11-03", "epsActual": 0.5, "epsEstimated": 0.4},   # Q3
            {"date": "2025-08-04", "epsActual": 0.4, "epsEstimated": 0.3},   # Q2
            {"date": "2025-05-05", "epsActual": 0.3, "epsEstimated": 0.2},   # Q1
        ]
        income = [
            {"date": "2025-12-31", "period": "Q4", "fiscalYear": "2025",
             "acceptedDate": "2026-02-17 16:00:00"},                          # +15d
            {"date": "2025-09-30", "period": "Q3", "fiscalYear": "2025",
             "acceptedDate": "2025-11-03 16:00:00"},
            {"date": "2025-06-30", "period": "Q2", "fiscalYear": "2025",
             "acceptedDate": "2025-08-04 16:00:00"},
            {"date": "2025-03-31", "period": "Q1", "fiscalYear": "2025",
             "acceptedDate": "2025-05-05 16:00:00"},
        ]
        rows = _run(earnings, income)
        labels = [(r["year"], r["quarter"]) for r in rows]
        assert None not in [q for _, q in labels], f"a quarter lost its identity: {labels}"
        assert len(set(labels)) == len(labels), f"duplicate quarter label: {labels}"
        assert sorted(q for _, q in labels) == [1, 2, 3, 4]
