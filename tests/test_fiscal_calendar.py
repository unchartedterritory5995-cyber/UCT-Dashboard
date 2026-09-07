"""Fiscal-calendar correctness — the audit's top finding.

Every case here is a REAL company's fiscal calendar, anchored on fiscal-year-end
dates the company actually filed. The expectations are the fiscal periods those
companies themselves report, not what a calendar-quarter assumption produces.

The regression these lock down: labelling a quarter from its REPORT date while
assuming a calendar fiscal year, which put Micron and Microsoft two quarters out
and NVIDIA and Walmart a full fiscal year out.
"""
from __future__ import annotations

from datetime import date

import pytest

from api.services.fiscal_calendar import FiscalCalendar, fiscal_year_label, label


# ── real fiscal-year-end anchors ────────────────────────────────────────────
# (fiscal years these end are noted beside each date)
MU = ["2023-08-31", "2024-08-29", "2025-08-28"]        # Thu nearest 31 Aug, 52/53wk
NVDA = ["2024-01-28", "2025-01-26", "2026-01-25"]      # last Sun of Jan, 52/53wk
AAPL = ["2023-09-30", "2024-09-28", "2025-09-27"]      # last Sat of Sep, 52/53wk
MSFT = ["2024-06-30", "2025-06-30", "2026-06-30"]      # 30 Jun, month-anchored
WMT = ["2025-01-31", "2026-01-31", "2027-01-31"]       # 31 Jan, month-anchored
AVGO = ["2023-10-29", "2024-11-03", "2025-11-02"]      # Sun nearest 31 Oct, 52/53wk
KO = ["2023-12-31", "2024-12-31", "2025-12-31"]        # 31 Dec, month-anchored


class TestFiscalYearLabel:
    def test_end_year_is_the_label_for_ordinary_closes(self):
        assert fiscal_year_label(date(2026, 8, 27)) == 2026
        assert fiscal_year_label(date(2026, 6, 30)) == 2026
        assert fiscal_year_label(date(2026, 12, 31)) == 2026

    def test_late_january_close_keeps_the_end_year(self):
        # NVIDIA's FY2026 ends 25 Jan 2026; Walmart's FY2027 ends 31 Jan 2027.
        assert fiscal_year_label(date(2026, 1, 25)) == 2026
        assert fiscal_year_label(date(2027, 1, 31)) == 2027

    def test_early_january_close_belongs_to_the_prior_year(self):
        # A 52/53-week filer closing "the Sunday nearest 31 December" ends
        # fiscal 2026 on 3 Jan 2027 — it is FY2026, not FY2027.
        assert fiscal_year_label(date(2027, 1, 3)) == 2026
        assert fiscal_year_label(date(2027, 1, 1)) == 2026


class TestCalendarStyleDetection:
    @pytest.mark.parametrize("anchors", [MU, NVDA, AAPL, AVGO])
    def test_5253_week_filers_detected(self, anchors):
        assert FiscalCalendar(anchors).is_5253 is True

    @pytest.mark.parametrize("anchors", [MSFT, WMT, KO])
    def test_month_anchored_filers_detected(self, anchors):
        assert FiscalCalendar(anchors).is_5253 is False


