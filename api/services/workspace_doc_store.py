"""TERM-021 (FB-S5-01) — one versioned workspace document per board, in its own store.

WHAT THIS REPLACES, EVENTUALLY. The Charts workspace ("the board") persists as a dozen
loosely-coupled keys in ``auth.db user_preferences`` (opaque TEXT, no cap, no DELETE route,
no history). A template apply is 6-7 separate writes with no transaction, and a corrupt
``charts_workspace_layout`` blob parses to null, renders as a new user's default board and is
autosaved over the original within 500 ms (ledger C7, STATE-2). Nothing can bring it back.

WHAT THIS SLICE IS: the destination store and its document model, running as a SHADOW.

  * ``/data/workspace_docs.db`` (``WORKSPACE_DOCS_DB_PATH``) — its own per-domain file, never a
    table in auth.db. Registered in ``store_backup.STORES`` so it is backed up the night it exists.
  * APPEND-ONLY versions (ledger G3's idiom): every change is a new row; nothing is ever
    UPDATEd; a delete APPENDS a tombstone; a restore APPENDS a copy of an older version. The ONE
    exception is RETENTION: ``prune_versions`` is the only function that may remove a row, only
    from ``workspace_doc_versions``, only while the flag is armed, and it records what it removed
    in ``workspace_doc_prune_log``. ``tests/test_workspace_doc_store.py`` asserts by AST that no
    UPDATE exists anywhere and that the module's only row removal is that one, in that function.
  * RETENTION (owner decision, delegated): per (user, board) a version is KEPT if it is from the
    last ``RETAIN_DAYS`` (30) OR among the newest ``RETAIN_NEWEST`` (200) — either rule is enough.
    Whatever the rules say, the newest version, every tombstone, the version a tombstone deleted
    and every version a restore copied are never pruned (``_protected_versions``). It runs
    opportunistically after a mirrored append, bounded to ``PRUNE_MAX_PER_CALL`` rows per call.
  * ATOMIC compare-and-set writes: a write names the version it was based on, and a stale base
    is refused with ``VersionConflict`` — never a silent last-write-wins overwrite.
  * A schema version on every row from the first commit (``SCHEMA_VERSION``).
  * WRITE-BOTH / READ-OLD: while ``WORKSPACE_DOC_STORE_ENABLED`` is on, every workspace-key write
    to ``POST /api/auth/preferences`` is ALSO mirrored here — after a pre-write snapshot, so the
    value a write replaces is always kept as the version before it. ``user_preferences`` stays
    the authority every client reads. With the flag off nothing here runs and no file is created.

⛔ THE DOCUMENT NEVER RENAMES OR RESHAPES A KEY (GOVERNING_PRINCIPLES §13, MG-4). A version holds
``{"schema_version": 1, "board": "charts", "prefs": {<pref key>: <the exact TEXT user_preferences
holds>}}``. Values are stored VERBATIM, corrupt ones included — a value that fails to parse is
recorded in ``workspace_parse_failures`` and KEPT, because dropping it is the data-loss path this
store exists to close. ``prefs_from_doc`` is the read-fallback shim: it returns the same keys and
the same bytes the old store would, so the read-new phase can serve either without a rename.

⛔ REVERSAL (TIER-NONE, written in the same commit): unset ``WORKSPACE_DOC_STORE_ENABLED``. The
mirror stops, every route answers 404, ``user_preferences`` was never displaced as the authority,
and the store file is left exactly as it is. Never delete the file or its rows to "undo" an
arming — item 37: stopping a dark run is never a DELETE against member data. Unsetting the flag
also stops retention: ``prune_versions`` returns before any I/O while it is off, so the rows that
remain are exactly the rows that were there when it was switched off.
"""
from __future__ import annotations

import contextlib
import hashlib
import json
import logging
import os
import sqlite3
import threading
import time
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

_DB_PATH = os.environ.get("WORKSPACE_DOCS_DB_PATH", "/data/workspace_docs.db")
ENABLED_ENV = "WORKSPACE_DOC_STORE_ENABLED"

SCHEMA_VERSION = 1
BOARD_CHARTS = "charts"
BOARDS = (BOARD_CHARTS,)

