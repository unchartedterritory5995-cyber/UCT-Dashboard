"""Fiscal-calendar resolution: which fiscal quarter is a given period?

WHY THIS EXISTS
Earnings data arrives from providers keyed three different ways — FMP keys a
quarter by its REPORT date, Finnhub and the statements key it by PERIOD END, and
neither carries the company's own fiscal label. Turning any of those into
"FY2026 Q3" requires knowing the company's fiscal calendar, and the two schemes
previously used in this codebase disagreed:

  earnings_estimates._fiscal_q_from_report()  assumed a CALENDAR fiscal year and
      bucketed on the report month. For the ~30% of large caps that close in
      December it is right; for Micron (Aug), NVIDIA (Jan), Apple (Sep),
      Microsoft (Jun), Walmart (Jan) and Broadcom (Oct/Nov) it is wrong by one
      quarter to a full year.

  earnings_intel.fiscal_qy()  did month arithmetic against a fiscal-year-end
      month read off a single annual period end (`annual[0]`). Correct for a
      filer whose year end sits in a fixed month, but a 52/53-week filer's year
      end floats — it can cross a month boundary from one year to the next — so
      a single observation is not a reliable anchor.

This module replaces both with one idea: a company's OWN reported fiscal-year-end
dates are the ground truth, and everything else is measured against them.

THE MODEL
`FiscalCalendar` is built from the annual statement's period-end dates (which are
literally the fiscal year ends the company filed) plus, optionally, the quarterly
period ends. From those anchors it can:

  • place any period-end date in a (fiscal_year, fiscal_quarter)
  • generate the period end of any (fiscal_year, fiscal_quarter)
  • map a REPORT date back to the fiscal quarter it was reporting on

Quarters are derived by ELAPSED FRACTION of the fiscal year, not by month
arithmetic:  a period ending `e` days into a `t`-day fiscal year sits in quarter
ceil(4e/t). That is exact for a 364-day 52-week year, a 371-day 53-week year and
a 365/366-day calendar year alike, which is what makes 52/53-week filers work
without a special case.

HONEST DEGRADATION (§ the audit's rule)
With no annual anchors we do NOT fall back to calendar quarters and hope. A
calendar guess is right for December filers and silently wrong for everyone else,
and a wrong fiscal label is worse than an absent one. `resolve()` reports its
`confidence`, and callers are expected to leave the label off rather than print a
guess. The one exception is an explicit caller-supplied fiscal-year-end month,
which is a real (if weaker) piece of evidence.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta

_log = logging.getLogger(__name__)

# A fiscal quarter's results are filed somewhere between a couple of weeks and
# roughly three months after the period closes. Outside this window a report date
# cannot be confidently attributed to a period, so we decline rather than guess.
_REPORT_LAG_MIN_DAYS = 5
_REPORT_LAG_MAX_DAYS = 135

# Consecutive fiscal year ends this far apart are a 52/53-week calendar (364 or
# 371 days) rather than a month-anchored one (365/366).
_WEEKS52 = 364
_WEEKS53 = 371

# A fiscal year ending in the first days of January belongs, by near-universal
# convention, to the PREVIOUS calendar year's fiscal label: a 52/53-week filer
# closing "the Sunday nearest 31 December" ends fiscal 2026 on 2027-01-03.
# NVIDIA (late Jan) and Walmart (31 Jan) are past this cutoff and keep the
# end-year label, which is also their own convention.
_JAN_ROLLOVER_DAY = 14


def _parse(d) -> date | None:
    """Accept a date, a datetime, or a 'YYYY-MM-DD' prefix string."""
    if d is None:
        return None
    if isinstance(d, datetime):
        return d.date()
    if isinstance(d, date):
        return d
    try:
        return datetime.strptime(str(d)[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def _last_day_of_month(year: int, month: int) -> int:
    if month == 12:
        return 31
    return (date(year, month + 1, 1) - timedelta(days=1)).day


def _same_monthday(anchor: date, year: int) -> date:
    """The anchor's (month, day) in `year`, clamped to that month's length so a
    31st anchor lands on the 28th/30th where it must."""
    day = min(anchor.day, _last_day_of_month(year, anchor.month))
    return date(year, anchor.month, day)


def _add_months(d: date, months: int) -> date:
    """`d` shifted by whole months, clamped to the target month's length."""
    total = (d.year * 12 + d.month - 1) + months
    year, month = divmod(total, 12)
    month += 1
    return date(year, month, min(d.day, _last_day_of_month(year, month)))


def fiscal_year_label(year_end: date) -> int:
    """The fiscal-year number a year ending on `year_end` carries."""
    if year_end.month == 1 and year_end.day <= _JAN_ROLLOVER_DAY:
        return year_end.year - 1
    return year_end.year


