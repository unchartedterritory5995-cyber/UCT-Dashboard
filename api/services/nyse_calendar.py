"""⭐⭐ THE NYSE CALENDAR — the two date sets, and nothing else.

⛔⛔ THIS MODULE IMPORTS NOTHING. That is its entire job. Both sets already had
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

⚠️ BOTH SETS RUN TO 2027 and carry a standing instruction to refresh annually
from ``nyse.com/markets/hours-calendars``. Past that horizon a D/W/M bar falls
back to the regular session and may read ``isrealtime`` for up to one session
too long on a holiday or half-day -- named in ``docs/pine/barstate.md`` rather
than papered over.

⛔ HALF-DAYS ARE NOT CLOSURES AND THE TWO SETS MUST NOT BE UNIONED. A 1pm ET
early close is a REAL SESSION that trades; a closure produces no bars at all.
``bars_fetch``'s own comment says half-days are *"intentionally NOT"* in the
closure set, and that is correct for that set -- it is not, and never was, a
statement that this repo does not know them.
"""
from __future__ import annotations

#: NYSE FULL CLOSURES as ``YYYYMMDD`` ints. No bars exist on these dates.
#: ⚰️ Lived in ``api/services/bars_fetch.py`` until 2026-09-09 and is re-exported
#: from there, so ``bars_fetch._NYSE_HOLIDAYS_YYYYMMDD`` still resolves.
NYSE_HOLIDAYS_YYYYMMDD: frozenset[int] = frozenset({
    # 2025
    20250101, 20250109, 20250120, 20250217, 20250418, 20250526, 20250619,
    20250704, 20250901, 20251127, 20251225,
    # 2026
    20260101, 20260119, 20260216, 20260403, 20260525, 20260619, 20260703,
    20260907, 20261126, 20261225,
    # 2027
    20270101, 20270118, 20270215, 20270326, 20270531, 20270618, 20270705,
    20270906, 20271125, 20271224,
})

#: NYSE 1pm ET HALF-DAYS as ``YYYYMMDD`` ints. Real sessions, short ones.
#: ⚰️ Lived in ``api/services/liveflow_monitor.py`` until 2026-09-09 and is
#: re-exported from there, so its five existing read sites are untouched.
NYSE_EARLY_CLOSES_YYYYMMDD: frozenset[int] = frozenset({
    20250703, 20251128, 20251224,   # 2025
    20261127, 20261224,             # 2026
    20271126,                       # 2027 (Dec 24 2027 is a FULL closure)
})


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
