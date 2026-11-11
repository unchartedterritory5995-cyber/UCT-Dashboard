"""Chart IQ data adapter: read-only SQLite access for the vendored engine.

The engine was written against module-level connections. On the web pod requests run on a thread pool, so each thread gets its
own read-only connection (a sqlite3 connection must not be shared across threads). Paths follow the site's own services:
bars.db under DATA_DIR (api/services/bars_sqlite.py) and industry_map.db (api/services/industry_map.py). CHART_IQ_BARS_DB /
INDUSTRY_MAP_DB_PATH override them; CHART_IQ_SQLITE_IMMUTABLE=1 opens snapshot copies without locking (parity tests only:
never on a database that is being written).
"""
import os
import sqlite3
import threading
import time

_TL = threading.local()


class _Rows(list):
    """Prefetched rows with the cursor methods the engine uses."""

    def fetchone(self):
        return self[0] if self else None

    def fetchall(self):
        return list(self)


def db_clock_reset():
    _TL.db_s, _TL.db_n = 0.0, 0


def db_clock():
    return round(getattr(_TL, "db_s", 0.0), 3), getattr(_TL, "db_n", 0)


# ── the bars row cache ─────────────────────────────────────────────────────────────────────────────────────────────────────────
# Every bars query the engine makes is "the last N daily rows of one ticker up to a day" (SELECT ts,... FROM ohlcv WHERE ticker=? AND
# tf='D' AND ts<=? ... LIMIT). Measured on the web pod 2026-11-02: ~1 s per such query (a ticker's rows are scattered across a
# 30+ GB file), 10-247 of them per read, while the answers are shared: SPY/QQQ/IWM by every read, an industry's members by every
# stock in it. The SAME SQL with the SAME parameters returns the SAME rows, so this caches exactly that, in memory and in a small
# SQLite file under DATA_DIR that survives a deploy restart. Freshness: a row set ending on today's ET date can still change (the
# developing bar), so it lives LIVE_TTL_S; an older day is final except for split adjustments, so it lives FINAL_TTL_S.
# Only on the site path (no CHART_IQ_BARS_DB): tests and lab parity read the database directly.
import collections
import datetime
import json
import re

LIVE_TTL_S = 900
FINAL_TTL_S = 24 * 3600
MEM_MAX = 40000
_SQL_OK = re.compile(r"^SELECT ts,[a-z,]+ FROM \(SELECT ts,[a-z,]+ FROM ohlcv WHERE ticker=\? AND tf='D' AND ts<=\? ORDER BY ts DESC LIMIT (\?|\d+)\) ORDER BY ts$")


def _today_et():
    now = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=5)   # ET within an hour; the boundary only picks the TTL
    return now.year * 10000 + now.month * 100 + now.day


def _row_key(name, a):
    if name != "bars" or os.environ.get("CHART_IQ_BARS_DB") or len(a) < 2:
        return None
    sql = " ".join(a[0].split())
    if not _SQL_OK.match(sql):
        return None
    try:
        day = int(a[1][1])
    except (TypeError, ValueError, IndexError):
        return None
    return (sql, tuple(a[1]), day)


