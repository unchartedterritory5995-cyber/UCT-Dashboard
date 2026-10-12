"""Kinds of note (Notebook P1, spec §P1.1/§P1.2).

Built-in kinds are CODE CONSTANTS (`BUILTIN_NOTE_KINDS`); a member's own kinds are rows of
`j2_note_kinds`. ⛔ ONE FACT IN TWO FILES with app/src/pages/journal-2-0/lib/noteKinds.js, pinned by
tests/test_note_kinds.py (which imports the JS module through Node).

Two facts, two places, never one restated:
  * `j2_notes.kind_id` is PROVENANCE: the kind a note was CREATED as (with style_id/style_version).
  * the `builtin:note_kind` property is the note's CURRENT kind, the one views, filters and boards
    group by. It is set at creation, editable like any select, and is the only thing grouping reads.

A kind in use (a live note's current kind, or a live style's kind) cannot be deleted: the member
moves those first. There is no soft delete for kinds, so there is never an orphaned value.
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
_ICON_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9]{0,39}$")

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
    if not isinstance(raw, str) or not _ICON_RE.match(raw):
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
        conn.execute("INSERT INTO j2_note_kinds (id, user_id, name, icon, sort_order, created_at)"
                     " VALUES (?, ?, ?, ?, ?, ?)", (kid, user_id, clean, ic, n, _now()))
        conn.commit()
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


def _uses(user_id: str, kind_id: str, conn: sqlite3.Connection) -> tuple[int, int]:
    notes_n = 0
    for r in conn.execute("SELECT properties_json FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL"
                          " AND properties_json IS NOT NULL", (user_id,)):
        try:
            if json.loads(r["properties_json"]).get(NOTE_KIND_PROPERTY) == kind_id:
                notes_n += 1
        except (TypeError, ValueError, AttributeError):
            continue
    styles_n = 0
    has_styles = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='j2_journal_styles'").fetchone()
    if has_styles:
        styles_n = conn.execute("SELECT COUNT(*) AS c FROM j2_journal_styles WHERE user_id = ? AND kind_id = ?"
                                " AND deleted_at IS NULL", (user_id, kind_id)).fetchone()["c"]
    return notes_n, styles_n


def delete_kind(user_id: str, kind_id: str, conn: sqlite3.Connection | None = None) -> bool:
    if kind_id in BUILTIN_KIND_IDS:
        raise KindValidationError("Built-in kinds can't be deleted.")
    owned = conn is None
    conn = conn or get_connection()
    try:
        if get_kind(user_id, kind_id, conn) is None:
            return False
        notes_n, styles_n = _uses(user_id, kind_id, conn)
        if notes_n or styles_n:
            parts = []
            if notes_n:
                parts.append(f"{notes_n} note{'s' if notes_n != 1 else ''}")
            if styles_n:
                parts.append(f"{styles_n} style{'s' if styles_n != 1 else ''}")
            raise KindInUse(f"This kind is used by {' and '.join(parts)}. Move them to another kind first.")
        conn.execute("DELETE FROM j2_note_kinds WHERE id = ? AND user_id = ?", (kind_id, user_id))
        conn.commit()
        return True
    finally:
        if owned:
            conn.close()


def kind_options(user_id: str, conn: sqlite3.Connection) -> list[dict]:
    """The `builtin:note_kind` select's options for THIS member: built-ins, then their own."""
    return [{"id": k["id"], "label": k["name"], "color": "gray"} for k in list_kinds(user_id, conn)]


def _unmapped(user_id: str, conn: sqlite3.Connection) -> list[tuple[str, str]]:
    out = []
    for r in conn.execute("SELECT id, properties_json FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL"
                          " AND properties_json IS NOT NULL ORDER BY created_at, rowid", (user_id,)):
        try:
            props = json.loads(r["properties_json"])
        except (TypeError, ValueError):
            continue
        rt = props.get("builtin:research_type") if isinstance(props, dict) else None
        if rt in RESEARCH_TYPE_TO_KIND and not props.get(NOTE_KIND_PROPERTY):
            out.append((r["id"], rt))
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
        for _nid, rt in _unmapped(user_id, conn):
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


def apply_mapping(user_id: str, exclude_note_ids: Any = (), conn: sqlite3.Connection | None = None) -> list[dict]:
    """Set Kind of note from Research Type on every unmapped note not in `exclude_note_ids` (the
    client excludes notes holding unsent offline work). Each write goes through notes.update_note
    and moves that note's revision; the caller lands every returned {id, updatedAt}."""
    from api.services.journal_two import notes as notes_service
    skip = {x for x in (exclude_note_ids or []) if isinstance(x, str)}
    owned = conn is None
    conn = conn or get_connection()
    try:
        pending = [(nid, rt) for nid, rt in _unmapped(user_id, conn) if nid not in skip]
        if not pending:
            return []
        sector = _sector_kind(user_id, conn)
        if sector is None and any(RESEARCH_TYPE_TO_KIND[rt] is None for _nid, rt in pending):
            sector = create_kind(user_id, SECTOR_KIND_NAME, "globe", conn)
        done = []
        for nid, rt in pending:
            kind_id = RESEARCH_TYPE_TO_KIND[rt] or sector["id"]
            n = notes_service.update_note(user_id, nid, {"properties": {NOTE_KIND_PROPERTY: kind_id}}, conn=conn)
            if n is not None:
                done.append({"id": n["id"], "updatedAt": n["updatedAt"]})
        return done
    finally:
        if owned:
            conn.close()
