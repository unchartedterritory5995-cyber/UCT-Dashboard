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

_TL = threading.local()


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

    def __init__(self, name, path_fn):
        self._name, self._path_fn = name, path_fn

    def _c(self):
        c = getattr(_TL, self._name, None)
        if c is None:
            c = sqlite3.connect(_uri(self._path_fn()), uri=True, check_same_thread=False, timeout=10)
            setattr(_TL, self._name, c)
        return c

    def execute(self, *a):
        return self._c().execute(*a)

    def close(self):
        """The engine closes per-call connections; the thread keeps its own open."""


_BARS = _Conn("bars", _bars_path)
_IND = _Conn("industry", _industry_path)


def bars():
    return _BARS


def industry():
    return _IND
