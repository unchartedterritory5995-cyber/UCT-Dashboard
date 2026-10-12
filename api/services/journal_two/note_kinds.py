"""Kinds of note (Notebook P1, spec §P1.1/§P1.2).

Built-in kinds are CODE CONSTANTS (`BUILTIN_NOTE_KINDS`); a member's own kinds are rows of
`j2_note_kinds`. ⛔ ONE FACT IN TWO FILES with app/src/pages/journal-2-0/lib/noteKinds.js, pinned by
tests/test_note_kinds.py (which imports the JS module through Node).

Two facts, two places, never one restated:
  * `j2_notes.kind_id` is PROVENANCE: the kind a note was CREATED as (with style_id/style_version).
  * the `builtin:note_kind` property is the note's CURRENT kind, the one views, filters and boards
    group by. It is set at creation, editable like any select, and is the only thing grouping reads.

A kind in use cannot be deleted: a note's current kind counts whether the note is live OR in Trash
(restoring it would bring back a dead id; the hold ends with the 30-day Trash purge), and a LIVE style's
kind counts. The member's SOFT-DELETED styles of that kind do not block: they are hard-deleted in the
same transaction as the kind and the result reports how many (`purgedDeletedStyles`). There is no soft
delete for kinds, so no restore path can orphan a value. The check, the purge and the DELETE share one
write lock.
"""
from __future__ import annotations

import json
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection

NOTE_KIND_PROPERTY = "builtin:note_kind"
MEMBER_KIND_PREFIX = "k_"
MAX_KINDS_PER_MEMBER = 50
MAX_KIND_NAME_CHARS = 40
# An icon is a UIcon registry name (app/src/components/ui/UIcon.jsx, UICON_NAMES): letters and digits,
# hyphen-joined words allowed (`ind-trend`, `star-fill`), at most 40 characters. ⛔ ONE AUTHORITY: the kind
# picker offers every UICON_NAMES entry, and tests/test_note_kinds.py bundles the registry and walks every
# name through _clean_icon, so a name the picker offers can never be one this refuses.
_ICON_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9]*(?:-[a-zA-Z0-9]+)*$")
_MAX_ICON_CHARS = 40

BUILTIN_NOTE_KINDS: tuple[dict, ...] = (
    {"id": "trade_plan", "name": "Trade plan", "icon": "chart"},
    {"id": "daily_prep", "name": "Daily prep", "icon": "sun"},
    {"id": "weekend_prep", "name": "Weekend prep", "icon": "calendar"},
    {"id": "earnings", "name": "Earnings", "icon": "earnings"},
    {"id": "post_trade_review", "name": "Post-trade review", "icon": "check"},
    {"id": "weekly_review", "name": "Weekly review", "icon": "refresh"},
    {"id": "thesis", "name": "Thesis", "icon": "book"},
    {"id": "watchlist_note", "name": "Watchlist note", "icon": "eye"},
)
BUILTIN_KIND_IDS = frozenset(k["id"] for k in BUILTIN_NOTE_KINDS)
_BUILTIN_BY_ID = {k["id"]: k for k in BUILTIN_NOTE_KINDS}

#: builtin:research_type option -> kind id; None = the member kind named SECTOR_KIND_NAME.
RESEARCH_TYPE_TO_KIND: dict[str, str | None] = {
    "long_thesis": "thesis", "short_thesis": "thesis", "earnings_play": "earnings",
    "watchlist_note": "watchlist_note", "sector_note": None,
}
SECTOR_KIND_NAME = "Sector note"


class KindValidationError(ValueError):
    pass


