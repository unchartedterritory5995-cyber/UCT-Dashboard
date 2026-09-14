"""Wave S — S-07(a): USER-DEFINED NOTEBOOK TEMPLATES (server side).

A member freezes the shape of a note they like and gets it back in the
picker beside the firm-authored catalog. The body stored here is a
**rendered** TipTap doc: `{ctx}` was already substituted when the member
wrote the note it came from, so there is no expression language, no DSL and
nothing to evaluate at create time (S-07 spec non-goal N-2).

WHY A TABLE AND NOT `user_preferences`
--------------------------------------
The `watchlist_templates` idiom (app/src/pages/watchlist/watchlistTemplates.js:13)
is a real, close precedent, and it is refused here on two prior rulings that
already decided this question for content of exactly this shape:

    api/services/user_definitions.py:25-30
        "`user_preferences` has NO SIZE LIMIT and NO DELETE ROUTE. A store for
         content a user can author in a loop needs both, and inheriting
         neither is how a table becomes unbounded quietly."

    api/services/journal_two/db.py (j2_capture_inbox)
        "A TABLE, not a preference -- prefs have no delete route and no size
         cap (see user_definitions.py's note on that hazard)."

A template body is a TipTap document — the largest artifact a member can
author — and templates are authored in a loop. So this store names its caps
and ships a delete.

WHO PAYS
--------
⛔ FREE. Every route in api/routers/journal_two.py that reaches this module
takes `Depends(get_current_user)`, never a paid dependency. Owner ruling,
2026-09-14: two shipped precedents contradicted each other
(`j2_note_saved_views` free vs `user_definitions.py` paid) and
`j2_note_saved_views` governs here. The built-in templates are not gated, and
gating the member's own version of a free feature is a different product.
Do not re-litigate it; `tests/test_j2_note_templates.py` rails the free door
behaviourally (a member with no plan gets 200 from all five routes).

THE CAPS, AND WHERE EACH NUMBER COMES FROM
------------------------------------------
The closest j2 precedent (`create_saved_view`, note_properties.py) validates a
name and a view_type and imposes no count or byte cap at all. That omission is
deliberately NOT inherited:

* `MAX_TEMPLATE_BODY_BYTES`   — a quarter of notes.MAX_BODY_JSON_BYTES. A
                                template is a scaffold, not a finished note.
* `MAX_TEMPLATES_PER_USER`    — the same 50 that
                                user_definitions.MAX_DEFINITIONS_PER_USER uses
                                for the other user-authored artifact in this
                                app; consistency beats a fresh guess. Counted
                                over LIVE rows only — a member who deletes 50
                                templates must not be locked out forever.
* `MAX_TEMPLATE_LABEL_CHARS`  — matches watchlistTemplates.js:50's
                                `.slice(0, 60)`. This side REJECTS rather than
                                truncating: a server that silently rewrites the
                                label a member typed is a worse answer than a
                                400 that says why.

Body validation goes through `notes._validate_body_json` — the SAME path a
note body takes — before the tighter cap is applied. A template that stored a
body the editor cannot open would be a way to smuggle an unopenable note into
the Notebook.

DELETE SAFETY IS STRUCTURAL, NOT POLICY
---------------------------------------
Nothing on a note points at a template (`noteCreation.js:69` copies
`tpl.build(ctx)` into the create request; `j2_notes` has no template column and
must never gain one — spec §2.5 / N-10). So deleting a template cannot break a
note made from it, and that is a property of the schema rather than of anyone's
good behaviour. The delete here is nonetheless SOFT (`deleted_at`), matching
`j2_note_saved_views`, so an accidental delete is recoverable by an operator
without a database restore.
"""
from __future__ import annotations

import json
import secrets
import sqlite3
import uuid
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two import notes as notes_service

# ── Caps (see the module docstring for where each number comes from) ────────
MAX_TEMPLATE_BODY_BYTES = 256 * 1024          # 1/4 of notes.MAX_BODY_JSON_BYTES
MAX_TEMPLATES_PER_USER = 50                   # live rows per member
MAX_TEMPLATE_LABEL_CHARS = 60
MAX_TEMPLATE_DESCRIPTION_CHARS = 280
MAX_TEMPLATE_WHEN_CHARS = 60

# The one family a user template may claim. N-5: exactly one family is added,
# and it exists solely to group the member's own. A member template must never
# be able to file itself into 'rituals' beside the firm's Daily Game Plan.
USER_TEMPLATE_FAMILY = "mine"

