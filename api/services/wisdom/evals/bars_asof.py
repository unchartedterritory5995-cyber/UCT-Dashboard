"""As-of bar reads for the Wisdom evals (CONTRACTS §6.5, ruling 28).

READ-ONLY by construction. Production reads go through bars_sqlite.get_bars_before /
get_bars_since (the web pod's own store, index seeks, no provider fetch, no write, never
serve_bars). PC-side scripts hand in a ReadOnlyFileReader over an explicit path opened with
sqlite URI mode=ro. Nothing in this module can reach a provider, and a name that is not in
the store is `unverifiable` with a named reason — never 0.

ONE internal bar dialect: Bar(d=YYYYMMDD session in ET, o, h, l, c, v, t=unix seconds or None).
bars.db stores daily ts as YYYYMMDD ints and intraday ts as unix seconds; both are normalised
here and nowhere else, so no caller ever compares an ISO string with an int.

THE SESSION CALENDAR comes from a reference ticker's own daily bars (SPY), not from a holiday
table: the NYSE table in bars_fetch covers 2025-2027 only, while bars go back decades. A session
the reference has and a ticker lacks is a missing bar (unverifiable); a session the reference
does not have yet has simply not closed (immature, retried on the next refresh).
"""
from __future__ import annotations

import sqlite3
import threading
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Optional, Protocol, Sequence

from api.services.wisdom.core import timeutil

DAILY = "D"
INTRADAY_5M = "5"
REFERENCE_TICKER = "SPY"
_INTRADAY_SESSION_ROWS = 400      # 4:00-20:00 ET at 5 min is 192 rows; headroom for odd feeds


@dataclass(frozen=True)
class Bar:
    d: int
    o: float
    h: float
    l: float
    c: float
    v: float
    t: Optional[int] = None


class BarReader(Protocol):
    """Raw tuple reads, (ts, o, h, l, c, v), oldest first — bars_sqlite's own shape."""

    def before(self, ticker: str, tf: str, max_bars: int, to_key: int) -> list: ...

    def since(self, ticker: str, tf: str, since_key: int) -> list: ...


class SqliteModuleReader:
    """The web pod's bars store through its own read functions (never a write path)."""

    def before(self, ticker: str, tf: str, max_bars: int, to_key: int) -> list:
        from api.services import bars_sqlite

        return bars_sqlite.get_bars_before(ticker, tf, max_bars, to_key)

    def since(self, ticker: str, tf: str, since_key: int) -> list:
        from api.services import bars_sqlite

        return bars_sqlite.get_bars_since(ticker, tf, since_key)


