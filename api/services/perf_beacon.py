"""Real-user speed measurement (desktop speed plan Step 10.1, owner OK 2026-11-11).

Every page load in a browser or the desktop app may send ONE small report
(`app/src/lib/perfBeacon.js`): how long the page took to become usable and how
long each `/api/*` call took, measured by the member's own browser. This is the
instrument that tells us which pages are slow for which members, so speed work
is aimed at what members actually feel instead of at the owner's PC.

NUMBERS AND ENUMS ONLY, so there is nothing to scrub
----------------------------------------------------
A field is either a whole number of milliseconds in a sane range, a member of a
fixed set, or matches a short anchored pattern of lowercase words. Anything else
REFUSES the report (counted `invalid`), never cleans it:

  * `page`     `/` + the first path segment only (`/charts`, `/options-flow`);
               never a ticker, id or query string
  * `client`   `browser` or `desktop`
  * timings    `ttfb`, `fcp`, `lcp`, `dom_ready`, `load`, `long_task_ms`
               (0..MAX_MS), `long_tasks` (count)
  * `api`      up to MAX_API entries of `{route, ms, ok}`: `route` is
               `/api/<word>` or `/api/<word>/<word>` where a word is lowercase
               letters, digits after the first letter, `-` or `_` in the first
               segment and letters and `-` only in the second (no digits, so no
               ids); `ms` 0..MAX_MS; `ok` true/false
  * country    from Cloudflare's `CF-IPCountry` header (two letters), never from
               the body; nothing finer than a country is stored

No member id, no IP, no URL ever reaches a row, and NOTHING DERIVED FROM AN IP IS
KEPT PAST ITS USE OR UNDER A KEY ANYONE ELSE CAN HOLD. The quotas need "the same
sender again within the hour": an HMAC of the IP under a random key that exists
only in this process's memory for that clock hour (`_key`), in a quota table of
its own whose rows are deleted once an hour old. A page-load row holds no key.

(Until 2026-11-24 it did: `perf_loads.rate_key` was a SHA-256 of the IP under a
constant in this public repo, kept 30 days, so anyone holding a copy of the
store could recompute every row over all of IPv4. `migrate()` blanks every one
at startup and rebuilds the file so they leave its pages too. Copies of the
store made BEFORE that still hold them: delete old backups.)

Chart-switch speed: the second kind of report (2026-11-23)
----------------------------------------------------------
The goal is "key press to the charts drawn in under 40 ms for every member", and
nothing measured it outside a test rig. The page now counts it
(`app/src/lib/switchSpeed.js`) and sends the COUNTS when it is hidden or left:
`{page, client, kind: "switches", switches: {v, cells, counters}}`, where

  * `cells`     up to MAX_SWITCH_CELLS lists of exactly 16 whole numbers: five
                indexes (timeframe class, device store on, trigger, route, inside
                the regular session: SWITCH_TF / 0-1 / SWITCH_TRIGGER /
                SWITCH_ROUTE / 0-1) and one count per time bucket
                (SWITCH_BUCKET_EDGES_MS: 0-16, 16-25, 25-33, 33-40, 40-50 ... 500+)
  * `counters`  one whole number per SWITCH_COUNTERS: switches that gave no
                sample, by why

INTEGERS ONLY. No ticker, no list, nothing typed: there is no field a string
could sit in. An unknown key, a string, a fraction, a count over
MAX_SWITCH_COUNT, more than MAX_SWITCH_TOTAL switches in all, an index outside
its list, a cell twice or too many cells REFUSES the whole report. The lists
here are the page's own, pinned equal by tests/test_perf_beacon.py.

The door is anonymous, so a sender can invent counts. What bounds one sender's
weight in a pooled share: SWITCH_RATE_LIMIT reports an hour holding no more than
SWITCH_TOTAL_PER_HOUR switches together (about twice what a real page can make;
a report that would pass it is dropped whole). And what shows it: `senders`,
the DISTINCT senders that added to a cell that day. One sender behind most of a
cell is one page, not the membership. `reports` / `reports_all_under` count
each report once whatever it claims.

To count distinct senders, `perf_switch_senders` keeps one row per day, cell and
sender. The sender is an HMAC of the IP under a random key that exists ONLY IN
THIS PROCESS'S MEMORY and only for that ET day (`_key`): never on disk, in the
repo or in the environment. Someone holding a copy of the file cannot recompute
a row from an address, and once the day is over nobody can, the server included.
A restart mid-day makes a new key, and so does a second server process, so a
returning sender is counted again that day: `senders` is exact within one
process between restarts, and an upper bound across restarts and processes.
The quotas are per process in the same way (the admin read's legend says both).
Rows of an earlier day are deleted (see "What is deleted, and when"); the count
stays in `perf_switch_days.senders`.

What is kept is a MERGE, never a report: per ET day, client and combination, the
summed counts, how many reports added to them and in how many of those every
switch was under 40 ms (`perf_switch_days`), and the summed counters
(`perf_switch_counters`). Nothing per page load, per member or per switch
exists to be read back. `perf_switch_sends` holds a time and the salted hash for
one hour, only to count the quota (SWITCH_RATE_LIMIT).

What is deleted, and when
-------------------------
Quota rows once an hour old; a day's sender rows once that ET day is over.
Three things do it, so it does not wait for a report to arrive: every write,
the admin read (`switch_summary`), and a timer (`startup`: one daemon thread per
process, every HOUSEKEEP_EVERY_S). A quiet weekend does not keep Friday's rows.

Storage and bounds
------------------
Own SQLite file `PERF_BEACON_DB_PATH` (default `<DATA_DIR>/perf_beacon.db`,
read at call time). Rows kept RETENTION_DAYS, pruned on write at most hourly;
loads hard-capped at MAX_LOADS (oldest deleted in the same transaction). The
switch days are kept SWITCH_RETENTION_DAYS (at most one row per day, client and
combination, so they are bounded by the calendar).

Kill switch
-----------
`PERF_BEACON_ENABLED`: unset or anything but `0/false/no/off` means ON. OFF
answers `{enabled: false}` (the page stops sending) and never deletes a row.
"""
from __future__ import annotations

