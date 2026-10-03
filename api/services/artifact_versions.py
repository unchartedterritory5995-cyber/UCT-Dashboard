"""COV-06 — version history on a member's own named artefacts: saved screens, named layouts and
watchlists.

DARK behind ``ARTIFACT_VERSIONS_ENABLED`` (read per call). Unset, ``record_save`` returns before
any I/O, every route answers 404, and no file is opened or created.

WHERE IT LIVES — THE TERM-021 STORE FILE, NOT A SECOND STORE. The rows go into
``workspace_docs.db`` (the path is READ from ``workspace_doc_store._DB_PATH`` at call time, never
restated), so they ride the backup that file already has (``store_backup.STORES`` backs up the
whole file, every table). They do NOT go into ``workspace_doc_versions``: that table's document
model is the /charts board's closed pref-key set (railed against the client source), its
retention is 30 days / 200 deep, and its flag is ARMED in production — bending it to hold a
screen spec would change a live store's validation and retention under a dark ticket. Same file,
same append-only idiom, own table.

THE MODEL. One row per version of one artefact, keyed ``(user_id, kind, artifact_id, version)``.
``payload`` is the artefact's own stored TEXT columns, VERBATIM (a corrupt value is kept as it
was — dropping it is the data-loss path history exists to close):

  * ``screen`` — ``{"name": ..., "spec_json": ...}`` (``is_public`` / ``share_token`` are NOT
    content: a restore never re-publishes a screen its owner unpublished);
  * ``layout`` — ``{"layout_json": ..., "groups_json": ...}`` (the NAME is not content: it is
    UNIQUE per member, so restoring an old name could collide; ``label`` records it for display).
  * ``watchlist`` — ``{"name", "description", "items_json"}``. ``items_json`` is the list's
    MEMBERSHIP as one snapshot (``[{"sym", "notes"}, ...]`` in display order), because a list is
    edited in many small writes (add / remove / reorder / note) and only the whole list is a
    state a member can return to. Publication (``is_public``) is not content. A list whose items
    are not the member's (the flagged shadow list, an admin INDEX list, a LINKED list) has no
    history: its owner of record is a sync, a curator, or a source.

THE RULES.
  * SNAPSHOT ON EVERY SAVE (``record_save``), after the artefact's own write committed. A save
    byte-identical to the head appends nothing.
  * PRE-WRITE BASELINE: when the value a save REPLACED is not the head (no history yet — the
    artefact predates arming — or a save happened while dark, or a hook failed), that value is
    appended first as ``baseline``. So the first save after arming is already undoable.
  * RESTORE APPENDS: a restore writes the old payload back through the artefact's own store and
    appends it as a NEW version (``source='restore'``, ``restored_from=N``). Nothing is removed by
    a restore, so a restore is itself undone by restoring the version before it.
  * RETENTION — the ONLY row removal in this module, in ``_prune``, only while armed, every
    removal recorded in ``artifact_version_prune_log``:
      1. COALESCE: a ``save`` that the next ``save`` superseded within ``COALESCE_SECONDS`` is a
         keystroke, not a checkpoint, and is removed. Named layouts AUTO-SAVE ~400 ms after every
         arrangement change (``ChartsWorkspace.jsx``), so without this ten drags would flush the
         whole history. A ``baseline``, a ``restore``, and a save superseded by a restore are
         never coalesced — the state a restore replaced is exactly what its undo needs.
      2. DEPTH: of what survives, the newest ``RETAIN_VERSIONS`` (10, Bloomberg MNRS) are kept.
  * A hook failure never fails the member's save: it is counted (``stats()``), logged, and the
    next save's baseline step heals the gap.

  * DELETE KEEPS A TOMBSTONE (``record_delete``): a delete while armed appends the content it
    removed (a ``baseline`` first if that content was never versioned) and then a ``delete`` row
    holding the same payload. The history therefore OUTLIVES the artefact, and the artefact can be
    brought back from any kept version (the routers' ``undelete``). A tombstone is never coalesced
    (only save-after-save is), and the save that follows it always appends — a ``delete`` head is
    not "the current content".

⛔ REVERSAL: unset ``ARTIFACT_VERSIONS_ENABLED``. Saves stop being recorded, the routes answer
404, retention stops, and the rows are LEFT IN PLACE. Never delete them to undo an arming.
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
from typing import Callable, Optional

logger = logging.getLogger(__name__)

ENABLED_ENV = "ARTIFACT_VERSIONS_ENABLED"
SCHEMA_VERSION = 1

KIND_SCREEN = "screen"
KIND_LAYOUT = "layout"
KIND_WATCHLIST = "watchlist"
KINDS = (KIND_SCREEN, KIND_LAYOUT, KIND_WATCHLIST)

#: The fields that ARE an artefact's content, per kind. A payload carries exactly these.
CONTENT_FIELDS = {
    KIND_SCREEN: ("name", "spec_json"),
    KIND_LAYOUT: ("layout_json", "groups_json"),
    KIND_WATCHLIST: ("name", "description", "items_json"),
}

SOURCE_BASELINE = "baseline"
SOURCE_SAVE = "save"
SOURCE_RESTORE = "restore"
SOURCE_DELETE = "delete"
SOURCES = (SOURCE_BASELINE, SOURCE_SAVE, SOURCE_RESTORE, SOURCE_DELETE)

#: Bloomberg MNRS keeps ten.
RETAIN_VERSIONS = 10
#: A save superseded by the next save within this many seconds is coalesced away.
COALESCE_SECONDS = 60

#: Injected so tests never read the wall clock.
_clock: Callable[[], float] = time.time

_WRITE_LOCK = threading.Lock()
_HOOK_FAILURES = {"record": 0}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS artifact_versions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  schema_version INTEGER NOT NULL,
  user_id        TEXT    NOT NULL,
  kind           TEXT    NOT NULL,
  artifact_id    TEXT    NOT NULL,
  version        INTEGER NOT NULL,
  source         TEXT    NOT NULL,
  label          TEXT,
  payload_json   TEXT    NOT NULL,
  content_sha256 TEXT    NOT NULL,
  restored_from  INTEGER,
  created_at     INTEGER NOT NULL,
  UNIQUE(user_id, kind, artifact_id, version)
);
CREATE INDEX IF NOT EXISTS idx_artifact_versions_owner
  ON artifact_versions(user_id, kind, artifact_id, version DESC);
CREATE TABLE IF NOT EXISTS artifact_version_prune_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT    NOT NULL,
  kind           TEXT    NOT NULL,
  artifact_id    TEXT    NOT NULL,
  version        INTEGER NOT NULL,
  reason         TEXT    NOT NULL,
  content_sha256 TEXT    NOT NULL,
  created_at     INTEGER NOT NULL
);
"""


