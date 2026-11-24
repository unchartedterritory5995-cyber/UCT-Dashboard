"""IVH's local index of the options log's daily summary rows (speed pass 2, 2026-11-24).

WHY. Live (2026-11-23 23:05 ET) one IVH answer took 10 seconds. Besides the remote listing (now a background
refresh, `iv_history.R2Store.listing`), every answer opened EVERY day's summary file (`<date>.underlyings.csv.gz`,
about 6,000 rows), unzipped it and scanned it until it passed the symbol (`iv_history._day_row`), and the 4,096-entry
row cache held only about 20 symbols' histories. This index holds, for each day, the cells `iv_history._point` reads
(`atm_iv`, `atm_dte`, `atm_expiration`, `underlying_price`) for every underlying, in ONE SQLite file on this server's
local disk beside the mirrored log (`<store root>/FILE`), indexed by underlying: an answer is one indexed read.

THE SAME FIGURES. The cells are kept exactly as the file has them (text), and a day's rows are the rows
`_day_row` would find: the file is sorted by underlying and `_day_row` stops once it passes the symbol, so a row
is kept only when no EARLIER row's underlying sorts after it (`rows_of`), and only the first row of an underlying.
`iv_history.atm_iv` stays the one reader of the ATM IV cell. A day is used from the index ONLY while its file is the
very file that was indexed (its size and modification time, `days`); any other day (not indexed yet, replaced since,
damaged, or older than the newest `MAX_SESSIONS`) is read from its file exactly as before, so a missing or partial
index changes the speed and never the answer.

RACY FILES. A file written in the last `RACY_S` seconds is never indexed yet: a second write in the same clock tick
with the same size would carry the same stamp, so it is left to the next pass (a build makes up to `PASSES` passes,
`RACY_S` apart).

ONE BUILD, OFF THE REQUEST. `Index.kick()` starts ONE background thread (`BUILD_THREAD`) when none runs; a request
never waits for it. The file is created by the build, never by a reader. A file this process has not checked is
checked once (`PRAGMA quick_check` and the schema version); a damaged or older one is deleted and rebuilt.

SIZE (measured on invented data, `tests/test_terminal_speed_pass2.py`): about 0.3 MB of disk per session at the
log's real width (6,000 underlyings), so the `MAX_SESSIONS` bound is about 150 MB of disk at most (two years of
sessions; the log began 2026-09-30, about 12 MB today); nothing of it is kept in memory beyond one answer's rows.
"""
from __future__ import annotations

import csv
import gzip
import logging
import os
import re
import sqlite3
import threading
import time
import zlib
from collections import OrderedDict
from typing import Optional

_log = logging.getLogger(__name__)

FILE = "iv_history_index_v1.sqlite"
SCHEMA_VERSION = 1
#: The newest sessions indexed (two years); an older day is read from its file, exactly as before.
MAX_SESSIONS = 504
#: A summary file younger than this is not indexed yet (see RACY FILES).
RACY_S = 2.0
#: Passes one build makes while racy files remain, `RACY_S` apart.
PASSES = 3
BUILD_THREAD = "iv-history-index"
#: The cells kept per row, in the order they are stored: the ones `iv_history._point` reads.
CELLS = ("atm_iv", "atm_dte", "atm_expiration", "underlying_price")
_SUMMARY = re.compile(r"^(\d{4}-\d{2}-\d{2})\.underlyings\.csv\.gz$")
_SCHEMA = (
    "CREATE TABLE IF NOT EXISTS days (session INTEGER PRIMARY KEY, size INTEGER NOT NULL, "
    "mtime_ns INTEGER NOT NULL, rule TEXT NOT NULL) WITHOUT ROWID",
    "CREATE TABLE IF NOT EXISTS rows (underlying TEXT NOT NULL, session INTEGER NOT NULL, atm_iv TEXT, "
    "atm_dte TEXT, atm_expiration TEXT, underlying_price TEXT, PRIMARY KEY (underlying, session)) WITHOUT ROWID",
)


def _day_int(session: str) -> int:
    return int(session.replace("-", ""))


def _day_iso(v: int) -> str:
    return f"{v // 10000:04d}-{v // 100 % 100:02d}-{v % 100:02d}"