class _RowCache:
    def __init__(self):
        self._mem = collections.OrderedDict()
        self._lock = threading.Lock()
        self._disk = None
        self._disk_failed = False
        self._pruned = 0.0

    def _ttl(self, day):
        return LIVE_TTL_S if day >= _today_et() else FINAL_TTL_S

    def _db(self):
        if self._disk is None and not self._disk_failed:
            try:
                p = os.environ.get("CHART_IQ_ROW_CACHE_DB") or os.path.join(os.environ.get("DATA_DIR", "/data"), "chart_iq_rows.db")
                c = sqlite3.connect(p, timeout=2, check_same_thread=False)
                c.execute("PRAGMA journal_mode=WAL")
                c.execute("PRAGMA busy_timeout=2000")
                c.execute("CREATE TABLE IF NOT EXISTS rows (k TEXT PRIMARY KEY, day INTEGER, at REAL, v TEXT)")
                self._disk = c
            except Exception:  # noqa: BLE001 -- a cache that cannot open is a cache miss, never an error
                self._disk_failed = True
        return self._disk

    def get(self, key):
        sql, params, day = key
        now = time.time()
        with self._lock:
            hit = self._mem.get(key)
            if hit and now - hit[0] < self._ttl(day):
                self._mem.move_to_end(key)
                return hit[1]
            db = self._db()
            if db is None:
                return None
            try:
                r = db.execute("SELECT at, v FROM rows WHERE k=?", (json.dumps([sql, params]),)).fetchone()
            except Exception:  # noqa: BLE001
                return None
            if not r or now - r[0] >= self._ttl(day):
                return None
            rows = [tuple(x) for x in json.loads(r[1])]
            self._put_mem(key, r[0], rows)
            return rows

    def _put_mem(self, key, at, rows):
        self._mem[key] = (at, rows)
        self._mem.move_to_end(key)
        while len(self._mem) > MEM_MAX:
            self._mem.popitem(last=False)

    def put(self, key, rows):
        sql, params, day = key
        now = time.time()
        with self._lock:
            self._put_mem(key, now, list(rows))
            db = self._db()
            if db is None:
                return
            try:
                db.execute("INSERT OR REPLACE INTO rows (k, day, at, v) VALUES (?,?,?,?)", (json.dumps([sql, params]), day, now, json.dumps(list(rows))))
                if now - self._pruned > 3600:
                    db.execute("DELETE FROM rows WHERE at < ?", (now - FINAL_TTL_S,))
                    self._pruned = now
                db.commit()
            except Exception:  # noqa: BLE001
                pass


_ROWS = _RowCache()

WIDE_N = 1500
_FULL = ("ts", "o", "h", "l", "c", "v")
_WIDE_SQL = "SELECT ts,o,h,l,c,v FROM (SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf='D' AND ts<=? ORDER BY ts DESC LIMIT ?) ORDER BY ts"


def _shape(sql, params):
    """(columns, N) of a cacheable "last N rows" query, or (None, None)."""
    m = _SQL_OK.match(sql)
    if not m:
        return None, None
    cols = tuple(sql[len("SELECT "):sql.index(" FROM")].split(","))
    if any(c not in _FULL for c in cols):
        return None, None
    try:
        n = int(m.group(1)) if m.group(1) != "?" else int(params[2])
    except (TypeError, ValueError, IndexError):
        return None, None
    return cols, n


def _bars_path():
    return os.environ.get("CHART_IQ_BARS_DB") or os.path.join(os.environ.get("DATA_DIR", "/data"), "bars.db")


def _industry_path():
    p = os.environ.get("INDUSTRY_MAP_DB_PATH")
    if p:
        return p
    if os.path.isdir("/data"):
        return "/data/industry_map.db"
    return os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "data", "industry_map.db")


def _uri(path):
    p = os.path.abspath(path).replace("\\", "/")
    return "file:%s?mode=ro%s" % (p, "&immutable=1" if os.environ.get("CHART_IQ_SQLITE_IMMUTABLE") == "1" else "")