def is_enabled() -> bool:
    """Read PER CALL, never cached at import."""
    return os.environ.get(ENABLED_ENV, "0").strip().lower() in ("1", "true", "yes", "on")


def _db_path() -> str:
    # ONE path authority: the TERM-021 store's own constant, read at call time.
    from api.services import workspace_doc_store
    return workspace_doc_store._DB_PATH


def _connect() -> sqlite3.Connection:
    """⚠️ Connecting CREATES the file. Every caller reachable while dark is behind ``is_enabled()``."""
    path = _db_path()
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    conn = sqlite3.connect(path, timeout=10.0, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=2000")
    conn.executescript(_SCHEMA)
    return conn


def _canonical(payload: dict) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def content(kind: str, row: dict) -> dict:
    """The payload of ``kind`` from a mapping that holds its stored columns."""
    if kind not in KINDS:
        raise ValueError(f"unknown kind {kind!r}")
    return {f: row.get(f) for f in CONTENT_FIELDS[kind]}


def _meta(r: sqlite3.Row) -> dict:
    return {"version": r["version"], "source": r["source"], "label": r["label"],
            "restored_from": r["restored_from"], "created_at": r["created_at"]}


def _head_row(c, user_id: str, kind: str, artifact_id: str):
    return c.execute(
        "SELECT * FROM artifact_versions WHERE user_id=? AND kind=? AND artifact_id=?"
        " ORDER BY version DESC LIMIT 1", (str(user_id), kind, str(artifact_id))).fetchone()


# ── reads ────────────────────────────────────────────────────────────────────
def head(user_id: str, kind: str, artifact_id) -> Optional[dict]:
    with contextlib.closing(_connect()) as c:
        r = _head_row(c, user_id, kind, artifact_id)
    return _meta(r) if r else None


def history(user_id: str, kind: str, artifact_id) -> list[dict]:
    """Newest first. Metadata only; ``get_version`` carries the payload."""
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            "SELECT * FROM artifact_versions WHERE user_id=? AND kind=? AND artifact_id=?"
            " ORDER BY version DESC", (str(user_id), kind, str(artifact_id))).fetchall()
    return [_meta(r) for r in rows]