class FiscalCalendar:
    """A company's fiscal calendar, inferred from its own reported period ends.

    Construct via `from_statements()` (the normal path) or directly with a list
    of fiscal-year-end dates.
    """

    __slots__ = ("anchors", "is_5253", "_period_ends", "source")

    def __init__(self, year_ends, period_ends=None, source="annual_statement"):
        self.anchors = sorted({d for d in (_parse(x) for x in (year_ends or [])) if d})
        self._period_ends = sorted({d for d in (_parse(x) for x in (period_ends or [])) if d})
        self.source = source
        self.is_5253 = self._detect_5253()

    # ── construction ───────────────────────────────────────────────────────
    @classmethod
    def from_statements(cls, statements: dict) -> "FiscalCalendar | None":
        """Build from a `financial_statements.get_statements()` payload.

        The income statement's ANNUAL period ends are the fiscal year ends the
        company itself filed — the strongest anchor available to us, and already
        cached for the Financials tab, so this costs no extra fetch.
        """
        inc = ((statements or {}).get("income") or {})
        annual = [p.get("period") for p in (inc.get("annual") or [])]
        quarterly = [p.get("period") for p in (inc.get("quarterly") or [])]
        cal = cls(annual, quarterly)
        return cal if cal.anchors else None

    @classmethod
    def from_year_end_month(cls, month: int | None) -> "FiscalCalendar | None":
        """Weaker fallback: a known fiscal-year-end MONTH and nothing else.

        Assumes the year ends on the last day of that month, which is true for
        month-anchored filers and approximately true (±6 days) for 52/53-week
        ones — close enough to place a quarter, and flagged as lower confidence.
        """
        if not month or not 1 <= int(month) <= 12:
            return None
        month = int(month)
        this_year = date.today().year
        ends = [date(y, month, _last_day_of_month(y, month))
                for y in range(this_year - 6, this_year + 3)]
        return cls(ends, source="year_end_month")

    def _detect_5253(self) -> bool:
        """A 52/53-week filer's year ends land 364 or 371 days apart and its
        day-of-month drifts; a month-anchored filer's land 365/366 apart."""
        if len(self.anchors) < 2:
            return False
        gaps = [(b - a).days for a, b in zip(self.anchors, self.anchors[1:])]
        near_week_multiple = sum(1 for g in gaps if g in (_WEEKS52, _WEEKS53, _WEEKS52 + 7))
        if near_week_multiple and near_week_multiple >= len(gaps) / 2:
            return True
        # Day-of-month drift is the other tell (e.g. 2025-11-02 → 2026-11-01).
        days = {a.day for a in self.anchors}
        months = {a.month for a in self.anchors}
        return len(days) > 1 and len(months) <= 2 and max(days) - min(days) <= 10

    # ── year-end series ────────────────────────────────────────────────────
    def year_end(self, fiscal_year: int) -> date:
        """The fiscal year end for `fiscal_year`, observed where we have it and
        extrapolated where we don't."""
        for a in self.anchors:
            if fiscal_year_label(a) == fiscal_year:
                return a
        if not self.anchors:
            raise ValueError("no anchors")
        # Extrapolate from the CLOSEST observed anchor, so error stays minimal.
        nearest = min(self.anchors, key=lambda a: abs(fiscal_year_label(a) - fiscal_year))
        steps = fiscal_year - fiscal_year_label(nearest)
        if self.is_5253:
            # 52 weeks preserves the weekday the filer closes on; the ~1.25 days
            # a year this loses against the true 52/53 mix stays far inside the
            # ±45-day slack a quarter boundary has.
            return nearest + timedelta(days=_WEEKS52 * steps)
        return _same_monthday(nearest, nearest.year + steps)

    def _bracket(self, period_end: date):
        """(previous year end, this year end) such that prev < period_end <= cur."""
        if not self.anchors:
            return None, None
        guess = fiscal_year_label(period_end)
        # Walk out from the guess; a fiscal year end can be up to a year away.
        for fy in (guess, guess + 1, guess - 1, guess + 2, guess - 2):
            try:
                cur = self.year_end(fy)
                prev = self.year_end(fy - 1)
            except ValueError:
                return None, None
            if prev < period_end <= cur:
                return prev, cur
        return None, None

    def _quarter_of(self, p: date, prev_year_end: date, total: int) -> int:
        """Which quarter of the fiscal year running (prev_year_end, +total] does
        a period ending on `p` close?

        The two calendar styles need different arithmetic, and using one for the
        other is an off-by-one waiting to happen:

        • 52/53-WEEK filers divide the year into four EQUAL 13-week blocks, so
          elapsed fraction is exact. (Micron day 273 of 364 → Q3.)
        • MONTH-ANCHORED filers have unequal calendar quarters — Microsoft's
          FY2026 runs 92/92/90/91 days — so elapsed fraction rounds the wrong
          way at a real boundary: 274/365 × 4 = 3.003, which ceilings to Q4 for
          a quarter that is unambiguously Q3. Counting whole months is exact.
        """
        if self.is_5253:
            elapsed = (p - prev_year_end).days
            # ceil(4·elapsed / total) in integer arithmetic — no float boundary
            # risk at an exact quarter end (273/364 must be Q3, never Q4).
            q = (elapsed * 4 + total - 1) // total
            return max(1, min(4, q))
        start = prev_year_end + timedelta(days=1)
        months = (p.year - start.year) * 12 + (p.month - start.month)
        # A period ending on or after the fiscal start's day-of-month has
        # completed that month's block (handles year ends that are not month
        # ends, e.g. a 15th-of-the-month fiscal close).
        if p.day >= start.day:
            months += 1
        q = (months + 2) // 3
        return max(1, min(4, q))

    # ── the two questions callers ask ──────────────────────────────────────
    def resolve(self, period_end) -> dict:
        """(fiscal_year, fiscal_quarter) for a period ENDING on `period_end`.

        Returns {'fiscal_year', 'fiscal_quarter', 'confidence', 'year_end'}.
        `confidence` is 'observed' when the period end is one the company itself
        filed, 'derived' when it sits inside an observed/extrapolated fiscal
        year, and None when we cannot place it — in which case fiscal_year and
        fiscal_quarter are None and the caller must not invent a label.
        """
        p = _parse(period_end)
        blank = {"fiscal_year": None, "fiscal_quarter": None, "confidence": None, "year_end": None}
        if p is None or not self.anchors:
            return blank
        prev, cur = self._bracket(p)
        if prev is None or cur is None:
            return blank
        total = (cur - prev).days
        if total <= 0:
            return blank
        q = self._quarter_of(p, prev, total)
        confidence = "observed" if p in self._period_ends or p in self.anchors else "derived"
        if self.source == "year_end_month":
            confidence = "approximate"
        return {
            "fiscal_year": fiscal_year_label(cur),
            "fiscal_quarter": q,
            "confidence": confidence,
            "year_end": cur.isoformat(),
        }

    def quarter_end(self, fiscal_year: int, quarter: int) -> date | None:
        """The period-end date of a given fiscal quarter."""
        if not self.anchors or not 1 <= quarter <= 4:
            return None
        try:
            cur = self.year_end(fiscal_year)
            prev = self.year_end(fiscal_year - 1)
        except ValueError:
            return None
        total = (cur - prev).days
        if total <= 0:
            return None
        if quarter == 4:
            return cur
        if self.is_5253:
            return prev + timedelta(days=round(total * quarter / 4))
        # Month-anchored: whole calendar quarters off the fiscal start.
        start = prev + timedelta(days=1)
        return _add_months(start, quarter * 3) - timedelta(days=1)

    def period_end_for_report(self, report_date) -> dict:
        """The fiscal quarter a report published on `report_date` was reporting.

        A company files 2 weeks to ~3 months after a quarter closes, so the
        answer is the most recent quarter end preceding the report by a
        plausible lag. Prefers a period end the company actually filed (from the
        quarterly statement) over a generated one, and declines outright when
        nothing lands in the window — the audit's rule was that dates being
        merely NEARBY must never be enough to fuse two periods.
        """
        r = _parse(report_date)
        blank = {"period_end": None, "fiscal_year": None, "fiscal_quarter": None,
                 "confidence": None, "lag_days": None}
        if r is None or not self.anchors:
            return blank

        candidates = []
        # 1. Period ends the company filed, in the lag window.
        for p in self._period_ends:
            lag = (r - p).days
            if _REPORT_LAG_MIN_DAYS <= lag <= _REPORT_LAG_MAX_DAYS:
                candidates.append((p, "observed"))
        # 2. Generated quarter ends, for the older quarters the statement's
        #    ~5-7 period window does not reach.
        if not candidates:
            guess = fiscal_year_label(r)
            for fy in (guess - 1, guess, guess + 1):
                for q in (1, 2, 3, 4):
                    p = self.quarter_end(fy, q)
                    if p is None:
                        continue
                    lag = (r - p).days
                    if _REPORT_LAG_MIN_DAYS <= lag <= _REPORT_LAG_MAX_DAYS:
                        candidates.append((p, "derived"))
        if not candidates:
            return blank

        # The most recent qualifying period end is the one being reported.
        period_end, kind = max(candidates, key=lambda c: c[0])
        info = self.resolve(period_end)
        if info["fiscal_year"] is None:
            return blank
        return {
            "period_end": period_end.isoformat(),
            "fiscal_year": info["fiscal_year"],
            "fiscal_quarter": info["fiscal_quarter"],
            "confidence": kind if self.source != "year_end_month" else "approximate",
            "lag_days": (r - period_end).days,
        }

    # ── introspection (surfaced in the panel's methodology disclosure) ─────
    def describe(self) -> dict:
        if not self.anchors:
            return {"known": False}
        latest = self.anchors[-1]
        return {
            "known": True,
            "source": self.source,
            "fiscal_year_end": latest.isoformat(),
            "fiscal_year_end_month": latest.month,
            "style": "52/53-week" if self.is_5253 else "month-anchored",
            "anchors_observed": len(self.anchors),
        }


def label(fiscal_year: int | None, quarter: int | None) -> str | None:
    """The one place a fiscal period is turned into display text."""
    if not fiscal_year or not quarter:
        return None
    return f"FY{fiscal_year} Q{quarter}"
