"""THE ONE EXTENDED-SESSION RULE (2026-11-25, #2781 and its live follow-up).

An intraday row, a live minute and a developing bar of a US-listed name exist only inside their ET trading day's
extended session, [04:00, extended close): 20:00, or 17:00 on a half day (the regular close plus four hours). That is
the session TradingView's extended-hours bars cover. Every reader asks two questions:

    applies(ticker)   is the name governed by that session at all
    inside(ts)        is this instant (unix seconds) inside it

Readers: the serve chokepoint (`bars_fetch._fmt_sqlite_bars`), the live minute gate (`bar_broadcaster._accept_minute`),
the REST developing row (`bar_contract._live_partial`) and the one-off store purge
(`bars_sqlite.purge_off_session_intraday`). The client mirror is `app/src/data/barStore/extendedSession.js`; both are
pinned to one case list (`tests/fixtures/session_clamp_cases.json`).

⛔ A LIGHT MODULE ON PURPOSE: the calendar (`session_calendar`) and nothing heavier at import, so the live gate and the
store can read it without pulling `bars_fetch` (and through it the broadcaster) into flow-worker's import closure
(`tests/test_alert_taxonomy_price_level_projection.py`).
"""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")
_OPEN_MIN = 4 * 60                         # 04:00 ET
_AFTER_CLOSE_MIN = 4 * 60                  # the extended session ends four hours after the regular close

#: Markers of a symbol no NYSE session governs: a vendor prefix (`X:` crypto, `C:` FX, `I:` index), a Yahoo future or FX
#: pair (`ES=F`, `EURUSD=X`), an index (`^GSPC`) or a slash form (`/ES`).
_NON_SESSION_MARKS = (":", "=", "^", "/")
#: Yahoo suffixes of non-US listings (`SHOP.TO`, `0700.HK`). A US class share (`BRK.B`) keeps its one-letter class; the
#: few one-letter exchange suffixes here (`.L` London, `.V` TSX Venture, `.T` Tokyo, `.F` Frankfurt) would leave a US
#: class share with that letter UNclamped, which is the old behaviour, never a loss.
_NON_US_SUFFIXES = frozenset({
    "TO", "V", "CN", "NE", "L", "IL", "AS", "BR", "PA", "DE", "F", "MI", "MC", "LS", "SW", "VI", "ST", "OL", "CO",
    "HE", "IR", "WA", "IS", "AT", "HK", "SS", "SZ", "T", "KS", "KQ", "TW", "TWO", "SI", "KL", "BK", "JK", "NS", "BO",
    "AX", "NZ", "SA", "MX", "BA", "SN", "JO", "TA", "SR", "QA",
})
#: 24-hour names (`date_bar_keys.calendar_applies` says the same for daily keys).
_CRYPTO_NAMES = frozenset({"BTC", "ETH"})


def applies(ticker: str | None) -> bool:
    """Is `ticker` a US-listed name the NYSE extended session governs? False for a 24-hour name (crypto, `-USD`), a
    future, an FX pair, an index, a foreign listing, or a breadth pseudo-ticker. No ticker (a caller that does not
    pass one) is clamped, as the serve path always was."""
    tk = (ticker or "").strip().upper()
    if not tk:
        return True
    if any(m in tk for m in _NON_SESSION_MARKS):
        return False
    if "." in tk and tk.rsplit(".", 1)[1] in _NON_US_SUFFIXES:
        return False
    if tk in _CRYPTO_NAMES or "-USD" in tk:
        return False
    return not _is_breadth(tk)


def _is_breadth(tk: str) -> bool:
    try:                                   # lazy: read only for a name that passed every rule above
        from api.services.breadth_symbols import is_breadth_symbol
        return bool(is_breadth_symbol(tk))
    except Exception:                      # noqa: BLE001 - unknown: clamp as an equity
        return False


#: UTC hour index -> inside the session. Every session boundary (04:00, 17:00, 20:00 ET) is a whole ET hour and ET's
#: offset from UTC is a whole number of hours, so a UTC hour is wholly inside or wholly outside.
_HOURS: dict[int, bool] = {}


def inside(ts) -> bool:
    """`ts` (unix seconds) lies inside its ET trading day's extended session. One calendar read per UTC hour, ever
    (cached), so the live gate can ask it on every trade."""
    h = int(ts) // 3600
    v = _HOURS.get(h)
    if v is None:
        v = _judge(h * 3600)
        if len(_HOURS) > 400_000:          # ~45 years of hours: never in practice; bounded anyway
            _HOURS.clear()
        _HOURS[h] = v
    return v


def _judge(start: int) -> bool:
    from api.services import session_calendar as _sc
    at = datetime.fromtimestamp(start, _ET)
    close = _sc.close_time(at.date())
    if close is None:                      # a weekend or an NYSE holiday
        return False
    m = at.hour * 60 + at.minute
    return _OPEN_MIN <= m < close.hour * 60 + close.minute + _AFTER_CLOSE_MIN
