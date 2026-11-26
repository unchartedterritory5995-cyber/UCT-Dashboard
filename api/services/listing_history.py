"""Does the daily series a SERVER run is handed start at the symbol's listing? (e100, ruling 2026-11-26)

⭐⭐ THE CHART'S RULE, PORTED, AND ONE SERVER-ONLY CONDITION ON TOP.

A member's daily chart runs a Pine script from the stock's listing (``historyFromListing`` true) whenever the
first bar the engine computes on is dated ON the symbol's reference listing day: the chart's
``app/src/components/chart/engine/listingSeed.js::historyFromListingOf`` (EXACT equality, DAILY ONLY), with the
reference day from ``listingReferenceDate`` (``/api/ticker-ipo``'s ``first_trade_date``, else ``list_date``). This
module is the Python twin of those two functions, and ``tests/fixtures/listing_rule_parity.json`` holds them
together: the vitest rail (``listingSeedServerParity.test.js``) and the pytest rail
(``tests/test_listing_history.py``) read the SAME cases, so a change on either side turns one of them red.

⛔ THE SERVER-ONLY CONDITION: ``first_trade_final``. The chart compares against whatever ``/api/ticker-ipo``
answered, final or not. A server run is unattended (an alert fires without anyone looking at it), so it claims the
listing ONLY on a FINAL first-trade decision (``ticker_ipo.first_trade_decision``, resolved and cached): a non-final
answer, a missing one, or any read that fails is the CURTAIN (``historyFromListing`` false, the bounded window),
exactly as before this module existed. Stricter than the chart, never looser.

⛔ DAILY ONLY, as ``historyFromListingOf``. The chart also SERVES a weekly series from its listing week
(``listingSeed.js::LISTING_SERVED_TFS``); no server lane does yet (named, not done: the weekly store key and
the weekly fetch were not measured for it). Anything but ``D`` answers false.

⛔ CACHE ONLY, NEVER A PROVIDER CALL (``ticker_ipo.peek``): the alert evaluator reads bars from the store with
"no remote fetch in-loop" (``api/main.py``), and the strategy route is a request path (W9-T4-F1 r1's rule). The
chart's own ``/api/ticker-ipo`` read on the same pod resolves and caches the decision; until it has, the run is
curtained, which is the honest answer.

Importing this module reads no other module; ``ticker_ipo`` is imported when a fact is asked.
"""
from __future__ import annotations

import re
from typing import Any, Mapping, Optional, Sequence

_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

#: ``listingSeed.js::historyFromListingOf``: the one timeframe the listing statement serves on a server run.
LISTING_TF = "D"


def history_from_listing_of(bars: Any, tf: Any, list_date: Any) -> bool:
    """``listingSeed.js::historyFromListingOf``, line for line: ``True`` only when ``bars[0]`` is the daily bar
    dated ON ``list_date`` (``t`` an ISO-date string; a number is not a daily key and is never guessed)."""
    if tf != LISTING_TF:
        return False
    if not isinstance(list_date, str):
        return False
    day = list_date.strip()
    if not _ISO_DATE.match(day):
        return False
    if not isinstance(bars, (list, tuple)) or not bars:
        return False
    first = bars[0]
    t = first.get("t") if isinstance(first, Mapping) else None
    if not isinstance(t, str) or not _ISO_DATE.match(t[:10]):
        return False
    return t[:10] == day


def listing_reference_date(ipo: Any) -> Optional[str]:
    """``listingSeed.js::listingReferenceDate``: ``first_trade_date`` when it is an ISO date, else ``list_date``
    when it is a string, else ``None``."""
    if not isinstance(ipo, Mapping):
        return None
    ft = ipo.get("first_trade_date")
    if isinstance(ft, str) and _ISO_DATE.match(ft.strip()):
        return ft.strip()
    ld = ipo.get("list_date")
    return ld if isinstance(ld, str) else None


def server_from_listing(bars: Any, tf: Any, ipo: Any) -> bool:
    """THE SERVER'S ANSWER: the chart's rule (``history_from_listing_of`` against ``listing_reference_date``), and
    only on a FINAL first-trade decision (``ipo["first_trade_final"] is True``). Everything else: ``False``."""
    if not isinstance(ipo, Mapping) or ipo.get("first_trade_final") is not True:
        return False
    return history_from_listing_of(bars, tf, listing_reference_date(ipo))


def store_day(t: Any) -> Optional[str]:
    """A daily bar's key as the ISO date the chart keys it by, or ``None``. The store (``bars_sqlite``) keys a date
    timeframe by a ``YYYYMMDD`` int; ``bars_fetch._fmt_sqlite_bars`` serves ``YYYY-MM-DD``. Both read as the same
    day; anything else is not a daily key."""
    if isinstance(t, bool):
        return None
    if isinstance(t, int) and 19000101 <= t <= 99991231:
        return "%04d-%02d-%02d" % (t // 10000, (t // 100) % 100, t % 100)
    if isinstance(t, str) and _ISO_DATE.match(t[:10]):
        return t[:10]
    return None


def listing_facts(sym: Any) -> Optional[dict]:
    """The symbol's cached ``/api/ticker-ipo`` answer (``ticker_ipo.peek``: memory, then disk), or ``None``.
    Never a provider call, never raises."""
    if not isinstance(sym, str) or not sym.strip():
        return None
    try:
        from api.services import ticker_ipo
        hit = ticker_ipo.peek(sym)
    except Exception:  # noqa: BLE001 -- an unreadable fact is no fact: the curtain
        return None
    return hit if isinstance(hit, Mapping) else None


def from_listing_for(bars: Sequence[Mapping[str, Any]], tf: Any, sym: Any) -> bool:
    """Does THIS series (store-keyed or served daily bars, oldest first) start at ``sym``'s final first-trade day?
    Asks no fact off a daily timeframe or for an empty series."""
    if tf != LISTING_TF or not bars:
        return False
    first = bars[0] if isinstance(bars[0], Mapping) else {}
    day = store_day(first.get("t"))
    if day is None:
        return False
    return server_from_listing([{"t": day}], tf, listing_facts(sym))
