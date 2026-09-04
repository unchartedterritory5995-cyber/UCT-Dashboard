"""Dedicated SQLite store for the pattern engine.

The four pattern tables (pattern_detections / pattern_outcomes /
pattern_stats / pattern_feedback) lived in auth.db until 2026-07-16. The
hourly universe scan's write bursts held auth.db's single write lock and
starved broker syncs ("database is locked") — moving the engine to its own
file gives it its own writer and leaves auth.db to auth/journal traffic.

Path resolution: PATTERN_DB_PATH env override, else patterns.db next to
auth.db (so tests that point auth_db._DB_PATH at a tmp dir isolate this DB
too, and prod lands on the /data volume).

On first init against a fresh file, existing rows are copied one-shot from
auth.db's legacy tables (left in place as a frozen backup, per house idiom).
"""
from __future__ import annotations

import logging
import os
import sqlite3
import threading

logger = logging.getLogger(__name__)

_SCHEMA = """
    CREATE TABLE IF NOT EXISTS pattern_detections (
      id            TEXT PRIMARY KEY,
      sym           TEXT NOT NULL,
      tf            TEXT NOT NULL,
      pattern_id    TEXT NOT NULL,
      category      TEXT NOT NULL,
      direction     TEXT NOT NULL,
      start_t       INTEGER NOT NULL,
      end_t         INTEGER NOT NULL,
      confidence    REAL NOT NULL,
      quality_json  TEXT NOT NULL,
      geometry_json TEXT NOT NULL,
      levels_json   TEXT NOT NULL,
      context_json  TEXT NOT NULL,
      narrative_json TEXT NOT NULL,
      status        TEXT NOT NULL,
      detected_at   INTEGER NOT NULL,
      last_seen_at  INTEGER NOT NULL,
      hash_key      TEXT NOT NULL UNIQUE
    );

    CREATE INDEX IF NOT EXISTS idx_pd_sym_tf   ON pattern_detections(sym, tf);
    CREATE INDEX IF NOT EXISTS idx_pd_pattern  ON pattern_detections(pattern_id);
    CREATE INDEX IF NOT EXISTS idx_pd_status   ON pattern_detections(status);
    -- Every active-window reader and the prune filter on detected_at; without
    -- this the 7-day reads full-scanned the table (13.6 GB in prod by 2026-08-26).
    CREATE INDEX IF NOT EXISTS idx_pd_detected ON pattern_detections(detected_at);

    CREATE TABLE IF NOT EXISTS pattern_outcomes (
      detection_id  TEXT PRIMARY KEY REFERENCES pattern_detections(id),
      entry_hit     INTEGER NOT NULL DEFAULT 0,
      entry_hit_t   INTEGER,
      stop_hit      INTEGER NOT NULL DEFAULT 0,
      stop_hit_t    INTEGER,
      target_hit    INTEGER NOT NULL DEFAULT 0,
      target_hit_t  INTEGER,
      mfe_pct       REAL,
      mae_pct       REAL,
      bars_to_resolve INTEGER,
      resolved_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pattern_stats (
      pattern_id    TEXT NOT NULL,
      tf            TEXT NOT NULL,
      regime_bucket TEXT NOT NULL,
      n_total       INTEGER NOT NULL DEFAULT 0,
      n_resolved    INTEGER NOT NULL DEFAULT 0,
      n_entry_hit   INTEGER NOT NULL DEFAULT 0,
      n_target_hit  INTEGER NOT NULL DEFAULT 0,
      n_stop_hit    INTEGER NOT NULL DEFAULT 0,
      avg_mfe_pct   REAL,
      avg_mae_pct   REAL,
      median_bars   INTEGER,
      hit_rate      REAL,
      expectancy_R  REAL,
      last_updated  INTEGER NOT NULL,
      PRIMARY KEY (pattern_id, tf, regime_bucket)
    );

    CREATE TABLE IF NOT EXISTS pattern_feedback (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      detection_id  TEXT NOT NULL REFERENCES pattern_detections(id),
      user_id       TEXT NOT NULL,
      rating        TEXT NOT NULL,
      note          TEXT,
      created_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pf_detection ON pattern_feedback(detection_id);
"""

_TABLES = ("pattern_detections", "pattern_outcomes", "pattern_stats", "pattern_feedback")