class TestResolvePeriodEnd:
    """The headline table from the audit — every one of these was wrong before."""

    @pytest.mark.parametrize("name,anchors,period_end,fy,fq", [
        # 52/53-week filers
        ("MU   Q3 FY26", MU, "2026-05-28", 2026, 3),
        ("MU   Q1 FY26", MU, "2025-11-27", 2026, 1),
        ("MU   Q4 FY25", MU, "2025-08-28", 2025, 4),
        ("NVDA Q1 FY27", NVDA, "2026-04-26", 2027, 1),
        ("NVDA Q4 FY26", NVDA, "2026-01-25", 2026, 4),
        ("NVDA Q3 FY26", NVDA, "2025-10-26", 2026, 3),
        ("AAPL Q3 FY26", AAPL, "2026-06-27", 2026, 3),
        ("AAPL Q1 FY26", AAPL, "2025-12-27", 2026, 1),
        ("AAPL Q4 FY25", AAPL, "2025-09-27", 2025, 4),
        ("AVGO Q2 FY26", AVGO, "2026-05-03", 2026, 2),
        ("AVGO Q4 FY25", AVGO, "2025-11-02", 2025, 4),
        # month-anchored filers
        ("MSFT Q3 FY26", MSFT, "2026-03-31", 2026, 3),
        ("MSFT Q1 FY26", MSFT, "2025-09-30", 2026, 1),
        ("MSFT Q4 FY26", MSFT, "2026-06-30", 2026, 4),
        ("WMT  Q1 FY27", WMT, "2026-04-30", 2027, 1),
        ("WMT  Q4 FY26", WMT, "2026-01-31", 2026, 4),
        ("WMT  Q3 FY26", WMT, "2025-10-31", 2026, 3),
        ("KO   Q1 FY26", KO, "2026-03-31", 2026, 1),
        ("KO   Q4 FY25", KO, "2025-12-31", 2025, 4),
        ("KO   Q2 FY26", KO, "2026-06-30", 2026, 2),
    ])
    def test_period_end_resolves_to_the_companys_own_fiscal_period(
            self, name, anchors, period_end, fy, fq):
        got = FiscalCalendar(anchors).resolve(period_end)
        assert (got["fiscal_year"], got["fiscal_quarter"]) == (fy, fq), (
            f"{name}: expected FY{fy} Q{fq}, got FY{got['fiscal_year']} Q{got['fiscal_quarter']}")

    def test_every_quarter_of_a_fiscal_year_is_distinct(self):
        """Four consecutive quarter ends must map to Q1..Q4 of one fiscal year —
        the property that a drifting boundary would break."""
        cal = FiscalCalendar(MU)
        ends = ["2025-11-27", "2026-02-26", "2026-05-28", "2026-08-27"]
        got = [cal.resolve(e) for e in ends]
        assert [g["fiscal_quarter"] for g in got] == [1, 2, 3, 4]
        assert {g["fiscal_year"] for g in got} == {2026}

    def test_confidence_marks_filed_period_ends(self):
        cal = FiscalCalendar(MSFT, period_ends=["2026-03-31"])
        assert cal.resolve("2026-03-31")["confidence"] == "observed"
        assert cal.resolve("2025-12-31")["confidence"] == "derived"


class TestHonestDegradation:
    def test_no_anchors_declines_rather_than_guessing_calendar_quarters(self):
        got = FiscalCalendar([]).resolve("2026-05-28")
        assert got["fiscal_year"] is None
        assert got["fiscal_quarter"] is None
        assert got["confidence"] is None

    def test_unparseable_date_declines(self):
        assert FiscalCalendar(MU).resolve("not-a-date")["fiscal_year"] is None
        assert FiscalCalendar(MU).resolve(None)["fiscal_year"] is None

    def test_year_end_month_fallback_is_flagged_approximate(self):
        cal = FiscalCalendar.from_year_end_month(6)
        got = cal.resolve("2026-03-31")
        assert (got["fiscal_year"], got["fiscal_quarter"]) == (2026, 3)
        assert got["confidence"] == "approximate"

    def test_year_end_month_fallback_rejects_nonsense(self):
        assert FiscalCalendar.from_year_end_month(None) is None
        assert FiscalCalendar.from_year_end_month(0) is None
        assert FiscalCalendar.from_year_end_month(13) is None


class TestQuarterEnd:
    @pytest.mark.parametrize("anchors,fy,q,expected", [
        (MSFT, 2026, 1, "2025-09-30"),
        (MSFT, 2026, 2, "2025-12-31"),
        (MSFT, 2026, 3, "2026-03-31"),
        (MSFT, 2026, 4, "2026-06-30"),
        (KO, 2026, 1, "2026-03-31"),
        (KO, 2026, 4, "2026-12-31"),
        (WMT, 2027, 1, "2026-04-30"),
    ])
    def test_month_anchored_quarter_ends_are_exact(self, anchors, fy, q, expected):
        assert FiscalCalendar(anchors).quarter_end(fy, q).isoformat() == expected

    def test_5253_quarter_ends_land_within_a_week_of_the_real_date(self):
        # Generated ends are used only to attribute a report date to a quarter,
        # so being inside the ±45-day slack of a boundary is what matters.
        cal = FiscalCalendar(MU)
        got = cal.quarter_end(2026, 3)
        assert abs((got - date(2026, 5, 28)).days) <= 7

    def test_quarter_end_round_trips_through_resolve(self):
        for anchors in (MU, NVDA, AAPL, MSFT, WMT, AVGO, KO):
            cal = FiscalCalendar(anchors)
            for q in (1, 2, 3, 4):
                pe = cal.quarter_end(2026, q)
                back = cal.resolve(pe)
                assert (back["fiscal_year"], back["fiscal_quarter"]) == (2026, q)


