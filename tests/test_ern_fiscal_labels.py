"""Accuracy follow-up 2 (audit 2026-10-06, design note 6): the ERN modal's
quarter labels come from the SAME fiscal authority as EE's.

EE re-labels its quarterly consensus through `fiscal_calendar` (D4); the ERN
modal's history rows came from FMP's join identity with a calendar-month
fallback, and its upcoming row was numbered by the report date's calendar
month. Now both go through `fiscal_calendar.FiscalCalendar` +
`fiscal_calendar.display_label`.

Independent reference: each company's OWN reported label (Apple's December
quarter is Q1 FY2026; NVIDIA's October quarter is Q3 FY2026), written by hand.
No network: `earnings_estimates._fmp_get` is stubbed.
"""
from __future__ import annotations

import datetime as dt
from unittest import mock

from api.services import earnings_estimates as ee
from api.services import earnings_history_fmp as fh
from api.services.research import estimates_consensus as ec

TODAY = dt.date(2026, 4, 10)

# Apple: FMP normalises the year end to 09-27 while quarter ends drift (V3).
_AAPL_INCOME = [
    {"date": "2026-03-28", "period": "Q2", "fiscalYear": "2026", "acceptedDate": "2026-05-01 18:01:00"},
    {"date": "2025-12-27", "period": "Q1", "fiscalYear": "2026", "acceptedDate": "2026-01-30 18:01:00"},
    {"date": "2025-09-27", "period": "Q4", "fiscalYear": "2025", "acceptedDate": "2025-10-31 18:04:00"},
    {"date": "2025-06-28", "period": "Q3", "fiscalYear": "2025", "acceptedDate": "2025-08-01 18:02:00"},
    {"date": "2024-09-28", "period": "Q4", "fiscalYear": "2024", "acceptedDate": "2024-11-01 18:04:00"},
]
_AAPL_EARNINGS = [
    {"date": "2026-04-30", "epsActual": None, "epsEstimated": 1.62},                 # forward
    {"date": "2026-01-29", "epsActual": 2.40, "epsEstimated": 2.35},
    {"date": "2025-10-30", "epsActual": 1.85, "epsEstimated": 1.77},
    {"date": "2025-07-31", "epsActual": 1.57, "epsEstimated": 1.43},
]

# NVIDIA: January year end; FMP numbers its October quarter Q3 FY2026.
_NVDA_INCOME = [
    {"date": "2025-10-26", "period": "Q3", "fiscalYear": "2026", "acceptedDate": "2025-11-19 16:30:00"},
    {"date": "2025-07-27", "period": "Q2", "fiscalYear": "2026", "acceptedDate": "2025-08-27 16:30:00"},
    # filed, but with no acceptedDate the join cannot use it (the >45-day case)
    {"date": "2025-04-27", "period": "Q1", "fiscalYear": "2026", "acceptedDate": None},
    {"date": "2025-01-26", "period": "Q4", "fiscalYear": "2025", "acceptedDate": "2025-02-26 16:30:00"},
    {"date": "2024-01-28", "period": "Q4", "fiscalYear": "2024", "acceptedDate": "2024-02-21 16:30:00"},
]
_NVDA_EARNINGS = [
    {"date": "2025-11-19", "epsActual": 1.30, "epsEstimated": 1.25},
    {"date": "2025-08-27", "epsActual": 1.05, "epsEstimated": 1.01},
    {"date": "2025-05-28", "epsActual": 0.96, "epsEstimated": 0.93},   # unjoinable -> placed
]

# JAZZ: a December filer -- labels must stay byte for byte what they were.
_JAZZ_INCOME = [
    {"date": "2026-03-31", "period": "Q1", "fiscalYear": "2026", "acceptedDate": "2026-05-05 16:05:00"},
    {"date": "2025-12-31", "period": "Q4", "fiscalYear": "2025", "acceptedDate": "2026-02-24 16:10:00"},
]
_JAZZ_EARNINGS = [
    {"date": "2026-05-05", "epsActual": 6.34, "epsEstimated": 4.64},
    {"date": "2026-02-24", "epsActual": 6.64, "epsEstimated": 6.52},
]