import hashlib
import hmac
import math
import os
import re
import secrets
import shutil
import sqlite3
import tempfile
import threading
import time
from contextlib import contextmanager
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from api.services import bg_lane

KILL_SWITCH = "PERF_BEACON_ENABLED"
_OFF_VALUES = frozenset({"0", "false", "no", "off"})

CLIENTS = frozenset({"browser", "desktop"})
# `candles` = when the page's first chart had its bars (the `uct:first-chart-paint` mark); absent on
# pages without a chart. Added after the first deploy: `_connect` adds the column to an older store.
TIMINGS = ("ttfb", "fcp", "lcp", "dom_ready", "load", "long_task_ms", "candles")
MAX_MS = 120_000
MAX_LONG_TASKS = 10_000
MAX_API = 40
MAX_BODY_BYTES = 8 * 1024
RATE_LIMIT = 60                # loads per IP hash per hour
GLOBAL_LIMIT_PER_HOUR = 50_000
MAX_LOADS = 300_000
RETENTION_DAYS = 30
PRUNE_EVERY_S = 3600

# -- chart-switch speed (the module docstring says what each is; app/src/lib/switchSpeed.js holds the same lists) --
KINDS = frozenset({"load", "switches"})
SWITCH_VERSION = 1
SWITCH_TF = ("intraday-1m", "intraday-other", "daily-plus")
SWITCH_TRIGGER = ("list-key", "click", "typed", "other")
SWITCH_ROUTE = ("other", "decision", "now", "deferred", "daily-hold", "prepare")
SWITCH_BUCKET_EDGES_MS = (16, 25, 33, 40, 50, 66, 100, 150, 250, 500)
SWITCH_UNDER_MS = 40
SWITCH_COUNTERS = ("superseded", "abandoned", "unpressed", "untracked", "unclocked", "overflow", "released")
MAX_SWITCH_CELLS = 64
MAX_SWITCH_COUNT = 100_000
MAX_SWITCH_TOTAL = 6_000       # every count of one report together: more than a page can make between two sends
SWITCH_RATE_LIMIT = 30         # switch reports per IP hash per hour (the page sends at most one per 5 minutes)
# ...and the SWITCHES those reports may hold together, per IP hash per hour: about twice what a real page can make
# (one every 1.2 s is 3,000 an hour). Never under MAX_SWITCH_TOTAL, so a legal report alone is never over it.
SWITCH_TOTAL_PER_HOUR = MAX_SWITCH_TOTAL
SWITCH_RETENTION_DAYS = 90
_SWITCH_DIMS = (len(SWITCH_TF), 2, len(SWITCH_TRIGGER), len(SWITCH_ROUTE), 2)
_SWITCH_NB = len(SWITCH_BUCKET_EDGES_MS) + 1
_SWITCH_UNDER = SWITCH_BUCKET_EDGES_MS.index(SWITCH_UNDER_MS) + 1   # the buckets wholly under SWITCH_UNDER_MS
_SWITCH_B = tuple(f"b{i}" for i in range(_SWITCH_NB))
_SWITCH_KEY = ("day", "client", "tf", "dev_store", "trig", "route", "rth")
_ET = ZoneInfo("America/New_York")