class ReadOnlyFileReader:
    """An explicit bars.db path opened with sqlite URI mode=ro (PC-side scripts, fixtures).

    Same SQL as bars_sqlite.get_bars_before / get_bars_since. mode=ro opens nothing for
    writing and creates nothing, so it is safe against a live mirror."""

    def __init__(self, path: str):
        self.path = str(path)
        self._local = threading.local()

    def _conn(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            uri = "file:" + self.path.replace("\\", "/") + "?mode=ro"
            conn = sqlite3.connect(uri, uri=True, check_same_thread=False)
            self._local.conn = conn
        return conn

    def before(self, ticker: str, tf: str, max_bars: int, to_key: int) -> list:
        return self._conn().execute(
            "SELECT ts,o,h,l,c,v FROM (SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf=? AND ts<=? "
            "ORDER BY ts DESC LIMIT ?) ORDER BY ts ASC",
            (ticker.upper(), tf, int(to_key), int(max_bars)),
        ).fetchall()

    def since(self, ticker: str, tf: str, since_key: int) -> list:
        return self._conn().execute(
            "SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf=? AND ts>? ORDER BY ts ASC",
            (ticker.upper(), tf, int(since_key)),
        ).fetchall()


class MemoryReader:
    """In-memory bars for tests: {(TICKER, tf): [(ts, o, h, l, c, v), ...]}."""

    def __init__(self, rows: dict):
        self.rows = {(k[0].upper(), k[1]): sorted(v) for k, v in rows.items()}

    def before(self, ticker: str, tf: str, max_bars: int, to_key: int) -> list:
        got = [r for r in self.rows.get((ticker.upper(), tf), []) if r[0] <= int(to_key)]
        return got[-int(max_bars):] if max_bars else []

    def since(self, ticker: str, tf: str, since_key: int) -> list:
        return [r for r in self.rows.get((ticker.upper(), tf), []) if r[0] > int(since_key)]


# ── dialect ──────────────────────────────────────────────────────────────────

def ymd_int(d: date) -> int:
    return d.year * 10000 + d.month * 100 + d.day


def int_to_date(value: int) -> date:
    v = int(value)
    return date(v // 10000, (v // 100) % 100, v % 100)


def _daily_bar(row: Sequence) -> Optional[Bar]:
    try:
        ts, o, h, l, c, v = row[:6]
        o, h, l, c = float(o), float(h), float(l), float(c)
    except (TypeError, ValueError):
        return None
    if min(o, h, l, c) <= 0:
        return None
    return Bar(d=int(ts), o=o, h=h, l=l, c=c, v=float(v or 0))


def _intraday_bar(row: Sequence) -> Optional[Bar]:
    try:
        ts, o, h, l, c, v = row[:6]
        o, h, l, c = float(o), float(h), float(l), float(c)
    except (TypeError, ValueError):
        return None
    if min(o, h, l, c) <= 0:
        return None
    et = datetime.fromtimestamp(int(ts), tz=timeutil.ET)
    return Bar(d=ymd_int(et.date()), o=o, h=h, l=l, c=c, v=float(v or 0), t=int(ts))


class BarsAsOf:
    """The one entry point the evals use for bars."""

    def __init__(self, reader: Optional[BarReader] = None, reference: str = REFERENCE_TICKER):
        self.reader = reader if reader is not None else SqliteModuleReader()
        self.reference = reference

    # daily
    def history(self, ticker: str, asof: date, n: int) -> list[Bar]:
        """Up to n daily bars with session <= asof (inclusive), oldest first."""
        rows = self.reader.before(ticker.upper(), DAILY, n, ymd_int(asof))
        return [b for b in (_daily_bar(r) for r in rows) if b is not None]

    def daily_from(self, ticker: str, start: date, max_sessions: int) -> list[Bar]:
        """Daily bars with session >= start (inclusive), oldest first, at most max_sessions.

        get_bars_since is strict >, so the key is the day before start (YYYYMMDD ints are
        ordered, so start-1 lands between the previous date and start)."""
        rows = self.reader.since(ticker.upper(), DAILY, ymd_int(start) - 1)
        bars = [b for b in (_daily_bar(r) for r in rows) if b is not None]
        return bars[:max_sessions]

    def sessions_from(self, start: date, max_sessions: int) -> list[int]:
        """The market calendar: reference-ticker sessions >= start that have CLOSED (have a bar)."""
        return [b.d for b in self.daily_from(self.reference, start, max_sessions)]

    def sessions_before(self, end: date, n: int) -> list[int]:
        return [b.d for b in self.history(self.reference, end, n)]

    def next_session_on_or_after(self, d: date) -> Optional[int]:
        got = self.sessions_from(d, 1)
        return got[0] if got else None

    # intraday
    def intraday_session(self, ticker: str, session: int, tf: str = INTRADAY_5M) -> list[Bar]:
        """Every intraday bar stamped on that ET date, time order. [] when the store has none."""
        day = int_to_date(session)
        end = datetime.combine(day, time(23, 59, 59), tzinfo=timeutil.ET)
        rows = self.reader.before(ticker.upper(), tf, _INTRADAY_SESSION_ROWS, int(end.timestamp()))
        bars = [b for b in (_intraday_bar(r) for r in rows) if b is not None]
        return [b for b in bars if b.d == session]


def last_closed_session_date(stated_at: datetime, precision: Optional[str]) -> date:
    """The newest session whose close was KNOWN when the statement was made.

    minute precision on a session day at/after 16:00 ET -> that day; everything else (pre-close,
    non-trading day, or day/week precision where the hour is unknown) -> the previous calendar
    day, which the caller resolves to a session through the calendar. Conservative on purpose:
    an unknown hour never borrows that day's close."""
    et = timeutil.to_et(stated_at)
    if (precision or "minute") == "minute" and et.time() >= time(16, 0):
        return et.date()
    return et.date() - timedelta(days=1)
