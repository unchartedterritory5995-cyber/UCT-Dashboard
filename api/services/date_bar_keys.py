"""The ONE rule for what a D / W / M bar key may be.

A date-timeframe bar is keyed by a calendar date, and the chart draws one candle per
key. So the key itself is part of the bar contract:

* ``D`` -- an NYSE trading day (``session_calendar.is_trading_day``: a weekday that is
  not an exchange holiday; a half-day IS a trading day). Outside the calendar's
  coverage the calendar degrades to "weekday", which is still a correct necessary
  condition.
* ``W`` -- the calendar FRIDAY of the bar's ISO week (``_resample_weekly_iso``; a
  holiday Friday such as Good Friday is still the key -- it is a label, not a session).
* ``M`` -- the 1st of the month.

Why a module (2026-11-11): production served META/NFLX/MSTR/MU/MRVL/LYFT with a daily
bar dated SATURDAY 2026-11-07 out of bars.db. It drew as an extra candle and was summed
into the week (META's W close for 11-06 was the Saturday close). Every date-STAMPING
producer we own was already calendar-gated; the row arrived on a provider-dated path
(``_massive_raw_to_iso`` copies whatever date the provider's aggregate carries) and
nothing between the provider and the chart asked whether the date was a session.
The weekly Friday rule already existed in two copies (the serve guard and the purge).
This module is the single owner; the store's write gate, the producer normalization,
the W/M resamplers, the serve guard and the cleanup all ask it.

⛔ STDLIB + ``session_calendar`` ONLY (which is itself stdlib-only), so ``bars_sqlite``
can import it at the write door without a cycle.
"""
from __future__ import annotations

from datetime import date
from functools import lru_cache
from typing import Iterable, Optional

from api.services import session_calendar as _sc

DATE_TFS = ("D", "W", "M")


def key_date(t) -> Optional[date]:
    """The calendar date a D/W/M key names, or None when it names none.

    Accepts the two spellings the store uses: an ``int`` / ``str`` YYYYMMDD (stored
    key) and a ``"YYYY-MM-DD"`` string (served / normalized bar)."""
    if isinstance(t, bool):
        return None
    s = str(t).strip()
    if len(s) == 10 and s[4] == "-" and s[7] == "-":
        s = s[:4] + s[5:7] + s[8:]
    if len(s) != 8 or not s.isdigit():
        return None
    try:
        return date(int(s[:4]), int(s[4:6]), int(s[6:]))
    except ValueError:
        return None


def is_session_date(d: date) -> bool:
    """True when ``d`` is an NYSE trading day (the D-key rule)."""
    return _sc.is_trading_day(d)


def key_ok(tf: str, t) -> bool:
    """Does ``t`` satisfy the key rule for ``tf``? Non-date TFs are not judged here.

    Memoized: it runs per row on the serve path, and the key space is a few tens of
    thousands of dates (the calendar is immutable for the process lifetime)."""
    try:
        return _key_ok_cached(tf, t)
    except TypeError:          # unhashable key -> judge it uncached
        return _key_ok(tf, t)


@lru_cache(maxsize=1 << 17, typed=True)
def _key_ok_cached(tf: str, t) -> bool:
    return _key_ok(tf, t)


def _key_ok(tf: str, t) -> bool:
    if tf not in DATE_TFS:
        return True
    d = key_date(t)
    if d is None:
        return False
    if tf == "D":
        return is_session_date(d)
    if tf == "W":
        return d.weekday() == 4
    return d.day == 1


def key_reason(tf: str, t) -> Optional[str]:
    """Why ``t`` is not a valid ``tf`` key, or None when it is."""
    if key_ok(tf, t):
        return None
    d = key_date(t)
    if d is None:
        return f"malformed {tf} key"
    if tf == "D":
        name = _sc.holiday_name(d)
        return f"D key on a non-trading day ({name or d.strftime('%A')})"
    if tf == "W":
        return "W key is not the ISO-week Friday"
    return "M key is not the 1st of the month"


#: Symbols whose daily series does not follow the NYSE calendar (24/7 crypto). Only
#: the yfinance intraday path serves BTC today, but the rule must never delete a
#: weekend crypto session if a daily series is ever stored.
_CRYPTO_PREFIXES = ("X:",)
_CRYPTO_NAMES = frozenset({"BTC", "ETH"})


def calendar_applies(ticker: Optional[str]) -> bool:
    """Does the NYSE session calendar govern ``ticker``'s D keys?"""
    tk = (ticker or "").upper()
    if tk in _CRYPTO_NAMES or tk.startswith(_CRYPTO_PREFIXES):
        return False
    return "-USD" not in tk


def session_daily(bars: Iterable[dict], ticker: Optional[str] = None) -> list[dict]:
    """``bars`` (daily, ``t`` in either spelling) with every non-session key dropped.

    The producer-side filter: applied where provider daily aggregates are normalized
    and before any W/M resample, so a non-session row can neither be stored nor
    folded into a week or month."""
    bars = list(bars)
    if not calendar_applies(ticker):
        return bars
    return [b for b in bars if key_ok("D", b.get("t"))]