class KindInUse(KindValidationError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _builtin(k: dict, i: int) -> dict:
    return {"id": k["id"], "name": k["name"], "icon": k["icon"], "builtin": True, "sortOrder": i}


def _row(r: sqlite3.Row) -> dict:
    return {"id": r["id"], "name": r["name"], "icon": r["icon"], "builtin": False, "sortOrder": r["sort_order"]}


def _clean_name(raw: Any) -> str:
    if not isinstance(raw, str) or not raw.strip():
        raise KindValidationError("A kind of note needs a name.")
    name = " ".join(raw.split())
    if len(name) > MAX_KIND_NAME_CHARS:
        raise KindValidationError(f"A kind's name can be at most {MAX_KIND_NAME_CHARS} characters.")
    return name


def _clean_icon(raw: Any) -> str | None:
    if raw is None or raw == "":
        return None
    if not isinstance(raw, str) or len(raw) > _MAX_ICON_CHARS or not _ICON_RE.fullmatch(raw):
        raise KindValidationError("Choose an icon from the list.")
    return raw


def _taken(user_id: str, name: str, conn: sqlite3.Connection, *, except_id: str | None = None) -> bool:
    low = name.casefold()
    if any(k["name"].casefold() == low for k in BUILTIN_NOTE_KINDS):
        return True
    rows = conn.execute("SELECT id, name FROM j2_note_kinds WHERE user_id = ?", (user_id,)).fetchall()
    return any(r["name"].casefold() == low and r["id"] != except_id for r in rows)


def list_kinds(user_id: str, conn: sqlite3.Connection | None = None) -> list[dict]:
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM j2_note_kinds WHERE user_id = ? ORDER BY sort_order, created_at, rowid",
            (user_id,)).fetchall()
        return [_builtin(k, i) for i, k in enumerate(BUILTIN_NOTE_KINDS)] + [_row(r) for r in rows]
    finally:
        if owned:
            conn.close()


def get_kind(user_id: str, kind_id: Any, conn: sqlite3.Connection | None = None) -> dict | None:
    if not isinstance(kind_id, str):
        return None
    if kind_id in _BUILTIN_BY_ID:
        i = [k["id"] for k in BUILTIN_NOTE_KINDS].index(kind_id)
        return _builtin(_BUILTIN_BY_ID[kind_id], i)
    owned = conn is None
    conn = conn or get_connection()
    try:
        r = conn.execute("SELECT * FROM j2_note_kinds WHERE id = ? AND user_id = ?", (kind_id, user_id)).fetchone()
        return _row(r) if r else None
    finally:
        if owned:
            conn.close()


def create_kind(user_id: str, name: Any, icon: Any = None, conn: sqlite3.Connection | None = None) -> dict:
    clean, ic = _clean_name(name), _clean_icon(icon)
    owned = conn is None
    conn = conn or get_connection()
    try:
        if _taken(user_id, clean, conn):
            raise KindValidationError(f"There is already a kind called {clean}.")
        n = conn.execute("SELECT COUNT(*) AS c FROM j2_note_kinds WHERE user_id = ?", (user_id,)).fetchone()["c"]
        if n >= MAX_KINDS_PER_MEMBER:
            raise KindValidationError(f"You can keep up to {MAX_KINDS_PER_MEMBER} kinds of note.")
        kid = MEMBER_KIND_PREFIX + uuid.uuid4().hex
        try:
            conn.execute("INSERT INTO j2_note_kinds (id, user_id, name, icon, sort_order, created_at)"
                         " VALUES (?, ?, ?, ?, ?, ?)", (kid, user_id, clean, ic, n, _now()))
            conn.commit()
        except sqlite3.IntegrityError:
            # Lost a same-name race (a double-clicked button): the unique index is the authority.
            conn.rollback()
            raise KindValidationError(f"There is already a kind called {clean}.")
        return get_kind(user_id, kid, conn)
    finally:
        if owned:
            conn.close()


def update_kind(user_id: str, kind_id: str, *, name: Any = None, icon: Any = None,
                sort_order: Any = None, conn: sqlite3.Connection | None = None) -> dict | None:
    if kind_id in BUILTIN_KIND_IDS:
        raise KindValidationError("Built-in kinds can't be changed. Make your own kind instead.")
    owned = conn is None
    conn = conn or get_connection()
    try:
        if get_kind(user_id, kind_id, conn) is None:
            return None
        sets, params = [], []
        if name is not None:
            clean = _clean_name(name)
            if _taken(user_id, clean, conn, except_id=kind_id):
                raise KindValidationError(f"There is already a kind called {clean}.")
            sets.append("name = ?"); params.append(clean)
        if icon is not None:
            sets.append("icon = ?"); params.append(_clean_icon(icon))
        if sort_order is not None:
            if isinstance(sort_order, bool) or not isinstance(sort_order, int):
                raise KindValidationError("sortOrder must be a whole number")
            sets.append("sort_order = ?"); params.append(sort_order)
        if sets:
            conn.execute(f"UPDATE j2_note_kinds SET {', '.join(sets)} WHERE id = ? AND user_id = ?",
                         (*params, kind_id, user_id))
            conn.commit()
        return get_kind(user_id, kind_id, conn)
    finally:
        if owned:
            conn.close()


