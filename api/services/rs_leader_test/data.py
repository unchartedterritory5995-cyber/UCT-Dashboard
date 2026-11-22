"""The harness's read-only store: SQLite files opened ``mode=ro``, and a lock on the
holdout.

EVERY connection this package opens comes from :func:`connect_ro`. SQLite refuses a
write through a ``mode=ro`` handle, so "read-only" is a property of the handle, not
of the care taken in the queries. (On a database in WAL mode SQLite may create the
``-shm`` index file beside it when none exists; it never changes the database.)

TWO WAYS TO HAVE A RATING ON A FORMATION DATE (``ratings``):

* ``stored``: the sessions are the stored rating sessions (``rs_rating_history``) and
  each date's ratings are read from it.
* ``computed``: the sessions are the BENCHMARK'S (SPY's bar dates in the bars store)
  and each date's ratings are computed from bars in memory (``ratings.py``). Nothing
  needs to be stored for a date to be tested.

Either way the newest ``spec.HOLDOUT_SESSIONS`` sessions of that calendar are the
holdout.

THE HOLDOUT LOCK is here, at the reader, so no caller can read past it by mistake:
a :class:`Store` built without ``unlock_holdout`` refuses a stored rating session after
``cutoff`` (:class:`HoldoutLocked`) and bounds every bar query at ``cutoff`` in the
SQL itself. The one thing read across the line is the LIST OF SESSION DATES, which is
what says where the line is.
"""
from __future__ import annotations

import json
import pathlib
import sqlite3
from bisect import bisect_left
from contextlib import closing
from typing import Dict, Iterator, List, Optional

from . import spec

RATING_TABLE = "rs_rating_history"
ROWS_TABLE = "screener_rows"
SPLITS_TABLE = "declared_split_lists"
BARS_TABLE = "ohlcv"
INDUSTRY_TABLE = "industry_map"
DAILY = "D"
COMPUTED, STORED = "computed", "stored"
MODES = (COMPUTED, STORED)


class HoldoutLocked(RuntimeError):
    """A read past the last development session without ``--unlock-holdout``."""


def connect_ro(path) -> sqlite3.Connection:
    """A read-only connection to an EXISTING SQLite file. A missing file is an error
    (``mode=ro`` never creates one)."""
    uri = pathlib.Path(path).resolve().as_uri() + "?mode=ro"
    return sqlite3.connect(uri, uri=True)


def ymd(session) -> int:
    """``YYYYMMDD`` from a ``YYYY-MM-DD`` session key (the daily bar's ``ts``)."""
    return int(str(session)[:10].replace("-", ""))


def iso(day: int) -> str:
    """``YYYY-MM-DD`` from a daily bar's ``YYYYMMDD``."""
    d = int(day)
    return f"{d // 10000:04d}-{d // 100 % 100:02d}-{d % 100:02d}"


def _has_table(conn, name: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
                        (name,)).fetchone() is not None