def _run(earnings, income, today=TODAY):
    def fake(path, params=None, timeout=10):
        return {"/stable/earnings": earnings, "/stable/income-statement": income}.get(path)
    with mock.patch.object(ee, "_fmp_get", side_effect=fake):
        return fh.fmp_history("X", limit=8, today=today)


def test_apple_rows_carry_apples_own_fiscal_labels():
    rows, nxt = _run(_AAPL_EARNINGS, _AAPL_INCOME)
    got = {r["period"]: (r["year"], r["quarter"], r["label"]) for r in rows}
    assert got == {
        "2025-12-27": (2026, 1, "Q1 FY2026"),     # Apple: "fiscal 2026 first quarter"
        "2025-09-27": (2025, 4, "Q4 FY2025"),
        "2025-06-28": (2025, 3, "Q3 FY2025"),
    }
    # The upcoming report (Apr 30) covers the March quarter: Apple's fiscal Q2.
    assert nxt == {"report_date": "2026-04-30", "period_end": "2026-03-28",
                   "fiscal_year": 2026, "fiscal_quarter": 2, "label": "Q2 FY2026"}


def test_nvidia_rows_and_an_unjoined_row_are_placed_by_the_calendar():
    rows, nxt = _run(_NVDA_EARNINGS, _NVDA_INCOME, today=dt.date(2025, 12, 1))
    got = {r["report_date"]: (r["period"], r["label"]) for r in rows}
    assert got["2025-11-19"] == ("2025-10-26", "Q3 FY2026")
    assert got["2025-08-27"] == ("2025-07-27", "Q2 FY2026")
    # The join cannot match the May print; the calendar places it on the filed
    # April quarter end -- NVIDIA's own Q1 FY2026 (ended 2025-04-27).
    assert got["2025-05-28"] == ("2025-04-27", "Q1 FY2026")
    assert nxt is None, "no forward row -> no next-report identity, never a guess"


def test_a_december_filer_keeps_its_label_byte_for_byte():
    rows, _ = _run(_JAZZ_EARNINGS, _JAZZ_INCOME, today=dt.date(2026, 6, 1))
    assert [r["label"] for r in rows] == ["Q1 2026", "Q4 2025"]
    # ...which is exactly EE's calendar label for those period ends.
    assert [ec._quarter_label(r["period"]) for r in rows] == ["Q1 2026", "Q4 2025"]


def test_ern_and_ee_print_the_same_label_for_the_same_quarter():
    """One authority: EE's `fiscal_relabel` (annual anchors) and the ERN
    history rows (income-statement anchors) agree on every quarter."""
    for earnings, income, today, year_ends in (
        (_AAPL_EARNINGS, _AAPL_INCOME, TODAY, ["2024-09-27", "2025-09-27", "2026-09-27"]),
        (_NVDA_EARNINGS, _NVDA_INCOME, dt.date(2025, 12, 1), ["2025-01-26", "2026-01-25"]),
        (_JAZZ_EARNINGS, _JAZZ_INCOME, dt.date(2026, 6, 1), ["2025-12-31", "2026-12-31"]),
    ):
        rows, _ = _run(earnings, income, today=today)
        ee_rows = [{"period_end": r["period"], "label": ec._quarter_label(r["period"])} for r in rows]
        ec.fiscal_relabel(ee_rows, [{"date": d} for d in year_ends])
        assert [r["label"] for r in rows] == [e["label"] for e in ee_rows]


def test_without_a_q4_row_no_label_is_invented():
    income = [r for r in _JAZZ_INCOME if r["period"] != "Q4"]
    rows, nxt = _run(_JAZZ_EARNINGS, income, today=dt.date(2026, 6, 1))
    assert all(r["label"] is None for r in rows)
    assert rows[0]["year"] == 2026 and rows[0]["quarter"] == 1     # FMP's join identity kept
    assert nxt is None


def test_fmp_beat_history_contract_is_unchanged():
    def fake(path, params=None, timeout=10):
        return {"/stable/earnings": _JAZZ_EARNINGS, "/stable/income-statement": _JAZZ_INCOME}.get(path)
    with mock.patch.object(ee, "_fmp_get", side_effect=fake):
        rows = fh.fmp_beat_history("JAZZ")
    assert isinstance(rows, list) and len(rows) == 2
    with mock.patch.object(ee, "_fmp_get", return_value=None):
        assert fh.fmp_beat_history("JAZZ") is None