_PAGE_RE = re.compile(r"/[a-z0-9-]{0,40}")
_API_RE = re.compile(r"/api/[a-z][a-z0-9_-]{0,40}(?:/[a-z][a-z-]{0,40})?")
_COUNTRY_RE = re.compile(r"[A-Z]{2}")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS perf_loads (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at   REAL NOT NULL,
    page         TEXT NOT NULL,
    client       TEXT NOT NULL,
    country      TEXT NOT NULL DEFAULT '',
    ttfb         INTEGER, fcp INTEGER, lcp INTEGER, dom_ready INTEGER, load INTEGER,
    long_task_ms INTEGER, long_tasks INTEGER, candles INTEGER,
    rate_key     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_perf_loads_created ON perf_loads(created_at);
CREATE TABLE IF NOT EXISTS perf_load_sends (
    created_at REAL NOT NULL,
    rate_key   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_perf_load_sends ON perf_load_sends(rate_key, created_at);
CREATE TABLE IF NOT EXISTS perf_api (
    load_id  INTEGER NOT NULL REFERENCES perf_loads(id) ON DELETE CASCADE,
    route    TEXT NOT NULL,
    ms       INTEGER NOT NULL,
    ok       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_perf_api_load ON perf_api(load_id);
""" + f"""
CREATE TABLE IF NOT EXISTS perf_switch_days (
    day        TEXT NOT NULL,
    client     TEXT NOT NULL,
    tf         INTEGER NOT NULL,
    dev_store  INTEGER NOT NULL,
    trig       INTEGER NOT NULL,
    route      INTEGER NOT NULL,
    rth        INTEGER NOT NULL,
    {", ".join(f"{b} INTEGER NOT NULL" for b in _SWITCH_B)},
    reports    INTEGER NOT NULL,
    reports_all_under INTEGER NOT NULL,
    senders    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY ({", ".join(_SWITCH_KEY)})
);
CREATE TABLE IF NOT EXISTS perf_switch_senders (
    day        TEXT NOT NULL,
    client     TEXT NOT NULL,
    tf         INTEGER NOT NULL,
    dev_store  INTEGER NOT NULL,
    trig       INTEGER NOT NULL,
    route      INTEGER NOT NULL,
    rth        INTEGER NOT NULL,
    sender     TEXT NOT NULL,
    PRIMARY KEY ({", ".join(_SWITCH_KEY)}, sender)
);
CREATE TABLE IF NOT EXISTS perf_switch_counters (
    day     TEXT NOT NULL,
    client  TEXT NOT NULL,
    name    TEXT NOT NULL,
    n       INTEGER NOT NULL,
    PRIMARY KEY (day, client, name)
);
CREATE TABLE IF NOT EXISTS perf_switch_sends (
    created_at REAL NOT NULL,
    rate_key   TEXT NOT NULL,
    switches   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_perf_switch_sends ON perf_switch_sends(rate_key, created_at);
"""

_lock = threading.Lock()
_last_prune = 0.0

# Set while the one-time rebuild has the store (`migrate`). ⛔ A REPORT THAT ARRIVES MEANWHILE IS DROPPED, NEVER PARKED
# ON `_lock`: every beacon POST runs in the app's shared threadpool (run_in_threadpool), and a worker waiting out a
# rebuild is a worker every other sync route has lost. After a deploy the reloading pages send their reports together.
_migrating = threading.Event()


@contextmanager
def _report_lock():
    """`with _report_lock() as held:` the store's lock for one report (`held` True), or `held` False AT ONCE when the
    one-time rebuild has the store or is asking for it. Reports still wait for each other, in 50 ms slices, so a
    waiting one sees the rebuild start and gives way."""
    held = False
    while not _migrating.is_set():
        if _lock.acquire(timeout=0.05):
            held = True
            break
    if held and _migrating.is_set():
        _lock.release()
        held = False
    try:
        yield held
    finally:
        if held:
            _lock.release()

# -- the keys: random, held in MEMORY only, one per period, forgotten when the period's use is over --
# ⛔ NEVER a constant, an env var or a file. What a key protects is "the same sender again" (a function of the IP);
# with the key in the repo or beside the store, anyone holding a copy of the store recomputes every row over all of
# IPv4 in minutes. A restart forgets them all, which costs only what the callers say it costs.
_keys: dict[tuple[str, Any], bytes] = {}
_keys_lock = threading.Lock()


def _key(kind: str, period: Any) -> bytes:
    """The key of (kind, period), made on first use: ('day', '2026-11-18'), ('hour', <hours since the epoch>)."""
    with _keys_lock:
        k = _keys.get((kind, period))
        if k is None:
            k = _keys[(kind, period)] = secrets.token_bytes(32)
        return k


def _forget_keys(now: float) -> None:
    """Drop every key whose use is over: a day's at the ET day change; an hour's once the NEXT hour is over too (the
    hourly quota looks back one hour, so it needs the hour before)."""
    hour, day = int(now // 3600), switch_day(now)
    with _keys_lock:
        for kind, period in list(_keys):
            if (kind == "day" and period != day) or (kind == "hour" and period < hour - 1):
                del _keys[(kind, period)]


def _mac(key: bytes, ip: str | None, n: int) -> str:
    return hmac.new(key, (ip or "unknown").encode(), hashlib.sha256).hexdigest()[:n]
_migrated: set[str] = set()  # store paths already checked for columns added after the first deploy


def enabled() -> bool:
    return (os.environ.get(KILL_SWITCH) or "").strip().lower() not in _OFF_VALUES


def _db_path() -> str:
    explicit = os.environ.get("PERF_BEACON_DB_PATH")
    if explicit:
        return explicit
    return os.path.join(os.environ.get("DATA_DIR") or "/data", "perf_beacon.db")


def _connect() -> sqlite3.Connection:
    path = _db_path()
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    conn = sqlite3.connect(path, timeout=2.0)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=2000")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA secure_delete=ON")       # a deleted quota or sender row is zeroed in its page, not just unlinked
    conn.executescript(_SCHEMA)
    if path not in _migrated:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(perf_loads)")}
        if "candles" not in cols:
            conn.execute("ALTER TABLE perf_loads ADD COLUMN candles INTEGER")
        _migrated.add(path)
    return conn


def _ms(v: Any, cap: int = MAX_MS) -> int | None:
    """A whole number of ms in range, None when absent; raises ValueError on anything else."""
    if v is None:
        return None
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise ValueError("not a number")
    if v < 0 or v > cap:
        raise ValueError("out of range")
    return int(round(v))


def validate(report: Any) -> dict[str, Any]:
    """The stored shape, or ValueError. Pure: no I/O."""
    if not isinstance(report, dict):
        raise ValueError("not an object")
    page = report.get("page")
    if not isinstance(page, str) or not _PAGE_RE.fullmatch(page):
        raise ValueError("page")
    client = report.get("client")
    if client not in CLIENTS:
        raise ValueError("client")
    out: dict[str, Any] = {"page": page, "client": client}
    for k in TIMINGS:
        out[k] = _ms(report.get(k))
    out["long_tasks"] = _ms(report.get("long_tasks"), MAX_LONG_TASKS)
    api = report.get("api") or []
    if not isinstance(api, list) or len(api) > MAX_API:
        raise ValueError("api")
    calls = []
    for a in api:
        if not isinstance(a, dict):
            raise ValueError("api entry")
        route = a.get("route")
        if not isinstance(route, str) or not _API_RE.fullmatch(route):
            raise ValueError("api route")
        ms = _ms(a.get("ms"))
        if ms is None or not isinstance(a.get("ok"), bool):
            raise ValueError("api entry")
        calls.append((route, ms, 1 if a["ok"] else 0))
    out["api"] = calls
    return out


def _whole(v: Any, cap: int) -> int:
    """A whole number 0..cap exactly as JSON carried it (never a bool, a fraction or a string), or ValueError."""
    if type(v) is not int or v < 0 or v > cap:
        raise ValueError("not a whole number in range")
    return v


def validate_switches(sw: Any) -> dict[str, Any]:
    """The `switches` field as {'cells': [(key, counts)], 'counters': [...]}, or ValueError. Pure: no I/O.
    Exactly the keys v / cells / counters, and whole numbers in range everywhere: there is nothing to clean."""
    if not isinstance(sw, dict) or set(sw) != {"v", "cells", "counters"}:
        raise ValueError("switches keys")
    if type(sw["v"]) is not int or sw["v"] != SWITCH_VERSION:
        raise ValueError("switches version")
    cells, counters = sw["cells"], sw["counters"]
    if not isinstance(cells, list) or len(cells) > MAX_SWITCH_CELLS:
        raise ValueError("switches cells")
    if not isinstance(counters, list) or len(counters) != len(SWITCH_COUNTERS):
        raise ValueError("switches counters")
    out, seen = [], set()
    for c in cells:
        if not isinstance(c, list) or len(c) != len(_SWITCH_DIMS) + _SWITCH_NB:
            raise ValueError("switch cell")
        key = tuple(_whole(v, size - 1) for v, size in zip(c, _SWITCH_DIMS))
        counts = [_whole(v, MAX_SWITCH_COUNT) for v in c[len(_SWITCH_DIMS):]]
        if key in seen or not any(counts):
            raise ValueError("switch cell twice or empty")
        seen.add(key)
        out.append((key, counts))
    if sum(sum(counts) for _, counts in out) > MAX_SWITCH_TOTAL:
        raise ValueError("switches total")
    totals = [_whole(v, MAX_SWITCH_COUNT) for v in counters]
    if not out and not any(totals):
        raise ValueError("switches empty")
    return {"cells": out, "counters": totals}


def validate_switch_report(report: Any) -> dict[str, Any]:
    """A `kind: "switches"` report, or ValueError: page, client, kind and switches, and nothing else."""
    if not isinstance(report, dict) or set(report) != {"page", "client", "kind", "switches"}:
        raise ValueError("switch report keys")
    page = report["page"]
    if not isinstance(page, str) or not _PAGE_RE.fullmatch(page):
        raise ValueError("page")
    client = report["client"]
    if not isinstance(client, str) or client not in CLIENTS:
        raise ValueError("client")
    return {"client": client, **validate_switches(report["switches"])}


def report_kind(report: Any) -> str:
    """'load' (no `kind`: every page-load report) or 'switches'; ValueError for anything else."""
    if not isinstance(report, dict):
        raise ValueError("not an object")
    kind = report.get("kind", "load")
    if not isinstance(kind, str) or kind not in KINDS:
        raise ValueError("kind")
    return kind


def switch_day(now: float) -> str:
    """The ET calendar day a report is merged under (when it ARRIVED: a session's switches land on its day)."""
    return datetime.fromtimestamp(now, _ET).strftime("%Y-%m-%d")


def country_from(header: str | None) -> str:
    v = (header or "").strip().upper()
    return v if _COUNTRY_RE.fullmatch(v) else ""


def _rate_keys(ip: str | None, now: float) -> tuple[str, str]:
    """A sender for the hourly quotas: (under this clock hour's key, under the hour before's). New rows are written
    under the first; a count looks for both, so the quota holds over any 60 minutes, across the clock hour too. After a
    restart the keys are new and the quota starts again: a sender may send up to its limit once more that hour."""
    hour = int(now // 3600)
    return _mac(_key("hour", hour), ip, 24), _mac(_key("hour", hour - 1), ip, 24)


def _sender_key(ip: str | None, day: str) -> str:
    """A sender, for ONE ET day's distinct count: an HMAC under that day's in-memory key. It joins nothing across days,
    and nothing at all once the key is forgotten."""
    return _mac(_key("day", day), ip, 16)


def _delete_outlived(conn: sqlite3.Connection, now: float) -> dict[str, int]:
    """Delete every row whose use is over: quota rows an hour old, sender rows of an earlier ET day (their counts stay
    in the day's row). How many of each."""
    return {
        "load_sends": conn.execute("DELETE FROM perf_load_sends WHERE created_at <= ?", (now - 3600,)).rowcount,
        "switch_sends": conn.execute("DELETE FROM perf_switch_sends WHERE created_at <= ?", (now - 3600,)).rowcount,
        "senders": conn.execute("DELETE FROM perf_switch_senders WHERE day < ?", (switch_day(now),)).rowcount,
    }


def _prune(conn: sqlite3.Connection, now: float) -> None:
    conn.execute("DELETE FROM perf_loads WHERE created_at < ?", (now - RETENTION_DAYS * 86400,))
    first = switch_day(now - SWITCH_RETENTION_DAYS * 86400)
    conn.execute("DELETE FROM perf_switch_days WHERE day < ?", (first,))
    conn.execute("DELETE FROM perf_switch_counters WHERE day < ?", (first,))
    _delete_outlived(conn, now)


def housekeep(now: float | None = None) -> dict[str, int]:
    """Delete what has outlived its use and forget the keys of past periods, whether or not a report arrives. Called by
    the admin read and by the timer (`startup`). No store yet: nothing to do, and none is made."""
    now = time.time() if now is None else now
    _forget_keys(now)
    # (while the one-time rebuild has the store this does not wait for it either: the next beat deletes)
    if _migrating.is_set() or not os.path.exists(_db_path()):
        return {"load_sends": 0, "switch_sends": 0, "senders": 0}
    with _lock:
        conn = _connect()
        try:
            with conn:
                return _delete_outlived(conn, now)
        finally:
            conn.close()


HOUSEKEEP_EVERY_S = 600
#: Set to "1" and `startup()` starts nothing. The root conftest sets it for every pytest process: a test that runs the
#: real lifespan must not leave a thread that deletes from, blanks or rebuilds whatever store the environment points at.
HOUSEKEEPING_SWITCH = "PERF_BEACON_HOUSEKEEPING_DISABLED"
_housekeeper: threading.Thread | None = None
_housekeeper_stop = threading.Event()
_boot_done = threading.Event()       # set once the thread's start-of-process work is done


#: The background lane's name for the one-time rebuild (api/services/bg_lane.py: after the boot settles, one sweep at a time).
LANE = "perf-beacon-migrate"
#: A rebuild writes a whole copy of the store to the temp directory and then through the write-ahead log on the store's
#: own volume: about twice the file at its peak. It is not started with less than this many times the file free in
#: BOTH places (this volume has filled before).
REBUILD_FREE_FACTOR = 3
_OLDER_INDEX = "ix_perf_loads_rate"


def _free_bytes(directory: str) -> int:
    return shutil.disk_usage(directory).free


def _room_to_rebuild(path: str) -> tuple[bool, int, int]:
    """(is there room, the store's bytes, the least free bytes of the two places a rebuild writes)."""
    size = sum(os.path.getsize(p) for p in (path, path + "-wal") if os.path.exists(p))
    free = min(_free_bytes(os.path.dirname(path) or "."), _free_bytes(tempfile.gettempdir()))
    return free >= REBUILD_FREE_FACTOR * size, size, free


def _rebuild(conn: sqlite3.Connection) -> None:
    """Rewrite the whole file and empty its write-ahead log, so nothing an older build left in its pages survives."""
    conn.execute("VACUUM")
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")


def _has_older_index(conn: sqlite3.Connection) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?", (_OLDER_INDEX,)).fetchone() is not None


def rebuild_pending() -> bool:
    """Is this a store an older build wrote that has NOT yet been rebuilt? (Its marker, the older build's index, is
    still there.) False when there is no store."""
    path = _db_path()
    if not os.path.exists(path):
        return False
    conn = sqlite3.connect(path, timeout=2.0)
    try:
        return _has_older_index(conn)
    finally:
        conn.close()


def migrate() -> int:
    """Blank every `perf_loads.rate_key` an older build stored (a SHA-256 of the IP under a constant in the public repo,
    kept 30 days), then REBUILD the file so the old values leave its pages and its write-ahead log, not only its rows.
    Idempotent: a second run finds nothing. Returns how many rows it blanked; no store, nothing to do.

    Two steps, on purpose:
      1. THE BLANKING, at once and whatever becomes of step 2: one UPDATE.
      2. THE REBUILD, only when it is safe, and again at every start until it has SUCCEEDED. What says "not yet" is
         the older build's index: it is dropped only after the rebuild, never with the blanking (it holds no key once
         the rows are blank). No room on the disk (`_room_to_rebuild`), or the rebuild failing: it stays, and the next
         start tries again.
    ⛔ THE REBUILD DOES NOT DEPEND ON A ROW BEING BLANKED. An older build pruned rows (30-day retention, the row ceiling)
    without zeroing them, so their keys sit in the file's FREE space with no row holding them; a store whose keyed rows
    were all pruned has nothing to blank and everything to rebuild.
    ⛔ NOBODY WAITS FOR IT. While it runs, a report is dropped (`_report_lock`) and the housekeeping beat skips: the
    lock it holds is never something a request thread queues on."""
    path = _db_path()
    if not os.path.exists(path):
        return 0
    _migrating.set()
    try:
        with _lock:
            conn = _connect()
            try:
                with conn:
                    n = conn.execute("UPDATE perf_loads SET rate_key='' WHERE rate_key<>''").rowcount
                if _has_older_index(conn):
                    ok, size, free = _room_to_rebuild(path)
                    if not ok:
                        print(f"[perf-beacon] rebuild SKIPPED: the store is {size} bytes and {free} are free where it would "
                              f"be rebuilt (needs {REBUILD_FREE_FACTOR}x); it is tried again at the next start")
                    else:
                        try:
                            _rebuild(conn)
                            with conn:
                                conn.execute(f"DROP INDEX IF EXISTS {_OLDER_INDEX}")      # the marker goes only now
                        except sqlite3.Error as e:
                            print(f"[perf-beacon] rebuild FAILED ({type(e).__name__}); it is tried again at the next start")
                return n
            finally:
                conn.close()
    finally:
        _migrating.clear()


def _wait_for_the_boot_to_settle(stop: threading.Event | None) -> bool:
    """Wait out the background lane's settle window (BG_LANE_SETTLE_S after the process started; nothing to wait for
    where the lane is not active). With `stop`, wakes at once when it is set. False: told to stop meanwhile."""
    while bg_lane.enabled():
        rem = bg_lane.settle_remaining()
        if rem <= 0:
            break
        nap = min(rem, bg_lane.SETTLE_POLL_S)
        if stop is None:
            time.sleep(nap)
        elif stop.wait(nap):
            return False
    return stop is None or not stop.is_set()


def _at_boot(stop: threading.Event | None = None) -> None:
    """What the housekeeping thread does once, before its first beat: the cheap deletes at once; then the one-time
    rebuild of an older build's store, NOT in the boot: after the lane's settle window and as one turn of the lane
    (the minutes after a deploy belong to the members' reloading tabs)."""
    housekeep()
    if not _wait_for_the_boot_to_settle(stop):
        return
    with bg_lane.turn(LANE):
        n = migrate()
    print(f"[perf-beacon] blanked {n} stored rate key(s); rebuild {'still pending' if rebuild_pending() else 'not pending'}")


def _housekeeping(every_s: float, stop: threading.Event) -> None:
    try:
        _at_boot(stop)
    except Exception as e:          # a measurement's housekeeping never takes the process down
        print(f"[perf-beacon] startup housekeeping failed (non-fatal): {type(e).__name__}")
    _boot_done.set()
    while not stop.wait(every_s):
        try:
            housekeep()
        except Exception as e:
            print(f"[perf-beacon] housekeeping failed (non-fatal): {type(e).__name__}")


def startup(every_s: float = HOUSEKEEP_EVERY_S) -> bool:
    """Start this process's ONE housekeeping thread (api/main.py's lifespan calls it, and stops it with `shutdown`): a
    daemon that does the start-of-process work off the boot path, then `housekeep()` every `every_s`. True when this
    call started it; False when one is running, or PERF_BEACON_HOUSEKEEPING_DISABLED=1 says not to."""
    global _housekeeper, _housekeeper_stop
    if os.environ.get("PERF_BEACON_HOUSEKEEPING_DISABLED") == "1":
        return False
    with _keys_lock:
        if _housekeeper is not None and _housekeeper.is_alive():
            return False
        _housekeeper_stop = threading.Event()       # this thread's own: a stop meant for an earlier one is not its
        _boot_done.clear()
        _housekeeper = threading.Thread(target=_housekeeping, args=(every_s, _housekeeper_stop),
                                        name="perf-beacon-housekeeping", daemon=True)
        _housekeeper.start()
        return True


def shutdown(wait_s: float = 2.0) -> None:
    """Stop the housekeeping thread (the lifespan's shutdown half calls it). It wakes at once from its beat and from the
    settle wait; one in the middle of a delete or the rebuild finishes that first, and this waits at most `wait_s` for
    it (it is a daemon: the process never waits for it to exit)."""
    global _housekeeper
    t = _housekeeper
    _housekeeper_stop.set()
    if t is not None:
        t.join(timeout=wait_s)
    _housekeeper = None


_SWITCH_UPSERT = (
    f"INSERT INTO perf_switch_days ({', '.join(_SWITCH_KEY)}, {', '.join(_SWITCH_B)}, reports, reports_all_under)"
    f" VALUES ({', '.join('?' * (len(_SWITCH_KEY) + _SWITCH_NB))}, 1, ?)"
    f" ON CONFLICT({', '.join(_SWITCH_KEY)}) DO UPDATE SET "
    + ", ".join(f"{b} = {b} + excluded.{b}" for b in _SWITCH_B)
    + ", reports = reports + 1, reports_all_under = reports_all_under + excluded.reports_all_under"
)


_SWITCH_CELL_WHERE = " AND ".join(f"{k}=?" for k in _SWITCH_KEY)


def _record_switches(row: dict[str, Any], ip: str | None, now: float) -> dict[str, int]:
    """Merge one switches report into its day. Its own hourly quota per IP hash (reports, and the switches they hold
    together), and the global one. A report over a quota is dropped whole, never trimmed."""
    global _last_prune
    held = sum(sum(counts) for _, counts in row["cells"])
    key, key_before = _rate_keys(ip, now)
    with _report_lock() as held:
        if not held:
            return {"stored": 0, "dropped": 1, "invalid": 0}      # the one-time rebuild has the store
        conn = _connect()
        try:
            hour_ago = now - 3600
            mine, mine_held = conn.execute(
                "SELECT COUNT(*), COALESCE(SUM(switches), 0) FROM perf_switch_sends WHERE rate_key IN (?,?) AND created_at>?",
                (key, key_before, hour_ago)).fetchone()
            if mine >= SWITCH_RATE_LIMIT or mine_held + held > SWITCH_TOTAL_PER_HOUR:
                return {"stored": 0, "dropped": 1, "invalid": 0}
            total = conn.execute("SELECT COUNT(*) FROM perf_switch_sends WHERE created_at>?", (hour_ago,)).fetchone()[0]
            if total >= GLOBAL_LIMIT_PER_HOUR:
                return {"stored": 0, "dropped": 1, "invalid": 0}
            day, client = switch_day(now), row["client"]
            sender = _sender_key(ip, day)
            with conn:
                conn.execute("DELETE FROM perf_switch_sends WHERE created_at <= ?", (hour_ago,))
                conn.execute("INSERT INTO perf_switch_sends (created_at, rate_key, switches) VALUES (?,?,?)", (now, key, held))
                for cell, counts in row["cells"]:
                    all_under = 0 if any(counts[_SWITCH_UNDER:]) else 1
                    conn.execute(_SWITCH_UPSERT, (day, client, *cell, *counts, all_under))
                    # this sender's first report into this cell today: one more distinct sender
                    first = conn.execute(
                        f"INSERT OR IGNORE INTO perf_switch_senders ({', '.join(_SWITCH_KEY)}, sender)"
                        f" VALUES ({', '.join('?' * (len(_SWITCH_KEY) + 1))})", (day, client, *cell, sender)).rowcount
                    if first:
                        conn.execute(f"UPDATE perf_switch_days SET senders = senders + 1 WHERE {_SWITCH_CELL_WHERE}",
                                     (day, client, *cell))
                conn.executemany(
                    "INSERT INTO perf_switch_counters (day, client, name, n) VALUES (?,?,?,?)"
                    " ON CONFLICT(day, client, name) DO UPDATE SET n = n + excluded.n",
                    [(day, client, name, n) for name, n in zip(SWITCH_COUNTERS, row["counters"]) if n])
                if now - _last_prune > PRUNE_EVERY_S:
                    _prune(conn, now)
                    _last_prune = now
            return {"stored": 1, "dropped": 0, "invalid": 0}
        finally:
            conn.close()


def record(report: Any, *, ip: str | None, country_header: str | None, now: float | None = None) -> dict[str, int]:
    """Store one report: a page load, or the chart-switch counts (`kind`). {'stored','dropped','invalid'};
    never raises for bad input."""
    global _last_prune
    now = time.time() if now is None else now
    try:
        kind = report_kind(report)
        row = validate_switch_report(report) if kind == "switches" else validate(report)
    except ValueError:
        return {"stored": 0, "dropped": 0, "invalid": 1}
    _forget_keys(now)
    if kind == "switches":
        return _record_switches(row, ip, now)
    key, key_before = _rate_keys(ip, now)
    with _report_lock() as held:
        if not held:
            return {"stored": 0, "dropped": 1, "invalid": 0}      # the one-time rebuild has the store
        conn = _connect()
        try:
            hour_ago = now - 3600
            mine = conn.execute("SELECT COUNT(*) FROM perf_load_sends WHERE rate_key IN (?,?) AND created_at>?",
                                (key, key_before, hour_ago)).fetchone()[0]
            if mine >= RATE_LIMIT:
                return {"stored": 0, "dropped": 1, "invalid": 0}
            total = conn.execute("SELECT COUNT(*) FROM perf_loads WHERE created_at>?", (hour_ago,)).fetchone()[0]
            if total >= GLOBAL_LIMIT_PER_HOUR:
                return {"stored": 0, "dropped": 1, "invalid": 0}
            with conn:
                # the quota's own table: a time and the hour's key, deleted once an hour old
                conn.execute("DELETE FROM perf_load_sends WHERE created_at <= ?", (hour_ago,))
                conn.execute("INSERT INTO perf_load_sends (created_at, rate_key) VALUES (?,?)", (now, key))
                # ⛔ the page-load row itself holds NO key: `rate_key` stays in the table only because older stores
                # have the column (NOT NULL), and it is always written empty
                cur = conn.execute(
                    f"INSERT INTO perf_loads (created_at,page,client,country,{','.join(TIMINGS)},long_tasks,rate_key)"
                    f" VALUES (?,?,?,?,{','.join('?' * len(TIMINGS))},?,'')",
                    (now, row["page"], row["client"], country_from(country_header), *(row[k] for k in TIMINGS),
                     row["long_tasks"]))
                load_id = cur.lastrowid
                conn.executemany("INSERT INTO perf_api (load_id,route,ms,ok) VALUES (?,?,?,?)",
                                 [(load_id, r, ms, ok) for r, ms, ok in row["api"]])
                over = conn.execute("SELECT COUNT(*) FROM perf_loads").fetchone()[0] - MAX_LOADS
                if over > 0:
                    conn.execute("DELETE FROM perf_loads WHERE id IN (SELECT id FROM perf_loads ORDER BY id LIMIT ?)", (over,))
                if now - _last_prune > PRUNE_EVERY_S:
                    _prune(conn, now)
                    _last_prune = now
            return {"stored": 1, "dropped": 0, "invalid": 0}
        finally:
            conn.close()


def _pct(values: list[int], p: float) -> int | None:
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    k = max(0, min(len(vals) - 1, math.ceil(p / 100 * len(vals)) - 1))
    return vals[k]


def summary(hours: int = 24, now: float | None = None) -> dict[str, Any]:
    """Per page and client: count and p50/p75/p95 of each timing; per API route: count, p50, p95, failure share;
    per country: count and p75 lcp. The admin read of 10.1."""
    now = time.time() if now is None else now
    since = now - hours * 3600
    conn = _connect()
    try:
        loads = conn.execute(
            f"SELECT page, client, country, {', '.join(TIMINGS)} FROM perf_loads WHERE created_at > ?",
            (since,)).fetchall()
        api = conn.execute(
            "SELECT a.route, a.ms, a.ok FROM perf_api a JOIN perf_loads l ON l.id = a.load_id WHERE l.created_at > ?",
            (since,)).fetchall()
    finally:
        conn.close()
    pages: dict[tuple[str, str], list] = {}
    countries: dict[str, list] = {}
    for page, client, country, *t in loads:
        pages.setdefault((page, client), []).append(t)
        countries.setdefault(country or "??", []).append(t[2])
    page_rows = []
    for (page, client), rows in sorted(pages.items(), key=lambda kv: -len(kv[1])):
        entry: dict[str, Any] = {"page": page, "client": client, "loads": len(rows)}
        for i, name in enumerate(TIMINGS):
            col = [r[i] for r in rows]
            entry[name] = {"p50": _pct(col, 50), "p75": _pct(col, 75), "p95": _pct(col, 95)}
        page_rows.append(entry)
    routes: dict[str, list] = {}
    for route, ms, ok in api:
        routes.setdefault(route, []).append((ms, ok))
    api_rows = sorted(
        ({"route": r, "calls": len(v), "p50": _pct([m for m, _ in v], 50), "p95": _pct([m for m, _ in v], 95),
          "failed_pct": round(100 * sum(1 for _, ok in v if not ok) / len(v), 1)} for r, v in routes.items()),
        key=lambda x: -(x["p95"] or 0))
    country_rows = sorted(({"country": c, "loads": len(v), "lcp_p75": _pct(v, 75)} for c, v in countries.items()),
                          key=lambda x: -x["loads"])
    return {"hours": hours, "loads": len(loads), "pages": page_rows, "api": api_rows, "countries": country_rows}


#: What the read's names mean, and what it does NOT hold. Fixed text: nothing here comes from a report.
SWITCH_LEGEND: dict[str, Any] = {
    "sample": "ms from the time of the input event in flight when the board switched the symbol to the first animation "
              "frame after every chart of the linked group had drawn it. Not in it: the rest of that frame, the "
              "compositor, vsync, the display (about one refresh interval more).",
    "tf": {
        "intraday-1m": "the group's finest chart is on 1 minute",
        "intraday-other": "its finest chart is on another count of minutes (5m to 4h, custom ones included)",
        "daily-plus": "every chart of the group is on D, W, M or a multiple",
    },
    "trigger": {
        "list-key": "ArrowUp, ArrowDown or Space outside a text field: walking a list",
        "click": "any pointer event that changed the symbol: a list row, an alert row, a menu, a badge on the chart. "
                 "It is NOT only lists; do not read its share as list behaviour",
        "typed": "a key pressed in a text field (the Enter of a typed ticker), or the chart header's search, a picked "
                 "result included",
        "other": "any other input event (a hotkey outside a text field)",
    },
    "route": {
        "other": "nothing reported how the charts were shown",
        "decision": "decided in the press: every chart could show it at once, one synchronous render",
        "now": "not decided in the press, but every chart held its rows (at most the wait for its panes' columns)",
        "deferred": "held first by the burst rule (a press inside a run of presses), then shown as `now`",
        "daily-hold": "a D/W/M chart had to promote or join its set first",
        "prepare": "an intraday chart had to wait for its rows (the server, the lake or the device)",
    },
    "counters": {
        "superseded": "switches the next press on the same group replaced before their frame; a held arrow makes many",
        "abandoned": "switches still waiting when the page was hidden",
        "unpressed": "the symbol changed with no input event in flight (a link, a layout restore, a list that sets it "
                     "from an effect): not timed. It should stay near zero for list presses",
        "untracked": "a chart of the group had no paint identity, so its draw could not be seen",
        "unclocked": "the press or the sample had no usable time (under 0 or over 60 s)",
        "overflow": f"past the page's own caps ({MAX_SWITCH_CELLS} combinations or {MAX_SWITCH_TOTAL:,} samples between two sends)",
        "released": "the symbol was switched while a key's release was the event in flight: never timed (the sample would "
                    "start when the key was let go). Nothing does this today; anything above zero is a new key-up handler "
                    "that switches a symbol",
    },
    "senders": "distinct senders that added to the cell that day. One sender behind most of a cell's switches is one "
               "page, not the membership. Counted with a key held only in the server's memory for that day, so a "
               "restart of the server mid-day, or a second server process, counts a returning sender again: exact "
               "within one process between restarts, and an upper bound across restarts and processes.",
    "quota": "what one sender may add: reports and switches per hour, counted per process with a key held only in that "
             "process's memory. A restart starts the count again, and each server process counts for itself, so the "
             "bound is per process and per restart.",
    "not_sampled": [
        "every chart host but the /charts board: the breadth drill, the terminal, the screener, the phone workspace",
        "pop-out windows, mostly: a click or a ticker typed INSIDE a pop-out is `unpressed` (never timed); a key relayed "
        "from a pop-out to the main window IS timed, from the relay (a little after the real key) to the MAIN window's "
        "frame. Treat a pop-out's switches as a coverage gap",
        "a symbol changed with no input event in flight: counted `unpressed`, not timed",
        "a switch whose chart never draws (a ticker with no data, a chart closed mid-switch): `superseded` at the next press",
    ],
}


def _under(counts: list[int]) -> tuple[int, int, float | None]:
    total, under = sum(counts), sum(counts[:_SWITCH_UNDER])
    return total, under, (round(100 * under / total, 1) if total else None)


def switch_summary(days: int = 7, now: float | None = None) -> dict[str, Any]:
    """The chart-switch read: for each of the last `days` ET days (today included), the merged histogram of every
    combination with its share under SWITCH_UNDER_MS, and the day's totals and counters.

    `cells[]`: day, client, tf, store, trigger, route, rth (the names, never the indexes), `n` (a count per bucket of
    `bucket_edges_ms`, the last being "that and above"), `switches`, `under_40`, `under_40_pct`, `reports` (how many
    reports added to the cell), `reports_all_under_40` (in how many of them EVERY switch of the cell was under) and
    `senders` (how many DISTINCT senders added to it that day).
    `by_day[]`: the same totals over every combination and client, and each SWITCH_COUNTERS sum.
    `legend`: what each name means and what is NOT sampled (SWITCH_LEGEND)."""
    now = time.time() if now is None else now
    housekeep(now)       # the read itself deletes what is over: a quiet store does not wait for the next report
    first = switch_day(now - (max(1, days) - 1) * 86400)
    conn = _connect()
    try:
        rows = conn.execute(
            f"SELECT {', '.join(_SWITCH_KEY)}, {', '.join(_SWITCH_B)}, reports, reports_all_under, senders FROM perf_switch_days"
            f" WHERE day >= ? ORDER BY day DESC, {', '.join(_SWITCH_KEY[1:])}", (first,)).fetchall()
        counter_rows = conn.execute(
            "SELECT day, name, SUM(n) FROM perf_switch_counters WHERE day >= ? GROUP BY day, name", (first,)).fetchall()
    finally:
        conn.close()
    cells: list[dict[str, Any]] = []
    day_counts: dict[str, list[int]] = {}
    for day, client, tf, dev_store, trig, route, rth, *rest in rows:
        counts, reports, all_under, senders = list(rest[:_SWITCH_NB]), rest[_SWITCH_NB], rest[_SWITCH_NB + 1], rest[_SWITCH_NB + 2]
        total, under, pct = _under(counts)
        cells.append({
            "day": day, "client": client, "tf": SWITCH_TF[tf], "store": bool(dev_store), "trigger": SWITCH_TRIGGER[trig],
            "route": SWITCH_ROUTE[route], "rth": bool(rth), "n": counts, "switches": total, "under_40": under,
            "under_40_pct": pct, "reports": reports, "reports_all_under_40": all_under, "senders": senders})
        merged = day_counts.setdefault(day, [0] * _SWITCH_NB)
        for i, n in enumerate(counts):
            merged[i] += n
    counters: dict[str, dict[str, int]] = {}
    for day, name, n in counter_rows:
        counters.setdefault(day, {})[name] = n
    by_day = []
    for day in sorted(set(day_counts) | set(counters), reverse=True):
        total, under, pct = _under(day_counts.get(day, [0] * _SWITCH_NB))
        by_day.append({"day": day, "switches": total, "under_40": under, "under_40_pct": pct,
                       **{name: counters.get(day, {}).get(name, 0) for name in SWITCH_COUNTERS}})
    return {"days": days, "bucket_edges_ms": list(SWITCH_BUCKET_EDGES_MS), "under_ms": SWITCH_UNDER_MS,
            "by_day": by_day, "cells": cells, "legend": SWITCH_LEGEND}
