"""The evidence store: measurement rows, the ``(session, signal)`` checkpoint
and run receipts, in ONE SQLite file whose path is a REQUIRED argument.

NO DEFAULT PATH, ON PURPOSE (map §2.1: "destination path REQUIRED from env",
the `breadth_combined_pass.open_artifact` rule). The arming unit (2b-02)
chooses the file under its data directory; nothing here can open a store by
guessing one. Read-only opens (the dry run) never create the file.

TABLES
    rs_evidence_rows        (session, signal, ticker) -> ex_<h> REAL per horizon,
                            skip INTEGER (1: the split guard left the row out,
                            its ex_<h> are NULL; owner decision N5)
                            ``signal`` includes :data:`measure.BASELINE_KEY`.
    rs_evidence_checkpoint  (session, signal) -> status 'done' | 'open', rows, at
                            'done'  every horizon's window was complete when
                                    measured: never measured again.
                            'open'  the longest window ran past the held
                                    history: re-measured on the next run.
    rs_evidence_rows_stage  the rows of the run IN FLIGHT, same shape as
                            ``rs_evidence_rows``. Nothing reads it but
                            :func:`swap_in`; a run that dies leaves it to be
                            discarded by the next one.
    rs_evidence_meta        version and horizons; a mismatch REBUILDS the
                            tables above (they are derived from bars.db and
                            the method; nothing original is lost). Version 2
                            (2026-11-07): the next-open base (N6) and the split
                            guard (N5), so every version-1 row is re-measured.
    declared_split_lists    the provider answers `declared_splits` stored for
                            the split guard; not derived from the method, so a
                            rebuild keeps it.
    rs_evidence_runs        one JSON receipt per run.

AN INTERRUPTED RUN CHANGES NOTHING PUBLISHED (review finding #3, 2026-11-07).
A run writes its rows to the stage table only; the old rows and checkpoints of
the pairs it re-measures stay in place until :func:`swap_in` replaces them,
marks the checkpoints and empties the stage in ONE transaction. A run killed
mid-loop (a timeout, a redeploy) therefore leaves every ``open`` checkpoint in
place, so the next run asks for those sessions again, and no row of the half
run reaches :func:`summary`. Rows without a checkpoint (what the old
clear-first run left behind) are reported by :func:`unchecked_pairs` so the job
re-measures them, and :func:`swap_in` deletes any that remain.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

from .measure import BASELINE_KEY, HORIZONS, MaybeNum, Row, summarise_values

SCHEMA_VERSION = 2
ROWS_TABLE = "rs_evidence_rows"
CHECKPOINT_TABLE = "rs_evidence_checkpoint"
META_TABLE = "rs_evidence_meta"
RUNS_TABLE = "rs_evidence_runs"
STAGE_TABLE = "rs_evidence_rows_stage"
DONE = "done"
OPEN = "open"


class StoreRefused(RuntimeError):
    """The store could not be opened on the terms asked for."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _ex_cols(horizons: Sequence[int]) -> List[str]:
    return [f"ex_{int(h)}" for h in horizons]


def open_store(path: Optional[str], *, horizons: Sequence[int] = HORIZONS,
               read_only: bool = False) -> Optional[sqlite3.Connection]:
    """Open the store at ``path``. Refuses an empty path. ``read_only`` returns
    ``None`` when the file does not exist and never creates or alters it."""
    if not path or not str(path).strip():
        raise StoreRefused("an explicit store path is REQUIRED - this job has no default "
                           "destination on purpose, so forgetting one argument cannot write "
                           "into a data directory by guesswork")
    p = Path(str(path))
    if read_only:
        if not p.exists():
            return None
        conn = sqlite3.connect(p.resolve().as_uri() + "?mode=ro", uri=True, timeout=30.0)
        _check_meta(conn, horizons, rebuild=False)
        return conn
    p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(p), timeout=30.0)
    conn.execute("PRAGMA journal_mode=WAL")
    ensure_schema(conn, horizons)
    return conn