def get_version(user_id: str, kind: str, artifact_id, version: int) -> Optional[dict]:
    with contextlib.closing(_connect()) as c:
        r = c.execute(
            "SELECT * FROM artifact_versions WHERE user_id=? AND kind=? AND artifact_id=? AND version=?",
            (str(user_id), kind, str(artifact_id), int(version))).fetchone()
    if not r:
        return None
    return {**_meta(r), "payload": json.loads(r["payload_json"])}


def owned_ids(user_id: str, kind: str) -> list[dict]:
    """Every artefact of ``kind`` this member has history for, with its HEAD row's metadata,
    newest first. The router decides which of them no longer exist (the delete is the artefact
    store's fact, not this one's)."""
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            "SELECT v.* FROM artifact_versions v JOIN ("
            "  SELECT artifact_id, MAX(version) AS hv FROM artifact_versions"
            "  WHERE user_id=? AND kind=? GROUP BY artifact_id) h"
            " ON v.artifact_id=h.artifact_id AND v.version=h.hv"
            " WHERE v.user_id=? AND v.kind=? ORDER BY v.created_at DESC, v.id DESC",
            (str(user_id), kind, str(user_id), kind)).fetchall()
    return [{"artifact_id": r["artifact_id"], **_meta(r)} for r in rows]


def stats() -> dict:
    return {"enabled": is_enabled(), "hook_failures": dict(_HOOK_FAILURES)}


# ── the one write ────────────────────────────────────────────────────────────
def _append(c, user_id, kind, artifact_id, version, *, payload, source, label, restored_from) -> None:
    text = _canonical(payload)
    c.execute(
        "INSERT INTO artifact_versions (schema_version, user_id, kind, artifact_id, version, source,"
        " label, payload_json, content_sha256, restored_from, created_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (SCHEMA_VERSION, str(user_id), kind, str(artifact_id), version, source, label, text,
         _sha(text), restored_from, int(_clock())))


def record_save(user_id, kind: str, artifact_id, *, before: Optional[dict], after: dict,
                label: Optional[str] = None, source: str = SOURCE_SAVE,
                restored_from: Optional[int] = None) -> Optional[dict]:
    """Record one committed save of an artefact. ``before`` is what the save replaced (``None`` for
    a create). Returns ``{"appended", "version"}``, or ``None`` while dark or on a hook failure —
    NEVER raises into the member's save."""
    if not is_enabled():
        return None
    try:
        return _record(user_id, kind, artifact_id, before=before, after=after, label=label,
                       source=source, restored_from=restored_from)
    except Exception as exc:  # noqa: BLE001 -- counted and logged; the save already committed
        _HOOK_FAILURES["record"] += 1
        logger.warning("[artifact_versions] record failed %s/%s/%s: %s", user_id, kind, artifact_id, exc)
        return None


def _record(user_id, kind, artifact_id, *, before, after, label, source, restored_from) -> dict:
    if kind not in KINDS:
        raise ValueError(f"unknown kind {kind!r}")
    if source not in (SOURCE_SAVE, SOURCE_RESTORE):
        raise ValueError(f"unknown save source {source!r}")
    after = content(kind, after)
    after_sha = _sha(_canonical(after))
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute("BEGIN IMMEDIATE")
        try:
            h = _head_row(c, user_id, kind, artifact_id)
            head_v = h["version"] if h else 0
            # A tombstone holds the content that was REMOVED, not what is stored now: the save
            # after it (an undelete) must always append.
            head_sha = h["content_sha256"] if h and h["source"] != SOURCE_DELETE else None
            if before is not None:
                before = content(kind, before)
                before_sha = _sha(_canonical(before))
                if before_sha != head_sha and before_sha != after_sha:
                    head_v += 1
                    _append(c, user_id, kind, artifact_id, head_v, payload=before,
                            source=SOURCE_BASELINE, label=label, restored_from=None)
                    head_sha = before_sha
            if after_sha == head_sha:
                c.execute("COMMIT")
                return {"appended": False, "version": head_v}
            head_v += 1
            _append(c, user_id, kind, artifact_id, head_v, payload=after, source=source,
                    label=label, restored_from=restored_from)
            _prune(c, user_id, kind, artifact_id)
            c.execute("COMMIT")
        except BaseException:
            if c.in_transaction:
                c.execute("ROLLBACK")
            raise
    return {"appended": True, "version": head_v}


