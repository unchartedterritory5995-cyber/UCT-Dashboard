"""Entity Master storage layer — connection management, the in-process
write lock, and the in-memory `alias -> entity_id` resolution cache.

Precedents this module copies (per entity-master-spec.md §2.1/§8.2/§8.3,
each read in full before writing this file):
  - Thread-local WAL connections: api/services/bars_sqlite.py `_conn()`.
  - The single in-process `_WRITE_LOCK`: api/services/bars_sqlite.py
    `_WRITE_LOCK` (line 40) — "reads stay lock-free (WAL allows concurrent
    readers); this only orders writers."
  - The lazy `_ensure_loaded()` cache-load idiom:
    api/services/delisted_registry.py `_ensure_loaded()`.
  - The two-tier in-memory-dict + rebuild-on-write shape:
    api/services/ticker_search_index.py `_INDEX`/`_BY_SYM` + `build_index()`.

Checkpoint 2 note: this module builds and reads the cache. Checkpoint 3
(write path) is what actually calls `rebuild_cache()` after a write — until
then the cache only ever changes via an explicit caller-triggered rebuild
(e.g. a test seeding rows directly at the SQLite layer, then calling
`rebuild_cache()` to observe them through the read primitives).
"""
import threading

from api.services.entity_master import schema

_WRITE_LOCK = threading.Lock()

_local = threading.local()

_CACHE_LOCK = threading.RLock()
# alias (upper-cased) -> list of entity_ids with a currently-open
# (valid_to IS NULL) entity_aliases row for that alias. A list, not a single
# value, so a genuine collision (two entities both holding the same alias
# open at once — a write-time-guard failure, or a directly-seeded test
# fixture per AC-6) is visible as len > 1 rather than silently resolved to
# whichever row a query happened to return first.
_ALIAS_CACHE: dict[str, list[str]] = {}
_CACHE_LOADED = False


def _conn(db_path: str | None = None):
    """Thread-local WAL connection, mirroring bars_sqlite.py's `_conn()`
    (per-thread cache, since sqlite3 connections are not meant to be shared
    across threads even with check_same_thread=False for concurrent access
    from multiple threads at once)."""
    key = db_path or "__default__"
    cache = getattr(_local, "conns", None)
    if cache is None:
        cache = {}
        _local.conns = cache
    conn = cache.get(key)
    if conn is None:
        conn = schema.init_db(db_path=db_path)
        cache[key] = conn
    return conn


def rebuild_cache(db_path: str | None = None) -> int:
    """Full rebuild of the alias -> entity_id(s) cache from SQLite. Returns
    the row count scanned. Cheap at this store's scale (spec §8.3/§14: "at
    ~15-20K rows this is sub-millisecond in Python") — always a full
    rebuild, never a partial patch, per §8.3's explicit design."""
    global _CACHE_LOADED
    conn = _conn(db_path)
    rows = conn.execute(
        "SELECT alias, entity_id FROM entity_aliases WHERE valid_to IS NULL"
    ).fetchall()
    new_cache: dict[str, list[str]] = {}
    for alias, entity_id in rows:
        new_cache.setdefault(alias, []).append(entity_id)
    with _CACHE_LOCK:
        _ALIAS_CACHE.clear()
        _ALIAS_CACHE.update(new_cache)
        _CACHE_LOADED = True
    return len(rows)


def _ensure_cache_loaded(db_path: str | None = None) -> None:
    if not _CACHE_LOADED:
        rebuild_cache(db_path)


def open_alias_candidates(alias: str, db_path: str | None = None) -> list[str]:
    """entity_id(s) currently holding `alias` open, from the in-memory
    cache (lazy-loaded). Empty list if none."""
    _ensure_cache_loaded(db_path)
    with _CACHE_LOCK:
        return list(_ALIAS_CACHE.get(alias, ()))


def alias_candidates_as_of(alias: str, as_of: str, db_path: str | None = None) -> list[str]:
    """entity_id(s) whose alias window covers `as_of` (an ISO date string),
    read directly from SQLite — the historical-lookup path (spec §8.3: "a
    historical lookup is rare... it does not need the same cache
    treatment"). Returns every match, never just the first, so a genuine
    historical collision is visible to the caller rather than hidden."""
    conn = _conn(db_path)
    rows = conn.execute(
        "SELECT entity_id FROM entity_aliases "
        "WHERE alias = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)",
        (alias, as_of, as_of),
    ).fetchall()
    return [r[0] for r in rows]
