"""D-1 / D-2 (Lane R) -- the earnings-date STATUS lifecycle, read side.

The calendar build already observes every forward reporter into
``calendar_date_integrity`` (the date-drift store). Since Lane R each observation
also carries the status the entry supports (``calendar_date_integrity.classify_entry``)
and the store keeps, per CURRENT report date, when UCT first saw it estimated, first
saw it confirmed (D-2's "first confirmed" timestamp) and whether a move changed an
estimate or a confirmed date.

Three states are offered, each derived from a field a provider leg we pay for
actually returns, with the reading that produced it (`basis`):
  estimated  -> confirmed (a session given) -> reported (actuals on file)
plus ``unstated`` (no leg said either). The middle "company-signaled" state of the
Wall Street Horizon model (domain-events-intelligence.md §4) is returned as
UNAVAILABLE with its reason: no provider we hold carries it, so it is not guessed.

⛔ Every timestamp is when UCT's calendar build first saw the fact, NOT the company's
announcement time; the payload says so in ``timestamps_are``.

Request path: one local SQLite read. Recording runs inside the calendar build
whether or not this flag is on (the history cannot be back-filled later); the flag
gates only this read surface.

DARK behind EARNINGS_DATE_STATUS_ENABLED.
"""
from __future__ import annotations

import os

ENABLED_ENV = "EARNINGS_DATE_STATUS_ENABLED"
MAX_SYMS = 400

STATES = {
    "estimated": "A provider projected the date and gave no session (Finnhub with no hour, or FMP's range).",
    "confirmed": "A provider placed the report in a session (before open, after close, or during market hours). "
                 "This is the calendar's own 'confirmed only' reading, not the company's announcement.",
    "reported": "Actual results are on file for this date.",
    "unstated": "No provider leg stated a session or an estimate flag.",
    "not_recorded": "The date was recorded before status tracking began; its status was not captured.",
}
TIMESTAMPS_ARE = ("when UCT's calendar build first saw each fact (UTC), not the company's own "
                  "announcement time, which no provider we hold returns")


def is_enabled() -> bool:
    """Read PER CALL. Unset means OFF."""
    return os.environ.get(ENABLED_ENV, "").strip() == "1"


def status_for(syms: list[str]) -> dict:
    """The lifecycle for each requested symbol the store holds. A symbol the calendar
    never placed is listed in ``unknown``, never given a default status. A store that
    cannot be read RAISES (the route turns it into a 503), so 'could not read' is never
    answered as 'nothing recorded'."""
    from api.services import calendar_date_integrity as cdi
    want = sorted({(s or "").upper().strip() for s in syms if (s or "").strip()})[:MAX_SYMS]
    rows = cdi.get_status(want)
    return {
        "symbols": rows,
        "unknown": [s for s in want if s not in rows],
        "states": STATES,
        "company_signaled": cdi.COMPANY_SIGNALED,
        "timestamps_are": TIMESTAMPS_ARE,
    }
