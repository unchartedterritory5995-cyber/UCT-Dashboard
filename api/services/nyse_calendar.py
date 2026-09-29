"""⭐⭐ THE NYSE CALENDAR — the two date sets, and nothing else.

⭐⭐ THE DATES ARE NO LONGER TYPED HERE (TERM-035 follow-up #1). Both sets are
DERIVED from ``app/src/lib/marketClock/market_calendar.json`` through
``api.services.session_calendar.calendar()``, the dataset the browser also reads
(``nyseCalendar.js`` -> ``sessionCalendar.js``). The names, types and 2025-2027
contents are unchanged; 2028 arrived with the dataset. Refresh the JSON, never
this file. ``tests/test_nyse_calendar_parity.py`` holds these sets equal to the
JSON and the shared fixture ``tests/fixtures/market_calendar_cases.json`` pins
real dates independently on both runtimes.

⛔⛔ THIS MODULE IMPORTS NOTHING BUT THE STDLIB-ONLY ``session_calendar``. That is
its entire job, and the parity test rails both halves of it. Both sets already had
exactly one authority each, but those authorities lived inside SERVICE modules:
the full closures in ``bars_fetch`` (which pulls ``fastapi``, ``massive``, the
cache and a thread pool at import) and the half-days in ``liveflow_monitor``.
Any module that needed a date had to drag a service in behind it.

⚰️ THE CONCRETE COST, 2026-09-09. ``ast_interpret`` needed both sets to produce
the barstate tri-state, and reaching them meant ``try: from api.services.bars_fetch
import ...`` inside a function -- which put a ``try/except`` into a file whose own
rail forbids one, because *"a caught RecursionError is one line from being a
budget refusal"* (``tests/test_ast_budget.py``). The import was defensive for a
real reason and the rail was right for a real reason; the fix is neither, it is
to stop the data living inside a service.

⭐ STILL ONE AUTHORITY PER SET. ``bars_fetch`` and ``liveflow_monitor`` import
from here and re-export under their existing names, so every one of the existing
read sites is untouched and keeps working through the module it already names.
What moved is where the literal lives, not who owns it.

⚠️ BOTH SETS RUN TO THE DATASET'S HORIZON (2028-12-31 at the time of writing) and
the dataset carries a standing instruction to refresh from
``nyse.com/markets/hours-calendars``; the horizon rail in
``tests/test_session_calendar.py`` goes red 12 months before it lapses. ``GET
/api/market-calendar`` publishes it as ``covers_through``. Past that horizon a D/W/M bar falls
back to the regular session and may read ``isrealtime`` for up to one session
too long on a holiday or half-day -- named in ``docs/pine/barstate.md`` rather
than papered over.

⭐⭐ AND THEY RUN BACK TO 2000 (2026-09-29, the C8 ``time_close`` lane). The
dataset's ``coverage_start`` moved from 2025-01-01 to 2000-01-01 with the rows
between added to ``market_calendar.json`` itself (its ``source`` field states the
evidence: the two libraries it already came from agree on every closure and
13:00 half-day, the NYSE rules and the vendor's own SPY history agree on the
closures, and the vendor's 60m volume on the 2015-2024 half-days). It starts at
2000 because TradingView applies no closure before it, so nothing reads earlier.

⛔⛔ WHAT TRADINGVIEW APPLIES IS NOT THIS CALENDAR, AND IT IS NOT SUBTRACTED FROM
IT. The vendor's session ignores every closure before 2000, two unscheduled ones
after it, every half-day before 2019 and two 2020 half-days. Those are facts
about the vendor, measured; the NYSE really was shut and really did close at
13:00, and ``breadth_session`` reconstructs from the tape and wants the truth.
So the dataset holds the truth, and the vendor's exceptions are written ONCE in
the clock layer -- ``api/services/tradingview_session.py`` and its browser twin
``tradingViewSession.js`` -- which DERIVES the vendor's view from these sets.

⛔ HALF-DAYS ARE NOT CLOSURES AND THE TWO SETS MUST NOT BE UNIONED. A 1pm ET
early close is a REAL SESSION that trades; a closure produces no bars at all.
``bars_fetch``'s own comment says half-days are *"intentionally NOT"* in the
closure set, and that is correct for that set -- it is not, and never was, a
statement that this repo does not know them.
"""
from __future__ import annotations

from datetime import date

from api.services.session_calendar import calendar as _calendar


def _yyyymmdd(d: date) -> int:
    return d.year * 10000 + d.month * 100 + d.day


#: NYSE FULL CLOSURES as ``YYYYMMDD`` ints. No bars exist on these dates.
#: Derived from ``market_calendar.json`` (see the module docstring).
#: ⚰️ Lived in ``api/services/bars_fetch.py`` until 2026-09-09 and is re-exported
#: from there, so ``bars_fetch._NYSE_HOLIDAYS_YYYYMMDD`` still resolves.
NYSE_HOLIDAYS_YYYYMMDD: frozenset[int] = frozenset(
    _yyyymmdd(d) for d in _calendar().holidays
)

#: NYSE 1pm ET HALF-DAYS as ``YYYYMMDD`` ints. Real sessions, short ones.
#: Derived from ``market_calendar.json``'s ``early_closes``. ⚠️ An int set cannot
#: carry the close time, so every row there must close at 13:00; the parity test
#: rails that rather than this module raising at import.
#: ⚰️ Lived in ``api/services/liveflow_monitor.py`` until 2026-09-09 and is
#: re-exported from there, so its five existing read sites are untouched.
NYSE_EARLY_CLOSES_YYYYMMDD: frozenset[int] = frozenset(
    _yyyymmdd(d) for d in _calendar().early_closes
)

#: The first day both sets are complete from (the dataset's ``coverage_start``).
#: Before it, a date's absence from a set means UNKNOWN, not "a regular session"
#: -- a reader that must tell the two apart (``breadth_session``) reads this
#: rather than ``min(set)``.
NYSE_CALENDAR_FROM_YYYYMMDD: int = _yyyymmdd(_calendar().coverage_start)


#: ⚠️⚠️ HYPOTHESIS, NOT A MEASUREMENT — the hour TradingView appears to CONFIRM a
#: daily bar at. Kept here because it is a property of the trading calendar and
#: this module is where calendar literals live, NOT because it is established.
#:
#: ⭐ WHAT IS MEASURED: on 2026-09-10 the vendor's daily SPY bar read
#: ``isconfirmed = 0`` at 19:22 ET and ``isconfirmed = 1`` at 20:55 ET, in the SAME
#: page load. Five earlier rows from 16:17 to 19:22 all read 0, so it does not
#: confirm at the 16:00 regular close. The transition is bracketed to
#: **(19:22, 20:55) ET** and nothing narrower. See
#: ``tests/fixtures/vendor/barstate-daily-timeline.json``.
#:
#: ⛔ 20:00 IS THE GUESS THAT FITS THE BRACKET — the end of the extended-hours
#: session — and 17:00 is the same guess transposed onto a half-day (13:00 regular
#: close + the same four hours). NEITHER IS OBSERVED. The half-day figure is a
#: guess about a guess and is the first thing to check on the next early-close day.
#:
#: ⛔⛔ NOTHING MEMBER-FACING READS THESE YET. They exist so ``vendor`` mode can be
#: BUILT and replayed against the timeline; the shipped derivation is unchanged and
#: the flag defaults to ``calendar``. A reader who finds these and assumes the
#: product follows them is reading a switch that is off.
EXTENDED_CLOSE_HOUR = 20

#: The same hypothesis on an early-close day. See above: a guess about a guess.
EARLY_EXTENDED_CLOSE_HOUR = 17