#: The board's persisted keys: every key ``app/src/pages/charts/ChartsWorkspace.jsx`` writes
#: through ``setPref``, plus the ``WIDGET_GLOBAL_PREF_KEYS`` values it writes in a loop.
#: ⛔ NOT a list to edit by hand: ``test_the_key_set_is_exactly_what_the_workspace_writes``
#: re-derives it from the client source and fails by name on any drift in either direction.
WORKSPACE_PREF_KEYS = frozenset({
    "aisearch_settings",
    "breadth_widget_settings",
    "chart_settings",
    "charts_active_template",
    "charts_merged",
    "charts_theme",
    "charts_vol_pane_pct",
    "charts_workspace_groups",
    "charts_workspace_layout",
    "fundamentals_settings",
    "theme_tracker_settings",
    "watchlist_settings",
})

#: Keys whose value is plain text rather than a JSON document (``setChartsTheme(t)`` writes the
#: theme id raw; the volume-pane split is cleared with ``''``). A parse check on these would be a
#: false alarm, and an alarm that fires on healthy data is muted within a week.
PLAIN_TEXT_KEYS = frozenset({"charts_theme", "charts_vol_pane_pct"})

#: A bound the old store never had (C7: "opaque TEXT, no cap"). NOT measured against production:
#: a document over it is refused and the refusal is counted, never truncated.
MAX_DOC_BYTES = 4 * 1024 * 1024

SOURCES = ("migration", "mirror", "write", "restore", "delete")

#: RETENTION — owner decision (delegated). Per (user, board) a version survives if it was created
#: in the last ``RETAIN_DAYS`` days OR is among the newest ``RETAIN_NEWEST`` versions: EITHER rule
#: keeps it. ``_protected_versions`` names what is kept whatever these say.
RETAIN_DAYS = 30
RETAIN_NEWEST = 200
#: Bounded work per call: at most this many rows removed, and at most ``PRUNE_SCAN_ROWS`` (plus the
#: protected set) examined, oldest first. A backlog drains over successive appends.
PRUNE_MAX_PER_CALL = 100
PRUNE_SCAN_ROWS = 1000
_DAY = 86400

#: The clock that stamps ``created_at``. Injected so tests never read the wall clock; production
#: reads ``time.time`` through it.
_clock: Callable[[], float] = time.time

_WRITE_LOCK = threading.Lock()

#: Per-process counters for the hooks on the preferences write path. They never raise into that
#: path, so a failure there must land somewhere a reader can see it: here, in ``stats()``, and in
#: the log. Durable parse failures live in their own table.
_HOOK_FAILURES = {"snapshot": 0, "mirror": 0, "prune": 0}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS workspace_doc_versions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT    NOT NULL,
  board_id       TEXT    NOT NULL,
  version        INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  doc_json       TEXT,
  content_sha256 TEXT,
  tombstone      INTEGER NOT NULL,
  source         TEXT    NOT NULL,
  restored_from  INTEGER,
  created_at     INTEGER NOT NULL,
  UNIQUE(user_id, board_id, version)
);
CREATE INDEX IF NOT EXISTS idx_workspace_doc_head
  ON workspace_doc_versions(user_id, board_id, version DESC);