def _derived_tables_sql(horizons: Sequence[int]) -> str:
    """The tables the method derives (rows, stage, checkpoint): created here and
    re-created by a meta rebuild, from ONE statement so the two cannot drift."""
    cols = ", ".join(f"{c} REAL" for c in _ex_cols(horizons))
    return f"""
        CREATE TABLE IF NOT EXISTS {ROWS_TABLE} (
            session INTEGER NOT NULL, signal TEXT NOT NULL, ticker TEXT NOT NULL, {cols},
            skip INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (session, signal, ticker)
        );
        CREATE TABLE IF NOT EXISTS {STAGE_TABLE} (
            session INTEGER NOT NULL, signal TEXT NOT NULL, ticker TEXT NOT NULL, {cols},
            skip INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (session, signal, ticker)
        );
        CREATE INDEX IF NOT EXISTS {ROWS_TABLE}_signal ON {ROWS_TABLE}(signal);
        CREATE TABLE IF NOT EXISTS {CHECKPOINT_TABLE} (
            session INTEGER NOT NULL, signal TEXT NOT NULL, status TEXT NOT NULL,
            rows INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL,
            PRIMARY KEY (session, signal)
        );"""


def ensure_schema(conn: sqlite3.Connection, horizons: Sequence[int] = HORIZONS) -> None:
    have = _meta(conn)
    if have and have.get("version") != str(SCHEMA_VERSION):
        # An older store: its derived tables carry the old columns. Rebuild them
        # before the CREATE IF NOT EXISTS below would keep the old shape.
        _check_meta(conn, horizons, rebuild=True)
    conn.executescript(f"""
        CREATE TABLE IF NOT EXISTS {META_TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        {_derived_tables_sql(horizons)}
        CREATE TABLE IF NOT EXISTS {RUNS_TABLE} (
            id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, receipt TEXT NOT NULL
        );
    """)
    _check_meta(conn, horizons, rebuild=True)
    conn.commit()


def _meta(conn: sqlite3.Connection) -> Dict[str, str]:
    try:
        return {k: v for k, v in conn.execute(f"SELECT key, value FROM {META_TABLE}")}
    except sqlite3.Error:
        return {}


def _check_meta(conn: sqlite3.Connection, horizons: Sequence[int], *, rebuild: bool) -> None:
    want = {"version": str(SCHEMA_VERSION), "horizons": json.dumps([int(h) for h in horizons])}
    have = _meta(conn)
    if have.get("version") == want["version"] and have.get("horizons") == want["horizons"]:
        return
    if not rebuild:
        raise StoreRefused(f"store meta {have or '{}'} does not match version {want['version']} "
                           f"horizons {want['horizons']}; open it for writing to rebuild")
    if have:
        conn.executescript(f"DROP TABLE IF EXISTS {ROWS_TABLE}; DROP TABLE IF EXISTS {CHECKPOINT_TABLE}; "
                           f"DROP TABLE IF EXISTS {STAGE_TABLE};")
        conn.executescript(_derived_tables_sql(horizons))
    conn.executemany(f"INSERT OR REPLACE INTO {META_TABLE}(key, value) VALUES (?, ?)", list(want.items()))
    conn.commit()


def checkpoints(conn: Optional[sqlite3.Connection]) -> Dict[Tuple[int, str], str]:
    """``{(session, signal): status}``; empty for a missing store."""
    if conn is None:
        return {}
    return {(int(s), str(k)): str(st) for s, k, st in
            conn.execute(f"SELECT session, signal, status FROM {CHECKPOINT_TABLE}")}


def unchecked_pairs(conn: Optional[sqlite3.Connection]) -> Set[Tuple[int, str]]:
    """``{(session, signal)}`` that have stored rows but no checkpoint - the
    leftovers of a run that died between writing rows and marking them (the
    clear-first run before 2026-11-07). Empty for a missing store."""
    if conn is None:
        return set()
    have = {(int(s), str(k)) for s, k in conn.execute(f"SELECT DISTINCT session, signal FROM {ROWS_TABLE}")}
    marked = {(int(s), str(k)) for s, k in conn.execute(f"SELECT session, signal FROM {CHECKPOINT_TABLE}")}
    return have - marked


