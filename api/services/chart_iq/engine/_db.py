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
        rows = _Rows(self._c().execute(*a).fetchall())
        _TL.db_s = getattr(_TL, "db_s", 0.0) + (time.perf_counter() - t)
        _TL.db_n = getattr(_TL, "db_n", 0) + 1
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
