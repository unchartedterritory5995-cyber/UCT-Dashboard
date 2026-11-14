"""The harness's read-only store: two SQLite files opened ``mode=ro``, and a lock on
the holdout.

EVERY connection this package opens comes from :func:`connect_ro`. SQLite refuses a
write through a ``mode=ro`` handle, so "read-only" is a property of the handle, not
of the care taken in the queries. (On a database in WAL mode SQLite may create the
``-shm`` index file beside it when none exists; it never changes the database.)

THE HOLDOUT LOCK is here, at the reader, so no caller can read past it by mistake:
a :class:`Store` built without ``unlock_holdout`` refuses a rating session after
``cutoff`` (:class:`HoldoutLocked`) and bounds every bar query at ``cutoff`` in the
SQL itself. The one thing read across the line is the LIST OF SESSION DATES, which is
what says where the line is.
"""
from __future__ import annotations

import json
import pathlib
import sqlite3
from contextlib import closing
from typing import Dict, List, Optional

from . import spec

RATING_TABLE = "rs_rating_history"
ROWS_TABLE = "screener_rows"
SPLITS_TABLE = "declared_split_lists"
BARS_TABLE = "ohlcv"
DAILY = "D"


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


def _has_table(conn, name: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
                        (name,)).fetchone() is not None


class Store:
    """The two databases, read-only, with the holdout line drawn.

    ``sessions`` are all stored rating sessions, oldest first. ``development`` are the
    ones before the holdout, ``holdout`` the newest ``spec.HOLDOUT_SESSIONS``.
    ``cutoff`` is the last session this store will read: the last development session,
    or the newest session of all when ``unlock_holdout`` is set."""

    def __init__(self, bars_db, screener_db, *, unlock_holdout: bool = False):
        self.unlock_holdout = bool(unlock_holdout)
        self.bars = connect_ro(bars_db)
        self.screener = connect_ro(screener_db)
        self.sessions: List[str] = [r[0] for r in self.screener.execute(
            f"SELECT DISTINCT session FROM {RATING_TABLE} ORDER BY session")]
        n_hold = min(spec.HOLDOUT_SESSIONS, len(self.sessions))
        split = len(self.sessions) - n_hold
        self.development, self.holdout = self.sessions[:split], self.sessions[split:]
        readable = self.sessions if self.unlock_holdout else self.development
        self.cutoff: Optional[str] = readable[-1] if readable else None
        self.cutoff_ymd: Optional[int] = ymd(self.cutoff) if self.cutoff else None

    def close(self) -> None:
        for conn in (self.bars, self.screener):
            try:
                conn.close()
            except sqlite3.Error:
                pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False

    # ── ratings (stored per session; the only rating source) ────────────────
    def ratings(self, session: str) -> Dict[str, tuple]:
        """``{TICKER: (rating, score)}`` stored for ``session``. Refuses a session past
        the cutoff."""
        if self.cutoff is None or session > self.cutoff:
            raise HoldoutLocked(f"rating session {session} is past {self.cutoff}: "
                                "the holdout is locked")
        return {str(t).upper(): (ibd, score) for t, ibd, score in self.screener.execute(
            f"SELECT ticker, ibd, score FROM {RATING_TABLE} WHERE session = ?", (session,))}

    # ── classification, as held today ──────────────────────────────────────
    def classification(self) -> Dict[str, dict]:
        """``{TICKER: {"is_etf", "industry", "sector"}}`` from today's rows: the three
        facts that are not recomputed (module docstring of the package)."""
        return {str(t).upper(): {"is_etf": etf, "industry": ind, "sector": sec}
                for t, etf, ind, sec in self.screener.execute(
                    f"SELECT ticker, is_etf, industry, sector FROM {ROWS_TABLE}")}

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
    def daily_bars(self, ticker: str, from_ymd: int) -> List[dict]:
        """One symbol's daily bars from ``from_ymd`` to the cutoff, oldest first, as
        the bar dicts the RS helpers read. The upper bound is in the statement."""
        if self.cutoff_ymd is None:
            raise HoldoutLocked("there is no session this store may read")
        with closing(self.bars.execute(
                f"SELECT ts, o, h, l, c, v FROM {BARS_TABLE} WHERE ticker = ? AND tf = ? "
                "AND ts >= ? AND ts <= ? ORDER BY ts",
                (str(ticker).upper(), DAILY, int(from_ymd), self.cutoff_ymd))) as cur:
            return [{"t": ts, "o": o, "h": h, "l": l, "c": c, "v": v}
                    for ts, o, h, l, c, v in cur]