class Store:
    """The databases, read-only, with the holdout line drawn.

    ``calendar`` is every session of the mode's calendar, oldest first (module
    docstring), and ``first`` the position of the first one a formation date may use:
    ``--from-date`` when given, and in ``computed`` mode never before the benchmark
    has ``spec.MIN_LISTING_BARS`` bars (no stock can be in the universe earlier).
    ``sessions`` are the calendar from ``first``; ``development`` the ones before the
    holdout, ``holdout`` the newest ``spec.HOLDOUT_SESSIONS`` of the calendar.
    ``cutoff`` is the last session this store will read: the last development session,
    or the newest session of all when ``unlock_holdout`` is set."""

    def __init__(self, bars_db, screener_db, *, unlock_holdout: bool = False,
                 ratings: str = STORED, from_date: Optional[str] = None, industry_db=None):
        if ratings not in MODES:
            raise ValueError(f"ratings must be one of {MODES}, not {ratings!r}")
        self.mode = ratings
        self.unlock_holdout = bool(unlock_holdout)
        self.bars = connect_ro(bars_db)
        self.screener = connect_ro(screener_db)
        self.industry = connect_ro(industry_db) if industry_db else None
        self.stored_sessions: List[str] = []
        if _has_table(self.screener, RATING_TABLE):
            self.stored_sessions = [r[0] for r in self.screener.execute(
                f"SELECT DISTINCT session FROM {RATING_TABLE} ORDER BY session")]
        if ratings == STORED:
            self.calendar: List[str] = list(self.stored_sessions)
            floor = 0
        else:
            # Dates only: where the sessions are, not what happened on them.
            self.calendar = [iso(r[0]) for r in self.bars.execute(
                f"SELECT ts FROM {BARS_TABLE} WHERE ticker = ? AND tf = ? ORDER BY ts",
                (spec.BENCHMARK, DAILY))]
            floor = spec.MIN_LISTING_BARS - 1
        n_hold = min(spec.HOLDOUT_SESSIONS, len(self.calendar))
        split = len(self.calendar) - n_hold
        if from_date:
            floor = max(floor, bisect_left(self.calendar, str(from_date)[:10]))
        self.first = min(floor, split)
        self.sessions: List[str] = self.calendar[self.first:]
        self.development, self.holdout = self.calendar[self.first:split], self.calendar[split:]
        readable = self.sessions if self.unlock_holdout else self.development
        self.cutoff: Optional[str] = readable[-1] if readable else None
        self.cutoff_ymd: Optional[int] = ymd(self.cutoff) if self.cutoff else None

    def close(self) -> None:
        for conn in (self.bars, self.screener, self.industry):
            if conn is None:
                continue
            try:
                conn.close()
            except sqlite3.Error:
                pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False

    # ── stored ratings ─────────────────────────────────────────────────────
    def ratings(self, session: str) -> Dict[str, tuple]:
        """``{TICKER: (rating, score)}`` stored for ``session`` (empty when none is).
        Refuses a session past the cutoff."""
        if self.cutoff is None or session > self.cutoff:
            raise HoldoutLocked(f"rating session {session} is past {self.cutoff}: "
                                "the holdout is locked")
        if not self.stored_sessions:
            return {}
        return {str(t).upper(): (ibd, score) for t, ibd, score in self.screener.execute(
            f"SELECT ticker, ibd, score FROM {RATING_TABLE} WHERE session = ?", (session,))}

    def readable_stored_sessions(self) -> List[str]:
        """The stored rating sessions at or before the cutoff, oldest first."""
        if self.cutoff is None:
            return []
        return [s for s in self.stored_sessions if s <= self.cutoff]

    # ── classification, as held today ──────────────────────────────────────
    def classification(self) -> Dict[str, dict]:
        """``{TICKER: {"is_etf", "industry", "sector"}}`` from today's rows: the three
        facts that are not recomputed (module docstring of the package)."""
        return {str(t).upper(): {"is_etf": etf, "industry": ind, "sector": sec}
                for t, etf, ind, sec in self.screener.execute(
                    f"SELECT ticker, is_etf, industry, sector FROM {ROWS_TABLE}")}

    def etf_tickers(self, classes: Optional[Dict[str, dict]] = None) -> tuple:
        """``(set, {source: count or None})``: every symbol known to be an ETF, from
        the four sources the rating job's own list is made of
        (``rs_history.default_etf_tickers``), each read here read-only: the industry
        map's "Exchange Traded Fund" rows (``--industry-db``; ``None`` in the counts
        when it was not given), the benchmark and sector ETFs, the liquid-ETF list
        file, and today's ``screener_rows``. As held today."""
        from api.services import cap_universe, rs_benchmarks        # noqa: PLC0415 - constants and one file read
        classes = self.classification() if classes is None else classes
        sources = {
            "industry_map": None,
            "benchmarks": set(rs_benchmarks.LITERAL_BENCHMARKS) | set(rs_benchmarks.SECTOR_ETF.values()),
            "liquid_etf_list": {str(t).upper() for t in cap_universe.etf_symbols() or ()},
            "screener_rows": {t for t, c in classes.items() if c["is_etf"] == 1},
        }
        if self.industry is not None and _has_table(self.industry, INDUSTRY_TABLE):
            sources["industry_map"] = {str(r[0]).upper() for r in self.industry.execute(
                f"SELECT ticker FROM {INDUSTRY_TABLE} WHERE industry = ?", (rs_benchmarks.ETF_INDUSTRY,))}
        out: set = set()
        for found in sources.values():
            out |= found or set()
        return out, {k: (None if v is None else len(v)) for k, v in sources.items()}

    def declared_splits(self) -> Optional[Dict[str, list]]:
        """``{TICKER: [(iso_date, ratio), ...]}`` from the rating job's memo of declared
        split lists, or ``None`` when this database has no such table (then no window
        can be checked for an unadjusted split, and the output says so)."""
        if not _has_table(self.screener, SPLITS_TABLE):
            return None
        out: Dict[str, list] = {}
        for t, raw in self.screener.execute(f"SELECT ticker, splits FROM {SPLITS_TABLE}"):
            try:
                out[str(t).upper()] = [(str(d)[:10], float(r)) for d, r in json.loads(raw)]
            except (TypeError, ValueError):
                continue
        return out

    # ── bars ───────────────────────────────────────────────────────────────
    def tickers(self) -> Iterator[str]:
        """Every symbol in the bars store, in order, one index seek each
        (``bars_sqlite.iter_tickers``'s walk: ``SELECT DISTINCT`` would read every row)."""
        current = ""
        while True:
            row = self.bars.execute(
                f"SELECT ticker FROM {BARS_TABLE} WHERE ticker > ? ORDER BY ticker LIMIT 1",
                (current,)).fetchone()
            if row is None:
                return
            current = row[0]
            yield current

    def daily_rows(self, ticker: str, from_ymd: int) -> List[tuple]:
        """One symbol's daily rows ``(ts, o, h, l, c, v)`` from ``from_ymd`` to the
        cutoff, oldest first. The upper bound is in the statement."""
        if self.cutoff_ymd is None:
            raise HoldoutLocked("there is no session this store may read")
        with closing(self.bars.execute(
                f"SELECT ts, o, h, l, c, v FROM {BARS_TABLE} WHERE ticker = ? AND tf = ? "
                "AND ts >= ? AND ts <= ? ORDER BY ts",
                (str(ticker).upper(), DAILY, int(from_ymd), self.cutoff_ymd))) as cur:
            return cur.fetchall()

    def daily_bars(self, ticker: str, from_ymd: int) -> List[dict]:
        """:meth:`daily_rows` as the bar dicts the RS helpers read."""
        return as_bars(self.daily_rows(ticker, from_ymd))


def as_bars(rows) -> List[dict]:
    return [{"t": ts, "o": o, "h": h, "l": l, "c": c, "v": v} for ts, o, h, l, c, v in rows]