CREATE TABLE IF NOT EXISTS workspace_parse_failures (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT    NOT NULL,
  board_id    TEXT    NOT NULL,
  pref_key    TEXT    NOT NULL,
  version     INTEGER,
  raw_sha256  TEXT    NOT NULL,
  raw_len     INTEGER NOT NULL,
  error       TEXT    NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workspace_parse_failures_user
  ON workspace_parse_failures(user_id, board_id);

CREATE TABLE IF NOT EXISTS workspace_doc_prune_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT    NOT NULL,
  board_id       TEXT    NOT NULL,
  versions_json  TEXT    NOT NULL,
  pruned_count   INTEGER NOT NULL,
  head_version   INTEGER NOT NULL,
  cutoff         INTEGER NOT NULL,
  retain_newest  INTEGER NOT NULL,
  ran_at         INTEGER NOT NULL
);
"""


class VersionConflict(Exception):
    """A write named a base version that is no longer the head. Nothing was written."""

    def __init__(self, base_version: int, head_version: int):
        super().__init__(f"base version {base_version} is stale; head is {head_version}")
        self.base_version = base_version
        self.head_version = head_version


class InvalidDocument(ValueError):
    """The document does not satisfy the schema. Nothing was written."""


def is_enabled() -> bool:
    """Read PER CALL, never cached at import: unsetting the flag takes effect on the next request."""
    return os.environ.get(ENABLED_ENV, "0").strip().lower() in ("1", "true", "yes", "on")


# ── the connection ───────────────────────────────────────────────────────────
def _connect() -> sqlite3.Connection:
    """WAL, a 2 s busy timeout (the web pod's posture), short transactions, schema ensured.

    ⚠️ Connecting CREATES the file. Every caller that can run while dark is behind
    ``is_enabled()``; the store functions themselves do not check it, so tests drive them."""
    parent = os.path.dirname(_DB_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)
    conn = sqlite3.connect(_DB_PATH, timeout=10.0, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=2000")
    conn.executescript(_SCHEMA)
    return conn


# ── the document model ───────────────────────────────────────────────────────
def empty_doc(board_id: str = BOARD_CHARTS) -> dict:
    return {"schema_version": SCHEMA_VERSION, "board": board_id, "prefs": {}}


def validate_doc(doc: Any, board_id: str) -> dict:
    """The document, or ``InvalidDocument``. Keys outside the board's set never enter."""
    if not isinstance(doc, dict):
        raise InvalidDocument(f"document must be an object, got {type(doc).__name__}")
    sv = doc.get("schema_version")
    if isinstance(sv, bool) or sv != SCHEMA_VERSION:
        raise InvalidDocument(f"schema_version must be {SCHEMA_VERSION}, got {sv!r}")
    if doc.get("board") != board_id or board_id not in BOARDS:
        raise InvalidDocument(f"board must be {board_id!r} and one of {BOARDS}, got {doc.get('board')!r}")
    prefs = doc.get("prefs")
    if not isinstance(prefs, dict):
        raise InvalidDocument("prefs must be an object")
    unknown = sorted(set(prefs) - WORKSPACE_PREF_KEYS)
    if unknown:
        raise InvalidDocument(f"prefs carries keys outside the board: {unknown}")
    for k, v in prefs.items():
        if v is not None and not isinstance(v, str):
            raise InvalidDocument(f"prefs[{k!r}] must be the stored TEXT or null, got {type(v).__name__}")
    extra = sorted(set(doc) - {"schema_version", "board", "prefs"})
    if extra:
        raise InvalidDocument(f"unknown top-level fields: {extra}")
    if len(_canonical(doc).encode("utf-8")) > MAX_DOC_BYTES:
        raise InvalidDocument(f"document exceeds {MAX_DOC_BYTES} bytes")
    return doc


def _canonical(doc: dict) -> str:
    return json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def doc_from_prefs(prefs: dict, board_id: str = BOARD_CHARTS) -> dict:
    """COPY the board's keys out of a ``user_preferences`` mapping, values verbatim."""
    return {"schema_version": SCHEMA_VERSION, "board": board_id,
            "prefs": {k: prefs[k] for k in sorted(WORKSPACE_PREF_KEYS) if k in prefs}}


def prefs_from_doc(doc: dict) -> dict:
    """THE READ-FALLBACK SHIM: the same keys, the same bytes, the old store would return."""
    return dict((doc or {}).get("prefs") or {})


def parse_problem(key: str, value: Optional[str]) -> Optional[str]:
    """Why a stored value would not parse on the client, or None. Observational only."""
    if key in PLAIN_TEXT_KEYS or value is None or value == "":
        return None
    try:
        json.loads(value)
    except (ValueError, TypeError) as exc:
        return f"{type(exc).__name__}: {exc}"[:300]
    return None


# ── reads ────────────────────────────────────────────────────────────────────
def _row(r: sqlite3.Row, with_doc: bool = True) -> dict:
    out = {
        "version": r["version"],
        "schema_version": r["schema_version"],
        "tombstone": bool(r["tombstone"]),
        "source": r["source"],
        "restored_from": r["restored_from"],
        "content_sha256": r["content_sha256"],
        "created_at": r["created_at"],
    }
    if with_doc:
        out["doc"] = json.loads(r["doc_json"]) if r["doc_json"] is not None else None
    return out


def _head_row(c: sqlite3.Connection, user_id: str, board_id: str):
    return c.execute(
        "SELECT * FROM workspace_doc_versions WHERE user_id=? AND board_id=? ORDER BY version DESC LIMIT 1",
        (user_id, board_id),
    ).fetchone()


def head(user_id: str, board_id: str = BOARD_CHARTS) -> Optional[dict]:
    """The newest version (a tombstone included), or None when the board has no document."""
    with contextlib.closing(_connect()) as c:
        r = _head_row(c, user_id, board_id)
    return _row(r) if r else None


def get_version(user_id: str, board_id: str, version: int) -> Optional[dict]:
    with contextlib.closing(_connect()) as c:
        r = c.execute(
            "SELECT * FROM workspace_doc_versions WHERE user_id=? AND board_id=? AND version=?",
            (user_id, board_id, int(version)),
        ).fetchone()
    return _row(r) if r else None


def history(user_id: str, board_id: str = BOARD_CHARTS, limit: int = 50) -> list[dict]:
    """Version metadata, newest first, without the bodies."""
    limit = max(1, min(int(limit), 500))
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            "SELECT * FROM workspace_doc_versions WHERE user_id=? AND board_id=?"
            " ORDER BY version DESC LIMIT ?",
            (user_id, board_id, limit),
        ).fetchall()
    return [_row(r, with_doc=False) for r in rows]


