"""Wave 6 (lane E, item 3) — MEMBER templates.

"Save as template" copies a note's title, body and property values into a row
of `j2_note_templates`, owned by that member. The Notebook's template picker
lists them under "Your templates" beside the built-in catalog, and creating from
one goes through the same client path as a built-in (`createNoteViaApi`), so a
member template is never a second way to make a note. Free, by owner ruling.

⛔ THE SERVER READS THE NOTE. The client names the note it wants copied; it
never supplies the body it claims to be copying, so a template can only ever
hold what the member's own note held — and the note's own validation (size,
shape) already bounds it.

⛔ A COPY, NOT A LINK. Editing or trashing the note afterwards changes nothing
here. (Its images still point at the source note's attachment files, like a
duplicated note's do; that is recorded in the wave-6 report, not solved here.)

⛔ A property can be deleted after a template captured a value for it. The full
read leaves such a value OUT (and any value that no longer fits its property),
because the client applies the template's properties in one write and a single
unknown property fails the whole write — the member would lose every property
to protect one that no longer exists.

Owner-scoped everywhere: another member's template id reads exactly like one
that does not exist (404), never as "forbidden".
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection

MAX_TEMPLATES_PER_MEMBER = 200
MAX_TEMPLATE_NAME_CHARS = 80
UNTITLED_TEMPLATE_NAME = "Untitled template"


class TemplateValidationError(ValueError):
    pass


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_name(raw: Any) -> str:
    if not isinstance(raw, str):
        raise TemplateValidationError("name must be text")
    name = raw.strip()
    if not name:
        raise TemplateValidationError("A template needs a name.")
    if len(name) > MAX_TEMPLATE_NAME_CHARS:
        raise TemplateValidationError(f"A template name can be at most {MAX_TEMPLATE_NAME_CHARS} characters.")
    return name


def _summary(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "title": row["title"] or "",
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _still_valid_properties(user_id: str, raw: str | None, conn: sqlite3.Connection) -> dict[str, Any]:
    """The template's property values that still fit a property the member has."""
    from api.services.journal_two import note_properties as np

    values = np._parse_properties_json(raw)
    out: dict[str, Any] = {}
    for property_id, value in values.items():
        if np.is_builtin_property_id(property_id):
            if property_id not in np.BUILTIN_USER_SET_IDS:
                continue
            prop_def = np._BUILTIN_BY_ID[property_id]
        else:
            prop_def = np.get_property_def(user_id, property_id, conn=conn)
            if prop_def is None:
                continue
        try:
            validated = np.validate_property_value(prop_def, value)
        except np.PropertyValidationError:
            continue
        if validated is not None:
            out[property_id] = validated
    return out


def list_templates(user_id: str, conn: sqlite3.Connection | None = None) -> list[dict[str, Any]]:
    """The member's templates, newest first — names only, never bodies."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT id, name, title, created_at, updated_at FROM j2_note_templates"
            # Newest SAVED first — a rename does not reorder the picker.
            " WHERE user_id = ? ORDER BY created_at DESC, rowid DESC",
            (user_id,),
        ).fetchall()
        return [_summary(r) for r in rows]
    finally:
        if owned:
            conn.close()


def get_template(user_id: str, template_id: str, conn: sqlite3.Connection | None = None) -> dict[str, Any] | None:
    """One template in full: its summary plus `bodyJson` and `properties`."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM j2_note_templates WHERE id = ? AND user_id = ?",
            (template_id, user_id),
        ).fetchone()
        if row is None:
            return None
        out = _summary(row)
        out["bodyJson"] = json.loads(row["body_json"] or '{"type":"doc","content":[]}')
        out["properties"] = _still_valid_properties(user_id, row["properties_json"], conn)
        return out
    finally:
        if owned:
            conn.close()


def create_from_note(
    user_id: str, note_id: str, name: Any = None, conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Copy one of the member's live notes into a new template. None when the
    note is not theirs, is in the trash, or does not exist."""
    from api.services.journal_two import notes as notes_service

    owned = conn is None
    conn = conn or get_connection()
    try:
        note = notes_service.get_note(user_id, note_id, conn=conn)
        if note is None:
            return None
        if name is None:
            clean = (note.get("title") or "").strip()[:MAX_TEMPLATE_NAME_CHARS] or UNTITLED_TEMPLATE_NAME
        else:
            clean = _clean_name(name)
        count = conn.execute(
            "SELECT COUNT(*) AS c FROM j2_note_templates WHERE user_id = ?", (user_id,),
        ).fetchone()["c"]
        if count >= MAX_TEMPLATES_PER_MEMBER:
            raise TemplateValidationError(
                f"You can keep up to {MAX_TEMPLATES_PER_MEMBER} templates. Delete one to save another.")
        now = _now_iso()
        new_id = uuid.uuid4().hex
        props = note.get("propertiesJson") or {}
        conn.execute(
            "INSERT INTO j2_note_templates (id, user_id, name, title, body_json, properties_json,"
            " created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (new_id, user_id, clean, note.get("title") or "", json.dumps(note.get("bodyJson") or {}),
             json.dumps(props) if props else None, now, now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM j2_note_templates WHERE id = ?", (new_id,)).fetchone()
        return _summary(row)
    finally:
        if owned:
            conn.close()


def rename_template(
    user_id: str, template_id: str, name: Any, conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    clean = _clean_name(name)
    owned = conn is None
    conn = conn or get_connection()
    try:
        cur = conn.execute(
            "UPDATE j2_note_templates SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?",
            (clean, _now_iso(), template_id, user_id),
        )
        conn.commit()
        if not cur.rowcount:
            return None
        row = conn.execute("SELECT * FROM j2_note_templates WHERE id = ?", (template_id,)).fetchone()
        return _summary(row)
    finally:
        if owned:
            conn.close()


def delete_template(user_id: str, template_id: str, conn: sqlite3.Connection | None = None) -> bool:
    owned = conn is None
    conn = conn or get_connection()
    try:
        cur = conn.execute(
            "DELETE FROM j2_note_templates WHERE id = ? AND user_id = ?", (template_id, user_id),
        )
        conn.commit()
        return bool(cur.rowcount)
    finally:
        if owned:
            conn.close()
