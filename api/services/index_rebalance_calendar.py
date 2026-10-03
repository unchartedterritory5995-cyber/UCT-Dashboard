"""D-3 (Lane R) -- index-rebalance dates on the calendar.

No provider UCT pays for returns a rebalance or reconstitution DATE: FMP's
``/stable/sp500-constituent`` and ``/stable/nasdaq-constituent`` (the only index
endpoints this repo calls, ``index_constituents.py``) answer today's members, not a
schedule, and no historical-constituent or index-event endpoint is called anywhere in
the repo or documented in ``docs/terminal-research/02-data-providers``. So the one
family served here is RULE-DERIVED, and says so on every row:

  S&P 500 quarterly rebalance -- the third Friday of March, June, September and
  December; changes are announced roughly five trading days before and take effect
  with that day's close. Source: ``05-product-strategy/domain-events-intelligence.md``
  §3 (row "Index rebalances", citation [10]) and §11 #3, itself a WebSearch synthesis
  of CME Group OpenMarkets plus secondary pages, confidence 🟡 (S&P's own methodology
  PDF was not rendered).

⛔ A rule-derived row is NEVER an announced date: ``status`` is ``rule_derived``,
``announced`` is false, and the rule and its citation ride every row. When the rule
date is an exchange holiday (per ``session_calendar``, the one session authority),
the row says the real date will differ instead of moving it by a guessed rule; past
the calendar's horizon it says the holiday check could not be made.

Not derived, and returned in ``not_covered`` with the reason (a dated source is
needed, which is an owner call under ADR-0015):
  * Russell US indexes -- the research base records the move to SEMI-ANNUAL
    reconstitution in 2026 with a separate rank day, but no date rule;
  * Nasdaq-100 annual reconstitution -- no rule or date in the research base.

Pure computation; no network, no store. DARK behind INDEX_REBALANCE_EVENTS_ENABLED.
"""
from __future__ import annotations

import os
from datetime import date, timedelta

ENABLED_ENV = "INDEX_REBALANCE_EVENTS_ENABLED"
MAX_SPAN_DAYS = 400
REBALANCE_MONTHS = (3, 6, 9, 12)

SP500_RULE = {
    "index": "S&P 500",
    "event": "Quarterly rebalance",
    "rule": "third Friday of March, June, September and December; effective with that day's close",
    "notice": "S&P typically announces the changes about five trading days before",
    "citation": ("docs/terminal-research/05-product-strategy/domain-events-intelligence.md §3 [10], "
                 "§11 #3 (CME Group OpenMarkets via WebSearch synthesis; confidence: medium)"),
}

NOT_COVERED = [
    {"index": "Russell US indexes",
     "reason": ("Reconstitution became semi-annual in 2026 with a separate rank day, but the research "
                "base holds no date rule; FTSE Russell's published calendar (a dated source) is needed.")},
    {"index": "Nasdaq-100",
     "reason": "No reconstitution rule or date is in the research base; a dated source is needed."},
]


def is_enabled() -> bool:
    """Read PER CALL. Unset means OFF."""
    return os.environ.get(ENABLED_ENV, "").strip() == "1"


def third_friday(year: int, month: int) -> date:
    d = date(year, month, 1)
    first_friday = d + timedelta(days=(4 - d.weekday()) % 7)
    return first_friday + timedelta(days=14)


def _holiday_check(d: date) -> dict:
    """The rule date against the ONE session authority. Never raises."""
    try:
        from api.services import session_calendar as sc
        if not sc.covers(d):
            return {"state": "unchecked",
                    "note": "Past the exchange calendar's horizon; the holiday check could not be made."}
        name = sc.holiday_name(d)
        if name:
            return {"state": "holiday",
                    "note": f"The rule date is an exchange holiday ({name}); the real date will differ "
                            "and is not guessed here."}
        return {"state": "trading_day", "note": None}
    except Exception as exc:  # noqa: BLE001 -- a missing calendar is a stated gap, not a crash
        return {"state": "unchecked", "note": f"The exchange calendar could not be read ({type(exc).__name__})."}


def events(start: date, end: date) -> dict:
    """Rule-derived rebalance rows with ``start <= date <= end``."""
    if end < start:
        raise ValueError("end is before start")
    if (end - start).days > MAX_SPAN_DAYS:
        raise ValueError(f"a window is at most {MAX_SPAN_DAYS} days")
    rows = []
    for y in range(start.year, end.year + 1):
        for m in REBALANCE_MONTHS:
            d = third_friday(y, m)
            if start <= d <= end:
                chk = _holiday_check(d)
                rows.append({
                    "date": d.isoformat(),
                    "kind": "index_rebalance",
                    "index": SP500_RULE["index"],
                    "event": SP500_RULE["event"],
                    "status": "rule_derived",
                    "announced": False,
                    "rule": SP500_RULE["rule"],
                    "notice": SP500_RULE["notice"],
                    "citation": SP500_RULE["citation"],
                    "calendar_check": chk["state"],
                    "calendar_note": chk["note"],
                })
    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "events": rows,
        "not_covered": NOT_COVERED,
        "source": ("rule-derived from index methodology as cited; no provider UCT pays for "
                   "returns rebalance dates"),
    }
