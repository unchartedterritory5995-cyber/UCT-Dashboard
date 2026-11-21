"""⭐⭐ RULING 2 (C), the coordinator's tripwire (2026-11-20): WHY NO SERVED SERIES REACHES A CLOSURE-DAY WEEK.

A bar dated on a day the New York exchange held no session (a weekend, a full closure) is kept in a weekly / monthly
aggregate by both lanes now; whether TradingView's week holds it is UNMEASURED (Q-REQ-CLOSURE:
``vw-req-w-closure-day-eurusd-1d`` / ``-es1-1d``), and the withhold that would name it is deferred to that capture
because nothing the store serves holds such a bar. This file pins that reason, so it cannot quietly stop being true:

1. every ticker the NYSE calendar governs (``date_bar_keys.calendar_applies``) loses such a daily row at the store's serve
   door (``bars_fetch._fmt_sqlite_bars``) and at its producer (``bars_fetch._massive_raw_to_iso``);
2. the tickers it does NOT govern are exactly the crypto spellings, and no crypto DAILY series is served (``date_bar_keys``:
   "Only the yfinance intraday path serves BTC today"; an intraday series is keyed by its New York day, so its weekend
   sessions are its own); a crypto, FX or futures venue named in a request is refused by name by the Pine door
   (``htfExchangeDay.test.js``'s tripwire half).

⛔ If this goes red because someone serves FX, futures or crypto daily bars (or exempts another ticker from the
calendar), the weekly / monthly aggregate of a closure-day bar becomes reachable: land Q-REQ-CLOSURE and its withhold
(or the aggregate it measures) FIRST.
"""
from __future__ import annotations

from api.services import bars_fetch, date_bar_keys

# Thursday 2024-03-28, Good Friday 2024-03-29 (an NYSE full closure), Saturday 03-30, Sunday 03-31, Monday 04-01
DAYS = (20240328, 20240329, 20240330, 20240331, 20240401)
SESSIONS = {20240328, 20240401}


def _rows():
    return [(d, 10.0 + i, 11.0 + i, 9.0 + i, 10.5 + i, 1000) for i, d in enumerate(DAYS)]


def test_a_calendar_ticker_loses_every_day_without_a_session_at_the_serve_door():
    for ticker in ("SPY", "AAPL", "EURUSD", "ES1", "C:EURUSD"):
        assert date_bar_keys.calendar_applies(ticker), ticker
        kept = [b["t"] for b in bars_fetch._fmt_sqlite_bars(_rows(), "D", ticker)]
        assert kept == ["2024-03-28", "2024-04-01"], (ticker, kept)


def test_a_calendar_ticker_loses_every_day_without_a_session_at_the_producer():
    raw = [{"t": __import__("calendar").timegm((d // 10000, d // 100 % 100, d % 100, 0, 0, 0)) * 1000,
            "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10} for d in DAYS]
    kept = [b["t"] for b in bars_fetch._massive_raw_to_iso(raw, "SPY")]
    assert kept == ["2024-03-28", "2024-04-01"]


def test_only_the_crypto_spellings_escape_the_calendar():
    # ⛔ the ONE exemption list: a new exempt spelling (an FX, futures or crypto daily series served) makes a
    # closure-day bar reachable in a weekly / monthly aggregate whose TradingView answer is unmeasured
    assert date_bar_keys._CRYPTO_NAMES == frozenset({"BTC", "ETH"})
    assert date_bar_keys._CRYPTO_PREFIXES == ("X:",)
    for ticker in ("BTC", "ETH", "X:BTCUSD", "BTC-USD", "SOL-USD"):
        assert not date_bar_keys.calendar_applies(ticker), ticker
    for ticker in ("SPY", "QQQ", "IWM", "EURUSD", "GLD", "BRK.B"):
        assert date_bar_keys.calendar_applies(ticker), ticker