def parse_failure_count(user_id: Optional[str] = None, board_id: str = BOARD_CHARTS) -> int:
    with contextlib.closing(_connect()) as c:
        if user_id is None:
            return c.execute("SELECT COUNT(*) FROM workspace_parse_failures").fetchone()[0]
        return c.execute(
            "SELECT COUNT(*) FROM workspace_parse_failures WHERE user_id=? AND board_id=?",
            (user_id, board_id),
        ).fetchone()[0]


def stats() -> dict:
    """Totals for the admin health route. A non-zero failure count is reported, never absorbed."""
    with contextlib.closing(_connect()) as c:
        docs = c.execute(
            "SELECT COUNT(*) FROM (SELECT DISTINCT user_id, board_id FROM workspace_doc_versions)"
        ).fetchone()[0]
        versions = c.execute("SELECT COUNT(*) FROM workspace_doc_versions").fetchone()[0]
        failures = c.execute("SELECT COUNT(*) FROM workspace_parse_failures").fetchone()[0]
        pruned = c.execute("SELECT COALESCE(SUM(pruned_count), 0) FROM workspace_doc_prune_log").fetchone()[0]
    return {"documents": docs, "versions": versions, "parse_failures": failures,
            "pruned_versions": pruned,
            "retention": {"days": RETAIN_DAYS, "newest": RETAIN_NEWEST, "max_per_call": PRUNE_MAX_PER_CALL},
            "hook_failures_this_process": dict(_HOOK_FAILURES), "enabled": is_enabled()}


# ── writes: every one of them APPENDS ─────────────────────────────────────────
def _append(c: sqlite3.Connection, user_id: str, board_id: str, version: int, *,
            doc: Optional[dict], source: str, restored_from: Optional[int] = None) -> None:
    text = _canonical(doc) if doc is not None else None
    c.execute(
        "INSERT INTO workspace_doc_versions (user_id, board_id, version, schema_version, doc_json,"
        " content_sha256, tombstone, source, restored_from, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (user_id, board_id, version, SCHEMA_VERSION, text, _sha(text) if text is not None else None,
         1 if doc is None else 0, source, restored_from, int(_clock())),
    )


def _record_failures(c: sqlite3.Connection, user_id: str, board_id: str, version: Optional[int],
                     items: dict) -> int:
    n = 0
    for key, value in sorted(items.items()):
        why = parse_problem(key, value)
        if why is None:
            continue
        c.execute(
            "INSERT INTO workspace_parse_failures (user_id, board_id, pref_key, version, raw_sha256,"
            " raw_len, error, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (user_id, board_id, key, version, _sha(value), len(value), why, int(_clock())),
        )
        n += 1
    if n:
        logger.warning("[workspace_doc] %d unparseable value(s) kept verbatim for %s/%s at v%s",
                       n, user_id, board_id, version)
    return n


