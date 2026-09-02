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
import datetime
import os
import threading
import time

from api.services.entity_master import schema

_WRITE_LOCK = threading.Lock()

# Bulk-write mode (Checkpoint 4): spec §8.3 is explicit that the cache is
# "rebuilt from the SQLite store after every write (never partially
# patched)" — a full rebuild is the ONLY supported shape, justified there by
# "the write rate is low... identity-change events are rare." That
# assumption does not hold for the one-time seed script, which issues one
# write per symbol (tens of thousands in a real run): rebuilding the WHOLE
# cache after EVERY write is O(n^2) over the run. This flag changes WHEN the
# (always-full, never-partial) rebuild happens — once at the end of a bulk
# sequence instead of after each call — without weakening the "never
# partially patched" design at all. Off by default; only the seed script
# (and tests of this exact behavior) turn it on.
_BULK_MODE = False


class bulk_mode:
    """`with store.bulk_mode(db_path):` — suspends apply_event()'s
    per-call cache rebuild for the duration, then performs exactly ONE full
    rebuild on exit (even if the block raised, so a failed bulk run still
    leaves the cache consistent with whatever was actually committed)."""

    def __init__(self, db_path: str | None = None):
        self.db_path = db_path

    def __enter__(self):
        global _BULK_MODE
        _BULK_MODE = True
        return self

    def __exit__(self, exc_type, exc, tb):
        global _BULK_MODE
        _BULK_MODE = False
        rebuild_cache(self.db_path)
        return False

# ── Entity id generation (spec §3) ─────────────────────────────────────────
# "ent_<26-char Crockford-base32 ULID>" — 48-bit ms timestamp (high bits) +
# 80-bit crypto-random payload, encoded big-endian so string order matches
# creation order. No new dependency: spec §3 explicitly calls for "a 26-line
# pure-Python ULID generator... sufficient, needs no package addition."
_CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"  # excludes I, L, O, U


def _new_ulid() -> str:
    ts_ms = int(time.time() * 1000)
    rand80 = int.from_bytes(os.urandom(10), "big")
    value = (ts_ms << 80) | rand80  # 128 bits total
    chars = []
    for _ in range(26):
        chars.append(_CROCKFORD_ALPHABET[value & 0x1F])
        value >>= 5
    return "".join(reversed(chars))


def new_entity_id() -> str:
    return "ent_" + _new_ulid()


def now_iso() -> str:
    return datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z")


# ── Write-time collision guard (spec §8.4, AC-3) ────────────────────────────
_FAR_FUTURE = "9999-12-31"  # sentinel upper bound for an open-ended (valid_to=NULL) window


def colliding_entity_ids(
    alias: str,
    valid_from: str,
    valid_to: str | None,
    exclude_entity_id: str | None,
    db_path: str | None = None,
) -> list[str]:
    """entity_id(s) OTHER than `exclude_entity_id` whose currently-recorded
    `alias` row overlaps the candidate window [valid_from, valid_to). Empty
    list = no collision, safe to write. Interval-overlap test (NULL treated
    as +infinity on both sides, per spec §8.4's literal predicate)."""
    conn = _conn(db_path)
    upper = valid_to or _FAR_FUTURE
    rows = conn.execute(
        "SELECT DISTINCT entity_id FROM entity_aliases "
        "WHERE alias = ? AND valid_from < ? AND (valid_to IS NULL OR valid_to > ?) "
        "AND entity_id != ?",
        (alias, upper, valid_from, exclude_entity_id or ""),
    ).fetchall()
    return [r[0] for r in rows]

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


def open_aliases_with_lifecycle(db_path: str | None = None) -> dict[str, list[tuple[str, str]]]:
    """Checkpoint 7: every currently-open (`valid_to IS NULL`) alias, joined
    to its entity's `lifecycle_state` — `{alias: [(entity_id, lifecycle_state), ...]}`.
    A LIST per alias, not a single tuple: a genuine collision (two entities
    both holding the same alias open — should not happen under the write
    guard, but this read must not assume it was honored, same discipline as
    `store.open_alias_candidates`) must stay visible as len > 1, never
    silently collapsed to whichever row a dict comprehension happened to
    keep last. The reconciliation job's ONLY read of the store's own state;
    it never queries `delisted_registry` or any other legacy data source."""
    conn = _conn(db_path)
    rows = conn.execute(
        "SELECT ea.alias, ea.entity_id, e.lifecycle_state "
        "FROM entity_aliases ea JOIN entities e ON e.entity_id = ea.entity_id "
        "WHERE ea.valid_to IS NULL"
    ).fetchall()
    out: dict[str, list[tuple[str, str]]] = {}
    for alias, entity_id, lifecycle_state in rows:
        out.setdefault(alias, []).append((entity_id, lifecycle_state))
    return out


