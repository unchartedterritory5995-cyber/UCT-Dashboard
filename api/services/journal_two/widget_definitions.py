"""Stored widgets: the member's saved widgets, their revisions, If-Match and the 30-day purge.

Notebook widgets phase 2, Task 8.8. The storage layer only; the router is Task 8.9.

Two tables (db._PHASE_2_ALTERS), both purged with the account:
  * `j2_widget_definitions` -- one row per widget. `rev` is the newest revision,
    `placed_rev` the revision every placement runs at least (an "update everywhere" save
    moves it), `last_answer` the member's last answer to "update everywhere / save as new".
  * `j2_widget_definition_revs` -- one row per revision, `(definition_id, rev)`.

Rules this module keeps:
  * Ownership: every read and write is `WHERE id = ? AND user_id = ?`. A foreign or deleted
    id is absent: reads return None, writes raise `NotFound`.
  * If-Match (ruling R-15): every widget carries `save_seq`, returned as `etag`, bumped on
    EVERY save -- a new revision, a save coalesced into the same revision, a restore, a
    rename. The HTTP If-Match header carries `etag`, and `if_match` is compared with
    `save_seq`, never with `rev`: a coalesced save keeps `rev`, so `rev` cannot tell two
    tabs apart inside the coalesce window. Any other value is `Conflict` (409, "Changed in
    another tab. Reload to see the newer version.") and nothing is written. `rev` and
    `placedRev` stay the member-visible revision numbers.
  * Plans are stored as the member saved them. A stored plan is upgraded in memory on read
    (`plan.upgrade_plan`) and written back only on a member save; nothing here rewrites
    stored plans in bulk. A plan newer than the server knows is returned with
    `tooNew: True` and its stored summary, and every save to it is refused (`PlanTooNew`).
  * Revisions: a save within `COALESCE_S` of the newest UNNAMED revision rewrites that
    revision in place (same rev); otherwise it is a new revision. Only the newest
    `REVS_KEPT` unnamed revisions are kept, plus every named one, plus the placed one.
    ⛔ A save never coalesces into the PLACED revision unless it is an "update everywhere"
    save: placements run `max(def_rev, placed_rev)`, so rewriting the placed revision in
    place would change what every placed copy shows behind an "only here" save.
    ⛔ Ruling R-16: a save coalesces only with a revision saved from the SAME place -- the
    same note (`origin`, the note id) or both from My tools (`origin` None). Two notes'
    "only here" saves are never merged into one revision.
  * Count cap: `COUNT_CAP` widgets that are neither archived nor deleted per member.
  * Used in (Task 8.9): `usedIn` is the number of DISTINCT live notes of the member's
    that place the widget, read from the `j2_tool_uses` projection (notes._sync_note_sidecars
    keeps it) joined to `j2_notes` -- not trashed, not a sample note. The join is on
    `user_id` too, so another member's note naming this id never counts.
    `used_in_notes` lists those notes.
  * Delete: only from archived, only when the typed name equals the name, and soft
    (`deleted_at`). A member's own rows deleted more than `RECENTLY_DELETED_DAYS` ago are
    hard-deleted, with their revisions, whenever that member lists their widgets.

Connections: every function takes `conn=`. With no connection it opens one and closes it.
A caller connection that is NOT in a transaction is used for this call's own write
transaction, which is committed (or rolled back) before returning; a caller connection that
IS already in a transaction is joined, and committing it is left to the caller.

Time is injected (`now=`) everywhere a rule reads the clock, so tests never sleep.
The catalog is looked up lazily (`sources.CATALOG`, Task 8.5) and every entry point that
validates takes `catalog=` so a caller or a test can pass its own.
"""
from __future__ import annotations

import json
import sqlite3
import time as _time
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, Iterator, Literal

from api.services import auth_db
from api.services.journal_two import sample_marker
from api.services.journal_two.widget_engine.plan import (
    MAX_TEXT,
    PLAN_VERSION,
    PlanError,
    PlanTooNew,
    default_name,
    needed_version,
    summary as plan_summary,
    upgrade_plan,
    validate_plan,
)

__all__ = [
    "COUNT_CAP", "REVS_KEPT", "COALESCE_S", "RECENTLY_DELETED_DAYS",
    "WidgetError", "NotFound", "Conflict", "PlanError", "PlanTooNew",
    "create", "get", "update", "list_defs", "revs", "name_rev", "restore_rev",
    "archive", "unarchive", "soft_delete", "undelete", "resolve_for_run", "used_in_notes",
]