def _cas_append(user_id: str, board_id: str, *, base_version: int, doc: Optional[dict], source: str,
                restored_from: Optional[int] = None, audit: Optional[dict] = None) -> dict:
    """The ONE write primitive: compare-and-set on the head version, then append.

    ``BEGIN IMMEDIATE`` takes the write lock before the head is read, so no second writer can
    land between the check and the insert; ``UNIQUE(user_id, board_id, version)`` is the fence
    behind it. A document byte-identical to a live head appends nothing (an autosaving client
    must not grow the history with no-op versions)."""
    if source not in SOURCES:
        raise ValueError(f"unknown source {source!r}")
    if doc is not None:
        validate_doc(doc, board_id)
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute("BEGIN IMMEDIATE")
        try:
            h = _head_row(c, user_id, board_id)
            head_v = h["version"] if h else 0
            if int(base_version) != head_v:
                raise VersionConflict(int(base_version), head_v)
            if doc is None and (h is None or h["tombstone"]):
                c.execute("ROLLBACK")
                return {"appended": False, "version": head_v, "tombstone": True}
            if (doc is not None and h is not None and not h["tombstone"]
                    and h["content_sha256"] == _sha(_canonical(doc))):
                c.execute("ROLLBACK")
                return {"appended": False, "version": head_v, "tombstone": False}
            new_v = head_v + 1
            _append(c, user_id, board_id, new_v, doc=doc, source=source, restored_from=restored_from)
            failures = _record_failures(c, user_id, board_id, new_v, audit or {})
            c.execute("COMMIT")
        except BaseException:
            if c.in_transaction:
                c.execute("ROLLBACK")
            raise
    return {"appended": True, "version": new_v, "tombstone": doc is None, "parse_failures": failures}


def write(user_id: str, board_id: str, doc: dict, *, base_version: int, source: str = "write") -> dict:
    """Append ``doc`` as the next version, or raise ``VersionConflict``. Values are audited."""
    validate_doc(doc, board_id)
    return _cas_append(user_id, board_id, base_version=base_version, doc=doc, source=source,
                       audit=prefs_from_doc(doc))


def tombstone(user_id: str, board_id: str, *, base_version: int) -> dict:
    """A delete APPENDS a tombstone. Every earlier version stays and can be restored."""
    return _cas_append(user_id, board_id, base_version=base_version, doc=None, source="delete")


def restore(user_id: str, board_id: str, target_version: int, *, base_version: int) -> dict:
    """Append a COPY of ``target_version`` as the new head. Nothing is rewritten.

    Returns the write result plus ``doc`` (what was restored). ``LookupError`` when the target
    does not exist or is itself a tombstone."""
    target = get_version(user_id, board_id, target_version)
    if target is None or target["tombstone"]:
        raise LookupError(f"version {target_version} does not exist or is a tombstone")
    doc = target["doc"]
    res = _cas_append(user_id, board_id, base_version=base_version, doc=doc, source="restore",
                      restored_from=int(target_version))
    res["doc"] = doc
    res["restored_from"] = int(target_version)
    return res


def ensure_snapshot(user_id: str, prefs_reader: Callable[[str], dict],
                    board_id: str = BOARD_CHARTS) -> dict:
    """COPY the member's current board out of ``user_preferences`` when there is no live head.

    This is the migration. It reads the old store and writes only here, so it can never move,
    rename or delete member data. It runs BEFORE a mirrored preference write, which is what makes
    the value that write replaces recoverable as the version before it — a corrupt blob about to
    be overwritten by a default board is kept verbatim as version N-1."""
    h = head(user_id, board_id)
    if h is not None and not h["tombstone"]:
        return {"snapshotted": False, "version": h["version"]}
    doc = doc_from_prefs(prefs_reader(user_id) or {}, board_id)
    base = h["version"] if h else 0
    try:
        res = _cas_append(user_id, board_id, base_version=base, doc=doc, source="migration",
                          audit=prefs_from_doc(doc))
    except VersionConflict as exc:
        # A concurrent request snapshotted first; its copy is the same copy.
        return {"snapshotted": False, "version": exc.head_version}
    return {"snapshotted": res["appended"], "version": res["version"]}


def mirror_pref(user_id: str, key: str, value: Optional[str], board_id: str = BOARD_CHARTS) -> dict:
    """Fold one confirmed ``user_preferences`` write into the document as the next version.

    The old store has already accepted the write and is the authority, so the mirror's base is
    whatever the head is right now; a concurrent mirror that lands first is retried once on its
    new head rather than overwritten."""
    for _attempt in range(2):
        h = head(user_id, board_id)
        base_doc = h["doc"] if (h is not None and not h["tombstone"]) else empty_doc(board_id)
        doc = {"schema_version": SCHEMA_VERSION, "board": board_id,
               "prefs": {**base_doc["prefs"], key: value}}
        try:
            return _cas_append(user_id, board_id, base_version=h["version"] if h else 0, doc=doc,
                               source="mirror", audit={key: value})
        except VersionConflict:
            continue
    raise VersionConflict(-1, -1)