class _Conn:
    """A thread-local read-only connection with the two methods the engine uses (execute, close)."""

    def __init__(self, name, path_fn, epoch_fn=None):
        self._name, self._path_fn, self._epoch_fn = name, path_fn, epoch_fn or (lambda: 0)

    def _c(self):
        if self._name == "bars" and not os.environ.get("CHART_IQ_BARS_DB"):
            # ON THE SITE: read through the site's own bars connection (api/services/bars_sqlite._conn: per thread, WAL, mmap,
            # follows the snapshot-swap epoch). Measured 2026-11-02 on the web pod: a separate mode=ro URI connection cost ~1 s
            # PER QUERY (10 queries = 9 s for one read) while the site's reads of the same table are fast. The engine only
            # SELECTs. CHART_IQ_BARS_DB (tests, lab parity) keeps the private read-only connection below.
            from api.services import bars_sqlite
            return bars_sqlite._conn()
        # The web pod replaces bars.db wholesale (data_sync snapshot pull) and bumps bars_sqlite's connection epoch; an open
        # connection keeps reading the OLD, unlinked inode forever. So a cached connection is reused only while the epoch it
        # was opened under is still current, exactly like bars_sqlite._conn().
        ep = self._epoch_fn()
        held = getattr(_TL, self._name, None)
        if held is not None and held[1] != ep:
            try:
                held[0].close()
            except Exception:  # noqa: BLE001
                pass
            held = None
        if held is None:
            held = (sqlite3.connect(_uri(self._path_fn()), uri=True, check_same_thread=False, timeout=10), ep)
            setattr(_TL, self._name, held)
        return held[0]

    def execute(self, *a):
        # Rows are fetched here (not lazily by the caller) so the time spent reading the database is measurable per read: the
        # pipeline reports it to admins as timing.db_s / db_n. Same rows, same order; _Rows answers fetchone / fetchall / iteration.
        t = time.perf_counter()
        key = _row_key(self._name, a)
        rows = _ROWS.get(key) if key else None
        if rows is None and key:
            rows = self._from_wide(key)
        if rows is None:
            rows = _Rows(self._c().execute(*a).fetchall())
            _TL.db_n = getattr(_TL, "db_n", 0) + 1
            if key:
                _ROWS.put(key, rows)
        _TL.db_s = getattr(_TL, "db_s", 0.0) + (time.perf_counter() - t)
        return _Rows(rows)

    def _from_wide(self, key):
        """Answer a "last N rows" query from ONE wide read of the ticker (the last WIDE_N full rows up to the day): the last N rows
        are the tail of the last M rows whenever M >= N, or always when the ticker has fewer than M rows. A full-column miss
        fetches the wide window (so a read's 520 / 300 / 190 / 80 / 1500-row asks cost one query, not five); a narrower ask (the
        group members' 70 closes) only uses a wide window already cached, never widens its own read."""
        sql, params, day = key
        cols, n = _shape(sql, params)
        if cols is None or n is None or n < 0:
            return None
        ticker = params[0]
        wkey = (_WIDE_SQL, (ticker, day, max(n, WIDE_N)), day)
        wide = _ROWS.get(wkey)
        if wide is None:
            for m in (WIDE_N,) if n <= WIDE_N else ():
                wide = _ROWS.get((_WIDE_SQL, (ticker, day, m), day))
        if wide is None:
            if cols != _FULL:
                return None
            want = max(n, WIDE_N)
            wide = _Rows(self._c().execute(_WIDE_SQL, (ticker, day, want)).fetchall())
            _TL.db_n = getattr(_TL, "db_n", 0) + 1
            wkey = (_WIDE_SQL, (ticker, day, want), day)
            _ROWS.put(wkey, wide)
        m = wkey[1][2]
        if n > m and len(wide) >= m:
            return None                    # the wide window may be missing older rows this ask needs
        idx = [_FULL.index(c) for c in cols]
        rows = [tuple(r[i] for i in idx) for r in (wide[-n:] if n else [])]
        _ROWS.put(key, rows)
        return rows

    def close(self):
        """The engine closes per-call connections; the thread keeps its own open."""


def _bars_epoch():
    try:
        from api.services import bars_sqlite
        return bars_sqlite._db_epoch
    except Exception:  # noqa: BLE001 -- outside the site (the lab's parity run) there is no swap to follow
        return 0


_BARS = _Conn("bars", _bars_path, _bars_epoch)
_IND = _Conn("industry", _industry_path)


def bars():
    return _BARS


def industry():
    return _IND