# The deep-link identity namespace. `u_` mirrors user_definitions.py:189
# (`DEF_ID_PREFIX = "u_"`). Twelve hex characters = 48 bits.
USER_TEMPLATE_KEY_PREFIX = "u_"
_KEY_HEX_CHARS = 12
_KEY_MINT_ATTEMPTS = 8


class TemplateValidationError(ValueError):
    """Raised for anything a member can fix by sending different input.
    The router maps this to 400; everything else is a 500 on purpose."""


def _now_iso() -> str:
    return notes_service._now_iso()


def _row_to_dict(r: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": r["id"],
        "key": r["key"],
        "label": r["label"],
        "description": r["description"] or "",
        "when": r["when_text"] or "",
        "family": r["family"],
        "tags": json.loads(r["tags_json"]) if r["tags_json"] else [],
        "bodyJson": json.loads(r["body_json"]),
        "titleText": r["title_text"] or "",
        "sortOrder": r["sort_order"],
        "createdAt": r["created_at"],
        "updatedAt": r["updated_at"],
    }


# ── Validation ──────────────────────────────────────────────────────────────

def _validate_label(raw: Any) -> str:
    if not isinstance(raw, str):
        raise TemplateValidationError("label is required")
    label = raw.strip()
    if not label:
        raise TemplateValidationError("label is required")
    if len(label) > MAX_TEMPLATE_LABEL_CHARS:
        raise TemplateValidationError(f"label exceeds {MAX_TEMPLATE_LABEL_CHARS} chars")
    return label


def _validate_short_text(raw: Any, field: str, cap: int) -> str:
    if raw is None:
        return ""
    if not isinstance(raw, str):
        raise TemplateValidationError(f"{field} must be a string")
    text = raw.strip()
    if len(text) > cap:
        raise TemplateValidationError(f"{field} exceeds {cap} chars")
    return text


def _validate_title_text(raw: Any) -> str:
    return _validate_short_text(raw, "titleText", notes_service.MAX_TITLE_CHARS)


def _validate_family(raw: Any) -> str:
    if raw is None or raw == "":
        return USER_TEMPLATE_FAMILY
    if raw != USER_TEMPLATE_FAMILY:
        raise TemplateValidationError(
            f"family must be {USER_TEMPLATE_FAMILY!r} (a user template cannot join a built-in family)"
        )
    return USER_TEMPLATE_FAMILY


def _validate_body(raw: Any) -> dict[str, Any]:
    """Same door a note body goes through, then a tighter cap. Reusing
    `notes._validate_body_json` is the point: a template must not be able to
    store a doc the editor would refuse to open."""
    if raw is None or raw == "":
        raise TemplateValidationError("bodyJson is required")
    try:
        body = notes_service._validate_body_json(raw)
    except notes_service.NoteValidationError as e:
        raise TemplateValidationError(str(e)) from e
    serialized = json.dumps(body)
    if len(serialized.encode("utf-8")) > MAX_TEMPLATE_BODY_BYTES:
        raise TemplateValidationError(
            f"bodyJson too large (>{MAX_TEMPLATE_BODY_BYTES} bytes)"
        )
    return body


def _validate_tags(raw: Any) -> list[str]:
    try:
        return notes_service._validate_tags(raw)
    except notes_service.NoteValidationError as e:
        raise TemplateValidationError(str(e)) from e


def _mint_key(conn: sqlite3.Connection, user_id: str) -> str:
    """Server-minted, never client-supplied. Checked against tombstones too:
    a deleted row keeps its key forever so a stale deep link can never be
    re-pointed at a different template."""
    for _ in range(_KEY_MINT_ATTEMPTS):
        candidate = USER_TEMPLATE_KEY_PREFIX + secrets.token_hex(_KEY_HEX_CHARS // 2)
        taken = conn.execute(
            "SELECT 1 FROM j2_note_templates WHERE user_id = ? AND key = ?",
            (user_id, candidate),
        ).fetchone()
        if taken is None:
            return candidate
    raise RuntimeError("could not mint a unique template key")  # pragma: no cover


# ── CRUD ────────────────────────────────────────────────────────────────────

def list_note_templates(user_id: str, conn: sqlite3.Connection | None = None) -> list[dict[str, Any]]:
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM j2_note_templates WHERE user_id = ? AND deleted_at IS NULL"
            " ORDER BY sort_order, created_at",
            (user_id,),
        ).fetchall()
        return [_row_to_dict(r) for r in rows]
    finally:
        if owned:
            conn.close()