def discard_stage(conn: sqlite3.Connection) -> None:
    """Empty the stage table: the first thing a writing run does, so the rows of
    a run that died never mix with this one's."""
    conn.execute(f"DELETE FROM {STAGE_TABLE}")
    conn.commit()


def swap_in(conn: sqlite3.Connection, marks: Dict[Tuple[int, str], Tuple[str, int]],
            horizons: Sequence[int] = HORIZONS) -> None:
    """Publish the staged run in ONE transaction: delete the old rows of every
    re-measured pair, move the staged rows in, write each pair's checkpoint
    (``marks`` is ``{(session, signal): (status, rows)}``), delete any row
    still without a checkpoint, and empty the stage. Nothing is committed until
    all of it has run, so an exception here leaves the store as it was."""
    names = ", ".join(["session", "signal", "ticker"] + _ex_cols(horizons) + ["skip"])
    ps = [(int(s), str(k)) for s, k in marks]
    try:
        conn.executemany(f"DELETE FROM {ROWS_TABLE} WHERE session = ? AND signal = ?", ps)
        conn.execute(f"INSERT OR REPLACE INTO {ROWS_TABLE}({names}) SELECT {names} FROM {STAGE_TABLE}")
        for (s, k), (status, n) in marks.items():
            mark(conn, s, k, status, n)
        orphans = sorted(unchecked_pairs(conn))
        conn.executemany(f"DELETE FROM {ROWS_TABLE} WHERE session = ? AND signal = ?", orphans)
        conn.execute(f"DELETE FROM {STAGE_TABLE}")
        conn.commit()
    except BaseException:
        conn.rollback()
        raise


def write_rows(conn: sqlite3.Connection, rows: Iterable[Row], horizons: Sequence[int] = HORIZONS, *,
               table: str = ROWS_TABLE) -> int:
    """Insert measurement rows into ``table`` (the published rows by default; the
    job writes to :data:`STAGE_TABLE`). A row whose excess is ``None`` is a split-
    guard row: stored with ``skip = 1`` and NULL excess, so it is counted but
    never measured."""
    if table not in (ROWS_TABLE, STAGE_TABLE):
        raise ValueError(f"write_rows writes {ROWS_TABLE} or {STAGE_TABLE}, not {table!r}")
    cols = _ex_cols(horizons)
    sql = (f"INSERT OR REPLACE INTO {table}(session, signal, ticker, {', '.join(cols)}, skip) "
           f"VALUES ({', '.join('?' for _ in range(4 + len(cols)))})")
    data = [(int(s), str(k), str(t))
            + tuple((ex[i] if i < len(ex) else None) if ex is not None else None for i in range(len(cols)))
            + (0 if ex is not None else 1,)
            for s, k, t, ex in rows]
    conn.executemany(sql, data)
    return len(data)


def mark(conn: sqlite3.Connection, session: int, signal: str, status: str, rows: int) -> None:
    conn.execute(f"INSERT OR REPLACE INTO {CHECKPOINT_TABLE}(session, signal, status, rows, at) "
                 f"VALUES (?, ?, ?, ?, ?)", (int(session), str(signal), status, int(rows), _now()))


def values(conn: sqlite3.Connection, signal: str, horizon: int) -> List[MaybeNum]:
    """One signal's excess at one horizon over the COUNTED rows (``skip = 0``)."""
    col = f"ex_{int(horizon)}"
    return [r[0] for r in conn.execute(f"SELECT {col} FROM {ROWS_TABLE} WHERE signal = ? AND skip = 0",
                                       (str(signal),))]


def complete_dates(conn: sqlite3.Connection, signal: str, horizon: int) -> int:
    """Distinct sessions holding a COUNTED row of ``signal`` whose window at
    ``horizon`` is complete (``ex_<h>`` not NULL): the sessions that horizon's
    statistic stands on (``measure.summarise``'s per-horizon ``dates``)."""
    col = f"ex_{int(horizon)}"
    return int(conn.execute(f"SELECT COUNT(DISTINCT session) FROM {ROWS_TABLE} WHERE signal = ? AND skip = 0 "
                            f"AND {col} IS NOT NULL", (str(signal),)).fetchone()[0] or 0)