# ── Write helpers (Checkpoint 3) ────────────────────────────────────────────
# Every function below MUST be called while holding `_WRITE_LOCK` (enforced
# by convention at the api.py call site, exactly mirroring bars_sqlite.py's
# own "the lock only orders writers" contract — these functions do not
# re-acquire the lock themselves, so they compose inside one apply_event()
# transaction without deadlocking).

def get_event_by_dedup_key(dedup_key: str, db_path: str | None = None):
    """Row tuple or None. Used for apply_event()'s idempotent-replay check
    (AC-5) — a second call with the same dedup_key never re-applies any
    domain mutation, it only re-reads this row."""
    conn = _conn(db_path)
    return conn.execute(
        "SELECT id, entity_id, event_type, rejected_reason FROM entity_events "
        "WHERE dedup_key = ?",
        (dedup_key,),
    ).fetchone()


def record_event(
    dedup_key: str,
    entity_id: str | None,
    event_type: str,
    payload_json: str,
    source: str,
    rejected_reason: str | None,
    db_path: str | None = None,
) -> int:
    conn = _conn(db_path)
    cur = conn.execute(
        "INSERT INTO entity_events(dedup_key, entity_id, event_type, payload_json, source, applied_at, rejected_reason) "
        "VALUES (?,?,?,?,?,?,?)",
        (dedup_key, entity_id, event_type, payload_json, source, now_iso(), rejected_reason),
    )
    return cur.lastrowid


def create_entity(entity_id: str, entity_type: str, db_path: str | None = None) -> None:
    conn = _conn(db_path)
    now = now_iso()
    conn.execute(
        "INSERT INTO entities(entity_id, entity_type, lifecycle_state, lifecycle_since, created_at, updated_at) "
        "VALUES (?,?,?,?,?,?)",
        (entity_id, entity_type, "active", None, now, now),
    )


def add_alias(entity_id: str, alias: str, valid_from: str, event_id: int, db_path: str | None = None) -> None:
    conn = _conn(db_path)
    conn.execute(
        "INSERT INTO entity_aliases(entity_id, alias, valid_from, valid_to, source, created_at) "
        "VALUES (?,?,?,NULL,?,?)",
        (entity_id, alias, valid_from, f"event:{event_id}", now_iso()),
    )


def has_open_alias(entity_id: str, alias: str, db_path: str | None = None) -> bool:
    conn = _conn(db_path)
    return conn.execute(
        "SELECT 1 FROM entity_aliases WHERE entity_id = ? AND alias = ? AND valid_to IS NULL",
        (entity_id, alias),
    ).fetchone() is not None


def close_open_alias(entity_id: str, alias: str, valid_to: str, db_path: str | None = None) -> bool:
    """Closes the specific currently-OPEN row for (entity_id, alias) —
    the one mutable field an append-only bitemporal store may touch
    (spec §8.1: "closing the open end of a range is not rewriting history").
    Returns False (no-op) if no such open row exists."""
    conn = _conn(db_path)
    cur = conn.execute(
        "UPDATE entity_aliases SET valid_to = ? "
        "WHERE entity_id = ? AND alias = ? AND valid_to IS NULL",
        (valid_to, entity_id, alias),
    )
    return cur.rowcount > 0


def set_lifecycle_state(entity_id: str, lifecycle_state: str, lifecycle_since: str, db_path: str | None = None) -> bool:
    conn = _conn(db_path)
    cur = conn.execute(
        "UPDATE entities SET lifecycle_state = ?, lifecycle_since = ?, updated_at = ? WHERE entity_id = ?",
        (lifecycle_state, lifecycle_since, now_iso(), entity_id),
    )
    return cur.rowcount > 0