COUNT_CAP = 100
REVS_KEPT = 50
COALESCE_S = 60
RECENTLY_DELETED_DAYS = 30

APPLY_ANSWERS = ("update_all", "save_new", "only")

S_CAP = "You have 100 widgets. Archive one in My tools to make room."
S_CONFLICT = "Changed in another tab. Reload to see the newer version."
S_NOT_FOUND = "That widget isn't available."
S_ARCHIVE_FIRST = "Archive this widget before deleting it."
S_TYPE_NAME = "Type the widget's name exactly to delete it."
S_BAD_APPLY = "Choose how to save this widget."
S_BAD_NAME = "Give the widget a name."
S_BAD_REV_NAME = "Give this version a name."

_DEFS = "j2_widget_definitions"
_REVS = "j2_widget_definition_revs"
_USES = "j2_tool_uses"
_KIND = "widget"

# The member's live, non-sample notes that place one of the member's OWN widgets (Task 8.9).
# Ownership is on all three tables: `u.user_id` is the note owner's (the sidecar writes it
# from the note write), `n.user_id` re-checks it against the note, and `d.user_id` makes a
# defId that is not the member's widget count and list nothing (treated as absent).
_USES_JOIN = (
    f" FROM {_USES} u JOIN j2_notes n ON n.id = u.note_id AND n.user_id = u.user_id"
    f" JOIN {_DEFS} d ON d.id = u.tool_id AND d.user_id = u.user_id"
    f" WHERE u.user_id = ? AND u.kind = '{_KIND}' AND n.deleted_at IS NULL"
    " AND " + sample_marker.not_sample_sql("n")
)


class WidgetError(ValueError):
    """A refusal whose message is a member sentence (`.sentence`), with an HTTP status."""

    status = 400

    def __init__(self, sentence: str):
        super().__init__(sentence)
        self.sentence = sentence


class NotFound(WidgetError):
    status = 404

    def __init__(self, sentence: str = S_NOT_FOUND):
        super().__init__(sentence)


class Conflict(WidgetError):
    status = 409

    def __init__(self, sentence: str = S_CONFLICT):
        super().__init__(sentence)


# -- plumbing -------------------------------------------------------------------

def _catalog(catalog: Any = None) -> Any:
    if catalog is not None:
        return catalog
    from api.services.journal_two.widget_engine import sources   # lazy: Task 8.5's module
    return sources.CATALOG


def _now(now: datetime | None) -> datetime:
    ts = now or datetime.now(timezone.utc)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(timezone.utc)


def _iso(ts: datetime) -> str:
    return ts.isoformat()


