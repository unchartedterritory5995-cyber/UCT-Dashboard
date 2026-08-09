"""Earnings history from FMP — EPS *and* revenue, off the Finnhub budget.

WHY THIS EXISTS
---------------
`beat_history` came from Finnhub `/stock/earnings`, which has two problems
that are not fixable at the Finnhub layer:

  1. BUDGET. The calendar enrichment fans out 3 Finnhub calls per symbol
     across up to 80 symbols on a heavy day, into a ~55/min process-wide
     bucket SHARED with live member traffic. Symbols get shed. On 2026-08-06
     that left JAZZ -- whose own modal header read "$5.71 vs $6.30 est" --
     rendering "No reported quarters yet". FMP Ultimate is a different, far
     larger budget, so this simply is not that kind of scarce.
  2. NO REVENUE. Finnhub's earnings rows carry EPS only, so the history
     table's REV column has always rendered an em dash for every row.

FMP has both, and (via income-statement) real fiscal identity.

THE JOIN, AND WHY IT IS "NEAREST"
---------------------------------
Two FMP endpoints are needed and they key on DIFFERENT dates:

  stable/earnings          -> {date: ANNOUNCEMENT, epsActual, epsEstimated,
                               revenueActual, revenueEstimated}
                              ...but carries NO fiscal year/quarter at all.
  stable/income-statement  -> {date: fiscal PERIOD END, period: "Q2",
                               fiscalYear: "2026", acceptedDate: filing ts}

Fiscal identity is not optional here. `quarterLabel()` (client) uses the
provider's fiscal quarter/year when present and otherwise derives the label
from the date's CALENDAR month -- so handing it an announcement date labels
JAZZ's fiscal Q2 (period ended 06-30, announced 08-03) as "Q3", wrong by one
on nearly every ticker, and wrong in a way that silently pairs a print
against the wrong quarter rather than failing.

The join key is `acceptedDate` (the FILING timestamp), NOT the period end.

That distinction was measured, not assumed. Joining the announcement to the
NEAREST period END looks reasonable and is WRONG for calendar-year filers:
JAZZ announced Q4 FY2025 (ended 2025-12-31) on 2026-02-24, but the NEXT
quarter's end (2026-03-31) is only 35 days FORWARD versus 55 days back, so
nearest-period-end silently labelled it Q1 FY2026 — a duplicate of the row
above it. (The 9/9 nearest-period result `implied_backfill.past_reports`
reports is against FINNHUB's `period`, which is the calendar quarter-end
CONTAINING the fiscal end — different semantics, so that result does not
transfer here.)

`acceptedDate` is the same event as the announcement, so the match is exact
rather than inferred: verified live 2026-08-06 across four fiscal shapes —
JAZZ (Dec-end), AAPL (Sep-end), NVDA (Jan-end), MSFT (Jun-end) — 16/16
correct, no duplicates, 0-1 days apart in every case. `_MAX_JOIN_DAYS` is
therefore tight; a wider window would start guessing again.
"""
from __future__ import annotations

import datetime as _dt
import logging

# Imported as a MODULE, and `_fmp_get` is resolved through it at CALL time.
#
# `from ...earnings_estimates import _fmp_get` binds this module's own name at
# import, which quietly severs it from the owning module: patching
# `earnings_estimates._fmp_get` -- the way every other caller is guarded and
# every existing test stubs the provider -- would not reach here, so this
# module would keep issuing real HTTP while the rest of the process believed
# the provider was stubbed or shed. That is not hypothetical: it fired a live
# `/stable/earnings` request straight through an ACTIVE Finnhub-cooldown test
# that asserts no HTTP escapes.
from api.services import earnings_estimates as _ee

_log = logging.getLogger(__name__)

# How far the FILING may sit from the ANNOUNCEMENT and still be the same event.
#
# This was 5, chosen from a 4-ticker sample (JAZZ, AAPL, NVDA, MSFT) that
# measured 0-1 days -- large caps that file fast. It generalized badly. A 10-Q
# lands within days of the announcement, but a 10-K lands WEEKS after it, so
# every Q4 fell outside the window and lost its fiscal identity. The tell was
# an axis reading "Q2 25 ... Q2 25 ... Q1 26 ... Q1 26" with Q4 nowhere: the
# unmatched rows fell back to deriving a label from the calendar month and
# collided with real ones.
#
# Re-measured over 180 joins across 15 tickers (2026-08-08), gap in days:
#
#     Q1   n=45   median 0   max  9
#     Q2   n=45   median 0   max  9
#     Q3   n=45   median 0   max  9
#     Q4   n=45   median 5   max 29     <- the 10-K lag
#     overall p90 9, p99 28, max 29; 40 of 180 (22%) exceeded the old 5
#
# 45 covers the observed max with real headroom and is still only half a
# quarter, so it cannot reach a neighbouring period (~91 days away) -- and the
# join takes the NEAREST filing regardless, so this is purely a rejection
# guard, not a search radius.
_MAX_JOIN_DAYS = 45