_KIND_PATH = '$."' + NOTE_KIND_PROPERTY + '"'


def _has_styles_table(conn: sqlite3.Connection) -> bool:
    return bool(conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='j2_journal_styles'").fetchone())


def _uses(user_id: str, kind_id: str, conn: sqlite3.Connection) -> tuple[int, int, int]:
    """(notes holding it, of which in Trash, LIVE styles holding it).

    Trashed notes COUNT (restoring one must never bring back a dead id); soft-deleted styles do not
    (delete_kind purges them with the kind). The note scan is one SQL statement (`json_extract`, guarded
    by `json_valid` so one unreadable row cannot block every delete)."""
    r = conn.execute(
        "SELECT COUNT(*) AS n, COALESCE(SUM(deleted_at IS NOT NULL), 0) AS t FROM j2_notes"
        " WHERE user_id = ? AND properties_json IS NOT NULL"
        " AND CASE WHEN json_valid(properties_json) THEN json_extract(properties_json, ?) END = ?",
        (user_id, _KIND_PATH, kind_id)).fetchone()
    styles_n = 0
    if _has_styles_table(conn):
        styles_n = conn.execute(
            "SELECT COUNT(*) AS n FROM j2_journal_styles WHERE user_id = ? AND kind_id = ?"
            " AND deleted_at IS NULL", (user_id, kind_id)).fetchone()["n"]
    return r["n"], r["t"], styles_n


def delete_kind(user_id: str, kind_id: str, conn: sqlite3.Connection | None = None) -> dict | bool:
    """Delete a member kind. Returns `{"purgedDeletedStyles": n}` on success (truthy), False when there
    is no such kind. Raises KindInUse while a note (live or trashed) or a live style holds it."""
    if kind_id in BUILTIN_KIND_IDS:
        raise KindValidationError("Built-in kinds can't be deleted.")
    from api.services.journal_two.notes import _begin_immediate
    owned = conn is None
    conn = conn or get_connection()
    started = not conn.in_transaction
    try:
        if started:
            _begin_immediate(conn)       # the in-use read and the DELETE share one write lock
        if get_kind(user_id, kind_id, conn) is None:
            if started:
                conn.rollback()
            return False
        notes_n, notes_trashed, styles_n = _uses(user_id, kind_id, conn)
        if notes_n or styles_n:
            parts = []
            if notes_n:
                parts.append(f"{notes_n} note{'s' if notes_n != 1 else ''}"
                             + (f" ({notes_trashed} in Trash)" if notes_trashed else ""))
            if styles_n:
                parts.append(f"{styles_n} style{'s' if styles_n != 1 else ''}")
            tail = ("Restore or empty the ones in Trash, and move the rest to another kind first."
                    if notes_trashed else "Move them to another kind first.")
            if started:
                conn.rollback()
            raise KindInUse(f"This kind is used by {' and '.join(parts)}. {tail}")
        purged = 0
        if _has_styles_table(conn):
            purged = conn.execute("DELETE FROM j2_journal_styles WHERE user_id = ? AND kind_id = ?"
                                  " AND deleted_at IS NOT NULL", (user_id, kind_id)).rowcount
        conn.execute("DELETE FROM j2_note_kinds WHERE id = ? AND user_id = ?", (kind_id, user_id))
        conn.commit()
        return {"purgedDeletedStyles": purged}
    except BaseException:
        if started and conn.in_transaction:
            conn.rollback()
        raise
    finally:
        if owned:
            conn.close()


def offered(defs: list[dict]) -> list[dict]:
    """Property definitions a door may OFFER or SUGGEST (autofill, AI organise; the client applies the
    same rule to Add property and the board's group-by). While journal styles are off, Kind of note is
    not offered through any door; an existing value still renders (spec P1.7c). The switch is read the
    way journal_styles reads it, per call."""
    from api.services.journal_two import journal_styles
    if journal_styles.enabled():
        return list(defs)
    return [d for d in defs if d.get("id") != NOTE_KIND_PROPERTY]


def kind_options(user_id: str, conn: sqlite3.Connection) -> list[dict]:
    """The `builtin:note_kind` select's options for THIS member: built-ins, then their own."""
    return [{"id": k["id"], "label": k["name"], "color": "gray"} for k in list_kinds(user_id, conn)]


def _unmapped(user_id: str, conn: sqlite3.Connection) -> list[tuple[str, str, bool]]:
    out = []
    for r in conn.execute("SELECT id, properties_json, locked FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL"
                          " AND properties_json IS NOT NULL ORDER BY created_at, rowid", (user_id,)):
        try:
            props = json.loads(r["properties_json"])
        except (TypeError, ValueError):
            continue
        rt = props.get("builtin:research_type") if isinstance(props, dict) else None
        if rt in RESEARCH_TYPE_TO_KIND and not props.get(NOTE_KIND_PROPERTY):
            out.append((r["id"], rt, bool(r["locked"])))
    return out


def _sector_kind(user_id: str, conn: sqlite3.Connection) -> dict | None:
    low = SECTOR_KIND_NAME.casefold()
    return next((k for k in list_kinds(user_id, conn) if k["name"].casefold() == low), None)


def mapping_offer(user_id: str, conn: sqlite3.Connection | None = None) -> dict | None:
    """The one-shot offer (spec P1.2): notes that carry a Research Type and no Kind of note, by type."""
    from api.services.journal_two import note_properties as np
    owned = conn is None
    conn = conn or get_connection()
    try:
        counts: dict[str, int] = {}
        for _nid, rt, _locked in _unmapped(user_id, conn):
            counts[rt] = counts.get(rt, 0) + 1
        if not counts:
            return None
        labels = {o["id"]: o["label"] for o in np._BUILTIN_BY_ID["builtin:research_type"]["options"]}
        sector = _sector_kind(user_id, conn)
        rows = []
        for rt in RESEARCH_TYPE_TO_KIND:
            if rt not in counts:
                continue
            target = RESEARCH_TYPE_TO_KIND[rt]
            kind = get_kind(user_id, target, conn) if target else sector
            rows.append({"researchType": rt, "researchTypeLabel": labels.get(rt, rt), "count": counts[rt],
                         "kindId": kind["id"] if kind else None,
                         "kindName": kind["name"] if kind else SECTOR_KIND_NAME,
                         "createsKind": kind is None})
        return {"total": sum(counts.values()), "rows": rows}
    finally:
        if owned:
            conn.close()


def apply_mapping(user_id: str, exclude_note_ids: Any = (), conn: sqlite3.Connection | None = None,
                  skipped_out: list | None = None) -> list[dict]:
    """Set Kind of note from Research Type on every unmapped note not in `exclude_note_ids` (the
    client excludes notes holding unsent offline work). Each write goes through notes.update_note
    and moves that note's revision; the caller lands every returned {id, updatedAt}.
    A LOCKED note is never written to: it is appended to `skipped_out` as {id, reason: "locked"}.
    ⛔ Never a failure mid-loop (review M6): a note that became locked, or changed, between the read
    above and its own write is skipped as {id, reason: "locked"|"changed"} and the loop goes on, so
    every note already written is still returned for the client to land."""
    from api.services.journal_two import notes as notes_service
    skip = {x for x in (exclude_note_ids or []) if isinstance(x, str)}
    owned = conn is None
    conn = conn or get_connection()
    try:
        pending = []
        for nid, rt, locked in _unmapped(user_id, conn):
            if nid in skip:
                continue
            if locked:
                if skipped_out is not None:
                    skipped_out.append({"id": nid, "reason": "locked"})
                continue
            pending.append((nid, rt))
        if not pending:
            return []
        sector = _sector_kind(user_id, conn)
        if sector is None and any(RESEARCH_TYPE_TO_KIND[rt] is None for _nid, rt in pending):
            sector = create_kind(user_id, SECTOR_KIND_NAME, "globe", conn)
        done = []
        for nid, rt in pending:
            kind_id = RESEARCH_TYPE_TO_KIND[rt] or sector["id"]
            try:
                n = notes_service.update_note(user_id, nid, {"properties": {NOTE_KIND_PROPERTY: kind_id}}, conn=conn)
            except (notes_service.NoteLockedError, notes_service.NoteConflictError) as e:
                if skipped_out is not None:
                    reason = "locked" if isinstance(e, notes_service.NoteLockedError) else "changed"
                    skipped_out.append({"id": nid, "reason": reason})
                continue
            if n is not None:
                done.append({"id": n["id"], "updatedAt": n["updatedAt"]})
        return done
    finally:
        if owned:
            conn.close()