# ── retention: the ONLY place a row is ever removed ──────────────────────────
def _protected_versions(c: sqlite3.Connection, user_id: str, board_id: str, head_version: int) -> set:
    """The versions no retention rule may remove, whatever their age or rank.

    * the newest version (the head), tombstone or not;
    * every tombstone — a delete must stay a visible fact in the history;
    * the version each tombstone deleted: the newest non-tombstone version below it, which is what
      a member restores after a delete;
    * every version a restore copied (``restored_from``).

    The current LIVE head needs no clause of its own: it is the head when the head is live, and the
    version the head tombstone deleted when it is not — both named above."""
    keep = {int(head_version)}
    keep.update(r[0] for r in c.execute(
        "SELECT version FROM workspace_doc_versions WHERE user_id=? AND board_id=? AND tombstone=1",
        (user_id, board_id)))
    keep.update(r[0] for r in c.execute(
        "SELECT (SELECT MAX(p.version) FROM workspace_doc_versions p"
        "  WHERE p.user_id=t.user_id AND p.board_id=t.board_id AND p.tombstone=0 AND p.version<t.version)"
        " FROM workspace_doc_versions t WHERE t.user_id=? AND t.board_id=? AND t.tombstone=1",
        (user_id, board_id)) if r[0] is not None)
    keep.update(r[0] for r in c.execute(
        "SELECT DISTINCT restored_from FROM workspace_doc_versions"
        " WHERE user_id=? AND board_id=? AND restored_from IS NOT NULL",
        (user_id, board_id)))
    return keep


def _survives(version: int, created_at: int, *, count_floor: int, cutoff: int) -> bool:
    """The owner's policy, in one expression: kept by the window OR kept by the count."""
    kept_by_window = int(created_at) >= cutoff
    kept_by_count = int(version) >= count_floor
    return kept_by_window or kept_by_count


def prune_versions(user_id: str, board_id: str, now: int, *, retain_days: Optional[int] = None,
                   retain_newest: Optional[int] = None, max_delete: Optional[int] = None) -> dict:
    """Remove the versions of one (user, board) that neither retention rule keeps. AUDITED.

    This is the ONLY function in the module allowed to remove a row, and it may only remove rows of
    ``workspace_doc_versions`` — ``tests/test_workspace_doc_store.py`` enforces both by AST. It
    never touches ``user_preferences``: it has no path to the old store at all.

    * Flag off ⇒ returns before ANY I/O (no connection, no file created).
    * ``now`` is injected (epoch seconds); a version created at or after ``now - retain_days`` is
      kept by the window, one ranked within the newest ``retain_newest`` is kept by the count.
    * ``_protected_versions`` is applied first and unconditionally.
    * Bounded: examines at most ``PRUNE_SCAN_ROWS`` (+ the protected set) rows, oldest first, and
      removes at most ``max_delete``. One transaction under the write lock, so it can never
      interleave with an append's compare-and-set.
    * Every removal is recorded in ``workspace_doc_prune_log`` in the same transaction.

    Parameters default to the module policy at CALL time (never bound at import), so the policy
    constants remain the single authority."""
    if not is_enabled():
        return {"armed": False, "pruned": [], "protected": []}
    days = RETAIN_DAYS if retain_days is None else int(retain_days)
    newest = RETAIN_NEWEST if retain_newest is None else int(retain_newest)
    cap = PRUNE_MAX_PER_CALL if max_delete is None else int(max_delete)
    if days < 0 or newest < 0 or cap < 0:
        raise ValueError("retention parameters must be non-negative")
    now = int(now)
    cutoff = now - days * _DAY
    doomed: list[int] = []
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute("BEGIN IMMEDIATE")
        try:
            h = _head_row(c, user_id, board_id)
            if h is None:
                c.execute("ROLLBACK")
                return {"armed": True, "pruned": [], "protected": []}
            head_v = int(h["version"])
            protected = _protected_versions(c, user_id, board_id, head_v)
            if newest == 0:
                count_floor = head_v + 1                  # the count rule keeps nothing
            else:
                r = c.execute(
                    "SELECT version FROM workspace_doc_versions WHERE user_id=? AND board_id=?"
                    " ORDER BY version DESC LIMIT 1 OFFSET ?", (user_id, board_id, newest - 1)).fetchone()
                count_floor = int(r["version"]) if r else 0   # fewer than `newest`: it keeps them all
            rows = c.execute(
                "SELECT version, created_at FROM workspace_doc_versions WHERE user_id=? AND board_id=?"
                " ORDER BY version ASC LIMIT ?",
                (user_id, board_id, PRUNE_SCAN_ROWS + len(protected))).fetchall()
            for r in rows:
                if len(doomed) >= cap:
                    break
                v = int(r["version"])
                if v in protected or _survives(v, r["created_at"], count_floor=count_floor, cutoff=cutoff):
                    continue
                doomed.append(v)
            if not doomed:
                c.execute("ROLLBACK")
                return {"armed": True, "pruned": [], "protected": sorted(protected)}
            c.executemany(
                "DELETE FROM workspace_doc_versions WHERE user_id=? AND board_id=? AND version=?",
                [(user_id, board_id, v) for v in doomed])
            c.execute(
                "INSERT INTO workspace_doc_prune_log (user_id, board_id, versions_json, pruned_count,"
                " head_version, cutoff, retain_newest, ran_at) VALUES (?,?,?,?,?,?,?,?)",
                (user_id, board_id, json.dumps(doomed, separators=(",", ":")), len(doomed), head_v,
                 cutoff, newest, now))
            c.execute("COMMIT")
        except BaseException:
            if c.in_transaction:
                c.execute("ROLLBACK")
            raise
    logger.info("[workspace_doc] pruned %d version(s) of %s/%s (v%s..v%s), head v%s",
                len(doomed), user_id, board_id, doomed[0], doomed[-1], head_v)
    return {"armed": True, "pruned": doomed, "protected": sorted(protected)}