def _day(v) -> _dt.date | None:
    if not v:
        return None
    try:
        return _dt.date.fromisoformat(str(v)[:10])
    except Exception:
        return None


def _fiscal_q(period: str | None) -> int | None:
    """'Q2' -> 2. FMP also emits 'FY' for annual rows, which are not quarters."""
    if not period:
        return None
    s = str(period).strip().upper()
    if len(s) == 2 and s[0] == "Q" and s[1].isdigit():
        return int(s[1])
    return None


def _pct(actual, estimate):
    try:
        if actual is None or estimate is None or float(estimate) == 0:
            return None
        return (float(actual) - float(estimate)) / abs(float(estimate)) * 100.0
    except Exception:
        return None


def fmp_beat_history(ticker: str, limit: int = 8) -> list[dict] | None:
    """beat_history-shaped rows, newest first — or None if FMP did not answer.

    None vs [] is load-bearing exactly as it is for the Finnhub leg: None
    means we never got an answer and the UI must not state anything about
    this company; [] means FMP answered and this ticker has no reported
    quarters.
    """
    sym = (ticker or "").upper()
    if not sym:
        return None

    # Ask for more than `limit`: forward (not-yet-reported) rows are filtered
    # out below, and they sit at the TOP of a newest-first list.
    earnings = _ee._fmp_get("/stable/earnings", {"symbol": sym, "limit": max(limit * 2, 16)})
    if not isinstance(earnings, list):
        return None                      # a shrug, not an answer

    income = _ee._fmp_get("/stable/income-statement",
                          {"symbol": sym, "period": "quarter", "limit": max(limit * 2, 16)})
    # A missing income statement costs fiscal identity, NOT the whole history.
    # Rows still carry EPS + revenue; the client falls back to deriving a label
    # from the period date. Degrade, don't disappear.
    fiscal = []
    if isinstance(income, list):
        for r in income:
            if not isinstance(r, dict):
                continue
            d = _day(r.get("date"))
            q = _fiscal_q(r.get("period"))     # skips FMP's annual "FY" rows
            acc = _day(r.get("acceptedDate"))  # the join key
            if d and q and acc:
                fiscal.append({"end": d, "q": q, "acc": acc,
                               "y": _int(r.get("fiscalYear")) or d.year})

    rows = []
    for r in earnings:
        if not isinstance(r, dict):
            continue
        announced = _day(r.get("date"))
        eps_actual = r.get("epsActual")
        # Not yet reported — the forward strip is a different concept and is
        # built elsewhere. `beat_history` is REPORTED quarters only.
        if announced is None or eps_actual is None:
            continue

        # Match on the FILING date, not the period end — see the module note.
        match = None
        if fiscal:
            match = min(fiscal, key=lambda f: abs((f["acc"] - announced).days))
            if abs((match["acc"] - announced).days) > _MAX_JOIN_DAYS:
                match = None

        rows.append({
            # `period` keeps Finnhub's meaning — the fiscal PERIOD END — so the
            # client model needs no change to read it. When the income
            # statement is missing we fall back to the announcement date,
            # which is the best available and is what the old calendar
            # derivation would have used anyway.
            "period": (match["end"] if match else announced).isoformat(),
            "actual": eps_actual,
            "estimate": r.get("epsEstimated"),
            "beat": (None if r.get("epsEstimated") is None
                     else eps_actual >= r.get("epsEstimated")),
            "surprise": _pct(eps_actual, r.get("epsEstimated")),
            "year": match["y"] if match else None,
            "quarter": match["q"] if match else None,
            # The half Finnhub never had — this is what stops the history
            # table's REV column rendering an em dash on every row.
            "revenue_actual": r.get("revenueActual"),
            "revenue_estimate": r.get("revenueEstimated"),
            "report_date": announced.isoformat(),
        })

    rows.sort(key=lambda x: x["period"], reverse=True)
    return rows[:limit]


def _int(v):
    try:
        return int(str(v).strip())
    except Exception:
        return None