# Phase 8 Package 8C: additive column for the canonical Eligibility section
# (types.py). CREATE TABLE IF NOT EXISTS in _SCHEMA above is a no-op against
# an already-existing table -- it will NOT add this column to the live
# production patterns.db, which already has the table. Mirrors the
# `_PHASE_2_ALTERS` idiom in api/services/journal_two/db.py exactly:
# idempotent via try/except, since SQLite has no ADD COLUMN IF NOT EXISTS.
# Nullable (no DEFAULT) is deliberate -- NULL means "eligibility was never
# computed for this row" (every row written before this change, and every
# row from a detector this section hasn't been wired to yet), never a
# fabricated True/False.
_PATTERN_ALTERS = (
    "ALTER TABLE pattern_detections ADD COLUMN eligibility_json TEXT",
)

# The legacy-migration bulk copy below used a bare `SELECT *`, which requires
# the source and destination column counts to match. Adding eligibility_json
# to the LOCAL table via _PATTERN_ALTERS means a legacy auth.db snapshot
# taken before this column existed has one column fewer -- an explicit list
# keeps the one-shot migration correct regardless of which side of that
# change either database is on. New rows simply get eligibility_json=NULL,
# the honest "not persisted for this row" state.
_PATTERN_DETECTIONS_LEGACY_COLUMNS = (
    "id, sym, tf, pattern_id, category, direction, start_t, end_t, confidence, "
    "quality_json, geometry_json, levels_json, context_json, narrative_json, "
    "status, detected_at, last_seen_at, hash_key"
)

# Legacy copy guard: prod auth.db held 2.37M detection rows (~15+ GB with the
# JSON blobs) — a blanket INSERT..SELECT built a 10 GB WAL inside one request
# and nearly filled the volume (2026-07-17). Detections/outcomes are transient
# (the hourly scan repopulates; consumers read the last 7 days), so the bulk
# tables migrate only when small. Stats + operator feedback are tiny and
# always copied.
_MIGRATE_MAX_ROWS = int(os.getenv("PATTERN_DB_MIGRATE_MAX_ROWS", "100000"))
_SMALL_TABLES = ("pattern_stats", "pattern_feedback")
_BULK_TABLES = ("pattern_detections", "pattern_outcomes")

_init_lock = threading.Lock()
_initialized_paths: set[str] = set()


class PatternDbSharedRootGuard(RuntimeError):
    """Raised when an unconfigured caller is about to resolve patterns.db
    onto this box's real, shared C:\\data directory instead of a safe
    per-worktree/per-session location.

    Package 8G-0 (2026-09): a standalone Python check run outside pytest
    briefly wrote synthetic HTF/PEG rows into the real, shared
    C:\\data\\patterns.db before being caught and cleaned up -- exactly the
    class of accident this guard exists to make loud instead of silent.
    """


def _would_hit_shared_root() -> bool:
    """True only when ALL of: no explicit override was given, we're on this
    box's own platform (Windows -- Railway's production runtime is always
    Linux, so this check is structurally inert there regardless of env
    state), and `auth_db`'s OWN existing local-dev fallback (see
    auth_db.py's own `if not os.path.exists(...)` guard) did NOT trigger --
    meaning `/data` genuinely exists here and every default resolution
    lands on the real, shared directory rather than a safe repo-local one.

    Pytest is unaffected: the repo-root conftest.py always pins
    AUTH_DB_PATH to an isolated temp path at collection time, so
    `auth_db._DB_PATH` never equals the raw unconfigured default under a
    test run, and this function returns False before ever reaching that
    comparison whenever a caller (test or otherwise) sets PATTERN_DB_PATH
    or AUTH_DB_PATH itself.

    Deliberately narrow, by design: this does not try to distinguish "the
    real app booted locally" from "an ad-hoc script" (no cheap, reliable
    signal for that was found) -- a local dev-server boot on this box with
    no override also asks for the explicit PATTERN_DB_ALLOW_SHARED_ROOT=1
    opt-in. That is accepted friction, not a gap: it costs one env var for
    a legitimate local run and closes the actual incident class (a bare
    script silently touching real, shared, cross-session data).
    """
    if os.name != "nt":
        return False
    if os.environ.get("PATTERN_DB_PATH") or os.environ.get("AUTH_DB_PATH"):
        return False
    if os.environ.get("PATTERN_DB_ALLOW_SHARED_ROOT") == "1":
        return False
    from api.services import auth_db
    # The exact literal auth_db.py's own default uses -- see its module
    # docstring/`_DB_PATH = os.environ.get("AUTH_DB_PATH", "/data/auth.db")`.
    raw_default = os.path.abspath("/data/auth.db")
    return os.path.abspath(auth_db._DB_PATH) == raw_default