def _parse(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        ts = datetime.fromisoformat(s)
    except ValueError:
        return None
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


def _begin_immediate(conn: sqlite3.Connection, tries: int = 2, backoff: float = 0.15) -> None:
    """Take the write lock before the read (the notes CAS idiom), retrying once on a
    transient "database is locked": a BEGIN that raised has written nothing."""
    for attempt in range(tries):
        try:
            conn.execute("BEGIN IMMEDIATE")
            return
        except sqlite3.OperationalError as e:
            if "locked" in str(e).lower() and attempt < tries - 1:
                _time.sleep(backoff)
                continue
            raise


@contextmanager
def _write(conn: sqlite3.Connection | None) -> Iterator[sqlite3.Connection]:
    """A write transaction. No `conn`: open, BEGIN IMMEDIATE, commit, close. A caller `conn`
    outside a transaction: BEGIN IMMEDIATE and commit on it (it stays open). A caller `conn`
    already in a transaction: join it; the caller commits."""
    owned = conn is None
    c = conn or auth_db.get_connection()
    began = False
    try:
        if not c.in_transaction:
            _begin_immediate(c)
            began = True
        yield c
        if began:
            c.commit()
    except BaseException:
        if began:
            c.rollback()
        raise
    finally:
        if owned:
            c.close()


@contextmanager
def _read(conn: sqlite3.Connection | None) -> Iterator[sqlite3.Connection]:
    owned = conn is None
    c = conn or auth_db.get_connection()
    try:
        yield c
    finally:
        if owned:
            c.close()


def _clean_name(name: Any, refusal: str = S_BAD_NAME) -> str:
    if name is None:
        return ""
    if not isinstance(name, str):
        raise WidgetError(refusal)
    return name.strip()[:MAX_TEXT]


def _too_new(row: sqlite3.Row) -> bool:
    try:
        return int(row["plan_version"]) > PLAN_VERSION
    except (TypeError, ValueError):
        return False


def _read_plan(plan_json: str) -> tuple[Any, bool]:
    """(plan for the caller, too_new). Upgraded in memory; never written back here."""
    try:
        raw = json.loads(plan_json)
    except (TypeError, ValueError):
        return None, False
    try:
        return upgrade_plan(raw), False
    except PlanTooNew:
        return raw, True
    except PlanError:
        return raw, False


def _dump(plan: dict) -> str:
    return json.dumps(plan, separators=(",", ":"), ensure_ascii=False)


def _summary_for(plan: dict, catalog: Any) -> str:
    return plan_summary(plan, catalog, None, "")


def _owned(c: sqlite3.Connection, user_id: str, def_id: str, *, deleted: bool = False) -> sqlite3.Row | None:
    if not isinstance(def_id, str) or not def_id or not user_id:
        return None
    gate = "deleted_at IS NOT NULL" if deleted else "deleted_at IS NULL"
    return c.execute(
        f"SELECT * FROM {_DEFS} WHERE id = ? AND user_id = ? AND {gate}", (def_id, user_id)
    ).fetchone()


def _rev_row(c: sqlite3.Connection, user_id: str, def_id: str, rev: int) -> sqlite3.Row | None:
    return c.execute(
        f"SELECT * FROM {_REVS} WHERE definition_id = ? AND user_id = ? AND rev = ?",
        (def_id, user_id, rev),
    ).fetchone()


def _live_count(c: sqlite3.Connection, user_id: str) -> int:
    return c.execute(
        f"SELECT COUNT(*) FROM {_DEFS} WHERE user_id = ? AND archived_at IS NULL AND deleted_at IS NULL",
        (user_id,),
    ).fetchone()[0]


def _check_cap(c: sqlite3.Connection, user_id: str) -> None:
    if _live_count(c, user_id) >= COUNT_CAP:
        raise WidgetError(S_CAP)


def _used_in_count(c: sqlite3.Connection, user_id: str, def_id: str) -> int:
    return c.execute(
        "SELECT COUNT(DISTINCT u.note_id)" + _USES_JOIN + " AND u.tool_id = ?", (user_id, def_id)
    ).fetchone()[0]


def _used_in_counts(c: sqlite3.Connection, user_id: str) -> dict[str, int]:
    return {r[0]: r[1] for r in c.execute(
        "SELECT u.tool_id, COUNT(DISTINCT u.note_id)" + _USES_JOIN + " GROUP BY u.tool_id",
        (user_id,))}


def _shape(row: sqlite3.Row, summary_text: str | None, used_in: int = 0) -> dict:
    plan, too_new = _read_plan(row["plan_json"])
    too_new = too_new or _too_new(row)
    out = {
        "id": row["id"],
        "name": row["name"],
        "plan": plan,
        "rev": row["rev"],
        "placedRev": row["placed_rev"],
        "etag": row["save_seq"],
        "archived": row["archived_at"] is not None,
        "usedIn": used_in,
        "lastAnswer": row["last_answer"],
        "summary": summary_text or "",
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }
    if row["deleted_at"] is not None:
        out["deletedAt"] = row["deleted_at"]
    if row["source_gallery_id"] is not None:
        out["sourceGalleryId"] = row["source_gallery_id"]
        out["sourceVersion"] = row["source_version"]
    if too_new:
        out["tooNew"] = True
    return out


def _current_summary(c: sqlite3.Connection, row: sqlite3.Row) -> str:
    r = _rev_row(c, row["user_id"], row["id"], row["rev"])
    return r["summary"] if r is not None else ""


def _prune(c: sqlite3.Connection, user_id: str, def_id: str, keep: tuple[int, ...]) -> None:
    """Keep the newest REVS_KEPT unnamed revisions, every named one and the `keep` revs."""
    marks = ",".join("?" for _ in keep) or "NULL"
    c.execute(
        f"DELETE FROM {_REVS} WHERE definition_id = ? AND user_id = ? AND named IS NULL"
        f" AND rev NOT IN ({marks})"
        f" AND rev NOT IN (SELECT rev FROM {_REVS} WHERE definition_id = ? AND user_id = ?"
        f"  AND named IS NULL ORDER BY rev DESC LIMIT ?)",
        (def_id, user_id, *keep, def_id, user_id, REVS_KEPT),
    )


def _insert_new(c: sqlite3.Connection, user_id: str, name: str, plan: dict, summary_text: str,
                ts: str, source_gallery_id: str | None = None,
                source_version: int | None = None, origin: str | None = None) -> str:
    def_id = str(uuid.uuid4())
    c.execute(
        f"INSERT INTO {_DEFS} (id, user_id, name, plan_json, plan_version, rev, placed_rev,"
        " last_answer, created_at, updated_at, archived_at, deleted_at, source_gallery_id,"
        " source_version, save_seq) VALUES (?, ?, ?, ?, ?, 1, 1, NULL, ?, ?, NULL, NULL, ?, ?, 1)",
        (def_id, user_id, name, _dump(plan), needed_version(plan), ts, ts,
         source_gallery_id, source_version),
    )
    c.execute(
        f"INSERT INTO {_REVS} (user_id, definition_id, rev, plan_json, summary, saved_at, named,"
        " origin) VALUES (?, ?, 1, ?, ?, ?, NULL, ?)",
        (user_id, def_id, _dump(plan), summary_text, ts, origin),
    )
    return def_id


def _get_in(c: sqlite3.Connection, user_id: str, def_id: str) -> dict | None:
    row = _owned(c, user_id, def_id)
    if row is None:
        return None
    return _shape(row, _current_summary(c, row), _used_in_count(c, user_id, def_id))


# -- produces -------------------------------------------------------------------

def create(user_id: str, name: str | None, plan: dict, *, catalog: Any = None,
           now: datetime | None = None, conn: sqlite3.Connection | None = None,
           source_gallery_id: str | None = None, source_version: int | None = None) -> dict:
    """Save a new widget. Refuses over the cap with the cap sentence."""
    cat = _catalog(catalog)
    valid = validate_plan(plan, cat)                 # PlanTooNew / PlanError carry sentences
    clean = _clean_name(name) or default_name(valid, cat)
    summary_text = _summary_for(valid, cat)
    ts = _iso(_now(now))
    with _write(conn) as c:
        _check_cap(c, user_id)
        def_id = _insert_new(c, user_id, clean, valid, summary_text, ts,
                             source_gallery_id, source_version)
        return _get_in(c, user_id, def_id)


def get(user_id: str, def_id: str, *, conn: sqlite3.Connection | None = None) -> dict | None:
    """`{id, name, plan, rev, placedRev, archived, usedIn, lastAnswer, summary}`, or None for a
    foreign or deleted id. A plan newer than the server knows comes back as stored, with
    `tooNew: True` and its stored summary."""
    with _read(conn) as c:
        return _get_in(c, user_id, def_id)


def update(user_id: str, def_id: str, *, if_match: int, name: str | None = None,
           plan: dict | None = None, apply: Literal["update_all", "save_new", "only"],
           origin: str | None = None, catalog: Any = None, now: datetime | None = None,
           conn: sqlite3.Connection | None = None) -> dict:
    """Save a change. `update_all` moves every placement to the new revision; `only` leaves
    placements where they are; `save_new` makes a new widget and leaves this one as it is
    (only its remembered answer changes). Returns the widget written (the new one for
    `save_new`). `if_match` is the widget's `etag` (`save_seq`). `origin` is the note id the
    save came from, None from My tools; a save coalesces only with a revision of the same
    origin (ruling R-16). A `save_new` copy with no name given is called "<name> copy"."""
    if apply not in APPLY_ANSWERS:
        raise WidgetError(S_BAD_APPLY)
    cat = None
    valid = None
    if plan is not None:
        cat = _catalog(catalog)
        valid = validate_plan(plan, cat)
    clean = _clean_name(name) if name is not None else None
    if not isinstance(origin, str) or not origin:
        origin = None
    ts_dt = _now(now)
    ts = _iso(ts_dt)
    with _write(conn) as c:
        row = _owned(c, user_id, def_id)
        if row is None:
            raise NotFound()
        if _too_new(row):
            raise PlanTooNew()
        if isinstance(if_match, bool) or not isinstance(if_match, int) or if_match != row["save_seq"]:
            raise Conflict()

        if valid is not None:
            plan_json, plan_version = _dump(valid), needed_version(valid)
            summary_text = _summary_for(valid, cat)
        else:
            plan_json, plan_version = row["plan_json"], row["plan_version"]
            summary_text = _current_summary(c, row)
        new_name = clean or row["name"]
        if clean == "" and valid is not None:
            new_name = default_name(valid, cat)

        if apply == "save_new":
            _check_cap(c, user_id)
            src_plan = valid if valid is not None else json.loads(plan_json)
            copy_name = clean or (row["name"] + " copy")[:MAX_TEXT]
            new_id = _insert_new(c, user_id, copy_name, src_plan, summary_text, ts,
                                 row["source_gallery_id"], row["source_version"], origin)
            c.execute(f"UPDATE {_DEFS} SET last_answer = 'save_new' WHERE id = ? AND user_id = ?",
                      (def_id, user_id))
            return _get_in(c, user_id, new_id)

        latest = _rev_row(c, user_id, def_id, row["rev"])
        saved = _parse(latest["saved_at"]) if latest is not None else None
        coalesce = (
            latest is not None and latest["named"] is None and saved is not None
            and 0 <= (ts_dt - saved).total_seconds() <= COALESCE_S
            and (row["rev"] != row["placed_rev"] or apply == "update_all")
            and latest["origin"] == origin
        )
        if coalesce:
            new_rev = row["rev"]
            c.execute(
                f"UPDATE {_REVS} SET plan_json = ?, summary = ?, saved_at = ?"
                " WHERE definition_id = ? AND user_id = ? AND rev = ?",
                (plan_json, summary_text, ts, def_id, user_id, new_rev),
            )
        else:
            new_rev = row["rev"] + 1
            c.execute(
                f"INSERT INTO {_REVS} (user_id, definition_id, rev, plan_json, summary, saved_at,"
                " named, origin) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
                (user_id, def_id, new_rev, plan_json, summary_text, ts, origin),
            )
        placed = new_rev if apply == "update_all" else row["placed_rev"]
        answer = "update_all" if apply == "update_all" else row["last_answer"]
        c.execute(
            f"UPDATE {_DEFS} SET name = ?, plan_json = ?, plan_version = ?, rev = ?,"
            " placed_rev = ?, last_answer = ?, updated_at = ?, save_seq = save_seq + 1"
            " WHERE id = ? AND user_id = ?",
            (new_name, plan_json, plan_version, new_rev, placed, answer, ts, def_id, user_id),
        )
        _prune(c, user_id, def_id, (new_rev, placed))
        return _get_in(c, user_id, def_id)


def _purge_old_deleted(c: sqlite3.Connection, user_id: str, now_dt: datetime) -> int:
    cutoff = _iso(now_dt - timedelta(days=RECENTLY_DELETED_DAYS))
    ids = [r[0] for r in c.execute(
        f"SELECT id FROM {_DEFS} WHERE user_id = ? AND deleted_at IS NOT NULL AND deleted_at < ?",
        (user_id, cutoff),
    )]
    for def_id in ids:
        c.execute(f"DELETE FROM {_REVS} WHERE definition_id = ? AND user_id = ?", (def_id, user_id))
        c.execute(f"DELETE FROM {_DEFS} WHERE id = ? AND user_id = ?", (def_id, user_id))
    return len(ids)


def list_defs(user_id: str, *, archived: bool = False, deleted: bool = False,
              now: datetime | None = None, conn: sqlite3.Connection | None = None) -> list[dict]:
    """The member's widgets: live (default), archived, or recently deleted. Also hard-deletes
    this member's rows deleted more than RECENTLY_DELETED_DAYS ago."""
    now_dt = _now(now)
    if deleted:
        gate = "d.deleted_at IS NOT NULL"
    elif archived:
        gate = "d.deleted_at IS NULL AND d.archived_at IS NOT NULL"
    else:
        gate = "d.deleted_at IS NULL AND d.archived_at IS NULL"
    cutoff = _iso(now_dt - timedelta(days=RECENTLY_DELETED_DAYS))
    with _read(conn) as c:
        stale = c.execute(
            f"SELECT 1 FROM {_DEFS} WHERE user_id = ? AND deleted_at IS NOT NULL AND deleted_at < ?"
            " LIMIT 1", (user_id, cutoff)).fetchone()
    if stale is not None:                       # a short write only when there is work
        with _write(conn) as c:
            _purge_old_deleted(c, user_id, now_dt)
    with _read(conn) as c:
        rows = c.execute(
            f"SELECT d.*, r.summary AS _summary FROM {_DEFS} d LEFT JOIN {_REVS} r"
            "  ON r.definition_id = d.id AND r.user_id = d.user_id AND r.rev = d.rev"
            f" WHERE d.user_id = ? AND {gate} ORDER BY d.updated_at DESC, d.id DESC",
            (user_id,),
        ).fetchall()
        used = _used_in_counts(c, user_id) if rows else {}
        return [_shape(r, r["_summary"], used.get(r["id"], 0)) for r in rows]


def used_in_notes(user_id: str, def_id: str, *,
                  conn: sqlite3.Connection | None = None) -> list[dict]:
    """`[{noteId, title, updatedAt}]`: the member's live, non-sample notes that place this
    widget, newest first, one entry per note. Another member's note never appears, and an id
    that is not one of the member's widgets lists nothing."""
    if not isinstance(def_id, str) or not def_id or not user_id:
        return []
    with _read(conn) as c:
        rows = c.execute(
            "SELECT n.id, n.title, n.updated_at" + _USES_JOIN + " AND u.tool_id = ?"
            " GROUP BY n.id ORDER BY n.updated_at DESC, n.id DESC",
            (user_id, def_id),
        ).fetchall()
    return [{"noteId": r[0], "title": r[1], "updatedAt": r[2]} for r in rows]


def revs(user_id: str, def_id: str, *, conn: sqlite3.Connection | None = None) -> list[dict] | None:
    """The kept revisions, newest first, or None for a foreign or deleted id."""
    with _read(conn) as c:
        row = _owned(c, user_id, def_id)
        if row is None:
            return None
        out = []
        for r in c.execute(
            f"SELECT * FROM {_REVS} WHERE definition_id = ? AND user_id = ? ORDER BY rev DESC",
            (def_id, user_id),
        ):
            plan, too_new = _read_plan(r["plan_json"])
            item = {"rev": r["rev"], "plan": plan, "summary": r["summary"],
                    "savedAt": r["saved_at"], "named": r["named"],
                    "current": r["rev"] == row["rev"], "placed": r["rev"] == row["placed_rev"]}
            if too_new:
                item["tooNew"] = True
            out.append(item)
        return out


def name_rev(user_id: str, def_id: str, rev: int, name: str | None, *,
             conn: sqlite3.Connection | None = None) -> dict:
    """Name a revision (kept for good) or, with an empty name, unname it."""
    clean = _clean_name(name, S_BAD_REV_NAME) or None
    with _write(conn) as c:
        row = _owned(c, user_id, def_id)
        if row is None or isinstance(rev, bool) or not isinstance(rev, int):
            raise NotFound()
        if _rev_row(c, user_id, def_id, rev) is None:
            raise NotFound()
        c.execute(
            f"UPDATE {_REVS} SET named = ? WHERE definition_id = ? AND user_id = ? AND rev = ?",
            (clean, def_id, user_id, rev),
        )
        return {"rev": rev, "named": clean}


def restore_rev(user_id: str, def_id: str, rev: int, *, if_match: int, catalog: Any = None,
                now: datetime | None = None, conn: sqlite3.Connection | None = None) -> dict:
    """Save an old revision's plan as a NEW revision (never coalesced). Placements stay
    where they are, as with an "only" save. `if_match` is the `etag`; a widget whose current
    plan is newer than the server knows is refused (`PlanTooNew`), as `update` is."""
    ts = _iso(_now(now))
    with _write(conn) as c:
        row = _owned(c, user_id, def_id)
        if row is None:
            raise NotFound()
        if _too_new(row):
            raise PlanTooNew()
        if isinstance(if_match, bool) or not isinstance(if_match, int) or if_match != row["save_seq"]:
            raise Conflict()
        if isinstance(rev, bool) or not isinstance(rev, int):
            raise NotFound()
        old = _rev_row(c, user_id, def_id, rev)
        if old is None:
            raise NotFound()
        plan, too_new = _read_plan(old["plan_json"])
        if too_new:
            raise PlanTooNew()
        if not isinstance(plan, dict):
            raise PlanError("This widget's settings couldn't be read.")
        plan_json = _dump(plan)
        new_rev = row["rev"] + 1
        c.execute(
            f"INSERT INTO {_REVS} (user_id, definition_id, rev, plan_json, summary, saved_at, named,"
            " origin) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)",
            (user_id, def_id, new_rev, plan_json, old["summary"], ts),
        )
        c.execute(
            f"UPDATE {_DEFS} SET plan_json = ?, plan_version = ?, rev = ?, updated_at = ?,"
            " save_seq = save_seq + 1 WHERE id = ? AND user_id = ?",
            (plan_json, needed_version(plan), new_rev, ts, def_id, user_id),
        )
        _prune(c, user_id, def_id, (new_rev, row["placed_rev"]))
        return _get_in(c, user_id, def_id)


def archive(user_id: str, def_id: str, *, now: datetime | None = None,
            conn: sqlite3.Connection | None = None) -> dict:
    ts = _iso(_now(now))
    with _write(conn) as c:
        row = _owned(c, user_id, def_id)
        if row is None:
            raise NotFound()
        if row["archived_at"] is None:
            c.execute(f"UPDATE {_DEFS} SET archived_at = ?, updated_at = ? WHERE id = ? AND user_id = ?",
                      (ts, ts, def_id, user_id))
        return _get_in(c, user_id, def_id)


def unarchive(user_id: str, def_id: str, *, now: datetime | None = None,
              conn: sqlite3.Connection | None = None) -> dict:
    """Back to My tools. Refused at the cap, since it would make one more live widget."""
    ts = _iso(_now(now))
    with _write(conn) as c:
        row = _owned(c, user_id, def_id)
        if row is None:
            raise NotFound()
        if row["archived_at"] is not None:
            _check_cap(c, user_id)
            c.execute(f"UPDATE {_DEFS} SET archived_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?",
                      (ts, def_id, user_id))
        return _get_in(c, user_id, def_id)


def soft_delete(user_id: str, def_id: str, *, typed_name: str, now: datetime | None = None,
                conn: sqlite3.Connection | None = None) -> dict:
    """Move an ARCHIVED widget to Recently deleted, only when `typed_name == name`."""
    ts = _iso(_now(now))
    with _write(conn) as c:
        row = _owned(c, user_id, def_id)
        if row is None:
            raise NotFound()
        if row["archived_at"] is None:
            raise WidgetError(S_ARCHIVE_FIRST)
        if not isinstance(typed_name, str) or typed_name != row["name"]:
            raise WidgetError(S_TYPE_NAME)
        c.execute(f"UPDATE {_DEFS} SET deleted_at = ? WHERE id = ? AND user_id = ?",
                  (ts, def_id, user_id))
        return {"id": def_id, "deletedAt": ts}


def undelete(user_id: str, def_id: str, *, now: datetime | None = None,
             conn: sqlite3.Connection | None = None) -> dict:
    """Bring a recently deleted widget back (still archived). Past the 30 days it is gone."""
    now_dt = _now(now)
    with _write(conn) as c:
        row = _owned(c, user_id, def_id, deleted=True)
        if row is None:
            raise NotFound()
        when = _parse(row["deleted_at"])
        if when is None or now_dt - when > timedelta(days=RECENTLY_DELETED_DAYS):
            raise NotFound()
        c.execute(f"UPDATE {_DEFS} SET deleted_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?",
                  (_iso(now_dt), def_id, user_id))
        return _get_in(c, user_id, def_id)


def resolve_for_run(user_id: str, def_id: str, def_rev: int | None, *,
                    conn: sqlite3.Connection | None = None
                    ) -> tuple[dict | None, int | None, int | None]:
    """`(plan to run, rev ran, latest_rev)`. Runs revision `max(def_rev, placed_rev)`, by
    number; None for a foreign or deleted id. A pruned revision falls back to the newest
    kept one below it. A too-new plan is returned as stored: the run refuses it with the
    plan module's sentence."""
    with _read(conn) as c:
        row = _owned(c, user_id, def_id)
        if row is None:
            return None, None, None
        asked = def_rev if isinstance(def_rev, int) and not isinstance(def_rev, bool) else 0
        want = min(max(asked, row["placed_rev"]), row["rev"])
        r = c.execute(
            f"SELECT * FROM {_REVS} WHERE definition_id = ? AND user_id = ? AND rev <= ?"
            " ORDER BY rev DESC LIMIT 1",
            (def_id, user_id, want),
        ).fetchone()
        if r is None:
            plan, _ = _read_plan(row["plan_json"])
            return plan, row["rev"], row["rev"]
        plan, _ = _read_plan(r["plan_json"])
        return plan, r["rev"], row["rev"]