def get_note_template(
    user_id: str, template_id: str, conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Tenant-scoped: another member's id is indistinguishable from a
    nonexistent one (None either way), per Wave D's tenant-isolation lesson."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        r = conn.execute(
            "SELECT * FROM j2_note_templates WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
            (template_id, user_id),
        ).fetchone()
        return _row_to_dict(r) if r else None
    finally:
        if owned:
            conn.close()


def create_note_template(
    user_id: str,
    *,
    label: Any,
    body_json: Any,
    description: Any = None,
    when_text: Any = None,
    tags: Any = None,
    title_text: Any = None,
    family: Any = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    label_v = _validate_label(label)
    description_v = _validate_short_text(description, "description", MAX_TEMPLATE_DESCRIPTION_CHARS)
    when_v = _validate_short_text(when_text, "when", MAX_TEMPLATE_WHEN_CHARS)
    family_v = _validate_family(family)
    tags_v = _validate_tags(tags)
    title_v = _validate_title_text(title_text)
    body_v = _validate_body(body_json)

    owned = conn is None
    conn = conn or get_connection()
    try:
        live = conn.execute(
            "SELECT COUNT(*) AS n FROM j2_note_templates WHERE user_id = ? AND deleted_at IS NULL",
            (user_id,),
        ).fetchone()["n"]
        if live >= MAX_TEMPLATES_PER_USER:
            raise TemplateValidationError(
                f"template limit reached ({MAX_TEMPLATES_PER_USER}) — delete one to save another"
            )
        tid = uuid.uuid4().hex
        key = _mint_key(conn, user_id)
        now = _now_iso()
        nxt = conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM j2_note_templates WHERE user_id = ?",
            (user_id,),
        ).fetchone()["n"]
        conn.execute(
            "INSERT INTO j2_note_templates"
            " (id, user_id, key, label, description, when_text, family, tags_json,"
            "  body_json, title_text, sort_order, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                tid, user_id, key, label_v, description_v, when_v, family_v,
                json.dumps(tags_v), json.dumps(body_v), title_v, nxt, now, now,
            ),
        )
        conn.commit()
        return get_note_template(user_id, tid, conn=conn)
    finally:
        if owned:
            conn.close()


def update_note_template(
    user_id: str,
    template_id: str,
    *,
    label: Any = None,
    description: Any = None,
    when_text: Any = None,
    tags: Any = None,
    body_json: Any = None,
    title_text: Any = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Partial update. `None` means "not supplied"; `""`/`[]` clear a field.

    ⛔ `key` is never updated. It is the deep-link identity — re-minting it on
    an edit would break every bookmark and shortcut pointing at this template,
    silently (an unresolved ?new=<key> is the no-op the picker work still has
    to fix)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        existing = get_note_template(user_id, template_id, conn=conn)
        if existing is None:
            return None
        new_label = _validate_label(label) if label is not None else existing["label"]
        new_description = (
            _validate_short_text(description, "description", MAX_TEMPLATE_DESCRIPTION_CHARS)
            if description is not None else existing["description"]
        )
        new_when = (
            _validate_short_text(when_text, "when", MAX_TEMPLATE_WHEN_CHARS)
            if when_text is not None else existing["when"]
        )
        new_tags = _validate_tags(tags) if tags is not None else existing["tags"]
        new_title = _validate_title_text(title_text) if title_text is not None else existing["titleText"]
        new_body = _validate_body(body_json) if body_json is not None else existing["bodyJson"]
        conn.execute(
            "UPDATE j2_note_templates SET label = ?, description = ?, when_text = ?,"
            " tags_json = ?, body_json = ?, title_text = ?, updated_at = ?"
            " WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
            (
                new_label, new_description, new_when, json.dumps(new_tags),
                json.dumps(new_body), new_title, _now_iso(), template_id, user_id,
            ),
        )
        conn.commit()
        return get_note_template(user_id, template_id, conn=conn)
    finally:
        if owned:
            conn.close()


def delete_note_template(
    user_id: str, template_id: str, conn: sqlite3.Connection | None = None,
) -> bool:
    """Soft delete. Tenant-scoped: a foreign id returns False, identically to
    a nonexistent one. Notes already created from this template are untouched
    and cannot be otherwise — nothing on a note points here."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        cur = conn.execute(
            "UPDATE j2_note_templates SET deleted_at = ?"
            " WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
            (_now_iso(), template_id, user_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        if owned:
            conn.close()