def _db_path() -> str:
    override = os.environ.get("PATTERN_DB_PATH")
    if override:
        return override
    if _would_hit_shared_root():
        raise PatternDbSharedRootGuard(
            "patterns.db would resolve onto this box's real, shared "
            "C:\\data directory with no explicit override in effect. "
            "Set PATTERN_DB_PATH to an isolated file for an ad-hoc "
            "script or a standalone validation run, or set "
            "PATTERN_DB_ALLOW_SHARED_ROOT=1 if you deliberately intend "
            "to use the real, shared store."
        )
    from api.services import auth_db
    return os.path.join(os.path.dirname(os.path.abspath(auth_db._DB_PATH)), "patterns.db")


def _connect(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def _migrate_from_auth_db(conn: sqlite3.Connection) -> None:
    """One-shot copy of legacy pattern rows out of auth.db into this DB.
    Runs only when this DB has no detections yet. Legacy tables stay in
    auth.db untouched (frozen backup)."""
    n = conn.execute("SELECT COUNT(*) FROM pattern_detections").fetchone()[0]
    if n:
        return
    from api.services import auth_db
    src = os.path.abspath(auth_db._DB_PATH)
    if not os.path.exists(src):
        return
    try:
        conn.execute("ATTACH DATABASE ? AS legacy", (src,))
        try:
            def _legacy_has(t: str) -> bool:
                return conn.execute(
                    "SELECT name FROM legacy.sqlite_master WHERE type='table' AND name=?", (t,)
                ).fetchone() is not None

            if not _legacy_has("pattern_detections"):
                return
            copied = 0
            for t in _SMALL_TABLES:
                if _legacy_has(t):
                    cur = conn.execute(f"INSERT OR IGNORE INTO {t} SELECT * FROM legacy.{t}")
                    copied += max(cur.rowcount or 0, 0)
                    conn.commit()  # bound the WAL per table
            n_det = conn.execute("SELECT COUNT(*) FROM legacy.pattern_detections").fetchone()[0]
            if n_det > _MIGRATE_MAX_ROWS:
                print(f"[patterns] Legacy detections too large to migrate "
                      f"({n_det} rows > {_MIGRATE_MAX_ROWS}); scan repopulates hourly. "
                      f"Copied {copied} stats/feedback rows.")
                return
            for t in _BULK_TABLES:
                if _legacy_has(t):
                    if t == "pattern_detections":
                        cur = conn.execute(
                            f"INSERT OR IGNORE INTO {t} ({_PATTERN_DETECTIONS_LEGACY_COLUMNS}) "
                            f"SELECT {_PATTERN_DETECTIONS_LEGACY_COLUMNS} FROM legacy.{t}"
                        )
                    else:
                        cur = conn.execute(f"INSERT OR IGNORE INTO {t} SELECT * FROM legacy.{t}")
                    copied += max(cur.rowcount or 0, 0)
                    conn.commit()
            if copied:
                print(f"[patterns] Migrated {copied} legacy rows from auth.db into patterns.db")
        finally:
            conn.execute("DETACH DATABASE legacy")
    except sqlite3.Error as e:
        logger.warning("pattern legacy migration skipped: %s", e)


def _apply_pattern_alters(conn: sqlite3.Connection) -> None:
    """Idempotent additive-column migration (Phase 8 Package 8C). Same idiom
    as _PHASE_2_ALTERS in api/services/journal_two/db.py: try each ALTER,
    swallow only "duplicate column"/"already exists" (SQLite has no ADD
    COLUMN IF NOT EXISTS), re-raise anything else."""
    for stmt in _PATTERN_ALTERS:
        try:
            conn.execute(stmt)
        except sqlite3.OperationalError as e:
            msg = str(e).lower()
            if "duplicate column" not in msg and "already exists" not in msg:
                raise
    conn.commit()


def init_db() -> None:
    """Idempotent schema init (+ additive-column migration + one-shot legacy
    migration) for the current path."""
    path = _db_path()
    with _init_lock:
        if path in _initialized_paths:
            return
        conn = _connect(path)
        try:
            conn.executescript(_SCHEMA)
            conn.commit()
            _apply_pattern_alters(conn)
            _migrate_from_auth_db(conn)
        finally:
            conn.close()
        _initialized_paths.add(path)
        print(f"[patterns] Pattern DB ready at {path}")


def get_connection() -> sqlite3.Connection:
    """Connection to the pattern DB; ensures schema on first use per path."""
    init_db()
    return _connect(_db_path())