def record_delete(user_id, kind: str, artifact_id, *, before: dict,
                  label: Optional[str] = None) -> Optional[dict]:
    """Record that an artefact was deleted: its last content (``before``) as a ``baseline`` if it
    is not already the head, then a ``delete`` tombstone carrying the same payload. ``None`` while
    dark or on a hook failure — NEVER raises into the member's delete."""
    if not is_enabled():
        return None
    try:
        return _record_delete(user_id, kind, artifact_id, before=before, label=label)
    except Exception as exc:  # noqa: BLE001 -- counted and logged; the delete already committed
        _HOOK_FAILURES["record"] += 1
        logger.warning("[artifact_versions] tombstone write failed %s/%s/%s: %s", user_id, kind, artifact_id, exc)
        return None


def _record_delete(user_id, kind, artifact_id, *, before, label) -> dict:
    if kind not in KINDS:
        raise ValueError(f"unknown kind {kind!r}")
    before = content(kind, before)
    before_sha = _sha(_canonical(before))
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute("BEGIN IMMEDIATE")
        try:
            h = _head_row(c, user_id, kind, artifact_id)
            head_v = h["version"] if h else 0
            if h is None or h["content_sha256"] != before_sha:
                head_v += 1
                _append(c, user_id, kind, artifact_id, head_v, payload=before,
                        source=SOURCE_BASELINE, label=label, restored_from=None)
            head_v += 1
            _append(c, user_id, kind, artifact_id, head_v, payload=before,
                    source=SOURCE_DELETE, label=label, restored_from=None)
            _prune(c, user_id, kind, artifact_id)
            c.execute("COMMIT")
        except BaseException:
            if c.in_transaction:
                c.execute("ROLLBACK")
            raise
    return {"appended": True, "version": head_v}


# ── retention: the ONLY row removal ──────────────────────────────────────────
def _prune(c, user_id, kind, artifact_id) -> list[int]:
    """Coalesce keystroke saves, then keep the newest ``RETAIN_VERSIONS``. Inside the caller's
    transaction; every removal is logged. Returns the versions removed."""
    if not is_enabled():
        return []
    # Arch 5-B.8: member rows are removed only under a DECLARED retention entry; an
    # undeclared prune deletes nothing (store_retention fails closed).
    from api.services import store_retention
    if not store_retention.may_prune("workspace_docs", "artifact_versions"):
        return []
    rows = c.execute(
        "SELECT version, source, created_at, content_sha256 FROM artifact_versions"
        " WHERE user_id=? AND kind=? AND artifact_id=? ORDER BY version ASC",
        (str(user_id), kind, str(artifact_id))).fetchall()
    drop: dict[int, tuple] = {}
    for cur, nxt in zip(rows, rows[1:]):
        if (cur["source"] == SOURCE_SAVE and nxt["source"] == SOURCE_SAVE
                and nxt["created_at"] - cur["created_at"] < COALESCE_SECONDS):
            drop[cur["version"]] = ("coalesced", cur["content_sha256"])
    survivors = [r for r in rows if r["version"] not in drop]
    for r in survivors[:-RETAIN_VERSIONS] if len(survivors) > RETAIN_VERSIONS else []:
        drop[r["version"]] = ("depth", r["content_sha256"])
    now = int(_clock())
    for version, (reason, sha) in sorted(drop.items()):
        c.execute(
            "INSERT INTO artifact_version_prune_log (user_id, kind, artifact_id, version, reason,"
            " content_sha256, created_at) VALUES (?,?,?,?,?,?,?)",
            (str(user_id), kind, str(artifact_id), version, reason, sha, now))
        c.execute(
            "DELETE FROM artifact_versions WHERE user_id=? AND kind=? AND artifact_id=? AND version=?",
            (str(user_id), kind, str(artifact_id), version))
    return sorted(drop)