def tickers_by_signal(conn: sqlite3.Connection, tickers: Iterable[str]) -> Dict[str, int]:
    """``{signal: distinct tickers}`` among ``tickers`` over the COUNTED rows,
    the baseline included: how many of a set of names (the run's unknown split
    lists) stand behind each signal's numbers."""
    names = sorted({str(t).upper() for t in tickers or ()})
    out: Dict[str, int] = {}
    for k in range(0, len(names), 500):                  # SQLite's parameter cap, with room
        chunk = names[k:k + 500]
        marks = ",".join("?" * len(chunk))
        for signal, n in conn.execute(
                f"SELECT signal, COUNT(DISTINCT ticker) FROM {ROWS_TABLE} WHERE skip = 0 AND ticker IN ({marks}) "
                f"GROUP BY signal", chunk):
            out[str(signal)] = out.get(str(signal), 0) + int(n)   # chunks hold disjoint tickers
    return out


def summary(conn: sqlite3.Connection, horizons: Sequence[int] = HORIZONS) -> dict:
    """The same shape as ``measure.summarise``, from the store."""
    hs = [int(h) for h in horizons]
    names = [r[0] for r in conn.execute(f"SELECT DISTINCT signal FROM {ROWS_TABLE} WHERE skip = 0 "
                                        f"ORDER BY signal")]
    per_signal = {}
    for name in names:
        if name == BASELINE_KEY:
            continue
        n_signals, dates, tickers = conn.execute(
            f"SELECT COUNT(*), COUNT(DISTINCT session), COUNT(DISTINCT ticker) FROM {ROWS_TABLE} "
            f"WHERE signal = ? AND skip = 0", (name,)).fetchone()
        per_signal[name] = {
            "n_signals": int(n_signals), "dates": int(dates), "tickers": int(tickers),
            "horizons": {str(h): {**summarise_values(values(conn, name, h)),
                                  "dates": complete_dates(conn, name, h)} for h in hs},
        }
    baseline = {str(h): summarise_values(values(conn, BASELINE_KEY, h)) for h in hs}
    rows = conn.execute(f"SELECT COUNT(*) FROM {ROWS_TABLE} WHERE signal = ? AND skip = 0",
                        (BASELINE_KEY,)).fetchone()[0]
    skipped = {str(k): int(n) for k, n in conn.execute(
        f"SELECT signal, COUNT(*) FROM {ROWS_TABLE} WHERE skip = 1 GROUP BY signal ORDER BY signal")}
    return {"per_signal": per_signal, "baseline": baseline, "rows": int(rows), "split_skipped": skipped}


def window(conn: sqlite3.Connection) -> dict:
    """``{from, to, sessions, sessions_open, universe}`` over the stored, counted
    baseline rows (``from``/``to`` are YYYYMMDD ints or ``None``)."""
    lo, hi, sessions, universe = conn.execute(
        f"SELECT MIN(session), MAX(session), COUNT(DISTINCT session), COUNT(DISTINCT ticker) "
        f"FROM {ROWS_TABLE} WHERE signal = ? AND skip = 0", (BASELINE_KEY,)).fetchone()
    open_n = conn.execute(
        f"SELECT COUNT(DISTINCT session) FROM {CHECKPOINT_TABLE} WHERE status = ?", (OPEN,)).fetchone()[0]
    return {"from": lo, "to": hi, "sessions": int(sessions or 0), "sessions_open": int(open_n or 0),
            "universe": int(universe or 0)}


def record_run(conn: sqlite3.Connection, receipt: dict) -> None:
    conn.execute(f"INSERT INTO {RUNS_TABLE}(at, receipt) VALUES (?, ?)",
                 (_now(), json.dumps(receipt, sort_keys=True, default=str)))
    conn.commit()