def rows_of(path: str) -> tuple[str, dict]:
    """`(rule, {underlying: cells})` of one summary file: for each underlying, the row `iv_history._day_row` finds
    for it (see THE SAME FIGURES). Raises on a file that cannot be read to its end."""
    from api.services.research.iv_history import summary_rule
    out: dict = {}
    top = None
    with gzip.open(path, "rt", newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        rule = summary_rule(reader.fieldnames)
        for r in reader:
            u = r.get("underlying") or ""
            if u and u not in out and (top is None or top <= u):
                out[u] = tuple(r.get(c) for c in CELLS)
            if top is None or u > top:
                top = u
    return rule, out


def summary_files(root: str) -> dict:
    """{session: path} of every summary file under `<root>/options_log/`, read from the directory alone."""
    out = {}
    base = os.path.join(root, "options_log")
    if not os.path.isdir(base):
        return out
    for year in os.listdir(base):
        ydir = os.path.join(base, year)
        if not os.path.isdir(ydir):
            continue
        for name in os.listdir(ydir):
            m = _SUMMARY.match(name)
            if m:
                out[m.group(1)] = os.path.join(ydir, name)
    return out


class Index:
    """The index for one store root (see the module docstring)."""

    def __init__(self, root: str):
        self.root = root
        self.path = os.path.join(root, FILE)
        self._lock = threading.Lock()            # guards the state below
        self._build_lock = threading.Lock()      # one build at a time
        self._running: Optional[threading.Event] = None
        self._checked = False                    # this process has checked the file once
        self._unreadable: dict = {}              # session -> (size, mtime_ns) of a file that would not read
        self.builds = 0                          # builds started (tests)

    # ── the read a request makes ─────────────────────────────────────────────────────────────

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=5.0, isolation_level=None, check_same_thread=False)
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    def lookup(self, sym: str) -> Optional[tuple[dict, dict]]:
        """`({session: (size, mtime_ns, rule)}, {session: cells})` for one underlying, from ONE consistent read, or
        None when there is no index file yet or it cannot be read (the caller reads the files, as before). Never
        creates the file and never writes."""
        if not os.path.exists(self.path):
            return None
        try:
            conn = self._connect()
            try:
                conn.execute("PRAGMA query_only=1")
                conn.execute("BEGIN")
                days = {_day_iso(s): (size, mtime, rule)
                        for s, size, mtime, rule in conn.execute("SELECT session, size, mtime_ns, rule FROM days")}
                rows = {_day_iso(r[0]): r[1:] for r in conn.execute(
                    "SELECT session, atm_iv, atm_dte, atm_expiration, underlying_price FROM rows WHERE underlying=?",
                    (sym,))}
                conn.execute("COMMIT")
            finally:
                conn.close()
        except sqlite3.Error as exc:
            _log.warning("[iv-history-index] the index could not be read (%s); reading the files", type(exc).__name__)
            with self._lock:
                self._checked = False                # the next build checks it, and rebuilds it if it is damaged
            return None
        return days, rows

    # ── the one build ────────────────────────────────────────────────────────────────────────

    def kick(self) -> bool:
        """Start ONE background build when none runs. True when this call started it. Never waits."""
        with self._lock:
            if self._running is not None:
                return False
            done = self._running = threading.Event()
            self.builds += 1
        threading.Thread(target=self._build_bg, args=(done,), name=BUILD_THREAD, daemon=True).start()
        return True

    def drain(self, timeout: float = 10.0) -> None:
        """Tests: wait for the build in flight, if any."""
        with self._lock:
            done = self._running
        if done is not None:
            done.wait(timeout)

    def _build_bg(self, done: threading.Event) -> None:
        started = time.time()
        try:
            with self._build_lock:
                indexed = 0
                for n in range(PASSES):
                    added, racy = self.build_once()
                    indexed += added
                    if not racy or n == PASSES - 1:
                        break
                    time.sleep(RACY_S)
            if indexed:
                _log.info("[iv-history-index] %d session(s) indexed under %s; %.1fs", indexed, self.root,
                          time.time() - started)
        except Exception as exc:  # noqa: BLE001 -- the answers read the files meanwhile; the next request tries again
            _log.warning("[iv-history-index] the build failed (%s); %.1fs", type(exc).__name__, time.time() - started)
        finally:
            with self._lock:
                if self._running is done:
                    self._running = None
            done.set()

    def _discard(self) -> None:
        for suffix in ("", "-wal", "-shm", "-journal"):
            try:
                os.remove(self.path + suffix)
            except OSError:
                pass

    def _open_for_build(self) -> sqlite3.Connection:
        """The index, created when missing; checked once per process, and deleted and created again when it is
        damaged or of another schema version."""
        with self._lock:
            check = not self._checked
        if os.path.exists(self.path) and check:
            ok = False
            try:
                conn = self._connect()
                try:
                    ok = (conn.execute("PRAGMA quick_check").fetchone() or [None])[0] == "ok" and \
                        conn.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
                finally:
                    conn.close()
            except sqlite3.Error:
                ok = False
            if not ok:
                _log.warning("[iv-history-index] %s is damaged or of another version; building it again", self.path)
                self._discard()
        os.makedirs(self.root, exist_ok=True)
        conn = self._connect()
        conn.execute("PRAGMA journal_mode=WAL")
        for stmt in _SCHEMA:
            conn.execute(stmt)
        conn.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
        with self._lock:
            self._checked = True
        return conn

    def build_once(self) -> tuple[int, int]:
        """One pass: index every summary file among the newest MAX_SESSIONS that is not indexed as it is now; forget
        days whose file is gone or no longer among them. Returns `(indexed, racy files left for a later pass)`."""
        files = summary_files(self.root)
        wanted = dict(sorted(files.items())[-MAX_SESSIONS:])
        conn = self._open_for_build()
        added = racy = 0
        try:
            have = {_day_iso(s): (size, mtime) for s, size, mtime in conn.execute("SELECT session, size, mtime_ns FROM days")}
            for d in sorted(set(have) - set(wanted)):
                conn.execute("BEGIN")
                conn.execute("DELETE FROM rows WHERE session=?", (_day_int(d),))
                conn.execute("DELETE FROM days WHERE session=?", (_day_int(d),))
                conn.execute("COMMIT")
            for d in sorted(wanted, reverse=True):
                path = wanted[d]
                try:
                    st = os.stat(path)
                except OSError:
                    continue
                stamp = (st.st_size, st.st_mtime_ns)
                if have.get(d) == stamp:
                    continue
                if time.time() - st.st_mtime_ns / 1e9 < RACY_S:
                    racy += 1
                    continue
                with self._lock:
                    bad = self._unreadable.get(d) == stamp
                if bad:
                    continue
                try:
                    rule, rows = rows_of(path)
                except (OSError, EOFError, zlib.error, csv.Error, UnicodeDecodeError, ValueError):
                    with self._lock:
                        self._unreadable[d] = stamp      # read from its file on each answer, as before
                    conn.execute("BEGIN")
                    conn.execute("DELETE FROM rows WHERE session=?", (_day_int(d),))
                    conn.execute("DELETE FROM days WHERE session=?", (_day_int(d),))
                    conn.execute("COMMIT")
                    continue
                try:
                    again = os.stat(path)
                except OSError:
                    continue
                if (again.st_size, again.st_mtime_ns) != stamp:
                    racy += 1                            # replaced while it was read: the next pass
                    continue
                day = _day_int(d)
                conn.execute("BEGIN")
                conn.execute("DELETE FROM rows WHERE session=?", (day,))
                conn.executemany("INSERT INTO rows (underlying, session, atm_iv, atm_dte, atm_expiration, "
                                 "underlying_price) VALUES (?, ?, ?, ?, ?, ?)",
                                 ((u, day, *cells) for u, cells in rows.items()))
                conn.execute("INSERT OR REPLACE INTO days (session, size, mtime_ns, rule) VALUES (?, ?, ?, ?)",
                             (day, stamp[0], stamp[1], rule))
                conn.execute("COMMIT")
                added += 1
        finally:
            conn.close()
        return added, racy


_INDEXES: "OrderedDict[str, Index]" = OrderedDict()
_INDEXES_MAX = 8
_registry_lock = threading.Lock()


def for_root(root: str) -> Index:
    """The one Index object for a store root (a few at most: the production mirror, and tests' seeded roots)."""
    key = os.path.abspath(root)
    with _registry_lock:
        idx = _INDEXES.get(key)
        if idx is None:
            idx = _INDEXES[key] = Index(key)
            while len(_INDEXES) > _INDEXES_MAX:
                _INDEXES.popitem(last=False)
        else:
            _INDEXES.move_to_end(key)
        return idx