class TestReportDateAttribution:
    """The tier-1 join: FMP keys a quarter by REPORT date and carries no period
    end, so the period has to be recovered from the calendar."""

    @pytest.mark.parametrize("name,anchors,report_date,fy,fq", [
        ("MU   reports Q3 FY26 in late June", MU, "2026-06-25", 2026, 3),
        ("NVDA reports Q1 FY27 in late May", NVDA, "2026-05-27", 2027, 1),
        ("AAPL reports Q3 FY26 end of July", AAPL, "2026-07-30", 2026, 3),
        ("MSFT reports Q3 FY26 late April", MSFT, "2026-04-28", 2026, 3),
        ("WMT  reports Q1 FY27 mid May", WMT, "2026-05-14", 2027, 1),
        ("AVGO reports Q2 FY26 early June", AVGO, "2026-06-04", 2026, 2),
        ("KO   reports Q1 FY26 late April", KO, "2026-04-28", 2026, 1),
    ])
    def test_report_date_maps_to_the_quarter_it_reported(
            self, name, anchors, report_date, fy, fq):
        got = FiscalCalendar(anchors).period_end_for_report(report_date)
        assert (got["fiscal_year"], got["fiscal_quarter"]) == (fy, fq), (
            f"{name}: expected FY{fy} Q{fq}, got FY{got['fiscal_year']} Q{got['fiscal_quarter']}")

    def test_prefers_a_period_end_the_company_actually_filed(self):
        cal = FiscalCalendar(MSFT, period_ends=["2026-03-31"])
        got = cal.period_end_for_report("2026-04-28")
        assert got["period_end"] == "2026-03-31"
        assert got["confidence"] == "observed"

    def test_declines_without_a_calendar(self):
        got = FiscalCalendar([]).period_end_for_report("2026-04-28")
        assert got["period_end"] is None
        assert got["fiscal_year"] is None

    def test_declines_an_unparseable_report_date(self):
        assert FiscalCalendar(MSFT).period_end_for_report("soon")["period_end"] is None
        assert FiscalCalendar(MSFT).period_end_for_report(None)["period_end"] is None

    def test_never_attributes_a_report_to_a_period_that_has_not_closed(self):
        """A report cannot precede the quarter it reports. The nearest quarter
        end to 2 Apr 2026 for Microsoft is 31 Mar 2026 — two days earlier, which
        is inside no plausible filing lag — so this must resolve to the quarter
        BEFORE it, never forward to the one just closed."""
        got = FiscalCalendar(MSFT).period_end_for_report("2026-04-02")
        assert got["period_end"] == "2025-12-31"
        assert (got["fiscal_year"], got["fiscal_quarter"]) == (2026, 2)

    def test_lag_is_reported_so_callers_can_sanity_check(self):
        got = FiscalCalendar(MSFT).period_end_for_report("2026-04-28")
        assert got["lag_days"] == 28

    def test_two_adjacent_reports_do_not_collapse_onto_one_period(self):
        """The audit's rule: nearby dates must never be enough to fuse periods."""
        cal = FiscalCalendar(MSFT)
        q3 = cal.period_end_for_report("2026-04-28")
        q4 = cal.period_end_for_report("2026-07-29")
        assert q3["period_end"] != q4["period_end"]
        assert (q3["fiscal_year"], q3["fiscal_quarter"]) == (2026, 3)
        assert (q4["fiscal_year"], q4["fiscal_quarter"]) == (2026, 4)


class TestFromStatements:
    def test_builds_from_a_statements_payload(self):
        payload = {"income": {
            "annual": [{"period": p, "values": {}} for p in reversed(MSFT)],
            "quarterly": [{"period": "2026-03-31", "values": {}}],
        }}
        cal = FiscalCalendar.from_statements(payload)
        assert cal is not None
        assert cal.resolve("2026-03-31")["fiscal_quarter"] == 3
        assert cal.resolve("2026-03-31")["confidence"] == "observed"

    def test_returns_none_without_annual_anchors(self):
        assert FiscalCalendar.from_statements({}) is None
        assert FiscalCalendar.from_statements({"income": {"annual": []}}) is None
        # An ETF has no income statement at all.
        assert FiscalCalendar.from_statements({"security_type": "etf"}) is None


class TestDescribe:
    def test_describes_a_known_calendar(self):
        d = FiscalCalendar(AVGO).describe()
        assert d["known"] is True
        assert d["quarter_basis"] == "13-week blocks"
        assert d["fiscal_year_end"] == "2025-11-02"
        assert d["anchors_observed"] == 3

    def test_describes_an_unknown_calendar(self):
        assert FiscalCalendar([]).describe() == {"known": False}


class TestLabel:
    def test_formats_a_period(self):
        assert label(2026, 3) == "FY2026 Q3"

    def test_declines_incomplete_periods(self):
        assert label(None, 3) is None
        assert label(2026, None) is None