def add_relation(entity_id: str, related_entity_id: str, kind: str, valid_from: str, event_id: int, db_path: str | None = None) -> None:
    conn = _conn(db_path)
    conn.execute(
        "INSERT INTO entity_relations(entity_id, related_entity_id, kind, valid_from, source, created_at) "
        "VALUES (?,?,?,?,?,?)",
        (entity_id, related_entity_id, kind, valid_from, f"event:{event_id}", now_iso()),
    )


def entity_exists(entity_id: str, db_path: str | None = None) -> bool:
    conn = _conn(db_path)
    return conn.execute(
        "SELECT 1 FROM entities WHERE entity_id = ?", (entity_id,)
    ).fetchone() is not None


# ── Provider-data write helpers — never touch entities/entity_aliases ──────
# "Provider-specific data mapping INTO canonical identity, never silently
# BECOMING canonical identity" (Checkpoint 3 condition): these two functions
# are the ONLY writers of entity_vendor_symbols/entity_figi, and neither one
# can ever create an entity, mutate an alias, or change lifecycle state —
# structurally, not just by convention, since neither table has a foreign
# key TO entities that this code path writes anywhere but entity_id (an
# existing id, never generated here).

def upsert_vendor_symbol(
    entity_id: str, vendor: str, vendor_symbol: str, valid_from: str, source: str,
    db_path: str | None = None,
) -> tuple[bool, bool]:
    """Returns (written, conflict).

    Checkpoint 5 fix: the original `ON CONFLICT DO NOTHING` silently
    swallowed a genuine value CHANGE at the same (entity_id, vendor,
    valid_from) key — a re-run with the identical value (the intended,
    idempotent case) and a re-run with a DIFFERENT value (a genuine
    provider-mapping conflict) were indistinguishable, both silently
    producing "no-op." This table is a dated history (unlike
    `entity_figi`), so per spec §8.1's "no update-in-place on a historical
    fact," a real correction belongs at a NEW `valid_from`, not an
    overwrite of this one — so a conflicting value is REJECTED, not
    silently applied either way, and the caller is told which case
    occurred instead of finding out never."""
    conn = _conn(db_path)
    existing = conn.execute(
        "SELECT vendor_symbol FROM entity_vendor_symbols "
        "WHERE entity_id = ? AND vendor = ? AND valid_from = ?",
        (entity_id, vendor, valid_from),
    ).fetchone()
    if existing is not None:
        if existing[0] == vendor_symbol:
            return False, False  # identical repeat — true idempotent no-op
        return False, True  # genuine conflict — rejected, original kept
    conn.execute(
        "INSERT INTO entity_vendor_symbols(entity_id, vendor, vendor_symbol, valid_from, valid_to, source, created_at) "
        "VALUES (?,?,?,?,NULL,?,?)",
        (entity_id, vendor, vendor_symbol, valid_from, source, now_iso()),
    )
    return True, False


def upsert_figi(
    entity_id: str, composite_figi: str | None, share_class_figi: str | None, source: str,
    db_path: str | None = None,
) -> tuple[bool, bool]:
    """Returns (written, changed). `entity_figi` IS a current-snapshot table
    (PK on entity_id, no dated history, per spec §4.2), so — unlike vendor
    symbols above — overwriting on a new value is the CORRECT behavior here
    (the point of the table is "the latest known FIGI"), not a rejected
    conflict. `changed` distinguishes a genuine value update from a
    byte-identical re-run, so a caller/log can note when a FIGI actually
    moved rather than treating every call as equally uneventful."""
    conn = _conn(db_path)
    existing = conn.execute(
        "SELECT composite_figi, share_class_figi FROM entity_figi WHERE entity_id = ?",
        (entity_id,),
    ).fetchone()
    changed = existing is not None and existing != (composite_figi, share_class_figi)
    written = existing is None or changed
    conn.execute(
        "INSERT INTO entity_figi(entity_id, composite_figi, share_class_figi, source, updated_at) "
        "VALUES (?,?,?,?,?) "
        "ON CONFLICT(entity_id) DO UPDATE SET "
        "composite_figi=excluded.composite_figi, share_class_figi=excluded.share_class_figi, "
        "source=excluded.source, updated_at=excluded.updated_at",
        (entity_id, composite_figi, share_class_figi, source, now_iso()),
    )
    return written, changed