# ── the two hooks on the preferences write path ──────────────────────────────
def begin_pref_write(user_id: str, key: str, prefs_reader: Callable[[str], dict]) -> Optional[dict]:
    """Called BEFORE ``user_preferences`` is written. ``None`` means "do nothing afterwards".

    ⛔ WITH THE FLAG OFF THIS RETURNS BEFORE ANY I/O: it does not read the preferences, does not
    open or create the store. ``test_flag_off_the_preference_write_path_is_untouched`` asserts
    exactly that. Never raises into the caller."""
    if not is_enabled() or key not in WORKSPACE_PREF_KEYS:
        return None
    try:
        ensure_snapshot(user_id, prefs_reader)
    except Exception as exc:  # noqa: BLE001 -- the member's write must never depend on the shadow
        _HOOK_FAILURES["snapshot"] += 1
        logger.warning("[workspace_doc] pre-write snapshot failed for %s/%s: %s", user_id, key, exc)
    return {"user_id": user_id, "key": key}


def finish_pref_write(ticket: Optional[dict], value: Optional[str]) -> None:
    """Called AFTER ``user_preferences`` accepted the write. Never raises into the caller.

    RETENTION RUNS HERE, opportunistically: an append that actually added a version is followed by
    one bounded ``prune_versions`` for that board. This is the only path that grows the history,
    so pruning where it grows keeps each board near its bound with no scheduler job. A ticket only
    exists while the flag is armed, and ``prune_versions`` re-reads the flag itself."""
    if ticket is None:
        return
    try:
        res = mirror_pref(ticket["user_id"], ticket["key"], value)
    except Exception as exc:  # noqa: BLE001
        _HOOK_FAILURES["mirror"] += 1
        logger.warning("[workspace_doc] mirror failed for %s/%s: %s", ticket["user_id"], ticket["key"], exc)
        return
    if not res.get("appended"):
        return
    try:
        prune_versions(ticket["user_id"], BOARD_CHARTS, int(_clock()))
    except Exception as exc:  # noqa: BLE001 -- retention must never fail a member's write
        _HOOK_FAILURES["prune"] = _HOOK_FAILURES.get("prune", 0) + 1
        logger.warning("[workspace_doc] prune failed for %s: %s", ticket["user_id"], exc)
